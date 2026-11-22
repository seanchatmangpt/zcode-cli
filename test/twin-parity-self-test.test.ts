/**
 * Chicago tests for scripts/twin-parity-self-test.ts — real twins, real diverge.
 * No fake PASS: diverge and missing castle must fail closed.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import {
  listBrandRels,
  resolveCastleDir,
  runTwinParitySelfTest,
  REPO_ROOT
} from "../scripts/twin-parity-self-test.ts";

describe("twin-parity-self-test", () => {
  test("live zcode-cli ↔ castle fourth-watch brands are byte-identical", () => {
    const result = runTwinParitySelfTest({ repoRoot: REPO_ROOT });
    expect(result.code).toBe(0);
    expect(result.pairs.length).toBeGreaterThan(0);
    expect(result.pairs.every((p) => p.ok)).toBe(true);
    expect(result.pairs.some((p) => p.rel === "fourth-watch.brand.toml")).toBe(true);
    expect(result.report).toContain("OK");
  });

  test("CLI entry exits 0 when live twins match", () => {
    const r = spawnSync(
      "bun",
      [join(REPO_ROOT, "scripts/twin-parity-self-test.ts")],
      { cwd: REPO_ROOT, encoding: "utf8" }
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("fourth-watch.brand.toml");
  });

  test("fail-closed: hash diverge → exit 1", () => {
    const root = mkdtempSync(join(tmpdir(), "twin-diverge-"));
    const castle = mkdtempSync(join(tmpdir(), "twin-castle-"));
    try {
      mkdirSync(join(root, "brands"), { recursive: true });
      mkdirSync(join(castle, "brands"), { recursive: true });
      writeFileSync(join(root, "brands/fourth-watch.brand.toml"), "local-twin\n");
      writeFileSync(join(castle, "brands/fourth-watch.brand.toml"), "castle-twin\n");
      const result = runTwinParitySelfTest({ repoRoot: root, castleDir: castle });
      expect(result.code).toBe(1);
      expect(result.pairs[0]?.ok).toBe(false);
      expect(result.report).toContain("DRIFT");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(castle, { recursive: true, force: true });
    }
  });

  test("fail-closed: asymmetric brand set → exit 1", () => {
    const root = mkdtempSync(join(tmpdir(), "twin-asym-"));
    const castle = mkdtempSync(join(tmpdir(), "twin-castle-asym-"));
    try {
      mkdirSync(join(root, "brands"), { recursive: true });
      mkdirSync(join(castle, "brands"), { recursive: true });
      writeFileSync(join(root, "brands/fourth-watch.brand.toml"), "same\n");
      writeFileSync(join(castle, "brands/fourth-watch.brand.toml"), "same\n");
      writeFileSync(join(root, "brands/extra.brand.toml"), "only-local\n");
      const result = runTwinParitySelfTest({ repoRoot: root, castleDir: castle });
      expect(result.code).toBe(1);
      expect(result.report).toContain("asymmetric");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(castle, { recursive: true, force: true });
    }
  });

  test("fail-closed: missing castle brands → exit 2", () => {
    const root = mkdtempSync(join(tmpdir(), "twin-missing-"));
    try {
      mkdirSync(join(root, "brands"), { recursive: true });
      writeFileSync(join(root, "brands/fourth-watch.brand.toml"), "x\n");
      const result = runTwinParitySelfTest({
        repoRoot: root,
        castleDir: join(root, "no-such-castle")
      });
      expect(result.code).toBe(2);
      expect(result.report).toContain("REFUSED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("identical fixtures → exit 0", () => {
    const root = mkdtempSync(join(tmpdir(), "twin-ok-"));
    const castle = mkdtempSync(join(tmpdir(), "twin-castle-ok-"));
    try {
      mkdirSync(join(root, "brands"), { recursive: true });
      mkdirSync(join(castle, "brands"), { recursive: true });
      const body = '# twin fixture\nid = "fourth-watch"\n';
      writeFileSync(join(root, "brands/fourth-watch.brand.toml"), body);
      cpSync(
        join(root, "brands/fourth-watch.brand.toml"),
        join(castle, "brands/fourth-watch.brand.toml")
      );
      const result = runTwinParitySelfTest({ repoRoot: root, castleDir: castle });
      expect(result.code).toBe(0);
      expect(result.pairs).toEqual([
        expect.objectContaining({
          rel: "fourth-watch.brand.toml",
          ok: true
        })
      ]);
      expect(result.pairs[0]?.localSha).toBe(result.pairs[0]?.twinSha);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(castle, { recursive: true, force: true });
    }
  });

  test("resolveCastleDir prefers ZCODE_CASTLE_DIR then toml", () => {
    const fromEnv = resolveCastleDir(REPO_ROOT, {
      ...process.env,
      ZCODE_CASTLE_DIR: "/tmp/fake-castle-from-env"
    });
    expect(fromEnv).toBe("/tmp/fake-castle-from-env");
    const fromToml = resolveCastleDir(REPO_ROOT, {
      ...process.env,
      ZCODE_CASTLE_DIR: undefined
    });
    expect(fromToml).toBe("/Users/sac/castle");
  });

  test("listBrandRels finds fourth-watch under live brands/", () => {
    const rels = listBrandRels(join(REPO_ROOT, "brands"));
    expect(rels).toContain("fourth-watch.brand.toml");
  });
});
