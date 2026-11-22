/**
 * Chicago-style ui-layout-court anti-vacuity:
 * real TransitionCourtAdapter + injectable spatial subjects (not mocked courts).
 *
 * Appendix E.8.3 seeded defects that MUST flip exit → 1:
 *   - 360-in-320 overflow (WCAG 1.4.10 reflow / protrusion)
 *   - 18px primary / touch < 44 (WCAG 2.5.8 / HIG–Material floor)
 *   - Gestalt ratio breach (inter < 2·intra when both gaps supplied)
 *   - adjacent interactive gap < 8px (DEFAULT_MIN_TOUCH_GAP_PX hard floor)
 * Appendix E.5.1 spatial classes also witnessed here:
 *   - pairwise overlap (collision)
 *   - text-spacing WCAG 1.4.12 clip (post-expansion geometry → overflow)
 * SUBJECT_MISSING (missing Taffy/Playwright binary / empty subject path) → exit 2.
 * Real PATH absence (no resolveBinary inject) + suite disabled → SUBJECT_MISSING / LOUD_SKIP;
 * never silent PASS (exit 0) when Taffy/Playwright subjects are absent.
 * LOUD_SKIP (suite disabled / spatial evidence not in force) → exit 3.
 *   Never silent-skip: absent Taffy/Playwright subjects must surface
 *   SUBJECT_MISSING (exit 2) or LOUD_SKIP (exit 3) in diagnostics — never exit 0.
 *
 * Prefer live refuse witnesses (exported SpatialSubject fixtures through
 * checkSpatialSubject / verifyPostTransition) over stub Gestalt data-* markers.
 * Pack Playwright anti-vacuity siblings: mobile-ui-layout-pack
 * `tests/e2e/spatial/spatial_court.spec.ts`.
 *
 * Viewport SoT (one list):
 *   - UI_LAYOUT_VIEWPORTS = TOML / Playwright 9-wide (canonical)
 *   - UI_LAYOUT_AOT_VIEWPORTS = ggen-layout-court::VIEWPORTS 6-wide ⊂ SoT
 *   - UI_LAYOUT_PLAYWRIGHT_VIEWPORTS aliases UI_LAYOUT_VIEWPORTS
 *
 * Text-spacing: adapter SpatialSubject has no first-class text metrics; this suite
 * applies ggen-layout-court::text_spacing expansion in-process, then injects the
 * expanded boxes so the court refuse path (overflow/overlap) is witnessed.
 */

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_MIN_TOUCH_GAP_PX,
  DEFAULT_MIN_TOUCH_TARGET_PX,
  DEFAULT_TAFFY_CMD,
  FALLBACK_CLEAN_ROOM_CHECK_CMD,
  UI_LAYOUT_AOT_VIEWPORTS,
  UI_LAYOUT_PLAYWRIGHT_VIEWPORTS,
  UI_LAYOUT_VIEWPORTS,
  UiLayoutCourtAdapter,
  checkSpatialSubject,
  cleanRoomSyncMissingRemediation,
  fixtureAdjacentGapBelowFloor,
  fixtureGestaltRatioBreach,
  fixtureOverflow360in320,
  fixturePrimaryButton18px,
  layoutCourtSubjectPresent,
  resolveCleanRoomSyncCmd,
  resolveTaffySubject,
  withViewportArgv,
  type LayoutBox,
  type SpatialSubject
} from "../src/adapters/ui-layout-court.ts";
import { antiVacuityExpectFail } from "../src/adapters/receipt-sink.ts";
import { DEFAULT_CLEAN_ROOM_CHECK_CMD } from "../src/adapters/clean-room-drift.ts";

/**
 * TOML SoT 9-wide (`zcode-cli.toml` `[adapters.ui_layout].viewports`).
 * Equals UI_LAYOUT_VIEWPORTS / UI_LAYOUT_PLAYWRIGHT_VIEWPORTS; AOT is subset.
 */
const TOML_NINE_WIDE = [320, 375, 393, 414, 600, 768, 840, 1024, 1280] as const;

function tempWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "chicago-ui-layout-"));
}

/**
 * Injectable `mix ggen_igniter.sync --check` stub (exit 0).
 * Argv matches the production drift gate — never `["true"]` + git-diff theater.
 */
