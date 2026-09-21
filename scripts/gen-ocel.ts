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
const marketplaceWorktrees = process.env.ZCODE_PACK_ROOT ?? "/Users/sac/wt";

// pack output (relative to the ggen project) -> committed path (relative to src/generated)
export const RELOCATION: Record<string, string> = {
  "src/pi_ocel_tap/ts/tap.ts": "ocel.ts",
  "src/st_fsm/fsm.ts": "loop.ts",
  "src/es/chain.ts": "receipt.ts",
  "src/shacl_zod_schemas.ts": "zod/schemas.zod.ts",
  "schemas/shacl_projection.schema.json": "schemas.json",
  "src/pi_ocel_tap/py/tap.py": "py/ocel.py",
  "src/st_fsm/fsm.py": "py/loop.py",
  "src/es/chain.py": "py/receipt.py"
};

export function ggenToml(ontologyFile: string): string {
  return `[project]
name = "zcode-ocel-consumer"

[ontology]
source = "${ontologyFile}"

[packs]
"process-intelligence-pack" = { path = "${marketplaceWorktrees}/pi-ocel-tap/packs/process-intelligence-pack" }
"state-transition-pack" = { path = "${marketplaceWorktrees}/st-fsm-codegen/packs/state-transition-pack" }
"evidence-standing-pack" = { path = "${marketplaceWorktrees}/es-receipt-chain/packs/evidence-standing-pack" }
"shacl-projection-pack" = { path = "${marketplaceWorktrees}/targets-shacl-zod/packs/shacl-projection-pack" }

[templates]
dir = "templates"
`;
}

export function generateInto(work: string, ontologyPath = join(root, "ontology", "zcode-loop.ttl")): void {
  mkdirSync(join(work, "templates"), { recursive: true });
  cpSync(ontologyPath, join(work, "zcode-loop.ttl"));
  writeFileSync(join(work, "ggen.toml"), ggenToml("zcode-loop.ttl"));
  const run = spawnSync("ggen", ["sync", "run"], { cwd: work, encoding: "utf8" });
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
