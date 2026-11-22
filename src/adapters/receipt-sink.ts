/**
 * Honest standing, machine exit codes, dual-receipt egress (ledger + loop_receipt + optional DFCM / ALOOP v2).
 *
 * When `aloop` provenance is supplied (via `CycleCloseInput.aloop` or `ReceiptSinkOptions.aloop`),
 * `ReceiptSink` emits a schema-valid Chatman-5 / ALOOP v2 receipt
 * (`https://chatmangpt.com/schema/receipt/v2`) admitted by `~/.zcode/dfcm/validate_receipt.py`.
 *
 * Honesty boundary — without `aloop` provenance, `writeDfcmReceipt` emits schema
 * `zcode.dfcm.receipt/1`, a cycle-close STUB (admit:false / non_admit:true).
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import type { ExitCode, Standing, TransitionReceipt } from "./types.ts";
import { standingFromExit, worstExitCode } from "./types.ts";

export type AloopAuthorityCeiling = "OBSERVE" | "SELECT" | "CONSTRUCT" | "DO";

export type ChatmanBrokenTerm =
  | "mu_on_O"
  | "admission_vacuous"
  | "mu_unlawful"
  | "R_missing_identity"
  | "R_missing_authority"
  | "R_missing_consequence"
  | "R_missing_replay"
  | "R_missing_standing"
  | "R_not_fed_back";

export interface AloopReplayCommand {
  cmd: string;
  exit: number;
  cwd?: string;
  summary?: string;
  outputSha256?: string;
}

export interface AloopV2Provenance {
  workOrderId: string;
  originAuthority: {
    ceiling?: AloopAuthorityCeiling;
    grant: string;
    actor: string;
  };
  provider: {
    name: string;
    transport?: string;
    authorityCeiling?: AloopAuthorityCeiling;
    receiptProtocol?: string;
    concurrency?: string;
  };
  providerExecutionId: string;
  authority?: {
    ceiling: AloopAuthorityCeiling;
    grant: string;
    actor: string;
    lease?: {
      id: string;
      epoch: string;
      expiry?: string;
      ceiling?: AloopAuthorityCeiling;
    };
  };
  subject?: string;
  repo?: string;
  baseSha?: string;
  commits?: string[];
  filesChanged?: string[];
  remoteEffects?: string[];
  replayCommands?: AloopReplayCommand[];
  durableLocation?: string;
  brokenTerm?: ChatmanBrokenTerm;
  providerExt?: Record<string, unknown>;
}

export interface ReceiptSinkOptions {
  ledgerPath: string;
  outDir: string;
  /** Optional path to DFCM receipt schema / sink (~/.zcode/dfcm/...). */
  dfcmReceiptPath?: string;
  /** Optional ALOOP v2 provenance; when present, `dfcmReceiptPath` emits Chatman-5 / ALOOP v2. */
  aloop?: AloopV2Provenance;
  enforceTwinParity?: boolean;
  twinParitySelfTestCmd?: string[];
  cwd?: string;
}

export interface CycleCloseInput {
  cycleId: string;
  startedAt: string;
  /** Optional deterministic finish timestamp; defaults to `startedAt` for byte-identical replay. */
  finishedAt?: string;
  receipts: TransitionReceipt[];
  twinParity?: Record<string, string>;
  /** Optional ALOOP v2 provenance; overrides `ReceiptSinkOptions.aloop` for this cycle. */
  aloop?: AloopV2Provenance;
  /** Missing live secrets / AS-01 seals → BLOCKED, never ALIVE. */
  blocked?: boolean;
  sandbox?: boolean;
  unverified?: boolean;
}

export interface CycleCloseResult {
  aggregateStanding: Standing;
  exitCode: ExitCode;
  loopReceiptPath: string;
  ledgerPath: string;
  dfcmPath?: string;
}

export class ReceiptSink {
  readonly name = "receipt-sink";
  constructor(private readonly opts: ReceiptSinkOptions) {}

