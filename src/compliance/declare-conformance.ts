import { containsUnredactedSecretsOrPii } from "./redactor.ts";

export interface Ocel2AttributeLike {
  name: string;
  value: unknown;
  time?: string;
}

export interface Ocel2RelationshipLike {
  objectId: string;
  qualifier: string;
}

export interface Ocel2ObjectLike {
  id: string;
  type: string;
  attributes: readonly Ocel2AttributeLike[] | readonly unknown[] | Record<string, unknown>;
  relationships?: readonly Ocel2RelationshipLike[] | readonly unknown[];
}

export interface Ocel2EventLike {
  id: string;
  type: string;
  time: string;
  attributes: readonly Ocel2AttributeLike[] | Record<string, unknown>;
  relationships: readonly Ocel2RelationshipLike[];
}

export interface Ocel2DocLike {
  objectTypes?: ReadonlyArray<{ name: string; attributes?: ReadonlyArray<{ name: string; type: string }> | unknown[] }>;
  eventTypes?: ReadonlyArray<{ name: string; attributes?: ReadonlyArray<{ name: string; type: string }> | unknown[] }>;
  objects: readonly Ocel2ObjectLike[];
  events: readonly Ocel2EventLike[];
}

export type DeclareTemplate =
  | "Init"
  | "Existence"
  | "Absence"
  | "Response"
  | "Precedence"
  | "ChainResponse"
  | "NotCoExistence";

export type DeclareStatus = "SATISFIED_WITNESSED" | "SATISFIED_VACUOUS" | "VIOLATED";

export interface DeclareRule {
  id: string;
  template: DeclareTemplate;
  activity?: string;
  activation?: string;
  target?: string;
  minCount?: number;
  maxCount?: number;
  objectType?: string;
  mandatory?: boolean;
  article?: string;
  description?: string;
  antiVacuityRequired?: boolean;
}

export interface DeclareRulesDocument {
  schema?: string;
  rules: readonly DeclareRule[];
}

export interface DeclareEvaluationResult {
  id: string;
  template: DeclareTemplate;
  objectType: string;
  mandatory: boolean;
  status: DeclareStatus;
  witness_event_ids: string[];
  counterexample_event_ids: string[];
  activations: number;
  evaluatedTraces: number;
  witnessedTraces: number;
  vacuousTraces: number;
  violatedTraces: number;
  antiVacuityPassed: boolean;
  article?: string;
  detail: string;
}

export interface DeclareConformanceReport {
  schema: "zcode.declare-report/1";
  results: DeclareEvaluationResult[];
  declareResults: DeclareEvaluationResult[];
  allMandatorySatisfied: boolean;
  witnessedCount: number;
  vacuousCount: number;
  violatedCount: number;
}

