import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  patchRuntimeExpertStrategyConfig,
  patchRuntimeMaxTurnsEnforcement,
  patchRuntimeSubagentMaxTurns,
  patchRuntimeStreamingLedgerForwarding,
  runtimePatchPlan
} from "../scripts/sync-runtime.ts";

// Runs in the sync:locked flow: after the locked runtime is synced, every
// loop-gap anchor must still resolve against the real bundle, so a runtime
// update that moves an anchor fails loudly here instead of silently skipping.
const bundle = join(import.meta.dir, "..", "vendor", "zcode.cjs");

test("loop-gap patches are registered as required", () => {
  for (const id of ["max-turns-enforcement", "expert-strategy-config", "subagent-max-turns-env", "streaming-ledger-forwarding"]) {
    expect(runtimePatchPlan.find((p) => p.id === id)?.requirement).toBe("required");
  }
});

test.skipIf(!existsSync(bundle))("anchors resolve against the synced bundle and patches are fixed points", () => {
  const runtime = readFileSync(bundle, "utf8");
  const maxed = patchRuntimeMaxTurnsEnforcement(runtime);
  expect(maxed).toContain('reason:"error_max_turns"');
  expect(patchRuntimeMaxTurnsEnforcement(maxed)).toBe(maxed);
  const subagent = patchRuntimeSubagentMaxTurns(maxed);
  expect(subagent).toContain("ZCODE_SUBAGENT_MAX_TURNS");
  expect(patchRuntimeSubagentMaxTurns(subagent)).toBe(subagent);
  const expert = patchRuntimeExpertStrategyConfig(subagent);
  expect(expert).toContain("$zExpertStrategyMerge");
  expect(patchRuntimeExpertStrategyConfig(expert)).toBe(expert);
  const ledger = patchRuntimeStreamingLedgerForwarding(expert);
  expect(patchRuntimeStreamingLedgerForwarding(ledger)).toBe(ledger);
});

test("drift: a moved anchor throws", () => {
  expect(() => patchRuntimeMaxTurnsEnforcement("async function x(){}")).toThrow();
  expect(() => patchRuntimeSubagentMaxTurns("maxTurns:t.maxTurns??4")).toThrow();
  expect(() => patchRuntimeExpertStrategyConfig("var owo={clarify:{confidenceThreshold:.9}};")).toThrow();
  expect(() => patchRuntimeStreamingLedgerForwarding("function vme(){}")).toThrow();
});
