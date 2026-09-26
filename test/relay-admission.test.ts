// Chicago-style tests for src/relay-admission.ts: real temp dirs, real JSON
// state files, real child processes for the "spawn" consequence. No test
// doubles.

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "bun:test";

import {
  ADMISSION_ORDER,
  KNOWN_REPLAY,
  RELAY_CHANNELS,
  RELAY_CONTRACT,
  RELAY_CONTRACT_VERSION,
  RELAY_ENVELOPE_REQUIRED,
  RELAY_ENVELOPE_SCHEMA,
  RELAY_OCEL_IDENTITY_ENV,
  RELAY_REFUSALS,
  RelayStateError,
  RelayWorker,
  dispatchRelayCommand,
  localAllowDoFromEnv,
  relayIdentityEnv,
  relayStatePath,
  type AdmissionResult,
  type RelayLeaseDescriptor,
  type RelayRefusal
} from "../src/relay-admission.ts";

const execFileAsync = promisify(execFile);

// Vendored byte-identical from xaas priv/ultracode/remote-relay.contract.json
// at 9820fe3bfe2cf0fecd2b13b598681cd1ec3b094f (git blob cf5e0bb0).
const contractPath = new URL("./fixtures/xaas-remote-relay.contract.json", import.meta.url).pathname;
const contractSha256 = "76ff551c16cea5afb40b385ecee9ab7462ce1d73bee47655c0e0c63dc0a33f89";
const contractText = readFileSync(contractPath, "utf8");
const contract = JSON.parse(contractText) as {
  contract: string;
  contract_version: number;
  envelope_schema: string;
  envelope: { required: string[]; channels: string[] };
  gall_work_binding: Record<string, string>;
  ocel_identity_env: string[];
  admission_order: string[];
  refusals: string[];
};

const manifest = "sha256:" + "c".repeat(64);
const descriptor: RelayLeaseDescriptor & Record<string, unknown> = {
  schema: "gall.work-lease/1",
  work_order_iri: "urn:gall:work-order:xaas:relay-001",
  checkpoint_iri: "urn:gall:checkpoint:xaas:relay-001",
  graph_digest: "sha256:" + "a".repeat(64),
  repository_identity: "seanchatmangpt/xaas",
  base_sha: "b".repeat(40),
  epoch_id: "123e4567-e89b-42d3-a456-426614174000",
  worker_id: "zcode-worker-01",
  worktree: "/tmp/relay-worktree"
};

function envelope(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    command_id: "cmd-1",
    epoch_id: descriptor.epoch_id,
    task_id: descriptor.work_order_iri,
    sequence: 1,
    intent_digest: descriptor.graph_digest,
    exact_subject: `${descriptor.repository_identity}@${descriptor.base_sha}`,
    verb: "construct",
    execution_manifest_digest: manifest,
    channel: "control",
    ...overrides
  };
}

const dirs: string[] = [];
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "relay-admission-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function worker(dir: string, extra: Partial<ConstructorParameters<typeof RelayWorker>[0]> = {}): RelayWorker {
  return new RelayWorker({ descriptor, executionManifestDigest: manifest, stateDir: dir, now: () => 1_000_000, ...extra });
}

function refusalOf(result: AdmissionResult): RelayRefusal | typeof KNOWN_REPLAY | "ADMITTED" {
  if (result.outcome === "refused") return result.refusal;
  if (result.outcome === "known_replay") return result.code;
  return "ADMITTED";
}

// A real consequence: a child process that appends one line per spawn.
async function spawnConsequence(ledger: string, commandId: string): Promise<string> {
  await execFileAsync(process.execPath, [
    "-e",
    `require("node:fs").appendFileSync(${JSON.stringify(ledger)}, ${JSON.stringify(commandId + "\n")})`
  ]);
  return `receipt:${commandId}`;
}
function spawnCount(ledger: string): number {
  return existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n").filter(Boolean).length : 0;
}

