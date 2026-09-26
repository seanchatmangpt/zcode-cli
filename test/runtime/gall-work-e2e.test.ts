// End-to-end qualification of the native `zcode gall-work` lifecycle against
// a MOCKED fabric server: a real HTTP server on 127.0.0.1 scripted with the
// exact JSON-RPC 2.0 tool-call surface the XaaS execution fabric exposes
// (claim_next / heartbeat / close_candidate / refuse; result in
// content[0].text, refusals as isError). The construct stage is injected
// (dependency injection, not a production backdoor): the tests script the
// turn's exit codes and commits, and assert what the orchestrator sent the
// fabric, what it persisted for the host gate, and what it printed.
//
// Hermetic: no real fabric, no real runtime, no network beyond localhost.
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  clearLeaseFiles,
  constructPrompt,
  gallWorkContractSha256,
  leaseFilePaths,
  runGallWork,
  workOrderPath,
  type ConstructOutcome,
  type ConstructOverride
} from "../../src/gall-work.ts";

// Test stand-in for the process streams the orchestrator writes to.
const captureStream = (sink: string[]): NodeJS.WriteStream => {
  return { write: (text: string | Uint8Array): boolean => { sink.push(String(text)); return true; } } as unknown as NodeJS.WriteStream;
};

const gitEnv = {
  GIT_AUTHOR_NAME: "gall-work-e2e",
  GIT_AUTHOR_EMAIL: "gall-e2e@xaas.local",
  GIT_COMMITTER_NAME: "gall-work-e2e",
  GIT_COMMITTER_EMAIL: "gall-e2e@xaas.local"
};

const git = (args: string[], cwd: string): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};

interface FabricScriptStep {
  tool: string;
  respond: (args: Record<string, unknown>) => { ok: boolean; payload: unknown };
}

class MockFabric {
  readonly server: Server;
  readonly calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  private steps: FabricScriptStep[] = [];
  readonly url: string;
  /** When true, initialize/tools/list fall through to the unknown-tool path (typed degrade). */
  discoveryDisabled = false;

  constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.listen(0, "127.0.0.1");
    const address = this.server.address();
    if (address === null || typeof address === "string") throw new Error("no mock fabric port");
    this.url = `http://127.0.0.1:${address.port}/internal-api/execution/mcp`;
  }

  script(steps: FabricScriptStep[]): void {
    this.steps = steps;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body = "";
    for await (const chunk of request) body += chunk;
    const rpc = JSON.parse(body) as {
      id: number;
      method: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    const tool = rpc.params?.name ?? rpc.method;
    const args = rpc.params?.arguments ?? {};
    this.calls.push({ tool, args });

    const respondWith = (payload: unknown, isError: boolean): void => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          isError
            ? { jsonrpc: "2.0", id: rpc.id, result: { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] } }
            : { jsonrpc: "2.0", id: rpc.id, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }
        )
      );
    };
    const replyRpc = (payload: unknown): void => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: payload }));
    };

    // Capability discovery (contract fabric.capability_discovery): a real
    // initialize + tools/list handshake.
    if (rpc.method === "initialize" && !this.discoveryDisabled) {
      replyRpc({ protocolVersion: "2024-11-05", serverInfo: { name: "mock-fabric", version: "1" } });
      return;
    }
    if (rpc.method === "tools/list" && !this.discoveryDisabled) {
      replyRpc({
        tools: [
          { name: "claim_next" },
          { name: "heartbeat" },
          { name: "work_status" },
          { name: "close_candidate" },
          { name: "cancel_work" },
          { name: "refuse" }
        ]
      });
      return;
    }

    const step = this.steps.find((candidate) => candidate.tool === tool);
    if (!step) {
      respondWith({ error: `unexpected_tool:${tool}` }, true);
      return;
    }
    const outcome = step.respond(args);
    respondWith(outcome.payload, !outcome.ok);
  }

  close(): void {
    this.server.close();
  }

  callsFor(tool: string): Array<Record<string, unknown>> {
    return this.calls.filter((call) => call.tool === tool).map((call) => call.args);
  }
}