export const DEFAULT_EU_AI_ACT_DECLARE_RULES: DeclareRule[] = [
  {
    id: "DEC-INIT-SESSION",
    template: "Init",
    activity: "session_created|art50_disclosure_emitted",
    objectType: "session",
    mandatory: true,
    article: "Art. 50",
    description: "Every session must initiate with session_created or Art. 50 AI interaction disclosure.",
    antiVacuityRequired: true
  },
  {
    id: "DEC-EXIST-TURN",
    template: "Existence",
    activity: "turn_started|receipt_persist",
    minCount: 1,
    objectType: "session",
    mandatory: true,
    article: "Art. 12",
    description: "Record-keeping: at least one turn_started or receipt_persist event per session.",
    antiVacuityRequired: true
  },
  {
    id: "DEC-ABS-UNREDACTED",
    template: "Absence",
    activity: "unredacted_secret|unredacted_secret_detected",
    maxCount: 0,
    objectType: "session",
    mandatory: true,
    article: "Art. 10/15",
    description: "No unredacted secrets or credentials may appear in OCEL telemetry.",
    antiVacuityRequired: true
  },
  {
    id: "DEC-RESP-ART50",
    template: "Response",
    activation: "session_created",
    target: "art50_disclosure_emitted",
    objectType: "session",
    mandatory: true,
    article: "Art. 50",
    description: "Session creation must be followed by an Art. 50 AI interaction disclosure.",
    antiVacuityRequired: true
  },
  {
    id: "DEC-PREC-ART14",
    template: "Precedence",
    activation: "tool_updated",
    target: "permission_resolved",
    objectType: "turn",
    mandatory: true,
    article: "Art. 14",
    description: "Human/policy permission resolution must precede tool execution within a turn.",
    antiVacuityRequired: true
  },
  {
    id: "DEC-CHAIN-RECEIPT",
    template: "ChainResponse",
    activation: "worker_claim",
    target: "receipt_persist",
    objectType: "work_order",
    mandatory: true,
    article: "Art. 12/15",
    description: "A worker_claim on a work_order must be immediately followed by receipt_persist.",
    antiVacuityRequired: true
  },
  {
    id: "DEC-NOTCO-YOLO-HIGHRISK",
    template: "NotCoExistence",
    activation: "mode_yolo_enabled|yolo_bypass_enabled",
    target: "high_risk_profile_active",
    objectType: "session",
    mandatory: true,
    article: "Art. 14",
    description: "Unattended YOLO/bypassPermissions mode cannot coexist with a high-risk compliance profile.",
    antiVacuityRequired: true
  }
];

const QUALIFIER_TO_OBJECT_TYPE: Readonly<Record<string, string>> = {
  in_session: "session",
  in_turn: "turn",
  about_tool_call: "tool_call",
  about_permission: "permission",
  about_model_request: "model_request",
  by_subagent: "subagent",
  subject: "work_order",
  in_work_order: "work_order",
  on_lease: "lease",
  provider: "provider",
  worker: "worker",
  receipt: "receipt",
  originAuthority: "authority",
  governs: "permission",
  mutated_in: "workspace_file",
  seals: "receipt",
  approved_by: "human_overseer"
};

const HIGH_RISK_TOOL_NAMES = new Set([
  "Bash",
  "Write",
  "Edit",
  "MultiEdit",
  "Delete",
  "Execute",
  "NotebookEdit"
]);

const HIGH_RISK_PROFILES = new Set(["high-risk-annex-iii", "high-risk-annex-i"]);

function normalizeAttrs(
  attrs: readonly Ocel2AttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined
): Array<{ name: string; value: string }> {
  if (!attrs) return [];
  if (Array.isArray(attrs)) {
    const out: Array<{ name: string; value: string }> = [];
    for (const item of attrs) {
      if (item && typeof item === "object" && "name" in item) {
        const entry = item as Ocel2AttributeLike;
        out.push({ name: String(entry.name), value: entry.value === undefined || entry.value === null ? "" : String(entry.value) });
      }
    }
    return out;
  }
  return Object.entries(attrs).map(([name, value]) => ({
    name,
    value: value === undefined || value === null ? "" : String(value)
  }));
}

function getAttr(
  attrs: readonly Ocel2AttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined,
  name: string
): string | undefined {
  const list = normalizeAttrs(attrs);
  let last: string | undefined;
  for (const a of list) {
    if (a.name === name) last = a.value;
  }
  return last;
}

function isHighRiskProfileValue(val: string | undefined): boolean {
  return val !== undefined && HIGH_RISK_PROFILES.has(val.trim());
}

