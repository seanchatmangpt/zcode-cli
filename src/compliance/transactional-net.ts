import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import type { PowlNode, Transition } from "../powl-ocel-orchestrator.ts";
import { ComplianceRefusalError } from "./config.ts";
import { normalizeWorkflowNet, type WorkflowNetLike } from "./conformance.ts";

export interface TxOcelAttributeLike {
  name: string;
  value: string;
}

export interface TxOcelRelationshipLike {
  objectId: string;
  qualifier: string;
}

export interface TxOcelEventLike {
  id: string;
  type: string;
  time: string;
  attributes: TxOcelAttributeLike[];
  relationships: TxOcelRelationshipLike[];
}

export type TransactionalErrorCode =
  | "DIRTY_TIMEOUT_REFUSED"
  | "ROLLBACK_FAILED"
  | "RETRY_BUDGET_EXHAUSTED"
  | "STEP_TIMEOUT"
  | "LIFECYCLE_TIMEOUT";

export class TransactionalRollbackError extends Error {
  readonly code: TransactionalErrorCode;
  readonly exitCode: 1 | 2;

  constructor(code: TransactionalErrorCode, message: string, exitCode: 1 | 2 = 1) {
    super(`${code}: ${message}`);
    this.name = "TransactionalRollbackError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export interface RetryHistoryEntry {
  signature: string;
  rawSignature: string;
  count: number;
  transitionId?: string;
  timestamp: string;
}

export class SignatureRetryLimiter {
  readonly maxRetriesPerSignature: number;
  private readonly counts = new Map<string, number>();
  private readonly history: RetryHistoryEntry[] = [];

  constructor(maxRetriesPerSignature = 3) {
    if (!Number.isInteger(maxRetriesPerSignature) || maxRetriesPerSignature < 1) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `maxRetriesPerSignature must be an integer >= 1, got ${String(maxRetriesPerSignature)}`,
        "admission_vacuous"
      );
    }
    this.maxRetriesPerSignature = maxRetriesPerSignature;
  }

  normalizeSignature(raw: string): string {
    return raw
      .trim()
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<ts>")
      .replace(/(:[0-9]+):[0-9]+/g, ":<loc>")
      .replace(/\bpid=\d+\b/gi, "pid=<pid>")
      .replace(/\s+/g, " ");
  }

  attemptsFor(rawSignature: string): number {
    return this.counts.get(this.normalizeSignature(rawSignature)) ?? 0;
  }

  remainingFor(rawSignature: string): number {
    return Math.max(0, this.maxRetriesPerSignature - this.attemptsFor(rawSignature));
  }

  canRetry(rawSignature: string): boolean {
    return this.attemptsFor(rawSignature) < this.maxRetriesPerSignature;
  }

  recordFailure(rawSignature: string, transitionId?: string): { signature: string; count: number; remaining: number } {
    const sig = this.normalizeSignature(rawSignature || "unknown_failure");
    const next = (this.counts.get(sig) ?? 0) + 1;
    this.counts.set(sig, next);
    this.history.push({
      signature: sig,
      rawSignature,
      count: next,
      transitionId,
      timestamp: new Date().toISOString()
    });
    if (next > this.maxRetriesPerSignature) {
      throw new ComplianceRefusalError(
        "RETRY_BUDGET_EXHAUSTED",
        `Remediation retry budget exhausted for signature "${sig}" (${next} > cap ${this.maxRetriesPerSignature})`,
        "mu_on_O"
      );
    }
    return {
      signature: sig,
      count: next,
      remaining: Math.max(0, this.maxRetriesPerSignature - next)
    };
  }

  getCounts(): Record<string, number> {
    return Object.fromEntries(this.counts.entries());
  }

  getHistory(): RetryHistoryEntry[] {
    return [...this.history];
  }

  reset(rawSignature?: string): void {
    if (rawSignature === undefined) {
      this.counts.clear();
      this.history.length = 0;
      return;
    }
    this.counts.delete(this.normalizeSignature(rawSignature));
  }
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

interface WalkedWorkspaceEntry {
  absPath: string;
  sha256: string;
  mode: number;
  isSymlink: boolean;
  linkTarget?: string;
}

