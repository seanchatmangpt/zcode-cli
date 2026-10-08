// Regression bound for the ggen toolchain workflow court cost.
// Real court, real repository workflows, seeded synthetic workflow sets
// (scripts/bench-toolchain-court.ts). Bounds are loose on purpose (CI runners
// are slower and noisier than the receipt in
// docs/bench/v26.9.26/toolchain-court-bench.json); they catch an asymptotic
// regression (e.g. a per-step rescan of every job), not absolute speed.
import { describe, expect, test } from "bun:test";

import { benchRepository, benchSynthetic } from "../scripts/bench-toolchain-court.ts";

describe("toolchain court benchmark bound", () => {
  test("repository workflows: median court pass under 50 ms and the real verdict is admission", () => {
    const row = benchRepository(9);
    expect(row.gated_jobs).toBe(5);
    expect(row.violations).toBe(0);
    expect(row.median_ms).toBeLessThan(50);
  });

  test("5000 synthetic jobs: median under 1000 ms with the seeded violation count", () => {
    const row = benchSynthetic(5_000, 5);
    // Jobs whose index % 7 === 0 lack the install; only the gated ones among them are violations.
    expect(row.violations).toBeGreaterThan(0);
    expect(row.violations).toBeLessThanOrEqual(Math.ceil(5_000 / 7));
    expect(row.median_ms).toBeLessThan(1000);
  });

  // min_ms is the estimator least disturbed by GC pauses and host load. 32x more
  // jobs: linear cost ~32x, quadratic ~1024x; 256 separates the two with room
  // for a saturated host.
  test("scaling is near-linear: 6400/200 job min-time ratio stays under 256", () => {
    const small = benchSynthetic(200, 9);
    const large = benchSynthetic(6_400, 9);
    expect(large.min_ms / Math.max(small.min_ms, 0.05)).toBeLessThan(256);
  });

  test("seeded synthetic set is deterministic: identical verdict digests across runs", () => {
    expect(benchSynthetic(1_000, 1).result_sha256).toBe(benchSynthetic(1_000, 1).result_sha256);
  });
});
