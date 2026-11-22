/**
 * Canonical Appendix E.8 ui-layout-court suite entrypoint.
 *
 * ARD / README / F.3 cite `test/ui-layout-court.test.ts` for:
 *   bun test test/ui-layout-court.test.ts
 *
 * Chicago anti-vacuity (E.8.3: 360-in-320 → exit 1, 18px primary → exit 1,
 * Gestalt ratio + adjacent gap < 8 → exit 1, SUBJECT_MISSING → exit 2,
 * mutant refuse then restore → 1 then 0; plus E.5.1 overlap / WCAG 1.4.12
 * witnesses) lives in `ui-layout-court-chicago.test.ts`.
 * Side-effect import runs those same cases so this path stays the one suite
 * entrypoint without duplicating bodies. Bun ESM cache keeps a broad
 * `test/*.test.ts` run from double-registering when both files are loaded.
 */
import "./ui-layout-court-chicago.test.ts";

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_PRIMARY_TOUCH_TARGET_PX,
  MODE_B_PREFERRED_TOUCH_TARGET_PX,
  MODE_B_VIEWPORTS,
  UiLayoutCourtAdapter,
  buildDefaultModeBSubjects,
  checkModeBSubject,
  checkSpatialSubject,
  runModeBSpatialCourt,
  type ModeBSubject,
  type SpatialSubject
} from "../src/adapters/ui-layout-court.ts";

function emptyTempDir(): string {
  return mkdtempSync(join(tmpdir(), "ui-layout-mode-b-"));
}