  /**
   * Anti-fake-ALIVE: compose court exit codes + sandbox/seal flags into honest standing.
   */
  resolveStanding(
    courtExit: ExitCode,
    flags: { sandbox?: boolean; unverified?: boolean; blocked?: boolean } = {}
  ): Standing {
    return standingFromExit(courtExit, flags);
  }

  closeCycle(input: CycleCloseInput): CycleCloseResult {
    if (this.opts.enforceTwinParity) {
      const cmd = this.opts.twinParitySelfTestCmd;
      // Opt-in fail-closed: missing twin cmd must not silently skip parity.
      if (!cmd?.length) {
        input = {
          ...input,
          unverified: true,
          twinParity: { ...(input.twinParity ?? {}), hands_free: "FAILED" }
        };
      } else {
        const r = spawnSync(cmd[0]!, cmd.slice(1), {
          cwd: this.opts.cwd,
          encoding: "utf8",
          env: process.env
        });
        if (r.status !== 0) {
          input = {
            ...input,
            unverified: true,
            twinParity: { ...(input.twinParity ?? {}), hands_free: "FAILED" }
          };
        } else {
          input = {
            ...input,
            twinParity: { ...(input.twinParity ?? {}), hands_free: "self-test-ok" }
          };
        }
      }
    }

    const standings = input.receipts.map((r) => {
      if (input.blocked) return "BLOCKED" as Standing;
      if (input.sandbox && r.standing === "ALIVE") return "PARTIAL_ALIVE";
      if (input.unverified && r.standing === "ALIVE") return "UNVERIFIED";
      return r.standing;
    });

    const aggregate = aggregateStanding(standings);
    const exitCode = exitCodeForStanding(aggregate);

    const finishedAt = input.finishedAt ?? input.startedAt;

    mkdirSync(dirname(this.opts.ledgerPath), { recursive: true });
    for (let i = 0; i < input.receipts.length; i++) {
      const r = input.receipts[i]!;
      const line = {
        ts: finishedAt,
        cycleId: input.cycleId,
        workOrderId: r.workOrderId,
        outcome: r.outcome,
        standing: standings[i],
        sha256Receipt: r.sha256Receipt,
        detail: r.detail,
        baseSha: r.baseSha,
        ocelSha256: r.ocelSha256
      };
      appendFileSync(this.opts.ledgerPath, `${JSON.stringify(line)}\n`);
    }

    mkdirSync(this.opts.outDir, { recursive: true });
    const loopReceiptPath = join(this.opts.outDir, "loop_receipt.json");
    const loopReceipt = {
      schema: "zcode.sjira.loop_receipt/1",
      cycleId: input.cycleId,
      startedAt: input.startedAt,
      finishedAt,
      twinParity: input.twinParity,
      outcomes: input.receipts.map((r, i) => ({
        workOrderId: r.workOrderId,
        outcome: r.outcome,
        standing: standings[i],
        sha256Receipt: r.sha256Receipt
      })),
      aggregateStanding: aggregate,
      exitCode
    };
    writeFileSync(loopReceiptPath, `${JSON.stringify(loopReceipt, null, 2)}\n`);

    let dfcmPath: string | undefined;
    if (this.opts.dfcmReceiptPath) {
      const aloop = input.aloop ?? this.opts.aloop;
      dfcmPath = aloop
        ? this.writeAloopV2Receipt(input, aggregate, exitCode, aloop)
        : this.writeDfcmReceipt(input, aggregate, exitCode);
    }

    return {
      aggregateStanding: aggregate,
      exitCode,
      loopReceiptPath,
      ledgerPath: this.opts.ledgerPath,
      dfcmPath
    };
  }

