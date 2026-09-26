// Adversarial courts for `zcode parts alternatives` (PR #8 hardening).
// Chicago style: real graphs, real files on disk, and the real launcher run as
// a subprocess; assertions are on returned values, stdout bytes, and exit codes.
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { findPartAlternatives } from "../src/parts-cli.ts";

const REPO = join(import.meta.dir, "..");

type Part = {
  part_id: string;
  authority: string;
  source?: { file_id: string; language: string };
  semantics: Record<string, Array<{ semantic_id: string }>>;
};

function part(id: string, fileId: string, algorithm: string[], domain: string[] = []): Part {
  return {
    part_id: id,
    authority: "NONE",
    source: { file_id: fileId, language: "Lang" + fileId },
    semantics: {
      algorithm: algorithm.map((semantic_id) => ({ semantic_id })),
      domain: domain.map((semantic_id) => ({ semantic_id }))
    }
  };
}

function graphOf(parts: unknown[]) {
  return { schema: "unrdf.semantic-parts.v1", authority: "NONE", parts };
}

const scratch = mkdtempSync(join(tmpdir(), "zcode-parts-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function writeGraph(name: string, value: unknown): { path: string; sha256: string } {
  const path = join(scratch, name);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  writeFileSync(path, text);
  return { path, sha256: createHash("sha256").update(text).digest("hex") };
}

function cli(args: string[]) {
  const proc = Bun.spawnSync([process.execPath, join(REPO, "bin/zcode.ts"), ...args], {
    cwd: REPO,
    env: { ...process.env, NO_COLOR: "1" }
  });
  return { code: proc.exitCode, stdout: proc.stdout.toString(), stderr: proc.stderr.toString() };
}

const good = graphOf([
  part("codegraph:file:1", "1", ["wikidata:Q12105"], ["wikidata:Q131476"]),
  part("codegraph:file:2", "2", ["wikidata:Q12105"], ["wikidata:Q131476"]),
  part("codegraph:file:3", "3", ["wikidata:Q294195"], ["wikidata:Q131476"]),
  part("codegraph:file:4", "4", ["wikidata:Q12105", "wikidata:Q8366"], [])
]);

describe("admission refuses malformed graphs with typed errors (not TypeError)", () => {
  const cases: Array<[string, unknown, string]> = [
    ["null part", graphOf([null]), "index 0 must be an object"],
    ["array part", graphOf([[]]), "index 0 must be an object"],
    ["semantics as array", graphOf([{ part_id: "a", authority: "NONE", semantics: [] }]), "missing semantics"],
    ["null semantic entry", graphOf([part("a", "1", ["q"]), { ...part("b", "2", []), semantics: { algorithm: [null] } }]),
      "entries must be objects"],
    ["axis not array", graphOf([{ ...part("a", "1", ["q"]), semantics: { algorithm: [{ semantic_id: "q" }], domain: "junk" } }]),
      "axis domain must be an array"],
    ["numeric semantic_id", graphOf([part("a", "1", ["q"]), { ...part("c", "3", []), semantics: { algorithm: [{ semantic_id: 7 }] } }]),
      "semantic_id must be a non-empty string"],
    ["empty part_id", graphOf([{ ...part("x", "1", ["q"]), part_id: "" }]), "part_id must be a non-empty string"],
    ["duplicate part", graphOf([part("a", "1", ["q"]), part("a", "2", ["q"])]), "duplicate semantic part a"],
    ["part-level authority DO", graphOf([{ ...part("a", "1", ["q"]), authority: "DO" }]), "must carry authority=NONE"],
    ["wrong schema", { ...good, schema: "unrdf.semantic-parts.v2" }, "unsupported semantic-parts schema"],
    ["graph authority missing", { schema: good.schema, parts: good.parts }, "authority=NONE"],
    ["parts not array", { ...good, parts: {} }, "parts must be an array"],
    ["graph is array", [], "must be an object"],
    ["graph is null", null, "must be an object"]
  ];
  for (const [label, graph, message] of cases) {
    test(label, () => {
      let thrown: unknown;
      try {
        findPartAlternatives(graph, "a");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).constructor).toBe(Error);
      expect((thrown as Error).message).toContain(message);
    });
  }

  test("admission is total: malformed data on an unqueried axis is still refused", () => {
    const graph = graphOf([
      { ...part("a", "1", ["q"]), semantics: { algorithm: [{ semantic_id: "q" }], domain: [{ semantic_id: "" }] } },
      part("b", "2", ["q"])
    ]);
    expect(() => findPartAlternatives(graph, "a", ["algorithm"])).toThrow("semantic_id must be a non-empty string");
  });
});

