import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  findPartAlternatives,
  inspectSemanticPart,
  runPartsCommand,
  semanticCandidateFalsifier
} from "../src/parts-cli.ts";

const graph = {
  schema: "unrdf.semantic-parts.v1",
  authority: "NONE",
  parts: [
    {
      part_id: "codegraph:file:1",
      authority: "NONE",
      source: { file_id: "1", language: "Python" },
      semantics: {
        algorithm: [{ semantic_id: "wikidata:Q12105" }],
        domain: [{ semantic_id: "wikidata:Q131476" }]
      }
    },
    {
      part_id: "codegraph:file:2",
      authority: "NONE",
      source: { file_id: "2", language: "Rust" },
      semantics: {
        algorithm: [{ semantic_id: "wikidata:Q12105" }],
        domain: [{ semantic_id: "wikidata:Q131476" }]
      }
    },
    {
      part_id: "codegraph:file:3",
      authority: "NONE",
      source: { file_id: "3", language: "JavaScript" },
      semantics: {
        algorithm: [{ semantic_id: "wikidata:Q294195" }],
        domain: [{ semantic_id: "wikidata:Q131476" }]
      }
    }
  ]
};

describe("zcode parts", () => {
  test("discovers cross-language alternatives from an admitted UNRDF graph", () => {
    expect(findPartAlternatives(graph, "1", ["algorithm"])).toEqual([
      {
        part_id: "codegraph:file:2",
        language: "Rust",
        shared: { algorithm: ["wikidata:Q12105"] },
        shared_count: 1,
        coverage: 1,
        authority: "NONE",
        standing: "CANDIDATE"
      }
    ]);
  });

  test("supports a required semantic cross-product and minimum overlap", () => {
    const alternatives = findPartAlternatives(
      graph,
      "codegraph:file:1",
      ["algorithm", "domain"],
      2
    );
    expect(alternatives).toHaveLength(1);
    expect(alternatives[0]!.coverage).toBe(1);
    expect(findPartAlternatives(graph, "1", ["algorithm", "domain"], 3)).toEqual([]);
  });

  test("inspect resolves both canonical part id and source file id", () => {
    expect(inspectSemanticPart(graph, "1")).toBe(graph.parts[0]);
    expect(inspectSemanticPart(graph, "codegraph:file:1")).toBe(graph.parts[0]);
  });

  test("semantic falsifier distinguishes a real overlap from domain adjacency", () => {
    expect(semanticCandidateFalsifier(graph, "1", "2", ["algorithm"])).toMatchObject({
      subject: "codegraph:file:1",
      candidate: "codegraph:file:2",
      survives: true,
      authority: "NONE",
      standing: "OBSERVED"
    });

    expect(semanticCandidateFalsifier(graph, "1", "3", ["algorithm"])).toEqual({
      subject: "codegraph:file:1",
      candidate: "codegraph:file:3",
      required_axes: ["algorithm"],
      survives: false,
      authority: "NONE",
      standing: "OBSERVED"
    });
  });

  test("refuses ambient authority and malformed query parameters", () => {
    expect(() => findPartAlternatives({ ...graph, authority: "DO" }, "1"))
      .toThrow("authority=NONE");
    expect(() => findPartAlternatives(graph, "1", [])).toThrow("at least one required");
    expect(() => findPartAlternatives(graph, "1", ["algorithm", "algorithm"]))
      .toThrow("must be unique");
    expect(() => findPartAlternatives(graph, "1", ["language"]))
      .toThrow("unsupported semantic axis");
    expect(() => findPartAlternatives(graph, "1", ["algorithm"], 0))
      .toThrow("minimumShared");
  });

  test("refuses ambiguous file references instead of choosing first", () => {
    const forged = structuredClone(graph);
    forged.parts[2]!.source.file_id = "2";
    expect(() => inspectSemanticPart(forged, "2")).toThrow("ambiguous");
  });

  test("CLI alternatives emits a receipt and respects limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "zcode-parts-"));
    const path = join(dir, "graph.json");
    writeFileSync(path, JSON.stringify(graph));

    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      expect(await runPartsCommand([
        "parts",
        "alternatives",
        "--graph",
        path,
        "--subject",
        "1",
        "--axis",
        "algorithm,domain",
        "--limit",
        "1",
        "--json"
      ])).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
      rmSync(dir, { recursive: true, force: true });
    }

    const payload = JSON.parse(writes.join(""));
    expect(payload.operation).toBe("alternatives");
    expect(payload.returned_count).toBe(1);
    expect(payload.candidate_count).toBe(1);
    expect(payload.authority).toBe("NONE");
    expect(payload.receipt_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
