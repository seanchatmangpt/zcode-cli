/**
 * SjiraIoAdapter — thin, optional I/O seam bridging file-based sjira JSONL
 * contracts into zcode-cli's POWL v2 orchestrator without coupling the core
 * runtime to any single repo or Elixir toolchain.
 *
 * Contract (Explore):
 *   Ingress:  GGEN_BIN + `sjira frontier` | SJIRA_CANDIDATES (candidates.jsonl)
 *             → PowlNode PartialOrder(V, ≺)
 *   Gate:     optional `mix ggen_igniter.sync --check` (exit 0 clean / 4 drift)
 *   Egress:   SJIRA_LEDGER (ledger.jsonl) + SJIRA_OUT_DIR/loop_receipt.json
 *
 * Standing honesty: PARTIAL_ALIVE / UNVERIFIED must never be promoted to ALIVE.
 * Fail-closed: GGEN_BIN must be an absolute existing path; never fall back to PATH.
 *
 * See docs/sjira/v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md Appendix D.
 */

import { createHash } from "node:crypto";
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";

import type { PowlNode } from "../powl-ocel-orchestrator.ts";
import {
  DEFAULT_CLEAN_ROOM_CHECK_CMD,
  evaluateCleanRoomDrift
} from "../adapters/clean-room-drift.ts";

// ---------------------------------------------------------------------------
// Standing & work-order wire types (file-based, authority-free)
// ---------------------------------------------------------------------------

/** Honest standing values admitted on the sjira ledger / loop receipt. */
export type SjiraStanding =
  | "UNKNOWN"
  | "UNVERIFIED"
  | "PARTIAL_ALIVE"
  | "ALIVE"
  | "REFUSED"
  | "TIMED_OUT"
  | "BLOCKED"
  | "BUILD_BROKEN"
  | "UNSUPPORTED";

/** Transition outcome written to the ledger after an orchestrator fire. */
export type SjiraTransitionOutcome = "ALIVE" | "REFUSED" | "PARTIAL_ALIVE" | "TIMED_OUT" | "UNVERIFIED";

/**
 * One newline-delimited JSON work-order candidate (SJIRA_CANDIDATES).
 * Fields are intentionally permissive so projector versions can evolve;
 * required keys are validated at ingest.
 */
export interface SjiraCandidate {
  /** Stable work-order id (e.g. ZOCEL-014 or full IRI). */
  id: string;
  /** Human label / title. */
  label?: string;
  /** Exact subject base SHA when bound. */
  baseSha?: string;
  /** Repository or workspace root hint (operator-local). */
  repository?: string;
  /** Declared standing from the frontier (never upgraded by the adapter). */
  standing?: SjiraStanding;
  /** Authority ceiling claim from the order (informational; adapter is authority-free). */
  authorityCeiling?: "OBSERVE" | "SELECT" | "CONSTRUCT" | "NONE";
  /** Path scope the agent may mutate (globs or concrete paths). */
  pathScope?: string[];
  /** Upstream dependency work-order ids → edges u ≺ v (dep before this). */
  dependsOn?: string[];
  /** Prompt text or path for the coding-agent activity. */
  prompt?: string;
  promptPath?: string;
  /** Optional object/artifact type label for POWL Activity.objectType. */
  objectType?: string;
  /** Optional primary target file for POWL Activity.targetFile. */
  targetFile?: string;
  /** Work-order-specific verification command (shell). */
  verifyCmd?: string;
  /** When true, post-transition igniter clean-room gate is required. */
  requiresIgniterCleanRoom?: boolean;
  /** Opaque projector fields preserved into ledger/receipt. */
  meta?: Record<string, unknown>;
}

export interface SjiraLedgerEntry {
  ts: string;
  cycleId: string;
  workOrderId: string;
  outcome: SjiraTransitionOutcome;
  standing: SjiraStanding;
  sha256Receipt: string;
  detail?: string;
  baseSha?: string;
  ocelSha256?: string;
  ggenBin?: string;
  igniterCleanRoom?: "passed" | "failed" | "skipped";
}

