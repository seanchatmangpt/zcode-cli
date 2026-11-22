/**
 * Honest standing, machine exit codes, dual-receipt egress (ledger + loop_receipt + optional DFCM).
 *
 * Honesty boundary — `writeDfcmReceipt` emits schema `zcode.dfcm.receipt/1`, a
 * cycle-close STUB (subject_sha/standing/exit_code/authority string/external_do_count).
 * It is NOT Chatman-5 / `https://chatmangpt.com/schema/receipt/v2` (the five R-fields
 * + ALOOP `work_order_id` / `origin_authority` / `provider` / `provider_execution_id`).
 * Do not treat stub DFCM files as admitted Chatman-5 receipts; durable ALOOP v2
 * receipts live under `receipts/**` and pass `bun run receipts:validate`.
 */

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

import type { ExitCode, Standing, TransitionReceipt } from "./types.ts";
import { standingFromExit, worstExitCode } from "./types.ts";

export interface ReceiptSinkOptions {
  ledgerPath: string;
  outDir: string;
  /** Optional path to DFCM receipt schema / sink (~/.zcode/dfcm/...). */
  dfcmReceiptPath?: string;
  enforceTwinParity?: boolean;
  twinParitySelfTestCmd?: string[];
  cwd?: string;
}

export interface CycleCloseInput {
  cycleId: string;
  startedAt: string;
  receipts: TransitionReceipt[];
  twinParity?: Record<string, string>;
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

    mkdirSync(dirname(this.opts.ledgerPath), { recursive: true });
    for (const r of input.receipts) {
      const line = {
        ts: new Date().toISOString(),
        cycleId: input.cycleId,
        workOrderId: r.workOrderId,
        outcome: r.outcome,
        standing: standings[input.receipts.indexOf(r)],
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
      finishedAt: new Date().toISOString(),
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
      dfcmPath = this.writeDfcmReceipt(input, aggregate, exitCode);
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