const epochId = "123e4567-e89b-42d3-a456-426614174000";
const workerId = "zcode-dispatch-host-abcd1234-4242";

interface Harness {
  fabric: MockFabric;
  worktree: string;
  baseHead: string;
}

function makeWorktree(): { worktree: string; baseHead: string } {
  const worktree = mkdtempSync(join(tmpdir(), "gall-work-e2e-"));
  git(["init", "-q"], worktree);
  writeFileSync(join(worktree, "README.md"), "leased worktree\n");
  git(["add", "."], worktree);
  git(["commit", "-q", "-m", "base"], worktree);
  const baseHead = git(["rev-parse", "HEAD"], worktree);
  return { worktree, baseHead };
}

function claimPayload(worktree: string, baseHead: string): Record<string, unknown> {
  return {
    lease_token: "lease-token-1",
    lease_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    epoch_id: epochId,
    cycle: 1,
    exact_subject: "semantic/subject-1",
    goal: "Add a file named deliverable.txt containing the word done.",
    worktree,
    verifier_suite: null
  };
}

const constructThat = (
  worktree: string,
  outcome: Partial<ConstructOutcome> & { commitFile?: string }
): ConstructOverride => {
  return async (request, prompt, onHeartbeat, signal) => {
    if (outcome.spawnError !== undefined) {
      return { exitCode: null, signal: null, outputTail: "", durationMs: 1, spawnError: outcome.spawnError };
    }
    // The orchestrator hands the turn a doctrinal prompt: the work-order
    // path only, never the goal text.
    expect(prompt).toBe(constructPrompt(workOrderPath(request.cwd)));
    expect(prompt).not.toContain("deliverable.txt");
    expect(signal).toBeInstanceOf(AbortSignal);
    // The host gate lease file is persisted (armed) for the worktree cwd
    // while the turn runs, enriched with dispatch identity for crash
    // reconciliation.
    const leaseFile = leaseFilePaths(worktree)[0]!;
    expect(existsSync(leaseFile)).toBe(true);
    const saved = JSON.parse(readFileSync(leaseFile, "utf8")) as Record<string, unknown>;
    expect(saved.provider_id).toBe("zcode");
    expect(saved.worker_id).toBe(request.workerId);
    expect(saved.epoch_id).toBe(request.epochId);
    const heartbeatArgs = await onHeartbeat().then(() => undefined, () => undefined); // one heartbeat mid-turn
    void heartbeatArgs;
    if (outcome.commitFile) {
      writeFileSync(join(worktree, outcome.commitFile), "done\n");
      git(["add", "."], worktree);
      git(["commit", "-q", "-m", "gall work"], worktree);
    }
    return {
      exitCode: outcome.exitCode ?? 0,
      signal: null,
      outputTail: outcome.outputTail ?? `turn output for ${request.epochId}`,
      durationMs: outcome.durationMs ?? 5
    };
  };
};

