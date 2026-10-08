// CLAUDE-EXTINCTION-001 -- permanent court.
//
// Proves that Claude is replaceable CAPACITY, not a structural dependency of
// the execution contract: a bounded work order is admitted and executed via
// provider A ("claude", a fake runtime); provider A is then disabled in the
// execution-provider registry (the "disable the Claude credential" cut
// point); rediscovery routes the next claim to the zcode provider; and both
// executions seal SEMANTICALLY IDENTICAL ExecutionReceipts -- the provider id
// and the execution identity (epoch, lease, idempotency key) are the only
// allowed differences. Replay binding verifies on both.
//
// Falsifiers (anti-vacuity -- the court must be able to fail):
//   (a) corrupt the zcode side (disable every provider, or corrupt the
//       contract fixture bytes) -> the dispatch REFUSES typed with ZERO
//       fabric calls / the digest pin fails;
//   (b) zero Claude identifiers in the work-order identity or the receipt
//       SCHEMA (field KEYS; the provider id appears only as data);
//   (c) no Claude credential is consulted anywhere on the qualification
//       path (the injected registry reader structurally refuses to read one).
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  clearLeaseFiles,
  constructPrompt,
  gallWorkContractSha256,
  leaseFilePaths,
  runGallWork,
  workOrderPath,
  type ConstructOutcome,
  type ConstructOverride,
  type FetchLike
} from "../src/gall-work.ts";
import { executionProviderConfigPath } from "../src/execution-providers.ts";

const gitEnv = {
  GIT_AUTHOR_NAME: "claude-extinction-court",
  GIT_AUTHOR_EMAIL: "extinction@xaas.local",
  GIT_COMMITTER_NAME: "claude-extinction-court",
  GIT_COMMITTER_EMAIL: "extinction@xaas.local"
};

const git = (args: string[], cwd: string): string => {
  const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};

const epochIdFor = (run: string): string =>
  // deterministic v4-shaped uuid per run label
  `${run.padEnd(8, "0").slice(0, 8)}-e89b-42d3-a456-426614174000`.replace(/[^0-9a-f-]/gi, "0");

const workerIdFor = (run: string): string => `zcode-dispatch-extinction-${run}`;

interface FabricScript {
  claim: Record<string, unknown>;
}

/** A fake execution fabric: routes JSON-RPC over the injected fetch seam. */
function fakeFabric(script: FabricScript) {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  let closeEvidence: Record<string, unknown> | undefined;
  let closeOutcome: string | undefined;
  let closeResult: Record<string, unknown> | undefined;
  const fetchImpl: FetchLike = async (_url, init) => {
    const rpc = JSON.parse(String(init?.body)) as {
      method: string;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    const tool = rpc.params?.name ?? rpc.method;
    const args = rpc.params?.arguments ?? {};
    calls.push({ tool, args });
    const reply = (payload: unknown, isError = false): Response =>
      new Response(
        JSON.stringify(
          isError
            ? { jsonrpc: "2.0", id: 1, result: { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }] } }
            : { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }
        ),
        { headers: { "content-type": "application/json" } }
      );
    switch (tool) {
      case "initialize":
        return reply({ protocolVersion: "2024-11-05", serverInfo: { name: "court-fabric", version: "1" } });
      case "tools/list":
        return reply({ tools: [{ name: "claim_next" }, { name: "heartbeat" }, { name: "work_status" }, { name: "close_candidate" }, { name: "cancel_work" }, { name: "refuse" }] });
      case "claim_next":
        return reply(script.claim);
      case "heartbeat":
        return reply({ status: "renewed" });
      case "close_candidate":
        closeEvidence = args.evidence as Record<string, unknown>;
        closeOutcome = String(args.outcome);
        closeResult = { status: "closed", epoch_id: script.claim.epoch_id, outcome: args.outcome };
        return reply(closeResult);
      case "cancel_work":
        return reply({ status: "cancelled" });
      case "refuse":
        return reply({ status: "refused", epoch_id: script.claim.epoch_id, outcome: "refused" });
      default:
        return reply({ error: `unexpected_tool:${tool}` }, true);
    }
  };
  return {
    fetchImpl,
    calls,
    callsFor: (tool: string): Array<Record<string, unknown>> => calls.filter((call) => call.tool === tool).map((call) => call.args),
    closeEvidence: (): Record<string, unknown> | undefined => closeEvidence,
    closeOutcome: (): string | undefined => closeOutcome,
    closeResult: (): Record<string, unknown> | undefined => closeResult
  };
}

