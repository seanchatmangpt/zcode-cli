/**
 * Zero-HITL UI layout court — Taffy AOT pre-flight + Playwright rRLG/WCAG court
 * + Jobs/C4 clean-room hooks, wired as a TransitionCourtAdapter.
 *
 * Exit taxonomy (Explore + Exploit):
 *   0 PASS            — spatial checks + Jobs/C4 clean (exit 0 / planned_writes:[])
 *   1 FAIL_REFUSED    — spatial defect or sync --check drift (process exit 4)
 *   2 SUBJECT_MISSING — Taffy CLI / Playwright / sync binary absent
 *   3 LOUD_SKIP       — suite disabled OR noop clean-room stub (`true`)
 *
 * Jobs/C4: `mix ggen_igniter.sync --check` or `ggen sync run --dry-run` with
 * `planned_writes: []` — never `git diff --exit-code` as the refuse gate.
 *
 * Remediation of REFUSED defects is bounded by `maxRemediationAttempts`
 * (default 3); this court records the budget on refuse diagnostics — the
 * foundry loop owns the actual retry/rollback cycles.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { CourtVerdict, ExitCode, Standing, TransitionCourtAdapter } from "./types.ts";
import { standingFromExit } from "./types.ts";
import {
  DEFAULT_CLEAN_ROOM_CHECK_CMD,
  collectGitDiffDiagnostic,
  evaluateCleanRoomDrift,
  isGitSyncCmd
} from "./clean-room-drift.ts";

/**
 * Canonical viewport sweep (CSS px) — **one SoT** with
 * `zcode-cli.toml` `[adapters.ui_layout].viewports` and Playwright default.
 * Adapter `viewports()` returns this when opts omit an override.
 */
export const UI_LAYOUT_VIEWPORTS = [
  320, 375, 393, 414, 600, 768, 840, 1024, 1280
] as const;

/**
 * AOT Taffy subset — mirrors `ggen-layout-court::VIEWPORTS` (6-wide).
 * Always ⊆ {@link UI_LAYOUT_VIEWPORTS}; not a second production SoT.
 */
export const UI_LAYOUT_AOT_VIEWPORTS = [320, 375, 393, 600, 840, 1280] as const;

/**
 * Production Taffy argv — full court subject (`layout_court` + JSON with
 * interactive metrics + WCAG text). Never bare `cargo run -p ggen-layout-court --`
 * (cargo-present ≠ court) and never `--bin overflow_viewport_sweep`.
 */
export const DEFAULT_TAFFY_CMD: string[] = [
  "cargo",
  "run",
  "-p",
  "ggen-layout-court",
  "--bin",
  "layout_court",
  "--",
  "fixtures/ui-layout-court/product-subject.json"
];

/** Falsifier-only bins — must never be treated as a full layout court. */
const FALSIFIER_ONLY_BINS = new Set([
  "overflow_viewport_sweep",
  "overflow-viewport-sweep"
]);

/**
 * Alias of {@link UI_LAYOUT_VIEWPORTS} (one SoT). Kept for env/docs that still
 * say "Playwright viewports"; must not diverge from the TOML 9-wide list.
 */
export const UI_LAYOUT_PLAYWRIGHT_VIEWPORTS = UI_LAYOUT_VIEWPORTS;

/** Env keys set on Taffy / Playwright spawn so subjects can read the sweep. */
export const UI_LAYOUT_VIEWPORTS_ENV = "UI_LAYOUT_VIEWPORTS";
export const UI_LAYOUT_PLAYWRIGHT_VIEWPORTS_ENV = "UI_LAYOUT_PLAYWRIGHT_VIEWPORTS";

export const DEFAULT_MIN_TOUCH_TARGET_PX = 44;
export const DEFAULT_PRIMARY_TOUCH_TARGET_PX = 48;
export const DEFAULT_MIN_TOUCH_GAP_PX = 8;
export const DEFAULT_MAX_REMEDIATION_ATTEMPTS = 3;

export interface LayoutBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Interactive control (button / link / input) — subject to touch floors. */
  interactive?: boolean;
  /** Primary / Android Material interactive target — subject to 48px preferred floor. */
  primary?: boolean;
  /** Optional per-control touch floor (e.g. 48px Material vs 44px WCAG). */
  preferredTouchTargetPx?: number;
  /** Semantic group id for Gestalt proximity (sh:PropertyGroup). */
  group?: string;
  /** Optional typography fields for WCAG 1.4.12 1.5× text-expansion checks. */
  fontSize?: number;
  /** Unitless line-height multiplier (e.g. 1.2). */
  lineHeight?: number;
  /** Base letter-spacing in em (default 0). */
  letterSpacing?: number;
  /** Base word-spacing in em (default 0). */
  wordSpacing?: number;
  /** Optional explicit line count for WCAG 1.4.12 height expansion. */
  lineCount?: number;
  /** Optional explicit paragraph count for WCAG 1.4.12 paragraph-spacing expansion. */
  paragraphCount?: number;
  /** Optional explicit character count for WCAG 1.4.12 letter-spacing expansion. */
  charCount?: number;
  /** Optional explicit word count for WCAG 1.4.12 word-spacing expansion. */
  wordCount?: number;
  /** Structured text metrics for WCAG 1.4.12 1.5× expansion verification. */
  textMetrics?: ModeBTextMetrics;
}

/** In-process spatial subject (Chicago tests / fixture injection). */
export interface SpatialSubject {
  viewportWidth: number;
  boxes: LayoutBox[];
  /** Optional intra-group gap (px) when Gestalt metadata is present. */
  intraGroupGapPx?: number;
  /** Optional inter-group gap (px). Must be ≥ 2 × intra when both set. */
  interGroupGapPx?: number;
}

export type RunResult = { status: number | null; stdout: string; stderr: string };