function greenCleanRoomHooks() {
  const syncCheckCmd = ["mix", "ggen_igniter.sync", "--check"] as const;
  return {
    requireCleanRoom: true as const,
    // In-process spatialSubjects skip clean-room unless forced — otherwise
    // requireCleanRoom alone would still leave clean_room_sync undefined.
    forceCleanRoom: true as const,
    cleanRoomSyncCmd: [...syncCheckCmd],
    run: (cmd: string[]) => {
      if (cmd[0] === "mix" && cmd.includes("ggen_igniter.sync") && cmd.includes("--check")) {
        return {
          status: 0,
          stdout: "ggen_igniter.sync --check: clean (0 drifted files)",
          stderr: ""
        };
      }
      return { status: 0, stdout: "", stderr: "" };
    },
    resolveBinary: () => true
  };
}

/** In-bounds green subject used for restore→0 after mutant refuse. */
function fixtureGreen320(): SpatialSubject {
  return {
    viewportWidth: 320,
    boxes: [
      { id: "card", x: 0, y: 0, width: 320, height: 120 },
      {
        id: "primary-cta",
        x: 16,
        y: 140,
        width: 48,
        height: 48,
        interactive: true
      }
    ]
  };
}

/** Pairwise overlap mutant (E.5.1 collision / protrusion class). */
function fixturePairwiseOverlap(): SpatialSubject {
  return {
    viewportWidth: 375,
    boxes: [
      { id: "panel-a", x: 0, y: 0, width: 120, height: 80 },
      { id: "panel-b", x: 60, y: 40, width: 120, height: 80 }
    ]
  };
}

// Adapter fixtures (SoT): fixtureGestaltRatioBreach / fixtureAdjacentGapBelowFloor
// witness Gestalt inter < 2·intra and interactive gap < DEFAULT_MIN_TOUCH_GAP_PX.

// --- WCAG 1.4.12 helpers (mirror ggen-layout-court::text_spacing constants) ---

const WCAG_1412_LINE_HEIGHT_MULT = 1.5;
const WCAG_1412_PARAGRAPH_SPACING_MULT = 2.0;
const WCAG_1412_LETTER_SPACING_EM = 0.12;
const WCAG_1412_WORD_SPACING_EM = 0.16;

interface TextMetrics1412 {
  fontSize: number;
  lineCount: number;
  paragraphCount: number;
  charCount: number;
  wordCount: number;
}

function spacingWidthDelta(m: TextMetrics1412): number {
  const letterGaps = Math.max(0, m.charCount - 1);
  const wordGaps = Math.max(0, m.wordCount - 1);
  return (
    letterGaps * m.fontSize * WCAG_1412_LETTER_SPACING_EM +
    wordGaps * m.fontSize * WCAG_1412_WORD_SPACING_EM
  );
}

function spacingRequiredHeight(m: TextMetrics1412): number {
  const lines = Math.max(1, m.lineCount);
  const paraGaps = Math.max(0, m.paragraphCount - 1);
  return (
    lines * m.fontSize * WCAG_1412_LINE_HEIGHT_MULT +
    paraGaps * m.fontSize * WCAG_1412_PARAGRAPH_SPACING_MULT
  );
}

/** Expand a box under WCAG 1.4.12 minima (top-left preserved). */
function applyWcag1412(box: LayoutBox, m: TextMetrics1412): LayoutBox {
  return {
    ...box,
    width: box.width + spacingWidthDelta(m),
    height: Math.max(box.height, spacingRequiredHeight(m))
  };
}

/**
 * Seeded 1.4.12 clip mutant: original fits 320; letter/word spacing expansion
 * protrudes past the viewport (ggen letter_spacing_pushes_past_narrow_viewport).
 */
function fixtureTextSpacingClip320(): {
  original: SpatialSubject;
  expanded: SpatialSubject;
  metrics: TextMetrics1412;
} {
  const metrics: TextMetrics1412 = {
    fontSize: 20,
    lineCount: 1,
    paragraphCount: 1,
    charCount: 30,
    wordCount: 6
  };
  const originalBox: LayoutBox = {
    id: "body-copy",
    x: 250,
    y: 8,
    width: 60,
    height: 24
  };
  const expandedBox = applyWcag1412(originalBox, metrics);
  return {
    metrics,
    original: { viewportWidth: 320, boxes: [originalBox] },
    expanded: { viewportWidth: 320, boxes: [expandedBox] }
  };
}

/**
 * Seeded 1.4.12 overlap mutant: stacked lines that fit before expansion;
 * 1.5× line-height forces pairwise overlap (dense_stack_fails_closed_after_line_height).
 */
