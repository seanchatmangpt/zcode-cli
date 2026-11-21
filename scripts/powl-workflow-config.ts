/**
 * Shared path/budget resolution for POWL workflow drivers.
 * Precedence: CLI flag → env → zcode-cli.toml [paths] → repo-relative default.
 * Live runs fail closed when a required workspace path is missing.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function argValue(argv: string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  return v && !v.startsWith("-") ? v : undefined;
}

export function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

type PathsToml = {
  castle_dir?: string;
  wasm4pm_dir?: string;
  wasm4pm_compat_dir?: string;
};

export function loadPathsToml(tomlPath: string): PathsToml {
  if (!existsSync(tomlPath)) return {};
  try {
    const parsed = (Bun.TOML.parse(readFileSync(tomlPath, "utf8")) as { paths?: PathsToml }) ?? {};
    return parsed.paths ?? {};
  } catch {
    return {};
  }
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

function resolveOptionalPath(raw: string | undefined, cwd: string): string | undefined {
  if (!raw || !raw.trim()) return undefined;
  const expanded = expandHome(raw.trim());
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
}

export interface PowlWorkflowConfig {
  dryRun: boolean;
  soak: boolean;
  maxCycles: number | undefined;
  tomlPath: string;
  castleDir: string;
  zcodeBin: string;
  wasm4pmCompatDir: string | undefined;
  outputDir: string;
}

export function resolvePowlWorkflowConfig(opts: {
  argv?: string[];
  cwd?: string;
  workflowSlug: string;
  defaultMaxCyclesLive?: number;
  defaultMaxCyclesDryRun?: number;
}): PowlWorkflowConfig {
  const argv = opts.argv ?? process.argv;
  const cwd = opts.cwd ?? process.cwd();
  const dryRun = hasFlag(argv, "--dry-run");
  const soak = hasFlag(argv, "--soak");
  const tomlPath = resolveOptionalPath(argValue(argv, "--toml"), cwd) ?? join(cwd, "zcode-cli.toml");
  const paths = loadPathsToml(tomlPath);

  const castleDir =
    resolveOptionalPath(argValue(argv, "--castle-dir"), cwd) ??
    resolveOptionalPath(process.env.ZCODE_CASTLE_DIR, cwd) ??
    resolveOptionalPath(paths.castle_dir, cwd) ??
    (dryRun ? join(cwd, ".tmp", "castle-workspace") : "");

  const zcodeBin =
    resolveOptionalPath(argValue(argv, "--zcode-bin"), cwd) ??
    resolveOptionalPath(process.env.ZCODE_BIN, cwd) ??
    join(cwd, "bin", "zcode.js");

  const wasm4pmCompatDir =
    resolveOptionalPath(argValue(argv, "--wasm4pm-compat-dir"), cwd) ??
    resolveOptionalPath(process.env.ZCODE_WASM4PM_COMPAT_DIR, cwd) ??
    resolveOptionalPath(paths.wasm4pm_compat_dir, cwd);

  const outputDir =
    resolveOptionalPath(argValue(argv, "--output-dir"), cwd) ??
    resolveOptionalPath(process.env.ZCODE_POWL_OUTPUT_DIR, cwd) ??
    join(cwd, ".tmp", `${opts.workflowSlug}-powl-ocel`);

  const maxCyclesRaw = argValue(argv, "--max-cycles");
  let maxCycles: number | undefined;
  if (maxCyclesRaw !== undefined) {
    const n = Number(maxCyclesRaw);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(`--max-cycles must be a positive integer (got ${maxCyclesRaw})`);
    }
    maxCycles = Math.floor(n);
  } else if (soak) {
    maxCycles = undefined; // explicit unbounded soak
  } else {
    maxCycles = dryRun ? (opts.defaultMaxCyclesDryRun ?? 2) : (opts.defaultMaxCyclesLive ?? 1);
  }

  if (!dryRun) {
    if (!castleDir) {
      throw new Error(
        "castle workspace required for live runs: pass --castle-dir, ZCODE_CASTLE_DIR, or [paths].castle_dir in zcode-cli.toml"
      );
    }
    if (!existsSync(castleDir)) {
      throw new Error(`castle workspace does not exist: ${castleDir}`);
    }
    if (!existsSync(zcodeBin)) {
      throw new Error(`zcode bin does not exist: ${zcodeBin}`);
    }
  }

  return {
    dryRun,
    soak,
    maxCycles,
    tomlPath,
    castleDir,
    zcodeBin,
    wasm4pmCompatDir,
    outputDir
  };
}
