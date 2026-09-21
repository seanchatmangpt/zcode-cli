// A recorded REAL `ZCODE_OCEL=1 zcode -p ... --output-format stream-json` run (tool turn, model rate-limit
// recovery included) kept as a fixture, verified through the real scripts/ocel-verify.ts subprocess.
import { describe, expect, test } from "bun:test";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "./support/ocel.ts";

const dir = join(repoRoot, "test", "fixtures", "zcode-ocel");
const run = (log: string, ...extra: string[]) => Bun.spawnSync(["bun", join(repoRoot, "scripts", "ocel-verify.ts"), log, ...extra], { cwd: repoRoot });
const out = (r: ReturnType<typeof run>) => r.stdout.toString() + r.stderr.toString();

function scratch() {
  const d = mkdtempSync(join(tmpdir(), "zocel-real-"));
  copyFileSync(join(dir, "turn-list.receipt.json"), join(d, "t.receipt.json"));
  return d;
}

describe("real recorded run", () => {
  const log = join(dir, "turn-list.jsonocel");
  test("chain verifies and replays with zero deviations", () => {
    const r = run(log);
    expect(r.exitCode).toBe(0);
    expect(out(r)).toContain("chain-verified");
    expect(out(r)).toContain("deviations: 0");
  });
  test("run exercised a tool call", () => {
    const doc = JSON.parse(readFileSync(log, "utf8"));
    expect(doc.events.some((e: any) => e.type === "tool_updated")).toBe(true);
  });
  test("one flipped byte is detected", () => {
    const d = scratch();
    try {
      const b = readFileSync(log);
      b[10] = 0;
      writeFileSync(join(d, "t.jsonocel"), b);
      expect(run(join(d, "t.jsonocel")).exitCode).not.toBe(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  test("removing a declared event type fails the coverage gate", () => {
    const d = scratch();
    try {
      const doc = JSON.parse(readFileSync(log, "utf8"));
      doc.events = doc.events.filter((e: any) => e.type !== "turn_started");
      writeFileSync(join(d, "t.jsonocel"), JSON.stringify(doc));
      const r = run(join(d, "t.jsonocel"));
      expect(r.exitCode).not.toBe(0);
      expect(out(r)).toContain("coverage: declared event type turn_started absent");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("real recorded app-server session (source zcode_app_server, session/subscribe)", () => {
  const log = join(dir, "app-server-list.jsonocel");
  test("chain verifies, replays with zero deviations, and carries the app-server source", () => {
    const r = run(log);
    expect(r.exitCode).toBe(0);
    expect(out(r)).toContain("chain-verified");
    expect(JSON.parse(readFileSync(join(dir, "app-server-list.receipt.json"), "utf8")).source).toBe("zcode_app_server");
  });
  test("tool call events were captured", () => {
    const doc = JSON.parse(readFileSync(log, "utf8"));
    expect(doc.events.filter((e: any) => e.type === "tool_updated").length).toBeGreaterThan(0);
  });
});