describe("gall-work end-to-end against a mocked fabric", () => {
  let harness: Harness;

  beforeEach(() => {
    const fabric = new MockFabric();
    const { worktree, baseHead } = makeWorktree();
    harness = { fabric, worktree, baseHead };
  });

  afterEach(() => {
    clearLeaseFiles(harness.worktree);
    rmSync(harness.worktree, { recursive: true, force: true });
    harness.fabric.close();
  });

  test("happy path: claim -> persist -> construct(exit 0, commit) -> close alive; exit 0", async () => {
    const { fabric, worktree, baseHead } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      {
        tool: "close_candidate",
        respond: (args) => {
          expect(args.outcome).toBe("alive");
          return { ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "alive" } };
        }
      }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, { exitCode: 0, commitFile: "deliverable.txt" }),
        io: {
          stdout: captureStream(chunks),
          stderr: captureStream([])
        }
      }
    );

    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.schema).toBe("gall.work-result/1");
    expect(result.standing).toBe("ALIVE");
    expect(result.outcome).toBe("alive");
    expect(result.runtimeExitCode).toBe(0);
    expect(result.provider).toBe("zcode");
    expect(result.finalHead).toBe(git(["rev-parse", "HEAD"], worktree));
    expect(String(result.finalHead)).not.toBe(baseHead);

    // discovery handshake ran against the fabric; reconcile found no stale lease
    const stages = result.stages as Record<string, Record<string, unknown>>;
    expect(stages.discovery).toMatchObject({ ok: true, tools: 6 });
    expect(stages.reconcile).toBeUndefined();

    // the fabric saw the exact claim (registry-resolved provider, idempotency
    // key) and the exact close
    expect(fabric.callsFor("claim_next")).toEqual([
      {
        provider: "zcode",
        provider_worker_id: workerId,
        epoch_id: epochId,
        idempotency_key: `gall-work:zcode:${workerId}:${epochId}`
      }
    ]);
    expect(fabric.calls.map((call) => call.tool).slice(0, 2)).toEqual(["initialize", "tools/list"]);
    const close = fabric.callsFor("close_candidate")[0] as Record<string, unknown>;
    expect(close.lease_token).toBe("lease-token-1");
    expect(close.final_head).toBe(result.finalHead);
    const evidence = close.evidence as Record<string, unknown>;
    expect(evidence.worker).toBe("zcode-gall-work/1");
    expect(evidence.runtime_exit_code).toBe(0);
    expect(evidence.provider).toBe("zcode");
    expect(evidence.contract_sha256).toBe(gallWorkContractSha256);
    expect(evidence.idempotency_key).toBe(`gall-work:zcode:${workerId}:${epochId}`);
    expect(evidence.replay_binding).toMatchObject({
      contract_version: 1,
      contract_sha256: gallWorkContractSha256,
      provider: "zcode",
      worker_id: workerId,
      epoch_id: epochId,
      idempotency_key: `gall-work:zcode:${workerId}:${epochId}`
    });

    // the receipt is terminal: the gate lease file is cleared for this cwd
    // (clearLeaseFiles finally wired) ...
    expect(existsSync(leaseFilePaths(worktree)[0]!)).toBe(false);
    // ... and the work-order file carries the goal OFF argv
    const order = JSON.parse(readFileSync(workOrderPath(worktree), "utf8")) as Record<string, unknown>;
    expect(order.goal).toContain("deliverable.txt");
    expect(order.epoch_id).toBe(epochId);
  });

  test("claim refusal is typed, exit 1, and nothing else is called", async () => {
    const { fabric, worktree } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: false, payload: { error: "no_ready_work" } }) }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, {}),
        io: {
          stdout: captureStream(chunks),
          stderr: captureStream([])
        }
      }
    );

    expect(exit).toBe(1);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED_CLAIM");
    expect(result.code).toBe("no_ready_work");
    expect(fabric.calls.map((call) => call.tool)).toEqual(["initialize", "tools/list", "claim_next"]);
    expect(existsSync(leaseFilePaths(worktree)[0]!)).toBe(false);
  });

  test("fabric unreachable: typed REFUSED_CLAIM, exit 1", async () => {
    const { worktree } = harness;
    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: "http://127.0.0.1:1/mcp" },
        construct: constructThat(worktree, {}),
        io: {
          stdout: captureStream(chunks),
          stderr: captureStream([])
        }
      }
    );
    expect(exit).toBe(1);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED_CLAIM");
    expect(String(result.code)).toContain("fabric_unreachable");
  });

  test("failed turn still closes: outcome blocked, evidence carries exit code, exit 0", async () => {
    const { fabric, worktree } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, harness.baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      {
        tool: "close_candidate",
        respond: (args) => {
          expect(args.outcome).toBe("blocked");
          expect((args.evidence as Record<string, unknown>).runtime_exit_code).toBe(1);
          return { ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "blocked" } };
        }
      }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, { exitCode: 1, outputTail: "provider 500: High concurrency usage" }),
        io: {
          stdout: captureStream(chunks),
          stderr: captureStream([])
        }
      }
    );

    // the receipt is sealed -> dispatch-completed; the dispatcher's own
    // failover grep classifies the streamed provider error.
    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("BLOCKED");
    expect(result.runtimeExitCode).toBe(1);
  });

  test("live conflicting lease for this cwd: exit 65 with a typed refusal, prior lease untouched", async () => {
    const { fabric, worktree } = harness;
    fabric.script([
      { tool: "work_status", respond: (args) => {
          expect(args.lease_token).toBe("prior-live-token");
          return { ok: true, payload: { status: "open" } };
        } },
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, harness.baseHead) }) },
      { tool: "refuse", respond: () => ({ ok: true, payload: { status: "refused", epoch_id: epochId, outcome: "refused" } }) }
    ]);

    const leaseFile = leaseFilePaths(worktree)[0]!;
    mkdirSync(dirname(leaseFile), { recursive: true });
    writeFileSync(
      leaseFile,
      JSON.stringify({ lease_token: "prior-live-token", lease_expires_at: new Date(Date.now() + 600_000).toISOString() })
    );

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, {}),
        io: {
          stdout: captureStream(chunks),
          stderr: captureStream([])
        }
      }
    );

    expect(exit).toBe(65);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED_LEASE_CONFLICT");
    expect(fabric.callsFor("refuse")[0]).toMatchObject({ lease_token: "lease-token-1", reason: "no_authority" });
    const untouched = JSON.parse(readFileSync(leaseFile, "utf8")) as Record<string, unknown>;
    expect(untouched.lease_token).toBe("prior-live-token");
  });
  test("claim binds a different worktree than --cwd: subject mismatch, refused, exit 1", async () => {
    const other = makeWorktree();
    const { fabric, worktree } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(other.worktree, other.baseHead) }) },
      { tool: "refuse", respond: () => ({ ok: true, payload: { status: "refused", epoch_id: epochId, outcome: "refused" } }) }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, {}),
        io: {
          stdout: captureStream(chunks),
          stderr: captureStream([])
        }
      }
    );

    expect(exit).toBe(1);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED_SUBJECT_MISMATCH");
    expect(result.code).toBe("worktree_mismatch");
    expect(fabric.callsFor("refuse")[0]).toMatchObject({ reason: "no_authority" });
    rmSync(other.worktree, { recursive: true, force: true });
    clearLeaseFiles(other.worktree);
  });

  test("descriptor form binds semantic identity into close evidence", async () => {
    const { fabric, worktree, baseHead } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      {
        tool: "close_candidate",
        respond: (args) => {
          const evidence = args.evidence as Record<string, unknown>;
          expect(evidence.semantic_identity).toMatchObject({ graph_digest: "sha256:" + "a".repeat(64) });
          return { ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "alive" } };
        }
      }
    ]);

    const descriptorPath = join(worktree, "..", "lease-descriptor.json");
    writeFileSync(
      descriptorPath,
      JSON.stringify({ ...leaseDescriptor(worktree), epoch_id: epochId, worker_id: workerId })
    );

    const chunks: string[] = [];
    const exit = await runGallWork(["--lease", descriptorPath, "--json"], {
      fabricTarget: { url: fabric.url },
      construct: constructThat(worktree, { exitCode: 0, commitFile: "deliverable.txt" }),
      io: {
        stdout: captureStream(chunks),
        stderr: captureStream([])
      }
    });

    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("ALIVE");
    expect(fabric.callsFor("claim_next")[0]).toMatchObject({ provider_worker_id: workerId, epoch_id: epochId });
  });

  test("runtime cannot spawn: refuses blocked, receipt sealed, exit 0", async () => {
    const { fabric, worktree } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, harness.baseHead) }) },
      { tool: "refuse", respond: () => ({ ok: true, payload: { status: "refused", epoch_id: epochId, outcome: "refused" } }) }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, { spawnError: "runtime missing" }),
        io: {
          stdout: captureStream(chunks),
          stderr: captureStream([])
        }
      }
    );

    expect(exit).toBe(0); // a receipt was sealed: the epoch is terminal
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED");
    expect(result.code).toBe("spawn_failed");
  });

  test("close refusal: typed REFUSED_CLOSE, exit 1", async () => {
    const { fabric, worktree } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, harness.baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      { tool: "close_candidate", respond: () => ({ ok: false, payload: { error: "head mismatch: stale_head" } }) }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, { exitCode: 0, commitFile: "deliverable.txt" }),
        io: {
          stdout: captureStream(chunks),
          stderr: captureStream([])
        }
      }
    );

    expect(exit).toBe(1);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED_CLOSE");
    expect(result.code).toContain("head mismatch");
  });

  test("internal construct deadline: turn aborted, lease closed via cancel_work, receipt sealed", async () => {
    const { fabric, worktree } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, harness.baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      { tool: "cancel_work", respond: (args) => {
          expect(args.lease_token).toBe("lease-token-1");
          return { ok: true, payload: { status: "cancelled" } };
        } }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--construct-deadline-seconds", "0.05", "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: async (_request, _prompt, _onHeartbeat, signal) => {
          // A turn that never finishes on its own; the deadline abort kills it.
          await new Promise<void>((resolveAbort) => {
            if (signal?.aborted) resolveAbort();
            else signal?.addEventListener("abort", () => resolveAbort(), { once: true });
          });
          return { exitCode: null, signal: "SIGTERM", outputTail: "", durationMs: 60, heartbeatFailures: [] };
        },
        io: { stdout: captureStream(chunks), stderr: captureStream([]) }
      }
    );

    expect(exit).toBe(0); // cancel_work sealed a receipt: the epoch is terminal
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED");
    expect(result.code).toBe("construct_deadline_exceeded");
    expect(result.runtimeSignal).toBe("SIGTERM");
    expect(result.receipt).toMatchObject({ status: "cancelled" });
    expect(existsSync(leaseFilePaths(worktree)[0]!)).toBe(false);
    expect(fabric.callsFor("close_candidate")).toEqual([]); // cancelled, not closed
  });

  test("crash-window reconciliation: orphan lease past the heartbeat grace is reclaimed via cancel_work", async () => {
    const { fabric, worktree, baseHead } = harness;
    fabric.script([
      { tool: "work_status", respond: (args) => {
          expect(args.lease_token).toBe("orphan-crashed-token");
          return { ok: true, payload: { status: "open" } };
        } },
      { tool: "cancel_work", respond: (args) => {
          expect(args.lease_token).toBe("orphan-crashed-token");
          return { ok: true, payload: { status: "cancelled" } };
        } },
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      { tool: "close_candidate", respond: () => ({ ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "alive" } }) }
    ]);

    // A crashed predecessor: lease live per file but past the 2x-heartbeat
    // grace (15s heartbeat -> 30s grace; expiry is 1s away).
    const leaseFile = leaseFilePaths(worktree)[0]!;
    mkdirSync(dirname(leaseFile), { recursive: true });
    writeFileSync(
      leaseFile,
      JSON.stringify({
        lease_token: "orphan-crashed-token",
        lease_expires_at: new Date(Date.now() + 1_000).toISOString(),
        epoch_id: "999e4567-e89b-42d3-a456-426614179999",
        provider_id: "zcode",
        worker_id: "zcode-dead-worker"
      })
    );

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--heartbeat-seconds", "15", "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, { exitCode: 0, commitFile: "deliverable.txt" }),
        io: { stdout: captureStream(chunks), stderr: captureStream([]) }
      }
    );

    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("ALIVE");
    const stages = result.stages as Record<string, Record<string, unknown>>;
    expect(stages.reconcile).toMatchObject({ found: true, action: "closed_out" });
    // the new dispatch ran to a normal terminal close, clearing its own lease state
    expect(existsSync(leaseFile)).toBe(false);
  });

  test("crash-window reconciliation: an expired lease file is cleared without touching the fabric", async () => {
    const { fabric, worktree, baseHead } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      { tool: "close_candidate", respond: () => ({ ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "alive" } }) }
    ]);

    const leaseFile = leaseFilePaths(worktree)[0]!;
    mkdirSync(dirname(leaseFile), { recursive: true });
    writeFileSync(
      leaseFile,
      JSON.stringify({
        lease_token: "expired-litter-token",
        lease_expires_at: new Date(Date.now() - 60_000).toISOString()
      })
    );

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, { exitCode: 0, commitFile: "deliverable.txt" }),
        io: { stdout: captureStream(chunks), stderr: captureStream([]) }
      }
    );

    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    const stages = result.stages as Record<string, Record<string, unknown>>;
    expect(stages.reconcile).toMatchObject({ found: true, action: "cleared_expired" });
    expect(fabric.callsFor("work_status")).toEqual([]); // no fabric call needed for expired litter
  });

  test("origin authority travels from the claim payload into the work-order file and close evidence", async () => {
    const { fabric, worktree, baseHead } = harness;
    const originAuthority = "https://w3id.org/chatman/aps#operator-lease-grant";
    fabric.script([
      { tool: "claim_next", respond: () => ({
          ok: true,
          payload: { ...claimPayload(worktree, baseHead), origin_authority: originAuthority }
        }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      { tool: "close_candidate", respond: (args) => {
          expect((args.evidence as Record<string, unknown>).origin_authority).toBe(originAuthority);
          return { ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "alive" } };
        } }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: (request, prompt, onHeartbeat, signal) => constructThat(worktree, { exitCode: 0, commitFile: "deliverable.txt" })(request, prompt, onHeartbeat, signal),
        io: { stdout: captureStream(chunks), stderr: captureStream([]) }
      }
    );

    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.originAuthority).toBe(originAuthority);
    const order = JSON.parse(readFileSync(workOrderPath(worktree), "utf8")) as Record<string, unknown>;
    expect(order.origin_authority).toBe(originAuthority);
  });

  test("heartbeat failures are surfaced in close evidence, never dropped", async () => {
    const { fabric, worktree, baseHead } = harness;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: false, payload: { error: "lease_renewal_lost" } }) },
      { tool: "close_candidate", respond: (args) => {
          const evidence = args.evidence as Record<string, unknown>;
          expect(evidence.heartbeat_failure_count).toBeGreaterThan(0);
          expect(JSON.stringify(evidence.heartbeat_failures)).toContain("lease_renewal_lost");
          return { ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "alive" } };
        } }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: async (request, prompt, onHeartbeat, signal) => {
          expect(signal).toBeInstanceOf(AbortSignal);
          // the turn's heartbeat fails; the override observes the surfaced error
          await expect(onHeartbeat()).rejects.toThrow("heartbeat failed: lease_renewal_lost");
          return { exitCode: 0, signal: null, outputTail: "done", durationMs: 5, heartbeatFailures: [] };
        },
        io: { stdout: captureStream(chunks), stderr: captureStream([]) }
      }
    );

    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("ALIVE");
  });

  test("a fabric without the discovery handshake degrades typed and the lifecycle still completes", async () => {
    const { fabric, worktree, baseHead } = harness;
    fabric.discoveryDisabled = true;
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      { tool: "close_candidate", respond: () => ({ ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "alive" } }) }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerId, "--epoch-id", epochId, "--cwd", worktree, "--json"],
      {
        fabricTarget: { url: fabric.url },
        construct: constructThat(worktree, { exitCode: 0, commitFile: "deliverable.txt" }),
        io: { stdout: captureStream(chunks), stderr: captureStream([]) }
      }
    );

    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("ALIVE");
    const stages = result.stages as Record<string, Record<string, unknown>>;
    expect(stages.discovery).toMatchObject({ ok: false, code: "tools_list_unsupported" });
  });

  test("the binary accepts the native command and refuses usage without touching the fabric", async () => {
    const usage = Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "bin", "zcode.ts"), "gall-work", "--bogus"], {
      cwd: import.meta.dir,
      stdout: "pipe",
      stderr: "pipe"
    });
    expect(usage.exitCode).toBe(2);
    expect(usage.stderr.toString()).toContain("Usage: zcode gall-work");
    expect(usage.stderr.toString()).not.toContain("/xaas");
  });
});

function leaseDescriptor(worktree: string): Record<string, unknown> {
  return {
    schema: "gall.work-lease/1",
    work_order_iri: "urn:gall:work-order:xaas:e2e",
    checkpoint_iri: "urn:gall:checkpoint:xaas:e2e",
    graph_digest: "sha256:" + "a".repeat(64),
    repository_identity: "seanchatmangpt/xaas",
    base_sha: "c".repeat(40),
    epoch_id: "",
    worker_id: "",
    worktree
  };
}
