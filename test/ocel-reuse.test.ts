// Reuse proof: the same consumer graph regenerated for the py target agrees with the ts target
// byte-for-byte on the recorded turns (same head hash, same event count, receipts verify cross-language),
// src/generated is what a fresh `ggen sync run` produces, and wasm4pm loads the emitted OCEL.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendOutcome, appendPending, seal, verify as tsVerify, type Chain } from "../src/generated/receipt.ts";
import { OcelRecorder, STREAM_SOURCE, normalizeRecord, APP_SERVER_SOURCE } from "../src/ocel-tap.ts";
import { fixtures, repoRoot, toolchain } from "./support/ocel.ts";

const have = (bin: string) => toolchain(bin, spawnSync("which", [bin]).status === 0);
const py = join(repoRoot, "src", "generated", "py");

function tsRun(lines: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "zcode-reuse-"));
  const rec = new OcelRecorder(STREAM_SOURCE, dir);
  rec.write(lines.join("\n") + "\n");
  const out = rec.finish();
  const result = { out, doc: JSON.parse(readFileSync(out.ocelPath, "utf8")), receipt: JSON.parse(readFileSync(out.receiptPath, "utf8")), dir };
  return result;
}

describe.skipIf(!have("python3"))("py target from the same graph", () => {
  for (const fx of fixtures()) {
    test(`${fx.name}: py tap head hash and event count equal the ts tap`, () => {
      const ts = tsRun(fx.lines);
      try {
        const normalized = fx.records.map((r) => JSON.stringify(normalizeRecord(r))).join("\n") + "\n";
        const run = spawnSync("python3", ["-c", [
          "import sys, json",
          `sys.path.insert(0, ${JSON.stringify(py)})`,
          "import ocel",
          `t = ocel.Tap(${JSON.stringify(STREAM_SOURCE)})`,
          "t.ingest(sys.stdin.read())",
          "doc = t.to_ocel()",
          "print(json.dumps({'n': len(doc['events']), 'head': t.seal(), 'intact': ocel.verify_chain(doc, 'sha256')}))"
        ].join("\n")], { input: normalized, encoding: "utf8" });
        expect(run.status).toBe(0);
        const got = JSON.parse(run.stdout);
        expect(got.n).toBe(ts.out.events);
        expect(got.head).toBe(ts.out.head);
        expect(got.intact).toBeNull();
      } finally {
        rmSync(ts.dir, { recursive: true, force: true });
      }
    });

    test(`${fx.name}: py receipt module verifies the ts-written receipt chain`, () => {
      const ts = tsRun(fx.lines);
      try {
        const run = spawnSync("python3", ["-c", [
          "import sys, json",
          `sys.path.insert(0, ${JSON.stringify(py)})`,
          "import receipt",
          "chain = json.load(sys.stdin)",
          "print(json.dumps(receipt.verify(chain)))"
        ].join("\n")], { input: JSON.stringify(ts.receipt.chain), encoding: "utf8" });
        expect(run.status).toBe(0);
        expect(JSON.parse(run.stdout)).toBe(true);
      } finally {
        rmSync(ts.dir, { recursive: true, force: true });
      }
    });
  }

  test("py generated turn machine agrees with the ts one", () => {
    const run = spawnSync("python3", ["-c", [
      "import sys, json",
      `sys.path.insert(0, ${JSON.stringify(py)})`,
      "import loop",
      "s = loop.ZcodeTurnState.Idle if hasattr(loop.ZcodeTurnState, 'Idle') else None",
      "s = loop.step_zcodeturn(s, 'turn_started', {})",
      "s = loop.step_zcodeturn(s, 'turn_completed', {})",
      "print(s.value)"
    ].join("\n")], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout.trim()).toBe("Completed");
  });
});

describe.skipIf(!have("ggen"))("src/generated is a fixed point of ggen sync run", () => {
  test("bun scripts/gen-ocel.ts --check", () => {
    const run = spawnSync("bun", ["scripts/gen-ocel.ts", "--check"], { cwd: repoRoot, encoding: "utf8", timeout: 120000, env: process.env });
    expect(run.stderr).toBe("");
    expect(run.status).toBe(0);
  });
});

