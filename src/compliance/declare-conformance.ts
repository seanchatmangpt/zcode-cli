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
  | "AlternatePrecedence"
  | "ChainResponse"
  | "ChainPrecedence"
  | "NotCoExistence";

export type DeclareStatus = "SATISFIED_WITNESSED" | "SATISFIED_VACUOUS" | "VIOLATED";

export interface DeclareDataCondition {
  attribute: string;
  equals?: string;
  notEquals?: string;
  in?: readonly string[];
  exists?: boolean;
}

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
  /** MP-Declare data guard on the activation event (or its linked objects). */
  activationCondition?: DeclareDataCondition;
  /** MP-Declare data guard on the target/prerequisite event (or its linked objects). */
  targetCondition?: DeclareDataCondition;
  /** MP-Declare correlation key (attribute name or OCEL object type / qualifier, e.g. "tool_call"). */
  correlationKey?: string;
  /** Optional minimum elapsed time in milliseconds between the earlier and later event (inclusive). */
  minTimeDeltaMs?: number;
  /** Optional maximum elapsed time in milliseconds between the earlier and later event (inclusive). */
  maxTimeDeltaMs?: number;
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
  antiVacuityRequired: boolean;
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
  /** @deprecated Use `results`. Non-enumerable compatibility alias for existing consumers. */
  readonly declareResults: DeclareEvaluationResult[];
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
    template: "AlternatePrecedence",
    activation: "tool_updated",
    target: "permission_resolved",
    correlationKey: "tool_call",
    objectType: "turn",
    mandatory: true,
    article: "Art. 14",
    description: "Human/policy permission resolution must alternate-precede each tool execution within a turn (correlated by tool_call when present).",
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

interface EvalMemo {
  eventAttrMaps: WeakMap<Ocel2EventLike, Map<string, string>>;
  objectAttrMaps: WeakMap<Ocel2ObjectLike, Map<string, string>>;
  eventSecretCache: WeakMap<Ocel2EventLike, boolean>;
  eventTimeMs: WeakMap<Ocel2EventLike, number>;
}

function createEvalMemo(): EvalMemo {
  return {
    eventAttrMaps: new WeakMap(),
    objectAttrMaps: new WeakMap(),
    eventSecretCache: new WeakMap(),
    eventTimeMs: new WeakMap()
  };
}

function normalizeAttrMap(
  attrs: readonly Ocel2AttributeLike[] | readonly unknown[] | Record<string, unknown> | undefined
): Map<string, string> {
  const map = new Map<string, string>();
  if (!attrs) return map;
  if (Array.isArray(attrs)) {
    for (const item of attrs) {
      if (item && typeof item === "object" && "name" in item) {
        const entry = item as Ocel2AttributeLike;
        map.set(String(entry.name), entry.value === undefined || entry.value === null ? "" : String(entry.value));
      }
    }
    return map;
  }
  for (const [name, value] of Object.entries(attrs)) {
    map.set(name, value === undefined || value === null ? "" : String(value));
  }
  return map;
}

function getEventAttrMap(event: Ocel2EventLike, memo?: EvalMemo): Map<string, string> {
  if (!memo) return normalizeAttrMap(event.attributes);
  let map = memo.eventAttrMaps.get(event);
  if (!map) {
    map = normalizeAttrMap(event.attributes);
    memo.eventAttrMaps.set(event, map);
  }
  return map;
}

function getObjectAttrMap(obj: Ocel2ObjectLike, memo?: EvalMemo): Map<string, string> {
  if (!memo) return normalizeAttrMap(obj.attributes);
  let map = memo.objectAttrMaps.get(obj);
  if (!map) {
    map = normalizeAttrMap(obj.attributes);
    memo.objectAttrMaps.set(obj, map);
  }
  return map;
}

function getEventTimeMs(event: Ocel2EventLike, memo?: EvalMemo): number {
  if (memo) {
    const cached = memo.eventTimeMs.get(event);
    if (cached !== undefined) return cached;
  }
  const parsed = Date.parse(event.time);
  const ms = Number.isFinite(parsed) ? parsed : 0;
  memo?.eventTimeMs.set(event, ms);
  return ms;
}

function isHighRiskProfileValue(val: string | undefined): boolean {
  return val !== undefined && HIGH_RISK_PROFILES.has(val.trim());
}

