/**
 * SUPPLE-style usage-trace (T) summarizer over OCEL-like UI events.
 *
 * Computes per-element summary counts that feed the additive layout cost:
 *
 *   $(φ, T) = Σ_{e ∈ E} (
 *       #sw(T, e) · N(sw, φ(e))
 *     + #ent(T, e) · N(ent, φ(e))
 *     + #lv(T, e) · N(lv, φ(e))
 *     + #(T, e) · M(φ(e))
 *   )
 *
 * where #sw / #ent / #lv track switching / entering / leaving container scopes,
 * #(T, e) counts interactions with element e, and N/M are navigation /
 * manipulation effort of widget assignment φ(e).
 *
 * This module ONLY materializes the #* counts from OCEL-like events (synthetic
 * classification allowed when events lack explicit kinds). It does NOT implement
 * N/M, widget assignment φ, CSP/branch-and-bound, ORC, or GRIDS.
 *
 * LAYOUT_COST_WIRING_POINT — future consumer (ggen Explore → Exploit AOT) should
 * take `UiOcelSummary` and multiply by N/M under a chosen φ. See
 * `LAYOUT_COST_WIRING_POINT` and `wireLayoutCostPlaceholder` below.
 */

export const UI_OCEL_SUMMARY_SCHEMA = "zcode.ui-ocel-summary/1" as const;

/** Navigation / interaction kinds corresponding to #sw, #ent, #lv, and #. */
export type UiTraceKind = "sw" | "ent" | "lv" | "interact";

/**
 * Spatial-court refuse/pass OCEL event types ↔ exit taxonomy 0/1/2/3
 * (PASS | FAIL_REFUSED | SUBJECT_MISSING | LOUD_SKIP). Appendix E.5.1.
 * Court verdicts — not SUPPLE #sw/#ent/#lv/# interactions.
 */
export const SPATIAL_COURT_EXIT_EVENT_TYPES = {
  spatial_court_pass: 0,
  spatial_court_refused: 1,
  spatial_court_subject_missing: 2,
  spatial_court_loud_skip: 3
} as const;

export type SpatialCourtExitEventType = keyof typeof SPATIAL_COURT_EXIT_EVENT_TYPES;
export type SpatialCourtExitCode =
  (typeof SPATIAL_COURT_EXIT_EVENT_TYPES)[SpatialCourtExitEventType];

/** Honest standing for a spatial-court exit (mirrors adapters/types court mapping). */
export type SpatialCourtStanding = "ALIVE" | "REFUSED" | "BLOCKED" | "UNVERIFIED";

export interface ClassifiedSpatialCourtExit {
  eventType: SpatialCourtExitEventType;
  exitCode: SpatialCourtExitCode;
  standing: SpatialCourtStanding;
}

const SPATIAL_COURT_STANDING: Record<SpatialCourtExitCode, SpatialCourtStanding> = {
  0: "ALIVE",
  1: "REFUSED",
  2: "BLOCKED",
  3: "UNVERIFIED"
};

/** Closed list of spatial-court exit event types (taxonomy 0/1/2/3). */
export function spatialCourtExitEventTypes(): readonly SpatialCourtExitEventType[] {
  return Object.keys(SPATIAL_COURT_EXIT_EVENT_TYPES) as SpatialCourtExitEventType[];
}

export interface OcelLikeAttribute {
  name: string;
  value: string;
}

export interface OcelLikeRelationship {
  objectId: string;
  qualifier: string;
}

/**
 * Minimal OCEL-shaped event. Full IEEE OCEL 2.0 docs also work when their
 * `events[]` entries are passed through; unknown fields are ignored.
 */
export interface OcelLikeEvent {
  id?: string;
  type: string;
  time?: string;
  /** Direct element id when the emitter already resolved it. */
  elementId?: string;
  attributes?: OcelLikeAttribute[] | Record<string, string>;
  relationships?: OcelLikeRelationship[];
}

/** Classify a spatial-court pass/refuse OCEL event into exit taxonomy, or null. */
export function classifySpatialCourtExitEvent(
  event: OcelLikeEvent
): ClassifiedSpatialCourtExit | null {
  if (!event || typeof event.type !== "string" || !event.type) return null;
  const key = event.type.trim() as SpatialCourtExitEventType;
  if (!(key in SPATIAL_COURT_EXIT_EVENT_TYPES)) return null;
  const exitCode = SPATIAL_COURT_EXIT_EVENT_TYPES[key];
  return {
    eventType: key,
    exitCode,
    standing: SPATIAL_COURT_STANDING[exitCode]
  };
}

