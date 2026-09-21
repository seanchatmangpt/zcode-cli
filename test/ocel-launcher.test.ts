// Launcher-level gating: ZCODE_OCEL=1 plus a tappable invocation, output location, real files.
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { APP_SERVER_SOURCE, STREAM_SOURCE, ocelDirectory, ocelEnabled, ocelSourceForArgs, startOcelTap } from "../src/ocel-tap.ts";
import { fixtures } from "./support/ocel.ts";

describe("ocel tap gating", () => {
  test("off unless ZCODE_OCEL=1", () => {
    expect(ocelEnabled({})).toBe(false);
    expect(ocelEnabled({ ZCODE_OCEL: "0" })).toBe(false);
    expect(ocelEnabled({ ZCODE_OCEL: "1" })).toBe(true);
    expect(startOcelTap(["-p", "hi", "--output-format", "stream-json"], {})).toBeUndefined();
  });
  test("output dir defaults to ~/.zcode/ocel and honors ZCODE_OCEL_DIR", () => {
    expect(ocelDirectory({})).toBe(join(homedir(), ".zcode", "ocel"));
    expect(ocelDirectory({ ZCODE_OCEL_DIR: "/x/y" })).toBe("/x/y");
  });
  test("source selection from runtime arguments", () => {
    expect(ocelSourceForArgs(["-p", "hi", "--output-format", "stream-json"])).toBe(STREAM_SOURCE);
    expect(ocelSourceForArgs(["--print", "hi", "--output-format=stream-json"])).toBe(STREAM_SOURCE);
    expect(ocelSourceForArgs(["app-server"])).toBe(APP_SERVER_SOURCE);
    expect(ocelSourceForArgs(["-p", "hi"])).toBeUndefined();
    expect(ocelSourceForArgs(["-p", "hi", "--output-format", "json"])).toBeUndefined();
    expect(ocelSourceForArgs([])).toBeUndefined();
  });
  test("a gated recorder writes <session>.jsonocel and <session>.receipt.json into ZCODE_OCEL_DIR", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-launch-"));
    try {
      const rec = startOcelTap(["-p", "x", "--output-format", "stream-json"], { ZCODE_OCEL: "1", ZCODE_OCEL_DIR: join(dir, "nested") })!;
      const fx = fixtures()[0];
      rec.write(fx.lines.join("\n") + "\n");
      const out = rec.finish();
      expect(out.sessionId).toBe(fx.records[0].sessionId);
      expect(existsSync(join(dir, "nested", `${out.sessionId}.jsonocel`))).toBe(true);
      expect(existsSync(join(dir, "nested", `${out.sessionId}.receipt.json`))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