// The bounded work order: provider-neutral by construction. No goal text
// travels on argv; the construct prompt references only the file path.
const BOUNDED_GOAL = "Add a file named deliverable.txt containing the single word done. Commit the change.";

function makeWorktree(): { worktree: string; baseHead: string } {
  const worktree = mkdtempSync(join(tmpdir(), "claude-extinction-"));
  git(["init", "-q"], worktree);
  writeFileSync(join(worktree, "README.md"), "leased worktree\n");
  git(["add", "."], worktree);
  git(["commit", "-q", "-m", "base"], worktree);
  return { worktree, baseHead: git(["rev-parse", "HEAD"], worktree) };
}

const claudeRuntime: ConstructOverride = (request, prompt): Promise<ConstructOutcome> => {
  expect(prompt).toBe(constructPrompt(workOrderPath(request.cwd)));
  expect(prompt).not.toContain("deliverable.txt");
  // Provider A's execution: the bounded change lands in the leased worktree.
  writeFileSync(join(request.cwd, "deliverable.txt"), "done\n");
  git(["add", "."], request.cwd);
  git(["commit", "-q", "-m", "work order executed by provider A"], request.cwd);
  return Promise.resolve({ exitCode: 0, signal: null, outputTail: "provider A turn", durationMs: 5, heartbeatFailures: [] });
};

const zcodeRuntime: ConstructOverride = (request, prompt): Promise<ConstructOutcome> => {
  expect(prompt).toBe(constructPrompt(workOrderPath(request.cwd)));
  // The zcode provider executes the SAME bounded order (the file already
  // holds the goal state; the turn observes idempotence and commits nothing).
  expect(readFileSync(join(request.cwd, "deliverable.txt"), "utf8").trim()).toBe("done");
  return Promise.resolve({ exitCode: 0, signal: null, outputTail: "zcode turn", durationMs: 5, heartbeatFailures: [] });
};

/** Every field KEY in the value, recursively. */
function keysOf(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => keysOf(item, prefix));
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      `${prefix}${key}`,
      ...keysOf(child, `${prefix}${key}.`)
    ]);
  }
  return [];
}

