#!/usr/bin/env bun
/**
 * Exp-4 OCEL 2.0 Trace Mining Pilot — SCAFFOLD ONLY (NOT_ALIVE).
 *
 * SPEC command (docs/sjira/v26.11.20/ard/ZCODE-CLI-SPEC-26.11.20.md § Exp-4):
 *   bun scripts/exp4-ocel-mining-pilot.ts --live-runs 10 --out receipts/v26.11.20/exp4/
 *
 * This entrypoint exists so the SPEC path resolves and operators get an honest
 * refusal instead of a missing-file surprise. It does NOT:
 *   - run live coding agents
 *   - mine OC-DFG / rework / bottlenecks over real traces
 *   - write receipts/v26.11.20/exp4/REPORT.md
 *   - claim ALIVE, PARTIAL_ALIVE, or H1–H4 support/falsification
 *
 * Spec completeness ≠ hypothesis confirmation. See
 * receipts/v26.11.20/exp4/PLAN.md (DOC-ONLY) for the live-pilot checklist.
 *
 * Exit: 1 (REFUSED_LOGIC) — scaffold refuses to fabricate a data product.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const DEFAULT_OUT = resolve(REPO, "receipts/v26.11.20/exp4");

function usage(): never {
  console.error(
    "usage: bun scripts/exp4-ocel-mining-pilot.ts --live-runs <N> --out <dir>\n" +
      "  SCAFFOLD ONLY — refuses to fabricate REPORT.md / H1–H4 verdicts.\n" +
      "  See receipts/v26.11.20/exp4/PLAN.md",
  );
  process.exit(2);
}

function flagValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("-")) usage();
  return v;
}

const argv = process.argv.slice(2);
if (argv.includes("-h") || argv.includes("--help")) usage();

const liveRunsRaw = flagValue(argv, "--live-runs");
const outRaw = flagValue(argv, "--out") ?? DEFAULT_OUT;
const liveRuns = liveRunsRaw === undefined ? NaN : Number(liveRunsRaw);

if (!Number.isInteger(liveRuns) || liveRuns < 1) {
  console.error("REFUSED: --live-runs must be a positive integer (SPEC default: 10).");
  usage();
}

const outDir = resolve(outRaw);
const reportPath = resolve(outDir, "REPORT.md");
const planPath = resolve(REPO, "receipts/v26.11.20/exp4/PLAN.md");

console.log(
  [
    "standing: NOT_ALIVE",
    "role: Exp-4 OCEL mining pilot scaffold (CREATE-2)",
    `live-runs(requested): ${liveRuns}`,
    `out: ${outDir}`,
    `REPORT.md present: ${existsSync(reportPath) ? "yes" : "no"}`,
    `PLAN.md (DOC-ONLY): ${existsSync(planPath) ? planPath : "missing"}`,
    "action: REFUSED — will not invent histograms, OC-DFG edges, or H1–H4 verdicts",
    "next: run real live Explore cycles with ZCODE_OCEL=1, land traces under",
    "      receipts/v26.11.20/exp4/runs/, then implement mining + file REPORT.md",
  ].join("\n"),
);

console.error(
  "REFUSED: Exp-4 mining pilot is SCAFFOLD-ONLY (NOT_ALIVE); " +
    "spec completeness ≠ hypothesis confirmation.",
);
process.exit(1);