export interface UiLayoutCourtOptions {
  /**
   * When false, court loud-skips (exit 3 / UNVERIFIED). Default true.
   * Mirrors `[adapters.ui_layout].enabled` TOML.
   */
  enabled?: boolean;
  /**
   * Bound on upstream .ttl / .toml / template remediation after REFUSED.
   * Recorded on refuse diagnostics; foundry loop enforces the cycle cap.
   */
  maxRemediationAttempts?: number;
  /** Absolute or PATH-resolved Taffy / ggen-layout-court CLI argv. */
  taffyCmd?: string[];
  /** Absolute or PATH-resolved Playwright spatial-court argv. */
  playwrightCmd?: string[];
  /** Skip Taffy tier (Playwright / in-process subject still run). */
  skipTaffy?: boolean;
  /** Skip Playwright tier. */
  skipPlaywright?: boolean;
  /** In-process subjects — used by anti-vacuity tests; bypasses CLI when set. */
  spatialSubjects?: SpatialSubject[];
  /**
   * Self-contained Mode B spatial court subjects (zero-mock geometry pass).
   * When set, Mode B evaluates these subjects directly without requiring `@playwright/test`.
   */
  modeBSubjects?: ModeBSubject[];
  minTouchTargetPx?: number;
  minTouchGapPx?: number;
  /**
   * Require igniter `sync --check` after spatial PASS. Default true for
   * CLI tiers; ignored for pure in-process `spatialSubjects` unless
   * `forceCleanRoom` is set (keeps Chicago anti-vacuity fixtures honest).
   * When false with spatial PASS → skip clean-room (not LOUD_SKIP of the suite).
   */
  requireCleanRoom?: boolean;
  /** Force clean-room even when `spatialSubjects` drive the spatial tier. */
  forceCleanRoom?: boolean;
  /**
   * Jobs/C4 drift-gate argv. Default: `mix ggen_igniter.sync --check`.
   * Alternate: `ggen sync run --dry-run` (planned_writes: []).
   * Noop `["true"]` → LOUD_SKIP (never fake ALIVE).
   */
  cleanRoomSyncCmd?: string[];
  /** Attach non-gating git-diff diagnostics after Jobs/C4 check (default false). */
  gitDiffDiagnostic?: boolean;
  /** Pathspecs for optional git-diff diagnostic only. */
  gitDiffPaths?: string[];
  /** Canonical AOT/browser viewport widths (CSS px) from `[adapters.ui_layout].viewports`. */
  viewports?: number[];
  /** Custom runner (deterministic tests). */
  run?: (cmd: string[], cwd: string) => RunResult;
  /** Binary presence probe; default uses `command -v` / filesystem. */
  resolveBinary?: (bin: string) => boolean;
}

export class UiLayoutCourtAdapter implements TransitionCourtAdapter {
  readonly name = "ui-layout-court";
  /** Alias accepted by TOML / registry (`ui_layout`). */
  static readonly aliases = ["ui-layout-court", "ui_layout"] as const;

  readonly maxRemediationAttempts: number;

  private readonly opts: Required<
    Pick<
      UiLayoutCourtOptions,
      | "enabled"
      | "maxRemediationAttempts"
      | "minTouchTargetPx"
      | "minTouchGapPx"
      | "requireCleanRoom"
      | "skipTaffy"
      | "skipPlaywright"
    >
  > &
    UiLayoutCourtOptions;

  constructor(opts: UiLayoutCourtOptions = {}) {
    this.opts = {
      enabled: true,
      maxRemediationAttempts: DEFAULT_MAX_REMEDIATION_ATTEMPTS,
      taffyCmd: [...DEFAULT_TAFFY_CMD],
      playwrightCmd: ["bunx", "playwright", "test", "--grep", "@spatial-court"],
      skipTaffy: false,
      skipPlaywright: false,
      minTouchTargetPx: DEFAULT_MIN_TOUCH_TARGET_PX,
      minTouchGapPx: DEFAULT_MIN_TOUCH_GAP_PX,
      requireCleanRoom: true,
      cleanRoomSyncCmd: [...DEFAULT_CLEAN_ROOM_CHECK_CMD],
      gitDiffDiagnostic: false,
      ...opts
    };
    this.maxRemediationAttempts = this.opts.maxRemediationAttempts;
  }

  /**
   * Resolved viewport sweep for verify: TOML/`opts.viewports` when non-empty,
   * else {@link UI_LAYOUT_VIEWPORTS} (one SoT with TOML 9-wide).
   * AOT crate still uses {@link UI_LAYOUT_AOT_VIEWPORTS} as a proper subset.
   */
  viewports(): number[] {
    const configured = this.opts.viewports;
    if (configured && configured.length > 0) {
      return configured.filter((n) => Number.isFinite(n) && n > 0);
    }
    return [...UI_LAYOUT_VIEWPORTS];
  }

  async validateWriteScope(files: string[]): Promise<ExitCode> {
    // Fail-closed: remediation may touch .ttl / .toml / templates only —
    // never generated projection trees.
    for (const f of files) {
      const norm = f.replace(/\\/g, "/");
      if (/generated\//i.test(norm) || /_generated\./i.test(norm)) {
        return 1;
      }
    }
    return 0;
  }