export interface SjiraLoopReceipt {
  schema: "zcode.sjira.loop_receipt/1";
  cycleId: string;
  startedAt: string;
  finishedAt: string;
  ggenBin: string;
  candidatesSource: "frontier_cmd" | "candidates_file";
  candidatesPath?: string;
  ledgerPath: string;
  powlRootId: string;
  outcomes: Array<{
    workOrderId: string;
    outcome: SjiraTransitionOutcome;
    standing: SjiraStanding;
    sha256Receipt: string;
  }>;
  /** Twin-parity digests (opaque strings from caller / evidence suite). */
  twinParity?: Record<string, string>;
  /** Aggregate standing: never ALIVE if any child is PARTIAL_ALIVE/UNVERIFIED/REFUSED. */
  aggregateStanding: SjiraStanding;
  exitCode: number;
}

export interface SjiraIoPaths {
  /** Absolute path to GGEN_BIN (required for frontier_cmd ingress). */
  ggenBin?: string;
  /** SJIRA_CANDIDATES — candidates.jsonl */
  candidatesPath?: string;
  /** SJIRA_LEDGER — ledger.jsonl (append-only) */
  ledgerPath: string;
  /** SJIRA_OUT_DIR — directory for loop_receipt.json */
  outDir: string;
  /** Working directory for frontier / igniter / git commands. */
  cwd: string;
}

export interface SjiraAdapterEnv {
  GGEN_BIN?: string;
  SJIRA_CANDIDATES?: string;
  SJIRA_LEDGER?: string;
  SJIRA_OUT_DIR?: string;
}

export type SjiraAdapterErrorCode =
  | "GGEN_NOT_FOUND"
  | "GGEN_BIN_NOT_ABSOLUTE"
  | "CANDIDATES_MISSING"
  | "CANDIDATES_PARSE"
  | "FRONTIER_FAILED"
  | "EMPTY_FRONTIER"
  | "PO_CYCLE"
  | "IGNITER_SYNC_FAILED"
  | "IGNITER_DIRTY_TREE"
  | "VERIFY_CMD_FAILED"
  | "STANDING_PROMOTION_REFUSED";

export class SjiraAdapterError extends Error {
  readonly code: SjiraAdapterErrorCode;
  readonly exitHint: number;

  constructor(code: SjiraAdapterErrorCode, message: string, exitHint = 2) {
    super(message);
    this.name = "SjiraAdapterError";
    this.code = code;
    this.exitHint = exitHint;
  }
}

// ---------------------------------------------------------------------------
// Fail-closed GGEN_BIN pinning
// ---------------------------------------------------------------------------

/**
 * Resolve GGEN_BIN from env/config. Fail-closed:
 * - unset / empty → GGEN_NOT_FOUND
 * - not absolute → GGEN_BIN_NOT_ABSOLUTE
 * - missing / non-executable → GGEN_NOT_FOUND
 * Never falls back to `PATH` lookup of a bare `ggen` name.
 */
export function requireGgenBin(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) {
    throw new SjiraAdapterError(
      "GGEN_NOT_FOUND",
      "GGEN_BIN is unset; refuse PATH fallback (:ggen_not_found)",
      2
    );
  }
  if (!isAbsolute(trimmed)) {
    throw new SjiraAdapterError(
      "GGEN_BIN_NOT_ABSOLUTE",
      `GGEN_BIN must be an absolute path, got: ${trimmed}`,
      2
    );
  }
  try {
    accessSync(trimmed, constants.X_OK);
  } catch {
    throw new SjiraAdapterError(
      "GGEN_NOT_FOUND",
      `GGEN_BIN not found or not executable: ${trimmed}`,
      2
    );
  }
  return trimmed;
}

export function resolveSjiraPaths(
  env: SjiraAdapterEnv,
  defaults: Partial<SjiraIoPaths> & { cwd: string }
): SjiraIoPaths {
  const cwd = defaults.cwd;
  const ledgerPath = env.SJIRA_LEDGER?.trim() || defaults.ledgerPath || join(cwd, "ledger.jsonl");
  const outDir = env.SJIRA_OUT_DIR?.trim() || defaults.outDir || join(cwd, "sjira-out");
  const candidatesPath = env.SJIRA_CANDIDATES?.trim() || defaults.candidatesPath;
  const ggenBin = env.GGEN_BIN?.trim() || defaults.ggenBin;
  return { cwd, ledgerPath, outDir, candidatesPath, ggenBin };
}

