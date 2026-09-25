import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type EvidenceStage = "constraint" | "hypothesis" | "verification" | "construction";

interface EvidenceMember {
  id: string;
  kind: string;
  digest: string;
  provenance: string;
  subject: string;
}

interface DerivationNode {
  id: string;
  stage: EvidenceStage;
  digest: string;
  producer: string;
  subject: string;
}

interface EvidenceEdge {
  from: string;
  to: string;
  relation: string;
}

interface EvidenceClaim {
  evidence_id: string;
  construction_id: string;
}

interface PolyEvidenceBundle {
  schema: "zcode.poly-evidence/1";
  repository_identity: string;
  base_sha: string;
  exact_subject: string;
  evidence: EvidenceMember[];
  derivations: DerivationNode[];
  edges: EvidenceEdge[];
  claims: EvidenceClaim[];
}

export interface EvidenceAdmissionReceipt {
  schema: "zcode.evidence-admission/1";
  standing: "ADMITTED";
  proof_scope: "evidence-integration";
  authority: "none";
  repository_identity: string;
  base_sha: string;
  exact_subject: string;
  bundle_digest: string;
  evidence_count: number;
  derivation_count: number;
  claim_count: number;
  admitted_claims: Array<{
    evidence_id: string;
    construction_id: string;
    path: string[];
  }>;
  external_do_count: 0;
  receipt_digest: string;
}

const schema = "zcode.poly-evidence/1";
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const exactShaPattern = /^[0-9a-f]{40}$/u;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const evidenceKinds = new Set([
  "image", "video", "log", "trace", "ocel", "test-output", "diff", "source", "issue",
  "metric", "browser-state", "db-result", "ontology", "receipt", "prior-run"
]);
const derivationStages = new Set<EvidenceStage>([
  "constraint", "hypothesis", "verification", "construction"
]);
const expectedRelation = new Map<string, string>([
  ["evidence>constraint", "constrains"],
  ["constraint>hypothesis", "supports"],
  ["hypothesis>verification", "verified_by"],
  ["verification>construction", "admits"]
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`missing or invalid ${field}`);
  return value;
}

