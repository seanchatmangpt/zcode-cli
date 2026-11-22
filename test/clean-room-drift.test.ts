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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adapterOptionsFromTomlDoc } from "../src/adapters/index.ts";
import {
  DEFAULT_FORBID_DOMAIN_WALL_CLOCK,
  IgniterSyncCourtAdapter,
  findDomainWallClock,
  findGeneratedDirs
} from "../src/adapters/igniter-sync.ts";
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

  test("falsifier: shell-wrapped git, env true, and arbitrary non-igniter commands never pass", async () => {
    for (const gitCmd of [
      ["sh", "-c", "git diff --exit-code"],
      ["/bin/bash", "-lc", "git status --porcelain"],
      ["env", "git", "diff", "--quiet"],
      ["/usr/bin/env", "FOO=1", "git", "diff"]
    ]) {
      expect(isGitSyncCmd(gitCmd)).toBe(true);
      const v = evaluateCleanRoomDrift(gitCmd, { status: 0, stdout: "", stderr: "" });
      expect(v.kind).toBe("refuse");
      expect(v.exitCode).toBe(1);
    }

    for (const noopCmd of [
      ["env", "true"],
      ["/usr/bin/env", "true"],
      ["sh", "-c", "true"],
      [":"]
    ]) {
      expect(isNoopCleanRoomCmd(noopCmd)).toBe(true);
      const v = evaluateCleanRoomDrift(noopCmd, { status: 0, stdout: "", stderr: "" });
      expect(v.kind).toBe("loud_skip");
      expect(v.exitCode).toBe(3);
    }

    for (const arbitraryCmd of [
      ["echo", "clean"],
      ["sh", "-c", "exit 0"],
      ["ls", "-la"]
    ]) {
      const v = evaluateCleanRoomDrift(arbitraryCmd, { status: 0, stdout: "clean", stderr: "" });
      expect(v.kind).toBe("refuse");
      expect(v.exitCode).toBe(1);
      expect(v.diagnostics.join(" ")).toMatch(/unadmitted sync cmd/);
    }

    const ws = mkdtempSync(join(tmpdir(), "zcode-cleanroom-unadmitted-"));
    try {
      let spawned = false;
      const court = new IgniterSyncCourtAdapter({
        cleanRoomSyncCmd: ["echo", "clean"],
        run: () => {
          spawned = true;
          return { status: 0, stdout: "clean", stderr: "" };
        }
      });
      const verdict = await court.verifyPostTransition(ws);
      expect(spawned).toBe(false);
      expect(verdict.exitCode).toBe(1);
      expect(verdict.standing).toBe("REFUSED");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  test("falsifier: findGeneratedDirs catches mixed-case Generated/ and GENERATED/", async () => {
    const ws = mkdtempSync(join(tmpdir(), "zcode-generated-case-"));
    try {
      mkdirSync(join(ws, "src", "Generated"), { recursive: true });
      mkdirSync(join(ws, "lib", "GENERATED"), { recursive: true });
      const found = findGeneratedDirs(ws).sort();
      expect(found).toEqual(["lib/GENERATED", "src/Generated"]);

      const court = new IgniterSyncCourtAdapter({
        run: () => ({ status: 0, stdout: "clean", stderr: "" })
      });
      const verdict = await court.verifyPostTransition(ws);
      expect(verdict.exitCode).toBe(1);
      expect(verdict.standing).toBe("REFUSED");
      expect(verdict.diagnostics.join(" ")).toMatch(/forbid_generated_dirs/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  test("falsifier: findDomainWallClock catches TS/JS, Rust, and Elixir/Erlang clock APIs", async () => {
    const ws = mkdtempSync(join(tmpdir(), "zcode-wallclock-"));
    try {
      mkdirSync(join(ws, "src"), { recursive: true });
      mkdirSync(join(ws, "lib"), { recursive: true });
      writeFileSync(join(ws, "src", "clock.ts"), "export const now = () => Date.now();\n");
      writeFileSync(join(ws, "src", "clock.rs"), "pub fn now() { let _ = std::time::SystemTime::now(); }\n");
      writeFileSync(join(ws, "lib", "clock.ex"), "def now, do: System.system_time()\n");
      writeFileSync(join(ws, "src", "foo_generated.ts"), "export const t = performance.now();\n");

      const hits = findDomainWallClock(ws, DEFAULT_FORBID_DOMAIN_WALL_CLOCK);
      expect(hits).toContain("src/clock.ts:Date.now(");
      expect(hits).toContain("src/clock.rs:SystemTime::now");
      expect(hits).toContain("lib/clock.ex:System.system_time");
      expect(hits).toContain("src/foo_generated.ts:performance.now(");

      const court = new IgniterSyncCourtAdapter({
        run: () => ({ status: 0, stdout: "clean", stderr: "" })
      });
      const verdict = await court.verifyPostTransition(ws);
      expect(verdict.exitCode).toBe(1);
      expect(verdict.standing).toBe("REFUSED");
      expect(verdict.diagnostics.join(" ")).toMatch(/domain wall-clock forbidden/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