const RAW_API_KEY_VALUE_RE =
  /\b(?:sk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{16,}|gh[pou]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{22,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/;

function eventHasUnredactedSecret(event: Ocel2EventLike, memo?: EvalMemo): boolean {
  if (memo) {
    const cached = memo.eventSecretCache.get(event);
    if (cached !== undefined) return cached;
  }
  const attrMap = getEventAttrMap(event, memo);
  const obj: Record<string, string> = {};
  let hasAny = false;
  for (const [name, value] of attrMap) {
    if (name.startsWith("pi_") || name === "prompt_sha256" || name === "sha256") continue;
    hasAny = true;
    if (RAW_API_KEY_VALUE_RE.test(value)) {
      memo?.eventSecretCache.set(event, true);
      return true;
    }
    obj[name] = value;
  }
  const result = hasAny ? containsUnredactedSecretsOrPii(JSON.stringify(obj), { redactPii: false }) : false;
  memo?.eventSecretCache.set(event, result);
  return result;
}

function matchesDataCondition(
  event: Ocel2EventLike,
  cond: DeclareDataCondition | undefined,
  objectById: ReadonlyMap<string, Ocel2ObjectLike>,
  memo?: EvalMemo
): boolean {
  if (!cond) return true;
  const evAttrs = getEventAttrMap(event, memo);
  let val = evAttrs.get(cond.attribute);
  if (val === undefined) {
    for (const rel of event.relationships ?? []) {
      const obj = objectById.get(rel.objectId);
      if (!obj) continue;
      const objVal = getObjectAttrMap(obj, memo).get(cond.attribute);
      if (objVal !== undefined) {
        val = objVal;
        break;
      }
    }
  }
  if (cond.exists !== undefined) {
    const present = val !== undefined && val !== "";
    if (present !== cond.exists) return false;
  }
  if (cond.equals !== undefined && val !== cond.equals) return false;
  if (cond.notEquals !== undefined && val === cond.notEquals) return false;
  if (cond.in !== undefined && (val === undefined || !cond.in.includes(val))) return false;
  return true;
}

function extractCorrelationValue(
  event: Ocel2EventLike,
  correlationKey: string,
  objectById: ReadonlyMap<string, Ocel2ObjectLike>,
  memo?: EvalMemo
): string {
  const evAttrs = getEventAttrMap(event, memo);
  const attrVal = evAttrs.get(correlationKey);
  if (attrVal !== undefined && attrVal !== "") return attrVal;
  for (const rel of event.relationships ?? []) {
    const obj = objectById.get(rel.objectId);
    const inferredType = obj?.type ?? QUALIFIER_TO_OBJECT_TYPE[rel.qualifier];
    if (inferredType === correlationKey || rel.qualifier === correlationKey) {
      return rel.objectId;
    }
  }
  return "";
}

function withinTimeWindow(
  earlier: Ocel2EventLike,
  later: Ocel2EventLike,
  rule: DeclareRule,
  memo?: EvalMemo
): boolean {
  if (rule.minTimeDeltaMs === undefined && rule.maxTimeDeltaMs === undefined) return true;
  const delta = getEventTimeMs(later, memo) - getEventTimeMs(earlier, memo);
  if (rule.minTimeDeltaMs !== undefined && delta < rule.minTimeDeltaMs) return false;
  if (rule.maxTimeDeltaMs !== undefined && delta > rule.maxTimeDeltaMs) return false;
  return true;
}

function matchesSubPattern(
  event: Ocel2EventLike,
  sub: string,
  objectById: ReadonlyMap<string, Ocel2ObjectLike>,
  memo?: EvalMemo
): boolean {
  const pat = sub.trim();
  if (!pat) return false;
  if (event.type === pat) return true;

  if (pat === "unredacted_secret" || pat === "unredacted_secret_detected") {
    return eventHasUnredactedSecret(event, memo);
  }

  if (pat === "high_risk_profile_active" || pat === "high_risk_profile") {
    const evAttrs = getEventAttrMap(event, memo);
    const evProfile = evAttrs.get("compliance_profile") ?? evAttrs.get("profile");
    if (isHighRiskProfileValue(evProfile)) return true;
    for (const rel of event.relationships ?? []) {
      const obj = objectById.get(rel.objectId);
      if (!obj) continue;
      const objAttrs = getObjectAttrMap(obj, memo);
      const objProfile = objAttrs.get("compliance_profile") ?? objAttrs.get("profile");
      if (isHighRiskProfileValue(objProfile) && (obj.type === "session" || event.type === "session_created")) {
        return true;
      }
    }
    return false;
  }

  if (pat === "mode_yolo_enabled" || pat === "yolo_bypass_enabled" || pat === "mode_yolo") {
    const evAttrs = getEventAttrMap(event, memo);
    const mode = evAttrs.get("mode");
    const permMode = evAttrs.get("permission_mode");
    const allowYolo = evAttrs.get("allow_yolo");
    return (
      mode === "yolo" ||
      permMode === "bypassPermissions" ||
      permMode === "yolo" ||
      allowYolo === "true"
    );
  }

  if (pat === "tool_updated_high_risk") {
    if (event.type !== "tool_updated") return false;
    const evAttrs = getEventAttrMap(event, memo);
    const risk = evAttrs.get("risk_level");
    if (risk === "high" || risk === "critical") return true;
    const toolName = evAttrs.get("tool_name");
    if (toolName && HIGH_RISK_TOOL_NAMES.has(toolName)) return true;
    for (const rel of event.relationships ?? []) {
      const obj = objectById.get(rel.objectId);
      if (!obj || obj.type !== "tool_call") continue;
      const objAttrs = getObjectAttrMap(obj, memo);
      const objRisk = objAttrs.get("risk_level");
      if (objRisk === "high" || objRisk === "critical") return true;
      const objTool = objAttrs.get("tool_name");
      if (objTool && HIGH_RISK_TOOL_NAMES.has(objTool)) return true;
    }
    return false;
  }

  return false;
}

export function matchesDeclarePredicate(
  event: Ocel2EventLike,
  pattern: string | undefined,
  objectById: ReadonlyMap<string, Ocel2ObjectLike>,
  memo?: EvalMemo
): boolean {
  if (!pattern || !pattern.trim()) return false;
  return pattern.split("|").some((part) => matchesSubPattern(event, part, objectById, memo));
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
  objectById: ReadonlyMap<string, Ocel2ObjectLike>,
  memo: EvalMemo
): TraceOutcome {
  const matchAct = (ev: Ocel2EventLike, pat: string | undefined) =>
    matchesDeclarePredicate(ev, pat, objectById, memo) &&
    matchesDataCondition(ev, rule.activationCondition, objectById, memo);
  const matchTgt = (ev: Ocel2EventLike, pat: string | undefined) =>
    matchesDeclarePredicate(ev, pat, objectById, memo) &&
    matchesDataCondition(ev, rule.targetCondition, objectById, memo);
  const corrKey = (ev: Ocel2EventLike) =>
    rule.correlationKey ? extractCorrelationValue(ev, rule.correlationKey, objectById, memo) : "";

  switch (rule.template) {
    case "Init": {
      const act = rule.activity ?? rule.activation;
      if (trace.length === 0) {
        return { status: "SATISFIED_VACUOUS", witnessIds: [], counterexampleIds: [], activations: 0 };
      }
      const first = trace[0]!;
      if (matchAct(first, act)) {
        return { status: "SATISFIED_WITNESSED", witnessIds: [first.id], counterexampleIds: [], activations: 1 };
      }
      return { status: "VIOLATED", witnessIds: [], counterexampleIds: [first.id], activations: 1 };
    }

    case "Existence": {
      const act = rule.activity ?? rule.activation;
      const minCount = rule.minCount ?? 1;
      const matches = trace.filter((e) => matchAct(e, act));
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
      const matches = trace.filter((e) => matchAct(e, act));
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

      // Single O(T) backward pass tracking nearest following target (per correlation key when set)
      const nearestTargetByKey = new Map<string, Ocel2EventLike>();
      const targetListByKey = rule.minTimeDeltaMs !== undefined ? new Map<string, Ocel2EventLike[]>() : undefined;

      for (let i = trace.length - 1; i >= 0; i--) {
        const ev = trace[i]!;
        const isAct = matchAct(ev, actPat);
        if (isAct) {
          activations += 1;
          const key = corrKey(ev);
          let foundTarget: Ocel2EventLike | undefined;
          if (targetListByKey) {
            const list = targetListByKey.get(key);
            if (list) {
              // list is in reverse chronological order; scan from end (earliest after ev)
              for (let k = list.length - 1; k >= 0; k--) {
                const cand = list[k]!;
                if (withinTimeWindow(ev, cand, rule, memo)) {
                  foundTarget = cand;
                  break;
                }
              }
            }
          } else {
            const cand = nearestTargetByKey.get(key);
            if (cand && withinTimeWindow(ev, cand, rule, memo)) {
              foundTarget = cand;
            }
          }
          if (foundTarget) {
            witnessIds.push(ev.id, foundTarget.id);
          } else {
            counterexampleIds.push(ev.id);
          }
        }
        if (matchTgt(ev, tgtPat)) {
          const key = corrKey(ev);
          nearestTargetByKey.set(key, ev);
          if (targetListByKey) {
            let list = targetListByKey.get(key);
            if (!list) {
              list = [];
              targetListByKey.set(key, list);
            }
            list.push(ev);
          }
        }
      }

      if (counterexampleIds.length > 0) {
        counterexampleIds.reverse();
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
      const latestPreByKey = new Map<string, Ocel2EventLike>();

      for (const ev of trace) {
        if (matchTgt(ev, prePat)) {
          latestPreByKey.set(corrKey(ev), ev);
        }
        if (matchAct(ev, actPat)) {
          activations += 1;
          const pre = latestPreByKey.get(corrKey(ev));
          if (pre && withinTimeWindow(pre, ev, rule, memo)) {
            witnessIds.push(pre.id, ev.id);
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

    case "AlternatePrecedence": {
      // Every activation must be preceded by a fresh prerequisite (no two activations without an intervening prerequisite)
      const actPat = rule.activation ?? rule.activity;
      const prePat = rule.target;
      const witnessIds: string[] = [];
      const counterexampleIds: string[] = [];
      let activations = 0;
      const availablePreByKey = new Map<string, Ocel2EventLike>();

      for (const ev of trace) {
        const isPre = matchTgt(ev, prePat);
        const isAct = matchAct(ev, actPat);
        if (isAct) {
          activations += 1;
          const key = corrKey(ev);
          const pre = availablePreByKey.get(key);
          if (pre && withinTimeWindow(pre, ev, rule, memo)) {
            witnessIds.push(pre.id, ev.id);
            availablePreByKey.delete(key);
          } else {
            counterexampleIds.push(ev.id);
          }
        }
        if (isPre) {
          availablePreByKey.set(corrKey(ev), ev);
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
        if (!matchAct(ev, actPat)) continue;
        activations += 1;
        const next = trace[i + 1];
        if (
          next &&
          matchTgt(next, tgtPat) &&
          corrKey(ev) === corrKey(next) &&
          withinTimeWindow(ev, next, rule, memo)
        ) {
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

    case "ChainPrecedence": {
      // Every activation must be immediately preceded by a matching prerequisite at trace[i - 1]
      const actPat = rule.activation ?? rule.activity;
      const prePat = rule.target;
      const witnessIds: string[] = [];
      const counterexampleIds: string[] = [];
      let activations = 0;

      for (let i = 0; i < trace.length; i++) {
        const ev = trace[i]!;
        if (!matchAct(ev, actPat)) continue;
        activations += 1;
        const prev = i > 0 ? trace[i - 1] : undefined;
        if (
          prev &&
          matchTgt(prev, prePat) &&
          corrKey(prev) === corrKey(ev) &&
          withinTimeWindow(prev, ev, rule, memo)
        ) {
          witnessIds.push(prev.id, ev.id);
        } else {
          counterexampleIds.push(ev.id);
          if (prev) counterexampleIds.push(prev.id);
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
      const aEvents = trace.filter((e) => matchAct(e, actPat));
      const bEvents = trace.filter((e) => matchTgt(e, tgtPat));

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

  const memo = createEvalMemo();
  const objectById = new Map<string, Ocel2ObjectLike>();
  for (const obj of doc.objects ?? []) {
    objectById.set(obj.id, obj);
  }

  const sortedEvents = [...(doc.events ?? [])]
    .map((ev, idx) => {
      const ms = getEventTimeMs(ev, memo);
      return { ev, idx, ms };
    })
    .sort((a, b) => (a.ms !== b.ms ? a.ms - b.ms : a.idx - b.idx))
    .map((x) => x.ev);

  const tracesByObjectType = new Map<string, Map<string, Ocel2EventLike[]>>();
  const results: DeclareEvaluationResult[] = [];

  for (const rule of rules) {
    const objectType = rule.objectType ?? "session";
    const mandatory = rule.mandatory ?? true;
    const antiVacuityRequired = rule.antiVacuityRequired ?? false;

    let traces = tracesByObjectType.get(objectType);
    if (!traces) {
      traces = buildTracesByObjectType(doc, objectType, objectById, sortedEvents);
      tracesByObjectType.set(objectType, traces);
    }

    if (traces.size === 0) {
      results.push({
        id: rule.id,
        template: rule.template,
        objectType,
        mandatory,
        antiVacuityRequired,
        status: "SATISFIED_VACUOUS",
        witness_event_ids: [],
        counterexample_event_ids: [],
        activations: 0,
        evaluatedTraces: 0,
        witnessedTraces: 0,
        vacuousTraces: 0,
        violatedTraces: 0,
        antiVacuityPassed: false,
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
      const res = evaluateTraceForRule(traceEvents, rule, objectById, memo);
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
      antiVacuityRequired,
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
  const allMandatorySatisfied = results.every(
    (r) => !r.mandatory || (r.status !== "VIOLATED" && (!r.antiVacuityRequired || r.antiVacuityPassed))
  );

  const report = {
    schema: "zcode.declare-report/1" as const,
    results,
    allMandatorySatisfied,
    witnessedCount,
    vacuousCount,
    violatedCount
  };
  Object.defineProperty(report, "declareResults", {
    get() {
      return results;
    },
    enumerable: false,
    configurable: true
  });
  return report as DeclareConformanceReport;
}