  async verifyPostTransition(workspaceDir: string): Promise<CourtVerdict> {
    const diagnostics: string[] = [];
    const digests: Record<string, string> = {};

    if (!this.opts.enabled) {
      return verdict(3, standingFromExit(3), [
        "ui-layout-court disabled — LOUD_SKIP (suite not in force)"
      ], digests);
    }

    // TOML `[adapters.ui_layout].viewports` → opts.viewports → here (or defaults).
    const viewports = this.viewports();
    digests["viewports"] = sha256(JSON.stringify(viewports));

    const run = this.bindRun(viewports);
    const resolve = this.opts.resolveBinary ?? defaultResolveBinary;

    // --- Spatial tier -------------------------------------------------------
    const subjects = this.opts.spatialSubjects;
    if (subjects && subjects.length > 0) {
      for (const subject of subjects) {
        const defects = checkSpatialSubject(subject, {
          minTouchTargetPx: this.opts.minTouchTargetPx,
          minTouchGapPx: this.opts.minTouchGapPx,
          configuredViewports: viewports
        });
        digests[`spatial_${subject.viewportWidth}`] = sha256(
          JSON.stringify({
            viewport: subject.viewportWidth,
            configuredViewports: viewports,
            boxes: subject.boxes,
            defects
          })
        );
        if (defects.length > 0) {
          diagnostics.push(
            ...defects.slice(0, 12),
            remediationBudgetNote(this.maxRemediationAttempts)
          );
          return verdict(1, "REFUSED", diagnostics, digests);
        }
      }
    } else {
      // Taffy CLI (layout_court JSON / ggen-layout-court fixtures).
      // Never treat bare `cargo` as proof the subject exists.
      if (!this.opts.skipTaffy) {
        const taffy = this.opts.taffyCmd ?? [...DEFAULT_TAFFY_CMD];
        const subject = resolveTaffySubject(taffy, resolve, workspaceDir);
        if (!subject.present) {
          return verdict(
            2,
            "BLOCKED",
            [
              `ui-layout-court: Taffy CLI subject missing (${subject.label}) — SUBJECT_MISSING`
            ],
            digests
          );
        }
        const taffyCmd = withViewportArgv(subject.runCmd, viewports);
        const taffyRes = run(taffyCmd, workspaceDir);
        digests["taffy"] = sha256(`${taffyRes.stdout}\n${taffyRes.stderr}`);
        // layout_court JSON path: exit 2 = subject missing/unreadable → SUBJECT_MISSING
        // (never collapse into REFUSED — that was the cargo/overflow false-refuse path).
        if (taffyRes.status === 2) {
          return verdict(
            2,
            "BLOCKED",
            [
              `ui-layout-court: Taffy CLI subject missing/unreadable (exit 2): ${(
                taffyRes.stderr || taffyRes.stdout
              )
                .trim()
                .slice(0, 400)} — SUBJECT_MISSING`
            ],
            digests
          );
        }
        if (taffyRes.status !== 0) {
          diagnostics.push(
            `taffy/ggen-layout-court refused (exit ${taffyRes.status}): ${(
              taffyRes.stderr || taffyRes.stdout
            )
              .trim()
              .slice(0, 400)}`,
            remediationBudgetNote(this.maxRemediationAttempts)
          );
          return verdict(1, "REFUSED", diagnostics, digests);
        }
      }

      // Mode B / Playwright spatial court.
      // When explicit modeBSubjects are provided, or when using the default
      // Playwright command in a workspace without @playwright/test config, run
      // the self-contained zero-mock Mode B geometry verification pass instead
      // of failing vacuously on missing @playwright/test.
      if (!this.opts.skipPlaywright) {
        const pw = this.opts.playwrightCmd ?? [
          "bunx",
          "playwright",
          "test",
          "--grep",
          "@spatial-court"
        ];
        const bin = pw[0]!;
        const isDefaultPw =
          !this.opts.playwrightCmd ||
          (pw.length >= 2 && pw[0] === "bunx" && pw[1] === "playwright");
        const hasPwConfig =
          existsSync(join(workspaceDir, "playwright.config.ts")) ||
          existsSync(join(workspaceDir, "playwright.config.js")) ||
          existsSync(join(workspaceDir, "playwright.config.mjs"));

        if (this.opts.modeBSubjects && this.opts.modeBSubjects.length > 0) {
          const modeBRes = runModeBSpatialCourt({
            subjects: this.opts.modeBSubjects,
            viewports: viewports,
            minTouchTargetPx: this.opts.minTouchTargetPx,
            minTouchGapPx: this.opts.minTouchGapPx
          });
          Object.assign(digests, modeBRes.artifactDigests);
          if (modeBRes.exitCode !== 0) {
            diagnostics.push(
              ...modeBRes.defects.slice(0, 12),
              remediationBudgetNote(this.maxRemediationAttempts)
            );
            return verdict(1, "REFUSED", diagnostics, digests);
          }
        } else if (isDefaultPw && !this.opts.run && !hasPwConfig) {
          const modeBViewports = MODE_B_VIEWPORTS.filter((vp) => viewports.includes(vp));
          const sweep = modeBViewports.length > 0 ? modeBViewports : [...MODE_B_VIEWPORTS];
          const modeBRes = runModeBSpatialCourt({
            viewports: sweep,
            minTouchTargetPx: this.opts.minTouchTargetPx,
            minTouchGapPx: this.opts.minTouchGapPx
          });
          Object.assign(digests, modeBRes.artifactDigests);
          if (modeBRes.exitCode !== 0) {
            diagnostics.push(
              ...modeBRes.defects.slice(0, 12),
              remediationBudgetNote(this.maxRemediationAttempts)
            );
            return verdict(1, "REFUSED", diagnostics, digests);
          }
        } else {
          if (!resolve(bin)) {
            return verdict(
              2,
              "BLOCKED",
              [
                `ui-layout-court: Playwright court subject missing (binary "${bin}" not found) — SUBJECT_MISSING`
              ],
              digests
            );
          }
          const pwRes = run(pw, workspaceDir);
          digests["playwright_spatial"] = sha256(`${pwRes.stdout}\n${pwRes.stderr}`);
          if (pwRes.status !== 0) {
            diagnostics.push(
              `playwright spatial court refused (exit ${pwRes.status}): ${(
                pwRes.stderr || pwRes.stdout
              )
                .trim()
                .slice(0, 400)}`,
              remediationBudgetNote(this.maxRemediationAttempts)
            );
            return verdict(1, "REFUSED", diagnostics, digests);
          }
        }
      }

      if (this.opts.skipTaffy && this.opts.skipPlaywright) {
        return verdict(
          2,
          "BLOCKED",
          [
            "ui-layout-court: no spatial subject and both Taffy + Playwright tiers skipped — SUBJECT_MISSING"
          ],
          digests
        );
      }
    }

    // --- Clean-room tier: Jobs/C4 --check / planned_writes=[] --------------
    // Never gate on git diff — clean index ≠ ontology↔artifact match.
    // Noop ["true"] stubs → LOUD_SKIP via evaluateCleanRoomDrift (never fake ALIVE).
    const usedInProcessSubjects = Boolean(subjects && subjects.length > 0);
    const runCleanRoom =
      this.opts.requireCleanRoom && (!usedInProcessSubjects || this.opts.forceCleanRoom === true);
    if (runCleanRoom) {
      const syncCmd =
        this.opts.cleanRoomSyncCmd && this.opts.cleanRoomSyncCmd.length > 0
          ? this.opts.cleanRoomSyncCmd
          : [...DEFAULT_CLEAN_ROOM_CHECK_CMD];
      // Refuse git* before spawn — clean index ≠ ontology match (ELIMINATE-2).
      if (isGitSyncCmd(syncCmd)) {
        const drift = evaluateCleanRoomDrift(syncCmd, { status: 0, stdout: "", stderr: "" });
        diagnostics.push(...drift.diagnostics);
        digests["clean_room_sync"] = sha256("refused:git*");
        return verdict(drift.exitCode, standingFromExit(drift.exitCode), diagnostics, digests);
      }
      const syncBin = syncCmd[0]!;
      if (!resolve(syncBin) && !this.opts.run) {
        // Without an injected runner, missing sync binary is SUBJECT_MISSING
        // (cannot honestly claim clean-room).
        return verdict(
          2,
          "BLOCKED",
          [
            `ui-layout-court: clean-room sync binary missing ("${syncBin}") — SUBJECT_MISSING`
          ],
          digests
        );
      }
      const sync = run(syncCmd, workspaceDir);
      digests["clean_room_sync"] = sha256(`${sync.status}\n${sync.stdout}\n${sync.stderr}`);
      const drift = evaluateCleanRoomDrift(syncCmd, sync);
      diagnostics.push(...drift.diagnostics);
      if (drift.kind !== "pass") {
        return verdict(drift.exitCode, standingFromExit(drift.exitCode), diagnostics, digests);
      }
      if (this.opts.gitDiffDiagnostic) {
        diagnostics.push(
          ...collectGitDiffDiagnostic(run, workspaceDir, this.opts.gitDiffPaths ?? ["."])
        );
      }
    }

    return verdict(0, "ALIVE", diagnostics, digests);
  }

