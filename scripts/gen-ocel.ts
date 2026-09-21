// Runs `ggen sync run` over ontology/zcode-loop.ttl with the four extended packs and relocates the
// pack outputs to src/generated/. Relocation is a byte copy: generated files are never edited.
//   bun scripts/gen-ocel.ts            regenerate src/generated/
//   bun scripts/gen-ocel.ts --check    regenerate into a scratch dir and fail if src/generated differs
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// ZCODE_PACK_ROOT is a packs/ directory holding the four packs (default: main checkout).
// ZCODE_PACK_ROOT_<KEY> (PI, ST, ES, SHACL) overrides one pack's parent packs/ dir, e.g. /Users/sac/wt/<branch>/packs.
export const DEFAULT_PACK_ROOT = "/Users/sac/ggen-marketplace/packs";
export function packDir(name: string, key: string, env: Record<string, string | undefined> = process.env): string {
  return `${env[`ZCODE_PACK_ROOT_${key}`] ?? env.ZCODE_PACK_ROOT ?? DEFAULT_PACK_ROOT}/${name}`;
}

// The pack's zod target is deliberately not relocated: nothing imports it and zod is not a dependency
// (ZOCEL-006); schemas.json is the validator the tests exercise.
// pack output (relative to the ggen project) -> committed path (relative to src/generated)
export const RELOCATION: Record<string, string> = {
  "src/pi_ocel_tap/ts/tap.ts": "ocel.ts",
  "src/st_fsm/fsm.ts": "loop.ts",
  "src/es/chain.ts": "receipt.ts",
  "schemas/shacl_projection.schema.json": "schemas.json",
  "src/pi_ocel_tap/py/tap.py": "py/ocel.py",
  "src/st_fsm/fsm.py": "py/loop.py",
  "src/es/chain.py": "py/receipt.py"
};

export function ggenToml(ontologyFile: string, env: Record<string, string | undefined> = process.env): string {
  return `[project]
name = "zcode-ocel-consumer"

[ontology]
source = "${ontologyFile}"

[packs]
"process-intelligence-pack" = { path = "${packDir("process-intelligence-pack", "PI", env)}" }
"state-transition-pack" = { path = "${packDir("state-transition-pack", "ST", env)}" }
"evidence-standing-pack" = { path = "${packDir("evidence-standing-pack", "ES", env)}" }
"shacl-projection-pack" = { path = "${packDir("shacl-projection-pack", "SHACL", env)}" }

[templates]
dir = "templates"
`;
}

export function generateInto(work: string, ontologyPath = join(root, "ontology", "zcode-loop.ttl")): void {
  mkdirSync(join(work, "templates"), { recursive: true });
  cpSync(ontologyPath, join(work, "zcode-loop.ttl"));
  writeFileSync(join(work, "ggen.toml"), ggenToml("zcode-loop.ttl"));
  const run = spawnSync("ggen", ["sync", "run"], { cwd: work, encoding: "utf8", env: process.env });
  if (run.status !== 0) throw new Error(`ggen sync run failed (${run.status}): ${(run.stderr || run.stdout).slice(-2000)}`);
}

export function relocate(work: string, dest: string): string[] {
  const written: string[] = [];
  for (const [from, to] of Object.entries(RELOCATION)) {
    const src = join(work, from);
    if (!existsSync(src)) throw new Error(`pack output missing: ${from}`);
    mkdirSync(dirname(join(dest, to)), { recursive: true });
    cpSync(src, join(dest, to));
    written.push(to);
  }
  return written;
}

function listFiles(dir: string, base = dir): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listFiles(p, base) : [p.slice(base.length + 1)];
  }).sort();
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const work = mkdtempSync(join(tmpdir(), "zcode-ocel-gen-"));
  try {
    generateInto(work);
    if (!check) {
      const written = relocate(work, join(root, "src", "generated"));
      console.log("wrote src/generated/: " + written.join(", "));
    } else {
      const scratch = join(work, "relocated");
      relocate(work, scratch);
      const dest = join(root, "src", "generated");
      const diffs = listFiles(scratch).filter((f) => !existsSync(join(dest, f)) || readFileSync(join(dest, f), "utf8") !== readFileSync(join(scratch, f), "utf8"));
      if (diffs.length) { console.error("STALE src/generated: " + diffs.join(", ")); process.exit(2); }
      console.log("src/generated matches a fresh ggen sync run");
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
