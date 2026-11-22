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
 *   3. External schema validator + ALOOP v1/v2 adapter (c4ca90f5 / W107):
 *      prefer ~/.zcode/dfcm/validate_receipt.py over ~/.claude/dfcm/...
 *      (legacy Claude path must not mask a zcode refusal or substitute for
 *      missing content checks). Missing external tool → REFUSED by default
 *      (fail-closed). Set DFCM_ALLOW_INTEGRITY_ONLY=1 to run the integrity
 *      floor alone on hosts without the python validator.
 *      Pure v1 Chatman-5 corpus is admitted by the in-repo adapter when the
 *      preferred zcode validator still requires all ALOOP v2 fields; any v2
 *      field present routes to the full external schema (partial v2 REFUSED).
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

/** ALOOP v2 execution provenance (receipt.schema.json required[]). */
export const ALOOP_V2_FIELDS = [
  "work_order_id",
  "origin_authority",
  "provider",
  "provider_execution_id",
] as const;

/** Chatman-5 R-groups (receipt/v1 and still required on v2). */
export const CHATMAN5_FIELDS = [
  "identity",
  "authority",
  "consequence",
  "replay",
  "standing",
] as const;

export type IntegrityFinding = {
  path: string;
  rule: "ALIVE_WITH_NONZERO_EXIT" | "BOGUS_SHA" | "PARSE_ERROR";
  detail: string;
};

export type ReceiptSchemaKind = "v1" | "v2" | "invalid";

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

/**
 * W107 version discrimination: any ALOOP v2 field → v2 (partial v2 is malformed
 * v2, not v1). No v2 fields + all Chatman-5 present → v1. Else invalid.
 */
export function detectReceiptSchemaKind(parsed: unknown): ReceiptSchemaKind {
  if (!isRecord(parsed)) return "invalid";
  const missingChatman = CHATMAN5_FIELDS.filter((k) => !(k in parsed));
  if (missingChatman.length > 0) return "invalid";
  const hasV2 = ALOOP_V2_FIELDS.some((k) => k in parsed);
  return hasV2 ? "v2" : "v1";
}

/** Structural Chatman-5 presence for pure-v1 admit (integrity already ran). */
export function checkChatman5Structural(parsed: unknown): string[] {
  if (!isRecord(parsed)) return ["<root>: receipt must be a JSON object"];
  const errs: string[] = [];
  for (const key of CHATMAN5_FIELDS) {
    if (!(key in parsed)) errs.push(`<root>: '${key}' is a required Chatman-5 property`);
  }
  if (!isRecord(parsed.identity)) {
    errs.push("identity: must be an object");
  } else {
    for (const k of ["subject", "repo", "subject_sha", "base_sha"] as const) {
      if (typeof parsed.identity[k] !== "string" || !parsed.identity[k]) {
        errs.push(`identity.${k}: required non-empty string`);
      }
    }
  }
  if (!isRecord(parsed.authority)) {
    errs.push("authority: must be an object");
  } else {
    for (const k of ["ceiling", "grant", "actor"] as const) {
      if (typeof parsed.authority[k] !== "string" || !parsed.authority[k]) {
        errs.push(`authority.${k}: required non-empty string`);
      }
    }
  }
  if (!isRecord(parsed.consequence)) {
    errs.push("consequence: must be an object");
  } else {
    for (const k of ["commits", "files_changed", "remote_effects"] as const) {
      if (!Array.isArray(parsed.consequence[k])) {
        errs.push(`consequence.${k}: required array`);
      }
    }
  }
  if (!isRecord(parsed.replay) || !Array.isArray(parsed.replay.commands)) {
    errs.push("replay.commands: required non-empty array");
  } else if (parsed.replay.commands.length < 1) {
    errs.push("replay.commands: minItems 1");
  }
  if (!isRecord(parsed.standing)) {
    errs.push("standing: must be an object");
  } else {
    if (typeof parsed.standing.value !== "string" || !parsed.standing.value) {
      errs.push("standing.value: required non-empty string");
    }
    if (typeof parsed.standing.derived_from !== "string" || !parsed.standing.derived_from) {
      errs.push("standing.derived_from: required non-empty string");
    }
  }
  return errs;
}

/**
 * Admit path after integrity: pure v1 uses in-repo Chatman-5 adapter when the
 * preferred zcode validator still requires ALOOP v2 unconditionally; v2 (and
 * partial v2) always hit the external schema validator.
 */
export function admitAfterIntegrity(args: {
  path: string;
  raw?: string;
  external: { path: string | null; source: "zcode" | "claude" | "missing" };
  allowIntegrityOnly: boolean;
  runExternal?: (validatorPath: string, receiptPath: string) => {
    exitCode: number | null;
    out: string;
  };
}): { ok: boolean; exitCode: number | null; out: string } {
  const { path, external, allowIntegrityOnly } = args;
  let parsed: unknown;
  try {
    const text = args.raw ?? readFileSync(join(REPO_ROOT, path), "utf8");
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      exitCode: 1,
      out: `PARSE_ERROR: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const kind = detectReceiptSchemaKind(parsed);
  if (kind === "invalid") {
    return {
      ok: false,
      exitCode: 1,
      out: "REFUSED: missing Chatman-5 fields (identity/authority/consequence/replay/standing)",
    };
  }

  // Pure v1 historical corpus: do not punish with zcode's unconditional v2 require.
  if (kind === "v1" && external.source === "zcode") {
    const structural = checkChatman5Structural(parsed);
    if (structural.length > 0) {
      return {
        ok: false,
        exitCode: 1,
        out: structural.map((e) => `V1_ADAPTER ${e}`).join("\n"),
      };
    }
    return {
      ok: true,
      exitCode: 0,
      out: "ADMITTED via v1 Chatman-5 adapter (zcode validate_receipt.py still requires ALOOP v2 unconditionally; see receipts/MIGRATION-ALOOP-v2.md)",
    };
  }

  if (!external.path) {
    if (allowIntegrityOnly) {
      return {
        ok: true,
        exitCode: 0,
        out: "integrity floor ADMITTED (DFCM_ALLOW_INTEGRITY_ONLY=1; no external validator)",
      };
    }
    return {
      ok: false,
      exitCode: 2,
      out: "REFUSED: external validate_receipt.py missing (~/.zcode/dfcm preferred; ~/.claude/dfcm legacy). Integrity floor was clean for this file; set DFCM_ALLOW_INTEGRITY_ONLY=1 to admit on integrity alone.",
    };
  }

  const run =
    args.runExternal ??
    ((validatorPath: string, receiptPath: string) => {
      const proc = Bun.spawnSync(["python3", validatorPath, receiptPath], {
        cwd: REPO_ROOT,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        exitCode: proc.exitCode,
        out: (proc.stdout.toString() + proc.stderr.toString()).trim(),
      };
    });

  const result = run(external.path, path);
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    out: result.out,
  };
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

    const admitted = admitAfterIntegrity({
      path,
      external,
      allowIntegrityOnly,
    });
    return { path, ...admitted };
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