function requiredArray(input: Record<string, unknown>, field: string): unknown[] {
  const value = input[field];
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array`);
  return value;
}

function stableJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`).join(",")}}`;
}

function digestJson(value: Json): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function parseMember(value: unknown, exactSubject: string): EvidenceMember {
  const input = record(value);
  if (!input) throw new Error("evidence member must be an object");
  const id = requiredString(input, "id");
  const kind = requiredString(input, "kind");
  const digest = requiredString(input, "digest");
  const provenance = requiredString(input, "provenance");
  const subject = requiredString(input, "subject");
  if (!idPattern.test(id)) throw new Error(`invalid evidence id ${id}`);
  if (!evidenceKinds.has(kind)) throw new Error(`unsupported evidence kind ${kind}`);
  if (!sha256Pattern.test(digest)) throw new Error(`${id} has invalid evidence digest`);
  if (subject !== exactSubject) throw new Error(`${id} subject does not match exact_subject`);
  return { id, kind, digest, provenance, subject };
}

function parseDerivation(value: unknown, exactSubject: string): DerivationNode {
  const input = record(value);
  if (!input) throw new Error("derivation node must be an object");
  const id = requiredString(input, "id");
  const stage = requiredString(input, "stage") as EvidenceStage;
  const digest = requiredString(input, "digest");
  const producer = requiredString(input, "producer");
  const subject = requiredString(input, "subject");
  if (!idPattern.test(id)) throw new Error(`invalid derivation id ${id}`);
  if (!derivationStages.has(stage)) throw new Error(`${id} has unsupported derivation stage ${stage}`);
  if (!sha256Pattern.test(digest)) throw new Error(`${id} has invalid derivation digest`);
  if (subject !== exactSubject) throw new Error(`${id} subject does not match exact_subject`);
  return { id, stage, digest, producer, subject };
}

function parseBundle(value: unknown): PolyEvidenceBundle {
  const input = record(value);
  if (!input || input.schema !== schema) throw new Error(`unsupported evidence bundle schema ${String(input?.schema)}`);
  const repository_identity = requiredString(input, "repository_identity");
  const base_sha = requiredString(input, "base_sha");
  const exact_subject = requiredString(input, "exact_subject");
  if (!repositoryPattern.test(repository_identity)) throw new Error("repository_identity must be owner/name");
  if (!exactShaPattern.test(base_sha)) throw new Error("base_sha must be an exact 40-hex commit SHA");

  const evidence = requiredArray(input, "evidence").map((item) => parseMember(item, exact_subject));
  const derivations = requiredArray(input, "derivations").map((item) => parseDerivation(item, exact_subject));
  const edgesRaw = requiredArray(input, "edges");
  const claimsRaw = requiredArray(input, "claims");

  const nodes = new Map<string, "evidence" | EvidenceStage>();
  for (const item of evidence) {
    if (nodes.has(item.id)) throw new Error(`duplicate node id ${item.id}`);
    nodes.set(item.id, "evidence");
  }
  for (const item of derivations) {
    if (nodes.has(item.id)) throw new Error(`duplicate node id ${item.id}`);
    nodes.set(item.id, item.stage);
  }

  const edgeKeys = new Set<string>();
  const edges: EvidenceEdge[] = edgesRaw.map((value) => {
    const edge = record(value);
    if (!edge) throw new Error("edge must be an object");
    const from = requiredString(edge, "from");
    const to = requiredString(edge, "to");
    const relation = requiredString(edge, "relation");
    const fromStage = nodes.get(from);
    const toStage = nodes.get(to);
    if (!fromStage || !toStage) throw new Error(`edge ${from}->${to} references an unknown node`);
    const expected = expectedRelation.get(`${fromStage}>${toStage}`);
    if (!expected || relation !== expected) {
      throw new Error(`edge ${from}->${to} is not an admitted transition (${fromStage}>${toStage}, ${relation})`);
    }
    const key = `${from}\0${to}\0${relation}`;
    if (edgeKeys.has(key)) throw new Error(`duplicate edge ${from}->${to}`);
    edgeKeys.add(key);
    return { from, to, relation };
  });

  const claims: EvidenceClaim[] = claimsRaw.map((value) => {
    const claim = record(value);
    if (!claim) throw new Error("claim must be an object");
    const evidence_id = requiredString(claim, "evidence_id");
    const construction_id = requiredString(claim, "construction_id");
    if (nodes.get(evidence_id) !== "evidence") throw new Error(`claim references non-evidence node ${evidence_id}`);
    if (nodes.get(construction_id) !== "construction") throw new Error(`claim references non-construction node ${construction_id}`);
    return { evidence_id, construction_id };
  });

  return { schema, repository_identity, base_sha, exact_subject, evidence, derivations, edges, claims };
}

function admittedPath(bundle: PolyEvidenceBundle, evidenceId: string, constructionId: string): string[] | undefined {
  const stageById = new Map<string, "evidence" | EvidenceStage>();
  for (const item of bundle.evidence) stageById.set(item.id, "evidence");
  for (const item of bundle.derivations) stageById.set(item.id, item.stage);
  const outgoing = new Map<string, string[]>();
  for (const edge of bundle.edges) {
    const list = outgoing.get(edge.from) ?? [];
    list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  const stages: Array<"evidence" | EvidenceStage> = [
    "evidence", "constraint", "hypothesis", "verification", "construction"
  ];
  let paths = [[evidenceId]];
  for (let index = 1; index < stages.length; index += 1) {
    const wanted = stages[index]!;
    const next: string[][] = [];
    for (const path of paths) {
      const tail = path[path.length - 1]!;
      for (const candidate of outgoing.get(tail) ?? []) {
        if (stageById.get(candidate) === wanted) next.push([...path, candidate]);
      }
    }
    paths = next;
    if (paths.length === 0) return undefined;
  }
  return paths.find((path) => path[path.length - 1] === constructionId);
}

export function verifyEvidenceBundle(path: string): EvidenceAdmissionReceipt {
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  const bundle = parseBundle(raw);
  const admitted_claims = bundle.claims.map((claim) => {
    const pathIds = admittedPath(bundle, claim.evidence_id, claim.construction_id);
    if (!pathIds) {
      throw new Error(`no admitted causal path ${claim.evidence_id} -> ${claim.construction_id}`);
    }
    return { ...claim, path: pathIds };
  });
  const normalized = bundle as unknown as Json;
  const base = {
    schema: "zcode.evidence-admission/1" as const,
    standing: "ADMITTED" as const,
    proof_scope: "evidence-integration" as const,
    authority: "none" as const,
    repository_identity: bundle.repository_identity,
    base_sha: bundle.base_sha,
    exact_subject: bundle.exact_subject,
    bundle_digest: digestJson(normalized),
    evidence_count: bundle.evidence.length,
    derivation_count: bundle.derivations.length,
    claim_count: bundle.claims.length,
    admitted_claims,
    external_do_count: 0 as const
  };
  return { ...base, receipt_digest: digestJson(base as unknown as Json) };
}

class UsageError extends Error {}

function parseArgs(args: string[]): { bundle: string; out?: string; json: boolean } {
  let bundle: string | undefined;
  let out: string | undefined;
  let json = false;
  for (let index = 2; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--bundle" || arg === "--out") {
      const value = args[index + 1];
      if (!value) throw new UsageError(`${arg} requires a value`);
      index += 1;
      if (arg === "--bundle") bundle = value;
      else out = value;
      continue;
    }
    throw new UsageError(`unknown argument ${arg}`);
  }
  if (!bundle) throw new UsageError("--bundle FILE is required");
  return { bundle, out, json };
}

const usage = "Usage: zcode evidence verify --bundle FILE [--json] [--out FILE]";

export async function runEvidenceCommand(args: string[]): Promise<number | undefined> {
  if (args[0] !== "evidence") return undefined;
  if (args[1] !== "verify") {
    console.error(usage);
    return 2;
  }
  let options: ReturnType<typeof parseArgs>;
  try {
    options = parseArgs(args);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n${usage}`);
    return 2;
  }
  try {
    const receipt = verifyEvidenceBundle(options.bundle);
    const rendered = JSON.stringify(receipt, null, options.json ? 0 : 2);
    if (options.out) writeFileSync(resolve(options.out), rendered + "\n", "utf8");
    process.stdout.write(rendered + "\n");
    return 0;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (options.json) {
      process.stdout.write(JSON.stringify({
        schema: "zcode.evidence-admission/1",
        standing: "REFUSED",
        code: "REFUSED_EVIDENCE_BUNDLE",
        detail,
        authority: "none",
        external_do_count: 0
      }) + "\n");
    } else {
      console.error("Error: " + detail);
    }
    return 1;
  }
}