describe("vendored xaas-remote-relay contract", () => {
  test("bytes are the pinned digest of xaas 9820fe3b", () => {
    expect(createHash("sha256").update(contractText).digest("hex")).toBe(contractSha256);
  });

  test("module vocabulary equals the contract vocabulary exactly", () => {
    expect(contract.contract).toBe(RELAY_CONTRACT);
    expect(contract.contract_version).toBe(RELAY_CONTRACT_VERSION);
    expect(contract.envelope_schema).toBe(RELAY_ENVELOPE_SCHEMA);
    expect<string[]>([...ADMISSION_ORDER]).toEqual(contract.admission_order);
    expect<string[]>([...RELAY_REFUSALS]).toEqual(contract.refusals);
    expect<string[]>([...RELAY_ENVELOPE_REQUIRED]).toEqual(contract.envelope.required);
    expect<string[]>([...RELAY_CHANNELS]).toEqual(contract.envelope.channels);
    expect<string[]>([...RELAY_OCEL_IDENTITY_ENV]).toEqual(contract.ocel_identity_env);
    expect(contract.gall_work_binding.payload_schema).toBe("gall.work-lease/1");
    expect(contract.gall_work_binding.local_do_ack).toContain("authority_ref is necessary but not sufficient");
  });

  test("relayIdentityEnv carries exactly the contract ocel_identity_env keys", () => {
    const env = relayIdentityEnv(descriptor);
    expect(Object.keys(env).sort()).toEqual([...contract.ocel_identity_env].sort());
    expect(env.XAAS_WORK_ORDER_IRI).toBe(descriptor.work_order_iri);
    expect(env.XAAS_BASE_SHA).toBe(descriptor.base_sha);
  });
});

describe("every contract refusal is reachable", () => {
  // One scenario per refusal. Each runs on a fresh real state dir.
  const scenarios: Record<RelayRefusal, (dir: string) => AdmissionResult> = {
    INVALID_ENVELOPE: (dir) => worker(dir).admit(envelope({ command_id: "" })),
    INVALID_SEQUENCE: (dir) => worker(dir).admit(envelope({ sequence: 0 })),
    INVALID_CHANNEL: (dir) => worker(dir).admit(envelope({ channel: "broadcast" })),
    COMMAND_EXPIRED: (dir) => worker(dir).admit(envelope({ expires_at: 999_999 })),
    EXECUTION_MANIFEST_DRIFT: (dir) => worker(dir).admit(envelope({ execution_manifest_digest: "sha256:" + "d".repeat(64) })),
    AUTHORITY_REF_REQUIRED: (dir) => worker(dir, { allowDo: true }).admit(envelope({ verb: "actuate" })),
    DESCRIPTOR_SCHEMA_MISMATCH: (dir) =>
      new RelayWorker({ descriptor: { ...descriptor, schema: "gall.work-lease/2" }, executionManifestDigest: manifest, stateDir: dir }).admit(envelope()),
    DESCRIPTOR_IDENTITY_MISSING: (dir) =>
      new RelayWorker({ descriptor: { ...descriptor, graph_digest: "" }, executionManifestDigest: manifest, stateDir: dir }).admit(envelope()),
    INTENT_DIGEST_MISMATCH: (dir) => worker(dir).admit(envelope({ intent_digest: "sha256:" + "e".repeat(64) })),
    EXACT_SUBJECT_MISMATCH: (dir) => worker(dir).admit(envelope({ exact_subject: `seanchatmangpt/xaas@${"f".repeat(40)}` })),
    EPOCH_MISMATCH: (dir) => worker(dir).admit(envelope({ epoch_id: "00000000-0000-4000-8000-000000000000" })),
    TASK_MISMATCH: (dir) => worker(dir).admit(envelope({ task_id: "urn:gall:work-order:xaas:other" })),
    SEQUENCE_GAP: (dir) => worker(dir).admit(envelope({ sequence: 3 })),
    EXPLICIT_DO_ACK_REQUIRED: (dir) => worker(dir).admit(envelope({ verb: "actuate", authority_ref: "lease:xaas:grant-7" }))
  };

  test("the scenario table covers every refusal the contract names", () => {
    expect(Object.keys(scenarios).sort()).toEqual([...contract.refusals].sort());
  });

  for (const name of contract.refusals as RelayRefusal[]) {
    test(`${name} is emitted`, () => {
      const result = scenarios[name](stateDir());
      expect(refusalOf(result)).toBe(name);
      if (result.outcome === "refused") {
        expect(result.stages.at(-1)).toBe(result.stage);
        expect(result.detail.length).toBeGreaterThan(0);
      }
    });
  }

  test("a refused envelope writes no durable state", () => {
    const dir = stateDir();
    const w = worker(dir);
    w.admit(envelope({ sequence: 3 }));
    expect(existsSync(w.statePath)).toBe(false);
  });
});

