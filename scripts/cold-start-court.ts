#!/usr/bin/env bun
/**
 * Cold-start bootstrap court — GALL-FRI-0925 gate G2 (docs/sjira/v26.9.22/stop-court.ttl sj:cp-g2).
 *
 * Proves the ecosystem reconstructs its world from durable artifacts alone: repos, canonical
 * RDF graphs, ticket indexes, receipts. Reads NOTHING from conversation/session state, nothing
 * from AGENTS.md/CLAUDE.md, makes no network or model calls. "Cold" = only durable artifacts.
 *
 * Ceiling OBSERVE: read-only git replays + file reads; the only mutation is this court's own
 * receipt. Fail-closed: any unresolvable repo or missing required artifact drops standing
 * below ALIVE and exits 1.
 *
 * Usage: bun scripts/cold-start-court.ts
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const RECEIPTS_DIR = join(REPO, "receipts", "v26.9.22");
const RECEIPT_PATH = join(RECEIPTS_DIR, "g2-cold-start.json");

/** Repos the cold start must resolve from durable state alone (fixed manifest, no discovery). */
const REPOS = [
  "/Users/sac/dev/zcode-cli",
  "/Users/sac/xaas",
  "/Users/sac/ggen_igniter",
  "/Users/sac/ggen-marketplace",
  "/Users/sac/ash_a2a",
  "/Users/sac/ash_atlassian",
  "/Users/sac/ggen",
  "/Users/sac/ferroplan",
  "/Users/sac/ash_surface",
  "/Users/sac/zoela_phx",
];

/** Required canonical artifacts: absence of any drops standing. Receipts dirs are observed if present. */
const TTL_ARTIFACTS = [
  "/Users/sac/dev/zcode-cli/docs/sjira/v26.9.22/work-orders.ttl",
  "/Users/sac/dev/zcode-cli/docs/sjira/v26.9.22/stop-court.ttl",
];
const INDEX_ARTIFACT = "/Users/sac/xaas/docs/sjira/v26.9.22/index.json";
const RECEIPT_DIRS = [join(REPO, "receipts", "v26.9.22"), "/Users/sac/xaas/receipts/v26.9.22"];

type RepoEntry =
  | { path: string; resolved: true; branch: string; head: string; subject: string }
  | { path: string; resolved: false; reason: string };

interface ReplayCommand {
  cmd: string;
  cwd: string;
  exit: number;
  summary?: string;
}

interface ArtifactRead {
  path: string;
  present: boolean;
  identifiers?: number;
  entries?: number;
  receipts?: number;
  templates_skipped?: number;
  standing_counts?: Record<string, number>;
  files?: string[];
  parse_error?: string;
}