const RAW_API_KEY_VALUE_RE =
  /\b(?:sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{16,}|gh[pou]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/;

function eventHasUnredactedSecret(event: Ocel2EventLike): boolean {
  const attrs = normalizeAttrs(event.attributes).filter(
    (a) => !a.name.startsWith("pi_") && a.name !== "prompt_sha256" && a.name !== "sha256"
  );
  if (attrs.length === 0) return false;
  for (const a of attrs) {
    if (RAW_API_KEY_VALUE_RE.test(a.value)) return true;
  }
  const obj: Record<string, string> = {};
  for (const a of attrs) obj[a.name] = a.value;
  return containsUnredactedSecretsOrPii(JSON.stringify(obj), { redactPii: false });
}

function matchesSubPattern(
  event: Ocel2EventLike,
  sub: string,
  objectById: ReadonlyMap<string, Ocel2ObjectLike>
): boolean {
  const pat = sub.trim();
  if (!pat) return false;
  if (event.type === pat) return true;

  if (pat === "unredacted_secret" || pat === "unredacted_secret_detected") {
    return eventHasUnredactedSecret(event);
  }

  if (pat === "high_risk_profile_active" || pat === "high_risk_profile") {
    const evProfile = getAttr(event.attributes, "compliance_profile") ?? getAttr(event.attributes, "profile");
    if (isHighRiskProfileValue(evProfile)) return true;
    for (const rel of event.relationships ?? []) {
      const obj = objectById.get(rel.objectId);
      if (!obj) continue;
      const objProfile = getAttr(obj.attributes, "compliance_profile") ?? getAttr(obj.attributes, "profile");
      if (isHighRiskProfileValue(objProfile) && (obj.type === "session" || event.type === "session_created")) {
        return true;
      }
    }
    return false;
  }

  if (pat === "mode_yolo_enabled" || pat === "yolo_bypass_enabled" || pat === "mode_yolo") {
    const mode = getAttr(event.attributes, "mode");
    const permMode = getAttr(event.attributes, "permission_mode");
    const allowYolo = getAttr(event.attributes, "allow_yolo");
    return (
      mode === "yolo" ||
      permMode === "bypassPermissions" ||
      permMode === "yolo" ||
      allowYolo === "true"
    );
  }

  if (pat === "tool_updated_high_risk") {
    if (event.type !== "tool_updated") return false;
    const risk = getAttr(event.attributes, "risk_level");
    if (risk === "high" || risk === "critical") return true;
    const toolName = getAttr(event.attributes, "tool_name");
    if (toolName && HIGH_RISK_TOOL_NAMES.has(toolName)) return true;
    for (const rel of event.relationships ?? []) {
      const obj = objectById.get(rel.objectId);
      if (!obj || obj.type !== "tool_call") continue;
      const objRisk = getAttr(obj.attributes, "risk_level");
      if (objRisk === "high" || objRisk === "critical") return true;
      const objTool = getAttr(obj.attributes, "tool_name");
      if (objTool && HIGH_RISK_TOOL_NAMES.has(objTool)) return true;
    }
    return false;
  }

  return false;
}

export function matchesDeclarePredicate(
  event: Ocel2EventLike,
  pattern: string | undefined,
  objectById: ReadonlyMap<string, Ocel2ObjectLike>
): boolean {
  if (!pattern || !pattern.trim()) return false;
  return pattern.split("|").some((part) => matchesSubPattern(event, part, objectById));
}

interface TraceOutcome {
  status: DeclareStatus;
  witnessIds: string[];
  counterexampleIds: string[];
  activations: number;
}

function evaluateTraceForRule(
  trace: readonly Ocel2EventLike[],
  rule: DeclareRule,
  objectById: ReadonlyMap<string, Ocel2ObjectLike>
): TraceOutcome {
  const match = (ev: Ocel2EventLike, pat: string | undefined) => matchesDeclarePredicate(ev, pat, objectById);

  switch (rule.template) {
    case "Init": {
      const act = rule.activity ?? rule.activation;
      if (trace.length === 0) {
        return { status: "SATISFIED_VACUOUS", witnessIds: [], counterexampleIds: [], activations: 0 };
      }
      const first = trace[0]!;
      if (match(first, act)) {
        return { status: "SATISFIED_WITNESSED", witnessIds: [first.id], counterexampleIds: [], activations: 1 };
      }
      return { status: "VIOLATED", witnessIds: [], counterexampleIds: [first.id], activations: 1 };
    }

    case "Existence": {
      const act = rule.activity ?? rule.activation;
      const minCount = rule.minCount ?? 1;
      const matches = trace.filter((e) => match(e, act));
      if (trace.length === 0 && minCount > 0) {
        return { status: "VIOLATED", witnessIds: [], counterexampleIds: [], activations: 1 };
      }
      if (minCount === 0) {
        return trace.length > 0
          ? { status: "SATISFIED_WITNESSED", witnessIds: [trace[0]!.id], counterexampleIds: [], activations: 0 }
          : { status: "SATISFIED_VACUOUS", witnessIds: [], counterexampleIds: [], activations: 0 };
      }
      if (matches.length >= minCount) {
        return {
          status: "SATISFIED_WITNESSED",
          witnessIds: matches.map((e) => e.id),
          counterexampleIds: [],
          activations: matches.length
        };
      }
      return {
        status: "VIOLATED",
        witnessIds: matches.map((e) => e.id),
        counterexampleIds: trace.length > 0 ? [trace[trace.length - 1]!.id] : [],
        activations: matches.length
      };
    }

    case "Absence": {
      const act = rule.activity ?? rule.activation;
      const maxCount = rule.maxCount ?? 0;
      if (trace.length === 0) {
        return { status: "SATISFIED_VACUOUS", witnessIds: [], counterexampleIds: [], activations: 0 };
      }
      const matches = trace.filter((e) => match(e, act));
      if (matches.length > maxCount) {
        return {
          status: "VIOLATED",
          witnessIds: [],
          counterexampleIds: matches.map((e) => e.id),
          activations: matches.length
        };
      }
      return {
        status: "SATISFIED_WITNESSED",
        witnessIds: [trace[0]!.id],
        counterexampleIds: [],
        activations: trace.length
      };
    }

    case "Response": {
      const actPat = rule.activation ?? rule.activity;
      const tgtPat = rule.target;
      const witnessIds: string[] = [];
      const counterexampleIds: string[] = [];
      let activations = 0;

      for (let i = 0; i < trace.length; i++) {
        const ev = trace[i]!;
        if (!match(ev, actPat)) continue;
        activations += 1;
        let foundTarget: Ocel2EventLike | undefined;
        for (let j = i + 1; j < trace.length; j++) {
          if (match(trace[j]!, tgtPat)) {
            foundTarget = trace[j]!;
            break;
          }
        }
        if (foundTarget) {
          witnessIds.push(ev.id, foundTarget.id);
        } else {
          counterexampleIds.push(ev.id);
        }
      }

      if (counterexampleIds.length > 0) {
        return { status: "VIOLATED", witnessIds, counterexampleIds, activations };
      }
      if (activations === 0) {
        return { status: "SATISFIED_VACUOUS", witnessIds: [], counterexampleIds: [], activations: 0 };
      }
      return { status: "SATISFIED_WITNESSED", witnessIds: [...new Set(witnessIds)], counterexampleIds: [], activations };
    }

    case "Precedence": {
      // activation = triggered constrained event; target = prerequisite event that must precede it
      const actPat = rule.activation ?? rule.activity;
      const prePat = rule.target;
      const witnessIds: string[] = [];
      const counterexampleIds: string[] = [];
      let activations = 0;
      let latestPre: Ocel2EventLike | undefined;

      for (const ev of trace) {
        if (match(ev, prePat)) {
          latestPre = ev;
        }
        if (match(ev, actPat)) {
          activations += 1;
          if (latestPre) {
            witnessIds.push(latestPre.id, ev.id);
          } else {
            counterexampleIds.push(ev.id);
          }
        }
      }

      if (counterexampleIds.length > 0) {
        return { status: "VIOLATED", witnessIds, counterexampleIds, activations };
      }
      if (activations === 0) {
        return { status: "SATISFIED_VACUOUS", witnessIds: [], counterexampleIds: [], activations: 0 };
      }
      return { status: "SATISFIED_WITNESSED", witnessIds: [...new Set(witnessIds)], counterexampleIds: [], activations };
    }

    case "ChainResponse": {
      const actPat = rule.activation ?? rule.activity;
      const tgtPat = rule.target;
      const witnessIds: string[] = [];
      const counterexampleIds: string[] = [];
      let activations = 0;

      for (let i = 0; i < trace.length; i++) {
        const ev = trace[i]!;
        if (!match(ev, actPat)) continue;
        activations += 1;
        const next = trace[i + 1];
        if (next && match(next, tgtPat)) {
          witnessIds.push(ev.id, next.id);
        } else {
          counterexampleIds.push(ev.id);
          if (next) counterexampleIds.push(next.id);
        }
      }

      if (counterexampleIds.length > 0) {
        return {
          status: "VIOLATED",
          witnessIds,
          counterexampleIds: [...new Set(counterexampleIds)],
          activations
        };
      }
      if (activations === 0) {
        return { status: "SATISFIED_VACUOUS", witnessIds: [], counterexampleIds: [], activations: 0 };
      }
      return { status: "SATISFIED_WITNESSED", witnessIds: [...new Set(witnessIds)], counterexampleIds: [], activations };
    }

    case "NotCoExistence": {
      const actPat = rule.activation ?? rule.activity;
      const tgtPat = rule.target;
      const aEvents = trace.filter((e) => match(e, actPat));
      const bEvents = trace.filter((e) => match(e, tgtPat));

      if (aEvents.length > 0 && bEvents.length > 0) {
        return {
          status: "VIOLATED",
          witnessIds: [],
          counterexampleIds: [...aEvents.map((e) => e.id), ...bEvents.map((e) => e.id)],
          activations: aEvents.length + bEvents.length
        };
      }
      if (aEvents.length > 0 || bEvents.length > 0) {
        const present = aEvents.length > 0 ? aEvents : bEvents;
        return {
          status: "SATISFIED_WITNESSED",
          witnessIds: present.map((e) => e.id),
          counterexampleIds: [],
          activations: present.length
        };
      }
      return { status: "SATISFIED_VACUOUS", witnessIds: [], counterexampleIds: [], activations: 0 };
    }
  }
}

function buildTracesByObjectType(
  doc: Ocel2DocLike,
  objectType: string,
  objectById: ReadonlyMap<string, Ocel2ObjectLike>,
  sortedEvents: readonly Ocel2EventLike[]
): Map<string, Ocel2EventLike[]> {
  const traces = new Map<string, Ocel2EventLike[]>();

  for (const obj of doc.objects ?? []) {
    if (obj.type === objectType) {
      traces.set(obj.id, []);
    }
  }

  for (const ev of sortedEvents) {
    const matchedIds = new Set<string>();
    for (const rel of ev.relationships ?? []) {
      const obj = objectById.get(rel.objectId);
      const inferredType = obj?.type ?? QUALIFIER_TO_OBJECT_TYPE[rel.qualifier];
      if (inferredType === objectType) {
        matchedIds.add(rel.objectId);
      }
    }
    for (const oid of matchedIds) {
      let arr = traces.get(oid);
      if (!arr) {
        arr = [];
        traces.set(oid, arr);
      }
      arr.push(ev);
    }
  }

  return traces;
}

export function evaluateDeclareRules(
  doc: Ocel2DocLike,
  rulesInput: readonly DeclareRule[] | DeclareRulesDocument = DEFAULT_EU_AI_ACT_DECLARE_RULES
): DeclareConformanceReport {
  const rules = Array.isArray(rulesInput)
    ? rulesInput
    : (rulesInput as DeclareRulesDocument).rules ?? DEFAULT_EU_AI_ACT_DECLARE_RULES;

  const objectById = new Map<string, Ocel2ObjectLike>();
  for (const obj of doc.objects ?? []) {
    objectById.set(obj.id, obj);
  }

  const sortedEvents = [...(doc.events ?? [])]
    .map((ev, idx) => ({ ev, idx, ms: Date.parse(ev.time) }))
    .sort((a, b) => {
      const am = Number.isFinite(a.ms) ? a.ms : 0;
      const bm = Number.isFinite(b.ms) ? b.ms : 0;
      return am !== bm ? am - bm : a.idx - b.idx;
    })
    .map((x) => x.ev);

  const results: DeclareEvaluationResult[] = [];

  for (const rule of rules) {
    const objectType = rule.objectType ?? "session";
    const mandatory = rule.mandatory ?? true;
    const traces = buildTracesByObjectType(doc, objectType, objectById, sortedEvents);

    if (traces.size === 0 && objectType === "session" && sortedEvents.length > 0 && (doc.objects ?? []).length === 0) {
      traces.set("__default_session__", sortedEvents);
    }

    if (traces.size === 0) {
      results.push({
        id: rule.id,
        template: rule.template,
        objectType,
        mandatory,
        status: "SATISFIED_VACUOUS",
        witness_event_ids: [],
        counterexample_event_ids: [],
        activations: 0,
        evaluatedTraces: 0,
        witnessedTraces: 0,
        vacuousTraces: 0,
        violatedTraces: 0,
        antiVacuityPassed: !(rule.antiVacuityRequired ?? false),
        article: rule.article,
        detail: `No traces observed for objectType "${objectType}" (vacuously satisfied).`
      });
      continue;
    }

    let witnessedTraces = 0;
    let vacuousTraces = 0;
    let violatedTraces = 0;
    let totalActivations = 0;
    const witnessSet = new Set<string>();
    const counterSet = new Set<string>();

    for (const traceEvents of traces.values()) {
      const res = evaluateTraceForRule(traceEvents, rule, objectById);
      totalActivations += res.activations;
      for (const id of res.witnessIds) witnessSet.add(id);
      for (const id of res.counterexampleIds) counterSet.add(id);
      if (res.status === "VIOLATED") violatedTraces += 1;
      else if (res.status === "SATISFIED_WITNESSED") witnessedTraces += 1;
      else vacuousTraces += 1;
    }

    const status: DeclareStatus =
      violatedTraces > 0
        ? "VIOLATED"
        : witnessedTraces > 0
          ? "SATISFIED_WITNESSED"
          : "SATISFIED_VACUOUS";

    const antiVacuityPassed = status === "SATISFIED_WITNESSED";

    results.push({
      id: rule.id,
      template: rule.template,
      objectType,
      mandatory,
      status,
      witness_event_ids: status === "SATISFIED_VACUOUS" ? [] : [...witnessSet],
      counterexample_event_ids: [...counterSet],
      activations: totalActivations,
      evaluatedTraces: traces.size,
      witnessedTraces,
      vacuousTraces,
      violatedTraces,
      antiVacuityPassed,
      article: rule.article,
      detail:
        status === "VIOLATED"
          ? `Rule ${rule.id} (${rule.template}) violated in ${violatedTraces}/${traces.size} "${objectType}" trace(s).`
          : status === "SATISFIED_WITNESSED"
            ? `Rule ${rule.id} (${rule.template}) witnessed in ${witnessedTraces}/${traces.size} "${objectType}" trace(s).`
            : `Rule ${rule.id} (${rule.template}) vacuously satisfied across ${traces.size} "${objectType}" trace(s) (0 activations).`
    });
  }

  const witnessedCount = results.filter((r) => r.status === "SATISFIED_WITNESSED").length;
  const vacuousCount = results.filter((r) => r.status === "SATISFIED_VACUOUS").length;
  const violatedCount = results.filter((r) => r.status === "VIOLATED").length;
  const allMandatorySatisfied = results.every((r) => !r.mandatory || r.status !== "VIOLATED");

  return {
    schema: "zcode.declare-report/1",
    results,
    declareResults: results,
    allMandatorySatisfied,
    witnessedCount,
    vacuousCount,
    violatedCount
  };
}