function walkWorkspaceFiles(rootDir: string): Map<string, WalkedWorkspaceEntry> {
  const out = new Map<string, WalkedWorkspaceEntry>();
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (SKIP_DIRS.has(ent.name)) continue;
      const abs = join(dir, ent.name);
      const st = lstatSync(abs);
      const rel = relative(rootDir, abs);
      if (st.isSymbolicLink()) {
        const linkTarget = readlinkSync(abs);
        const h = createHash("sha256");
        h.update(`symlink:${linkTarget}`);
        out.set(rel, {
          absPath: abs,
          sha256: h.digest("hex"),
          mode: st.mode,
          isSymlink: true,
          linkTarget
        });
        continue;
      }
      if (st.isDirectory()) {
        walk(abs);
      } else if (st.isFile()) {
        const h = createHash("sha256");
        h.update(readFileSync(abs));
        out.set(rel, { absPath: abs, sha256: h.digest("hex"), mode: st.mode, isSymlink: false });
      }
    }
  };
  walk(rootDir);
  return out;
}

function isGitRepository(workspaceDir: string): boolean {
  try {
    const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return out.trim() === "true";
  } catch {
    return false;
  }
}

function gitHeadSha(workspaceDir: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function gitStatusPorcelain(workspaceDir: string): string {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch {
    return "";
  }
}

function findGitIndexLock(workspaceDir: string): string | null {
  const direct = join(workspaceDir, ".git", "index.lock");
  if (existsSync(direct)) return direct;
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    if (gitDir) {
      const lockPath = resolve(workspaceDir, gitDir, "index.lock");
      if (existsSync(lockPath)) return lockPath;
    }
  } catch {
    // ignore if not a git repo
  }
  return null;
}

export interface WorkspaceManifestEntry {
  sha256: string;
  mode: number;
  isSymlink?: boolean;
  linkTarget?: string;
}

export interface WorkspaceSnapshotHandle {
  workspaceDir: string;
  backupDir: string;
  snapshotSha256: string;
  isGit: boolean;
  headSha: string | null;
  wasCleanBefore: boolean;
  manifest: Map<string, WorkspaceManifestEntry>;
  isDirty(): boolean;
  rollback(reason: string, stepId: string, rollbackOnDirty?: boolean): RollbackReceipt;
  dispose(): void;
}

export interface RollbackReceipt {
  rolledBack: boolean;
  filesRestored: number;
  filesRemoved: number;
  snapshotSha256: string;
  event: TxOcelEventLike;
}

