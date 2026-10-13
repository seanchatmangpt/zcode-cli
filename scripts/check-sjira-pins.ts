// check-sjira-pins.ts — drift detector for GENERATED semantic-jira HDDL pins.
//
// The plan/*.hddl files under docs/sjira/*/plan/ are stamped by the
// semantic-jira-pack generator (ggen_igniter) with (repository, base-sha)
// pairs. The pins are observations, not leases: a pin that is no longer an
// ancestor of the pinned repo's HEAD means the order's subject moved after
// the order was written. This script parses the pins from the generated
// files, runs the real git ancestry check, and classifies drift against a
// checked-in allowlist of expected-stale pins (with as-of dates).
//
// Exit codes:
//   0 — every pin is ancestor-of-HEAD or allowlisted expected-stale
//   1 — unallowlisted drift (a pin no longer an ancestor: the detector's target)
//   2 — configuration error (no pins found, or allowlist entry matching nothing)
//
// Read-only: `git merge-base --is-ancestor` + `git cat-file -e` against the
// local checkouts. Never fetches, never mutates.

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const REPO_ROOT = join(import.meta.dir, "..");

// Local checkout roots per pinned repository slug.
const REPO_PATHS: Record<string, string> = {
  "seanchatmangpt/xaas": "/Users/sac/xaas",
  "seanchatmangpt/xfetch": "/Users/sac/xfetch",
  "seanchatmangpt/ggen": "/Users/sac/ggen",
  "seanchatmangpt/ggen_igniter": "/Users/sac/ggen_igniter",
  "seanchatmangpt/ggen-marketplace": "/Users/sac/ggen-marketplace",
  "seanchatmangpt/zcode-cli": "/Users/sac/zcode-cli",
};

// Expected-stale pins: the historical corpus predates current heads by
// design. Each entry carries an as-of date for the classification. Skipped
// pins never mask FUTURE drift: any pin absent from this list must still be
// an ancestor of its repo's HEAD, or the check fails.
const ALLOWLIST: Record<string, string> = {
  // v26.9.21 corpus — written 2026-09-21 against the zcode-cli head of that
  // day; corpus predates current heads by design.
  "seanchatmangpt/zcode-cli@5e20ab3c9dff97edd35deee6759c5e5961ee1a05":
    "v26.9.21 corpus predates current head, as-of 2026-10-13",
  // v26.9.22 corpus — written 2026-09-22. ZOCEL-014/015 previously carried a
  // zcode-cli sha under the xaas label; corrected 2026-10-13 to the real xaas
  // observed subject 2d229c27 (an ancestor of xaas HEAD), so no allowlist
  // entry is needed for that pin anymore.
};

export interface Pin {
  file: string; // relative to repo root
  workorder: string;
  repo: string;
  sha: string;
}

/** Scan docs/sjira/<ver>/plan HDDLs for `(repository WO "slug")` + `(base-sha WO sha)` pairs. */
export function parsePins(root: string): Pin[] {
  const pins: Pin[] = [];
  const versions = readdirSync(join(root, "docs", "sjira"));
  for (const v of versions) {
    const planDir = join(root, "docs", "sjira", v, "plan");
    if (!existsSync(planDir)) continue;
    for (const f of readdirSync(planDir).filter((f) => f.endsWith(".hddl"))) {
      const rel = `docs/sjira/${v}/plan/${f}`;
      const text = readFileSync(join(planDir, f), "utf8");
      const repo = text.match(/\(repository\s+(\S+)\s+"([^"]+)"\)/)?.[2];
      const sha = text.match(/\(base-sha\s+(\S+)\s+([0-9a-f]{40})\)/)?.[2];
      const wo = basename(f, ".hddl");
      if (repo && sha) {
        pins.push({ file: rel, workorder: wo, repo, sha });
      } else if (text.includes("(base-sha")) {
        throw new Error(`${rel}: base-sha present but repo/sha unparseable`);
      }
    }
  }
  return pins;
}

export function isAncestor(repoPath: string, sha: string): boolean {
  if (!existsSync(join(repoPath, ".git"))) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: repoPath, stdio: "ignore" });
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd: repoPath, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function run(root: string = REPO_ROOT): { code: number; report: string } {
  const pins = parsePins(root);
  if (pins.length === 0) {
    return {
      code: 2,
      report: "check-sjira-pins: no pins found under docs/sjira/*/plan — configuration error",
    };
  }

  const lines: string[] = [];
  let drifted = 0;
  let skipped = 0;
  const seenAllowlist = new Set<string>();

  for (const pin of pins) {
    const key = `${pin.repo}@${pin.sha}`;
    const repoPath = REPO_PATHS[pin.repo];
    if (!repoPath || !existsSync(join(repoPath, ".git"))) {
      // Sibling absent — BLOCKED skip, not a pass.
      skipped++;
      lines.push(`BLOCKED:skip  ${key}  (${pin.file}) — sibling repo not present at expected path`);
      continue;
    }
    seenAllowlist.add(key);
    const ancestor = isAncestor(repoPath, pin.sha);
    const allowlisted = key in ALLOWLIST;
    if (ancestor && !allowlisted) {
      lines.push(`OK           ${key}  (${pin.file})`);
    } else if (!ancestor && allowlisted) {
      skipped++;
      lines.push(`EXPECTED-STALE ${key}  (${pin.file}) — allowlisted: ${ALLOWLIST[key]}`);
    } else if (ancestor && allowlisted) {
      lines.push(`OK           ${key}  (${pin.file}) — allowlisted but currently ancestor (allowlist entry stale; consider pruning)`);
    } else {
      drifted++;
      lines.push(`DRIFT        ${key}  (${pin.file}) — pin is NOT an ancestor of HEAD and not allowlisted`);
    }
  }

  // Allowlist entries matching nothing on disk are config rot.
  const dead = Object.keys(ALLOWLIST).filter((k) => !seenAllowlist.has(k));
  for (const k of dead) {
    lines.push(`WARN         allowlist entry ${k} matches no pin on disk (prune it)`);
  }

  lines.push(
    `summary: ${pins.length} pins, ${drifted} drifted, ${skipped} expected-stale/blocked`,
  );
  return { code: drifted > 0 ? 1 : 0, report: lines.join("\n") };
}

if (import.meta.main) {
  const { code, report } = run();
  console.log(report);
  process.exit(code);
}