  /**
   * Fail-closed cycle-close stub (`zcode.dfcm.receipt/1`).
   * Populates consequence and replay.commands from transition receipts and
   * fails closed if git HEAD cannot be resolved (R_missing_identity).
   * Still emits admit:false / non_admit:true — not Chatman-5 / ALOOP v2.
   */
  writeDfcmReceipt(input: CycleCloseInput, standing: Standing, exitCode: ExitCode): string {
    const path = this.opts.dfcmReceiptPath!;
    const cwd = this.opts.cwd ?? process.cwd();
    const head = gitHead(cwd);
    if (!head) {
      throw new Error(
        `R_missing_identity: failed to resolve 40-char git HEAD in ${cwd}; refusing to emit DFCM receipt with UNKNOWN subject_sha`
      );
    }
    mkdirSync(dirname(path), { recursive: true });
    const loopReceiptPath = join(this.opts.outDir, "loop_receipt.json");
    const consequence = {
      ledger_path: this.opts.ledgerPath,
      loop_receipt_path: loopReceiptPath,
      transition_count: input.receipts.length,
      outcomes: input.receipts.map((r) => ({
        work_order_id: r.workOrderId,
        outcome: r.outcome,
        standing: r.standing,
        sha256_receipt: r.sha256Receipt,
        ...(r.baseSha ? { base_sha: r.baseSha } : {}),
        ...(r.ocelSha256 ? { ocel_sha256: r.ocelSha256 } : {}),
        ...(r.artifactDigests ? { artifact_digests: r.artifactDigests } : {})
      }))
    };
    const replayCommands: string[] = [`git -C ${cwd} rev-parse --verify ${head}`];
    const seenBaseShas = new Set<string>();
    for (const r of input.receipts) {
      if (r.baseSha && /^[0-9a-f]{40}$/i.test(r.baseSha) && !seenBaseShas.has(r.baseSha)) {
        seenBaseShas.add(r.baseSha);
        replayCommands.push(`git -C ${cwd} rev-parse --verify ${r.baseSha}`);
      }
      replayCommands.push(
        `# transition ${r.workOrderId} outcome=${r.outcome} standing=${r.standing} sha256=${r.sha256Receipt}`
      );
    }
    const body = {
      schema: "zcode.dfcm.receipt/1",
      admit: false,
      non_admit: true,
      non_admit_reason:
        "cycle-close stub: missing ALOOP work_order_id/origin_authority/provider/provider_execution_id; not admitted by dfcm validate_receipt",
      subject_sha: head,
      cycle_id: input.cycleId,
      standing,
      exit_code: exitCode,
      authority: "NONE",
      external_do_count: 0,
      consequence,
      replay: {
        cwd,
        subject_sha: head,
        commands: replayCommands
      },
      sha256: ""
    };
    body.sha256 = createHash("sha256")
      .update(JSON.stringify({ ...body, sha256: undefined }))
      .digest("hex");
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
    return path;
  }

