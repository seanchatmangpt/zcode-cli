import { afterEach, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Regression test for zai/GLM 429 retry-after handling, exercised end to end
// against the real, locally synced ZCode runtime (`vendor/zcode.cjs`), the
// same way test/runtime/network-retry.test.ts exercises the neighboring
// recovery patches — a real subprocess, a real local HTTP fixture server,
// and state-based assertions on the runtime's real stream-json output.
//
// zai/GLM's own structured business-error shape for HTTP 429 ("Rate limit
// reached for requests" is documented as code "1302" at
// https://docs.z.ai/api-reference/api-code) is wrapped by the runtime's
// shared fetch layer into a `ProviderBusinessError`, not the AI SDK's own
// `APICallError`. Investigating this (see scripts/sync-runtime.ts git
// history for the reverted attempt), it turns out the AI SDK's own
// exponential-backoff retry loop (which independently parses
// `retry-after`/`retry-after-ms` headers) never runs for *any* provider here
// — ZCode's own `streamText`/`generateText` call sites explicitly pass
// `maxRetries:0`, disabling that SDK-level loop runtime-wide by design.
// Retrying a 429 is instead handled entirely by the runtime's own turn-level
// attempt loop, which classifies `ProviderBusinessError` via its
// `providerCode` (e.g. "1302" -> retryable, via the `classifyModelFailure`/
// `classifyProviderBusinessFailure` business-code table) and reads the delay
// from the exact same `retry-after`/`retry-after-ms` response headers
// (`parseRetryAfterMs`) — independently of, and correctly instead of, the
// disabled SDK-level loop. These tests pin that already-working behavior so
// a future runtime sync that regresses it (e.g. a business code
// misclassified as non-retryable, or the retry-after header no longer being
// respected) fails loudly here instead of only showing up as a live 429
// hard-failing in the field.

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

async function startFixtureServer(
  node: string,
  env: NodeJS.ProcessEnv
): Promise<{ child: ChildProcessWithoutNullStreams; output: () => string; port: number; stderr: () => string }> {
  const child = spawn(node, [join(root, "test", "fixtures", "network-zai-business-429-server.mjs")], {
    cwd: root,
    env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  fixtureProcesses.push(child as ChildProcessWithoutNullStreams);
  let output = "";
  let errorOutput = "";
  let pending = "";
  let ready = false;
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Network fixture server did not start. ${errorOutput}`)), 5_000);
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
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
    child.stderr.on("data", (chunk: Buffer) => {
      errorOutput += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (ready) return;
      clearTimeout(timer);
      reject(new Error(`Network fixture server exited with ${code}. ${errorOutput}`));
    });
  });
  return { child: child as ChildProcessWithoutNullStreams, output: () => output, port, stderr: () => errorOutput };
}

interface RuntimeOutputEntry {
  payload?: Record<string, unknown>;
  response?: string;
  type?: string;
}

async function runZaiBusinessErrorFixture(options: {
  failuresBeforeSuccess: number;
  modelRetries: number;
  temporaryPrefix: string;
}): Promise<{ code: number; diagnostics: string; output: RuntimeOutputEntry[]; requestCount: number; stdout: string }> {
  const node = Bun.which("node");
  if (!node) throw new Error("Node.js is required for runtime retry integration tests.");
  const server = await startFixtureServer(node, {
    ...process.env,
    ZCODE_TEST_429_FAILURES: String(options.failuresBeforeSuccess)
  });
  const home = await mkdtemp(join(tmpdir(), options.temporaryPrefix));
  temporaryDirectories.push(home);
  const workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });
  const config = await Bun.file(new URL("../../setting.example.json", import.meta.url)).json() as {
    features: Record<string, unknown>;
    logging: Record<string, unknown>;
    mcp: { servers: Record<string, unknown> };
    memory: Record<string, unknown>;
    model: Record<string, unknown>;
    plugins: Record<string, unknown>;
    provider: Record<string, unknown>;
    skills: Record<string, unknown>;
    storage: Record<string, unknown>;
  };
  // The shared-configuration example no longer ships a provider block; the
  // fixture catalog mirrors the zai coding-plan model line inline.
  config.provider = {};
  config.provider.zai = {
    kind: "openai-compatible",
    name: "Zai business-error fixture",
    options: {
      apiKey: "fixture-key",
      apiKeyRequired: true,
      baseURL: `http://127.0.0.1:${server.port}/v1`
    },
    headers: {},
    models: {
      "glm-5.2": { name: "GLM-5.2" },
      "glm-5.3": { name: "GLM-5.3" },
      "glm-5.3-flash": { name: "GLM-5.3-Flash" }
    }
  };
  config.model = { main: "zai/glm-5.2", lite: "zai/glm-5.2" };
  config.storage = {
    dir: join(home, ".zcode"),
    sessionDbPath: join(home, ".zcode", "cli", "db", "db.sqlite")
  };
  config.features = { compact: false, rewind: false, subagent: false, memory: false, skill: false, mcp: false };
  config.memory = { use: false, write: false, autoConsolidate: false };
  config.plugins = { enabled: false, dirs: [], enabledPlugins: {}, options: {}, suppressedBuiltins: [] };
  config.skills = { enabled: false, includeInstructions: false, metadataBudget: 20_000, roots: [] };
  config.mcp = { servers: {} };
  config.logging = { level: "error", format: "text" };
  const configDirectory = join(home, ".zcode", "cli");
  await mkdir(configDirectory, { recursive: true });
  await writeFile(join(configDirectory, "setting.json"), `${JSON.stringify(config, null, 2)}\n`);
  const runtimeArgs = [
    "--import", join(root, "test", "fixtures", "runtime-keepalive.mjs"),
    "vendor/zcode.cjs",
    "--prompt", "Return the fixture response.",
    "--cwd", workspace,
    "--no-color",
    "--output-format", "stream-json",
    "--surface", "terminal",
    "--mode", "plan"
  ];
  const child = Bun.spawn([node, ...runtimeArgs], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NO_UPDATE_NOTIFIER: "1",
      ZCODE_DISABLE_UPDATE_CHECK: "1",
      ZCODE_MODEL_RETRY_BASE_DELAY_MS: "0",
      ZCODE_MODEL_RETRY_MAX_RETRIES: String(options.modelRetries),
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
  const output = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as RuntimeOutputEntry);
  const serverOutput = server.output();
  return {
    code,
    diagnostics: `${stderr}\nserver:\n${serverOutput}${server.stderr()}`,
    output,
    requestCount: serverOutput.split("\n").filter((line) => line.startsWith("REQUEST ")).length,
    stdout
  };
}

test("retries a zai/GLM structured 429 business error (code 1302) with a retry-after-respecting delay and succeeds", async () => {
  const run = await runZaiBusinessErrorFixture({
    failuresBeforeSuccess: 1,
    modelRetries: 1,
    temporaryPrefix: "zcode-zai-business-429-"
  });
  const result = run.output.findLast((entry) => entry.type === "result");
  const requestStarts = run.output.filter((entry) => entry.payload?.type === "model_request_started");
  const failures = run.output.filter((entry) => entry.payload?.type === "model_request_failed");
  const retryScheduled = run.output.find((entry) => entry.payload?.type === "model_retry_scheduled");

  expect(run.code, run.diagnostics).toBe(0);
  expect(run.requestCount, run.stdout).toBe(2);
  expect(requestStarts).toHaveLength(2);
  // The intermediate 429 is reported as `retryable: true` (the same
  // "waiting to retry" signal every other retried provider failure already
  // gets — packages/zcode-tui/src/index.ts's onEvent only surfaces a
  // visible error for `model_request_failed` when `retryable !== true`),
  // never as a hard turn-level failure.
  expect(failures).toHaveLength(1);
  expect(failures[0]?.payload?.retryable).toBe(true);
  expect(failures[0]?.payload?.providerErrorCode).toBe("1302");
  // The fixture's `retry-after-ms: 20` response header is the delay actually
  // used, not some unrelated default backoff.
  expect(retryScheduled?.payload?.delayMs).toBe(20);
  expect(run.output.some((entry) => entry.type === "turn.failed")).toBe(false);
  expect(result?.response).toBe("RECOVERED_FINAL");
}, 30_000);

test("exhausts a constrained turn-level retry budget across repeated zai/GLM 429s instead of retrying forever", async () => {
  const run = await runZaiBusinessErrorFixture({
    failuresBeforeSuccess: 2,
    modelRetries: 1,
    temporaryPrefix: "zcode-zai-business-429-exhausted-"
  });
  const failures = run.output.filter((entry) => entry.payload?.type === "model_request_failed");

  expect(run.code, run.diagnostics).not.toBe(0);
  expect(run.requestCount, run.stdout).toBe(2);
  expect(failures).toHaveLength(2);
  expect(failures[0]?.payload?.retryable).toBe(true);
  // The final attempt is reported as exhausted (no more budget), not as
  // some other, unrelated non-retryable classification.
  expect(failures[1]?.payload?.retryable).toBe(false);
  expect(run.output.some((entry) => entry.type === "turn.failed")).toBe(true);
}, 30_000);
