// Fixtures -> generated mapper -> OCEL 2.0 validity, chain replay, seal-once refusal, tamper detection.
// Real files in a real temp dir; the mapper, chain and receipt modules are the ggen-generated ones.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EVENT_TYPES, OBJECT_TYPES, RULES, Tap, verifyChain, type OcelDoc } from "../src/generated/ocel.ts";
import { verify as verifyReceiptChain, seal as sealReceipt, appendPending, appendOutcome, unpaired, type Chain } from "../src/generated/receipt.ts";
import { OcelRecorder, STREAM_SOURCE, normalizeRecord, toEx4pmReceipt } from "../src/ocel-tap.ts";
import { declaredRuntimeEvents, fixtures, getPath, ocelProblems, repoRoot, schemaProblems } from "./support/ocel.ts";

const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "zcode-ocel-")); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const unmapped = new Set(declaredRuntimeEvents().filter((e) => e.source === STREAM_SOURCE && e.unmappedReason).map((e) => e.name));
const schemas = JSON.parse(readFileSync(join(repoRoot, "src", "generated", "schemas.json"), "utf8"));

function record(name: string, lines: string[], chunk: number) {
  const dir = tmp();
  const rec = new OcelRecorder(STREAM_SOURCE, dir);
  const text = lines.join("\n") + "\n";
  for (let i = 0; i < text.length; i += chunk) rec.write(text.slice(i, i + chunk)); // splits mid-line on purpose
  const out = rec.finish();
  return { dir, out, rec, doc: JSON.parse(readFileSync(out.ocelPath, "utf8")) as OcelDoc, receipt: JSON.parse(readFileSync(out.receiptPath, "utf8")) };
}

describe("recorded real runtime turns -> generated OCEL 2.0", () => {
  for (const fx of fixtures()) {
    test(`${fx.name}: valid OCEL 2.0 with the expected event count`, () => {
      const { doc, out } = record(fx.name, fx.lines, 7);
      expect(ocelProblems(doc)).toEqual([]);
      const expected = fx.records.filter((r) => !unmapped.has(r.type)).length;
      expect(doc.events.length).toBe(expected);
      expect(out.events).toBe(expected);
      expect(doc.events.length).toBeGreaterThan(0);
      expect(doc.eventTypes.map((t) => t.name)).toEqual(EVENT_TYPES);
      expect(doc.objectTypes.map((t) => t.name)).toEqual(OBJECT_TYPES);
      // the session object is present and every event is in it
      const sid = fx.records[0].sessionId as string;
      expect(doc.objects.find((o) => o.id === sid)?.type).toBe("session");
      for (const e of doc.events) expect(e.relationships.some((r) => r.objectId === sid && r.qualifier === "in_session")).toBe(true);
    });

    test(`${fx.name}: chunking does not change the log`, () => {
      const a = record(fx.name, fx.lines, 3);
      const b = record(fx.name, fx.lines, 100000);
      expect(a.out.head).toBe(b.out.head);
      expect(a.doc.events.length).toBe(b.doc.events.length);
    });

    test(`${fx.name}: chain replays and receipt agrees with the files on disk`, () => {
      const { doc, receipt, out } = record(fx.name, fx.lines, 4096);
      expect(verifyChain(doc, "sha256")).toBeNull();
      expect(doc.events.at(-1)!.attributes.find((a) => a.name === "pi_hash")!.value).toBe(out.head);
      expect(receipt.head_hash).toBe(out.head);
      expect(receipt.event_count).toBe(doc.events.length);
      expect(receipt.chain_intact).toBe(true);
      expect(verifyReceiptChain(receipt.chain)).toBe(true);
      expect(receipt.chain.map((e: any) => e.phase)).toEqual(["pending", "outcome", "outcome"]);
      expect(receipt.chain.at(-1).seal).toBe(true);
      expect(receipt.chain.at(-1).standing).toBe("alive");
      expect(new Bun.CryptoHasher("sha256").update(readFileSync(out.ocelPath, "utf8")).digest("hex")).toBe(receipt.ocel_file_sha256);
      for (const entry of receipt.chain) {
        const { seal: _seal, ...fields } = entry;
        expect(schemaProblems(schemas, "ReceiptEntry", fields)).toEqual([]);
      }
      for (const e of doc.events) expect(schemaProblems(schemas, "OcelEventRecord", { id: e.id, type: e.type, time: e.time })).toEqual([]);
    });

    test(`${fx.name}: receipt entries project onto the ex4pm receipt schema`, () => {
      const { receipt } = record(fx.name, fx.lines, 4096);
      const schema = JSON.parse(readFileSync("/Users/sac/ex4pm/priv/schema/receipt.schema.json", "utf8"));
      for (const entry of receipt.chain) {
        const r = toEx4pmReceipt(entry) as Record<string, unknown>;
        for (const k of schema.required) expect(r[k]).toBeDefined();
        expect(schema.properties.phase.enum).toContain(r.phase);
        expect(schema.properties.standing.enum).toContain(r.standing);
      }
    });
  }

  test("tool turn relates tool_call and model_request objects with qualifiers", () => {
    const fx = fixtures().find((f) => f.name === "turn-tool.ndjson")!;
    const { doc } = record(fx.name, fx.lines, 4096);
    const types = new Set(doc.objects.map((o) => o.type));
    for (const t of ["session", "turn", "tool_call", "model_request"]) expect(types.has(t)).toBe(true);
    const quals = new Set(doc.events.flatMap((e) => e.relationships.map((r) => r.qualifier)));
    for (const q of ["in_session", "in_turn", "about_tool_call", "about_model_request"]) expect(quals.has(q)).toBe(true);
    const callId = fx.records.find((r) => r.type === "tool.updated")!.payload.toolCallId as string;
    expect(doc.objects.find((o) => o.id === callId)?.type).toBe("tool_call");
  });
});

