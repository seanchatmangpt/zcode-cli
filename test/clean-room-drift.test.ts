/**
 * Jobs/C4 clean-room drift evaluator — unit falsifiers for the git-diff fallacy.
 * ELIMINATE-2: no legacy require_git_diff_zero / require_clean_room_diff aliases;
 * evaluateCleanRoomDrift refuses git* argv; IGNITER_DIRTY_TREE is dead.
 */
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CLEAN_ROOM_CHECK_CMD,
  evaluateCleanRoomDrift,
  isGitSyncCmd,
  isNoopCleanRoomCmd,
  parsePlannedWrites
} from "../src/adapters/clean-room-drift.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { adapterOptionsFromTomlDoc } from "../src/adapters/index.ts";
import { parseTomlDocument } from "../src/compliance/config.ts";

describe("clean-room-drift", () => {
  test("default cmd is mix ggen_igniter.sync --check", () => {
    expect([...DEFAULT_CLEAN_ROOM_CHECK_CMD]).toEqual(["mix", "ggen_igniter.sync", "--check"]);
  });

  test("noop true → LOUD_SKIP (never fake ALIVE)", () => {
    expect(isNoopCleanRoomCmd(["true"])).toBe(true);
    const v = evaluateCleanRoomDrift(["true"], { status: 0, stdout: "", stderr: "" });
    expect(v.kind).toBe("loud_skip");
    expect(v.exitCode).toBe(3);
    expect(v.noopStub).toBe(true);
  });

  test("falsifier: git* sync cmd refuses (never pass on clean index)", () => {
    for (const cmd of [
      ["git", "diff", "--exit-code"],
      ["/usr/bin/git", "status", "--porcelain"],
      ["git", "diff", "--quiet"]
    ]) {
      expect(isGitSyncCmd(cmd)).toBe(true);
      const v = evaluateCleanRoomDrift(cmd, { status: 0, stdout: "", stderr: "" });
      expect(v.kind).toBe("refuse");
      expect(v.exitCode).toBe(1);
      expect(v.diagnostics.join(" ")).toMatch(/git\* sync cmd|clean-room fallacy/);
    }
  });

  test("falsifier: legacy TOML require_git_diff_zero / require_clean_room_diff aliases are dead", () => {
    const loader = readFileSync(join(import.meta.dir, "../src/adapters/index.ts"), "utf8");
    // Live property reads of the fallacy keys must be gone (comments may still name them).
    expect(loader).not.toMatch(/igniter\.require_git_diff_zero/);
    expect(loader).not.toMatch(/uiLayout\.require_clean_room_diff/);

    const dir = "/tmp/e2-clean-room-alias";
    const doc = parseTomlDocument(`
[adapters.ggen_igniter]
enabled = true
require_git_diff_zero = false
require_sync_check = true

[adapters.ui_layout]
enabled = true
require_clean_room_diff = false
require_clean_room = true
`);
    const { options } = adapterOptionsFromTomlDoc(doc, dir);
    // Legacy keys must not be read — only normative keys map.
    expect(options.ggen_igniter?.requireSyncCheck).toBe(true);
    expect(options.ui_layout?.requireCleanRoom).toBe(true);

    // Setting only the legacy false key must NOT disable the gate (alias deleted).
    const legacyOnly = parseTomlDocument(`
[adapters.ggen_igniter]
require_git_diff_zero = false
[adapters.ui_layout]
require_clean_room_diff = false
`);
    const legacy = adapterOptionsFromTomlDoc(legacyOnly, dir);
    expect(legacy.options.ggen_igniter?.requireSyncCheck).toBe(true);
    expect(legacy.options.ui_layout?.requireCleanRoom).toBe(true);
  });

  test("falsifier: IGNITER_DIRTY_TREE error code is gone from sjira-adapter", () => {
    const src = readFileSync(join(import.meta.dir, "../src/io/sjira-adapter.ts"), "utf8");
    expect(src).not.toContain("IGNITER_DIRTY_TREE");
    expect(src).toContain("IGNITER_SYNC_FAILED");
    expect(src).toMatch(
      /export type SjiraAdapterErrorCode\s*=[\s\S]*?IGNITER_SYNC_FAILED[\s\S]*?;/
    );
    expect(src).not.toMatch(
      /export type SjiraAdapterErrorCode\s*=[\s\S]*?IGNITER_DIRTY_TREE[\s\S]*?;/
    );
  });

  test("igniter --check exit 0 → pass", () => {
    const v = evaluateCleanRoomDrift([...DEFAULT_CLEAN_ROOM_CHECK_CMD], {
      status: 0,
      stdout: "clean",
      stderr: ""
    });
    expect(v.kind).toBe("pass");
    expect(v.exitCode).toBe(0);
  });

  test("igniter --check exit 4 → refuse", () => {
    const v = evaluateCleanRoomDrift([...DEFAULT_CLEAN_ROOM_CHECK_CMD], {
      status: 4,
      stdout: "DRIFT",
      stderr: ""
    });
    expect(v.kind).toBe("refuse");
    expect(v.exitCode).toBe(1);
    expect(v.diagnostics.join(" ")).toMatch(/exit 4/);
  });

  test("ggen dry-run planned_writes=[] → pass", () => {
    const v = evaluateCleanRoomDrift(["ggen", "sync", "run", "--dry-run", "--format", "json"], {
      status: 0,
      stdout: JSON.stringify({ planned_writes: [] }),
      stderr: ""
    });
    expect(v.kind).toBe("pass");
  });

  test("ggen dry-run planned_writes non-empty → refuse", () => {
    const v = evaluateCleanRoomDrift(["ggen", "sync", "run", "--dry-run"], {
      status: 0,
      stdout: JSON.stringify({ planned_writes: ["a.ex", "b.ex"] }),
      stderr: ""
    });
    expect(v.kind).toBe("refuse");
    expect(v.diagnostics.join(" ")).toMatch(/planned_writes non-empty \(2\)/);
  });

  test("ggen dry-run missing planned_writes → blocked", () => {
    const v = evaluateCleanRoomDrift(["ggen", "sync", "run", "--dry-run"], {
      status: 0,
      stdout: "ok but not json",
      stderr: ""
    });
    expect(v.kind).toBe("blocked");
    expect(v.exitCode).toBe(2);
  });

  test("parsePlannedWrites extracts array from stream tail", () => {
    expect(parsePlannedWrites('log\n{"planned_writes":[]}\n')).toEqual([]);
    expect(parsePlannedWrites("")).toBeNull();
  });
});