describe("admission_order is honored", () => {
  test("an envelope failing expiry and manifest is refused at expiry (earlier stage)", () => {
    const result = worker(stateDir()).admit(envelope({ expires_at: 1, execution_manifest_digest: "sha256:x" }));
    expect(result).toMatchObject({ outcome: "refused", refusal: "COMMAND_EXPIRED", stage: "expiry" });
  });

  test("manifest drift outranks authority and binding failures", () => {
    const result = worker(stateDir()).admit(
      envelope({ execution_manifest_digest: "sha256:x", verb: "actuate", task_id: "urn:other" })
    );
    expect(result).toMatchObject({ refusal: "EXECUTION_MANIFEST_DRIFT", stage: "execution_manifest" });
  });

  test("authority_shape runs before gall_work_semantic_binding", () => {
    const result = worker(stateDir()).admit(envelope({ verb: "actuate", task_id: "urn:other" }));
    expect(result).toMatchObject({ refusal: "AUTHORITY_REF_REQUIRED", stage: "authority_shape" });
  });

  test("an admitted envelope passes every stage in contract order", () => {
    const result = worker(stateDir()).admit(envelope());
    expect(result).toMatchObject({ outcome: "admitted", retry: false });
    expect(result.stages).toEqual(contract.admission_order as typeof result.stages);
  });

  test("expires_at equal to now is still admissible (inclusive deadline)", () => {
    expect(worker(stateDir()).admit(envelope({ expires_at: 1_000_000 })).outcome).toBe("admitted");
  });

  test("non-integer expires_at is a shape refusal, not a silent pass", () => {
    expect(refusalOf(worker(stateDir()).admit(envelope({ expires_at: "tomorrow" })))).toBe("INVALID_ENVELOPE");
  });

  test("a non-object envelope and a fractional sequence are refused", () => {
    expect(refusalOf(worker(stateDir()).admit(null))).toBe("INVALID_ENVELOPE");
    expect(refusalOf(worker(stateDir()).admit(envelope({ sequence: 1.5 })))).toBe("INVALID_SEQUENCE");
  });
});

describe("local DO ack (authority_ref is necessary, not sufficient)", () => {
  test("verb=actuate with authority_ref but no allow-do is EXPLICIT_DO_ACK_REQUIRED", () => {
    const result = worker(stateDir()).admit(envelope({ verb: "actuate", authority_ref: "lease:grant" }));
    expect(result).toMatchObject({ outcome: "refused", refusal: "EXPLICIT_DO_ACK_REQUIRED", stage: "authority_shape" });
  });

  test("a truthy non-boolean allowDo does not count as an explicit ack", () => {
    const w = worker(stateDir(), { allowDo: "yes" as unknown as boolean });
    expect(refusalOf(w.admit(envelope({ verb: "actuate", authority_ref: "lease:grant" })))).toBe("EXPLICIT_DO_ACK_REQUIRED");
  });

  test("actuate on the observe channel is refused even with allow-do", () => {
    const w = worker(stateDir(), { allowDo: true });
    expect(refusalOf(w.admit(envelope({ verb: "actuate", channel: "observe", authority_ref: "lease:grant" })))).toBe(
      "AUTHORITY_REF_REQUIRED"
    );
  });

  test("authority_ref plus explicit local allow-do admits actuate", () => {
    const w = worker(stateDir(), { allowDo: true });
    expect(w.admit(envelope({ verb: "actuate", authority_ref: "lease:grant" })).outcome).toBe("admitted");
  });

  test("allow-do from env is exactly ZCODE_RELAY_ALLOW_DO=1", () => {
    expect(localAllowDoFromEnv({ ZCODE_RELAY_ALLOW_DO: "1" })).toBe(true);
    expect(localAllowDoFromEnv({ ZCODE_RELAY_ALLOW_DO: "true" })).toBe(false);
    expect(localAllowDoFromEnv({})).toBe(false);
  });
});

describe("durable replay and sequence", () => {
  test("an acknowledged envelope replays as KNOWN_REPLAY with no second spawn", async () => {
    const dir = stateDir();
    const ledger = join(dir, "spawns.log");
    const w = worker(dir);
    const first = await dispatchRelayCommand(w, envelope(), (env) => spawnConsequence(ledger, env.command_id));
    expect(first.outcome).toBe("executed");
    expect(spawnCount(ledger)).toBe(1);

    const again = await dispatchRelayCommand(w, envelope(), (env) => spawnConsequence(ledger, env.command_id));
    expect(again.outcome).toBe("known_replay");
    expect(again.admission).toMatchObject({ code: KNOWN_REPLAY, command_id: "cmd-1" });
    expect(spawnCount(ledger)).toBe(1);
  });

  test("a new command_id reusing an acknowledged sequence is KNOWN_REPLAY, not fresh work", async () => {
    const dir = stateDir();
    const ledger = join(dir, "spawns.log");
    const w = worker(dir);
    await dispatchRelayCommand(w, envelope(), (env) => spawnConsequence(ledger, env.command_id));
    const reuse = await dispatchRelayCommand(w, envelope({ command_id: "cmd-other" }), (env) => spawnConsequence(ledger, env.command_id));
    expect(reuse.outcome).toBe("known_replay");
    expect(spawnCount(ledger)).toBe(1);
  });

  test("a sequence gap after an ack is refused and not spawned", async () => {
    const dir = stateDir();
    const ledger = join(dir, "spawns.log");
    const w = worker(dir);
    await dispatchRelayCommand(w, envelope(), (env) => spawnConsequence(ledger, env.command_id));
    const gap = await dispatchRelayCommand(w, envelope({ command_id: "cmd-3", sequence: 3 }), (env) => spawnConsequence(ledger, env.command_id));
    expect(gap.outcome).toBe("refused");
    expect(refusalOf(gap.admission)).toBe("SEQUENCE_GAP");
    const next = await dispatchRelayCommand(w, envelope({ command_id: "cmd-2", sequence: 2 }), (env) => spawnConsequence(ledger, env.command_id));
    expect(next.outcome).toBe("executed");
    expect(spawnCount(ledger)).toBe(2);
  });

  test("manifest drift is never admitted, even for the next expected sequence", () => {
    const w = worker(stateDir());
    expect(refusalOf(w.admit(envelope({ execution_manifest_digest: "sha256:drift" })))).toBe("EXECUTION_MANIFEST_DRIFT");
    expect(w.snapshot().pending).toBeNull();
  });
});