describe("seal-once refusal", () => {
  const fx = fixtures()[0];
  test("recorder finishes once", () => {
    const rec = new OcelRecorder(STREAM_SOURCE, tmp());
    rec.write(fx.lines.join("\n") + "\n");
    rec.finish();
    expect(() => rec.finish()).toThrow("already finished");
  });
  test("generated tap seals once and refuses ingest after seal", () => {
    const tap = new Tap(STREAM_SOURCE);
    tap.ingest(JSON.stringify(normalizeRecord(fx.records[1])));
    tap.seal();
    expect(() => tap.seal()).toThrow("already sealed");
    expect(() => tap.ingest(JSON.stringify(normalizeRecord(fx.records[2])))).toThrow("sealed");
  });
  test("generated receipt chain refuses a second seal and appends after seal", () => {
    const chain: Chain = [];
    appendPending(chain, "a", "s", "act");
    appendOutcome(chain, "a2", "alive", "s", "act");
    sealReceipt(chain, "b", "alive", "s");
    expect(() => sealReceipt(chain, "c", "alive", "s")).toThrow("already sealed");
    expect(() => appendPending(chain, "d", "s", "act2")).toThrow("chain sealed");
  });
  test("seal refuses while a pending is unpaired", () => {
    const chain: Chain = [];
    appendPending(chain, "a", "s", "act");
    expect(unpaired(chain)).toEqual(["a"]);
    expect(() => sealReceipt(chain, "b", "alive", "s")).toThrow("unpaired");
  });
  test("an outcome without a pending is refused", () => {
    expect(() => appendOutcome([], "a", "alive", "s", "act")).toThrow("outcome without pending");
  });
});

