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
    const tool = rpc.params?.name ?? "";
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
  return async (request, prompt, onHeartbeat) => {
    if (outcome.spawnError !== undefined) {
      return { exitCode: null, signal: null, outputTail: "", durationMs: 1, spawnError: outcome.spawnError };
    }
    // The orchestrator hands the turn a doctrinal prompt: the work-order
    // path only, never the goal text.
    expect(prompt).toBe(constructPrompt(workOrderPath(request.cwd)));
    expect(prompt).not.toContain("deliverable.txt");
    const heartbeatArgs = (onHeartbeat(), undefined); // one heartbeat mid-turn
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
    expect(result.finalHead).toBe(git(["rev-parse", "HEAD"], worktree));
    expect(String(result.finalHead)).not.toBe(baseHead);

    // the fabric saw the exact claim and the exact close
    expect(fabric.callsFor("claim_next")).toEqual([
      { provider: "zcode", provider_worker_id: workerId, epoch_id: epochId }
    ]);
    const close = fabric.callsFor("close_candidate")[0] as Record<string, unknown>;
    expect(close.lease_token).toBe("lease-token-1");
    expect(close.final_head).toBe(result.finalHead);
    const evidence = close.evidence as Record<string, unknown>;
    expect(evidence.worker).toBe("zcode-gall-work/1");
    expect(evidence.runtime_exit_code).toBe(0);

    // the host gate lease file is persisted for the worktree cwd
    const leaseFile = leaseFilePaths(worktree)[0]!;
    expect(existsSync(leaseFile)).toBe(true);
    const saved = JSON.parse(readFileSync(leaseFile, "utf8")) as Record<string, unknown>;
    expect(saved.lease_token).toBe("lease-token-1");
    expect(saved.goal).toContain("deliverable.txt");

    // and the work-order file carries the goal OFF argv
    const order = JSON.parse(readFileSync(workOrderPath(worktree), "utf8")) as Record<string, unknown>;
    expect(order.goal).toContain("deliverable.txt");
    expect(order.epoch_id).toBe(epochId);
  });

  test("descriptor run binds exact base and emits a portable fresh-job handoff", async () => {
    const { fabric, worktree, baseHead } = harness;
    const leasePath = join(worktree, ".gall-lease.json");
    writeFileSync(leasePath, JSON.stringify({
      schema: "gall.work-lease/1",
      work_order_iri: "urn:gall:work-order:handoff:1",
      checkpoint_iri: "urn:gall:checkpoint:handoff:1",
      graph_digest: "sha256:" + "a".repeat(64),
      repository_identity: "seanchatmangpt/zcode-cli",
      base_sha: baseHead,
      epoch_id: epochId,
      worker_id: workerId,
      worktree
    }));

    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, baseHead) }) },
      { tool: "heartbeat", respond: () => ({ ok: true, payload: { status: "renewed" } }) },
      {
        tool: "close_candidate",
        respond: () => ({ ok: true, payload: { status: "closed", epoch_id: epochId, outcome: "alive" } })
      }
    ]);

    const chunks: string[] = [];
    const exit = await runGallWork(["--lease", leasePath, "--json"], {
      fabricTarget: { url: fabric.url },
      construct: constructThat(worktree, { exitCode: 0 }),
      io: { stdout: captureStream(chunks), stderr: captureStream([]) }
    });

    expect(exit).toBe(0);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    const handoff = result.handoff as Record<string, unknown>;
    expect(handoff.schema).toBe("gall.work-handoff/1");
    expect(handoff.base_sha).toBe(baseHead);
    expect(handoff.final_head).toBe(baseHead);
    expect(handoff.handoff_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(handoff.producer_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(handoff.authority).toBe("none");
    expect(JSON.stringify(handoff)).not.toContain(worktree);
    expect(JSON.stringify(handoff)).not.toContain(workerId);
    expect(JSON.stringify(handoff)).not.toContain(epochId);

    const close = fabric.callsFor("close_candidate")[0]!;
    const evidence = close.evidence as Record<string, unknown>;
    expect(evidence.handoff).toEqual(handoff);
  });

  test("descriptor base drift is refused before persist or construct", async () => {
    const { fabric, worktree, baseHead } = harness;
    const leasePath = join(worktree, ".gall-lease-drift.json");
    writeFileSync(leasePath, JSON.stringify({
      schema: "gall.work-lease/1",
      work_order_iri: "urn:gall:work-order:drift:1",
      checkpoint_iri: "urn:gall:checkpoint:drift:1",
      graph_digest: "sha256:" + "b".repeat(64),
      repository_identity: "seanchatmangpt/zcode-cli",
      base_sha: "f".repeat(40),
      epoch_id: epochId,
      worker_id: workerId,
      worktree
    }));
    fabric.script([
      { tool: "claim_next", respond: () => ({ ok: true, payload: claimPayload(worktree, baseHead) }) },
      { tool: "refuse", respond: () => ({ ok: true, payload: { status: "refused", epoch_id: epochId } }) }
    ]);

    let constructed = false;
    const chunks: string[] = [];
    const exit = await runGallWork(["--lease", leasePath, "--json"], {
      fabricTarget: { url: fabric.url },
      construct: async () => {
        constructed = true;
        return { exitCode: 0, signal: null, outputTail: "", durationMs: 1 };
      },
      io: { stdout: captureStream(chunks), stderr: captureStream([]) }
    });

    expect(exit).toBe(0);
    expect(constructed).toBe(false);
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED_SUBJECT_MISMATCH");
    expect(result.code).toBe("base_sha_mismatch");
    expect(String(result.detail)).toContain(baseHead);
    expect(fabric.calls.map((call) => call.tool)).toEqual(["claim_next", "refuse"]);
    expect(existsSync(leaseFilePaths(worktree)[0]!)).toBe(false);
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
    expect(fabric.calls.map((call) => call.tool)).toEqual(["claim_next"]);
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
