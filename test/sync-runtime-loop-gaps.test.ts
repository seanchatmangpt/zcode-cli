import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  patchRuntimeMaxTurnsEnforcement,
  patchRuntimeStreamingLedgerForwarding
} from "../scripts/sync-runtime.ts";

const loopFixture =
  'function z4e(e){return Ie(he.ModelContextExceeded,"x",{})}' +
  "async function mIn(e){for(;;){fi(e.turnAbortSignal);let t=e.turnRequestState.outputTokenContinuationCount>0,r=1;}}" +
  'a(mIn,"runRegularTurnLoop");';
const vmeFixture =
  "function vme(e){if(e.type===W.StreamingToolLedgerUpdated)return!1;if(e.type!==W.ModelStreaming)return!0;return 1}";

test("max turns patch inserts an error_max_turns guard, idempotently", () => {
  const patched = patchRuntimeMaxTurnsEnforcement(loopFixture);
  expect(patched).toContain('reason:"error_max_turns"');
  expect(patched).toContain("e.modelStepCount>=$zMax");
  expect(patched).toContain("Ie(he.ModelError,");
  expect(patchRuntimeMaxTurnsEnforcement(patched)).toBe(patched);
});

test("max turns patch throws when the anchor is missing", () => {
  expect(() => patchRuntimeMaxTurnsEnforcement("nothing")).toThrow(/max turns patch/);
});

test("ledger patch stops dropping StreamingToolLedgerUpdated, idempotently", () => {
  const patched = patchRuntimeStreamingLedgerForwarding(vmeFixture);
  expect(patched).not.toContain("StreamingToolLedgerUpdated");
  expect(patched).toContain("if(e.type!==W.ModelStreaming)return!0;");
  expect(patchRuntimeStreamingLedgerForwarding(patched)).toBe(patched);
});

test("ledger patch throws when the anchor is missing", () => {
  expect(() => patchRuntimeStreamingLedgerForwarding("nothing")).toThrow(/ledger/);
});

const bundle = "/Users/sac/dev/zcode-cli/vendor/zcode.cjs";
test.skipIf(!existsSync(bundle))("both patches apply to the real bundle", () => {
  const runtime = readFileSync(bundle, "utf8");
  const maxed = patchRuntimeMaxTurnsEnforcement(runtime);
  expect(maxed).toContain('reason:"error_max_turns"');
  const both = patchRuntimeStreamingLedgerForwarding(maxed);
  expect(both).not.toContain("if(e.type===W.StreamingToolLedgerUpdated)return!1;");
  expect(patchRuntimeMaxTurnsEnforcement(both)).toBe(both);
});
