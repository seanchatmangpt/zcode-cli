import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { extractMaxTurns, readSubagentMaxTurnsSetting, resolveSubagentMaxTurnsEnv } from "../src/max-turns.ts";
import { patchRuntimeMaxTurnsEnforcement, patchRuntimeSubagentMaxTurns } from "../scripts/sync-runtime.ts";

test("extractMaxTurns lowers --max-turns N and strips it from runtime args", () => {
  expect(extractMaxTurns(["--max-turns", "2", "--prompt", "x"])).toEqual({ args: ["--prompt", "x"], maxTurns: 2 });
  expect(extractMaxTurns(["--max-turns=5", "app-server"])).toEqual({ args: ["app-server"], maxTurns: 5 });
  expect(extractMaxTurns(["app-server"])).toEqual({ args: ["app-server"] });
});

test("extractMaxTurns rejects non-positive or missing values", () => {
  for (const bad of [["--max-turns"], ["--max-turns", "0"], ["--max-turns=abc"], ["--max-turns", "-1"]]) {
    expect(extractMaxTurns(bad).error).toMatch(/positive integer/);
  }
});

test("patched guard falls back to env ZCODE_MAX_TURNS", () => {
  const fixture =
    'function z4e(e){return Ie(he.ModelContextExceeded,"x",{})}' +
    "async function mIn(e){for(;;){fi(e.turnAbortSignal);let t=e.turnRequestState.outputTokenContinuationCount>0,r=1;}}" +
    'a(mIn,"runRegularTurnLoop");';
  expect(patchRuntimeMaxTurnsEnforcement(fixture)).toContain("this.config?.maxTurns??Number(process.env.ZCODE_MAX_TURNS)");
});

const subagentFixture =
  'spawn({sessionId:t.sessionId,agentName:"zcode-general-purpose",maxTurns:t.maxTurns??this.config.subagents?.maxTurns??4,parentSessionId:this.sessionId,taskType:"subagent_child"});';

test("subagent spawn default falls back to env ZCODE_SUBAGENT_MAX_TURNS", () => {
  const patched = patchRuntimeSubagentMaxTurns(subagentFixture);
  expect(patched).toContain("maxTurns:t.maxTurns??this.config.subagents?.maxTurns??(Number(process.env.ZCODE_SUBAGENT_MAX_TURNS)||4)");
  // idempotent: a second pass is a no-op
  expect(patchRuntimeSubagentMaxTurns(patched)).toBe(patched);
});

test("subagent max turns patch throws on a moved anchor", () => {
  expect(() => patchRuntimeSubagentMaxTurns("maxTurns:t.maxTurns??4")).toThrow(/anchor missing/);
});

test("readSubagentMaxTurnsSetting accepts positive integers and refuses everything else", () => {
  const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/max-turns/${name}`, import.meta.url));
  expect(readSubagentMaxTurnsSetting(fixture("setting-subagent-100.json"))).toBe(100);
  expect(readSubagentMaxTurnsSetting(fixture("setting-subagent-invalid.json"))).toBeUndefined();
  expect(readSubagentMaxTurnsSetting(fixture("setting-subagent-missing.json"))).toBeUndefined();
});

test("resolveSubagentMaxTurnsEnv: explicit env wins, then setting.json, else unset", () => {
  const home = fileURLToPath(new URL("./fixtures/max-turns/home", import.meta.url));
  const envWithHome = { HOME: home } as NodeJS.ProcessEnv;
  expect(resolveSubagentMaxTurnsEnv({ ZCODE_SUBAGENT_MAX_TURNS: "30" })).toBe("30");
  expect(resolveSubagentMaxTurnsEnv({ ...envWithHome, ZCODE_SUBAGENT_MAX_TURNS: "30" })).toBe("30");
  expect(resolveSubagentMaxTurnsEnv(envWithHome)).toBe("100");
  // no config anywhere: HOME points at a fixture dir with no .zcode/cli/setting.json
  const emptyHome = fileURLToPath(new URL("./fixtures/max-turns/empty-home", import.meta.url));
  expect(resolveSubagentMaxTurnsEnv({ HOME: emptyHome })).toBeUndefined();
});

import { readFileSync } from "node:fs";

// Real capture: `ZCODE_MAX_TURNS=2 node bin/zcode.js app-server` against the live provider (scripts/max-turns-live.mjs).
const live = readFileSync(new URL("./fixtures/max-turns/app-server-live.jsonl", import.meta.url), "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l) as { params: { payload: Record<string, unknown>; type: string } });

test("recorded live app-server run: maxTurns stops the loop with error_max_turns", () => {
  const failed = live.find((m) => m.params.type === "turn.failed");
  expect(JSON.stringify(failed)).toContain('"reason":"error_max_turns"');
  expect(JSON.stringify(failed)).toContain("Reached maximum number of turns (2).");
});

test("recorded live app-server run: tool ledger events reach the stream as tool.updated", () => {
  const kinds = live.filter((m) => m.params.type === "tool.updated").map((m) => m.params.payload.kind);
  expect(kinds).toContain("scheduled");
  expect(kinds).toContain("started");
});
