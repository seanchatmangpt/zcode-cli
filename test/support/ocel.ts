// Shared helpers for test/ocel-*.test.ts. Real files, real fixtures, no doubles.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { OcelDoc } from "../../src/generated/ocel.ts";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const fixtureDir = join(repoRoot, "test", "fixtures", "zcode-stream-json");
export const ontologyPath = join(repoRoot, "ontology", "zcode-loop.ttl");

export function fixtures(): { name: string; lines: string[]; records: Record<string, any>[] }[] {
  return readdirSync(fixtureDir).filter((f) => f.endsWith(".ndjson")).sort().map((name) => {
    const lines = readFileSync(join(fixtureDir, name), "utf8").split("\n").filter((l) => l.trim() !== "");
    return { name, lines, records: lines.map((l) => JSON.parse(l)) };
  });
}

export const ontologyText = (): string => readFileSync(ontologyPath, "utf8");

/** Runtime events declared in the consumer ontology, per source, with their Unmapped reason if any. */
export function declaredRuntimeEvents(ttl = ontologyText()): { source: string; name: string; unmappedReason?: string }[] {
  const out: { source: string; name: string; unmappedReason?: string }[] = [];
  for (const m of ttl.matchAll(/^zl:RuntimeEvent-\S+ a pi:RuntimeEvent(?: , (pi:Unmapped))? ; pi:runtimeEventName "([^"]+)" ; pi:emittedBy zl:Source-(\w+)(?: ; pi:unmappedReason "([^"]+)")? \.$/gm)) {
    out.push({
      source: m[3] === "StreamJson" ? "zcode_stream" : m[3] === "GallWorkHook" ? "gall_work" : "zcode_app_server",
      name: m[2],
      unmappedReason: m[4]
    });
  }
  return out;
}

export function declaredInternal(ttl = ontologyText()): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of ttl.matchAll(/^zl:Internal-\w+ a zl:InternalEvent ; zl:internalName "([^"]+)" ; zl:foldsToWire "([^"]+)" \.$/gm)) out[m[1]] = m[2];
  return out;
}

export function getPath(raw: unknown, path: string): unknown {
  let cur: unknown = raw;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** Structural OCEL 2.0 JSON validity. Returns problems (empty when valid). */
export function ocelProblems(doc: OcelDoc): string[] {
  const problems: string[] = [];
  for (const key of ["objectTypes", "eventTypes", "objects", "events"] as const) {
    if (!Array.isArray((doc as any)[key])) problems.push(`missing array ${key}`);
  }
  if (problems.length) return problems;
  const otypes = new Set(doc.objectTypes.map((t) => t.name));
  const etypes = new Set(doc.eventTypes.map((t) => t.name));
  if (otypes.size !== doc.objectTypes.length) problems.push("duplicate objectType");
  if (etypes.size !== doc.eventTypes.length) problems.push("duplicate eventType");
  const objects = new Map<string, string>();
  for (const o of doc.objects) {
    if (objects.has(o.id)) problems.push(`duplicate object ${o.id}`);
    objects.set(o.id, o.type);
    if (!otypes.has(o.type)) problems.push(`object ${o.id} has undeclared type ${o.type}`);
    if (!Array.isArray(o.attributes) || !Array.isArray(o.relationships)) problems.push(`object ${o.id} lacks attributes/relationships arrays`);
  }
  const ids = new Set<string>();
  for (const e of doc.events) {
    if (ids.has(e.id)) problems.push(`duplicate event ${e.id}`);
    ids.add(e.id);
    if (!etypes.has(e.type)) problems.push(`event ${e.id} has undeclared type ${e.type}`);
    if (!ISO.test(e.time)) problems.push(`event ${e.id} time not ISO 8601: ${e.time}`);
    if (!Array.isArray(e.attributes)) problems.push(`event ${e.id} lacks attributes`);
    for (const r of e.relationships) {
      if (!objects.has(r.objectId)) problems.push(`event ${e.id} relates unknown object ${r.objectId}`);
      if (typeof r.qualifier !== "string" || r.qualifier === "") problems.push(`event ${e.id} has an unqualified e2o relation`);
    }
  }
  return problems;
}

/** Minimal JSON Schema (2020-12 subset the shacl pack emits: object/string/required/additionalProperties). */
export function schemaProblems(schemas: any, def: string, value: unknown): string[] {
  const s = schemas.$defs?.[def];
  if (!s) return [`no schema ${def}`];
  if (value === null || typeof value !== "object") return ["not an object"];
  const v = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const req of s.required ?? []) if (!(req in v)) problems.push(`missing ${req}`);
  for (const [k, val] of Object.entries(v)) {
    const p = s.properties?.[k];
    if (!p) { if (s.additionalProperties === false) problems.push(`unexpected ${k}`); continue; }
    if (p.type === "string" && typeof val !== "string") problems.push(`${k} not a string`);
  }
  return problems;
}

export const runtimeMissing = !existsSync(join(repoRoot, "vendor", "zcode.cjs"));

export const requireToolchains = process.env.ZCODE_REQUIRE_TOOLCHAINS === "1";

/** True when a toolchain is present. Under ZCODE_REQUIRE_TOOLCHAINS=1 an absent toolchain throws (test fails) instead of skipping. */
export function toolchain(name: string, present: boolean): boolean {
  if (!present && requireToolchains) throw new Error(`ZCODE_REQUIRE_TOOLCHAINS=1 but toolchain missing: ${name}`);
  return present;
}

export const requireBundle = process.env.ZCODE_REQUIRE_BUNDLE === "1";

/** Under ZCODE_REQUIRE_BUNDLE=1 an absent vendor/zcode.cjs is a failure, never a skip. */
export function assertBundleWhenRequired(): void {
  if (requireBundle && runtimeMissing) throw new Error(`ZCODE_REQUIRE_BUNDLE=1 but bundle missing at ${join(repoRoot, "vendor", "zcode.cjs")}; run bun run sync:locked`);
}
