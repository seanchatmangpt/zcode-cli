import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Falsifier: every irreducible handwritten OCEL / van der Aalst surface beside
 * `src/generated/` must appear in HANDWRITTEN.md (AGENTS.md house rule).
 * Swarm agent 08 / 19 (2026-11-21) found the POWL orchestrator, vocab manifest,
 * and SA2A OCEL feedback path unledgered — this test locks the repair.
 */
const REQUIRED_RESIDUE = [
  "src/ocel-tap.ts",
  "src/powl-ocel-orchestrator.ts",
  "src/ocel-vocab-manifest.ts",
  "src/ui-ocel-summary.ts",
  "src/research-runtime/sa2a/ocel-feedback.ts",
  "src/gall-work.ts",
  "scripts/gen-ocel.ts",
  "scripts/validate-receipts.ts",
] as const;

describe("HANDWRITTEN.md residue ledger", () => {
  const ledger = readFileSync(join(import.meta.dir, "..", "HANDWRITTEN.md"), "utf8");

  test("lists every required OCEL / process-mining handwritten surface", () => {
    const missing = REQUIRED_RESIDUE.filter((path) => !ledger.includes(path));
    expect(missing).toEqual([]);
  });

  test("anti-vacuity: a fabricated unledgered path is detected", () => {
    expect(ledger.includes("src/definitely-not-a-real-residue.ts")).toBe(false);
  });
});