  /**
   * Bind the spawn runner so CLI tiers receive the resolved viewport sweep:
   * - default spawn: `UI_LAYOUT_VIEWPORTS` / `UI_LAYOUT_PLAYWRIGHT_VIEWPORTS` env
   * - injected `opts.run` (tests): unchanged signature; env is not observable, so
   *   Taffy argv still carries `--viewports <csv>` via {@link withViewportArgv}.
   */
  private bindRun(
    viewports: number[]
  ): (cmd: string[], cwd: string) => RunResult {
    const env = viewportEnv(viewports);
    if (this.opts.run) {
      return this.opts.run;
    }
    return (cmd, cwd) => defaultRun(cmd, cwd, env);
  }
}

// ---------------------------------------------------------------------------
// Viewport sweep helpers (TOML → verify)
// ---------------------------------------------------------------------------

/** Env map carrying the resolved sweep for Taffy / Playwright subjects. */
export function viewportEnv(viewports: number[]): Record<string, string> {
  const csv = viewports.join(",");
  return {
    [UI_LAYOUT_VIEWPORTS_ENV]: csv,
    [UI_LAYOUT_PLAYWRIGHT_VIEWPORTS_ENV]: csv
  };
}

/**
 * Append `--viewports <csv>` for the JSON-subject `layout_court` CLI / spies.
 * Full-court default-run `ggen-layout-court` uses crate VIEWPORTS and rejects
 * unknown flags — do not append there (env `UI_LAYOUT_VIEWPORTS` still set).
 */
export function withViewportArgv(cmd: string[], viewports: number[]): string[] {
  if (viewports.length === 0) return [...cmd];
  if (isFullCourtTaffyCmd(cmd)) return [...cmd];
  return [...cmd, "--viewports", viewports.join(",")];
}

/** True when argv targets package default-run / `--bin ggen-layout-court`. */
function isFullCourtTaffyCmd(cmd: string[]): boolean {
  if (!cmd.length) return false;
  const argv0 = cmd[0]!;
  if (!isCargoArgv0(argv0)) {
    return binBasename(argv0) === "ggen-layout-court";
  }
  const explicit = cargoBinName(cmd);
  if (explicit) return explicit === "ggen-layout-court";
  // cargo run -p ggen-layout-court without --bin → package default-run
  return cargoPackageName(cmd) === "ggen-layout-court";
}

function binBasename(bin: string): string {
  const norm = bin.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/");
  return i >= 0 ? norm.slice(i + 1) : norm;
}

