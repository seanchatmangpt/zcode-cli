// Launcher-level gating: ZCODE_OCEL=1 plus a tappable invocation, output location, real files.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { APP_SERVER_SOURCE, STREAM_SOURCE, ocelDirectory, ocelEnabled, ocelSourceForArgs, startOcelTap } from "../src/ocel-tap.ts";
import { OcelRecorder } from "../src/ocel-tap.ts";
import { declaredRuntimeEvents, fixtures, ocelProblems, repoRoot } from "./support/ocel.ts";

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
    // 3.14.3 `--json` is a presentation surface, not the event stream: observed live 2026-09-23 it
    // emits ONE result object (no per-event eventId/timestamp), so tapping it would manufacture an
    // empty blocked receipt. Only --output-format stream-json carries the NDJSON event wire.
    expect(ocelSourceForArgs(["-p", "hi", "--json"])).toBeUndefined();
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

// Contract fixture: a real recorded runtime turn. Override the path with ZCODE_CONTRACT_FIXTURE to run the
// same test against a mutated copy (a renamed event field must fail it).
describe("runtime turn contract fixture", () => {
  const path = process.env.ZCODE_CONTRACT_FIXTURE ?? join(repoRoot, "test", "fixtures", "runtime-turn.contract.json");
  const contract = JSON.parse(readFileSync(path, "utf8"));
  test("every record keeps its event type and the tap records exactly the mapped events", () => {
    const declared = new Map(declaredRuntimeEvents().filter((e) => e.source === contract.source).map((e) => [e.name, e]));
    const types = contract.records.map((r: any) => r.type);
    expect(types).toEqual(contract.expectedTypes);
    for (const t of types) expect(declared.has(t)).toBe(true);
    const mapped = contract.records.filter((r: any) => !declared.get(r.type)!.unmappedReason).length;
    const dir = mkdtempSync(join(tmpdir(), "zcode-contract-"));
    try {
      const rec = new OcelRecorder(contract.source, dir);
      rec.write(contract.records.map((r: any) => JSON.stringify(r)).join("\n") + "\n");
      const out = rec.finish();
      expect(out.events).toBe(mapped);
      expect(out.events).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Recorded live smoke 2026-09-23: zcode 3.14.3 runtime, `ZCODE_OCEL=1 zcode -p "Reply with exactly
// TAP-SMOKE-OK" --output-format stream-json` over the zai provider (full run: 61 events, chain
// verified, 0 replay deviations). Payload interiors are omitted below; the wire-identity fields
// (type/eventId/seq/traceId/timestamp/sessionId/turnId and payload.requestId) are byte-real. The
// trailing `result` line is the summary object the runtime appends after the stream: it has no
// eventId/timestamp, so the tap must drop it rather than emit a half-identified event.
const LIVE_3_14_3_SLICE: Record<string, unknown>[] = [
  {
    type: "session.titleUpdated",
    eventId: "18204d26-373e-4cd7-a889-9c4fe881bd7f",
    seq: 1,
    traceId: "53e321d7-fb78-4cff-a9ca-8adaa38728ee",
    sessionId: "sess_4aaa67df-6762-4628-a5b4-e8c0e690c07d",
    turnId: "turn_acbaa60b-2078-47aa-a524-88048fc335f8",
    timestamp: 1790200557261,
    payload: { messageCount: 6, providerId: "zai", modelId: "glm-5.3", toolCount: 35, iteration: 0 }
  },
  {
    type: "turn.started",
    eventId: "b01845fb-d809-47d1-b7d2-4aec89c72935",
    seq: 2,
    traceId: "53e321d7-fb78-4cff-a9ca-8adaa38728ee",
    sessionId: "sess_4aaa67df-6762-4628-a5b4-e8c0e690c07d",
    turnId: "turn_acbaa60b-2078-47aa-a524-88048fc335f8",
    timestamp: 1790200557263,
    payload: {}
  },
  {
    type: "session.updated",
    eventId: "8def5aef-7de6-4698-8fea-aa6c96541306",
    seq: 3,
    traceId: "53e321d7-fb78-4cff-a9ca-8adaa38728ee",
    sessionId: "sess_4aaa67df-6762-4628-a5b4-e8c0e690c07d",
    turnId: "turn_acbaa60b-2078-47aa-a524-88048fc335f8",
    timestamp: 1790200559288,
    payload: { messageCount: 6, providerId: "zai", modelId: "glm-5.3", toolCount: 35, iteration: 0 }
  },
  {
    type: "session.updated",
    eventId: "16b4711b-a838-400d-b34f-8932b595cd3c",
    seq: 4,
    traceId: "53e321d7-fb78-4cff-a9ca-8adaa38728ee",
    sessionId: "sess_4aaa67df-6762-4628-a5b4-e8c0e690c07d",
    turnId: "turn_acbaa60b-2078-47aa-a524-88048fc335f8",
    timestamp: 1790200559296,
    payload: { type: "model_request_started", requestId: "77cb75ea-53fd-4713-b39a-05eaaf9931d5", turnId: "turn_acbaa60b-2078-47aa-a524-88048fc335f8" }
  },
  {
    type: "model.streaming",
    eventId: "6df36d42-81a2-4eb6-a040-bd343a1fecd0",
    seq: 5,
    traceId: "53e321d7-fb78-4cff-a9ca-8adaa38728ee",
    sessionId: "sess_4aaa67df-6762-4628-a5b4-e8c0e690c07d",
    turnId: "turn_acbaa60b-2078-47aa-a524-88048fc335f8",
    timestamp: 1790200565471,
    payload: {}
  },
  {
    type: "turn.completed",
    eventId: "5a2e4894-6422-41de-86cd-151636fcbca9",
    seq: 61,
    traceId: "53e321d7-fb78-4cff-a9ca-8adaa38728ee",
    sessionId: "sess_4aaa67df-6762-4628-a5b4-e8c0e690c07d",
    turnId: "turn_acbaa60b-2078-47aa-a524-88048fc335f8",
    timestamp: 1790200565500,
    payload: { stopReason: "end", toolCallCount: 0 }
  },
  {
    type: "result",
    traceId: "53e321d7-fb78-4cff-a9ca-8adaa38728ee",
    sessionId: "sess_4aaa67df-6762-4628-a5b4-e8c0e690c07d",
    turnId: "turn_acbaa60b-2078-47aa-a524-88048fc335f8",
    response: "TAP-SMOKE-OK",
    eventCount: 6
  }
];

describe("recorded live 3.14.3 stream-json slice (2026-09-23 smoke)", () => {
  const run = (dir: string) => {
    const rec = new OcelRecorder(STREAM_SOURCE, dir);
    rec.write(LIVE_3_14_3_SLICE.map((r) => JSON.stringify(r)).join("\n") + "\n");
    return { rec, out: rec.finish() };
  };

  test("maps every protocol event and drops the result summary", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-live-"));
    try {
      const { out } = run(dir);
      expect(out.events).toBe(6);
      expect(out.sessionId).toBe("sess_4aaa67df-6762-4628-a5b4-e8c0e690c07d");
      const doc = JSON.parse(readFileSync(out.ocelPath, "utf8"));
      expect(doc.events.map((e: any) => e.type)).toEqual([
        "session_title_updated",
        "turn_started",
        "session_updated",
        "session_updated",
        "model_streaming",
        "turn_completed"
      ]);
      // payload.requestId binds the model_request object; epoch timestamps are ISO-normalized.
      expect(doc.objects.map((o: any) => o.type).sort()).toEqual(["model_request", "session", "turn"]);
      expect(doc.events[3]!.relationships).toContainEqual({ objectId: "77cb75ea-53fd-4713-b39a-05eaaf9931d5", qualifier: "about_model_request" });
      expect(doc.events[0]!.time).toBe(new Date(1790200557261).toISOString());
      expect(ocelProblems(doc)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("receipt seals alive with an intact chain matching the written log", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-live-"));
    try {
      const { out } = run(dir);
      const receipt = JSON.parse(readFileSync(out.receiptPath, "utf8"));
      expect(receipt.chain_intact).toBe(true);
      expect(receipt.unpaired).toEqual([]);
      expect(receipt.event_count).toBe(6);
      expect(receipt.source).toBe("zcode_stream");
      expect(receipt.ocel_file_sha256).toBe(createHash("sha256").update(readFileSync(out.ocelPath)).digest("hex"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the real scripts/ocel-verify.ts passes on the recorded slice", () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-live-"));
    try {
      const { out } = run(dir);
      const r = Bun.spawnSync(["bun", join(repoRoot, "scripts", "ocel-verify.ts"), out.ocelPath], { cwd: repoRoot });
      const text = r.stdout.toString() + r.stderr.toString();
      expect(r.exitCode).toBe(0);
      expect(text).toContain("chain-verified");
      expect(text).toContain("deviations: 0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
