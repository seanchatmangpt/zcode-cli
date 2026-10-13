// sjira-pin-drift.test.ts — Chicago-style court over the GENERATED hddl pins.
//
// Real collaborators: real files, real git subprocesses, no mocks. The test
// imports the same run() the CLI script uses, asserts on the exit verdict,
// and additionally asserts the detector itself is non-vacuous (it can FAIL)
// by exercising the classification logic on a fabricated drifted pin against
// the real zcode-cli checkout.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  parsePins,
  isAncestor,
  run,
  type Pin,
} from "../scripts/check-sjira-pins";

const REPO_ROOT = join(import.meta.dir, "..");

describe("sjira pin drift detector", () => {
  test("parses the expected pin corpus from disk", () => {
    const pins = parsePins(REPO_ROOT);
    expect(pins.length).toBeGreaterThan(0);
    for (const p of pins) {
      expect(p.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(p.repo).toMatch(/^seanchatmangpt\//);
      expect(p.file).toMatch(/^docs\/sjira\/v26\.9\.2[12]\/plan\/ZOCEL-\d+\.hddl$/);
    }
    // v26.9.21 corpus pins zcode-cli, v26.9.22 corpus pins xaas (label).
    const repos = new Set(pins.map((p) => pin_repo(p)));
    expect(repos.has("seanchatmangpt/zcode-cli")).toBeTrue();
    expect(repos.has("seanchatmangpt/xaas")).toBeTrue();
    function pin_repo(p: Pin) {
      return p.repo;
    }
  });

  test("every non-allowlisted pin is an ancestor of its repo HEAD, or drift is allowlisted", () => {
    const { code, report } = run(REPO_ROOT);
    // Log the full pin-by-pin verdict for the receipt.
    console.log(report);
    expect(code).toBe(0);
  });

  test("detector is non-vacuous: a fabricated non-ancestor pin fails", () => {
    // Real degraded collaborator: a sha that certainly does not exist, run
    // through the real isAncestor against the real zcode-cli checkout.
    const fakeSha = "0".repeat(40);
    expect(isAncestor(REPO_ROOT, fakeSha)).toBeFalse();
    // A historical commit IS an ancestor.
    const historical = execFileSync(
      "git",
      ["rev-parse", "HEAD~10"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    ).trim();
    expect(isAncestor(REPO_ROOT, historical)).toBeTrue();
  });

  test("regression: ZOCEL-014/015 pins resolve as real xaas ancestors without allowlist", () => {
    // The generator's repo-label drift pinned zcode-cli sha e0a77911 under the
    // seanchatmangpt/xaas label for ZOCEL-014/015. Corrected 2026-10-13 to the
    // xaas observed subject 2d229c272c3a02dcb8e75ff600ea0a4edc058d71. This court
    // fails if that drift class returns (wrong-sha pin) or if anyone re-adds an
    // allowlist entry to mask it instead of fixing the data.
    const corrected = parsePins(REPO_ROOT).filter((p) =>
      ["ZOCEL-014", "ZOCEL-015"].includes(p.workorder),
    );
    expect(corrected.length).toBe(2);
    for (const p of corrected) {
      expect(p.repo).toBe("seanchatmangpt/xaas");
      expect(p.sha).toBe("2d229c272c3a02dcb8e75ff600ea0a4edc058d71");
      // Real collaborator: the actual seanchatmangpt/xaas checkout.
      expect(isAncestor("/Users/sac/xaas", p.sha)).toBeTrue();
    }
    // The stale allowlist entry must stay gone — if it is re-added, the run()
    // verdict would pass behind EXPECTED-STALE instead of the data being right.
    // (ZOCEL-016 legitimately carries e0a77911 under the zcode-cli label, so
    // match the full drifted key, not the bare sha.)
    const { report } = run(REPO_ROOT);
    expect(report).not.toContain("seanchatmangpt/xaas@e0a77911");
    expect(report).not.toContain("EXPECTED-STALE");
  });
});