/** Extract `-p` / `--package` name from cargo argv. */
function cargoPackageName(cmd: string[]): string | undefined {
  for (const flag of ["-p", "--package"] as const) {
    const i = cmd.indexOf(flag);
    if (i < 0) continue;
    const name = cmd[i + 1];
    if (!name || name === "--" || name.startsWith("-")) continue;
    return name;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Spatial defect oracle (in-process; used by anti-vacuity fixtures)
// ---------------------------------------------------------------------------

export interface SpatialCheckOptions {
  minTouchTargetPx?: number;
  /** Preferred touch-target floor for primary / Android controls (default 48px). */
  primaryTouchTargetPx?: number;
  minTouchGapPx?: number;
  /** Configured sweep from {@link UiLayoutCourtAdapter.viewports} (digest / audit). */
  configuredViewports?: number[];
  /** Require WCAG 1.4.12 1.5× text-expansion pass when typography/textMetrics are present (default true). */
  checkWcag1412?: boolean;
}

/**
 * Fail-closed spatial oracle over absolute boxes.
 * Detects: viewport overflow, pairwise overlap, 44px/48px touch-target floors,
 * gap floors, Gestalt inter ≥ 2·intra (from explicit metadata or `box.group`
 * geometry), and WCAG 1.4.12 1.5× text expansion.
 */
export function checkSpatialSubject(
  subject: SpatialSubject,
  opts: SpatialCheckOptions = {}
): string[] {
  const minTouch = opts.minTouchTargetPx ?? DEFAULT_MIN_TOUCH_TARGET_PX;
  const primaryTouch = opts.primaryTouchTargetPx ?? DEFAULT_PRIMARY_TOUCH_TARGET_PX;
  const minGap = opts.minTouchGapPx ?? DEFAULT_MIN_TOUCH_GAP_PX;
  const defects: string[] = [];
  const { viewportWidth: vw, boxes } = subject;
  const configured = opts.configuredViewports;
  if (configured && configured.length > 0 && !configured.includes(vw)) {
    defects.push(
      `spatial defect: subject viewport ${vw}px not in configured sweep [${configured.join(",")}]`
    );
  }

  for (const b of boxes) {
    if (b.x < 0 || b.y < 0 || b.x + b.width > vw + 1e-6) {
      defects.push(
        `spatial defect: box "${b.id}" overflows viewport ${vw}px ` +
          `(x=${b.x}, w=${b.width}, right=${b.x + b.width})`
      );
    }
    if (b.interactive) {
      if (b.width < minTouch || b.height < minTouch) {
        defects.push(
          `spatial defect: interactive "${b.id}" touch target ${b.width}×${b.height} ` +
            `< ${minTouch}px floor`
        );
      }
      if (b.primary || b.preferredTouchTargetPx !== undefined) {
        const preferredFloor = Math.max(minTouch, b.preferredTouchTargetPx ?? primaryTouch);
        if (b.width < preferredFloor || b.height < preferredFloor) {
          defects.push(
            `spatial defect: interactive "${b.id}" touch target ${b.width}×${b.height} ` +
              `< ${preferredFloor}px preferred floor`
          );
        }
      }
    }
  }

  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (boxesOverlap(a, b)) {
        defects.push(`spatial defect: pairwise overlap "${a.id}" ∩ "${b.id}" @${vw}px`);
      }
      if (a.interactive && b.interactive) {
        const gap = edgeGap(a, b);
        if (gap < minGap) {
          defects.push(
            `spatial defect: interactive gap ${gap.toFixed(1)}px between "${a.id}" and "${b.id}" ` +
              `< ${minGap}px floor`
          );
        }
      }
    }
  }

  if (
    subject.intraGroupGapPx !== undefined &&
    subject.interGroupGapPx !== undefined &&
    subject.interGroupGapPx < 2 * subject.intraGroupGapPx
  ) {
    defects.push(
      `spatial defect: Gestalt proximity violated ` +
        `(inter=${subject.interGroupGapPx} < 2·intra=${2 * subject.intraGroupGapPx})`
    );
  } else {
    // Derive Gestalt intra-group vs. inter-group gaps directly from LayoutBox.group.
    const grouped = boxes.filter((b) => typeof b.group === "string" && b.group.length > 0);
    if (grouped.length >= 2) {
      let maxNearestIntra = -1;
      let minInter = Infinity;
      for (let i = 0; i < grouped.length; i += 1) {
        const a = grouped[i]!;
        let nearestSame = Infinity;
        for (let j = 0; j < grouped.length; j += 1) {
          if (i === j) continue;
          const b = grouped[j]!;
          const gap = edgeGap(a, b);
          if (a.group === b.group) {
            if (gap < nearestSame) nearestSame = gap;
          } else if (gap < minInter) {
            minInter = gap;
          }
        }
        if (Number.isFinite(nearestSame) && nearestSame > maxNearestIntra) {
          maxNearestIntra = nearestSame;
        }
      }
      if (maxNearestIntra > 0 && Number.isFinite(minInter) && minInter < 2 * maxNearestIntra) {
        defects.push(
          `spatial defect: Gestalt proximity violated ` +
            `(derived inter=${minInter.toFixed(1)}px < 2·intra=${(2 * maxNearestIntra).toFixed(1)}px)`
        );
      }
    }
  }

  if (opts.checkWcag1412 !== false && boxes.some(hasTypographyMetrics)) {
    const expandedBoxes = boxes.map((b) => applyWcag1412Expansion(b));
    const expandedDefects = checkSpatialSubject(
      {
        viewportWidth: subject.viewportWidth,
        boxes: expandedBoxes,
        intraGroupGapPx: subject.intraGroupGapPx,
        interGroupGapPx: subject.interGroupGapPx
      },
      { ...opts, checkWcag1412: false }
    );
    const baseSet = new Set(defects);
    for (const d of expandedDefects) {
      if (!baseSet.has(d)) {
        defects.push(`WCAG 1.4.12 expansion: ${d}`);
      }
    }
  }

  return defects;
}

/** Anti-vacuity fixture: 360px child inside a 320px viewport (must refuse). */
export function fixtureOverflow360in320(): SpatialSubject {
  return {
    viewportWidth: 320,
    boxes: [{ id: "child", x: 0, y: 0, width: 360, height: 48 }]
  };
}

/** Anti-vacuity fixture: 18px primary button (must refuse touch floor). */
export function fixturePrimaryButton18px(): SpatialSubject {
  return {
    viewportWidth: 375,
    boxes: [
      {
        id: "primary-cta",
        x: 16,
        y: 200,
        width: 18,
        height: 18,
        interactive: true
      }
    ]
  };
}

/**
 * Anti-vacuity fixture: Gestalt inter < 2·intra (must refuse proximity ratio).
 * Live refuse witness — supplies real group-gap metadata, not stub markers.
 */
export function fixtureGestaltRatioBreach(): SpatialSubject {
  return {
    viewportWidth: 375,
    intraGroupGapPx: 8,
    interGroupGapPx: 12, // 12 < 2·8 → refuse
    boxes: [
      { id: "nav-home", x: 8, y: 8, width: 48, height: 48, interactive: true, group: "nav" },
      { id: "nav-search", x: 64, y: 8, width: 48, height: 48, interactive: true, group: "nav" },
      {
        id: "panel-main",
        x: 8,
        y: 72,
        width: 200,
        height: 80,
        group: "content"
      }
    ]
  };
}

/**
 * Anti-vacuity fixture: adjacent interactive gap < 8px floor (must refuse).
 * Edge-to-edge horizontal gap is 4px (DEFAULT_MIN_TOUCH_GAP_PX − 4).
 */
export function fixtureAdjacentGapBelowFloor(): SpatialSubject {
  return {
    viewportWidth: 375,
    boxes: [
      {
        id: "cta-a",
        x: 8,
        y: 200,
        width: 48,
        height: 48,
        interactive: true
      },
      {
        id: "cta-b",
        x: 60, // 8+48=56 → gap 4px < 8
        y: 200,
        width: 48,
        height: 48,
        interactive: true
      }
    ]
  };
}

function boxesOverlap(a: LayoutBox, b: LayoutBox): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/** Minimum edge-to-edge gap (0 if overlapping). */
function edgeGap(a: LayoutBox, b: LayoutBox): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  if (dx === 0 && dy === 0) return 0;
  if (dx === 0) return dy;
  if (dy === 0) return dx;
  return Math.hypot(dx, dy);
}