// ---------------------------------------------------------------------------
// Ingress: candidates.jsonl / frontier → POWL v2
// ---------------------------------------------------------------------------

export function parseCandidatesJsonl(text: string): SjiraCandidate[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
  const out: SjiraCandidate[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i]!);
    } catch (e) {
      throw new SjiraAdapterError(
        "CANDIDATES_PARSE",
        `candidates.jsonl line ${i + 1}: invalid JSON (${(e as Error).message})`,
        2
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SjiraAdapterError("CANDIDATES_PARSE", `candidates.jsonl line ${i + 1}: expected object`, 2);
    }
    const row = parsed as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) {
      throw new SjiraAdapterError("CANDIDATES_PARSE", `candidates.jsonl line ${i + 1}: missing id`, 2);
    }
    out.push(normalizeCandidate(row, id));
  }
  return out;
}

function normalizeCandidate(row: Record<string, unknown>, id: string): SjiraCandidate {
  const str = (k: string): string | undefined =>
    typeof row[k] === "string" && (row[k] as string).trim() ? (row[k] as string).trim() : undefined;
  const strArr = (k: string): string[] | undefined => {
    const v = row[k];
    if (!Array.isArray(v)) return undefined;
    const items = v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
    return items.length > 0 ? items : undefined;
  };
  return {
    id,
    label: str("label") ?? str("title") ?? id,
    baseSha: str("baseSha") ?? str("base_sha"),
    repository: str("repository") ?? str("repo"),
    standing: (str("standing") as SjiraStanding | undefined) ?? "UNKNOWN",
    authorityCeiling: str("authorityCeiling") as SjiraCandidate["authorityCeiling"],
    pathScope: strArr("pathScope") ?? strArr("path_scope"),
    dependsOn: strArr("dependsOn") ?? strArr("depends_on"),
    prompt: str("prompt"),
    promptPath: str("promptPath") ?? str("prompt_path"),
    objectType: str("objectType") ?? str("object_type") ?? "WorkOrder",
    targetFile: str("targetFile") ?? str("target_file"),
    verifyCmd: str("verifyCmd") ?? str("verify_cmd"),
    requiresIgniterCleanRoom:
      row.requiresIgniterCleanRoom === true ||
      row.requires_igniter_clean_room === true ||
      row.requiresIgniterCleanRoom === "true",
    meta: typeof row.meta === "object" && row.meta !== null && !Array.isArray(row.meta)
      ? (row.meta as Record<string, unknown>)
      : undefined
  };
}

export function readCandidatesFile(path: string): SjiraCandidate[] {
  if (!existsSync(path)) {
    throw new SjiraAdapterError("CANDIDATES_MISSING", `SJIRA_CANDIDATES not found: ${path}`, 2);
  }
  return parseCandidatesJsonl(readFileSync(path, "utf8"));
}

/**
 * Invoke `"$GGEN_BIN" sjira frontier` and parse JSONL from stdout.
 * Fail-closed on non-zero exit. Never searches PATH for ggen.
 */
export function ingestFrontierCmd(ggenBin: string, cwd: string, extraArgs: string[] = []): SjiraCandidate[] {
  const bin = requireGgenBin(ggenBin);
  const result = spawnSync(bin, ["sjira", "frontier", ...extraArgs], {
    cwd,
    encoding: "utf8",
    env: process.env
  });
  if (result.error) {
    throw new SjiraAdapterError("FRONTIER_FAILED", `frontier spawn failed: ${result.error.message}`, 2);
  }
  if (result.status !== 0) {
    throw new SjiraAdapterError(
      "FRONTIER_FAILED",
      `frontier exited ${result.status}: ${(result.stderr || result.stdout || "").trim().slice(0, 500)}`,
      result.status === null ? 2 : result.status
    );
  }
  const candidates = parseCandidatesJsonl(result.stdout || "");
  if (candidates.length === 0) {
    throw new SjiraAdapterError("EMPTY_FRONTIER", "sjira frontier returned zero eligible work orders", 2);
  }
  return candidates;
}

export type IngressMode = "frontier_cmd" | "candidates_file";

export interface IngestResult {
  candidates: SjiraCandidate[];
  source: IngressMode;
  candidatesPath?: string;
  ggenBin?: string;
}

