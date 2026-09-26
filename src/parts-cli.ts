import { createHash } from "node:crypto";
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Admission is total over the graph, not query-dependent: every part and every
// semantic entry on every axis is checked before any SELECT runs, so a graph
// that is malformed anywhere is refused regardless of which axes are asked for.
function admitGraph(value: unknown): asserts value is SemanticPartsGraph {
  if (!isPlainObject(value)) {
    throw new Error("semantic-parts graph must be an object");
  }
  const graph = value as SemanticPartsGraph;
  if (graph.schema !== "unrdf.semantic-parts.v1") {
    throw new Error(`unsupported semantic-parts schema ${String(graph.schema)}`);
  }
  if (graph.authority !== "NONE") throw new Error("semantic-parts graph must carry authority=NONE");
  if (!Array.isArray(graph.parts)) throw new Error("semantic-parts graph parts must be an array");

  const seen = new Set<string>();
  for (const [index, part] of graph.parts.entries()) {
    if (!isPlainObject(part)) throw new Error(`semantic part at index ${index} must be an object`);
    const id = requiredString(part.part_id, "part_id");
    if (seen.has(id)) throw new Error(`duplicate semantic part ${id}`);
    seen.add(id);
    if (part.authority !== "NONE") throw new Error(`semantic part ${id} must carry authority=NONE`);
    if (!isPlainObject(part.semantics)) {
      throw new Error(`semantic part ${id} is missing semantics`);
    }
    if (part.source !== undefined && !isPlainObject(part.source)) {
      throw new Error(`semantic part ${id} source must be an object`);
    }
    for (const [axis, values] of Object.entries(part.semantics)) {
      if (!Array.isArray(values)) {
        throw new Error(`semantic part ${id} axis ${axis} must be an array`);
      }
      for (const entry of values) {
        if (!isPlainObject(entry)) {
          throw new Error(`semantic part ${id} axis ${axis} entries must be objects`);
        }
        requiredString(entry.semantic_id, "semantic_id");
      }
    }
  }
}

function identities(part: SemanticPart, axis: string): Set<string> {
  // Own-property lookup only: an axis named after an Object.prototype member
  // (toString, __proto__, constructor) must never resolve to inherited state.
  if (!part.semantics || !Object.hasOwn(part.semantics, axis)) return new Set();
  const values = part.semantics[axis];
  if (!Array.isArray(values)) return new Set();
  return new Set(values.map((value) => requiredString(value.semantic_id, "semantic_id")));
}

// A subject selector resolves by part_id or by source.file_id. It must name
// exactly one part; a selector matching two parts is refused instead of
// silently binding to whichever part happens to come first.
function subject(graph: SemanticPartsGraph, subjectId: string): SemanticPart {
  const matches = graph.parts!.filter((part) =>
    part.part_id === subjectId
    || (part.source?.file_id !== undefined && String(part.source.file_id) === subjectId)
  );
  if (matches.length === 0) throw new Error(`unknown semantic-parts subject ${subjectId}`);
  if (matches.length > 1) {
    const ids = matches.map((part) => String(part.part_id)).sort().join(", ");
    throw new Error(`ambiguous semantic-parts subject ${subjectId} matches ${ids}`);
  }
  return matches[0]!;
}

export function findPartAlternatives(
  graphValue: unknown,
  subjectId: string,
  axes: string[] = ["algorithm"]
): PartAlternative[] {
  admitGraph(graphValue);
  if (axes.length === 0) throw new Error("at least one required semantic axis is required");
  const requiredAxes = [...new Set(axes.map((axis) => requiredString(axis, "axis")))];
  if (requiredAxes.length !== axes.length) {
    throw new Error("required semantic axes must be distinct");
  }

  const graph = graphValue as SemanticPartsGraph;
  const origin = subject(graph, subjectId);
  const originSets = new Map(requiredAxes.map((axis) => [axis, identities(origin, axis)]));

  for (const [axis, values] of originSets) {
    if (values.size === 0) throw new Error(`subject has no observed semantics for required axis ${axis}`);
  }

  const subjectCount = [...originSets.values()].reduce((sum, values) => sum + values.size, 0);

  return graph.parts!
    .filter((candidate) => candidate.part_id !== origin.part_id)
    .map((candidate) => {
      const sharedEntries: Array<[string, string[]]> = [];
      let sharedCount = 0;
      let allAxes = true;

      for (const axis of requiredAxes) {
        const candidateIds = identities(candidate, axis);
        const overlap = [...originSets.get(axis)!].filter((id) => candidateIds.has(id)).sort();
        sharedEntries.push([axis, overlap]);
        sharedCount += overlap.length;
        if (overlap.length === 0) allAxes = false;
      }

      return {
        part_id: requiredString(candidate.part_id, "part_id"),
        language: typeof candidate.source?.language === "string" ? candidate.source.language : null,
        // Object.fromEntries defines own data properties, so an axis literally
        // named "__proto__" is reported instead of rewriting the prototype.
        shared: Object.fromEntries(sharedEntries) as Record<string, string[]>,
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
      || (left.part_id < right.part_id ? -1 : left.part_id > right.part_id ? 1 : 0)
    )
    .map(({ allAxes: _allAxes, ...candidate }) => candidate);
}

const VALUE_OPTIONS = new Set(["--graph", "--subject", "--axis", "--graph-sha256"]);

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || VALUE_OPTIONS.has(value) || value === "--json") {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

export async function runPartsCommand(args: string[]): Promise<number | undefined> {
  if (args[0] !== "parts") return undefined;

  if (args[1] !== "alternatives") {
    console.error(
      "Usage: zcode parts alternatives --graph FILE --subject ID [--axis algorithm,domain] [--graph-sha256 HEX] [--json]"
    );
    return 2;
  }

  let graphPath: string | undefined;
  let subjectId: string | undefined;
  try {
    graphPath = option(args, "--graph");
    subjectId = option(args, "--subject");
  } catch (error) {
    console.error("Error: " + (error instanceof Error ? error.message : String(error)));
    return 2;
  }
  if (!graphPath || !subjectId) {
    console.error("Error: --graph FILE and --subject ID are required");
    return 2;
  }

  try {
    const bytes = readFileSync(resolve(graphPath));
    // The digest binds the discovery result to the exact observed graph bytes,
    // so a consumer can pin a stale or substituted graph and have it refused.
    const graphSha256 = createHash("sha256").update(bytes).digest("hex");
    const pinned = option(args, "--graph-sha256");
    if (pinned !== undefined && pinned.toLowerCase() !== graphSha256) {
      throw new Error(`graph digest mismatch: expected ${pinned.toLowerCase()} observed ${graphSha256}`);
    }
    const graph = JSON.parse(bytes.toString("utf8")) as unknown;
    const axisArg = option(args, "--axis");
    const axes = axisArg !== undefined
      ? axisArg.split(",").map((axis) => axis.trim()).filter(Boolean)
      : ["algorithm"];
    const alternatives = findPartAlternatives(graph, subjectId, axes);
    const payload = {
      schema: "zcode.semantic-parts.discovery.v1",
      subject: subjectId,
      graph_sha256: graphSha256,
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