  /**
   * Production Chatman-5 / ALOOP v2 receipt writer (`https://chatmangpt.com/schema/receipt/v2`).
   * Deterministic (no wall-clock injection), fail-closed on missing git HEAD or non-zero replay
   * exit under ALIVE standing, and admitted by `~/.zcode/dfcm/validate_receipt.py`.
   */
  writeAloopV2Receipt(
    input: CycleCloseInput,
    standing: Standing,
    _exitCode: ExitCode,
    aloopOverride?: AloopV2Provenance
  ): string {
    const aloop = aloopOverride ?? input.aloop ?? this.opts.aloop;
    if (!aloop) {
      throw new Error(
        "R_missing_authority: ALOOP v2 provenance is required to emit a Chatman-5 / ALOOP v2 receipt"
      );
    }
    const path = this.opts.dfcmReceiptPath;
    if (!path) {
      throw new Error("R_missing_consequence: dfcmReceiptPath must be configured");
    }
    const cwd = aloop.repo ?? this.opts.cwd ?? process.cwd();
    const head = gitHead(cwd);
    if (!head) {
      throw new Error(
        `R_missing_identity: failed to resolve 40-char git HEAD in ${cwd}; refusing to emit ALOOP v2 receipt`
      );
    }
    const firstValidBaseSha = input.receipts.find(
      (r) => r.baseSha && /^[0-9a-f]{40}$/i.test(r.baseSha)
    )?.baseSha;
    const baseSha =
      aloop.baseSha && /^[0-9a-f]{40}$/i.test(aloop.baseSha)
        ? aloop.baseSha
        : firstValidBaseSha ?? head;

    const commands: Array<{
      cmd: string;
      exit: number;
      cwd: string;
      summary?: string;
      output_sha256?: string;
    }> = [];

    if (aloop.replayCommands && aloop.replayCommands.length > 0) {
      for (const c of aloop.replayCommands) {
        commands.push({
          cmd: c.cmd,
          exit: c.exit,
          cwd: c.cwd ?? cwd,
          ...(c.summary !== undefined ? { summary: c.summary } : {}),
          ...(c.outputSha256 !== undefined ? { output_sha256: c.outputSha256 } : {})
        });
      }
    } else {
      commands.push({
        cmd: `git rev-parse --verify ${head}`,
        exit: 0,
        cwd
      });
      if (baseSha !== head) {
        commands.push({
          cmd: `git rev-parse --verify ${baseSha}`,
          exit: 0,
          cwd
        });
      }
    }

    const hasNonZeroReplay = commands.some((c) => c.exit !== 0);
    const standingObj = toAloopStanding(standing, head, commands, hasNonZeroReplay, aloop.brokenTerm);

    const authorityCeiling: AloopAuthorityCeiling =
      aloop.authority?.ceiling ?? aloop.originAuthority.ceiling ?? "CONSTRUCT";

    const providerObj: Record<string, unknown> = {
      name: aloop.provider.name,
      ...(aloop.provider.transport ? { transport: aloop.provider.transport } : {}),
      ...(aloop.provider.authorityCeiling
        ? { authority_ceiling: aloop.provider.authorityCeiling }
        : {}),
      receipt_protocol:
        aloop.provider.receiptProtocol ?? "https://chatmangpt.com/schema/receipt/v2",
      ...(aloop.provider.concurrency ? { concurrency: aloop.provider.concurrency } : {})
    };

    const receipt: Record<string, unknown> = {
      work_order_id: aloop.workOrderId,
      origin_authority: {
        ...(aloop.originAuthority.ceiling ? { ceiling: aloop.originAuthority.ceiling } : {}),
        grant: aloop.originAuthority.grant,
        actor: aloop.originAuthority.actor
      },
      provider: providerObj,
      provider_execution_id: aloop.providerExecutionId,
      identity: {
        subject: aloop.subject ?? aloop.workOrderId,
        repo: cwd,
        subject_sha: head,
        base_sha: baseSha
      },
      authority: {
        ceiling: authorityCeiling,
        grant: aloop.authority?.grant ?? aloop.originAuthority.grant,
        actor: aloop.authority?.actor ?? aloop.originAuthority.actor,
        ...(aloop.authority?.lease ? { lease: aloop.authority.lease } : {})
      },
      consequence: {
        commits: aloop.commits ?? [head],
        files_changed: aloop.filesChanged ?? [],
        remote_effects: aloop.remoteEffects ?? []
      },
      replay: {
        commands,
        durable_location: aloop.durableLocation ?? path
      },
      standing: standingObj
    };

    if (aloop.providerExt) {
      const extNs = sanitizeProviderExtNamespace(aloop.provider.name);
      receipt[extNs] = aloop.providerExt;
    }

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
    return path;
  }
}

function sanitizeProviderExtNamespace(providerName: string): string {
  const clean = providerName
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^[^a-z0-9]+/, "");
  return `provider_ext.${clean || "provider"}`;
}