/**
 * Ingress: prefer SJIRA_CANDIDATES file when set; otherwise require GGEN_BIN and run frontier.
 */
export function ingestSjiraFrontier(paths: SjiraIoPaths, mode?: IngressMode): IngestResult {
  if (mode === "candidates_file" || (!mode && paths.candidatesPath)) {
    if (!paths.candidatesPath) {
      throw new SjiraAdapterError("CANDIDATES_MISSING", "candidates_file mode requires SJIRA_CANDIDATES", 2);
    }
    return {
      candidates: readCandidatesFile(paths.candidatesPath),
      source: "candidates_file",
      candidatesPath: paths.candidatesPath
    };
  }
  const ggenBin = requireGgenBin(paths.ggenBin);
  return {
    candidates: ingestFrontierCmd(ggenBin, paths.cwd),
    source: "frontier_cmd",
    ggenBin
  };
}

/**
 * Map eligible work orders + dependsOn edges into a POWL v2 PartialOrder.
 * Edge semantics: for each dep D of W, D ≺ W (dependency before dependent).
 * Ids that appear only as dependsOn references (not in the frontier) are dropped
 * from edges (frontier is the eligible set); dangling deps do not invent nodes.
 */
export function candidatesToPowl(
  candidates: readonly SjiraCandidate[],
  options: { rootId?: string } = {}
): PowlNode {
  if (candidates.length === 0) {
    throw new SjiraAdapterError("EMPTY_FRONTIER", "cannot compile empty candidate set to POWL", 2);
  }
  const idSet = new Set(candidates.map((c) => c.id));
  const children: PowlNode[] = candidates.map((c) => {
    const activity: Extract<PowlNode, { kind: "activity" }> = {
      kind: "activity",
      id: c.id,
      label: c.label ?? c.id,
      objectType: c.objectType ?? "WorkOrder",
      ...(c.targetFile ? { targetFile: c.targetFile } : {})
    };
    return activity;
  });

  const order: Array<readonly [string, string]> = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    for (const dep of c.dependsOn ?? []) {
      if (!idSet.has(dep)) continue; // not eligible in this frontier — skip
      if (dep === c.id) {
        throw new SjiraAdapterError("PO_CYCLE", `self-dependency on work order ${c.id}`, 2);
      }
      const key = `${dep}->${c.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      order.push([dep, c.id] as const);
    }
  }

  // Acyclicity check (Kahn)
  const adj = new Map<string, string[]>();
  const inDeg = new Map<string, number>();
  for (const id of idSet) {
    adj.set(id, []);
    inDeg.set(id, 0);
  }
  for (const [u, v] of order) {
    adj.get(u)!.push(v);
    inDeg.set(v, (inDeg.get(v) ?? 0) + 1);
  }
  const q = [...idSet].filter((id) => (inDeg.get(id) ?? 0) === 0);
  let visited = 0;
  while (q.length > 0) {
    const cur = q.shift()!;
    visited += 1;
    for (const nxt of adj.get(cur)!) {
      const d = (inDeg.get(nxt) ?? 0) - 1;
      inDeg.set(nxt, d);
      if (d === 0) q.push(nxt);
    }
  }
  if (visited !== idSet.size) {
    throw new SjiraAdapterError("PO_CYCLE", "dependsOn graph contains a cycle", 2);
  }

  return {
    kind: "partial_order",
    id: options.rootId ?? `sjira-frontier-${createHash("sha256").update(candidates.map((c) => c.id).join("\n")).digest("hex").slice(0, 12)}`,
    children,
    order
  };
}

// ---------------------------------------------------------------------------
// Transition gate: ggen_igniter clean-room
// ---------------------------------------------------------------------------

export interface IgniterGateResult {
  ok: boolean;
  status: "passed" | "failed" | "skipped";
  detail?: string;
}

/**
 * For ggen_igniter-managed workspaces: `mix ggen_igniter.sync --check`
 * (exit 0 = clean, exit 4 = ontology↔artifact drift). Optional work-order
 * verifyCmd runs after. Skip (status=skipped) when the candidate does not
 * require the gate.
 *
 * Do **not** use `git diff --exit-code` as the ontology drift gate (clean
 * index ≠ ontology match). Prefer `--check` over bare `ggen sync run --dry-run`.
 */
export function verifyIgniterCleanRoom(
  cwd: string,
  options: {
    required: boolean;
    syncCmd?: string[];
    verifyCmd?: string;
    /** Injected runner for tests (Chicago: real spawn by default). */
    run?: (cmd: string[], cwd: string) => { status: number | null; stderr: string; stdout: string };
  }
): IgniterGateResult {
  if (!options.required) {
    return { ok: true, status: "skipped" };
  }
  const run =
    options.run ??
    ((cmd, dir) => {
      const r = spawnSync(cmd[0]!, cmd.slice(1), { cwd: dir, encoding: "utf8", env: process.env, shell: false });
      return { status: r.status, stderr: r.stderr || "", stdout: r.stdout || "" };
    });

  // Jobs/C4: mix ggen_igniter.sync --check (exit 0/4) or ggen dry-run + empty
  // planned_writes — never git-diff. Noop ["true"] → skipped (LOUD_SKIP).
  const syncCmd =
    options.syncCmd && options.syncCmd.length > 0
      ? options.syncCmd
      : [...DEFAULT_CLEAN_ROOM_CHECK_CMD];
  const sync = run(syncCmd, cwd);
  const drift = evaluateCleanRoomDrift(syncCmd, sync);
  if (drift.kind === "loud_skip") {
    return {
      ok: true,
      status: "skipped",
      detail: drift.diagnostics.join("; ")
    };
  }
  if (drift.kind !== "pass") {
    return {
      ok: false,
      status: "failed",
      detail: drift.diagnostics.join("; ").slice(0, 500)
    };
  }

  if (options.verifyCmd?.trim()) {
    const verify = run(["bash", "-lc", options.verifyCmd.trim()], cwd);
    if (verify.status !== 0) {
      return {
        ok: false,
        status: "failed",
        detail: `verifyCmd exited ${verify.status}: ${(verify.stderr || verify.stdout).trim().slice(0, 500)}`
      };
    }
  }

  return { ok: true, status: "passed" };
}

// ---------------------------------------------------------------------------
// Standing honesty
// ---------------------------------------------------------------------------

/**
 * Map an orchestrator transition outcome + optional sandbox/evidence flags
 * into ledger standing. Never promotes PARTIAL_ALIVE / UNVERIFIED to ALIVE.
 */
export function resolveHonestStanding(input: {
  outcome: SjiraTransitionOutcome;
  /** Frontier-declared standing before execution. */
  priorStanding?: SjiraStanding;
  /** True when evidence suite / twin parity was not run or failed. */
  unverified?: boolean;
  /** True when live env keys / close_candidate were absent (sandbox). */
  sandboxPartial?: boolean;
}): SjiraStanding {
  if (input.outcome === "REFUSED" || input.outcome === "TIMED_OUT") {
    return input.outcome;
  }
  if (input.unverified) return "UNVERIFIED";
  if (input.sandboxPartial || input.outcome === "PARTIAL_ALIVE") return "PARTIAL_ALIVE";
  if (input.outcome === "UNVERIFIED") return "UNVERIFIED";
  // outcome === ALIVE — still refuse promotion if prior was sandbox-capped
  if (input.priorStanding === "PARTIAL_ALIVE" || input.priorStanding === "UNVERIFIED") {
    return input.priorStanding;
  }
  return "ALIVE";
}

/**
 * Aggregate cycle standing: ALIVE only if every child is ALIVE.
 */
export function aggregateStanding(standings: readonly SjiraStanding[]): SjiraStanding {
  if (standings.length === 0) return "UNKNOWN";
  if (standings.some((s) => s === "REFUSED" || s === "TIMED_OUT" || s === "BLOCKED" || s === "BUILD_BROKEN")) {
    return standings.find((s) => s === "REFUSED" || s === "TIMED_OUT" || s === "BLOCKED" || s === "BUILD_BROKEN")!;
  }
  if (standings.some((s) => s === "PARTIAL_ALIVE")) return "PARTIAL_ALIVE";
  if (standings.some((s) => s === "UNVERIFIED")) return "UNVERIFIED";
  if (standings.some((s) => s === "UNSUPPORTED")) return "UNSUPPORTED";
  if (standings.every((s) => s === "ALIVE")) return "ALIVE";
  return "UNKNOWN";
}

export function assertNoStandingPromotion(
  from: SjiraStanding,
  to: SjiraStanding
): void {
  const rank: Record<SjiraStanding, number> = {
    REFUSED: 0,
    TIMED_OUT: 0,
    BLOCKED: 0,
    BUILD_BROKEN: 0,
    UNSUPPORTED: 1,
    UNKNOWN: 2,
    UNVERIFIED: 3,
    PARTIAL_ALIVE: 4,
    ALIVE: 5
  };
  // Promotion = moving toward ALIVE across the PARTIAL/UNVERIFIED boundary without evidence.
  if ((from === "PARTIAL_ALIVE" || from === "UNVERIFIED") && to === "ALIVE") {
    throw new SjiraAdapterError(
      "STANDING_PROMOTION_REFUSED",
      `refusing standing promotion ${from} → ALIVE (honest sandbox/unverified cap)`,
      1
    );
  }
  if (rank[to] > rank[from] && from !== "UNKNOWN" && to === "ALIVE" && from !== "ALIVE") {
    // Allow UNKNOWN → ALIVE (fresh live run). Refuse PARTIAL/UNVERIFIED already handled.
  }
}

// ---------------------------------------------------------------------------
// Egress: ledger.jsonl + loop_receipt.json
// ---------------------------------------------------------------------------

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function appendSjiraLedger(ledgerPath: string, entry: SjiraLedgerEntry): void {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`, { encoding: "utf8" });
}

