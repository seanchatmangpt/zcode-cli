#!/usr/bin/env bun
/**
 * Validate DfCM receipts (JSON files under receipts/, recursive) against
 * ~/.claude/dfcm/receipt.schema.json via ~/.claude/dfcm/validate_receipt.py.
 *
 * Fail-closed: exits 1 if any receipt is refused OR if zero receipts are found
 * (a gate that never runs admits nothing).
 *
 * Usage: bun scripts/validate-receipts.ts [--staged]
 *   --staged: only validate receipts staged in git (for pre-commit use).
 */
const HOME = process.env.HOME ?? "";
const VALIDATOR = `${HOME}/.claude/dfcm/validate_receipt.py`;
const onlyStaged = process.argv.includes("--staged");

const glob = new Bun.Glob("receipts/**/*.json");
const found: string[] = [];
for await (const path of glob.scan({ cwd: import.meta.dir + "/.." })) {
  // Skip partials like _template.json — skeletons, not receipts.
  if (!path.split("/").pop()?.startsWith("_")) found.push(path);
}

let targets = found.sort();
if (onlyStaged) {
  const ls = Bun.spawnSync(
    ["git", "diff", "--cached", "--name-only", "--", "receipts"],
    { stdout: "pipe", stderr: "pipe" },
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

const results = targets.map((path) => {
  const proc = Bun.spawnSync(["python3", VALIDATOR, path], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const ok = proc.exitCode === 0;
  return {
    path,
    ok,
    exitCode: proc.exitCode,
    // validator prints its error detail on stdout, tracebacks on stderr
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
