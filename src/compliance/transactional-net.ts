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
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
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
  | "LIFECYCLE_TIMEOUT"
  | "SILENT_CYCLE_DETECTED";

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

export interface SignatureRetryLimiterState {
  version: 1;
  maxRetriesPerSignature: number;
  counts: Record<string, number>;
  history: RetryHistoryEntry[];
}

export interface SignatureRetryLimiterOptions {
  statePath?: string;
}

export class SignatureRetryLimiter {
  readonly maxRetriesPerSignature: number;
  readonly statePath?: string;
  private readonly counts = new Map<string, number>();
  private readonly history: RetryHistoryEntry[] = [];

  constructor(maxRetriesPerSignature = 3, options?: SignatureRetryLimiterOptions) {
    if (!Number.isInteger(maxRetriesPerSignature) || maxRetriesPerSignature < 1) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `maxRetriesPerSignature must be an integer >= 1, got ${String(maxRetriesPerSignature)}`,
        "admission_vacuous"
      );
    }
    this.maxRetriesPerSignature = maxRetriesPerSignature;
    if (options?.statePath) {
      this.statePath = resolve(options.statePath);
      if (existsSync(this.statePath)) {
        this.hydrateFromFile(this.statePath);
      }
    }
  }

  private hydrateFromFile(filePath: string): void {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SignatureRetryLimiterState>;
    if (parsed && typeof parsed === "object") {
      if (parsed.counts && typeof parsed.counts === "object") {
        for (const [k, v] of Object.entries(parsed.counts)) {
          if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
            this.counts.set(k, Math.floor(v));
          }
        }
      }
      if (Array.isArray(parsed.history)) {
        for (const entry of parsed.history) {
          if (
            entry &&
            typeof entry === "object" &&
            typeof entry.signature === "string" &&
            typeof entry.rawSignature === "string" &&
            typeof entry.count === "number" &&
            typeof entry.timestamp === "string"
          ) {
            this.history.push({
              signature: entry.signature,
              rawSignature: entry.rawSignature,
              count: entry.count,
              transitionId: typeof entry.transitionId === "string" ? entry.transitionId : undefined,
              timestamp: entry.timestamp
            });
          }
        }
      }
    }
  }

  private persistIfConfigured(): void {
    if (this.statePath) {
      this.save(this.statePath);
    }
  }

  toJSON(): SignatureRetryLimiterState {
    return {
      version: 1,
      maxRetriesPerSignature: this.maxRetriesPerSignature,
      counts: this.getCounts(),
      history: this.getHistory()
    };
  }

  save(targetPath?: string): void {
    const dest = targetPath ? resolve(targetPath) : this.statePath;
    if (!dest) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "Cannot save SignatureRetryLimiter without a targetPath or configured statePath",
        "R_missing_consequence"
      );
    }
    mkdirSync(dirname(dest), { recursive: true });
    const tmpPath = `${dest}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(this.toJSON(), null, 2)}\n`, "utf8");
    renameSync(tmpPath, dest);
  }

  static fromJSON(
    state: SignatureRetryLimiterState,
    options?: SignatureRetryLimiterOptions
  ): SignatureRetryLimiter {
    const limiter = new SignatureRetryLimiter(state.maxRetriesPerSignature, {
      statePath: undefined
    });
    if (state.counts && typeof state.counts === "object") {
      for (const [k, v] of Object.entries(state.counts)) {
        if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
          limiter.counts.set(k, Math.floor(v));
        }
      }
    }
    if (Array.isArray(state.history)) {
      for (const entry of state.history) {
        limiter.history.push({ ...entry });
      }
    }
    if (options?.statePath) {
      (limiter as { statePath?: string }).statePath = resolve(options.statePath);
      limiter.persistIfConfigured();
    }
    return limiter;
  }

  static load(statePath: string, maxRetriesPerSignature?: number): SignatureRetryLimiter {
    const absPath = resolve(statePath);
    if (existsSync(absPath)) {
      const parsed = JSON.parse(readFileSync(absPath, "utf8")) as Partial<SignatureRetryLimiterState>;
      const cap =
        maxRetriesPerSignature ??
        (typeof parsed.maxRetriesPerSignature === "number" &&
        Number.isInteger(parsed.maxRetriesPerSignature) &&
        parsed.maxRetriesPerSignature >= 1
          ? parsed.maxRetriesPerSignature
          : 3);
      return new SignatureRetryLimiter(cap, { statePath: absPath });
    }
    return new SignatureRetryLimiter(maxRetriesPerSignature ?? 3, { statePath: absPath });
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
    this.persistIfConfigured();
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
      this.persistIfConfigured();
      return;
    }
    this.counts.delete(this.normalizeSignature(rawSignature));
    this.persistIfConfigured();
  }
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