describe("app-server subscription source (UNVERIFIED shape: synthetic envelope around real wire events)", () => {
  test("wrapping the recorded events as notifications yields the same log", () => {
    const fx = fixtures().find((f) => f.name === "turn-tool.ndjson")!;
    const dir = mkdtempSync(join(tmpdir(), "zcode-app-"));
    try {
      const rec = new OcelRecorder(APP_SERVER_SOURCE, dir);
      for (const r of fx.records) rec.feedLine(JSON.stringify({ jsonrpc: "2.0", method: "session/event", params: r }));
      rec.feedLine(JSON.stringify({ id: 1, result: {} })); // a response envelope is not an event
      const app = rec.finish();
      const ts = tsRun(fx.lines);
      try {
        expect(app.events).toBe(ts.out.events);
        const appDoc = JSON.parse(readFileSync(app.ocelPath, "utf8"));
        expect(appDoc.events.map((e: any) => e.type)).toEqual(ts.doc.events.map((e: any) => e.type));
      } finally {
        rmSync(ts.dir, { recursive: true, force: true });
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const w4 = "/Users/sac/wasm4pm/wasm4pm/pkg/wasm4pm.js";
describe.skipIf(!existsSync(w4) || !have("node"))("wasm4pm imports the emitted OCEL", () => {
  test("load_ocel2_from_json accepts the log and lists the object types", () => {
    const fx = fixtures().find((f) => f.name === "turn-tool.ndjson")!;
    const ts = tsRun(fx.lines);
    try {
      const run = spawnSync("node", ["-e", [
        `const w = require(${JSON.stringify(w4)});`,
        "const h = w.load_ocel2_from_json(require('node:fs').readFileSync(process.argv[1], 'utf8'));",
        "console.log(JSON.stringify(w.list_ocel_object_types(h)));"
      ].join("\n"), ts.out.ocelPath], { encoding: "utf8" });
      expect(run.status).toBe(0);
      expect(JSON.parse(run.stdout).sort()).toEqual(["model_request", "session", "tool_call", "turn"]);
    } finally {
      rmSync(ts.dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!have("ggen"))("mutation check: renaming one individual changes exactly its output", () => {
  test("renaming an event type id rewrites only that id in the generated tap", async () => {
    const { generateInto, relocate } = await import("../scripts/gen-ocel.ts");
    const dir = mkdtempSync(join(tmpdir(), "zcode-mut-"));
    try {
      const base = readFileSync(join(repoRoot, "ontology", "zcode-loop.ttl"), "utf8");
      const mutated = join(dir, "mutated.ttl");
      const { writeFileSync } = await import("node:fs");
      expect(base.split('pi:typeId "part_started"').length).toBe(2);
      writeFileSync(mutated, base.replace('pi:typeId "part_started"', 'pi:typeId "part_begun"'));
      const work = join(dir, "work");
      generateInto(work, mutated);
      const out = join(dir, "out");
      relocate(work, out);
      const before = readFileSync(join(repoRoot, "src", "generated", "ocel.ts"), "utf8").split("\n");
      const after = readFileSync(join(out, "ocel.ts"), "utf8").split("\n");
      // ids are emitted sorted, so a rename may move one token inside its line: compare the file skeleton
      // (everything but quoted tokens) exactly, and the quoted tokens as a multiset with the rename undone.
      const skeleton = (ls: string[]) => ls.map((l) => l.replace(/"[^"]*"/g, '""'));
      const tokens = (ls: string[]) => ls.join("\n").match(/"[^"]*"/g)!.map((t) => t.replace("part_begun", "part_started")).sort();
      expect(skeleton(after)).toEqual(skeleton(before));
      expect(tokens(after)).toEqual(tokens(before));
      expect(after.join("\n")).toContain("part_begun");
      // the rule ids are separate individuals and keep their names; the event type reference follows the rename
      expect(after.join("\n")).not.toContain('event: "part_started"');
      expect(after.join("\n")).toContain('event: "part_begun"');
      for (const f of ["loop.ts", "receipt.ts", "schemas.json"]) {
        expect(readFileSync(join(out, f), "utf8")).toBe(readFileSync(join(repoRoot, "src", "generated", f), "utf8"));
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ggen.toml pack paths are configurable", () => {
  test("default is the main checkout packs dir; ZCODE_PACK_ROOT and per-pack overrides apply", async () => {
    const { ggenToml, DEFAULT_PACK_ROOT } = await import("../scripts/gen-ocel.ts");
    expect(DEFAULT_PACK_ROOT).toBe("/Users/sac/ggen-marketplace/packs");
    expect(ggenToml("x.ttl", {})).toContain(`path = "${DEFAULT_PACK_ROOT}/process-intelligence-pack"`);
    const t = ggenToml("x.ttl", { ZCODE_PACK_ROOT: "/r", ZCODE_PACK_ROOT_ST: "/Users/sac/wt/st-fsm-codegen/packs" });
    expect(t).toContain('path = "/r/process-intelligence-pack"');
    expect(t).toContain('path = "/Users/sac/wt/st-fsm-codegen/packs/state-transition-pack"');
  });
});

// py-target pending/outcome + shared golden vector: the same entries through the ts and py receipt modules
// must yield identical hashes, and both must reject the same misuse.
const ENTRIES: [string, string, string, string][] = [
  ["s1-e1", "pending", "s1", "record-ocel"],
  ["s1-e2", "alive", "s1", "record-ocel"]
];
function pyChain(script: string): any {
  const run = spawnSync("python3", ["-c", [
    "import sys, json",
    `sys.path.insert(0, ${JSON.stringify(py)})`,
    "import receipt",
    script
  ].join("\n")], { encoding: "utf8" });
  expect(run.stderr).toBe("");
  expect(run.status).toBe(0);
  return JSON.parse(run.stdout);
}

describe.skipIf(!have("python3"))("py receipt pending/outcome", () => {
  test("py pairs outcome to pending, seals, verifies; unpaired and orphan outcome are refused", () => {
    const got = pyChain([
      "c = []",
      "receipt.append_pending(c, 's1-e1', 's1', 'record-ocel')",
      "u1 = receipt.unpaired(c)",
      "try:",
      "    receipt.seal(c, 'x', 'alive', 's1'); sealed_early = True",
      "except Exception: sealed_early = False",
      "receipt.append_outcome(c, 's1-e2', 'alive', 's1', 'record-ocel')",
      "u2 = receipt.unpaired(c)",
      "receipt.seal(c, 's1-e3', 'alive', 's1')",
      "try:",
      "    receipt.append_outcome(receipt.__dict__['_x'] if False else [], 'o', 'alive', 's', 'nothing'); orphan = True",
      "except Exception: orphan = False",
      "print(json.dumps({'u1': u1, 'u2': u2, 'sealed_early': sealed_early, 'orphan': orphan, 'ok': receipt.verify(c), 'chain': c}))"
    ].join("\n"));
    expect(got.u1).toEqual(["s1-e1"]);
    expect(got.sealed_early).toBe(false);
    expect(got.u2).toEqual([]);
    expect(got.orphan).toBe(false);
    expect(got.ok).toBe(true);
    expect(got.chain[1].pending_ref).toBe(got.chain[0].hash);
    expect(got.chain[0].standing).toBe("unknown");
  });

  test("golden vector: ts and py chain digests are identical on the same events", () => {
    const tsChain: Chain = [];
    appendPending(tsChain, ENTRIES[0][0], ENTRIES[0][2], ENTRIES[0][3]);
    appendOutcome(tsChain, ENTRIES[1][0], ENTRIES[1][1], ENTRIES[1][2], ENTRIES[1][3]);
    seal(tsChain, "s1-e3", "alive", "s1");
    const pyC = pyChain([
      "c = []",
      "receipt.append_pending(c, 's1-e1', 's1', 'record-ocel')",
      "receipt.append_outcome(c, 's1-e2', 'alive', 's1', 'record-ocel')",
      "receipt.seal(c, 's1-e3', 'alive', 's1')",
      "print(json.dumps(c))"
    ].join("\n"));
    expect(pyC.map((e: any) => e.hash)).toEqual(tsChain.map((e) => e.hash));
    expect(pyC).toEqual(JSON.parse(JSON.stringify(tsChain)));
    expect(tsVerify(tsChain)).toBe(true);
  });

  test("golden vector: ts and py OCEL tap chain digests agree on fixture events", () => {
    for (const fx of fixtures()) {
      const ts = tsRun(fx.lines);
      try {
        const normalized = fx.records.map((r) => JSON.stringify(normalizeRecord(r))).join("\n") + "\n";
        const run = spawnSync("python3", ["-c", [
          "import sys, json",
          `sys.path.insert(0, ${JSON.stringify(py)})`,
          "import ocel",
          `t = ocel.Tap(${JSON.stringify(STREAM_SOURCE)})`,
          "t.ingest(sys.stdin.read())",
          "doc = t.to_ocel()",
          "print(json.dumps(doc['events']))"
        ].join("\n")], { input: normalized, encoding: "utf8" });
        expect(run.status).toBe(0);
        const digests = (evs: any[]) => evs.map((e) => e.attributes.filter((a: any) => /hash|digest|pending_ref/.test(a.name)).map((a: any) => a.value));
        expect(digests(JSON.parse(run.stdout))).toEqual(digests(ts.doc.events));
      } finally {
        rmSync(ts.dir, { recursive: true, force: true });
      }
    }
  });
});