export function captureWorkspaceSnapshot(workspaceDir: string): WorkspaceSnapshotHandle {
  const absWorkspace = resolve(workspaceDir);
  if (!existsSync(absWorkspace) || !statSync(absWorkspace).isDirectory()) {
    throw new TransactionalRollbackError(
      "ROLLBACK_FAILED",
      `Workspace directory does not exist: "${absWorkspace}"`,
      2
    );
  }

  const lockFile = findGitIndexLock(absWorkspace);
  if (lockFile) {
    throw new TransactionalRollbackError(
      "ROLLBACK_FAILED",
      `Git index.lock present at "${lockFile}"; refusing snapshot/rollback to preserve repository integrity`,
      1
    );
  }

  const isGit = isGitRepository(absWorkspace);
  const headSha = isGit ? gitHeadSha(absWorkspace) : null;
  const wasCleanBefore = isGit ? gitStatusPorcelain(absWorkspace).length === 0 : false;

  const backupDir = mkdtempSync(join(tmpdir(), "zcode-tx-snap-"));
  const files = walkWorkspaceFiles(absWorkspace);
  const manifest = new Map<string, WorkspaceManifestEntry>();

  const sortedEntries = [...files.entries()].sort(([a], [b]) => a.localeCompare(b));
  const aggHash = createHash("sha256");
  for (const [rel, info] of sortedEntries) {
    if (!info.isSymlink) {
      const dest = join(backupDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(info.absPath, dest);
    }
    manifest.set(rel, {
      sha256: info.sha256,
      mode: info.mode,
      isSymlink: info.isSymlink,
      linkTarget: info.linkTarget
    });
    aggHash.update(`${rel}:${info.sha256}\n`);
  }
  const snapshotSha256 = aggHash.digest("hex");

  const isDirty = (): boolean => {
    const current = walkWorkspaceFiles(absWorkspace);
    if (current.size !== manifest.size) return true;
    for (const [rel, info] of manifest.entries()) {
      const cur = current.get(rel);
      if (!cur || Boolean(cur.isSymlink) !== Boolean(info.isSymlink) || cur.sha256 !== info.sha256) {
        return true;
      }
    }
    return false;
  };

  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    rmSync(backupDir, { recursive: true, force: true });
  };

  const removePathSafely = (targetPath: string): void => {
    try {
      const st = lstatSync(targetPath);
      if (st.isSymbolicLink() || !st.isDirectory()) {
        unlinkSync(targetPath);
      } else {
        rmSync(targetPath, { recursive: true, force: true });
      }
    } catch {
      // ignore ENOENT
    }
  };

  const rollback = (reason: string, stepId: string, rollbackOnDirty = true): RollbackReceipt => {
    const activeLock = findGitIndexLock(absWorkspace);
    if (activeLock) {
      throw new TransactionalRollbackError(
        "ROLLBACK_FAILED",
        `Git index.lock present at "${activeLock}"; cannot execute ROLLBACK`,
        1
      );
    }

    const dirty = isDirty();
    if (dirty && !rollbackOnDirty) {
      throw new TransactionalRollbackError(
        "DIRTY_TIMEOUT_REFUSED",
        `Workspace "${absWorkspace}" became dirty during "${stepId}" (${reason}) and rollbackOnDirty is false`,
        1
      );
    }

    // Count changed/added paths against pre-step manifest BEFORE git reset/clean
    const preResetCurrent = walkWorkspaceFiles(absWorkspace);
    let expectedFilesRemoved = 0;
    for (const rel of preResetCurrent.keys()) {
      if (!manifest.has(rel)) {
        expectedFilesRemoved += 1;
      }
    }
    let expectedFilesRestored = 0;
    for (const [rel, info] of manifest.entries()) {
      const cur = preResetCurrent.get(rel);
      if (!cur || Boolean(cur.isSymlink) !== Boolean(info.isSymlink) || cur.sha256 !== info.sha256) {
        expectedFilesRestored += 1;
      }
    }

    if (isGit && wasCleanBefore && headSha) {
      try {
        execFileSync("git", ["reset", "--hard", headSha], {
          cwd: absWorkspace,
          stdio: ["ignore", "pipe", "pipe"]
        });
        execFileSync("git", ["clean", "-fd"], {
          cwd: absWorkspace,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new TransactionalRollbackError("ROLLBACK_FAILED", `git rollback failed: ${msg}`, 1);
      }
    }

    // Remove newly created files & symlinks not in snapshot manifest
    const current = walkWorkspaceFiles(absWorkspace);
    let fsRemoved = 0;
    for (const [rel, info] of current.entries()) {
      if (!manifest.has(rel)) {
        removePathSafely(info.absPath);
        fsRemoved += 1;
      }
    }

    // Restore modified or deleted files/symlinks from backup (unlink symlinks before restoring!)
    let fsRestored = 0;
    for (const [rel, info] of manifest.entries()) {
      const cur = current.get(rel);
      if (!cur || Boolean(cur.isSymlink) !== Boolean(info.isSymlink) || cur.sha256 !== info.sha256) {
        const dst = join(absWorkspace, rel);
        mkdirSync(dirname(dst), { recursive: true });
        // Always unlink any symlink (or directory) at dst before restoring regular file/symlink
        removePathSafely(dst);
        if (info.isSymlink && info.linkTarget !== undefined) {
          symlinkSync(info.linkTarget, dst);
        } else {
          const src = join(backupDir, rel);
          copyFileSync(src, dst);
          try {
            chmodSync(dst, info.mode);
          } catch {
            // best-effort permission restoration
          }
        }
        fsRestored += 1;
      }
    }

    const filesRemoved = Math.max(expectedFilesRemoved, fsRemoved);
    const filesRestored = Math.max(expectedFilesRestored, fsRestored);

    // Prune empty directories left behind by deleted files
    const pruneEmptyDirs = (dir: string): boolean => {
      const entries = readdirSync(dir, { withFileTypes: true });
      let hasContent = false;
      for (const ent of entries) {
        if (SKIP_DIRS.has(ent.name)) {
          hasContent = true;
          continue;
        }
        const abs = join(dir, ent.name);
        if (ent.isDirectory() && !ent.isSymbolicLink()) {
          if (!pruneEmptyDirs(abs)) {
            rmSync(abs, { recursive: true, force: true });
          } else {
            hasContent = true;
          }
        } else {
          hasContent = true;
        }
      }
      return hasContent;
    };
    pruneEmptyDirs(absWorkspace);

    // Post-rollback integrity verification
    if (isDirty()) {
      throw new TransactionalRollbackError(
        "ROLLBACK_FAILED",
        `Workspace "${absWorkspace}" failed post-rollback SHA-256 verification`,
        1
      );
    }

    const event: TxOcelEventLike = {
      id: `rb_${stepId}_${Date.now()}`,
      type: "workspace_rolled_back",
      time: new Date().toISOString(),
      attributes: [
        { name: "reason", value: reason },
        { name: "step_id", value: stepId },
        { name: "snapshot_sha256", value: snapshotSha256 },
        { name: "files_restored", value: String(filesRestored) },
        { name: "files_removed", value: String(filesRemoved) }
      ],
      relationships: [
        { objectId: `ws:${snapshotSha256.slice(0, 16)}`, qualifier: "mutated_in" }
      ]
    };

    return {
      rolledBack: true,
      filesRestored,
      filesRemoved,
      snapshotSha256,
      event
    };
  };

  return {
    workspaceDir: absWorkspace,
    backupDir,
    snapshotSha256,
    isGit,
    headSha,
    wasCleanBefore,
    manifest,
    isDirty,
    rollback,
    dispose
  };
}

export interface TransactionalStepOutcome {
  ok: boolean;
  retryable?: boolean;
  errorSignature?: string;
  detail?: string;
}

export type TransactionalStepFn = (
  transition: Transition,
  ctx: { attempt: number; signal: AbortSignal }
) => Promise<TransactionalStepOutcome>;

export interface TransactionalStepSpec {
  run: TransactionalStepFn;
  timeoutMs?: number;
}

export type TransactionalStepsInput =
  | TransactionalStepFn
  | Readonly<Record<string, TransactionalStepFn | TransactionalStepSpec>>;

export interface TransactionalRollbackContext {
  workspaceDir?: string;
  rollbackOnDirty?: boolean;
  maxRetriesPerSignature?: number;
  stepTimeoutMs?: number;
  maxWallClockMs?: number;
  maxAttemptsTotal?: number;
  retryLimiter?: SignatureRetryLimiter;
  throwOnRefusal?: boolean;
}

export interface TransactionalLifecycleResult {
  ok: boolean;
  standing: "ALIVE" | "REFUSED" | "BLOCKED";
  refusalCode?: string;
  errorDetail?: string;
  rolledBackCount: number;
  attemptsExecuted: number;
  events: TxOcelEventLike[];
  retryCounts: Record<string, number>;
  finalMarking: Record<string, number>;
}

function resolveStepSpec(
  steps: TransactionalStepsInput,
  t: Transition
): { run: TransactionalStepFn; timeoutMs?: number } | null {
  if (typeof steps === "function") {
    return { run: steps };
  }
  const entry =
    steps[t.id] ??
    (t.activityId ? steps[t.activityId] : undefined) ??
    steps[t.label];
  if (!entry) return null;
  if (typeof entry === "function") return { run: entry };
  return entry;
}

async function runWithTimeout(
  fn: TransactionalStepFn,
  transition: Transition,
  attempt: number,
  timeoutMs: number | undefined
): Promise<TransactionalStepOutcome> {
  const ac = new AbortController();
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await fn(transition, { attempt, signal: ac.signal });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(transition, { attempt, signal: ac.signal }),
      new Promise<TransactionalStepOutcome>((_, reject) => {
        timer = setTimeout(() => {
          ac.abort();
          reject(
            new TransactionalRollbackError(
              "STEP_TIMEOUT",
              `Transition "${transition.id}" exceeded stepTimeoutMs=${timeoutMs}`,
              1
            )
          );
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function executeTransactionalLifecycle(
  netOrPowl: WorkflowNetLike | PowlNode,
  steps: TransactionalStepsInput,
  rollbackCtx: TransactionalRollbackContext = {}
): Promise<TransactionalLifecycleResult> {
  const net = normalizeWorkflowNet(netOrPowl);
  const limiter =
    rollbackCtx.retryLimiter ??
    new SignatureRetryLimiter(rollbackCtx.maxRetriesPerSignature ?? 3);
  const rollbackOnDirty = rollbackCtx.rollbackOnDirty ?? true;
  const maxWallClockMs = rollbackCtx.maxWallClockMs ?? 60_000;
  const maxAttemptsTotal = rollbackCtx.maxAttemptsTotal ?? Math.max(16, net.transitions.length * 8);
  const startedAt = Date.now();

  const marking = new Array<number>(net.places.length).fill(0);
  marking[net.sourceIdx] = 1;

  const events: TxOcelEventLike[] = [];
  let evtSeq = 0;
  const pushEvent = (
    type: string,
    attributes: TxOcelAttributeLike[],
    relationships: TxOcelRelationshipLike[] = []
  ) => {
    evtSeq += 1;
    events.push({
      id: `tx_ev_${String(evtSeq).padStart(5, "0")}`,
      type,
      time: new Date().toISOString(),
      attributes,
      relationships
    });
  };

  const isEnabledAt = (ti: number): boolean =>
    net.preIndices[ti]!.every((p) => marking[p]! >= 1);

  const drainSilent = () => {
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let ti = 0; ti < net.transitions.length; ti++) {
        const t = net.transitions[ti]!;
        if (t.silent && isEnabledAt(ti)) {
          for (const p of net.preIndices[ti]!) marking[p]! -= 1;
          for (const p of net.postIndices[ti]!) marking[p]! += 1;
          progressed = true;
        }
      }
    }
  };

  let rolledBackCount = 0;
  let attemptsExecuted = 0;
  const stepAttempts = new Map<string, number>();

  const buildFinalMarking = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (let i = 0; i < net.places.length; i++) {
      if (marking[i]! > 0) out[net.places[i]!.id] = marking[i]!;
    }
    return out;
  };

  const failReturn = (
    standing: "REFUSED" | "BLOCKED",
    refusalCode: string,
    errorDetail: string,
    errToThrow?: unknown
  ): TransactionalLifecycleResult => {
    if (rollbackCtx.throwOnRefusal && errToThrow) {
      throw errToThrow;
    }
    return {
      ok: false,
      standing,
      refusalCode,
      errorDetail,
      rolledBackCount,
      attemptsExecuted,
      events,
      retryCounts: limiter.getCounts(),
      finalMarking: buildFinalMarking()
    };
  };

  while (true) {
    if (Date.now() - startedAt > maxWallClockMs) {
      const msg = `Lifecycle exceeded maxWallClockMs=${maxWallClockMs}`;
      pushEvent("transition_refused", [{ name: "reason", value: "LIFECYCLE_TIMEOUT" }, { name: "detail", value: msg }]);
      return failReturn("BLOCKED", "LIFECYCLE_TIMEOUT", msg, new TransactionalRollbackError("LIFECYCLE_TIMEOUT", msg, 1));
    }

    drainSilent();
    if (marking[net.sinkIdx]! >= 1 && marking.every((m, idx) => idx === net.sinkIdx || m === 0)) {
      break;
    }

    const enabledIndices: number[] = [];
    for (let ti = 0; ti < net.transitions.length; ti++) {
      if (!net.transitions[ti]!.silent && isEnabledAt(ti)) enabledIndices.push(ti);
    }
    if (enabledIndices.length === 0) {
      const msg = `Deadlock: no enabled transitions before reaching sinkPlace "${net.sinkPlace}"`;
      pushEvent("transition_refused", [{ name: "reason", value: "DEADLOCK" }, { name: "detail", value: msg }]);
      return failReturn("BLOCKED", "DEADLOCK", msg);
    }

    const ti = enabledIndices[0]!;
    const t = net.transitions[ti]!;
    const spec = resolveStepSpec(steps, t);
    if (!spec) {
      const msg = `No step handler configured for transition "${t.id}" (${t.activityId ?? t.label})`;
      pushEvent("transition_refused", [{ name: "transition", value: t.id }, { name: "detail", value: msg }]);
      return failReturn("BLOCKED", "MISSING_STEP_HANDLER", msg);
    }

    attemptsExecuted += 1;
    if (attemptsExecuted > maxAttemptsTotal) {
      const msg = `Lifecycle exceeded maxAttemptsTotal=${maxAttemptsTotal}`;
      pushEvent("retry_budget_exhausted", [{ name: "transition", value: t.id }, { name: "detail", value: msg }]);
      const err = new ComplianceRefusalError("RETRY_BUDGET_EXHAUSTED", msg, "mu_on_O");
      return failReturn("REFUSED", "RETRY_BUDGET_EXHAUSTED", msg, err);
    }

    const attempt = (stepAttempts.get(t.id) ?? 0) + 1;
    stepAttempts.set(t.id, attempt);

    let snap: WorkspaceSnapshotHandle | null = null;
    try {
      if (rollbackCtx.workspaceDir) {
        snap = captureWorkspaceSnapshot(rollbackCtx.workspaceDir);
      }
    } catch (err) {
      const code = err instanceof TransactionalRollbackError ? err.code : "ROLLBACK_FAILED";
      const msg = err instanceof Error ? err.message : String(err);
      pushEvent("transition_refused", [{ name: "transition", value: t.id }, { name: "reason", value: code }, { name: "detail", value: msg }]);
      return failReturn("BLOCKED", code, msg, err);
    }

    // Reserve input tokens
    for (const p of net.preIndices[ti]!) marking[p]! -= 1;

    pushEvent(
      "transition_fired",
      [{ name: "transition", value: t.id }, { name: "attempt", value: String(attempt) }]
    );

    const stepTimeout = spec.timeoutMs ?? rollbackCtx.stepTimeoutMs;
    let outcome: TransactionalStepOutcome | undefined;
    let caughtError: unknown;

    try {
      outcome = await runWithTimeout(spec.run, t, attempt, stepTimeout);
    } catch (err) {
      caughtError = err;
    }

    if (outcome?.ok) {
      try {
        for (const p of net.postIndices[ti]!) marking[p]! += 1;
        pushEvent("transition_completed", [
          { name: "transition", value: t.id },
          { name: "attempt", value: String(attempt) }
        ]);
      } finally {
        snap?.dispose();
      }
      continue;
    }

    // Step failed or timed out -> atomic rollback first (if workspaceDir provided), then check retry cap
    const reason =
      caughtError instanceof TransactionalRollbackError && caughtError.code === "STEP_TIMEOUT"
        ? "step_timeout"
        : caughtError
          ? "step_exception"
          : outcome?.detail ?? "step_failed";
    const errorSignature =
      outcome?.errorSignature ??
      (caughtError instanceof Error ? `${t.id}:${caughtError.message}` : `${t.id}:${outcome?.detail ?? "failed"}`);

    if (snap) {
      try {
        const rb = snap.rollback(reason, t.id, rollbackOnDirty);
        rolledBackCount += 1;
        events.push(rb.event);
      } catch (rbErr) {
        snap.dispose();
        const code = rbErr instanceof TransactionalRollbackError ? rbErr.code : "ROLLBACK_FAILED";
        const msg = rbErr instanceof Error ? rbErr.message : String(rbErr);
        pushEvent("transition_refused", [{ name: "transition", value: t.id }, { name: "reason", value: code }, { name: "detail", value: msg }]);
        return failReturn("REFUSED", code, msg, rbErr);
      } finally {
        snap.dispose();
      }
    }

    const canRetryFlag = outcome?.retryable !== false;
    if (!canRetryFlag) {
      const msg = outcome?.detail ?? `Non-retryable failure on "${t.id}"`;
      pushEvent("transition_refused", [{ name: "transition", value: t.id }, { name: "detail", value: msg }]);
      return failReturn("REFUSED", "STEP_REFUSED", msg);
    }

    try {
      limiter.recordFailure(errorSignature, t.id);
    } catch (limitErr) {
      const msg = limitErr instanceof Error ? limitErr.message : String(limitErr);
      pushEvent("retry_budget_exhausted", [
        { name: "transition", value: t.id },
        { name: "signature", value: limiter.normalizeSignature(errorSignature) },
        { name: "detail", value: msg }
      ]);
      return failReturn("REFUSED", "RETRY_BUDGET_EXHAUSTED", msg, limitErr);
    }

    // Return tokens cleanly ONLY after atomic rollback & retry budget check succeeded
    for (const p of net.preIndices[ti]!) marking[p]! += 1;
    pushEvent("wip_backoff", [
      { name: "transition", value: t.id },
      { name: "reason", value: reason },
      { name: "signature", value: limiter.normalizeSignature(errorSignature) }
    ]);
  }

  return {
    ok: true,
    standing: "ALIVE",
    rolledBackCount,
    attemptsExecuted,
    events,
    retryCounts: limiter.getCounts(),
    finalMarking: buildFinalMarking()
  };
}