export interface ElementTraceCounts {
  elementId: string;
  /** #sw(T, e) — focus / container switches involving e. */
  sw: number;
  /** #ent(T, e) — entries into e's scope. */
  ent: number;
  /** #lv(T, e) — leaves from e's scope. */
  lv: number;
  /** #(T, e) — total interactions with e (always ≥ sw+ent+lv when classified). */
  n: number;
}

export interface UiOcelSummary {
  schema: typeof UI_OCEL_SUMMARY_SCHEMA;
  elements: ElementTraceCounts[];
  eventCount: number;
  classifiedCount: number;
  /** True when at least one count used synthetic kind inference. */
  synthetic: boolean;
}

export interface ClassifiedUiEvent {
  elementId: string;
  kind: UiTraceKind;
  /** True when kind was inferred rather than explicit on the event. */
  synthetic: boolean;
  eventType: string;
}

/**
 * Documented hand-off for the future SUPPLE cost term. Solvers and N/M tables
 * live elsewhere; this constant is the stable import for Explore→Exploit wiring.
 */
export const LAYOUT_COST_WIRING_POINT = {
  id: "LAYOUT_COST_WIRING_POINT",
  status: "stub" as const,
  formula:
    "$(φ,T)=Σ_e(#sw(T,e)·N(sw,φ(e))+#ent(T,e)·N(ent,φ(e))+#lv(T,e)·N(lv,φ(e))+#(T,e)·M(φ(e)))",
  input: "UiOcelSummary (this module)",
  missing: [
    "N(sw|ent|lv, φ(e)) navigation effort table",
    "M(φ(e)) manipulation effort of widget assignment",
    "widget assignment φ and CSP / branch-and-bound selection",
    "ORC / GRIDS AOT emission"
  ] as const,
  consumer: "ggen Explore→Exploit (promote high-# circuit breakers; collapse rare controls into disclosure)"
} as const;

export type LayoutCostWiring = typeof LAYOUT_COST_WIRING_POINT;

export interface LayoutCostPlaceholder {
  wiring: LayoutCostWiring;
  summary: UiOcelSummary;
  /** Always null until a real cost function is wired. */
  cost: null;
}

/** Attach the documented wiring metadata without inventing a solver. */
export function wireLayoutCostPlaceholder(summary: UiOcelSummary): LayoutCostPlaceholder {
  return {
    wiring: LAYOUT_COST_WIRING_POINT,
    summary,
    cost: null
  };
}

const KIND_ATTR_NAMES = new Set([
  "ui_interaction",
  "interaction_kind",
  "ui_trace_kind",
  "supple_kind"
]);

const ELEMENT_ATTR_NAMES = new Set([
  "element_id",
  "elementId",
  "ui_element",
  "widget_id",
  "control_id"
]);

const ELEMENT_QUALIFIERS = new Set([
  "ui_element",
  "targets",
  "interacts_with",
  "switches",
  "enters",
  "leaves",
  "focuses"
]);

const KIND_FROM_QUALIFIER: Record<string, UiTraceKind> = {
  switches: "sw",
  enters: "ent",
  leaves: "lv",
  interacts_with: "interact",
  focuses: "sw"
};

function attrMap(event: OcelLikeEvent): Map<string, string> {
  const out = new Map<string, string>();
  const attrs = event.attributes;
  if (!attrs) return out;
  if (Array.isArray(attrs)) {
    for (const a of attrs) {
      if (a?.name != null && a.value != null) out.set(String(a.name), String(a.value));
    }
    return out;
  }
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) out.set(k, String(v));
  }
  return out;
}

function parseExplicitKind(raw: string): UiTraceKind | null {
  const k = raw.trim().toLowerCase();
  if (k === "sw" || k === "switch" || k === "switches" || k === "focus") return "sw";
  if (k === "ent" || k === "enter" || k === "enters" || k === "entry") return "ent";
  if (k === "lv" || k === "leave" || k === "leaves" || k === "exit") return "lv";
  if (k === "interact" || k === "interaction" || k === "#" || k === "n" || k === "click" || k === "tap") {
    return "interact";
  }
  return null;
}

function inferKindFromType(eventType: string): UiTraceKind | null {
  const t = eventType.toLowerCase();
  if (/(^|[._-])(ui_)?(switch|focus|sw)([._-]|$)/.test(t)) return "sw";
  if (/(^|[._-])(ui_)?(enter|entry|ent)([._-]|$)/.test(t)) return "ent";
  if (/(^|[._-])(ui_)?(leave|exit|lv)([._-]|$)/.test(t)) return "lv";
  if (/(^|[._-])(ui_)?(interact|click|tap|press)([._-]|$)/.test(t)) return "interact";
  if (t.includes("ui_")) return "interact";
  return null;
}