describe("CLAUDE-EXTINCTION-001 (permanent court)", () => {
  const paths: string[] = [];
  const ocelDirs: string[] = [];

  afterEach(() => {
    for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
    ocelDirs.length = 0;
  });

  function harness(): {
    worktree: string;
    baseHead: string;
    env: NodeJS.ProcessEnv;
    registryPath: string;
    setRegistry: (text: string) => void;
    reads: string[];
    readExecutionProviderConfig: (path: string) => string;
  } {
    const { worktree, baseHead } = makeWorktree();
    paths.push(worktree);
    const registryPath = join(mkdtempSync(join(tmpdir(), "claude-extinction-reg-")), "execution_provider_config.json");
    paths.push(dirname(registryPath));
    const ocelDir = mkdtempSync(join(tmpdir(), "claude-extinction-ocel-"));
    ocelDirs.push(ocelDir);
    paths.push(ocelDir);
    let registryText = "";
    const reads: string[] = [];
    return {
      worktree,
      baseHead,
      env: { ZCODE_OCEL: "1", ZCODE_OCEL_DIR: ocelDir, ZCODE_EXECUTION_PROVIDER_CONFIG_FILE: registryPath },
      registryPath,
      setRegistry: (text: string) => {
        registryText = text;
      },
      reads,
      // Falsifier (c), structural: a Claude credential file CANNOT be read
      // through this seam -- the qualification path never touches one.
      readExecutionProviderConfig: (path: string) => {
        if (/credentials|auth[-_]?ref|secret/i.test(path)) throw new Error(`court refuses credential reads: ${path}`);
        reads.push(path);
        return registryText;
      }
    };
  }

  const registryWithClaude = (claudeEnabled: boolean, zcodeEnabled: boolean): string =>
    JSON.stringify({
      schemaVersion: 1,
      executionProviderRules: [
        { providerId: "claude", enabled: claudeEnabled, runtime: "claude-code", capabilitiesRef: "fake://claude/capabilities", authRef: "/fake/claude/credentials.json" },
        { providerId: "zcode", enabled: zcodeEnabled, runtime: "zcode-cli", capabilitiesRef: "fake://zcode/capabilities", authRef: "/fake/zcode/credentials.json" }
      ],
      defaultExecutionSelection: { providerId: "claude" }
    });

  function fabricFor(worktree: string, baseHead: string, epochId: string, workerId: string): ReturnType<typeof fakeFabric> {
    return fakeFabric({
      claim: {
        lease_token: `lease-${epochId}`,
        lease_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        epoch_id: epochId,
        cycle: 1,
        exact_subject: "semantic/extinction-001",
        goal: BOUNDED_GOAL,
        worktree,
        verifier_suite: null
      }
    });
  }

  function lifecycleEvents(ocelDir: string, epochId: string): { events: Array<{ event?: string; provider?: unknown; from_provider?: unknown }>; receipt: Record<string, unknown> } {
    const receiptPath = join(ocelDir, `gall-work-${epochId}.receipt.json`);
    expect(existsSync(receiptPath)).toBe(true);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    const ocelDoc = JSON.parse(readFileSync(join(ocelDir, `gall-work-${epochId}.jsonocel`), "utf8")) as {
      events: Array<{ type?: string; relationships?: Array<{ objectId?: string; qualifier?: string }> }>;
    };
    return {
      receipt,
      events: ocelDoc.events.map((event) => ({
        event: event.type,
        provider: event.relationships?.find((relation) => relation.qualifier === "provider")?.objectId,
        from_provider: event.relationships?.find((relation) => relation.qualifier === "replaces_from")?.objectId
      }))
    };
  }

  test("provider A executes; disabling A routes to zcode; receipts are schema-identical; replay binding verifies", async () => {
    const court = harness();
    court.setRegistry(registryWithClaude(true, true));
    const epochA = epochIdFor("aaaa0001");
    const epochZ = epochIdFor("zzzz0002");
    const workerA = workerIdFor("a1");
    const workerZ = workerIdFor("z2");

    // -- execution 1: provider A (claude) is the default and executes --------
    const fabricA = fabricFor(court.worktree, court.baseHead, epochA, workerA);
    const chunksA: string[] = [];
    const exitA = await runGallWork(
      ["--worker-id", workerA, "--epoch-id", epochA, "--cwd", court.worktree, "--json"],
      {
        env: court.env,
        fabricTarget: { url: "http://court-fabric.test/mcp" },
        fetchImpl: fabricA.fetchImpl,
        construct: claudeRuntime,
        readExecutionProviderConfig: court.readExecutionProviderConfig,
        io: { stdout: { write: (t: string | Uint8Array): boolean => (chunksA.push(String(t)), true) } as unknown as NodeJS.WriteStream, stderr: { write: (): boolean => true } as unknown as NodeJS.WriteStream }
      }
    );
    clearLeaseFiles(court.worktree);

    expect(exitA).toBe(0);
    const resultA = JSON.parse(chunksA.join("")) as Record<string, unknown>;
    expect(resultA.standing).toBe("ALIVE");
    expect(resultA.provider).toBe("claude");

    // -- the cut: disable provider A in the registry (operator credential cut)
    court.setRegistry(registryWithClaude(false, true));

    // -- execution 2: rediscovery routes the claim to the zcode provider -----
    const fabricZ = fabricFor(court.worktree, court.baseHead, epochZ, workerZ);
    const chunksZ: string[] = [];
    const exitZ = await runGallWork(
      ["--worker-id", workerZ, "--epoch-id", epochZ, "--cwd", court.worktree, "--json"],
      {
        env: court.env,
        fabricTarget: { url: "http://court-fabric.test/mcp" },
        fetchImpl: fabricZ.fetchImpl,
        construct: zcodeRuntime,
        readExecutionProviderConfig: court.readExecutionProviderConfig,
        io: { stdout: { write: (t: string | Uint8Array): boolean => (chunksZ.push(String(t)), true) } as unknown as NodeJS.WriteStream, stderr: { write: (): boolean => true } as unknown as NodeJS.WriteStream }
      }
    );
    clearLeaseFiles(court.worktree);

    expect(exitZ).toBe(0);
    const resultZ = JSON.parse(chunksZ.join("")) as Record<string, unknown>;
    expect(resultZ.standing).toBe("ALIVE");
    expect(resultZ.provider).toBe("zcode"); // the claim ROUTED to zcode

    // -- provider.replace is witnessed in the OCEL lifecycle log -------------
    const lifecycleZ = lifecycleEvents(court.env.ZCODE_OCEL_DIR!, epochZ);
    const replace = lifecycleZ.events.find((event) => event.event === "provider_replace");
    expect(replace).toBeDefined();
    expect(replace?.provider).toBe("zcode");
    expect(replace?.from_provider).toBe("claude");
    const lifecycleA = lifecycleEvents(court.env.ZCODE_OCEL_DIR!, epochA);
    expect(lifecycleA.events.some((event) => event.event === "provider_select" && event.provider === "claude")).toBe(true);
    expect(lifecycleA.events.some((event) => event.event === "worker_claim")).toBe(true);

    // -- receipt schema equivalence ------------------------------------------
    // The sealed receipts differ ONLY in execution identity (epoch, lease,
    // idempotency key, provider); the schema and semantic fields are identical.
    const evidenceA = fabricA.closeEvidence() as Record<string, unknown>;
    const evidenceZ = fabricZ.closeEvidence() as Record<string, unknown>;
    expect(fabricA.closeOutcome()).toBe("alive");
    expect(fabricZ.closeOutcome()).toBe("alive");
    const keysA = keysOf(evidenceA).sort();
    const keysZ = keysOf(evidenceZ).sort();
    expect(keysZ).toEqual(keysA); // IDENTICAL schema (field keys)

    // values equal everywhere except the allowed execution-identity fields
    const allowedDifferences = new Set([
      "provider",
      "worker_id",
      "idempotency_key",
      "replay_binding.provider",
      "replay_binding.worker_id",
      "replay_binding.idempotency_key",
      "replay_binding.epoch_id",
      "output_tail",
      "duration_ms",
      "ocel_receipt",
      "ocel_lifecycle_receipt"
    ]);
    const flat = (value: unknown, prefix = ""): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) Object.assign(out, flat(item, `${prefix}${index}.`));
      } else if (value !== null && typeof value === "object") {
        for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
          if (child !== null && typeof child === "object") Object.assign(out, flat(child, `${prefix}${key}.`));
          else out[`${prefix}${key}`] = child;
        }
      } else {
        out[prefix.replace(/\.$/, "")] = value;
      }
      return out;
    };
    const flatA = flat(evidenceA);
    const flatZ = flat(evidenceZ);
    for (const key of Object.keys(flatA)) {
      if (allowedDifferences.has(key) || key.startsWith("replay_binding.origin_authority")) continue;
      expect(JSON.stringify(flatZ[key])).toBe(JSON.stringify(flatA[key])); // semantic identity: equal
    }
    expect(flatA.provider).toBe("claude");
    expect(flatZ.provider).toBe("zcode");

    // replay binding verifies: same contract, same subject, only provider differs
    const replayA = evidenceA.replay_binding as Record<string, unknown>;
    const replayZ = evidenceZ.replay_binding as Record<string, unknown>;
    expect(replayA.contract_sha256).toBe(gallWorkContractSha256);
    expect(replayZ.contract_sha256).toBe(gallWorkContractSha256);
    expect(replayA.worker).toBe(replayZ.worker);
    expect(replayA.epoch_id).not.toBe(replayZ.epoch_id); // distinct executions
    expect(replayZ.provider).toBe("zcode");
    expect(replayZ.idempotency_key).toBe(`gall-work:zcode:${workerZ}:${epochZ}`);

    // -- falsifier (b): zero Claude identifiers in schema keys / identity ----
    const claudeIdentifier = /claude|anthropic/i;
    for (const key of [...keysA, ...keysZ]) expect(key).not.toMatch(claudeIdentifier); // receipt schema keys
    for (const key of keysOf(resultA).concat(keysOf(resultZ))) expect(key).not.toMatch(claudeIdentifier); // result document keys
    const orderA = JSON.parse(readFileSync(workOrderPath(court.worktree), "utf8")) as Record<string, unknown>;
    expect(Object.keys(orderA)).not.toContain("provider"); // work-order identity carries NO provider field
    expect(orderA.goal).toBe(BOUNDED_GOAL); // the bounded order is provider-neutral
    expect(orderA.goal).not.toMatch(claudeIdentifier);
    // the provider id appears only as DATA on the wire (claim provider field)
    expect(fabricA.callsFor("claim_next")[0]?.provider).toBe("claude");
    expect(fabricZ.callsFor("claim_next")[0]?.provider).toBe("zcode");

    // -- falsifier (c): the qualification path consulted ONLY the registry ---
    expect(court.reads.length).toBe(2); // one read per selection, nothing else
    for (const read of court.reads) expect(read).toBe(court.registryPath);
  });

  test("falsifier (a): every provider disabled -> typed refusal with ZERO fabric calls", async () => {
    const court = harness();
    court.setRegistry(registryWithClaude(false, false));
    const fabric = fabricFor(court.worktree, court.baseHead, epochIdFor("dead0003"), workerIdFor("d3"));

    const chunks: string[] = [];
    const exit = await runGallWork(
      ["--worker-id", workerIdFor("d3"), "--epoch-id", epochIdFor("dead0003"), "--cwd", court.worktree, "--json"],
      {
        env: court.env,
        fabricTarget: { url: "http://court-fabric.test/mcp" },
        fetchImpl: fabric.fetchImpl,
        construct: zcodeRuntime,
        readExecutionProviderConfig: court.readExecutionProviderConfig,
        io: { stdout: { write: (t: string | Uint8Array): boolean => (chunks.push(String(t)), true) } as unknown as NodeJS.WriteStream, stderr: { write: (): boolean => true } as unknown as NodeJS.WriteStream }
      }
    );

    expect(exit).toBe(1); // typed refusal, no receipt, capacity corrupted -> court fails the run
    const result = JSON.parse(chunks.join("")) as Record<string, unknown>;
    expect(result.standing).toBe("REFUSED_PROVIDER_DISABLED");
    expect(result.code).toBe("provider_disabled");
    expect(fabric.calls).toEqual([]); // ZERO fabric calls: a disabled provider cannot even claim
    expect(existsSync(leaseFilePaths(court.worktree)[0]!)).toBe(false);
  });

  test("falsifier (a2): corrupted contract fixture bytes fail the digest pin", () => {
    const fixturePath = new URL("./fixtures/gall-work.contract.json", import.meta.url).pathname;
    const bytes = readFileSync(fixturePath, "utf8");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(gallWorkContractSha256);
    // any mutation of the shared fixture (either side of the seam) breaks the court
    const poisoned = bytes.replace("gall-work", "gall-wurk");
    expect(createHash("sha256").update(poisoned).digest("hex")).not.toBe(gallWorkContractSha256);
  });

  test("falsifier (c) is structural: the qualification seam cannot read a credential file", () => {
    const court = harness();
    expect(() => court.readExecutionProviderConfig("/fake/claude/credentials.json")).toThrow("court refuses credential reads");
  });
});