export function writeLoopReceipt(outDir: string, receipt: SjiraLoopReceipt): string {
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, "loop_receipt.json");
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8" });
  return path;
}

export interface EmitTransitionArgs {
  paths: SjiraIoPaths;
  cycleId: string;
  candidate: SjiraCandidate;
  outcome: SjiraTransitionOutcome;
  detail?: string;
  ocelSha256?: string;
  unverified?: boolean;
  sandboxPartial?: boolean;
  igniterCleanRoom?: IgniterGateResult["status"];
  ggenBin?: string;
}

/**
 * Append one ledger line for a finished transition with honest standing.
 */
export function emitSjiraLedgerEntry(args: EmitTransitionArgs): SjiraLedgerEntry {
  const standing = resolveHonestStanding({
    outcome: args.outcome,
    priorStanding: args.candidate.standing,
    unverified: args.unverified,
    sandboxPartial: args.sandboxPartial
  });
  // Refuse any attempt to record ALIVE over a sandbox/unverified prior.
  assertNoStandingPromotion(args.candidate.standing ?? "UNKNOWN", standing);

  const receiptBody = {
    workOrderId: args.candidate.id,
    outcome: args.outcome,
    standing,
    cycleId: args.cycleId,
    detail: args.detail ?? null,
    baseSha: args.candidate.baseSha ?? null,
    ocelSha256: args.ocelSha256 ?? null
  };
  // Ledger outcome mirrors honest standing when capped below the caller's claim.
  const ledgerOutcome: SjiraTransitionOutcome =
    standing === "PARTIAL_ALIVE" || standing === "UNVERIFIED"
      ? standing
      : args.outcome;
  const entry: SjiraLedgerEntry = {
    ts: new Date().toISOString(),
    cycleId: args.cycleId,
    workOrderId: args.candidate.id,
    outcome: ledgerOutcome,
    standing,
    sha256Receipt: sha256Json(receiptBody),
    detail: args.detail,
    baseSha: args.candidate.baseSha,
    ocelSha256: args.ocelSha256,
    ggenBin: args.ggenBin,
    igniterCleanRoom: args.igniterCleanRoom
  };
  appendSjiraLedger(args.paths.ledgerPath, entry);
  return entry;
}

