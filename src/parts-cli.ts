import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const semanticPartsSchema = "unrdf.semantic-parts.v1";
const discoverySchema = "zcode.semantic-parts.discovery.v1";
const supportedAxes = new Set(["algorithm", "domain", "paradigm", "design_pattern"]);

type SemanticValue = {
  semantic_id?: unknown;
};

type SemanticPart = {
  part_id?: unknown;
  authority?: unknown;
  standing?: unknown;
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

export interface SemanticFalsifierResult {
  subject: string;
  candidate: string;
  required_axes: string[];
  survives: boolean;
  matched?: PartAlternative;
  authority: "NONE";
  standing: "OBSERVED";
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function compareCodePoints(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function admitGraph(value: unknown): asserts value is SemanticPartsGraph {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("semantic-parts graph must be an object");
  }
  const graph = value as SemanticPartsGraph;
  if (graph.schema !== semanticPartsSchema) {
    throw new Error(`unsupported semantic-parts schema ${String(graph.schema)}`);
  }
  if (graph.authority !== "NONE") throw new Error("semantic-parts graph must carry authority=NONE");
  if (!Array.isArray(graph.parts)) throw new Error("semantic-parts graph parts must be an array");

  const seen = new Set<string>();
  for (const part of graph.parts) {
    if (!part || typeof part !== "object") throw new Error("semantic part must be an object");
    const id = requiredString(part.part_id, "part_id");
    if (seen.has(id)) throw new Error(`duplicate semantic part ${id}`);
    seen.add(id);
    if (part.authority !== "NONE") throw new Error(`semantic part ${id} must carry authority=NONE`);
    if (!part.semantics || typeof part.semantics !== "object" || Array.isArray(part.semantics)) {
      throw new Error(`semantic part ${id} is missing semantics`);
    }
    for (const [axis, values] of Object.entries(part.semantics)) {
      if (!Array.isArray(values)) throw new Error(`semantic axis ${axis} for ${id} must be an array`);
      const semanticIds = new Set<string>();
      for (const value of values) {
        if (!value || typeof value !== "object") throw new Error(`semantic value for ${id}/${axis} must be an object`);
        const semanticId = requiredString(value.semantic_id, "semantic_id");
        if (semanticIds.has(semanticId)) throw new Error(`duplicate semantic identity ${semanticId} for ${id}/${axis}`);
        semanticIds.add(semanticId);
      }
    }
  }
}

function identities(part: SemanticPart, axis: string): Set<string> {
  const values = part.semantics?.[axis];
  if (!Array.isArray(values)) return new Set();
  return new Set(values.map((value) => requiredString(value.semantic_id, "semantic_id")));
}

function resolvePart(graph: SemanticPartsGraph, partRef: string): SemanticPart {
  const exact = graph.parts!.filter((part) => part.part_id === partRef);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw new Error(`ambiguous semantic-parts subject ${partRef}`);

  const byFile = graph.parts!.filter((part) => String(part.source?.file_id ?? "") === partRef);
  if (byFile.length === 1) return byFile[0]!;
  if (byFile.length > 1) throw new Error(`ambiguous semantic-parts subject ${partRef}`);
  throw new Error(`unknown semantic-parts subject ${partRef}`);
}

function normalizeAxes(axes: string[]): string[] {
  if (axes.length === 0) throw new Error("at least one required semantic axis is required");
  const normalized = axes.map((axis) => axis.trim()).filter(Boolean);
  if (normalized.length === 0) throw new Error("at least one required semantic axis is required");
  if (new Set(normalized).size !== normalized.length) throw new Error("required semantic axes must be unique");
  for (const axis of normalized) {
    if (!supportedAxes.has(axis)) throw new Error(`unsupported semantic axis ${axis}`);
  }
  return normalized;
}

export function inspectSemanticPart(graphValue: unknown, partRef: string): SemanticPart {
  admitGraph(graphValue);
  return resolvePart(graphValue as SemanticPartsGraph, partRef);
}

export function findPartAlternatives(
  graphValue: unknown,
  subjectId: string,
  axes: string[] = ["algorithm"],
  minimumShared = 1
): PartAlternative[] {
  admitGraph(graphValue);
  if (!Number.isSafeInteger(minimumShared) || minimumShared < 1) {
    throw new Error("minimumShared must be a positive integer");
  }

  const requiredAxes = normalizeAxes(axes);
  const graph = graphValue as SemanticPartsGraph;
  const origin = resolvePart(graph, subjectId);
  const originSets = new Map(requiredAxes.map((axis) => [axis, identities(origin, axis)]));

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

      for (const axis of requiredAxes) {
        const candidateIds = identities(candidate, axis);
        const overlap = [...originSets.get(axis)!]
          .filter((id) => candidateIds.has(id))
          .sort(compareCodePoints);
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
    .filter((candidate) => candidate.allAxes && candidate.shared_count >= minimumShared)
    .sort((left, right) =>
      right.coverage - left.coverage
      || right.shared_count - left.shared_count
      || compareCodePoints(left.part_id, right.part_id)
    )
    .map(({ allAxes: _allAxes, ...candidate }) => candidate);
}

export function semanticCandidateFalsifier(
  graphValue: unknown,
  subjectId: string,
  candidateId: string,
  axes: string[] = ["algorithm"]
): SemanticFalsifierResult {
  admitGraph(graphValue);
  const graph = graphValue as SemanticPartsGraph;
  const candidate = resolvePart(graph, candidateId);
  const requiredAxes = normalizeAxes(axes);
  const alternatives = findPartAlternatives(graph, subjectId, requiredAxes, 1);
  const matched = alternatives.find((entry) => entry.part_id === candidate.part_id);

  return {
    subject: requiredString(resolvePart(graph, subjectId).part_id, "subject part_id"),
    candidate: requiredString(candidate.part_id, "candidate part_id"),
    required_axes: requiredAxes,
    survives: Boolean(matched),
    ...(matched ? { matched } : {}),
    authority: "NONE",
    standing: "OBSERVED"
  };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function positiveIntegerOption(args: string[], name: string, fallback?: number): number | undefined {
  const raw = option(args, name);
  if (raw === undefined) return fallback;
  if (!/^[1-9][0-9]*$/u.test(raw)) throw new Error(`${name} must be a positive integer`);
  return Number(raw);
}

function parseAxes(args: string[]): string[] {
  const axisArg = option(args, "--axis");
  return axisArg ? axisArg.split(",").map((axis) => axis.trim()).filter(Boolean) : ["algorithm"];
}

function receipt<T extends Record<string, unknown>>(payload: T): T & { receipt_digest: string } {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return { ...payload, receipt_digest: `sha256:${digest}` };
}

function loadGraph(args: string[]): unknown {
  const graphPath = option(args, "--graph");
  if (!graphPath) throw new Error("--graph FILE is required");
  return JSON.parse(readFileSync(resolve(graphPath), "utf8")) as unknown;
}

function usage(): string {
  return [
    "Usage:",
    "  zcode parts inspect --graph FILE --subject ID [--json]",
    "  zcode parts alternatives --graph FILE --subject ID [--axis algorithm,domain] [--minimum-shared N] [--limit N] [--json]",
    "  zcode parts falsify --graph FILE --subject ID --candidate ID [--axis algorithm,domain] [--json]"
  ].join("\n");
}

export async function runPartsCommand(args: string[]): Promise<number | undefined> {
  if (args[0] !== "parts") return undefined;

  const command = args[1];
  if (!["inspect", "alternatives", "falsify"].includes(command ?? "")) {
    console.error(usage());
    return 2;
  }

  try {
    const graph = loadGraph(args);
    const subjectId = option(args, "--subject");
    if (!subjectId) throw new Error("--subject ID is required");

    let payload: Record<string, unknown>;
    if (command === "inspect") {
      const part = inspectSemanticPart(graph, subjectId);
      payload = {
        schema: discoverySchema,
        operation: "inspect",
        subject: part.part_id,
        part,
        authority: "NONE",
        standing: "OBSERVED"
      };
    } else if (command === "alternatives") {
      const axes = parseAxes(args);
      const minimumShared = positiveIntegerOption(args, "--minimum-shared", 1)!;
      const limit = positiveIntegerOption(args, "--limit");
      const discovered = findPartAlternatives(graph, subjectId, axes, minimumShared);
      const alternatives = limit === undefined ? discovered : discovered.slice(0, limit);
      payload = {
        schema: discoverySchema,
        operation: "alternatives",
        subject: subjectId,
        required_axes: normalizeAxes(axes),
        minimum_shared: minimumShared,
        candidate_count: discovered.length,
        returned_count: alternatives.length,
        alternatives,
        authority: "NONE",
        standing: "CANDIDATE"
      };
    } else {
      const candidateId = option(args, "--candidate");
      if (!candidateId) throw new Error("--candidate ID is required");
      payload = {
        schema: discoverySchema,
        operation: "falsify",
        ...semanticCandidateFalsifier(graph, subjectId, candidateId, parseAxes(args))
      };
    }

    process.stdout.write(JSON.stringify(receipt(payload), null, args.includes("--json") ? 0 : 2) + "\n");
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (args.includes("--json")) {
      process.stdout.write(JSON.stringify({
        schema: discoverySchema,
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