describe("subject resolution", () => {
  test("refuses a selector that names one part by part_id and another by file_id", () => {
    const graph = graphOf([part("a", "b", ["q"]), part("b", "9", ["q"]), part("c", "3", ["q"])]);
    expect(() => findPartAlternatives(graph, "b")).toThrow("ambiguous semantic-parts subject b matches a, b");
  });

  test("refuses a file_id shared by two parts", () => {
    const graph = graphOf([part("a", "1", ["q"]), part("b", "1", ["q"])]);
    expect(() => findPartAlternatives(graph, "1")).toThrow("ambiguous semantic-parts subject 1");
  });

  test("unknown subject is refused", () => {
    expect(() => findPartAlternatives(good, "codegraph:file:404")).toThrow("unknown semantic-parts subject");
  });

  test("subject is never its own alternative", () => {
    const ids = findPartAlternatives(good, "codegraph:file:1").map((candidate) => candidate.part_id);
    expect(ids).not.toContain("codegraph:file:1");
  });
});

describe("axis handling", () => {
  test("duplicate axes are refused instead of inflating coverage above 1", () => {
    expect(() => findPartAlternatives(good, "1", ["algorithm", "algorithm"])).toThrow("must be distinct");
  });

  test("inherited Object.prototype names are not axes", () => {
    for (const axis of ["toString", "constructor", "hasOwnProperty"]) {
      expect(() => findPartAlternatives(good, "1", [axis])).toThrow(`required axis ${axis}`);
    }
  });

  test("an own __proto__ axis is reported as data, not as a prototype rewrite", () => {
    const graph = JSON.parse(
      '{"schema":"unrdf.semantic-parts.v1","authority":"NONE","parts":['
      + '{"part_id":"a","authority":"NONE","semantics":{"__proto__":[{"semantic_id":"q"}]}},'
      + '{"part_id":"b","authority":"NONE","semantics":{"__proto__":[{"semantic_id":"q"}]}}]}'
    );
    const [alternative] = findPartAlternatives(graph, "a", ["__proto__"]);
    expect(alternative!.shared_count).toBe(1);
    expect(Object.hasOwn(alternative!.shared, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(alternative!.shared)).toBe(Object.prototype);
    expect(Object.keys(alternative!.shared)).toEqual(["__proto__"]);
  });

  test("coverage is bounded in [0, 1] and equals shared/subject identity count", () => {
    const [top] = findPartAlternatives(good, "codegraph:file:4", ["algorithm"]);
    expect(top!.coverage).toBe(0.5);
    for (const candidate of findPartAlternatives(good, "1", ["algorithm", "domain"])) {
      expect(candidate.coverage).toBeGreaterThan(0);
      expect(candidate.coverage).toBeLessThanOrEqual(1);
    }
  });
});

describe("determinism: replay and reordering", () => {
  test("permuting part order yields byte-identical results", () => {
    const reference = JSON.stringify(findPartAlternatives(good, "1", ["algorithm"]));
    const parts = [...good.parts];
    for (let rotation = 0; rotation < parts.length; rotation += 1) {
      parts.push(parts.shift()!);
      expect(JSON.stringify(findPartAlternatives(graphOf(parts), "1", ["algorithm"]))).toBe(reference);
      expect(JSON.stringify(findPartAlternatives(graphOf([...parts].reverse()), "1", ["algorithm"]))).toBe(reference);
    }
  });

  test("tie-break is code-point order, independent of locale collation", () => {
    const graph = graphOf([part("s", "0", ["q"]), part("b", "1", ["q"]), part("B", "2", ["q"]), part("a", "3", ["q"])]);
    expect(findPartAlternatives(graph, "s").map((candidate) => candidate.part_id)).toEqual(["B", "a", "b"]);
  });

  test("input graph is not mutated by discovery", () => {
    const before = JSON.stringify(good);
    findPartAlternatives(good, "1", ["algorithm", "domain"]);
    expect(JSON.stringify(good)).toBe(before);
  });
});

describe("real CLI through the launcher (subprocess)", () => {
  test("replay: two runs over the same bytes are byte-identical and carry the graph digest", () => {
    const { path, sha256 } = writeGraph("good.json", good);
    const first = cli(["parts", "alternatives", "--graph", path, "--subject", "1", "--json"]);
    const second = cli(["parts", "alternatives", "--graph", path, "--subject", "1", "--json"]);
    expect(first.code).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    const payload = JSON.parse(first.stdout);
    expect(payload.graph_sha256).toBe(sha256);
    expect(payload.authority).toBe("NONE");
    expect(payload.standing).toBe("CANDIDATE");
    expect(payload.alternatives.map((candidate: { part_id: string }) => candidate.part_id))
      .toEqual(["codegraph:file:2", "codegraph:file:4"]);
  });

  test("pinned digest matches: admitted", () => {
    const { path, sha256 } = writeGraph("pinned.json", good);
    const run = cli(["parts", "alternatives", "--graph", path, "--subject", "1", "--graph-sha256", sha256.toUpperCase(), "--json"]);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout).graph_sha256).toBe(sha256);
  });

  test("stale graph: bytes changed after the digest was pinned are refused", () => {
    const { path, sha256 } = writeGraph("stale.json", good);
    writeGraph("stale.json", graphOf([...good.parts, part("codegraph:file:5", "5", ["wikidata:Q12105"])]));
    const run = cli(["parts", "alternatives", "--graph", path, "--subject", "1", "--graph-sha256", sha256, "--json"]);
    expect(run.code).toBe(1);
    const refusal = JSON.parse(run.stdout);
    expect(refusal.standing).toBe("REFUSED");
    expect(refusal.code).toBe("REFUSED_SEMANTIC_PARTS");
    expect(refusal.authority).toBe("NONE");
    expect(refusal.detail).toContain("graph digest mismatch");
  });

  test("ambient authority in the graph file is refused with a typed JSON refusal", () => {
    const { path } = writeGraph("do.json", { ...good, authority: "DO" });
    const run = cli(["parts", "alternatives", "--graph", path, "--subject", "1", "--json"]);
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ standing: "REFUSED", code: "REFUSED_SEMANTIC_PARTS" });
  });

  test("malformed JSON bytes are refused, not crashed", () => {
    const { path } = writeGraph("broken.json", '{"schema":"unrdf.semantic-parts.v1",');
    const run = cli(["parts", "alternatives", "--graph", path, "--subject", "1", "--json"]);
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout).standing).toBe("REFUSED");
  });

  test("missing graph file is refused", () => {
    const run = cli(["parts", "alternatives", "--graph", join(scratch, "absent.json"), "--subject", "1"]);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain("Error:");
    expect(run.stdout).toBe("");
  });

  test("a flag is never consumed as another flag's value", () => {
    const { path } = writeGraph("flags.json", good);
    const run = cli(["parts", "alternatives", "--graph", "--subject", "1"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("--graph requires a value");
    const dangling = cli(["parts", "alternatives", "--graph", path, "--subject"]);
    expect(dangling.code).toBe(2);
    expect(dangling.stderr).toContain("--subject requires a value");
  });

  test("unknown verb exits 2 with usage and no stdout", () => {
    const run = cli(["parts", "replace", "--graph", "x", "--subject", "1"]);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("Usage: zcode parts alternatives");
    expect(run.stdout).toBe("");
  });

  test("the CLI never writes the graph file (SELECT only)", () => {
    const { path, sha256 } = writeGraph("readonly.json", good);
    cli(["parts", "alternatives", "--graph", path, "--subject", "1", "--axis", "algorithm,domain"]);
    const after = createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(after).toBe(sha256);
  });
});
