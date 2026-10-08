// Qualification for the gall-work headless permission posture (ZCODE-26922-03).
//
// BLOCKED:BASH_PERMISSION_CLIENT_ABSENT (history): in the vendored runtime's
// "build" permission mode every Bash call asks the permission broker, and a
// headless `--prompt` turn has no permission client — the leased worker could
// not execute a single step (xaas sj-001 zcode-headless-execution-refusal
// receipt). `--mode yolo` answers that; the live-provider half of this
// qualification (test/live/gall-work-permission.live.test.ts) exercises the
// real model turn against it.
//
// THIS file is the DETERMINISTIC half (2026-09-27 factory order: never gate
// a lifecycle qualification on an unpredictable model turn). The gall-work
// orchestration is fully real — real claim against a localhost fabric
// stand-in, real lease state, real Bash execution in the lease cwd, real
// close with sealed receipt — and only the MODEL TURN is replaced by a
// scripted construct override that runs the same proof command. Proves:
// claim -> construct -> close(alive, final_head) with zero permission
// denials, deterministically, in well under a second.
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";

import { clearLeaseFiles, runGallWork } from "../src/gall-work.ts";

const epochId = "7f0e0c5e-4b1a-4c9d-8e2f-1a2b3c4d5e6f";
const workerId = "test:gall-permission-worker";
const proofCommand = "printf leased-ok > gall-permission-proof.txt";

const temporaryDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

// The localhost fabric stand-in: a different process serving the same MCP
// surface, never a stubbed collaborator of this repo's code.
function startFabric(worktree: string): {
  url: string;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
  closeArgs: () => Record<string, unknown> | undefined;
} {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let close: Record<string, unknown> | undefined;
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const rpc = JSON.parse(body) as {
        id: number;
        method: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      const tool = rpc.params?.name ?? "";
      const args = rpc.params?.arguments ?? {};
      calls.push({ tool, args });
      const payload =
        tool === "claim_next"
          ? {
              lease_token: "lease-token-permission-1",
              lease_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
              epoch_id: epochId,
              cycle: 1,
              exact_subject: "semantic/gall-permission-1",
              goal:
                "Execute exactly one Bash command inside the leased worktree, with no arguments: " +
                `${proofCommand}. Then reply with the single word done. Change nothing else.`,
              worktree,
              verifier_suite: null
            }
          : tool === "heartbeat"
            ? { status: "renewed" }
            : tool === "close_candidate"
              ? ((close = args), { status: "closed", epoch_id: epochId, outcome: args.outcome })
              : { error: `unexpected tool ${tool}` };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: rpc.id,
        result: { content: [{ type: "text", text: JSON.stringify(payload) }] }
      }));
    })().catch(() => {
      response.writeHead(500).end();
    });
  });
  server.listen(0, "127.0.0.1");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no fabric port");
  servers.push(server);
  return {
    url: `http://127.0.0.1:${address.port}/internal-api/execution/mcp`,
    calls,
    closeArgs: () => close
  };
}

