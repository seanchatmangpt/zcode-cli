#!/usr/bin/env bun
/**
 * Validate DfCM receipts (JSON files under receipts/, recursive).
 *
 * Fail-closed gates (EU AI Act record-keeping / receipt integrity):
 *   1. Zero receipts → REFUSED (a gate that never runs admits nothing).
 *   2. In-repo integrity (always runs; does not depend on ~/.claude):
 *      - any node with standing.value === "ALIVE" and a sibling replay.commands
 *        entry with exit !== 0 → REFUSED (nested repair sections included)
 *      - every identity.base_sha / identity.subject_sha must be 40-hex and
 *        resolve as a commit in this repository
 *   3. External schema validator:
 *      prefer ~/.zcode/dfcm/validate_receipt.py over ~/.claude/dfcm/...
 *      (legacy Claude path must not mask a zcode refusal or substitute for
 *      missing content checks). Missing external tool → REFUSED by default
 *      (fail-closed). Set DFCM_ALLOW_INTEGRITY_ONLY=1 to run the integrity
 *      floor alone on hosts without the python validator.
 *
 * Usage: bun scripts/validate-receipts.ts [--staged]
 *   --staged: only validate receipts staged in git (for pre-commit use).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? "";
const REPO_ROOT = join(import.meta.dir, "..");
const onlyStaged = process.argv.includes("--staged");
const allowIntegrityOnly = process.env.DFCM_ALLOW_INTEGRITY_ONLY === "1";

const SHA40 = /^[0-9a-f]{40}$/i;

export type IntegrityFinding = {
  path: string;
  rule: "ALIVE_WITH_NONZERO_EXIT" | "BOGUS_SHA" | "PARSE_ERROR";
  detail: string;
};

/** Prefer product path (~/.zcode); Claude path is legacy fallback only. */
export function resolveExternalValidator(home = HOME): {
  path: string | null;
  source: "zcode" | "claude" | "missing";
} {
  const zcode = join(home, ".zcode", "dfcm", "validate_receipt.py");
  if (existsSync(zcode)) return { path: zcode, source: "zcode" };
  const claude = join(home, ".claude", "dfcm", "validate_receipt.py");
  if (existsSync(claude)) return { path: claude, source: "claude" };
  return { path: null, source: "missing" };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function standingValue(node: Record<string, unknown>): string | null {
  const standing = node.standing;
  if (typeof standing === "string") return standing;
  if (isRecord(standing) && typeof standing.value === "string") return standing.value;
  return null;
}

function collectNonzeroExits(
  node: Record<string, unknown>,
): Array<{ cmd: string; exit: number }> {
  const replay = node.replay;
  if (!isRecord(replay) || !Array.isArray(replay.commands)) return [];
  const out: Array<{ cmd: string; exit: number }> = [];
  for (const raw of replay.commands) {
    if (!isRecord(raw)) continue;
    const exit = raw.exit;
    if (typeof exit === "number" && exit !== 0) {
      out.push({
        cmd: typeof raw.cmd === "string" ? raw.cmd : "(unknown cmd)",
        exit,
      });
    }
  }
  return out;
}

function walkIntegrity(
  node: unknown,
  pathPrefix: string,
  findings: IntegrityFinding[],
  filePath: string,
  shaExists: (sha: string) => boolean,
): void {
  if (Array.isArray(node)) {
    node.forEach((child, i) =>
      walkIntegrity(child, `${pathPrefix}[${i}]`, findings, filePath, shaExists),
    );
    return;
  }
  if (!isRecord(node)) return;

  const standing = standingValue(node);
  if (standing === "ALIVE") {
    const nonzero = collectNonzeroExits(node);
    for (const nz of nonzero) {
      findings.push({
        path: filePath,
        rule: "ALIVE_WITH_NONZERO_EXIT",
        detail: `${pathPrefix || "$"} standing=ALIVE but replay exit ${nz.exit}: ${nz.cmd}`,
      });
    }
  }

  const identity = node.identity;
  if (isRecord(identity)) {
    for (const key of ["base_sha", "subject_sha"] as const) {
      const sha = identity[key];
      if (typeof sha !== "string") continue;
      if (!SHA40.test(sha)) {
        findings.push({
          path: filePath,
          rule: "BOGUS_SHA",
          detail: `${pathPrefix || "$"}.identity.${key} is not a 40-hex commit: ${sha}`,
        });
        continue;
      }
      if (!shaExists(sha)) {
        findings.push({
          path: filePath,
          rule: "BOGUS_SHA",
          detail: `${pathPrefix || "$"}.identity.${key}=${sha} is not a commit in this repository`,
        });
      }
    }
  }

  for (const [k, v] of Object.entries(node)) {
    walkIntegrity(v, pathPrefix ? `${pathPrefix}.${k}` : k, findings, filePath, shaExists);
  }
}

function defaultShaExists(sha: string): boolean {
  const probe = Bun.spawnSync(["git", "-C", REPO_ROOT, "cat-file", "-t", sha], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return probe.exitCode === 0 && probe.stdout.toString().trim() === "commit";
}

/** In-repo integrity floor — always runs, independent of ~/.claude. */
export function checkReceiptIntegrity(
  filePath: string,
  options?: { raw?: string; shaExists?: (sha: string) => boolean },
): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  let text: string;
  try {
    text = options?.raw ?? readFileSync(join(REPO_ROOT, filePath), "utf8");
  } catch (err) {
    return [
      {
        path: filePath,
        rule: "PARSE_ERROR",
        detail: `unreadable: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return [
      {
        path: filePath,
        rule: "PARSE_ERROR",
        detail: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  walkIntegrity(parsed, "", findings, filePath, options?.shaExists ?? defaultShaExists);
  return findings;
}

const isMain =
  import.meta.main === true ||
  Boolean(process.argv[1]?.endsWith("validate-receipts.ts"));

if (isMain) {
  const glob = new Bun.Glob("receipts/**/*.json");
  const found: string[] = [];
  for await (const path of glob.scan({ cwd: REPO_ROOT })) {
    // Skip partials like _template.json — skeletons, not receipts.
    if (!path.split("/").pop()?.startsWith("_")) found.push(path);
  }

  let targets = found.sort();
  if (onlyStaged) {
    const ls = Bun.spawnSync(
      ["git", "diff", "--cached", "--name-only", "--", "receipts"],
      { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe" },
    );
    const staged = new Set(
      ls.stdout
        .toString()
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    targets = targets.filter((t) => staged.has(t));
  }

  if (targets.length === 0) {
    console.error(
      onlyStaged
        ? "REFUSED: no staged receipts under receipts/**/*.json to validate."
        : "REFUSED: no receipts found under receipts/**/*.json (fail-closed: an empty receipt set validates nothing).",
    );
    process.exit(1);
  }

  const external = resolveExternalValidator();
  if (external.source === "claude") {
    console.error(
      "NOTE: using legacy ~/.claude/dfcm/validate_receipt.py; prefer ~/.zcode/dfcm/ (Claude path must not mask zcode refusals).",
    );
  }

  type Row = {
    path: string;
    ok: boolean;
    exitCode: number | null;
    out: string;
  };

  const results: Row[] = targets.map((path) => {
    const integrity = checkReceiptIntegrity(path);
    if (integrity.length > 0) {
      return {
        path,
        ok: false,
        exitCode: 1,
        out: integrity.map((f) => `INTEGRITY ${f.rule}: ${f.detail}`).join("\n"),
      };
    }

    if (!external.path) {
      if (allowIntegrityOnly) {
        return {
          path,
          ok: true,
          exitCode: 0,
          out: "integrity floor ADMITTED (DFCM_ALLOW_INTEGRITY_ONLY=1; no external validator)",
        };
      }
      return {
        path,
        ok: false,
        exitCode: 2,
        out: "REFUSED: external validate_receipt.py missing (~/.zcode/dfcm preferred; ~/.claude/dfcm legacy). Integrity floor was clean for this file; set DFCM_ALLOW_INTEGRITY_ONLY=1 to admit on integrity alone.",
      };
    }

    const proc = Bun.spawnSync(["python3", external.path, path], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const ok = proc.exitCode === 0;
    return {
      path,
      ok,
      exitCode: proc.exitCode,
      out: (proc.stdout.toString() + proc.stderr.toString()).trim(),
    };
  });

  let passed = 0;
  for (const r of results) {
    if (r.ok) {
      passed++;
      console.log(`PASS ${r.path}`);
    } else {
      console.log(`FAIL ${r.path} (validator exit ${r.exitCode})`);
      if (r.out) console.log(r.out);
    }
  }

  console.log(`\n${passed}/${results.length} receipts ADMITTED`);
  if (passed !== results.length) {
    console.error("REFUSED: one or more receipts failed validation.");
    process.exit(1);
  }
}