export interface EmitCycleArgs {
  paths: SjiraIoPaths;
  cycleId: string;
  startedAt: string;
  ingest: IngestResult;
  powlRootId: string;
  entries: SjiraLedgerEntry[];
  twinParity?: Record<string, string>;
}

/**
 * Write SJIRA_OUT_DIR/loop_receipt.json. Exit code:
 *   0 = aggregate ALIVE
 *   1 = REFUSED / TIMED_OUT / BLOCKED / BUILD_BROKEN
 *   2 = config / PARTIAL_ALIVE / UNVERIFIED / UNKNOWN (honest non-promotion)
 */
export function emitSjiraLedgerAndReceipt(args: EmitCycleArgs): SjiraLoopReceipt {
  const standings = args.entries.map((e) => e.standing);
  const aggregate = aggregateStanding(standings);
  let exitCode = 2;
  if (aggregate === "ALIVE") exitCode = 0;
  else if (aggregate === "REFUSED" || aggregate === "TIMED_OUT" || aggregate === "BLOCKED" || aggregate === "BUILD_BROKEN") {
    exitCode = 1;
  }

  const ggenBin =
    args.ingest.ggenBin ??
    (args.paths.ggenBin ? (() => {
      try {
        return requireGgenBin(args.paths.ggenBin);
      } catch {
        return "";
      }
    })() : "");

  const receipt: SjiraLoopReceipt = {
    schema: "zcode.sjira.loop_receipt/1",
    cycleId: args.cycleId,
    startedAt: args.startedAt,
    finishedAt: new Date().toISOString(),
    ggenBin,
    candidatesSource: args.ingest.source,
    candidatesPath: args.ingest.candidatesPath,
    ledgerPath: args.paths.ledgerPath,
    powlRootId: args.powlRootId,
    outcomes: args.entries.map((e) => ({
      workOrderId: e.workOrderId,
      outcome: e.outcome,
      standing: e.standing,
      sha256Receipt: e.sha256Receipt
    })),
    twinParity: args.twinParity,
    aggregateStanding: aggregate,
    exitCode
  };
  writeLoopReceipt(args.paths.outDir, receipt);
  return receipt;
}

