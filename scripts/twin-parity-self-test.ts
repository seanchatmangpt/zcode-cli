/**
 * twin-parity-self-test.ts — fail-closed castle↔zcode brand twin court.
 *
 * Proves `castle/brands` ≡ `zcode-cli/brands` by SHA-256 of every
 * `*.brand.toml` (today: fourth-watch). Exit 0 only when twins are
 * byte-identical; never a noop PASS.
 *
 * Exit codes:
 *   0 — every brand twin matches
 *   1 — hash diverge or asymmetric brand set
 *   2 — configuration / missing trees (castle_dir or brands absent)
 *
 * Read-only. Resolves castle via ZCODE_CASTLE_DIR, else [paths].castle_dir
 * in zcode-cli.toml, else sibling `/Users/sac/castle`.
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { parseTomlDocument } from "../src/compliance/config.ts";

export const REPO_ROOT = join(import.meta.dir, "..");
const BRAND_GLOB_SUFFIX = ".brand.toml";

export interface TwinParityResult {
  code: number;
  report: string;
  pairs: Array<{ rel: string; localSha: string; twinSha: string; ok: boolean }>;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** List `*.brand.toml` paths relative to brandsDir (sorted). */
export function listBrandRels(brandsDir: string): string[] {
  if (!existsSync(brandsDir) || !statSync(brandsDir).isDirectory()) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) walk(abs);
      else if (name.endsWith(BRAND_GLOB_SUFFIX)) out.push(relative(brandsDir, abs));
    }
  };
  walk(brandsDir);
  return out.sort();
}

export function resolveCastleDir(
  repoRoot: string = REPO_ROOT,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const fromEnv = env.ZCODE_CASTLE_DIR?.trim();
  if (fromEnv) return fromEnv;
  const tomlPath = join(repoRoot, "zcode-cli.toml");
  if (existsSync(tomlPath)) {
    try {
      const doc = parseTomlDocument(readFileSync(tomlPath, "utf8"));
      const paths = doc.paths;
      if (paths && typeof paths === "object" && !Array.isArray(paths)) {
        const castle = (paths as Record<string, unknown>).castle_dir;
        if (typeof castle === "string" && castle.trim()) return castle.trim();
      }
    } catch {
      // fall through
    }
  }
  const sibling = join(repoRoot, "..", "castle");
  if (existsSync(sibling)) return sibling;
  return null;
}

export function runTwinParitySelfTest(opts?: {
  repoRoot?: string;
  castleDir?: string | null;
  env?: NodeJS.ProcessEnv;
}): TwinParityResult {
  const repoRoot = opts?.repoRoot ?? REPO_ROOT;
  const castleDir =
    opts?.castleDir !== undefined
      ? opts.castleDir
      : resolveCastleDir(repoRoot, opts?.env ?? process.env);

  const localBrands = join(repoRoot, "brands");
  const lines: string[] = [];
  const pairs: TwinParityResult["pairs"] = [];

  if (!castleDir) {
    return {
      code: 2,
      report: "twin-parity: REFUSED — castle_dir unresolved (set ZCODE_CASTLE_DIR or [paths].castle_dir)",
      pairs
    };
  }
  if (!existsSync(localBrands) || !statSync(localBrands).isDirectory()) {
    return {
      code: 2,
      report: `twin-parity: REFUSED — missing local brands dir: ${localBrands}`,
      pairs
    };
  }
  const twinBrands = join(castleDir, "brands");
  if (!existsSync(twinBrands) || !statSync(twinBrands).isDirectory()) {
    return {
      code: 2,
      report: `twin-parity: REFUSED — missing castle brands dir: ${twinBrands}`,
      pairs
    };
  }

  const localRels = listBrandRels(localBrands);
  const twinRels = listBrandRels(twinBrands);
  if (localRels.length === 0) {
    return {
      code: 2,
      report: `twin-parity: REFUSED — no ${BRAND_GLOB_SUFFIX} under ${localBrands}`,
      pairs
    };
  }

  const allRels = [...new Set([...localRels, ...twinRels])].sort();
  let diverged = 0;
  for (const rel of allRels) {
    const localPath = join(localBrands, rel);
    const twinPath = join(twinBrands, rel);
    const localOk = existsSync(localPath);
    const twinOk = existsSync(twinPath);
    if (!localOk || !twinOk) {
      diverged++;
      pairs.push({
        rel,
        localSha: localOk ? sha256File(localPath) : "MISSING",
        twinSha: twinOk ? sha256File(twinPath) : "MISSING",
        ok: false
      });
      lines.push(`DRIFT  ${rel} — asymmetric (local=${localOk}, castle=${twinOk})`);
      continue;
    }
    const localSha = sha256File(localPath);
    const twinSha = sha256File(twinPath);
    const ok = localSha === twinSha;
    pairs.push({ rel, localSha, twinSha, ok });
    if (ok) {
      lines.push(`OK     ${rel}  sha256=${localSha}`);
    } else {
      diverged++;
      lines.push(`DRIFT  ${rel}  local=${localSha}  castle=${twinSha}`);
    }
  }

  lines.push(
    `summary: ${allRels.length} brand file(s), ${diverged} drifted; castle=${castleDir}`
  );
  return {
    code: diverged > 0 ? 1 : 0,
    report: lines.join("\n"),
    pairs
  };
}

if (import.meta.main) {
  const { code, report } = runTwinParitySelfTest();
  console.log(report);
  process.exit(code);
}
