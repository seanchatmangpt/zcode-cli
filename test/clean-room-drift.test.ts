/**
 * Jobs/C4 clean-room drift evaluator — unit falsifiers for the git-diff fallacy.
 */
import { describe, expect, test } from "bun:test";

import {
  DEFAULT_CLEAN_ROOM_CHECK_CMD,
  evaluateCleanRoomDrift,
  isNoopCleanRoomCmd,
  parsePlannedWrites
} from "../src/adapters/clean-room-drift.ts";

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
      const v = evaluateCleanRoomDrift(cmd, { status: 0, stdout: "", stderr: "" });
      expect(v.kind).toBe("refuse");
      expect(v.exitCode).toBe(1);
      expect(v.diagnostics.join(" ")).toMatch(/git\* sync cmd|clean-room fallacy/);
    }
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