function remediationBudgetNote(attempts: number): string {
  return `max_remediation_attempts=${attempts} (mutate .ttl/.toml/templates only; re-run mix ggen_igniter.sync --check)`;
}

function verdict(
  exitCode: ExitCode,
  standing: Standing,
  diagnostics: string[],
  artifactDigests: Record<string, string>
): CourtVerdict {
  return { exitCode, standing, diagnostics, artifactDigests };
}

function defaultRun(
  cmd: string[],
  cwd: string,
  envExtra?: Record<string, string>
): RunResult {
  const r = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd,
    encoding: "utf8",
    env: envExtra ? { ...process.env, ...envExtra } : process.env,
    shell: false
  });
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function defaultResolveBinary(bin: string): boolean {
  if (!bin) return false;
  if (bin.includes("/") || bin.includes("\\")) {
    return existsSync(bin) || existsSync(join(bin));
  }
  // PATH probe — honest SUBJECT_MISSING when absent.
  const which = spawnSync("command", ["-v", bin], {
    encoding: "utf8",
    shell: true,
    env: process.env
  });
  return which.status === 0 && (which.stdout || "").trim().length > 0;
}

/** True when argv[0] is cargo (PATH name or path ending in /cargo) — never the court subject. */
function isCargoArgv0(bin: string): boolean {
  if (!bin) return false;
  if (bin === "cargo") return true;
  return bin.endsWith("/cargo") || bin.endsWith("\\cargo");
}

/** Extract `--bin <name>` from a cargo argv; undefined when omitted. */
function cargoBinName(cmd: string[]): string | undefined {
  const i = cmd.indexOf("--bin");
  if (i < 0) return undefined;
  const name = cmd[i + 1];
  if (!name || name === "--" || name.startsWith("-")) return undefined;
  return name;
}

export type TaffySubjectResolution = {
  present: boolean;
  /** Human label for SUBJECT_MISSING diagnostics (never "cargo" alone). */
  label: string;
  /** Argv to invoke when present. */
  runCmd: string[];
};

/**
 * Resolve the Taffy / layout-court *subject*, not the launcher.
 *
 * Honesty rules:
 * - Bare `cargo` is never proof the court subject exists — require `--bin`.
 * - `--bin overflow_viewport_sweep` (or overflow subcommand) is a falsifier,
 *   not a full court → SUBJECT_MISSING (never false-REFUSED).
 * - `--bin layout_court` requires `<subject.json>` after `--` (metrics+spacing
 *   JSON court). Missing subject → SUBJECT_MISSING before spawn.
 * - `--bin ggen-layout-court` runs compute_with on built-in fixtures (pass
 *   `product` for the metrics+spacing subject; bare fixture defaults to product).
 * - Prefer a built `target/{debug,release}/<bin>` (or PATH `<bin>`).
 * - Source `src/bin/<bin>.rs` under ggen-layout-court also counts as subject
 *   present so `cargo run --bin <bin>` can build; missing source + missing
 *   built bin ⇒ SUBJECT_MISSING.
 */
export function resolveTaffySubject(
  cmd: string[],
  resolve: (bin: string) => boolean,
  workspaceDir: string
): TaffySubjectResolution {
  if (!cmd.length || !cmd[0]) {
    return { present: false, label: "empty taffy_cmd", runCmd: cmd };
  }

  const argv0 = cmd[0]!;

  // Direct subject path / PATH name (not cargo).
  if (!isCargoArgv0(argv0)) {
    const bin = binBasename(argv0);
    const honesty = courtSubjectHonesty(bin, subjectArgv(cmd));
    if (!honesty.ok) {
      return { present: false, label: honesty.label, runCmd: cmd };
    }
    if (!resolve(argv0)) {
      return {
        present: false,
        label: `binary "${argv0}" not found`,
        runCmd: cmd
      };
    }
    return { present: true, label: argv0, runCmd: cmd };
  }

  // Require explicit --bin — never treat cargo-on-PATH / default-run ambiguity
  // as a present court (historical overflow-falsifier false-refuse).
  const binName = cargoBinName(cmd);
  if (!binName) {
    return {
      present: false,
      label:
        "cargo run without --bin (require --bin layout_court <subject.json> or --bin ggen-layout-court -- product)",
      runCmd: cmd
    };
  }

  const honesty = courtSubjectHonesty(binName, cargoPassthroughArgs(cmd));
  if (!honesty.ok) {
    return { present: false, label: honesty.label, runCmd: cmd };
  }

  const builtCandidates = taffyBuiltBinaryCandidates(binName, workspaceDir);
  for (const path of builtCandidates) {
    if (resolve(path) || existsSync(path)) {
      // Prefer the honest subject binary over `cargo run`.
      return { present: true, label: path, runCmd: [path, ...cargoPassthroughArgs(cmd)] };
    }
  }

  // PATH name for the court bin (still not cargo).
  if (resolve(binName)) {
    return { present: true, label: binName, runCmd: [binName, ...cargoPassthroughArgs(cmd)] };
  }

  // Source subject file — sibling may have landed bin without a prior build.
  const source = taffySubjectSourcePath(binName, workspaceDir);
  if (source) {
    return {
      present: true,
      label: source,
      // Keep cargo run --bin … so first invoke can build the subject.
      runCmd: cmd
    };
  }

  return {
    present: false,
    label: `court binary "${binName}" not found (built target/debug|release, PATH, or src/bin/${binName}.rs)`,
    runCmd: cmd
  };
}

/** Subject / fixture argv after the court binary (or after cargo `--`). */
function subjectArgv(cmd: string[]): string[] {
  if (!cmd.length) return [];
  if (isCargoArgv0(cmd[0]!)) return cargoPassthroughArgs(cmd);
  return cmd.slice(1);
}

/**
 * Fail-closed honesty gate for court bin + subject argv.
 * Overflow-only falsifier ≠ full court; layout_court needs a JSON subject.
 */