describe("restart keeps the command identity (real temp dir)", () => {
  test("disconnect before ACK: a restarted worker keeps the pending command_id", async () => {
    const dir = stateDir();
    const ledger = join(dir, "spawns.log");
    const w1 = worker(dir);
    // The execution fails mid-flight (disconnect before ACK): no ack is written.
    await expect(
      dispatchRelayCommand(w1, envelope(), async () => {
        throw new Error("transport closed");
      })
    ).rejects.toThrow("transport closed");
    expect(w1.snapshot().pending?.command_id).toBe("cmd-1");

    const w2 = worker(dir); // restart: fresh process state, same durable file
    expect(w2.statePath).toBe(w1.statePath);
    expect(w2.snapshot().pending?.command_id).toBe("cmd-1");

    // A fresh identity for the pending sequence is refused.
    expect(w2.admit(envelope({ command_id: "cmd-fresh" }))).toMatchObject({ outcome: "refused", refusal: "INVALID_SEQUENCE" });
    // A retry with a drifted semantic identity is refused.
    expect(refusalOf(new RelayWorker({
      descriptor: { ...descriptor, graph_digest: "sha256:" + "9".repeat(64) },
      executionManifestDigest: manifest,
      stateDir: dir
    }).admit(envelope({ intent_digest: "sha256:" + "9".repeat(64) })))).toBe("INTENT_DIGEST_MISMATCH");

    // The same command_id is the same command: admitted as a retry, then acked.
    const retry = await dispatchRelayCommand(w2, envelope(), (env) => spawnConsequence(ledger, env.command_id));
    expect(retry.outcome).toBe("executed");
    expect(retry.admission).toMatchObject({ outcome: "admitted", retry: true, command_id: "cmd-1" });
    expect(spawnCount(ledger)).toBe(1);

    const w3 = worker(dir); // restart after ACK
    expect(w3.snapshot().last_acknowledged_sequence).toBe(1);
    expect(w3.snapshot().acknowledged[0]).toMatchObject({ command_id: "cmd-1", receipt_ref: "receipt:cmd-1" });
    expect(refusalOf(w3.admit(envelope()))).toBe(KNOWN_REPLAY);
    expect(spawnCount(ledger)).toBe(1);
  });

  test("state lives under the given lease state dir, keyed by worktree and epoch", () => {
    const dir = stateDir();
    const w = worker(dir);
    w.admit(envelope());
    expect(w.statePath).toBe(relayStatePath(dir, descriptor.worktree, descriptor.epoch_id));
    expect(w.statePath.startsWith(dir)).toBe(true);
    const onDisk = JSON.parse(readFileSync(w.statePath, "utf8")) as { schema: string; pending: { command_id: string } };
    expect(onDisk.schema).toBe("zcode.relay-ack-state/1");
    expect(onDisk.pending.command_id).toBe("cmd-1");
    expect(relayStatePath(dir, descriptor.worktree, "00000000-0000-4000-8000-000000000000")).not.toBe(w.statePath);
  });

  test("a corrupt state file fails closed instead of resetting the sequence", () => {
    const dir = stateDir();
    const w = worker(dir);
    w.admit(envelope());
    expect(w.acknowledge("cmd-1").ok).toBe(true);
    writeFileSync(w.statePath, "{ not json");
    expect(() => worker(dir)).toThrow(RelayStateError);
  });

  test("acknowledge refuses a command that was never admitted", () => {
    const w = worker(stateDir());
    expect(w.acknowledge("cmd-ghost")).toMatchObject({ ok: false, code: "ACK_WITHOUT_ADMISSION" });
    expect(w.snapshot().last_acknowledged_sequence).toBe(0);
  });
});
