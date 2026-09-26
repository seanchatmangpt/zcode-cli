import { describe, expect, test } from "bun:test";

import { findPartAlternatives } from "../src/parts-cli.ts";

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

  test("supports a required semantic cross-product", () => {
    const alternatives = findPartAlternatives(graph, "codegraph:file:1", ["algorithm", "domain"]);
    expect(alternatives).toHaveLength(1);
    expect(alternatives[0]!.coverage).toBe(1);
  });

  test("refuses ambient authority", () => {
    expect(() => findPartAlternatives({ ...graph, authority: "DO" }, "1"))
      .toThrow("authority=NONE");
  });

  test("does not confuse domain adjacency with algorithm equivalence", () => {
    expect(findPartAlternatives(graph, "1", ["algorithm"]).some(
      (candidate) => candidate.part_id === "codegraph:file:3"
    )).toBe(false);
  });
});