export interface WorkspaceSnapshotOptions {
  ignorePatterns?: readonly string[];
}

function globToRegExp(pattern: string): RegExp {
  let re = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += ".*";
        i += 1;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else if ("\\^$+?.()|[]{}".includes(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += "$";
  return new RegExp(re);
}

function compileIgnoreMatcher(
  ignorePatterns?: readonly string[]
): (relPath: string, name: string) => boolean {
  const exactNames = new Set<string>(SKIP_DIRS);
  const exactPaths: string[] = [];
  const nameRegexes: RegExp[] = [];
  const pathRegexes: RegExp[] = [];

  if (ignorePatterns) {
    for (const raw of ignorePatterns) {
      const normalized = raw.trim().replace(/^\.\//, "").replace(/\/+$/, "");
      if (!normalized) continue;
      const hasGlob = normalized.includes("*") || normalized.includes("?");
      const hasSlash = normalized.includes("/");
      if (hasGlob) {
        if (hasSlash) {
          pathRegexes.push(globToRegExp(normalized));
        } else {
          nameRegexes.push(globToRegExp(normalized));
        }
      } else if (hasSlash) {
        exactPaths.push(normalized);
      } else {
        exactNames.add(normalized);
      }
    }
  }

  return (relPath: string, name: string): boolean => {
    if (exactNames.has(name)) return true;
    const posixRel = relPath.replace(/\\/g, "/");
    for (const p of exactPaths) {
      if (posixRel === p || posixRel.startsWith(`${p}/`)) return true;
    }
    for (const rx of nameRegexes) {
      if (rx.test(name)) return true;
    }
    for (const rx of pathRegexes) {
      if (rx.test(posixRel)) return true;
    }
    return false;
  };
}

interface WalkedWorkspaceEntry {
  absPath: string;
  sha256: string;
  mode: number;
  isSymlink: boolean;
  linkTarget?: string;
}

function walkWorkspaceFiles(
  rootDir: string,
  shouldIgnore: (relPath: string, name: string) => boolean = (_rel, name) => SKIP_DIRS.has(name)
): Map<string, WalkedWorkspaceEntry> {
  const out = new Map<string, WalkedWorkspaceEntry>();
  const walk = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      const abs = join(dir, ent.name);
      const rel = relative(rootDir, abs);
      if (shouldIgnore(rel, ent.name)) continue;
      const st = lstatSync(abs);
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

function resolveGitDir(workspaceDir: string): string | null {
  try {
    const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
    return gitDir ? resolve(workspaceDir, gitDir) : null;
  } catch {
    return null;
  }
}

function listGitIgnoredFiles(workspaceDir: string): Set<string> {
  try {
    const out = execFileSync("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], {
      cwd: workspaceDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const ignored = new Set<string>();
    for (const entry of out.split("\0")) {
      if (entry) ignored.add(entry.replace(/\\/g, "/"));
    }
    return ignored;
  } catch {
    return new Set<string>();
  }
}

function fileSha256OrNull(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const h = createHash("sha256");
    h.update(readFileSync(filePath));
    return h.digest("hex");
  } catch {
    return null;
  }
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

export function captureWorkspaceSnapshot(
  workspaceDir: string,
  options?: WorkspaceSnapshotOptions
): WorkspaceSnapshotHandle {
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

  const shouldIgnore = compileIgnoreMatcher(options?.ignorePatterns);
  const isGit = isGitRepository(absWorkspace);
  const headSha = isGit ? gitHeadSha(absWorkspace) : null;
  const wasCleanBefore = isGit ? gitStatusPorcelain(absWorkspace).length === 0 : false;
  const useGitCleanRollback = isGit && wasCleanBefore && headSha !== null;

  const files = walkWorkspaceFiles(absWorkspace, shouldIgnore);
  const manifest = new Map<string, WorkspaceManifestEntry>();

  const sortedEntries = [...files.entries()].sort(([a], [b]) => a.localeCompare(b));
  const gitIgnoredSet = useGitCleanRollback ? listGitIgnoredFiles(absWorkspace) : new Set<string>();
  const hasGitIgnoredRegularFiles =
    useGitCleanRollback &&
    sortedEntries.some(([rel, info]) => !info.isSymlink && gitIgnoredSet.has(rel.replace(/\\/g, "/")));

  const backupDir =
    useGitCleanRollback && !hasGitIgnoredRegularFiles
      ? ""
      : mkdtempSync(join(tmpdir(), "zcode-tx-snap-"));

  // Snapshot git index when operating on a dirty git tree so git add / git commit side effects can be rolled back
  const gitDir = isGit && !useGitCleanRollback ? resolveGitDir(absWorkspace) : null;
  const gitIndexPath = gitDir ? join(gitDir, "index") : null;
  const gitIndexSha256 = gitIndexPath ? fileSha256OrNull(gitIndexPath) : null;
  const gitIndexBackupPath =
    gitIndexPath && gitIndexSha256 !== null && backupDir
      ? join(backupDir, ".git", "index")
      : null;
  if (gitIndexBackupPath && gitIndexPath) {
    mkdirSync(dirname(gitIndexBackupPath), { recursive: true });
    copyFileSync(gitIndexPath, gitIndexBackupPath);
  }

  const aggHash = createHash("sha256");
  for (const [rel, info] of sortedEntries) {
    const needsBackup =
      !info.isSymlink &&
      (!useGitCleanRollback || gitIgnoredSet.has(rel.replace(/\\/g, "/")));
    if (needsBackup && backupDir) {
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

  const isGitMetaDirty = (): boolean => {
    if (!isGit || useGitCleanRollback) return false;
    if (gitHeadSha(absWorkspace) !== headSha) return true;
    if (gitIndexPath && fileSha256OrNull(gitIndexPath) !== gitIndexSha256) return true;
    return false;
  };

  const isDirty = (): boolean => {
    if (isGitMetaDirty()) return true;
    const current = walkWorkspaceFiles(absWorkspace, shouldIgnore);
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
    if (backupDir) {
      rmSync(backupDir, { recursive: true, force: true });
    }
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

    // Single pre-rollback walk: derive both dirty status and expected change counts
    const preResetCurrent = walkWorkspaceFiles(absWorkspace, shouldIgnore);
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

    const gitMetaDirty = isGitMetaDirty();
    const dirty = expectedFilesRemoved > 0 || expectedFilesRestored > 0 || gitMetaDirty;
    if (dirty && !rollbackOnDirty) {
      throw new TransactionalRollbackError(
        "DIRTY_TIMEOUT_REFUSED",
        `Workspace "${absWorkspace}" became dirty during "${stepId}" (${reason}) and rollbackOnDirty is false`,
        1
      );
    }

    let filesRemoved = 0;
    let filesRestored = 0;

    if (dirty) {
      if (useGitCleanRollback && headSha) {
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
      } else if (isGit && !useGitCleanRollback && gitMetaDirty) {
        try {
          if (headSha && gitHeadSha(absWorkspace) !== headSha) {
            execFileSync("git", ["reset", "--soft", headSha], {
              cwd: absWorkspace,
              stdio: ["ignore", "pipe", "pipe"]
            });
          }
          if (gitIndexPath) {
            if (gitIndexBackupPath && existsSync(gitIndexBackupPath)) {
              copyFileSync(gitIndexBackupPath, gitIndexPath);
            } else if (gitIndexSha256 === null && existsSync(gitIndexPath)) {
              unlinkSync(gitIndexPath);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new TransactionalRollbackError(
            "ROLLBACK_FAILED",
            `dirty-tree git HEAD/index rollback failed: ${msg}`,
            1
          );
        }
      }

      // Reuse preResetCurrent when git reset did not run; otherwise re-walk to check residual diffs
      const current = useGitCleanRollback
        ? walkWorkspaceFiles(absWorkspace, shouldIgnore)
        : preResetCurrent;

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
            if (!backupDir) {
              throw new TransactionalRollbackError(
                "ROLLBACK_FAILED",
                `Clean-git rollback did not restore "${rel}" and no temp backup was created`,
                1
              );
            }
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

      filesRemoved = Math.max(expectedFilesRemoved, fsRemoved);
      filesRestored = Math.max(expectedFilesRestored, fsRestored);

      // Prune empty directories left behind by deleted files
      const pruneEmptyDirs = (dir: string): boolean => {
        const entries = readdirSync(dir, { withFileTypes: true });
        let hasContent = false;
        for (const ent of entries) {
          const abs = join(dir, ent.name);
          const rel = relative(absWorkspace, abs);
          if (shouldIgnore(rel, ent.name)) {
            hasContent = true;
            continue;
          }
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

export type TransactionalStepCompensateFn = (
  transition: Transition,
  ctx: { attempt: number; reason: string }
) => Promise<void> | void;

export interface TransactionalStepSpec {
  run: TransactionalStepFn;
  timeoutMs?: number;
  abortGraceMs?: number;
  compensate?: TransactionalStepCompensateFn;
}

export type TransactionalStepsInput =
  | TransactionalStepFn
  | Readonly<Record<string, TransactionalStepFn | TransactionalStepSpec>>;

export interface TransactionalRollbackContext {
  workspaceDir?: string;
  rollbackOnDirty?: boolean;
  maxRetriesPerSignature?: number;
  stepTimeoutMs?: number;
  abortGraceMs?: number;
  maxWallClockMs?: number;
  maxAttemptsTotal?: number;
  maxSilentSteps?: number;
  snapshotIgnorePatterns?: readonly string[];
  lifecycleSavepoint?: boolean;
  retryLimiter?: SignatureRetryLimiter;
  retryStatePath?: string;
  throwOnRefusal?: boolean;
}

export interface TransactionalLifecycleResult {
  ok: boolean;
  standing: "ALIVE" | "REFUSED" | "BLOCKED";
  refusalCode?: string;
  errorDetail?: string;
  rolledBackCount: number;
  compensatedCount: number;
  attemptsExecuted: number;
  events: TxOcelEventLike[];
  retryCounts: Record<string, number>;
  finalMarking: Record<string, number>;
}

function resolveStepSpec(
  steps: TransactionalStepsInput,
  t: Transition
): TransactionalStepSpec | null {
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
  timeoutMs: number | undefined,
  abortGraceMs = 250
): Promise<TransactionalStepOutcome> {
  const ac = new AbortController();
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await fn(transition, { attempt, signal: ac.signal });
  }
  let runSettled = false;
  const runPromise = Promise.resolve().then(() => fn(transition, { attempt, signal: ac.signal }));
  const settledPromise = runPromise.then(
    () => {
      runSettled = true;
    },
    () => {
      runSettled = true;
    }
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    return await Promise.race([
      runPromise,
      new Promise<TransactionalStepOutcome>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
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
  } catch (err) {
    if (timedOut && !runSettled) {
      const graceMs = Number.isFinite(abortGraceMs) && abortGraceMs >= 0 ? abortGraceMs : 250;
      if (graceMs > 0) {
        let graceTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            settledPromise,
            new Promise<void>((resolveGrace) => {
              graceTimer = setTimeout(resolveGrace, graceMs);
            })
          ]);
        } finally {
          if (graceTimer !== undefined) clearTimeout(graceTimer);
        }
      }
      if (!runSettled) {
        throw new TransactionalRollbackError(
          "ROLLBACK_FAILED",
          `Transition "${transition.id}" did not settle within ${graceMs}ms after abort; refusing rollback to prevent concurrent workspace corruption`,
          1
        );
      }
    }
    throw err;
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
    new SignatureRetryLimiter(
      rollbackCtx.maxRetriesPerSignature ?? 3,
      rollbackCtx.retryStatePath ? { statePath: rollbackCtx.retryStatePath } : undefined
    );
  const rollbackOnDirty = rollbackCtx.rollbackOnDirty ?? true;
  const maxWallClockMs = rollbackCtx.maxWallClockMs ?? 60_000;
  const maxAttemptsTotal = rollbackCtx.maxAttemptsTotal ?? Math.max(16, net.transitions.length * 8);
  const maxSilentSteps = rollbackCtx.maxSilentSteps ?? Math.max(100, net.transitions.length * 16);
  const defaultAbortGraceMs = rollbackCtx.abortGraceMs ?? 250;
  const snapshotOpts: WorkspaceSnapshotOptions | undefined = rollbackCtx.snapshotIgnorePatterns
    ? { ignorePatterns: rollbackCtx.snapshotIgnorePatterns }
    : undefined;
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

  const drainSilent = (): { ok: true } | { ok: false; code: "SILENT_CYCLE_DETECTED" | "LIFECYCLE_TIMEOUT"; detail: string } => {
    const visited = new Set<string>([marking.join(",")]);
    let silentSteps = 0;
    let progressed = true;
    while (progressed) {
      if (Date.now() - startedAt > maxWallClockMs) {
        return {
          ok: false,
          code: "LIFECYCLE_TIMEOUT",
          detail: `Lifecycle exceeded maxWallClockMs=${maxWallClockMs} during silent transition draining`
        };
      }
      progressed = false;
      for (let ti = 0; ti < net.transitions.length; ti++) {
        const t = net.transitions[ti]!;
        if (t.silent && isEnabledAt(ti)) {
          for (const p of net.preIndices[ti]!) marking[p]! -= 1;
          for (const p of net.postIndices[ti]!) marking[p]! += 1;
          silentSteps += 1;
          const key = marking.join(",");
          if (visited.has(key)) {
            return {
              ok: false,
              code: "SILENT_CYCLE_DETECTED",
              detail: `Silent transition "${t.id}" revisited marking [${key}] after ${silentSteps} silent step(s)`
            };
          }
          if (silentSteps >= maxSilentSteps) {
            return {
              ok: false,
              code: "SILENT_CYCLE_DETECTED",
              detail: `Silent transition draining exceeded maxSilentSteps=${maxSilentSteps} at transition "${t.id}"`
            };
          }
          visited.add(key);
          progressed = true;
        }
      }
    }
    return { ok: true };
  };

  let rolledBackCount = 0;
  let compensatedCount = 0;
  let attemptsExecuted = 0;
  const stepAttempts = new Map<string, number>();
  const committedSteps: Array<{
    transition: Transition;
    attempt: number;
    compensate?: TransactionalStepCompensateFn;
  }> = [];

  let lifecycleSnap: WorkspaceSnapshotHandle | null = null;
  if (rollbackCtx.lifecycleSavepoint && rollbackCtx.workspaceDir) {
    try {
      lifecycleSnap = captureWorkspaceSnapshot(rollbackCtx.workspaceDir, snapshotOpts);
    } catch (err) {
      const code = err instanceof TransactionalRollbackError ? err.code : "ROLLBACK_FAILED";
      const msg = err instanceof Error ? err.message : String(err);
      pushEvent("transition_refused", [{ name: "reason", value: code }, { name: "detail", value: msg }]);
      if (rollbackCtx.throwOnRefusal) throw err;
      return {
        ok: false,
        standing: "BLOCKED",
        refusalCode: code,
        errorDetail: msg,
        rolledBackCount: 0,
        compensatedCount: 0,
        attemptsExecuted: 0,
        events,
        retryCounts: limiter.getCounts(),
        finalMarking: { [net.places[net.sourceIdx]!.id]: 1 }
      };
    }
  }

  const buildFinalMarking = (): Record<string, number> => {
    const out: Record<string, number> = {};
    for (let i = 0; i < net.places.length; i++) {
      if (marking[i]! > 0) out[net.places[i]!.id] = marking[i]!;
    }
    return out;
  };

  const failReturn = async (
    standing: "REFUSED" | "BLOCKED",
    refusalCode: string,
    errorDetail: string,
    errToThrow?: unknown
  ): Promise<TransactionalLifecycleResult> => {
    // Saga-style LIFO compensation of previously committed transitions
    for (let i = committedSteps.length - 1; i >= 0; i--) {
      const entry = committedSteps[i]!;
      if (!entry.compensate) continue;
      try {
        await entry.compensate(entry.transition, {
          attempt: entry.attempt,
          reason: refusalCode
        });
        compensatedCount += 1;
        pushEvent("transition_compensated", [
          { name: "transition", value: entry.transition.id },
          { name: "attempt", value: String(entry.attempt) },
          { name: "reason", value: refusalCode },
          { name: "status", value: "ok" }
        ]);
      } catch (compErr) {
        const compMsg = compErr instanceof Error ? compErr.message : String(compErr);
        pushEvent("transition_compensated", [
          { name: "transition", value: entry.transition.id },
          { name: "attempt", value: String(entry.attempt) },
          { name: "reason", value: refusalCode },
          { name: "status", value: "failed" },
          { name: "detail", value: compMsg }
        ]);
      }
    }

    if (lifecycleSnap) {
      try {
        const rb = lifecycleSnap.rollback(`lifecycle_${refusalCode.toLowerCase()}`, "__lifecycle__", rollbackOnDirty);
        rolledBackCount += 1;
        events.push(rb.event);
      } catch (rbErr) {
        const rbMsg = rbErr instanceof Error ? rbErr.message : String(rbErr);
        pushEvent("transition_refused", [
          { name: "transition", value: "__lifecycle__" },
          { name: "reason", value: "ROLLBACK_FAILED" },
          { name: "detail", value: rbMsg }
        ]);
      } finally {
        lifecycleSnap.dispose();
        lifecycleSnap = null;
      }
    }

    if (rollbackCtx.throwOnRefusal && errToThrow) {
      throw errToThrow;
    }
    return {
      ok: false,
      standing,
      refusalCode,
      errorDetail,
      rolledBackCount,
      compensatedCount,
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
      return await failReturn("BLOCKED", "LIFECYCLE_TIMEOUT", msg, new TransactionalRollbackError("LIFECYCLE_TIMEOUT", msg, 1));
    }

    const drainRes = drainSilent();
    if (!drainRes.ok) {
      pushEvent("transition_refused", [
        { name: "reason", value: drainRes.code },
        { name: "detail", value: drainRes.detail }
      ]);
      return await failReturn(
        "BLOCKED",
        drainRes.code,
        drainRes.detail,
        new TransactionalRollbackError(drainRes.code, drainRes.detail, 1)
      );
    }
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
      return await failReturn("BLOCKED", "DEADLOCK", msg);
    }

    const ti = enabledIndices[0]!;
    const t = net.transitions[ti]!;
    const spec = resolveStepSpec(steps, t);
    if (!spec) {
      const msg = `No step handler configured for transition "${t.id}" (${t.activityId ?? t.label})`;
      pushEvent("transition_refused", [{ name: "transition", value: t.id }, { name: "detail", value: msg }]);
      return await failReturn("BLOCKED", "MISSING_STEP_HANDLER", msg);
    }

    attemptsExecuted += 1;
    if (attemptsExecuted > maxAttemptsTotal) {
      const msg = `Lifecycle exceeded maxAttemptsTotal=${maxAttemptsTotal}`;
      pushEvent("retry_budget_exhausted", [{ name: "transition", value: t.id }, { name: "detail", value: msg }]);
      const err = new ComplianceRefusalError("RETRY_BUDGET_EXHAUSTED", msg, "mu_on_O");
      return await failReturn("REFUSED", "RETRY_BUDGET_EXHAUSTED", msg, err);
    }

    const attempt = (stepAttempts.get(t.id) ?? 0) + 1;
    stepAttempts.set(t.id, attempt);

    let snap: WorkspaceSnapshotHandle | null = null;
    try {
      if (rollbackCtx.workspaceDir) {
        snap = captureWorkspaceSnapshot(rollbackCtx.workspaceDir, snapshotOpts);
      }
    } catch (err) {
      const code = err instanceof TransactionalRollbackError ? err.code : "ROLLBACK_FAILED";
      const msg = err instanceof Error ? err.message : String(err);
      pushEvent("transition_refused", [{ name: "transition", value: t.id }, { name: "reason", value: code }, { name: "detail", value: msg }]);
      return await failReturn("BLOCKED", code, msg, err);
    }

    // Reserve input tokens
    for (const p of net.preIndices[ti]!) marking[p]! -= 1;

    pushEvent(
      "transition_fired",
      [{ name: "transition", value: t.id }, { name: "attempt", value: String(attempt) }]
    );

    const stepTimeout = spec.timeoutMs ?? rollbackCtx.stepTimeoutMs;
    const stepAbortGrace = spec.abortGraceMs ?? defaultAbortGraceMs;
    let outcome: TransactionalStepOutcome | undefined;
    let caughtError: unknown;

    try {
      outcome = await runWithTimeout(spec.run, t, attempt, stepTimeout, stepAbortGrace);
    } catch (err) {
      caughtError = err;
    }

    if (outcome?.ok) {
      try {
        for (const p of net.postIndices[ti]!) marking[p]! += 1;
        committedSteps.push({
          transition: t,
          attempt,
          compensate: spec.compensate
        });
        pushEvent("transition_completed", [
          { name: "transition", value: t.id },
          { name: "attempt", value: String(attempt) }
        ]);
      } finally {
        snap?.dispose();
      }
      continue;
    }

    // If timed-out step failed to settle within abortGraceMs, fail closed without invoking snap.rollback()
    if (caughtError instanceof TransactionalRollbackError && caughtError.code === "ROLLBACK_FAILED") {
      snap?.dispose();
      for (const p of net.preIndices[ti]!) marking[p]! += 1;
      pushEvent("transition_refused", [
        { name: "transition", value: t.id },
        { name: "reason", value: "ROLLBACK_FAILED" },
        { name: "detail", value: caughtError.message }
      ]);
      return await failReturn("REFUSED", "ROLLBACK_FAILED", caughtError.message, caughtError);
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
        for (const p of net.preIndices[ti]!) marking[p]! += 1;
        const code = rbErr instanceof TransactionalRollbackError ? rbErr.code : "ROLLBACK_FAILED";
        const msg = rbErr instanceof Error ? rbErr.message : String(rbErr);
        pushEvent("transition_refused", [{ name: "transition", value: t.id }, { name: "reason", value: code }, { name: "detail", value: msg }]);
        return await failReturn("REFUSED", code, msg, rbErr);
      } finally {
        snap.dispose();
      }
    }

    const canRetryFlag = outcome?.retryable !== false;
    if (!canRetryFlag) {
      for (const p of net.preIndices[ti]!) marking[p]! += 1;
      const msg = outcome?.detail ?? `Non-retryable failure on "${t.id}"`;
      pushEvent("transition_refused", [{ name: "transition", value: t.id }, { name: "detail", value: msg }]);
      return await failReturn("REFUSED", "STEP_REFUSED", msg);
    }

    try {
      limiter.recordFailure(errorSignature, t.id);
    } catch (limitErr) {
      for (const p of net.preIndices[ti]!) marking[p]! += 1;
      const msg = limitErr instanceof Error ? limitErr.message : String(limitErr);
      pushEvent("retry_budget_exhausted", [
        { name: "transition", value: t.id },
        { name: "signature", value: limiter.normalizeSignature(errorSignature) },
        { name: "detail", value: msg }
      ]);
      return await failReturn("REFUSED", "RETRY_BUDGET_EXHAUSTED", msg, limitErr);
    }

    // Return tokens cleanly ONLY after atomic rollback & retry budget check succeeded
    for (const p of net.preIndices[ti]!) marking[p]! += 1;
    pushEvent("wip_backoff", [
      { name: "transition", value: t.id },
      { name: "reason", value: reason },
      { name: "signature", value: limiter.normalizeSignature(errorSignature) }
    ]);
  }

  lifecycleSnap?.dispose();

  return {
    ok: true,
    standing: "ALIVE",
    rolledBackCount,
    compensatedCount,
    attemptsExecuted,
    events,
    retryCounts: limiter.getCounts(),
    finalMarking: buildFinalMarking()
  };
}