// ── git via absolute path resolution ─ typed unresolvable, never a crash ──
function resolveGitBinary(): string | null {
  for (const candidate of ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const gitBinary = resolveGitBinary();
const commands: ReplayCommand[] = [];

function git(args: string[], cwd: string): { exit: number; out: string } {
  const cmd = ["git", ...args].join(" ");
  if (!gitBinary) {
    commands.push({ cmd, cwd, exit: 127, summary: "git binary not found at any known absolute path" });
    return { exit: 127, out: "" };
  }
  try {
    const proc = Bun.spawnSync([gitBinary, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    const exit = typeof proc.exitCode === "number" ? proc.exitCode : 127;
    const out = proc.stdout.toString().trim();
    const err = proc.stderr.toString().trim();
    commands.push({ cmd, cwd, exit, summary: (out || err).split("\n")[0]?.slice(0, 160) });
    return { exit, out };
  } catch (e) {
    commands.push({ cmd, cwd, exit: 127, summary: `spawn failed: ${(e as Error).message}` });
    return { exit: 127, out: "" };
  }
}

function resolveRepo(path: string): RepoEntry {
  if (!existsSync(path)) return { path, resolved: false, reason: "missing_directory" };
  if (!existsSync(join(path, ".git"))) return { path, resolved: false, reason: "not_a_git_worktree" };
  const branch = git(["-C", path, "branch", "--show-current"], REPO);
  const head = git(["-C", path, "rev-parse", "HEAD"], REPO);
  const subject = git(["-C", path, "log", "-1", "--format=%s"], REPO);
  if (branch.exit !== 0 || head.exit !== 0 || subject.exit !== 0) {
    return { path, resolved: false, reason: "git_replay_failed" };
  }
  return { path, resolved: true, branch: branch.out, head: head.out, subject: subject.out };
}

function standingCounts(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const m of text.matchAll(/sj:standing\s+"([^"]+)"/g)) {
    const value = m[1];
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function readTtlArtifact(path: string): ArtifactRead {
  if (!existsSync(path)) return { path, present: false };
  const text = readFileSync(path, "utf8");
  return {
    path,
    present: true,
    identifiers: [...text.matchAll(/dcterms:identifier\s+"[^"]+"/g)].length,
    standing_counts: standingCounts(text),
  };
}

function readIndexArtifact(path: string): ArtifactRead {
  if (!existsSync(path)) return { path, present: false };
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const entries = Array.isArray(parsed)
      ? parsed.length
      : Object.keys(parsed as Record<string, unknown>).length;
    return { path, present: true, entries };
  } catch (e) {
    return { path, present: true, parse_error: (e as Error).message };
  }
}

function readReceiptDir(dir: string): ArtifactRead {
  if (!existsSync(dir)) return { path: dir, present: false };
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  const receipts = files.filter((f) => !f.startsWith("_"));
  return {
    path: dir,
    present: true,
    receipts: receipts.length,
    templates_skipped: files.length - receipts.length,
    files: receipts,
  };
}

// ── reconstruct the world from durable artifacts only ──
const repos = REPOS.map(resolveRepo);
const ttlReads = TTL_ARTIFACTS.map(readTtlArtifact);
const indexRead = readIndexArtifact(INDEX_ARTIFACT);
const receiptDirReads = RECEIPT_DIRS.map(readReceiptDir);
const artifacts: ArtifactRead[] = [...ttlReads, indexRead, ...receiptDirReads];

const workOrders = ttlReads[0];
const frontierCounts = workOrders?.standing_counts ?? {};
const frontierTotal = Object.values(frontierCounts).reduce((a, b) => a + b, 0);

const failures: string[] = [];
for (const r of repos) if (!r.resolved) failures.push(`repo unresolvable: ${r.path} (${r.reason})`);
for (const a of artifacts) if (!a.present && RECEIPT_DIRS.indexOf(a.path) === -1) failures.push(`artifact missing: ${a.path}`);
if (workOrders?.present && (workOrders.identifiers ?? 0) === 0) {
  failures.push("work-orders.ttl parsed with zero dcterms:identifier facts");
}
if (workOrders?.present && frontierTotal === 0) {
  failures.push("work-orders.ttl parsed with zero sj:standing facts");
}

// identity: zcode-cli HEAD is the subject; its parent is the base. No sha = no receipt
// (fabricating identity is worse than refusing: R_missing_identity).
const zcode = repos.find((r) => r.path === REPO);
if (!zcode || !zcode.resolved) {
  console.error("REFUSED: zcode-cli HEAD unresolvable — cannot build receipt identity (R_missing_identity).");
  process.exit(1);
}
const subjectSha = zcode.head;
const base = git(["-C", REPO, "rev-parse", "HEAD~1"], REPO);
const baseSha = base.exit === 0 ? base.out : subjectSha;

const resolvedCount = repos.filter((r) => r.resolved).length;
const standingValue =
  failures.length === 0 ? "ALIVE" : resolvedCount > 0 ? "PARTIAL_ALIVE" : "BLOCKED:mu_on_O";

const derivedFrom =
  failures.length === 0
    ? `${commands.length} git replay commands all exited 0 (see replay.commands) at zcode-cli HEAD ${subjectSha}; ` +
      `work-orders.ttl sj:standing counts ${JSON.stringify(frontierCounts)}; all required artifacts present`
    : `${commands.length} git replay commands at zcode-cli HEAD ${subjectSha}; failures: ${failures.join("; ")}`;

const receipt = {
  identity: {
    subject: "G2",
    repo: REPO,
    subject_sha: subjectSha,
    base_sha: baseSha,
    checkpoint: "sj:cp-g2 (Cold bootstrap — system reconstructs itself without conversational context)",
  },
  authority: {
    ceiling: "OBSERVE",
    grant: "NONE",
    actor: "zcode-cli:scripts/cold-start-court.ts",
  },
  consequence: {
    commits: [],
    files_changed: ["scripts/cold-start-court.ts", "receipts/v26.9.22/g2-cold-start.json"],
    remote_effects: [],
  },
  replay: {
    commands,
    durable_location: "receipts/v26.9.22/g2-cold-start.json",
  },
  standing: {
    value: standingValue,
    derived_from: derivedFrom,
    ...(standingValue !== "ALIVE" ? { broken_term: "mu_on_O" } : {}),
  },
  // context below is extra evidence; the schema permits additional properties
  frontier: {
    standing_counts: frontierCounts,
    work_orders_ttl_identifiers: workOrders?.identifiers ?? 0,
    stop_court_ttl_identifiers: ttlReads[1]?.identifiers ?? 0,
    xaas_index_entries: indexRead.entries ?? 0,
  },
  repos,
  artifacts,
  cold_start: {
    session_state_read: false,
    prompt_files_read: false,
    network_or_model_calls: 0,
  },
};

mkdirSync(RECEIPTS_DIR, { recursive: true });
writeFileSync(RECEIPT_PATH, JSON.stringify(receipt, null, 2) + "\n");

console.log("G2 cold-start court (ceiling OBSERVE, cold = durable artifacts only)");
console.log(`  repos resolved: ${resolvedCount}/${REPOS.length}`);
console.log(
  `  orders: work-orders.ttl ${workOrders?.identifiers ?? 0} identifiers, ` +
    `stop-court.ttl ${ttlReads[1]?.identifiers ?? 0}, xaas index.json ${indexRead.entries ?? 0} entries`,
);
console.log(`  frontier standing counts: ${JSON.stringify(frontierCounts)}`);
console.log(
  `  receipts: ${receiptDirReads
    .map((d) => `${relative(REPO, d.path)} ${d.present ? d.receipts : "absent"}`)
    .join(", ")}`,
);
console.log(`  standing: ${standingValue}`);
console.log(`  receipt: ${relative(REPO, RECEIPT_PATH)}`);
if (failures.length > 0) {
  console.error("REFUSED below ALIVE:");
  for (const f of failures) console.error(`  - ${f}`);
}
process.exit(failures.length === 0 ? 0 : 1);
