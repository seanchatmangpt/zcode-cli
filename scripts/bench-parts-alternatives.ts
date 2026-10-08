// Deterministic benchmark for `zcode parts alternatives` discovery.
// Builds seeded synthetic unrdf.semantic-parts.v1 graphs (no randomness beyond a
// fixed LCG), times admission + SELECT over the real findPartAlternatives, and
// prints a machine-readable receipt. Usage:
//   bun scripts/bench-parts-alternatives.ts [--sizes 1000,10000,50000] [--runs 7] [--out FILE]
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { loadavg } from "node:os";

import { findPartAlternatives } from "../src/parts-cli.ts";

export function syntheticGraph(parts: number, seed = 26_926) {
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const languages = ["Python", "Rust", "JavaScript", "Elixir", "Go", "Java"];
  return {
    schema: "unrdf.semantic-parts.v1",
    authority: "NONE",
    parts: Array.from({ length: parts }, (_, index) => ({
      part_id: `codegraph:file:${index}`,
      authority: "NONE",
      source: { file_id: String(index), language: languages[next() % languages.length] },
      semantics: {
        algorithm: Array.from({ length: 1 + (next() % 3) }, () => ({ semantic_id: `wikidata:QA${next() % 64}` })),
        domain: Array.from({ length: 1 + (next() % 2) }, () => ({ semantic_id: `wikidata:QD${next() % 16}` }))
      }
    }))
  };
}

export interface BenchRow {
  parts: number;
  runs: number;
  median_ms: number;
  min_ms: number;
  max_ms: number;
  alternatives: number;
  result_sha256: string;
}

export function benchSize(parts: number, runs: number): BenchRow {
  const graph = syntheticGraph(parts);
  const samples: number[] = [];
  let result = findPartAlternatives(graph, "0", ["algorithm", "domain"]);
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    result = findPartAlternatives(graph, "0", ["algorithm", "domain"]);
    samples.push(performance.now() - started);
  }
  samples.sort((left, right) => left - right);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    parts,
    runs,
    median_ms: round(samples[Math.floor(samples.length / 2)]!),
    min_ms: round(samples[0]!),
    max_ms: round(samples[samples.length - 1]!),
    alternatives: result.length,
    result_sha256: createHash("sha256").update(JSON.stringify(result)).digest("hex")
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const value = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const sizes = (value("--sizes") ?? "1000,10000,50000").split(",").map(Number);
  const runs = Number(value("--runs") ?? "7");
  const rows = sizes.map((size) => benchSize(size, runs));
  const receipt = {
    schema: "zcode.bench.parts-alternatives.v1",
    authority: "NONE",
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    // Host load at measurement time: numbers taken on a saturated host are
    // upper bounds, not the uncontended cost.
    host_load_1m: Math.round(loadavg()[0]! * 100) / 100,
    query: { subject: "0", axes: ["algorithm", "domain"] },
    rows
  };
  const text = JSON.stringify(receipt, null, 2) + "\n";
  const out = value("--out");
  if (out) writeFileSync(out, text);
  process.stdout.write(text);
}
