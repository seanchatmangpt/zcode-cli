import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  patchRuntimeMaxTurnsEnforcement,
  patchRuntimeStreamingLedgerForwarding,
  runtimePatchPlan
} from "../scripts/sync-runtime.ts";

// Runs in the sync:locked flow: after the locked runtime is synced, every
// loop-gap anchor must still resolve against the real bundle, so a runtime
// update that moves an anchor fails loudly here instead of silently skipping.
const bundle = join(import.meta.dir, "..", "vendor", "zcode.cjs");

test("loop-gap patches are registered as required", () => {
  for (const id of ["max-turns-enforcement", "streaming-ledger-forwarding"]) {
    expect(runtimePatchPlan.find((p) => p.id === id)?.requirement).toBe("required");
  }
});

test.skipIf(!existsSync(bundle))("anchors resolve against the synced bundle and patches are fixed points", () => {
  const runtime = readFileSync(bundle, "utf8");
  const maxed = patchRuntimeMaxTurnsEnforcement(runtime);
  expect(maxed).toContain('reason:"error_max_turns"');
  expect(patchRuntimeMaxTurnsEnforcement(maxed)).toBe(maxed);
  const ledger = patchRuntimeStreamingLedgerForwarding(runtime);
  expect(patchRuntimeStreamingLedgerForwarding(ledger)).toBe(ledger);
});

test("drift: a moved anchor throws", () => {
  expect(() => patchRuntimeMaxTurnsEnforcement("async function x(){}")).toThrow();
  expect(() => patchRuntimeStreamingLedgerForwarding("function vme(){}")).toThrow();
});