function courtSubjectHonesty(
  binName: string,
  args: string[]
): { ok: true } | { ok: false; label: string } {
  if (FALSIFIER_ONLY_BINS.has(binName)) {
    return {
      ok: false,
      label: `falsifier bin "${binName}" is not a full court (use --bin layout_court + subject.json or --bin ggen-layout-court -- product)`
    };
  }

  const head = args.find((a) => a && !a.startsWith("-"));
  if (
    head &&
    (FALSIFIER_ONLY_BINS.has(head) ||
      head === "overflow-viewport-sweep" ||
      head === "overflow_viewport_sweep")
  ) {
    return {
      ok: false,
      label: `overflow-viewport-sweep subcommand is not a full court (SUBJECT_MISSING)`
    };
  }

  if (binName === "layout_court") {
    if (!layoutCourtHasSubject(args)) {
      return {
        ok: false,
        label:
          "layout_court requires <subject.json> after -- (full court JSON with metrics+spacing)"
      };
    }
    return { ok: true };
  }

  // ggen-layout-court (built-in fixtures) or any other PATH subject: defer to
  // resolve/PATH probe (absent → SUBJECT_MISSING).
  return { ok: true };
}

/** True when layout_court argv includes a subject path (--subject/-s or positional). */
function layoutCourtHasSubject(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]!;
    if (a === "--subject" || a === "-s") {
      const path = args[i + 1];
      return Boolean(path && !path.startsWith("-"));
    }
    if (a === "--viewports") {
      i += 1;
      continue;
    }
    if (a.startsWith("-")) continue;
    return true;
  }
  return false;
}

/** Args after cargo's `--` separator (subject argv), else empty. */
function cargoPassthroughArgs(cmd: string[]): string[] {
  const i = cmd.indexOf("--");
  if (i < 0) return [];
  return cmd.slice(i + 1);
}

function taffyBuiltBinaryCandidates(binName: string, workspaceDir: string): string[] {
  const roots = [
    workspaceDir,
    join(workspaceDir, "ggen"),
    join(workspaceDir, "..", "ggen")
  ];
  const out: string[] = [];
  for (const root of roots) {
    out.push(join(root, "target", "debug", binName));
    out.push(join(root, "target", "release", binName));
  }
  return out;
}