describe("tamper detection", () => {
  const fx = fixtures().find((f) => f.name === "turn-tool.ndjson")!;
  test("editing an event relationship breaks the OCEL chain", () => {
    const { doc } = record(fx.name, fx.lines, 4096);
    const forged = structuredClone(doc);
    forged.events[3].relationships[0].objectId = "forged";
    expect(verifyChain(forged, "sha256")).toContain("hash mismatch");
  });
  test("dropping an event breaks the parent link", () => {
    const { doc } = record(fx.name, fx.lines, 4096);
    const forged = structuredClone(doc);
    forged.events.splice(5, 1);
    expect(verifyChain(forged, "sha256")).toContain("parent mismatch");
  });
  test("reordering events breaks the chain", () => {
    const { doc } = record(fx.name, fx.lines, 4096);
    const forged = structuredClone(doc);
    [forged.events[2], forged.events[3]] = [forged.events[3], forged.events[2]];
    expect(verifyChain(forged, "sha256")).not.toBeNull();
  });
  test("editing the receipt breaks its chain, editing the log breaks its file digest", () => {
    const { receipt, out } = record(fx.name, fx.lines, 4096);
    const forged = structuredClone(receipt.chain);
    forged[1].standing = "blocked";
    expect(verifyReceiptChain(forged)).toBe(false);
    const dropped = structuredClone(receipt.chain).slice(0, 2);
    dropped.push({ ...receipt.chain[2], parent_hash: "0".repeat(64) });
    expect(verifyReceiptChain(dropped)).toBe(false);
    writeFileSync(out.ocelPath, readFileSync(out.ocelPath, "utf8").replace("session", "sessioN"));
    expect(new Bun.CryptoHasher("sha256").update(readFileSync(out.ocelPath, "utf8")).digest("hex")).not.toBe(receipt.ocel_file_sha256);
  });
});

describe("event-shape contract (fails when the runtime stream shape changes)", () => {
  test("every fixture line carries the envelope keys the mapping paths read", () => {
    for (const fx of fixtures()) {
      for (const r of fx.records) {
        if (r.type === "result") { for (const k of ["sessionId", "turnId", "traceId", "response", "usage"]) expect(k in r).toBe(true); continue; }
        for (const k of ["eventId", "payload", "seq", "sessionId", "timestamp", "traceId", "turnId", "type"]) expect(k in r).toBe(true);
        expect(typeof r.timestamp).toBe("number");
      }
    }
  });
  test("every stream mapping rule path resolves on the fixture events of that wire type", () => {
    let checked = 0;
    for (const fx of fixtures()) {
      for (const r of fx.records) {
        for (const rule of RULES.filter((x) => x.source === STREAM_SOURCE && x.name === r.type && (x.object === "session" || x.object === "turn"))) {
          expect(String(getPath(r, rule.path) ?? "")).not.toBe("");
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
  test("payload ids used for tool_call and model_request relations are present where the fixture exercises them", () => {
    const fx = fixtures().find((f) => f.name === "turn-tool.ndjson")!;
    const tool = fx.records.filter((r) => r.type === "tool.updated" && r.payload.kind !== "batch");
    expect(tool.length).toBeGreaterThan(0);
    for (const r of tool) expect(typeof r.payload.toolCallId).toBe("string");
    expect(fx.records.some((r) => r.type === "session.updated" && typeof r.payload.requestId === "string")).toBe(true);
  });
  test("every fixture wire type is declared by the ontology", () => {
    const declared = new Set(declaredRuntimeEvents().filter((e) => e.source === STREAM_SOURCE).map((e) => e.name));
    for (const fx of fixtures()) for (const r of fx.records) expect(declared.has(r.type)).toBe(true);
  });
});

// Shared golden chain vectors: test/py/test_golden_chain.py reads the same file and asserts the same literals.
describe("golden chain vectors (shared with python)", () => {
  const golden = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "ocel-golden-chain.json"), "utf8"));
  for (const v of golden.vectors) {
    test(`${v.id}: ts digests and outcome equal the literal vector`, async () => {
      const r = await import("../src/generated/receipt.ts");
      const chain: any[] = [];
      const digests: string[] = [];
      let error: string | null = null;
      try {
        for (const o of v.ops) {
          const e = o[0] === "pending" ? r.appendPending(chain, o[1], o[2], o[3]) : o[0] === "outcome" ? r.appendOutcome(chain, o[1], o[2], o[3], o[4]) : r.seal(chain, o[1], o[2], o[3]);
          digests.push(e.hash);
        }
      } catch (x: any) { error = x.message; }
      expect({ digests, verify: r.verify(chain), unpaired: r.unpaired(chain), error }).toEqual(v.expected);
    });
  }
});
