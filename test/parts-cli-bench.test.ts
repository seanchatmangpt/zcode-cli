// Regression bound for `zcode parts alternatives` discovery cost.
// Real function, seeded synthetic graphs (scripts/bench-parts-alternatives.ts).
// Bounds are deliberately loose (CI runners are slower and noisier than the
// recorded receipt in docs/bench/v26.9.26/parts-alternatives-bench.json); they
// exist to catch an asymptotic regression (e.g. an O(n^2) subject scan), not
// to certify absolute speed.
import { describe, expect, test } from "bun:test";

import { benchSize } from "../scripts/bench-parts-alternatives.ts";

describe("parts alternatives benchmark bound", () => {
  test("10k-part graph: median discovery under 1000 ms", () => {
    const row = benchSize(10_000, 5);
    expect(row.alternatives).toBeGreaterThan(0);
    expect(row.median_ms).toBeLessThan(1000);
  });

  // min_ms (not median) is the estimator least disturbed by GC pauses and host
  // load. 32x more input: linear cost gives ~32x, quadratic ~1024x; the bound
  // of 256 separates the two with room for a saturated host (measured: a
  // 10x/median variant of this court flaked at ratio 147 under load ~335).
  test("scaling is near-linear: 32k/1k min-time ratio stays under 256 (32x input)", () => {
    const small = benchSize(1_000, 9);
    const large = benchSize(32_000, 9);
    const ratio = large.min_ms / Math.max(small.min_ms, 0.05);
    expect(ratio).toBeLessThan(256);
  });

  test("seeded graph is deterministic: identical result digests across runs", () => {
    expect(benchSize(5_000, 1).result_sha256).toBe(benchSize(5_000, 1).result_sha256);
  });
});
