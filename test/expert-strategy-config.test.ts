import { afterEach, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchRuntimeExpertStrategyConfig } from "../scripts/sync-runtime.ts";

// The exact upstream strategy literal (the patch's anchor).
const LITERAL = "owo={clarify:{confidenceThreshold:.8,maxRounds:3,minRounds:1},executor:{drainingChangeHours:1,frontierTarget:3,maxConcurrentLoops:2,maxConsecutiveErrors:3,maxPlannerRuns:10},finalCritic:{maxIterations:3},reactLoop:{maxRounds:30}}";
const UPSTREAM_DEFAULTS = {
  clarify: { confidenceThreshold: 0.8, maxRounds: 3, minRounds: 1 },
  executor: { drainingChangeHours: 1, frontierTarget: 3, maxConcurrentLoops: 2, maxConsecutiveErrors: 3, maxPlannerRuns: 10 },
  finalCritic: { maxIterations: 3 },
  reactLoop: { maxRounds: 30 }
};

function patchedFixture(): string {
  return patchRuntimeExpertStrategyConfig(`var ${LITERAL};`);
}

/** Evaluate the injected strategy builder under a fake HOME and return the strategy object it produces. */
function buildStrategyUnder(home: string, settingJson?: string): Record<string, unknown> {
  if (settingJson === undefined) {
    rmSync(join(home, ".zcode"), { recursive: true, force: true });
  } else {
    mkdirSync(join(home, ".zcode", "cli"), { recursive: true });
    writeFileSync(join(home, ".zcode", "cli", "setting.json"), settingJson);
  }
  const patched = patchedFixture();
  const start = patched.indexOf("=function(){var d=");
  const end = patched.indexOf("}()", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  // bun's os.homedir() ignores $HOME, so redirect the injected builder's
  // require("node:os").homedir() directly (require sees the patched export).
  // The builder runs in the CJS bundle where require is in module scope; this
  // harness is ESM, so pass require in explicitly instead of relying on the
  // eval scope.
  const previousHomedir = os.homedir;
  os.homedir = () => home;
  try {
    return new Function("require", `return (${patched.slice(start + 1, end + 3)});`)(require) as Record<string, unknown>;
  } finally {
    os.homedir = previousHomedir;
  }
}

const fakeHome = join(tmpdir(), `zcode-expert-strategy-test-${process.pid}`);

afterEach(() => {
  rmSync(join(fakeHome, ".zcode"), { recursive: true, force: true });
});

test("patch replaces the strategy literal with a config-reading builder", () => {
  const patched = patchedFixture();
  expect(patched).toContain("$zExpertStrategyMerge");
  expect(patched).toContain("expertWorkflow");
  expect(patched).toContain("var owo=function(){var d={clarify:");
  expect(patched).not.toContain("owo={clarify:");
});

test("patch is a fixed point", () => {
  const patched = patchedFixture();
  expect(patchRuntimeExpertStrategyConfig(patched)).toBe(patched);
});

test("drift: a moved strategy literal throws", () => {
  expect(() => patchRuntimeExpertStrategyConfig("var owo={clarify:{confidenceThreshold:.9}};")).toThrow(/strategy literal anchor missing/);
});

test("anti-vacuity: the unpatched literal reads no config", () => {
  expect(LITERAL).not.toContain("$zExpertStrategyMerge");
});

test("no config file yields upstream defaults", () => {
  expect(buildStrategyUnder(fakeHome)).toEqual(UPSTREAM_DEFAULTS);
});

test("config overrides merge over defaults and raise the knobs", () => {
  const strategy = buildStrategyUnder(fakeHome, JSON.stringify({
    expertWorkflow: {
      strategy: {
        clarify: { confidenceThreshold: 0.6, maxRounds: 5 },
        executor: { frontierTarget: 8, maxConcurrentLoops: 6, maxPlannerRuns: 40 },
        reactLoop: { maxRounds: 200 }
      }
    }
  }));
  expect(strategy).toEqual({
    clarify: { confidenceThreshold: 0.6, maxRounds: 5, minRounds: 1 },
    executor: { drainingChangeHours: 1, frontierTarget: 8, maxConcurrentLoops: 6, maxConsecutiveErrors: 3, maxPlannerRuns: 40 },
    finalCritic: { maxIterations: 3 },
    reactLoop: { maxRounds: 200 }
  });
});

test("fail-closed: malformed config keeps upstream defaults", () => {
  expect(buildStrategyUnder(fakeHome, "{not json")).toEqual(UPSTREAM_DEFAULTS);
  expect(buildStrategyUnder(fakeHome, JSON.stringify({ expertWorkflow: { strategy: "nope" } }))).toEqual(UPSTREAM_DEFAULTS);
  // Zero/negative/non-numeric leaves are rejected per leaf, defaults kept.
  expect(buildStrategyUnder(fakeHome, JSON.stringify({
    expertWorkflow: { strategy: { reactLoop: { maxRounds: 0 }, executor: { maxConcurrentLoops: -2, frontierTarget: "many" } } }
  }))).toEqual(UPSTREAM_DEFAULTS);
  expect(buildStrategyUnder(fakeHome, JSON.stringify({
    expertWorkflow: { strategy: { reactLoop: { maxRounds: -5 }, finalCritic: { maxIterations: 7 } } }
  }))).toEqual({ ...UPSTREAM_DEFAULTS, finalCritic: { maxIterations: 7 } });
});