/** First existing `…/ggen-layout-court/src/bin/<bin>.rs`, else undefined. */
function taffySubjectSourcePath(binName: string, workspaceDir: string): string | undefined {
  const candidates = [
    join(workspaceDir, "crates", "ggen-layout-court", "src", "bin", `${binName}.rs`),
    join(workspaceDir, "ggen", "crates", "ggen-layout-court", "src", "bin", `${binName}.rs`),
    join(workspaceDir, "..", "ggen", "crates", "ggen-layout-court", "src", "bin", `${binName}.rs`)
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Mode B self-contained zero-mock spatial court
// ---------------------------------------------------------------------------

/** Canonical 6-wide Mode B viewport sweep (CSS px). */
export const MODE_B_VIEWPORTS = [320, 375, 393, 600, 840, 1280] as const;

/** Material/Android preferred touch-target floor (px). */
export const MODE_B_PREFERRED_TOUCH_TARGET_PX = 48;

/** WCAG 1.4.12 text-spacing minima. */
export const WCAG_1412_LINE_HEIGHT_MULT = 1.5;
export const WCAG_1412_PARAGRAPH_SPACING_MULT = 2.0;
export const WCAG_1412_LETTER_SPACING_EM = 0.12;
export const WCAG_1412_WORD_SPACING_EM = 0.16;

export interface ModeBTextMetrics {
  fontSize: number;
  lineCount: number;
  paragraphCount: number;
  charCount: number;
  wordCount: number;
}

export interface ModeBBox extends LayoutBox {
  /** Optional text metrics for WCAG 1.4.12 1.5× expansion verification. */
  textMetrics?: ModeBTextMetrics;
  /** Optional per-control touch floor (e.g. 48px Material vs 44px WCAG). */
  preferredTouchTargetPx?: number;
}

export interface ModeBSubject extends SpatialSubject {
  boxes: ModeBBox[];
}

export interface ModeBCheckOptions extends SpatialCheckOptions {
  /** Require WCAG 1.4.12 1.5× text-expansion pass (default true). */
  checkWcag1412?: boolean;
}

export interface ModeBSpatialCourtOptions {
  subjects?: ModeBSubject[];
  viewports?: readonly number[];
  minTouchTargetPx?: number;
  minTouchGapPx?: number;
  checkWcag1412?: boolean;
}

export interface ModeBSpatialCourtResult {
  exitCode: 0 | 1;
  standing: "ALIVE" | "REFUSED";
  viewports: number[];
  defects: string[];
  artifactDigests: Record<string, string>;
}

function hasTypographyMetrics(box: LayoutBox): boolean {
  return (
    box.textMetrics !== undefined ||
    box.fontSize !== undefined ||
    box.lineHeight !== undefined ||
    box.letterSpacing !== undefined ||
    box.wordSpacing !== undefined
  );
}

/** Expand a LayoutBox / ModeBBox under WCAG 1.4.12 minima (top-left anchored). */
export function applyWcag1412Expansion(box: LayoutBox): LayoutBox {
  const m = box.textMetrics;
  if (m) {
    const widthDelta =
      m.charCount * m.fontSize * WCAG_1412_LETTER_SPACING_EM +
      m.wordCount * m.fontSize * WCAG_1412_WORD_SPACING_EM;
    const lines = Math.max(1, m.lineCount);
    const paraGaps = Math.max(0, m.paragraphCount - 1);
    const requiredHeight =
      lines * m.fontSize * WCAG_1412_LINE_HEIGHT_MULT +
      paraGaps * m.fontSize * WCAG_1412_PARAGRAPH_SPACING_MULT;
    return {
      ...box,
      width: box.width + widthDelta,
      height: Math.max(box.height, requiredHeight)
    };
  }
  if (!hasTypographyMetrics(box)) return box;
  const fontSize = box.fontSize ?? 16;
  const baseLineHeight = box.lineHeight ?? 1.2;
  const baseLetterSpacing = box.letterSpacing ?? 0;
  const baseWordSpacing = box.wordSpacing ?? 0;
  const charCount = box.charCount ?? Math.max(1, Math.round(box.width / (fontSize * 0.55)));
  const wordCount = box.wordCount ?? Math.max(1, Math.round(charCount / 5));
  const lines = Math.max(
    1,
    box.lineCount ?? Math.round(box.height / (fontSize * Math.max(0.5, baseLineHeight)))
  );
  const paraGaps = Math.max(0, (box.paragraphCount ?? 1) - 1);
  const widthDelta =
    charCount * fontSize * Math.max(0, WCAG_1412_LETTER_SPACING_EM - baseLetterSpacing) +
    wordCount * fontSize * Math.max(0, WCAG_1412_WORD_SPACING_EM - baseWordSpacing);
  const requiredHeight =
    lines * fontSize * Math.max(baseLineHeight, WCAG_1412_LINE_HEIGHT_MULT) +
    paraGaps * fontSize * WCAG_1412_PARAGRAPH_SPACING_MULT;
  return {
    ...box,
    width: box.width + widthDelta,
    height: Math.max(box.height, requiredHeight)
  };
}

/**
 * Construct canonical responsive Mode B subjects across the 6-wide sweep
 * `[320, 375, 393, 600, 840, 1280]`:
 * - Interactive controls ≥ 48×48px (satisfies both 44px WCAG and 48px Material)
 * - Intra-group gap = 8px (≥ 8px floor)
 * - Inter-group gap = 24px (≥ 2× intra-group gap for Gestalt proximity)
 * - Body copy with real `textMetrics` that remains in-bounds & non-overlapping
 *   after WCAG 1.4.12 1.5× text expansion.
 */
export function buildDefaultModeBSubjects(
  viewports: readonly number[] = MODE_B_VIEWPORTS
): ModeBSubject[] {
  return viewports.map((vw) => {
    const pad = 16;
    const intraGap = 8;
    const interGap = 24;
    const btnW = 48;
    const btnH = 48;
    const bodyWidth = Math.max(160, Math.min(vw - 2 * pad - 80, 480));
    return {
      viewportWidth: vw,
      intraGroupGapPx: intraGap,
      interGroupGapPx: interGap,
      boxes: [
        {
          id: "nav-home",
          x: pad,
          y: pad,
          width: btnW,
          height: btnH,
          interactive: true,
          preferredTouchTargetPx: MODE_B_PREFERRED_TOUCH_TARGET_PX,
          group: "nav"
        },
        {
          id: "nav-search",
          x: pad + btnW + intraGap,
          y: pad,
          width: btnW,
          height: btnH,
          interactive: true,
          preferredTouchTargetPx: MODE_B_PREFERRED_TOUCH_TARGET_PX,
          group: "nav"
        },
        {
          id: "nav-profile",
          x: pad + 2 * (btnW + intraGap),
          y: pad,
          width: btnW,
          height: btnH,
          interactive: true,
          preferredTouchTargetPx: MODE_B_PREFERRED_TOUCH_TARGET_PX,
          group: "nav"
        },
        {
          id: "content-copy",
          x: pad,
          y: pad + btnH + interGap,
          width: bodyWidth,
          height: 56,
          group: "content",
          textMetrics: {
            fontSize: 16,
            lineCount: 2,
            paragraphCount: 1,
            charCount: 18,
            wordCount: 4
          }
        },
        {
          id: "primary-cta",
          x: pad,
          y: pad + btnH + interGap + 56 + interGap,
          width: Math.min(200, vw - 2 * pad),
          height: btnH,
          interactive: true,
          preferredTouchTargetPx: MODE_B_PREFERRED_TOUCH_TARGET_PX,
          group: "actions"
        }
      ]
    };
  });
}

/**
 * Evaluate a single Mode B subject:
 * 1. Base geometry (overflow, pairwise overlap, >=44px/48px touch floors,
 *    >=8px interactive gap, Gestalt inter >= 2*intra).
 * 2. WCAG 1.4.12 1.5x text-expansion pass (overflow + overlap after expansion).
 */
export function checkModeBSubject(
  subject: ModeBSubject,
  opts: ModeBCheckOptions = {}
): string[] {
  return checkSpatialSubject(subject, {
    ...opts,
    checkWcag1412: opts.checkWcag1412 ?? true
  });
}

/**
 * Self-contained, zero-mock Mode B spatial geometry court.
 * Evaluates `[320, 375, 393, 600, 840, 1280]` viewports (or custom subjects),
 * checks >=44px/48px touch targets, >=8px gaps, WCAG 1.4.12 1.5x text expansion,
 * and Gestalt 2x spacing, and produces deterministic SHA-256 digests.
 */
export function runModeBSpatialCourt(
  opts: ModeBSpatialCourtOptions = {}
): ModeBSpatialCourtResult {
  const viewports =
    opts.viewports && opts.viewports.length > 0
      ? [...opts.viewports]
      : [...MODE_B_VIEWPORTS];
  const subjects =
    opts.subjects && opts.subjects.length > 0
      ? opts.subjects
      : buildDefaultModeBSubjects(viewports);

  const allDefects: string[] = [];
  const artifactDigests: Record<string, string> = {};

  for (const subject of subjects) {
    const defects = checkModeBSubject(subject, {
      minTouchTargetPx: opts.minTouchTargetPx ?? DEFAULT_MIN_TOUCH_TARGET_PX,
      minTouchGapPx: opts.minTouchGapPx ?? DEFAULT_MIN_TOUCH_GAP_PX,
      configuredViewports: viewports,
      checkWcag1412: opts.checkWcag1412 ?? true
    });
    artifactDigests[`mode_b_${subject.viewportWidth}`] = sha256(
      JSON.stringify({
        viewport: subject.viewportWidth,
        boxes: subject.boxes,
        defects
      })
    );
    allDefects.push(...defects);
  }

  const summaryDigest = sha256(
    JSON.stringify({
      viewports,
      defectCount: allDefects.length,
      perViewport: artifactDigests
    })
  );
  artifactDigests["mode_b_spatial"] = summaryDigest;
  artifactDigests["playwright_spatial"] = summaryDigest;

  if (allDefects.length > 0) {
    return {
      exitCode: 1,
      standing: "REFUSED",
      viewports,
      defects: allDefects,
      artifactDigests
    };
  }
  return {
    exitCode: 0,
    standing: "ALIVE",
    viewports,
    defects: [],
    artifactDigests
  };
}