describe("Mode B self-contained spatial court (zero-mock geometry)", () => {
  test("passes canonical 6-wide viewports [320,375,393,600,840,1280] with real SHA-256 digests", () => {
    expect([...MODE_B_VIEWPORTS]).toEqual([320, 375, 393, 600, 840, 1280]);
    const res = runModeBSpatialCourt();
    expect(res.exitCode).toBe(0);
    expect(res.standing).toBe("ALIVE");
    expect(res.defects).toEqual([]);
    expect(res.viewports).toEqual([320, 375, 393, 600, 840, 1280]);
    for (const vp of MODE_B_VIEWPORTS) {
      expect(res.artifactDigests[`mode_b_${vp}`]).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(res.artifactDigests["mode_b_spatial"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("adapter Mode B runs self-contained geometry pass when @playwright/test config is absent", async () => {
    const dir = emptyTempDir();
    const court = new UiLayoutCourtAdapter({
      skipTaffy: true,
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(dir);
    expect(v.exitCode).toBe(0);
    expect(v.standing).toBe("ALIVE");
    expect(v.artifactDigests["mode_b_spatial"]).toMatch(/^[0-9a-f]{64}$/);
    expect(v.artifactDigests["playwright_spatial"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("anti-vacuity: 44px/48px touch-target floor violation → exit 1 REFUSED", () => {
    const subjects = buildDefaultModeBSubjects([375]);
    // Mutate nav-home to 44x44 while preferredTouchTargetPx is 48px
    subjects[0]!.boxes[0]!.width = 44;
    subjects[0]!.boxes[0]!.height = 44;
    const res48 = runModeBSpatialCourt({ subjects, viewports: [375] });
    expect(res48.exitCode).toBe(1);
    expect(res48.standing).toBe("REFUSED");
    expect(res48.defects.join(" ")).toMatch(/48px preferred floor/);

    // Mutate to 36x36 (below 44px WCAG floor)
    subjects[0]!.boxes[0]!.width = 36;
    subjects[0]!.boxes[0]!.height = 36;
    const res44 = runModeBSpatialCourt({ subjects, viewports: [375] });
    expect(res44.exitCode).toBe(1);
    expect(res44.defects.join(" ")).toMatch(/44px floor/);
  });

  test("anti-vacuity: >=8px interactive gap violation → exit 1 REFUSED", () => {
    const subjects = buildDefaultModeBSubjects([393]);
    // Shift nav-search left so gap is 4px (< 8px)
    subjects[0]!.boxes[1]!.x = subjects[0]!.boxes[0]!.x + subjects[0]!.boxes[0]!.width + 4;
    const res = runModeBSpatialCourt({ subjects, viewports: [393] });
    expect(res.exitCode).toBe(1);
    expect(res.standing).toBe("REFUSED");
    expect(res.defects.join(" ")).toMatch(/interactive gap 4\.0px/);
  });

  test("anti-vacuity: WCAG 1.4.12 1.5x text expansion overflow/overlap → exit 1 REFUSED", () => {
    const tightTextSubject: ModeBSubject = {
      viewportWidth: 320,
      intraGroupGapPx: 8,
      interGroupGapPx: 16,
      boxes: [
        {
          id: "copy-line-1",
          x: 16,
          y: 16,
          width: 240,
          height: 24,
          group: "content",
          textMetrics: {
            fontSize: 18,
            lineCount: 2,
            paragraphCount: 1,
            charCount: 30,
            wordCount: 6
          }
        },
        {
          id: "copy-line-2",
          x: 16,
          y: 44,
          width: 200,
          height: 24,
          group: "content"
        }
      ]
    };
    const defects = checkModeBSubject(tightTextSubject, { configuredViewports: [320] });
    expect(defects.some((d) => d.includes("WCAG 1.4.12 expansion"))).toBe(true);

    const res = runModeBSpatialCourt({ subjects: [tightTextSubject], viewports: [320] });
    expect(res.exitCode).toBe(1);
    expect(res.standing).toBe("REFUSED");
  });

  test("anti-vacuity: Gestalt 2x spacing violation → exit 1 REFUSED", async () => {
    const dir = emptyTempDir();
    const subjects = buildDefaultModeBSubjects([600]);
    subjects[0]!.intraGroupGapPx = 10;
    subjects[0]!.interGroupGapPx = 16; // 16 < 2*10
    const court = new UiLayoutCourtAdapter({
      skipTaffy: true,
      modeBSubjects: subjects,
      requireCleanRoom: false
    });
    const v = await court.verifyPostTransition(dir);
    expect(v.exitCode).toBe(1);
    expect(v.standing).toBe("REFUSED");
    expect(v.diagnostics.join(" ")).toMatch(/Gestalt proximity violated/);
    expect(MODE_B_PREFERRED_TOUCH_TARGET_PX).toBe(48);
  });
});

describe("v27.1.1 hardening: checkSpatialSubject WCAG 1.4.12, LayoutBox.group Gestalt, 48px primary floor", () => {
  test("unexpanded SpatialSubject @320px fitting at 1.0x refuses under WCAG 1.4.12 1.5x / 0.12em expansion", () => {
    const unexpandedSubject: SpatialSubject = {
      viewportWidth: 320,
      boxes: [
        {
          id: "headline",
          x: 16,
          y: 16,
          width: 280, // 16 + 280 = 296 <= 320 at 1.0x, overflows 320 after 0.12em letter + 0.16em word spacing
          height: 20,
          fontSize: 16,
          lineHeight: 1.2,
          letterSpacing: 0,
          wordSpacing: 0
        },
        {
          id: "subhead",
          x: 16,
          y: 38, // 16 + 20 = 36 (no overlap at 1.0x), overlaps when headline expands to 1.5 * 16 = 24px (16 + 24 = 40 > 38)
          width: 160,
          height: 24
        }
      ]
    };

    const defects = checkSpatialSubject(unexpandedSubject);
    expect(defects.length).toBeGreaterThan(0);
    expect(defects.some((d) => d.includes("WCAG 1.4.12 expansion") && d.includes("overflows viewport 320px"))).toBe(true);
    expect(defects.some((d) => d.includes("WCAG 1.4.12 expansion") && d.includes('pairwise overlap "headline" ∩ "subhead"'))).toBe(true);

    // Restoring safe margins passes with 0 defects
    const safeSubject: SpatialSubject = {
      viewportWidth: 320,
      boxes: [
        {
          id: "headline",
          x: 16,
          y: 16,
          width: 180,
          height: 24,
          fontSize: 16,
          lineHeight: 1.5,
          letterSpacing: 0,
          wordSpacing: 0
        },
        {
          id: "subhead",
          x: 16,
          y: 56,
          width: 160,
          height: 24
        }
      ]
    };
    expect(checkSpatialSubject(safeSubject)).toEqual([]);
  });

  test("Gestalt 2x proximity derived from LayoutBox.group without manual metadata + 48px primary touch floor", () => {
    expect(DEFAULT_PRIMARY_TOUCH_TARGET_PX).toBe(48);

    const subject: SpatialSubject = {
      viewportWidth: 375,
      boxes: [
        { id: "nav-a", x: 16, y: 16, width: 48, height: 48, interactive: true, group: "nav" },
        { id: "nav-b", x: 72, y: 16, width: 48, height: 48, interactive: true, group: "nav" }, // intra gap = 72 - 64 = 8px
        { id: "content-card", x: 16, y: 74, width: 200, height: 60, group: "content" }, // inter gap = 74 - 64 = 10px (< 2*8=16px)
        {
          id: "primary-btn",
          x: 16,
          y: 200,
          width: 44,
          height: 44,
          interactive: true,
          primary: true
        }
      ]
    };

    const defects = checkSpatialSubject(subject);
    expect(defects.some((d) => d.includes("Gestalt proximity violated") && d.includes("derived inter=10.0px < 2·intra=16.0px"))).toBe(true);
    expect(defects.some((d) => d.includes('interactive "primary-btn"') && d.includes("48px preferred floor"))).toBe(true);

    // Fixing inter-group gap to 16px (>= 2*8) and primary button to 48x48 passes
    const fixed: SpatialSubject = {
      viewportWidth: 375,
      boxes: [
        { id: "nav-a", x: 16, y: 16, width: 48, height: 48, interactive: true, group: "nav" },
        { id: "nav-b", x: 72, y: 16, width: 48, height: 48, interactive: true, group: "nav" },
        { id: "content-card", x: 16, y: 80, width: 200, height: 60, group: "content" }, // inter gap = 80 - 64 = 16px
        {
          id: "primary-btn",
          x: 16,
          y: 200,
          width: 48,
          height: 48,
          interactive: true,
          primary: true
        }
      ]
    };
    expect(checkSpatialSubject(fixed)).toEqual([]);
  });
});
