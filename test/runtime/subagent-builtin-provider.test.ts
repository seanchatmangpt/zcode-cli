import { afterEach, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for headless subagents under a CLI config that only
// registers the `zai` provider. The ZCode desktop app persists concrete
// built-in subagent model overrides in `<storage.dir>/v2/agents-state.json`
// (`custom:builtin%3Azai-coding-plan:<model>`). Those refs bypass `model.lite`
// and name a provider id the CLI config never registers, so every Agent call
// failed with "Model provider is not configured: builtin:zai-coding-plan".
// `patchRuntimeBuiltinProviderAliases` (scripts/sync-runtime.ts) aliases the
// builtin id onto the configured family provider.
//
// Exercised end to end against the real, locally synced runtime
// (`vendor/zcode.cjs`): a real subprocess, a real local HTTP fixture standing
// in for the `zai` endpoint, and state-based assertions on the runtime output
// and on the requests the fixture actually received.

const root = fileURLToPath(new URL("../..", import.meta.url));
const fixtureProcesses: ChildProcessWithoutNullStreams[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(fixtureProcesses.splice(0).map(async (child) => {
    if (child.exitCode !== null) return;
    const closed = once(child, "close");
    child.kill("SIGTERM");
    await closed;
  }));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

async function startFixtureServer(node: string): Promise<{
  output: () => string;
  port: number;
  stderr: () => string;
}> {
  const child = spawn(node, [join(root, "test", "fixtures", "subagent-builtin-provider-server.mjs")], {
    cwd: root,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  fixtureProcesses.push(child as ChildProcessWithoutNullStreams);
  let output = "";
  let errorOutput = "";
  let pending = "";
  let ready = false;
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Fixture server did not start. ${errorOutput}`)), 5_000);
    child.stdout.on("data", (part: Buffer) => {
      const text = part.toString("utf8");
      output += text;
      pending += text;
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) break;
        const line = pending.slice(0, newline).trim();
        pending = pending.slice(newline + 1);
        const match = /^READY (\d+)$/u.exec(line);
        if (match?.[1] && !ready) {
          ready = true;
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      }
    });
    child.stderr.on("data", (part: Buffer) => {
      errorOutput += part.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (ready) return;
      clearTimeout(timer);
      reject(new Error(`Fixture server exited with ${code}. ${errorOutput}`));
    });
  });
  return { output: () => output, port, stderr: () => errorOutput };
}

interface RuntimeOutputEntry {
  response?: string;
  type?: string;
}

async function runHeadlessAgent(agentsState: Record<string, unknown> | undefined): Promise<{
  code: number;
  fixtureRequests: string[];
  output: RuntimeOutputEntry[];
  stderr: string;
  stdout: string;
}> {
  const node = Bun.which("node");
  if (!node) throw new Error("Node.js is required for runtime integration tests.");
  const server = await startFixtureServer(node);
  const home = await mkdtemp(join(tmpdir(), "zcode-subagent-builtin-"));
  temporaryDirectories.push(home);
  const workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });
  const config = await Bun.file(new URL("../../config.example.json", import.meta.url)).json() as Record<string, unknown> & {
    provider: Record<string, unknown>;
  };
  const defaultZai = config.provider.zai as { models: Record<string, unknown> };
  config.provider = {
    zai: {
      kind: "openai-compatible",
      name: "Zai subagent fixture",
      options: {
        apiKey: "fixture-key",
        apiKeyRequired: true,
        baseURL: `http://127.0.0.1:${server.port}/v1`
      },
      headers: {},
      models: defaultZai.models
    }
  };
  config.model = { main: "zai/glm-5.3-flash", lite: "zai/glm-5.3-flash" };
  config.storage = {
    dir: join(home, ".zcode"),
    sessionDbPath: join(home, ".zcode", "cli", "db", "db.sqlite")
  };
  config.features = { compact: false, rewind: false, subagent: true, memory: false, skill: false, mcp: false };
  config.memory = { use: false, write: false, autoConsolidate: false };
  config.plugins = { enabled: false, dirs: [], enabledPlugins: {}, options: {}, suppressedBuiltins: [] };
  config.skills = { enabled: false, includeInstructions: false, metadataBudget: 20_000, roots: [] };
  config.mcp = { servers: {} };
  config.logging = { level: "error", format: "text" };
  const configDirectory = join(home, ".zcode", "cli");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(join(configDirectory, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  if (agentsState) {
    await mkdir(join(home, ".zcode", "v2"), { recursive: true });
    await writeFile(join(home, ".zcode", "v2", "agents-state.json"), `${JSON.stringify(agentsState, null, 2)}\n`);
  }
  const child = Bun.spawn([
    node,
    "--import", join(root, "test", "fixtures", "runtime-keepalive.mjs"),
    "vendor/zcode.cjs",
    "--prompt", "Launch one subagent that replies PONG, then report what it returned.",
    "--cwd", workspace,
    "--no-color",
    "--output-format", "stream-json",
    "--surface", "terminal"
  ], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NO_UPDATE_NOTIFIER: "1",
      ZCODE_DISABLE_UPDATE_CHECK: "1",
      ZCODE_MODEL_RETRY_MAX_RETRIES: "0",
      ZCODE_NODE: node
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe"
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ]);
  const output = stdout.trim().split("\n").filter(Boolean).flatMap((line) => {
    try {
      return [JSON.parse(line) as RuntimeOutputEntry];
    } catch {
      return [];
    }
  });
  return {
    code,
    fixtureRequests: server.output().split("\n").filter((line) => line.startsWith("REQUEST ")),
    output,
    stderr: `${stderr}${server.stderr()}`,
    stdout
  };
}

const desktopOverride = {
  builtInModelOverrides: {
    "general-purpose": "custom:builtin%3Azai-coding-plan:GLM-5.3-Flash",
    Explore: "custom:builtin%3Azai-coding-plan:GLM-5.3-Flash"
  },
  builtInThoughtLevelOverrides: {},
  disabledAgentIds: []
};

test("a desktop builtin subagent model override resolves to the configured zai provider", async () => {
  const run = await runHeadlessAgent(desktopOverride);
  const result = run.output.findLast((entry) => entry.type === "result");

  expect(run.code, `${run.stderr}\n${run.stdout}`).toBe(0);
  expect(run.stdout + run.stderr).not.toContain("Model provider is not configured");
  expect(result?.response).toContain("SUBAGENT_RETURNED_PONG");
  // The subagent's own model request reached the configured endpoint carrying
  // the desktop override's model id, not the config's `model.lite`.
  expect(run.fixtureRequests).toContain("REQUEST role=subagent model=GLM-5.3-Flash");
}, 60_000);

test("without a desktop override the subagent uses the configured lite model", async () => {
  const run = await runHeadlessAgent(undefined);
  const result = run.output.findLast((entry) => entry.type === "result");

  expect(run.code, `${run.stderr}\n${run.stdout}`).toBe(0);
  expect(result?.response).toContain("SUBAGENT_RETURNED_PONG");
  expect(run.fixtureRequests.some((line) => line.startsWith("REQUEST role=subagent model=glm-5.3-flash"))).toBe(true);
}, 60_000);