function resolveElementId(event: OcelLikeEvent, attrs: Map<string, string>): string | null {
  if (event.elementId && event.elementId.trim()) return event.elementId.trim();
  for (const name of ELEMENT_ATTR_NAMES) {
    const v = attrs.get(name);
    if (v && v.trim()) return v.trim();
  }
  const rels = event.relationships ?? [];
  for (const rel of rels) {
    if (!rel?.objectId) continue;
    if (ELEMENT_QUALIFIERS.has(rel.qualifier) || rel.qualifier.startsWith("ui_")) {
      return rel.objectId;
    }
  }
  // Synthetic: first relationship object when event type looks UI-related.
  if (inferKindFromType(event.type) && rels[0]?.objectId) {
    return rels[0].objectId;
  }
  return null;
}

function resolveKind(
  event: OcelLikeEvent,
  attrs: Map<string, string>
): { kind: UiTraceKind; synthetic: boolean } | null {
  for (const name of KIND_ATTR_NAMES) {
    const raw = attrs.get(name);
    if (!raw) continue;
    const kind = parseExplicitKind(raw);
    if (kind) return { kind, synthetic: false };
  }
  for (const rel of event.relationships ?? []) {
    const fromQual = KIND_FROM_QUALIFIER[rel.qualifier];
    if (fromQual) return { kind: fromQual, synthetic: false };
  }
  const fromType = inferKindFromType(event.type);
  if (fromType) return { kind: fromType, synthetic: true };
  // Last-resort synthetic: element-bearing events count as interactions.
  if (resolveElementId(event, attrs)) {
    return { kind: "interact", synthetic: true };
  }
  return null;
}

/** Classify a single OCEL-like event into an element + SUPPLE kind, or null. */
export function classifyUiOcelEvent(event: OcelLikeEvent): ClassifiedUiEvent | null {
  if (!event || typeof event.type !== "string" || !event.type) return null;
  // Spatial-court exit taxonomy events are court verdicts, not SUPPLE T counts.
  if (event.type.trim() in SPATIAL_COURT_EXIT_EVENT_TYPES) return null;
  const attrs = attrMap(event);
  const elementId = resolveElementId(event, attrs);
  if (!elementId) return null;
  const resolved = resolveKind(event, attrs);
  if (!resolved) return null;
  return {
    elementId,
    kind: resolved.kind,
    synthetic: resolved.synthetic,
    eventType: event.type
  };
}

function emptyCounts(elementId: string): ElementTraceCounts {
  return { elementId, sw: 0, ent: 0, lv: 0, n: 0 };
}

function bump(counts: ElementTraceCounts, kind: UiTraceKind): void {
  counts.n += 1;
  if (kind === "sw") counts.sw += 1;
  else if (kind === "ent") counts.ent += 1;
  else if (kind === "lv") counts.lv += 1;
  // interact: only # (n) increments
}

/**
 * Summarize OCEL-like events into per-element #sw / #ent / #lv / # counts.
 * Accepts a bare event list or `{ events: [...] }` document slice.
 */
export function summarizeUiOcelTrace(
  input: readonly OcelLikeEvent[] | { events?: readonly OcelLikeEvent[] | null } | null | undefined
): UiOcelSummary {
  const events: readonly OcelLikeEvent[] = Array.isArray(input)
    ? input
    : input && "events" in input && Array.isArray(input.events)
      ? input.events
      : [];

  const byElement = new Map<string, ElementTraceCounts>();
  let classifiedCount = 0;
  let synthetic = false;

  for (const event of events) {
    const classified = classifyUiOcelEvent(event);
    if (!classified) continue;
    classifiedCount += 1;
    if (classified.synthetic) synthetic = true;
    let row = byElement.get(classified.elementId);
    if (!row) {
      row = emptyCounts(classified.elementId);
      byElement.set(classified.elementId, row);
    }
    bump(row, classified.kind);
  }

  const elements = [...byElement.values()].sort((a, b) =>
    a.elementId < b.elementId ? -1 : a.elementId > b.elementId ? 1 : 0
  );

  return {
    schema: UI_OCEL_SUMMARY_SCHEMA,
    elements,
    eventCount: events.length,
    classifiedCount,
    synthetic
  };
}
