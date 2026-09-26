import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type SemanticValue = {
  semantic_id?: unknown;
};

type SemanticPart = {
  part_id?: unknown;
  authority?: unknown;
  source?: { file_id?: unknown; language?: unknown };
  semantics?: Record<string, SemanticValue[]>;
};

type SemanticPartsGraph = {
  schema?: unknown;
  authority?: unknown;
  parts?: SemanticPart[];
};

export interface PartAlternative {
  part_id: string;
  language: string | null;
  shared: Record<string, string[]>;
  shared_count: number;
  coverage: number;
  authority: "NONE";
  standing: "CANDIDATE";
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function admitGraph(value: unknown): asserts value is SemanticPartsGraph {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("semantic-parts graph must be an object");
  }
  const graph = value as SemanticPartsGraph;
  if (graph.schema !== "unrdf.semantic-parts.v1") {
    throw new Error(`unsupported semantic-parts schema ${String(graph.schema)}`);
  }
  if (graph.authority !== "NONE") throw new Error("semantic-parts graph must carry authority=NONE");
  if (!Array.isArray(graph.parts)) throw new Error("semantic-parts graph parts must be an array");

  const seen = new Set<string>();
  for (const part of graph.parts) {
    const id = requiredString(part.part_id, "part_id");
    if (seen.has(id)) throw new Error(`duplicate semantic part ${id}`);
    seen.add(id);
    if (part.authority !== "NONE") throw new Error(`semantic part ${id} must carry authority=NONE`);
    if (!part.semantics || typeof part.semantics !== "object") {
      throw new Error(`semantic part ${id} is missing semantics`);
    }
  }
}

function identities(part: SemanticPart, axis: string): Set<string> {
  const values = part.semantics?.[axis];
  if (!Array.isArray(values)) return new Set();
  return new Set(values.map((value) => requiredString(value.semantic_id, "semantic_id")));
}

function subject(graph: SemanticPartsGraph, subjectId: string): SemanticPart {
  const found = graph.parts!.find((part) =>
    part.part_id === subjectId || String(part.source?.file_id ?? "") === subjectId
  );
  if (!found) throw new Error(`unknown semantic-parts subject ${subjectId}`);
  return found;
}

export function findPartAlternatives(
  graphValue: unknown,
  subjectId: string,
  axes: string[] = ["algorithm"]
): PartAlternative[] {
  admitGraph(graphValue);
  if (axes.length === 0) throw new Error("at least one required semantic axis is required");

  const graph = graphValue as SemanticPartsGraph;
  const origin = subject(graph, subjectId);
  const originSets = new Map(axes.map((axis) => [axis, identities(origin, axis)]));

  for (const [axis, values] of originSets) {
    if (values.size === 0) throw new Error(`subject has no observed semantics for required axis ${axis}`);
  }

  const subjectCount = [...originSets.values()].reduce((sum, values) => sum + values.size, 0);

  return graph.parts!
    .filter((candidate) => candidate.part_id !== origin.part_id)
    .map((candidate) => {
      const shared: Record<string, string[]> = {};
      let sharedCount = 0;
      let allAxes = true;

      for (const axis of axes) {
        const candidateIds = identities(candidate, axis);
        const overlap = [...originSets.get(axis)!].filter((id) => candidateIds.has(id)).sort();
        shared[axis] = overlap;
        sharedCount += overlap.length;
        if (overlap.length === 0) allAxes = false;
      }

      return {
        part_id: requiredString(candidate.part_id, "part_id"),
        language: typeof candidate.source?.language === "string" ? candidate.source.language : null,
        shared,
        shared_count: sharedCount,
        coverage: subjectCount === 0 ? 0 : sharedCount / subjectCount,
        authority: "NONE" as const,
        standing: "CANDIDATE" as const,
        allAxes
      };
    })
    .filter((candidate) => candidate.allAxes)
    .sort((left, right) =>
      right.coverage - left.coverage
      || right.shared_count - left.shared_count
      || left.part_id.localeCompare(right.part_id)
    )
    .map(({ allAxes: _allAxes, ...candidate }) => candidate);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runPartsCommand(args: string[]): Promise<number | undefined> {
  if (args[0] !== "parts") return undefined;

  if (args[1] !== "alternatives") {
    console.error("Usage: zcode parts alternatives --graph FILE --subject ID [--axis algorithm,domain] [--json]");
    return 2;
  }

  const graphPath = option(args, "--graph");
  const subjectId = option(args, "--subject");
  if (!graphPath || !subjectId) {
    console.error("Error: --graph FILE and --subject ID are required");
    return 2;
  }

  try {
    const graph = JSON.parse(readFileSync(resolve(graphPath), "utf8")) as unknown;
    const axisArg = option(args, "--axis");
    const axes = axisArg ? axisArg.split(",").map((axis) => axis.trim()).filter(Boolean) : ["algorithm"];
    const alternatives = findPartAlternatives(graph, subjectId, axes);
    const payload = {
      schema: "zcode.semantic-parts.discovery.v1",
      subject: subjectId,
      required_axes: axes,
      alternatives,
      authority: "NONE",
      standing: "CANDIDATE"
    };
    process.stdout.write(JSON.stringify(payload, null, args.includes("--json") ? 0 : 2) + "\n");
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (args.includes("--json")) {
      process.stdout.write(JSON.stringify({
        schema: "zcode.semantic-parts.discovery.v1",
        standing: "REFUSED",
        authority: "NONE",
        code: "REFUSED_SEMANTIC_PARTS",
        detail
      }) + "\n");
    } else {
      console.error("Error: " + detail);
    }
    return 1;
  }
}