// ---------------------------------------------------------------------------
// Facade interface (wireable into orchestrator / scripts)
// ---------------------------------------------------------------------------

export interface SjiraIoAdapter {
  ingestSjiraFrontier(mode?: IngressMode): IngestResult;
  candidatesToPowl(candidates: readonly SjiraCandidate[], rootId?: string): PowlNode;
  verifyIgniterCleanRoom(candidate: SjiraCandidate): IgniterGateResult;
  emitSjiraLedgerEntry(args: Omit<EmitTransitionArgs, "paths">): SjiraLedgerEntry;
  emitSjiraLedgerAndReceipt(args: Omit<EmitCycleArgs, "paths" | "ingest"> & { ingest: IngestResult }): SjiraLoopReceipt;
  paths: SjiraIoPaths;
}

/** Pick only known sjira env keys from a ProcessEnv-like bag (no index signature bleed). */
export function sjiraEnvFromProcess(env: NodeJS.ProcessEnv = process.env): SjiraAdapterEnv {
  const pick = (k: keyof SjiraAdapterEnv): string | undefined => {
    const v = env[k];
    return typeof v === "string" && v.trim() ? v : undefined;
  };
  return {
    GGEN_BIN: pick("GGEN_BIN"),
    SJIRA_CANDIDATES: pick("SJIRA_CANDIDATES"),
    SJIRA_LEDGER: pick("SJIRA_LEDGER"),
    SJIRA_OUT_DIR: pick("SJIRA_OUT_DIR")
  };
}

export function createSjiraIoAdapter(
  env: SjiraAdapterEnv = sjiraEnvFromProcess(),
  defaults: Partial<SjiraIoPaths> & { cwd: string }
): SjiraIoAdapter {
  const paths = resolveSjiraPaths(env, defaults);
  return {
    paths,
    ingestSjiraFrontier: (mode) => ingestSjiraFrontier(paths, mode),
    candidatesToPowl: (candidates, rootId) => candidatesToPowl(candidates, { rootId }),
    verifyIgniterCleanRoom: (candidate) =>
      verifyIgniterCleanRoom(paths.cwd, {
        required: candidate.requiresIgniterCleanRoom === true,
        verifyCmd: candidate.verifyCmd
      }),
    emitSjiraLedgerEntry: (args) => emitSjiraLedgerEntry({ ...args, paths }),
    emitSjiraLedgerAndReceipt: (args) => emitSjiraLedgerAndReceipt({ ...args, paths })
  };
}