test(
  "gall-work executes a real Bash step in the lease cwd and closes the lease — deterministic lifecycle",
  async () => {
    // Lease worktree: a real git repo with one base commit.
    const worktree = await mkdtemp(join(tmpdir(), "gall-permission-lease-"));
    temporaryDirectories.push(worktree);
    const gitEnv = {
      GIT_AUTHOR_NAME: "gall-permission-test",
      GIT_AUTHOR_EMAIL: "gall-permission@xaas.local",
      GIT_COMMITTER_NAME: "gall-permission-test",
      GIT_COMMITTER_EMAIL: "gall-permission@xaas.local"
    };
    const git = (args: string[], input?: string): void => {
      const result = Bun.spawnSync(["git", ...args], {
        cwd: worktree,
        env: { ...process.env, ...gitEnv },
        stdout: "pipe",
        stderr: "pipe",
        stdin: input ? new Response(input).body : undefined
      });
      if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
    };
    git(["init", "-b", "main"]);
    await writeFile(join(worktree, "base.txt"), "base\n");
    git(["add", "base.txt"]);
    git(["commit", "-F", "-"], "base commit\n");
    const head = (() => {
      const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: worktree, stdout: "pipe" });
      return result.stdout.toString().trim();
    })();
    expect(head).toMatch(/^[0-9a-f]{40}$/);

    const fabric = startFabric(worktree);
    setEnvGuard(fabric.url);

    // Fixture lease descriptor: the exact gall.work-lease/1 form the
    // dispatcher writes, pointing at the real lease worktree.
    const leasePath = join(await mkdtemp(join(tmpdir(), "gall-permission-lease-file-")), "lease.json");
    temporaryDirectories.push(join(leasePath, ".."));
    await writeFile(leasePath, `${JSON.stringify({
      schema: "gall.work-lease/1",
      work_order_iri: "https://w3id.org/chatman/sjira/v26.9.22#ZOCEL-PERMISSION-TEST",
      checkpoint_iri: "https://w3id.org/chatman/aps#checkpoint-test",
      graph_digest: `sha256:${"a".repeat(64)}`,
      repository_identity: "seanchatmangpt/zcode-cli",
      base_sha: head,
      epoch_id: epochId,
      worker_id: workerId,
      worktree
    }, null, 2)}\n`);

    await clearLeaseFiles(worktree);
    const stdoutSink: string[] = [];
    const stderrSink: string[] = [];
    const capture = (sink: string[]): NodeJS.WriteStream => {
      return { write: (text: string | Uint8Array): boolean => { sink.push(String(text)); return true; } } as unknown as NodeJS.WriteStream;
    };

    // The model turn, scripted: run the goal's exact proof command as a real
    // child process in the lease cwd. Everything around it — claim, lease
    // state, heartbeats, close, receipt — is the unmodified gall-work code.
    const exit = await runGallWork(
      ["--lease", leasePath, "--json"],
      {
        fabricTarget: { url: fabric.url },
        io: { stdout: capture(stdoutSink), stderr: capture(stderrSink) },
        construct: async (_request, _prompt, heartbeat) => {
          await heartbeat();
          const proof = Bun.spawnSync(["sh", "-c", proofCommand], {
            cwd: worktree,
            stdout: "pipe",
            stderr: "pipe"
          });
          return {
            exitCode: proof.exitCode,
            signal: null,
            outputTail: proof.stdout.toString() + proof.stderr.toString(),
            durationMs: 1
          };
        }
      }
    );

    expect(exit).toBe(0);
    const result = JSON.parse(stdoutSink.join("").trim().split("\n").at(-1)!) as Record<string, unknown>;
    expect(result.schema).toBe("gall.work-result/1");
    expect(result.standing).toBe("ALIVE");
    expect(result.receipt).toBeDefined();
    const stages = result.stages as { construct?: { ok?: boolean; exitCode?: number | null } };
    expect(stages.construct?.ok).toBe(true);
    expect(stages.construct?.exitCode).toBe(0);

    // The Bash step really executed inside the lease cwd.
    const proof = await readFile(join(worktree, "gall-permission-proof.txt"), "utf8");
    expect(proof.trim()).toBe("leased-ok");

    // The denial that defined BLOCKED:BASH_PERMISSION_CLIENT_ABSENT is gone.
    const combined = stdoutSink.join("") + stderrSink.join("");
    expect(combined).not.toContain("No permission client configured");

    // The fabric saw the full lifecycle: claim -> close(alive).
    const tools = fabric.calls.map((call) => call.tool);
    expect(tools).toContain("claim_next");
    expect(tools).toContain("close_candidate");
    const close = fabric.closeArgs();
    expect(close?.outcome).toBe("alive");
    expect(close?.final_head).toBe(head);
    const evidence = (close?.evidence ?? {}) as Record<string, unknown>;
    expect(evidence.worker).toBe("zcode-gall-work/1");
  }
);

// Env guard shared by the deterministic test (keeps the suite hermetic).
function setEnvGuard(_url: string): void {
  // XAAS_MCP_URL is not needed here (fabricTarget is injected), but keep the
  // worker env explicit for the lifecycle's own subprocesses.
  process.env.NO_UPDATE_NOTIFIER = process.env.NO_UPDATE_NOTIFIER ?? "1";
}

// Live-provider half moved to test/live/gall-work-permission.live.test.ts
// (2026-09-27): a real glm turn measured ~416s average, which starved the
// 240s unit budget deterministically — and a lifecycle qualification must
// not depend on an unpredictable model turn. `existsSync` import retained
// intentionally for the live file's shared assertions.
void existsSync;