function fixtureTextSpacingOverlap375(): {
  original: SpatialSubject;
  expanded: SpatialSubject;
} {
  const metrics: TextMetrics1412 = {
    fontSize: 18,
    lineCount: 2,
    paragraphCount: 1,
    charCount: 8,
    wordCount: 2
  };
  const a: LayoutBox = { id: "line-a", x: 0, y: 0, width: 160, height: 28 };
  const b: LayoutBox = { id: "line-b", x: 0, y: 28, width: 160, height: 28 };
  return {
    original: { viewportWidth: 375, boxes: [a, b] },
    expanded: {
      viewportWidth: 375,
      boxes: [applyWcag1412(a, metrics), applyWcag1412(b, metrics)]
    }
  };
}

describe("Chicago ui-layout-court (anti-vacuity)", () => {
  test("anti-vacuity: 360px child in 320 viewport → exit 1 FAIL_REFUSED", async () => {
    const root = tempWorkspace();
    const subject = fixtureOverflow360in320();
    expect(subject.viewportWidth).toBe(320);
    expect(subject.boxes[0]!.width).toBe(360);

    // Oracle alone must surface overflow (no vacuous empty-defect path).
    const defects = checkSpatialSubject(subject);
    expect(defects.some((d) => d.includes("overflows viewport 320"))).toBe(true);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(1);
    expect(antiVacuityExpectFail(v.exitCode)).toBe(true);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/overflows viewport 320/);
    expect(v.diagnostics.join(" ")).toMatch(/max_remediation_attempts=3/);
    expect(v.artifactDigests["spatial_320"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("anti-vacuity: 18px primary button (touch < 44) → exit 1 FAIL_REFUSED", async () => {
    const root = tempWorkspace();
    const subject = fixturePrimaryButton18px();
    expect(subject.boxes[0]!.width).toBe(18);
    expect(subject.boxes[0]!.height).toBe(18);
    expect(subject.boxes[0]!.interactive).toBe(true);
    expect(18).toBeLessThan(DEFAULT_MIN_TOUCH_TARGET_PX);

    const defects = checkSpatialSubject(subject);
    expect(defects.some((d) => d.includes("primary-cta") && d.includes("18×18"))).toBe(true);
    expect(defects.some((d) => d.includes(`< ${DEFAULT_MIN_TOUCH_TARGET_PX}px floor`))).toBe(
      true
    );

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(1);
    expect(antiVacuityExpectFail(v.exitCode)).toBe(true);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/touch target 18×18/);
    expect(v.diagnostics.join(" ")).toMatch(/max_remediation_attempts=3/);
  });

  test("anti-vacuity: interactive 40×40 still below 44px floor → exit 1", async () => {
    const root = tempWorkspace();
    const subject: SpatialSubject = {
      viewportWidth: 375,
      boxes: [
        {
          id: "near-floor-cta",
          x: 16,
          y: 200,
          width: 40,
          height: 40,
          interactive: true
        }
      ]
    };
    expect(40).toBeLessThan(DEFAULT_MIN_TOUCH_TARGET_PX);
    const defects = checkSpatialSubject(subject);
    expect(defects.some((d) => d.includes("40×40") && d.includes("44px floor"))).toBe(true);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(1);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/touch target 40×40/);
  });

  test("anti-vacuity: pairwise overlap → exit 1 FAIL_REFUSED", async () => {
    const root = tempWorkspace();
    const subject = fixturePairwiseOverlap();
    const defects = checkSpatialSubject(subject);
    expect(defects.some((d) => d.includes("pairwise overlap") && d.includes("panel-a"))).toBe(
      true
    );
    expect(defects.some((d) => d.includes("panel-b"))).toBe(true);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(1);
    expect(antiVacuityExpectFail(v.exitCode)).toBe(true);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/pairwise overlap "panel-a" ∩ "panel-b"/);
    expect(v.diagnostics.join(" ")).toMatch(/max_remediation_attempts=3/);
  });

  test("anti-vacuity: Gestalt ratio inter < 2·intra → exit 1 FAIL_REFUSED", async () => {
    const root = tempWorkspace();
    const subject = fixtureGestaltRatioBreach();
    expect(subject.intraGroupGapPx).toBe(8);
    expect(subject.interGroupGapPx).toBe(12);
    expect(subject.interGroupGapPx!).toBeLessThan(2 * subject.intraGroupGapPx!);

    const defects = checkSpatialSubject(subject);
    expect(
      defects.some(
        (d) =>
          d.includes("Gestalt proximity violated") &&
          d.includes("inter=12") &&
          d.includes("2·intra=16")
      )
    ).toBe(true);
    // Ratio-only mutant: no overflow / overlap / touch / gap refuse.
    expect(defects.every((d) => d.includes("Gestalt proximity"))).toBe(true);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(1);
    expect(antiVacuityExpectFail(v.exitCode)).toBe(true);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/Gestalt proximity violated/);
    expect(v.diagnostics.join(" ")).toMatch(/inter=12 < 2·intra=16/);
    expect(v.diagnostics.join(" ")).toMatch(/max_remediation_attempts=3/);
  });

  test("anti-vacuity: adjacent interactive gap < 8px → exit 1 FAIL_REFUSED", async () => {
    const root = tempWorkspace();
    expect(DEFAULT_MIN_TOUCH_GAP_PX).toBe(8);
    const subject = fixtureAdjacentGapBelowFloor();

    const defects = checkSpatialSubject(subject);
    expect(
      defects.some(
        (d) =>
          d.includes("interactive gap") &&
          d.includes("cta-a") &&
          d.includes("cta-b") &&
          d.includes("4.0px") &&
          d.includes(`< ${DEFAULT_MIN_TOUCH_GAP_PX}px floor`)
      )
    ).toBe(true);
    // Gap-only mutant: targets meet 44px floor.
    expect(defects.some((d) => d.includes("touch target"))).toBe(false);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(1);
    expect(antiVacuityExpectFail(v.exitCode)).toBe(true);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/interactive gap 4\.0px between "cta-a" and "cta-b"/);
    expect(v.diagnostics.join(" ")).toMatch(/< 8px floor/);
    expect(v.diagnostics.join(" ")).toMatch(/max_remediation_attempts=3/);
  });

  test("anti-vacuity: Gestalt ratio + adjacent-gap <8 combined → exit 1 then restore 0", async () => {
    const root = tempWorkspace();
    // Live refuse witnesses (exported fixtures), not stub Gestalt markers.
    const refuseCourt = new UiLayoutCourtAdapter({
      spatialSubjects: [fixtureGestaltRatioBreach(), fixtureAdjacentGapBelowFloor()],
      requireCleanRoom: false
    });
    const refused = await refuseCourt.verifyPostTransition(root);
    expect(refused.exitCode).toBe(1);
    expect(antiVacuityExpectFail(refused.exitCode)).toBe(true);
    expect(refused.standing).toBe("REFUSED");
    // First subject fails closed on Gestalt ratio (inter=12 < 2·intra=16).
    expect(refused.diagnostics.join(" ")).toMatch(/Gestalt proximity violated/);
    expect(refused.diagnostics.join(" ")).toMatch(/inter=12 < 2·intra=16/);

    const green = fixtureGreen320();
    expect(checkSpatialSubject(green)).toEqual([]);
    const restoreCourt = new UiLayoutCourtAdapter({
      spatialSubjects: [green],
      ...greenCleanRoomHooks()
    });
    const restored = await restoreCourt.verifyPostTransition(root);
    expect(restored.exitCode).toBe(0);
    expect(restored.standing).toBe("ALIVE");
  });

  test("anti-vacuity: WCAG 1.4.12 letter-spacing clip @320 → exit 1", async () => {
    const root = tempWorkspace();
    const { original, expanded, metrics } = fixtureTextSpacingClip320();

    // Pre-expansion must be green (mutation is the spacing expansion itself).
    expect(checkSpatialSubject(original)).toEqual([]);
    expect(original.boxes[0]!.x + original.boxes[0]!.width).toBeLessThanOrEqual(320);

    const expandedRight = expanded.boxes[0]!.x + expanded.boxes[0]!.width;
    expect(expandedRight).toBeGreaterThan(320);
    expect(spacingWidthDelta(metrics)).toBeGreaterThan(0);

    const defects = checkSpatialSubject(expanded);
    expect(defects.some((d) => d.includes("overflows viewport 320"))).toBe(true);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [expanded],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(1);
    expect(antiVacuityExpectFail(v.exitCode)).toBe(true);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/overflows viewport 320/);
  });

  test("anti-vacuity: WCAG 1.4.12 line-height stack overlap → exit 1", async () => {
    const root = tempWorkspace();
    const { original, expanded } = fixtureTextSpacingOverlap375();

    expect(checkSpatialSubject(original)).toEqual([]);
    const defects = checkSpatialSubject(expanded);
    expect(defects.some((d) => d.includes("pairwise overlap"))).toBe(true);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [expanded],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(1);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/pairwise overlap "line-a" ∩ "line-b"/);
  });

  test("anti-vacuity: combined 360-in-320 + 18px button mutants still refuse", async () => {
    const root = tempWorkspace();
    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [fixtureOverflow360in320(), fixturePrimaryButton18px()],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(1);
    expect(v.standing).toBe("REFUSED");
    // First subject fails closed; diagnostics must name the overflow mutant.
    expect(v.diagnostics.join(" ")).toMatch(/overflows viewport 320/);
  });

  test("anti-vacuity: mutant refuse then restore green → exit 1 then 0", async () => {
    const root = tempWorkspace();
    const refuseCourt = new UiLayoutCourtAdapter({
      spatialSubjects: [fixtureOverflow360in320()],
      requireCleanRoom: false
    });
    const refused = await refuseCourt.verifyPostTransition(root);
    expect(refused.exitCode).toBe(1);

    const green = fixtureGreen320();
    expect(checkSpatialSubject(green)).toEqual([]);
    const restoreCourt = new UiLayoutCourtAdapter({
      spatialSubjects: [green],
      ...greenCleanRoomHooks()
    });
    const restored = await restoreCourt.verifyPostTransition(root);
    expect(restored.exitCode).toBe(0);
    expect(restored.standing).toBe("ALIVE");
  });

  test("SUBJECT_MISSING: absent Taffy CLI binary → exit 2", async () => {
    const root = tempWorkspace();
    const court = new UiLayoutCourtAdapter({
      skipPlaywright: true,
      taffyCmd: ["ggen-layout-court-MISSING-FOR-TEST"],
      resolveBinary: () => false,
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(2);
    expect(v.standing).toBe("BLOCKED");
    expect(v.diagnostics.join(" ")).toMatch(/SUBJECT_MISSING/);
    expect(v.diagnostics.join(" ")).toMatch(/Taffy CLI subject missing/);
  });

  test("SUBJECT_MISSING: absent Playwright binary → exit 2", async () => {
    const root = tempWorkspace();
    const court = new UiLayoutCourtAdapter({
      skipTaffy: true,
      playwrightCmd: ["playwright-MISSING-FOR-TEST"],
      resolveBinary: () => false,
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(2);
    expect(v.standing).toBe("BLOCKED");
    expect(v.diagnostics.join(" ")).toMatch(/SUBJECT_MISSING/);
    expect(v.diagnostics.join(" ")).toMatch(/Playwright court subject missing/);
  });

  test("SUBJECT_MISSING: both tiers skipped with no spatial subject → exit 2", async () => {
    const root = tempWorkspace();
    const court = new UiLayoutCourtAdapter({
      skipTaffy: true,
      skipPlaywright: true,
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(2);
    expect(v.standing).toBe("BLOCKED");
    expect(v.diagnostics.join(" ")).toMatch(/SUBJECT_MISSING/);
  });

  test("SUBJECT_MISSING: bare cargo run -p ggen-layout-court -- (no --bin/subject) → exit 2", async () => {
    const bareCargo = ["cargo", "run", "-p", "ggen-layout-court", "--"] as const;
    const honesty = resolveTaffySubject([...bareCargo], () => true, tempWorkspace());
    expect(honesty.present).toBe(false);
    expect(honesty.label).toMatch(/cargo run without --bin/);

    const root = tempWorkspace();
    const court = new UiLayoutCourtAdapter({
      skipPlaywright: true,
      taffyCmd: [...bareCargo],
      resolveBinary: () => true,
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(2);
    expect(v.standing).toBe("BLOCKED");
    expect(v.diagnostics.join(" ")).toMatch(/SUBJECT_MISSING/);
    expect(v.diagnostics.join(" ")).toMatch(/Taffy CLI subject missing/);
  });

  test("SUBJECT_MISSING: overflow_viewport_sweep argv is falsifier → exit 2", async () => {
    const overflowCargo = [
      "cargo",
      "run",
      "-p",
      "ggen-layout-court",
      "--bin",
      "overflow_viewport_sweep",
      "--"
    ] as const;
    const honesty = resolveTaffySubject([...overflowCargo], () => true, tempWorkspace());
    expect(honesty.present).toBe(false);
    expect(honesty.label).toMatch(/falsifier bin/);

    const root = tempWorkspace();
    const court = new UiLayoutCourtAdapter({
      skipPlaywright: true,
      taffyCmd: [...overflowCargo],
      resolveBinary: () => true,
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(2);
    expect(v.standing).toBe("BLOCKED");
    expect(v.diagnostics.join(" ")).toMatch(/SUBJECT_MISSING/);
    expect(v.diagnostics.join(" ")).toMatch(/Taffy CLI subject missing/);
  });

  test("DEFAULT_TAFFY_CMD is honest layout_court + product-subject.json", () => {
    expect(DEFAULT_TAFFY_CMD).toEqual([
      "cargo",
      "run",
      "-p",
      "ggen-layout-court",
      "--bin",
      "layout_court",
      "--",
      "fixtures/ui-layout-court/product-subject.json"
    ]);
    const honesty = resolveTaffySubject(
      [...DEFAULT_TAFFY_CMD],
      () => true,
      tempWorkspace()
    );
    // Source subject may be absent in temp workspace — still must not be bare cargo / falsifier.
    expect(honesty.label).not.toMatch(/without --bin|falsifier/);
  });

  test("green in-bounds subject + clean-room hooks → exit 0 (sanity non-vacuity)", async () => {
    const root = tempWorkspace();
    const subject = fixtureGreen320();
    expect(checkSpatialSubject(subject)).toEqual([]);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      ...greenCleanRoomHooks()
    });
    const v = await court.verifyPostTransition(root);

    expect(v.exitCode).toBe(0);
    expect(v.standing).toBe("ALIVE");
    expect(v.artifactDigests["spatial_320"]).toMatch(/^[0-9a-f]{64}$/);
    expect(v.artifactDigests["clean_room_sync"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("clean-room honesty: sync --check exit 4 → REFUSED (not git-diff)", async () => {
    const root = tempWorkspace();
    const subject = fixtureGreen320();
    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      requireCleanRoom: true,
      forceCleanRoom: true,
      cleanRoomSyncCmd: ["mix", "ggen_igniter.sync", "--check"],
      run: (cmd) => {
        if (cmd[0] === "mix" && cmd.includes("--check")) {
          return {
            status: 4,
            stdout: "ggen_igniter.sync --check: DRIFT -- 1 file(s) differ",
            stderr: ""
          };
        }
        return { status: 0, stdout: "", stderr: "" };
      },
      resolveBinary: () => true
    });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(1);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/exit 4|drift/i);
    expect(v.diagnostics.join(" ")).not.toMatch(/git diff/);
  });

  test("clean-room honesty: noop ['true'] stub → LOUD_SKIP (never fake ALIVE)", async () => {
    const root = tempWorkspace();
    const subject = fixtureGreen320();
    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [subject],
      requireCleanRoom: true,
      forceCleanRoom: true,
      cleanRoomSyncCmd: ["true"],
      run: (cmd) => {
        if (cmd[0] === "true") return { status: 0, stdout: "", stderr: "" };
        return { status: 0, stdout: "", stderr: "" };
      },
      resolveBinary: () => true
    });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(3);
    expect(v.standing).toBe("UNVERIFIED");
    expect(v.diagnostics.join(" ")).toMatch(/LOUD_SKIP|noop/);
  });

  test("mix ABSENT after spatial PASS + layout_court PRESENT → exit 0 (Jobs/C4 deferred)", async () => {
    const root = tempWorkspace();
    mkdirSync(join(root, "crates/ggen-layout-court"), { recursive: true });
    writeFileSync(join(root, "crates/ggen-layout-court/Cargo.toml"), "[package]\nname=\"ggen-layout-court\"\n");
    mkdirSync(join(root, "fixtures/ui-layout-court"), { recursive: true });
    writeFileSync(join(root, "fixtures/ui-layout-court/product-subject.json"), "{\"root\":\"product\"}\n");
    expect(layoutCourtSubjectPresent(root)).toBe(true);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [fixtureGreen320()],
      requireCleanRoom: true,
      forceCleanRoom: true,
      cleanRoomSyncCmd: [...DEFAULT_CLEAN_ROOM_CHECK_CMD],
      resolveBinary: () => false // mix + ggen ABSENT
    });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(0);
    expect(v.standing).toBe("ALIVE");
    expect(v.diagnostics.join(" ")).toMatch(/Jobs\/C4 deferred|layout_court PRESENT/);
    expect(v.diagnostics.join(" ")).toMatch(/Remediation/);
    expect(v.artifactDigests["clean_room_sync"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("mix ABSENT without layout_court subject → SUBJECT_MISSING + typed remediation", async () => {
    const root = tempWorkspace();
    expect(layoutCourtSubjectPresent(root)).toBe(false);

    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [fixtureGreen320()],
      requireCleanRoom: true,
      forceCleanRoom: true,
      cleanRoomSyncCmd: [...DEFAULT_CLEAN_ROOM_CHECK_CMD],
      resolveBinary: () => false
    });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(2);
    expect(v.standing).toBe("BLOCKED");
    expect(v.diagnostics.join(" ")).toMatch(/SUBJECT_MISSING/);
    expect(v.diagnostics.join(" ")).toMatch(/Remediation/);
    expect(v.diagnostics.join(" ")).toMatch(/mix ggen_igniter\.sync --check|ggen.*--dry-run|requireCleanRoom:false/);
  });

  test("mix ABSENT + ggen PRESENT → fall back to ggen sync --dry-run", async () => {
    const root = tempWorkspace();
    const captured: string[][] = [];
    const court = new UiLayoutCourtAdapter({
      spatialSubjects: [fixtureGreen320()],
      requireCleanRoom: true,
      forceCleanRoom: true,
      cleanRoomSyncCmd: [...DEFAULT_CLEAN_ROOM_CHECK_CMD],
      resolveBinary: (bin) => bin === "ggen",
      run: (cmd) => {
        captured.push(cmd);
        return {
          status: 0,
          stdout: JSON.stringify({ planned_writes: [] }),
          stderr: ""
        };
      }
    });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(0);
    expect(v.standing).toBe("ALIVE");
    expect(captured.some((c) => c[0] === "ggen" && c.includes("--dry-run"))).toBe(true);
    expect(v.diagnostics.join(" ")).toMatch(/fell back to ggen sync --dry-run/);
    expect([...FALLBACK_CLEAN_ROOM_CHECK_CMD]).toEqual([
      "ggen",
      "sync",
      "run",
      "--dry-run"
    ]);
  });

  test("resolveCleanRoomSyncCmd + remediation helpers are Chicago-honest", () => {
    const remediation = cleanRoomSyncMissingRemediation("mix");
    expect(remediation).toMatch(/SUBJECT_MISSING/);
    expect(remediation).toMatch(/Remediation/);
    expect(remediation).toMatch(/requireCleanRoom:false/);

    const missing = resolveCleanRoomSyncCmd({
      requested: [...DEFAULT_CLEAN_ROOM_CHECK_CMD],
      resolve: () => false,
      workspaceDir: tempWorkspace(),
      hasInjectedRunner: false,
      layoutCourtPresent: false
    });
    expect(missing.kind).toBe("subject_missing");

    const spatial = resolveCleanRoomSyncCmd({
      requested: [...DEFAULT_CLEAN_ROOM_CHECK_CMD],
      resolve: () => false,
      workspaceDir: "/workspace",
      hasInjectedRunner: false,
      layoutCourtPresent: true
    });
    expect(spatial.kind).toBe("spatial_only");

    const fallback = resolveCleanRoomSyncCmd({
      requested: [...DEFAULT_CLEAN_ROOM_CHECK_CMD],
      resolve: (bin) => bin === "ggen",
      workspaceDir: tempWorkspace(),
      hasInjectedRunner: false,
      layoutCourtPresent: false
    });
    expect(fallback.kind).toBe("run");
    if (fallback.kind === "run") {
      expect(fallback.fallbackFromMix).toBe(true);
      expect(fallback.cmd).toEqual([...FALLBACK_CLEAN_ROOM_CHECK_CMD]);
    }
  });

  test("validateWriteScope refuses generated/ mutation paths", async () => {
    const court = new UiLayoutCourtAdapter();
    expect(await court.validateWriteScope(["ontology/surface.ttl"])).toBe(0);
    expect(await court.validateWriteScope(["lib/generated/x.ex"])).toBe(1);
    expect(await court.validateWriteScope(["src/foo_generated.rs"])).toBe(1);
  });

  test("disabled suite loud-skips with exit 3", async () => {
    const root = tempWorkspace();
    const court = new UiLayoutCourtAdapter({ enabled: false });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(3);
    expect(v.standing).toBe("UNVERIFIED");
    expect(v.diagnostics.join(" ")).toMatch(/LOUD_SKIP/);
  });

  test("LOUD_SKIP / SUBJECT_MISSING: real Taffy+Playwright absence never silent-pass", async () => {
    const root = tempWorkspace();
    // Suite disabled → exit 3 LOUD_SKIP (even if live Gestalt/gap subjects would refuse).
    const loud = new UiLayoutCourtAdapter({
      enabled: false,
      spatialSubjects: [fixtureGestaltRatioBreach(), fixtureAdjacentGapBelowFloor()]
    });
    const loudV = await loud.verifyPostTransition(root);
    expect(loudV.exitCode).toBe(3);
    expect(loudV.standing).toBe("UNVERIFIED");
    expect(loudV.diagnostics.join(" ")).toMatch(/LOUD_SKIP/);

    // Real defaultResolveBinary PATH probe (no resolveBinary: () => false inject).
    // Temp workspace lacks layout_court built/source → SUBJECT_MISSING; never silent PASS.
    const realTaffy = new UiLayoutCourtAdapter({
      skipPlaywright: true,
      requireCleanRoom: false
    });
    const taffyV = await realTaffy.verifyPostTransition(root);
    expect(taffyV.exitCode).toBe(2);
    expect(taffyV.standing).toBe("BLOCKED");
    expect(taffyV.diagnostics.join(" ")).toMatch(/SUBJECT_MISSING/);
    expect(taffyV.exitCode).not.toBe(0);

    // Real PATH probe for a never-shipped Playwright argv0 (honest absence, CI-stable).
    const realPw = new UiLayoutCourtAdapter({
      skipTaffy: true,
      playwrightCmd: ["playwright-zcode-chicago-ABSENT"],
      requireCleanRoom: false
    });
    const pwV = await realPw.verifyPostTransition(root);
    expect(pwV.exitCode).toBe(2);
    expect(pwV.standing).toBe("BLOCKED");
    expect(pwV.diagnostics.join(" ")).toMatch(/SUBJECT_MISSING/);
    expect(pwV.diagnostics.join(" ")).toMatch(/Playwright court subject missing/);
    expect(pwV.exitCode).not.toBe(0);
  });

  test("viewports SoT: UI_LAYOUT_VIEWPORTS === TOML 9-wide; AOT ⊂ SoT", () => {
    // One production SoT — TOML, adapter default, and Playwright alias agree.
    expect([...UI_LAYOUT_VIEWPORTS]).toEqual([...TOML_NINE_WIDE]);
    expect([...UI_LAYOUT_PLAYWRIGHT_VIEWPORTS]).toEqual([...UI_LAYOUT_VIEWPORTS]);
    expect(UI_LAYOUT_VIEWPORTS.length).toBe(9);
    expect(UI_LAYOUT_AOT_VIEWPORTS).toEqual([320, 375, 393, 600, 840, 1280]);
    expect(UI_LAYOUT_AOT_VIEWPORTS.length).toBe(6);
    for (const w of UI_LAYOUT_AOT_VIEWPORTS) {
      expect(UI_LAYOUT_VIEWPORTS).toContain(w);
    }
    // Browser-only widths live on the SoT, not the AOT subset.
    for (const w of [414, 768, 1024] as const) {
      expect(UI_LAYOUT_AOT_VIEWPORTS).not.toContain(w);
      expect(UI_LAYOUT_VIEWPORTS).toContain(w);
    }
  });

  test("viewports(): TOML 9-wide reaches verify digests + Taffy argv", async () => {
    const root = tempWorkspace();
    const captured: string[][] = [];
    const court = new UiLayoutCourtAdapter({
      viewports: [...TOML_NINE_WIDE],
      skipPlaywright: true,
      taffyCmd: ["layout_court", "fixture.json"],
      resolveBinary: () => true,
      requireCleanRoom: false,
      run: (cmd) => {
        captured.push(cmd);
        return { status: 0, stdout: "ok", stderr: "" };
      }
    });

    expect(court.viewports()).toEqual([...TOML_NINE_WIDE]);
    expect([...UI_LAYOUT_PLAYWRIGHT_VIEWPORTS]).toEqual([...TOML_NINE_WIDE]);
    for (const w of UI_LAYOUT_VIEWPORTS) {
      expect(court.viewports()).toContain(w);
    }

    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(0);
    expect(v.artifactDigests["viewports"]).toMatch(/^[0-9a-f]{64}$/);
    expect(captured.length).toBeGreaterThanOrEqual(1);
    const taffyArgv = captured[0]!;
    expect(taffyArgv).toEqual(
      withViewportArgv(["layout_court", "fixture.json"], [...TOML_NINE_WIDE])
    );
    expect(taffyArgv).toContain("--viewports");
    expect(taffyArgv).toContain(TOML_NINE_WIDE.join(","));
  });

  test("viewports(): default sweep is Playwright 9-wide when opts omitted", async () => {
    const court = new UiLayoutCourtAdapter({ requireCleanRoom: false });
    expect(court.viewports()).toEqual([...UI_LAYOUT_PLAYWRIGHT_VIEWPORTS]);
  });

  test("viewports(): in-process path digests configured sweep", async () => {
    const root = tempWorkspace();
    const court = new UiLayoutCourtAdapter({
      viewports: [...TOML_NINE_WIDE],
      spatialSubjects: [fixtureGreen320()],
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(root);
    expect(v.exitCode).toBe(0);
    expect(v.artifactDigests["viewports"]).toMatch(/^[0-9a-f]{64}$/);
    expect(v.artifactDigests["spatial_320"]).toMatch(/^[0-9a-f]{64}$/);
  });
});