function toAloopStanding(
  standing: Standing,
  head: string,
  commands: ReadonlyArray<{ cmd: string; exit: number }>,
  hasNonZeroReplay: boolean,
  explicitBrokenTerm?: ChatmanBrokenTerm
): { value: string; derived_from: string; broken_term?: ChatmanBrokenTerm } {
  const cmdList = commands.map((c) => `${c.cmd} (exit=${c.exit})`).join("; ");
  const derivedFrom = `${cmdList} at ${head}`;

  // Anti-vacuity: never emit ALIVE when any replay command exited non-zero.
  if (standing === "ALIVE" && hasNonZeroReplay) {
    return {
      value: "REFUSED(nonzero_replay_exit)",
      derived_from: derivedFrom,
      broken_term: explicitBrokenTerm ?? "admission_vacuous"
    };
  }
  if (standing === "ALIVE") {
    return { value: "ALIVE", derived_from: derivedFrom };
  }
  if (standing === "PARTIAL_ALIVE") {
    return { value: "PARTIAL_ALIVE", derived_from: derivedFrom };
  }
  if (standing === "UNSUPPORTED") {
    return { value: "UNSUPPORTED", derived_from: derivedFrom };
  }
  if (standing === "BLOCKED") {
    return {
      value: "BLOCKED",
      derived_from: derivedFrom,
      broken_term: explicitBrokenTerm ?? "R_missing_authority"
    };
  }
  if (standing === "REFUSED") {
    return {
      value: "REFUSED(cycle_refused)",
      derived_from: derivedFrom,
      broken_term: explicitBrokenTerm ?? "admission_vacuous"
    };
  }
  if (standing === "TIMED_OUT") {
    return {
      value: "REFUSED(timed_out)",
      derived_from: derivedFrom,
      broken_term: explicitBrokenTerm ?? "R_missing_replay"
    };
  }
  // UNKNOWN or UNVERIFIED -> UNKNOWN
  return { value: "UNKNOWN", derived_from: derivedFrom };
}

/** Machine-readable NON-ADMIT gate for cycle-close DFCM stubs. */
export function isDfcmStubNonAdmit(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const r = body as Record<string, unknown>;
  return (
    r.schema === "zcode.dfcm.receipt/1" &&
    r.admit === false &&
    r.non_admit === true
  );
}

export function aggregateStanding(standings: readonly Standing[]): Standing {
  if (standings.length === 0) return "UNKNOWN";
  if (standings.some((s) => s === "REFUSED" || s === "TIMED_OUT")) {
    return standings.find((s) => s === "REFUSED" || s === "TIMED_OUT")!;
  }
  if (standings.some((s) => s === "BLOCKED")) return "BLOCKED";
  if (standings.some((s) => s === "PARTIAL_ALIVE")) return "PARTIAL_ALIVE";
  if (standings.some((s) => s === "UNVERIFIED")) return "UNVERIFIED";
  if (standings.some((s) => s === "UNSUPPORTED")) return "UNSUPPORTED";
  if (standings.every((s) => s === "ALIVE")) return "ALIVE";
  return "UNKNOWN";
}

export function exitCodeForStanding(s: Standing): ExitCode {
  if (s === "ALIVE") return 0;
  if (s === "REFUSED" || s === "TIMED_OUT") return 1;
  if (s === "BLOCKED") return 2;
  if (s === "UNVERIFIED" || s === "PARTIAL_ALIVE") return 2;
  if (s === "UNSUPPORTED") return 3;
  return 2;
}

function gitHead(cwd: string): string | null {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  const sha = (r.stdout || "").trim();
  return /^[0-9a-f]{40}$/i.test(sha) ? sha : null;
}

/** Anti-vacuity: flip a known PASS court to REFUSED when mutation injected. */
export function antiVacuityExpectFail(actual: ExitCode): boolean {
  return actual === 1;
}

export function composeCourtExits(exits: ExitCode[]): ExitCode {
  return worstExitCode(exits);
}

export function loadLoopReceipt(path: string): unknown {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}
