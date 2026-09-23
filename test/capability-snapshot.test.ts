import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";

// Runs the real scripts/capability-snapshot.sh against a real temp HOME.
const SCRIPT = resolve(import.meta.dir, "../scripts/capability-snapshot.sh");

let home = "";
let env: Record<string, string> = {};
let snap = "";

function run(...args: string[]) {
  const p = Bun.spawnSync(["bash", SCRIPT, ...args], { env, stdout: "pipe", stderr: "pipe" });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}
function put(rel: string, content: string) {
  const f = join(home, rel);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, content);
}

beforeAll(() => {
  // realpath: tmpdir() is reached through the /var -> /private/var symlink,
  // and bsdtar refuses to extract archive members through a symlinked prefix
  // ("Cannot extract through symlink"), which would break restore --apply.
  home = mkdtempSync(join(realpathSync(tmpdir()), "capsnap-"));
  const glm = "Applications/ZCode.app/Contents/Resources/glm";
  put(".zcode/AGENTS.md", "agents-v1");
  put(".zcode/cli/config.json", '{"token":"t1"}');
  put(".zcode/cli/plugins/p/a.txt", "plugin-a");
  put(`${glm}/runtime.js`, "runtime-v1");
  put("Applications/ZCode.app/Contents/Info.plist", "plist-v1");
  env = {
    PATH: process.env.PATH ?? "",
    HOME: home,
    ZCODE_REPO: join(home, "no-such-repo"),
    ZCODE_APP: join(home, "Applications/ZCode.app"),
    ZCODE_BACKUP_ROOT: join(home, "backups"),
  };
  const r = run("save");
  expect(r.code).toBe(0);
  snap = join(home, "backups", readdirSync(join(home, "backups"))[0]!);
});

afterAll(() => rmSync(home, { recursive: true, force: true }));

describe("capability-snapshot.sh", () => {
  test("save writes tarball + manifest, no stray paths.txt", () => {
    expect(existsSync(join(snap, "user-state.tar.gz"))).toBe(true);
    expect(existsSync(join(snap, "manifest.sha256"))).toBe(true);
    expect(existsSync(join(snap, "paths.txt"))).toBe(false);
    expect(readFileSync(join(snap, "manifest.sha256"), "utf8")).toContain("config.json");
  });

  test("verify passes on a fresh snapshot", () => {
    const r = run("verify", snap);
    expect(r.code).toBe(0);
    expect(r.out).toContain("verify OK");
  });

  test("diff exits 0 when nothing changed", () => {
    expect(run("diff", snap).code).toBe(0);
  });

  test("diff tolerates glm changes but fails on non-glm CHANGED", () => {
    put("Applications/ZCode.app/Contents/Resources/glm/runtime.js", "runtime-v2");
    const glmOnly = run("diff", snap);
    expect(glmOnly.code).toBe(0);
    expect(glmOnly.out).toContain("expected: runtime update");

    put(".zcode/cli/config.json", '{"token":"MUTATED"}');
    const r = run("diff", snap);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("CHANGED");
    expect(r.out).toContain("changed=1");
  });

  test("restore without --apply only prints the plan", () => {
    const r = run("restore", snap);
    expect(r.code).toBe(0);
    expect(r.out).toContain("restore plan:");
    expect(readFileSync(join(home, ".zcode/cli/config.json"), "utf8")).toContain("MUTATED");
  });

  test("restore --apply restores user state and replaces the runtime", () => {
    put("Applications/ZCode.app/Contents/Resources/glm/stray-new-file.js", "stray");
    const r = run("restore", snap, "--apply");
    expect(r.code).toBe(0);
    expect(readFileSync(join(home, ".zcode/cli/config.json"), "utf8")).toBe('{"token":"t1"}');
    expect(readFileSync(join(home, ".zcode/cli/plugins/p/a.txt"), "utf8")).toBe("plugin-a");
    const glm = join(home, "Applications/ZCode.app/Contents/Resources/glm");
    expect(readFileSync(join(glm, "runtime.js"), "utf8")).toBe("runtime-v1");
    expect(existsSync(join(glm, "stray-new-file.js"))).toBe(false); // rm -rf step honored
    expect(run("diff", snap).code).toBe(0);
  });

  test("save fails loudly when there is nothing to snapshot", () => {
    const empty = mkdtempSync(join(realpathSync(tmpdir()), "capsnap-empty-"));
    const p = Bun.spawnSync(["bash", SCRIPT, "save"], {
      env: { ...env, HOME: empty, ZCODE_APP: join(empty, "none"), ZCODE_BACKUP_ROOT: join(empty, "b") },
      stdout: "pipe",
      stderr: "pipe",
    });
    rmSync(empty, { recursive: true, force: true });
    expect(p.exitCode).not.toBe(0);
    expect(p.stderr.toString()).toContain("nothing to snapshot");
  });
});
