import {
  EVENT_TYPES,
  OBJECT_TYPES,
  canon,
  hashHex,
  verifyChain,
  type OcelDoc
} from "../generated/ocel.ts";
import {
  ComplianceRefusalError,
  type ComplianceProfile,
  type ResolvedComplianceConfig
} from "./config.ts";
import {
  containsUnredactedSecretsOrPii,
  redactComplianceData,
  redactComplianceText,
  type RedactComplianceOptions
} from "./redactor.ts";

export type Ocel2AttributeType = "string" | "integer" | "float" | "boolean" | "time";

export interface Ocel2AttributeSchema {
  name: string;
  type: Ocel2AttributeType | string;
}

export interface Ocel2TypeSchema {
  name: string;
  attributes: Ocel2AttributeSchema[];
}

export interface Ocel2Relationship {
  objectId: string;
  qualifier: string;
}

export interface Ocel2ObjectAttribute {
  name: string;
  time: string;
  value: string;
}

export interface Ocel2Object {
  id: string;
  type: string;
  attributes: Ocel2ObjectAttribute[];
  relationships: Ocel2Relationship[];
}

export interface Ocel2EventAttribute {
  name: string;
  value: string;
}

export interface Ocel2Event {
  id: string;
  type: string;
  time: string;
  attributes: Ocel2EventAttribute[];
  relationships: Ocel2Relationship[];
}

export interface Ocel2Document {
  objectTypes: Ocel2TypeSchema[];
  eventTypes: Ocel2TypeSchema[];
  objects: Ocel2Object[];
  events: Ocel2Event[];
}

export const COMPLIANCE_O2O_QUALIFIERS = [
  "in_session",
  "in_turn",
  "uses_provider",
  "spawned_by",
  "governs",
  "mutated_in",
  "seals"
] as const;

export type ComplianceO2OQualifier = (typeof COMPLIANCE_O2O_QUALIFIERS)[number];

export interface CanonicalO2OEdgeSpec {
  fromType: string;
  qualifier: ComplianceO2OQualifier;
  toType: string;
}

export const CANONICAL_O2O_EDGES: readonly CanonicalO2OEdgeSpec[] = [
  { fromType: "turn", qualifier: "in_session", toType: "session" },
  { fromType: "tool_call", qualifier: "in_turn", toType: "turn" },
  { fromType: "model_request", qualifier: "in_turn", toType: "turn" },
  { fromType: "model_request", qualifier: "uses_provider", toType: "provider" },
  { fromType: "subagent", qualifier: "spawned_by", toType: "session" },
  { fromType: "permission", qualifier: "governs", toType: "tool_call" },
  { fromType: "workspace_file", qualifier: "mutated_in", toType: "turn" },
  { fromType: "receipt", qualifier: "seals", toType: "session" }
] as const;

export const EU_AI_ACT_OBJECT_TYPES = [
  "workspace_file",
  "human_overseer",
  "ai_model",
  "disclosure",
  "incident",
  "compliance_profile",
  "oversight_decision",
  "disclosure_notice",
  "provenance_artifact",
  "workspace_snapshot",
  "risk_assessment",
  "incident_packet"
] as const;

export const EU_AI_ACT_EVENT_TYPES = [
  "art50_disclosure_emitted",
  "provenance_marked",
  "oversight_intervened",
  "oversight_policy_refused",
  "policy_refused",
  "workspace_rolled_back",
  "retry_budget_exhausted",
  "drift_detected",
  "incident_classified",
  "incident_reported",
  "compliance_assessed",
  "model_request_completed"
] as const;

export const POWL_OBJECT_TYPES = ["Workflow", "Artifact"] as const;
export const POWL_EVENT_TYPES = [
  "transition_fired",
  "transition_completed",
  "transition_refused",
  "wip_backoff"
] as const;

const DEFAULT_OBJECT_ATTR_SCHEMAS: Readonly<Record<string, Ocel2AttributeSchema[]>> = {
  session: [
    { name: "compliance_profile", type: "string" },
    { name: "zcode_cli_version", type: "string" },
    { name: "runtime_version", type: "string" },
    { name: "git_head_sha", type: "string" }
  ],
  turn: [{ name: "standing", type: "string" }],
  tool_call: [
    { name: "tool_name", type: "string" },
    { name: "risk_level", type: "string" }
  ],
  model_request: [
    { name: "provider_id", type: "string" },
    { name: "model_id", type: "string" },
    { name: "ttft_ms", type: "string" },
    { name: "service_ms", type: "string" }
  ],
  provider: [{ name: "provider_id", type: "string" }],
  permission: [
    { name: "decision", type: "string" },
    { name: "decision_latency_ms", type: "string" },
    { name: "overseer_id", type: "string" }
  ],
  subagent: [
    { name: "agent_id", type: "string" },
    { name: "compliance_profile", type: "string" },
    { name: "policy_ceiling", type: "string" },
    { name: "allow_yolo", type: "string" },
    { name: "overseer_id", type: "string" }
  ],
  receipt: [{ name: "standing", type: "string" }],
  workspace_file: [
    { name: "path", type: "string" },
    { name: "sha256", type: "string" }
  ],
  human_overseer: [
    { name: "overseer_id", type: "string" },
    { name: "role", type: "string" }
  ],
  ai_model: [
    { name: "model_id", type: "string" },
    { name: "provider_id", type: "string" }
  ],
  disclosure: [
    { name: "article", type: "string" },
    { name: "provider_id", type: "string" },
    { name: "model_id", type: "string" }
  ],
  disclosure_notice: [
    { name: "article", type: "string" },
    { name: "provider", type: "string" },
    { name: "model", type: "string" },
    { name: "compliance_profile", type: "string" },
    { name: "notice_sha256", type: "string" }
  ],
  compliance_profile: [{ name: "profile", type: "string" }],
  oversight_decision: [
    { name: "decision", type: "string" },
    { name: "overseer_id", type: "string" }
  ],
  provenance_artifact: [
    { name: "sidecar_path", type: "string" },
    { name: "seal_sha256", type: "string" }
  ],
  workspace_snapshot: [{ name: "head_sha", type: "string" }],
  risk_assessment: [{ name: "residual_risk_score", type: "string" }],
  incident: [
    { name: "severity", type: "string" },
    { name: "deadline", type: "string" }
  ],
  incident_packet: [
    { name: "severity", type: "string" },
    { name: "deadline", type: "string" }
  ],
  Workflow: [{ name: "standing", type: "string" }],
  Artifact: [{ name: "standing", type: "string" }]
};

const DEFAULT_EVENT_ATTR_SCHEMAS: Readonly<Record<string, Ocel2AttributeSchema[]>> = {
  art50_disclosure_emitted: [
    { name: "channel", type: "string" },
    { name: "regulation", type: "string" },
    { name: "provider_id", type: "string" },
    { name: "model_id", type: "string" }
  ],
  provenance_marked: [
    { name: "sidecar_path", type: "string" },
    { name: "seal_sha256", type: "string" }
  ],
  oversight_intervened: [
    { name: "overseer_id", type: "string" },
    { name: "reason", type: "string" }
  ],
  oversight_policy_refused: [
    { name: "code", type: "string" },
    { name: "reason", type: "string" }
  ],
  policy_refused: [
    { name: "code", type: "string" },
    { name: "reason", type: "string" }
  ],
  workspace_rolled_back: [{ name: "reason", type: "string" }],
  retry_budget_exhausted: [
    { name: "error_signature", type: "string" },
    { name: "attempts", type: "string" }
  ],
  drift_detected: [
    { name: "drift_kind", type: "string" },
    { name: "p_value", type: "string" }
  ],
  incident_classified: [
    { name: "severity", type: "string" },
    { name: "deadline", type: "string" }
  ],
  incident_reported: [
    { name: "severity", type: "string" },
    { name: "deadline", type: "string" }
  ],
  compliance_assessed: [{ name: "verdict", type: "string" }],
  model_request_completed: [
    { name: "provider_id", type: "string" },
    { name: "model_id", type: "string" },
    { name: "ttft_ms", type: "string" },
    { name: "service_ms", type: "string" },
    { name: "status", type: "string" }
  ],
  transition_fired: [
    { name: "transition", type: "string" },
    { name: "label", type: "string" }
  ],
  transition_completed: [
    { name: "transition", type: "string" },
    { name: "service_ms", type: "string" }
  ],
  transition_refused: [
    { name: "transition", type: "string" },
    { name: "detail", type: "string" }
  ],
  wip_backoff: [
    { name: "transition", type: "string" },
    { name: "old_wip", type: "string" },
    { name: "new_wip", type: "string" },
    { name: "reason", type: "string" }
  ]
};

function dedupeStrings(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

export const COMPLIANCE_OBJECT_TYPES: readonly Ocel2TypeSchema[] = dedupeStrings([
  ...OBJECT_TYPES,
  ...EU_AI_ACT_OBJECT_TYPES,
  ...POWL_OBJECT_TYPES
]).map((name) => ({
  name,
  attributes: [...(DEFAULT_OBJECT_ATTR_SCHEMAS[name] ?? [])]
}));

export const COMPLIANCE_EVENT_TYPES: readonly Ocel2TypeSchema[] = dedupeStrings([
  ...EVENT_TYPES,
  ...EU_AI_ACT_EVENT_TYPES,
  ...POWL_EVENT_TYPES
]).map((name) => ({
  name,
  attributes: [...(DEFAULT_EVENT_ATTR_SCHEMAS[name] ?? [])]
}));

const KNOWN_OBJECT_TYPE_SET = new Set(COMPLIANCE_OBJECT_TYPES.map((t) => t.name));
const KNOWN_EVENT_TYPE_SET = new Set(COMPLIANCE_EVENT_TYPES.map((t) => t.name));

const PI_ATTR_NAMES = new Set([
  "pi_parent",
  "pi_hash",
  "pi_hash_alg",
  "pi_attr_sha256",
  "pi_obj_sha256",
  "pi_phase",
  "pi_pending_ref"
]);

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

const CANONICAL_O2O_TYPE_CONSTRAINTS: Readonly<
  Record<ComplianceO2OQualifier, { fromTypes?: ReadonlySet<string>; toTypes?: ReadonlySet<string>; pairs?: ReadonlySet<string> }>
> = {
  in_session: { toTypes: new Set(["session"]) },
  in_turn: { toTypes: new Set(["turn"]) },
  uses_provider: {
    fromTypes: new Set(["model_request"]),
    toTypes: new Set(["provider", "turn"])
  },
  spawned_by: {
    fromTypes: new Set(["subagent"]),
    toTypes: new Set(["session", "subagent"])
  },
  governs: {
    pairs: new Set([
      "permission->tool_call",
      "human_overseer->session",
      "human_overseer->tool_call",
      "compliance_profile->session",
      "subagent->human_overseer",
      "session->human_overseer"
    ])
  },
  mutated_in: {
    pairs: new Set([
      "workspace_file->turn",
      "tool_call->workspace_file"
    ])
  },
  seals: {
    fromTypes: new Set(["receipt", "provenance_artifact"]),
    toTypes: new Set(["session"])
  }
};

function isCanonicalO2OTypeAllowed(fromType: string, qualifier: string, toType: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(CANONICAL_O2O_TYPE_CONSTRAINTS, qualifier)) {
    return true;
  }
  const spec = CANONICAL_O2O_TYPE_CONSTRAINTS[qualifier as ComplianceO2OQualifier];
  if (spec.pairs) {
    return spec.pairs.has(`${fromType}->${toType}`);
  }
  if (spec.fromTypes && !spec.fromTypes.has(fromType)) return false;
  if (spec.toTypes && !spec.toTypes.has(toType)) return false;
  return true;
}

const ISO_TIMESTAMP_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function isValidIsoTimestamp(value: string): boolean {
  if (typeof value !== "string" || !ISO_TIMESTAMP_RE.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

export function normalizeIsoTimestamp(time?: string | number): string {
  if (time === undefined) return new Date().toISOString();
  if (typeof time === "number") {
    if (!Number.isFinite(time)) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Invalid numeric timestamp: ${String(time)}`,
        "mu_on_O"
      );
    }
    return new Date(time).toISOString();
  }
  if (!isValidIsoTimestamp(time)) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Invalid ISO-8601 timestamp '${time}'`,
      "mu_on_O"
    );
  }
  return time;
}

export function deriveRedactOptions(
  config?: ResolvedComplianceConfig,
  override?: RedactComplianceOptions
): RedactComplianceOptions {
  return {
    redactPii: override?.redactPii ?? config?.compliance.redact_pii ?? true,
    redactEnv: override?.redactEnv ?? config?.compliance.redact_env,
    env: override?.env,
    envSecrets: override?.envSecrets,
    extraPatterns: override?.extraPatterns,
    replacement: override?.replacement
  };
}

export function redactForComplianceChain<T>(
  value: T,
  options?: RedactComplianceOptions
): T {
  const redacted = redactComplianceData(value, options);
  const serialized = JSON.stringify(redacted);
  if (serialized !== undefined && containsUnredactedSecretsOrPii(serialized, options)) {
    throw new ComplianceRefusalError(
      "REDACTION_FAILURE",
      "Unredacted secrets or PII remained after redaction.",
      "R_missing_consequence"
    );
  }
  return redacted;
}

function redactIdentifier(id: string, options: RedactComplianceOptions): string {
  const redacted = redactComplianceText(id, options);
  if (containsUnredactedSecretsOrPii(redacted, options)) {
    throw new ComplianceRefusalError(
      "REDACTION_FAILURE",
      `Unredacted secret or PII remained in identifier '${redacted}'.`,
      "R_missing_consequence"
    );
  }
  return redacted;
}

function redactKeyValuePair(
  key: string,
  value: string,
  options: RedactComplianceOptions
): string {
  const holder = Object.create(null) as Record<string, string>;
  Object.defineProperty(holder, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true
  });
  const redacted = redactForComplianceChain(holder, options);
  const desc = Object.getOwnPropertyDescriptor(redacted, key);
  if (desc && Object.prototype.hasOwnProperty.call(redacted, key)) {
    return String(desc.value ?? "");
  }
  return redactIdentifier(value, options);
}

export function computePiAttrSha256(attributes: readonly Ocel2EventAttribute[]): string {
  const nonPi = attributes
    .filter((a) => !PI_ATTR_NAMES.has(a.name))
    .map((a) => [a.name, a.value] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return hashHex("sha256", JSON.stringify(nonPi));
}

export function computeObjectsSha256(objects: readonly Ocel2Object[]): string {
  const canonical = [...objects]
    .map((obj) => ({
      id: obj.id,
      type: obj.type,
      attributes: [...obj.attributes]
        .map((a) => [a.name, a.time, a.value] as const)
        .sort((a, b) =>
          a[0] !== b[0]
            ? a[0] < b[0]
              ? -1
              : 1
            : a[1] !== b[1]
              ? a[1] < b[1]
                ? -1
                : 1
              : a[2] < b[2]
                ? -1
                : a[2] > b[2]
                  ? 1
                  : 0
        ),
      relationships: [...obj.relationships]
        .map((r) => [r.qualifier, r.objectId] as const)
        .sort((a, b) =>
          a[0] !== b[0]
            ? a[0] < b[0]
              ? -1
              : 1
            : a[1] < b[1]
              ? -1
              : a[1] > b[1]
                ? 1
                : 0
        )
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hashHex("sha256", JSON.stringify(canonical));
}

function cloneTypeSchemas(list: readonly Ocel2TypeSchema[]): Ocel2TypeSchema[] {
  return list.map((t) => ({
    name: t.name,
    attributes: t.attributes.map((a) => ({ name: a.name, type: a.type }))
  }));
}

function mergeTypeSchema(
  map: Map<string, Ocel2TypeSchema>,
  schema: Ocel2TypeSchema
): void {
  const existing = map.get(schema.name);
  if (!existing) {
    map.set(schema.name, {
      name: schema.name,
      attributes: schema.attributes.map((a) => ({ name: a.name, type: a.type }))
    });
    return;
  }
  const attrMap = new Map(existing.attributes.map((a) => [a.name, a]));
  for (const attr of schema.attributes) {
    if (!attrMap.has(attr.name)) {
      const copy = { name: attr.name, type: attr.type };
      attrMap.set(attr.name, copy);
      existing.attributes.push(copy);
    }
  }
}

export interface Ocel2BuilderOptions {
  redactOptions?: RedactComplianceOptions;
  config?: ResolvedComplianceConfig;
  includeBaseTypes?: boolean;
  allowCustomTypes?: boolean;
}

export interface Ocel2RecordEventInput {
  id: string;
  type: string;
  time?: string | number;
  attributes?: Record<string, string | number | boolean> | readonly Ocel2EventAttribute[];
  relationships?: readonly Ocel2Relationship[];
  phase?: string;
  pendingRef?: string;
}

export interface Ocel2SealResult {
  doc: Ocel2Document;
  headHash: string;
  sealedAt: string;
  subjectId?: string;
}

export class Ocel2ComplianceBuilder {
  private readonly redactOptions: RedactComplianceOptions;
  private readonly allowCustomTypes: boolean;
  private readonly objectTypes = new Map<string, Ocel2TypeSchema>();
  private readonly eventTypes = new Map<string, Ocel2TypeSchema>();
  private readonly objects = new Map<string, Ocel2Object>();
  private readonly lastAttrTime = new Map<string, number>();
  private readonly events: Ocel2Event[] = [];
  private lastHash = "";
  private objectsModifiedAfterLastEvent = false;

  constructor(options: Ocel2BuilderOptions = {}) {
    this.redactOptions = deriveRedactOptions(options.config, options.redactOptions);
    this.allowCustomTypes = options.allowCustomTypes ?? false;
    if (options.includeBaseTypes ?? true) {
      for (const schema of COMPLIANCE_OBJECT_TYPES) mergeTypeSchema(this.objectTypes, schema);
      for (const schema of COMPLIANCE_EVENT_TYPES) mergeTypeSchema(this.eventTypes, schema);
    }
  }

  registerObjectType(def: Ocel2TypeSchema): this {
    if (!def.name || def.name.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "Object type name must be non-empty.",
        "mu_on_O"
      );
    }
    mergeTypeSchema(this.objectTypes, def);
    return this;
  }

  registerEventType(def: Ocel2TypeSchema): this {
    if (!def.name || def.name.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "Event type name must be non-empty.",
        "mu_on_O"
      );
    }
    mergeTypeSchema(this.eventTypes, def);
    return this;
  }

  private ensureObjectTypeRegistered(typeName: string): void {
    if (this.objectTypes.has(typeName)) return;
    const known = COMPLIANCE_OBJECT_TYPES.find((t) => t.name === typeName);
    if (known) {
      mergeTypeSchema(this.objectTypes, known);
      return;
    }
    if (this.allowCustomTypes) {
      mergeTypeSchema(this.objectTypes, { name: typeName, attributes: [] });
      return;
    }
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Undeclared OCEL 2.0 object type '${typeName}'.`,
      "mu_on_O"
    );
  }

  private ensureEventTypeRegistered(typeName: string): void {
    if (this.eventTypes.has(typeName)) return;
    const known = COMPLIANCE_EVENT_TYPES.find((t) => t.name === typeName);
    if (known) {
      mergeTypeSchema(this.eventTypes, known);
      return;
    }
    if (this.allowCustomTypes) {
      mergeTypeSchema(this.eventTypes, { name: typeName, attributes: [] });
      return;
    }
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Undeclared OCEL 2.0 event type '${typeName}'.`,
      "mu_on_O"
    );
  }

  upsertObject(
    id: string,
    type: string,
    initialAttributes?:
      | Record<string, string | number | boolean>
      | readonly Ocel2ObjectAttribute[],
    time?: string | number
  ): this {
    if (!id || id.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "OCEL 2.0 object id must be non-empty.",
        "R_missing_identity"
      );
    }
    this.ensureObjectTypeRegistered(type);
    const safeId = redactIdentifier(id, this.redactOptions);
    const existing = this.objects.get(safeId);
    if (!existing) {
      this.objects.set(safeId, {
        id: safeId,
        type,
        attributes: [],
        relationships: []
      });
    } else if (existing.type !== type) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Object '${safeId}' already registered as type '${existing.type}', cannot change to '${type}'.`,
        "mu_on_O"
      );
    }
    this.objectsModifiedAfterLastEvent = true;

    if (initialAttributes) {
      if (Array.isArray(initialAttributes)) {
        for (const attr of initialAttributes) {
          this.setObjectAttribute(safeId, attr.name, attr.value, attr.time ?? time);
        }
      } else {
        for (const [k, v] of Object.entries(initialAttributes)) {
          this.setObjectAttribute(safeId, k, v, time);
        }
      }
    }
    return this;
  }

  setObjectAttribute(
    objectId: string,
    name: string,
    value: string | number | boolean,
    time?: string | number
  ): this {
    const safeId = redactIdentifier(objectId, this.redactOptions);
    const obj = this.objects.get(safeId);
    if (!obj) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Cannot set attribute '${name}' on unknown object '${safeId}'.`,
        "R_missing_identity"
      );
    }
    if (!name || name.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "Object attribute name must be non-empty.",
        "mu_on_O"
      );
    }

    const attrKey = `${safeId}\u0000${name}`;
    const prevMs = this.lastAttrTime.get(attrKey);
    let isoTime: string;
    if (time === undefined) {
      const nowMs = Date.now();
      const chosenMs = prevMs !== undefined && nowMs < prevMs ? prevMs : nowMs;
      isoTime = new Date(chosenMs).toISOString();
    } else {
      isoTime = normalizeIsoTimestamp(time);
      const parsedMs = Date.parse(isoTime);
      if (prevMs !== undefined && parsedMs < prevMs) {
        throw new ComplianceRefusalError(
          "INVALID_COMPLIANCE_CONFIG",
          `Non-monotonic timestamp for (${safeId}, ${name}): ${isoTime} < ${new Date(prevMs).toISOString()}.`,
          "mu_on_O"
        );
      }
    }
    const timeMs = Date.parse(isoTime);
    this.lastAttrTime.set(attrKey, timeMs);

    const safeValue = redactKeyValuePair(name, String(value), this.redactOptions);

    obj.attributes.push({
      name,
      time: isoTime,
      value: safeValue
    });
    this.objectsModifiedAfterLastEvent = true;

    const typeDef = this.objectTypes.get(obj.type);
    if (typeDef && !typeDef.attributes.some((a) => a.name === name)) {
      typeDef.attributes.push({ name, type: "string" });
    }
    return this;
  }

  addO2O(
    sourceObjectId: string,
    qualifier: string,
    targetObjectId: string
  ): this {
    if (!qualifier || qualifier.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "O2O relationship qualifier must be non-empty.",
        "mu_on_O"
      );
    }
    const safeQualifier = redactIdentifier(qualifier, this.redactOptions);
    if (!safeQualifier || safeQualifier.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "O2O relationship qualifier must be non-empty.",
        "mu_on_O"
      );
    }
    const safeSrc = redactIdentifier(sourceObjectId, this.redactOptions);
    const safeDst = redactIdentifier(targetObjectId, this.redactOptions);
    const src = this.objects.get(safeSrc);
    if (!src) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Unknown O2O source object '${safeSrc}'.`,
        "R_missing_identity"
      );
    }
    const dst = this.objects.get(safeDst);
    if (!dst) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Unknown O2O target object '${safeDst}'.`,
        "R_missing_identity"
      );
    }
    if (!isCanonicalO2OTypeAllowed(src.type, safeQualifier, dst.type)) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Invalid O2O edge '${src.type} -[${safeQualifier}]-> ${dst.type}'.`,
        "mu_on_O"
      );
    }
    if (!src.relationships.some((r) => r.objectId === safeDst && r.qualifier === safeQualifier)) {
      src.relationships.push({ objectId: safeDst, qualifier: safeQualifier });
      this.objectsModifiedAfterLastEvent = true;
    }
    return this;
  }

  private ensurePairAndLink(
    fromId: string,
    fromType: string,
    qualifier: ComplianceO2OQualifier,
    toId: string,
    toType: string
  ): this {
    const safeFrom = redactIdentifier(fromId, this.redactOptions);
    const safeTo = redactIdentifier(toId, this.redactOptions);
    if (!this.objects.has(safeFrom)) this.upsertObject(safeFrom, fromType);
    if (!this.objects.has(safeTo)) this.upsertObject(safeTo, toType);
    return this.addO2O(safeFrom, qualifier, safeTo);
  }

  linkTurnToSession(turnId: string, sessionId: string): this {
    return this.ensurePairAndLink(turnId, "turn", "in_session", sessionId, "session");
  }

  linkToolCallToTurn(toolCallId: string, turnId: string): this {
    return this.ensurePairAndLink(toolCallId, "tool_call", "in_turn", turnId, "turn");
  }

  linkModelRequestToTurn(requestId: string, turnId: string): this {
    return this.ensurePairAndLink(requestId, "model_request", "in_turn", turnId, "turn");
  }

  linkModelRequestToProvider(requestId: string, providerId: string): this {
    return this.ensurePairAndLink(requestId, "model_request", "uses_provider", providerId, "provider");
  }

  linkSubagentToSession(subagentId: string, sessionId: string): this {
    return this.ensurePairAndLink(subagentId, "subagent", "spawned_by", sessionId, "session");
  }

  linkPermissionToToolCall(permissionId: string, toolCallId: string): this {
    return this.ensurePairAndLink(permissionId, "permission", "governs", toolCallId, "tool_call");
  }

  linkFileMutatedInTurn(fileObjectId: string, turnId: string): this {
    return this.ensurePairAndLink(fileObjectId, "workspace_file", "mutated_in", turnId, "turn");
  }

  linkReceiptSealsSession(receiptId: string, sessionId: string): this {
    return this.ensurePairAndLink(receiptId, "receipt", "seals", sessionId, "session");
  }

  recordEvent(input: Ocel2RecordEventInput): Ocel2Event {
    if (!input.id || input.id.trim().length === 0) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        "OCEL 2.0 event id must be non-empty.",
        "R_missing_identity"
      );
    }
    this.ensureEventTypeRegistered(input.type);
    const safeId = redactIdentifier(input.id, this.redactOptions);
    if (this.events.some((e) => e.id === safeId)) {
      throw new ComplianceRefusalError(
        "INVALID_COMPLIANCE_CONFIG",
        `Duplicate OCEL 2.0 event id '${safeId}'.`,
        "mu_on_O"
      );
    }

    const isoTime = normalizeIsoTimestamp(input.time);
    const relationships: Ocel2Relationship[] = (input.relationships ?? []).map((r) => {
      if (!r.qualifier || r.qualifier.trim().length === 0) {
        throw new ComplianceRefusalError(
          "INVALID_COMPLIANCE_CONFIG",
          `Event '${safeId}' has unqualified E2O relationship.`,
          "mu_on_O"
        );
      }
      const safeQualifier = redactIdentifier(r.qualifier, this.redactOptions);
      if (!safeQualifier || safeQualifier.trim().length === 0) {
        throw new ComplianceRefusalError(
          "INVALID_COMPLIANCE_CONFIG",
          `Event '${safeId}' has unqualified E2O relationship.`,
          "mu_on_O"
        );
      }
      const safeTarget = redactIdentifier(r.objectId, this.redactOptions);
      if (!this.objects.has(safeTarget)) {
        throw new ComplianceRefusalError(
          "INVALID_COMPLIANCE_CONFIG",
          `Event '${safeId}' references unknown object '${safeTarget}'.`,
          "R_missing_identity"
        );
      }
      return { objectId: safeTarget, qualifier: safeQualifier };
    });

    const rawDomainPairs: Array<[string, string]> = [];
    let phase = input.phase ?? "";
    let pendingRef = input.pendingRef ?? "";
    if (input.attributes) {
      if (Array.isArray(input.attributes)) {
        for (const attr of input.attributes as readonly Ocel2EventAttribute[]) {
          if (attr.name === "pi_phase" && !phase) {
            phase = String(attr.value);
            continue;
          }
          if (attr.name === "pi_pending_ref" && !pendingRef) {
            pendingRef = String(attr.value);
            continue;
          }
          if (PI_ATTR_NAMES.has(attr.name)) continue;
          rawDomainPairs.push([attr.name, String(attr.value)]);
        }
      } else {
        for (const [k, v] of Object.entries(input.attributes)) {
          if (k === "pi_phase" && !phase) {
            phase = String(v);
            continue;
          }
          if (k === "pi_pending_ref" && !pendingRef) {
            pendingRef = String(v);
            continue;
          }
          if (PI_ATTR_NAMES.has(k)) continue;
          rawDomainPairs.push([k, String(v)]);
        }
      }
    }

    const domainAttrs: Ocel2EventAttribute[] = rawDomainPairs.map(([k, v]) => ({
      name: k,
      value: redactKeyValuePair(k, v, this.redactOptions)
    }));

    const eventTypeDef = this.eventTypes.get(input.type);
    if (eventTypeDef) {
      for (const a of domainAttrs) {
        if (!eventTypeDef.attributes.some((s) => s.name === a.name)) {
          eventTypeDef.attributes.push({ name: a.name, type: "string" });
        }
      }
    }

    const base = { id: safeId, type: input.type, time: isoTime, relationships };
    const parent = this.lastHash;
    const hash = hashHex("sha256", parent + "\n" + canon(base, phase, pendingRef));
    const attrSha256 = computePiAttrSha256(domainAttrs);
    const objSha256 = computeObjectsSha256([...this.objects.values()]);
    this.lastHash = hash;
    this.objectsModifiedAfterLastEvent = false;

    const piAttrs: Ocel2EventAttribute[] = [
      { name: "pi_parent", value: parent },
      { name: "pi_hash", value: hash },
      { name: "pi_hash_alg", value: "sha256" },
      { name: "pi_attr_sha256", value: attrSha256 },
      { name: "pi_obj_sha256", value: objSha256 }
    ];
    if (phase) piAttrs.push({ name: "pi_phase", value: phase });
    if (pendingRef) piAttrs.push({ name: "pi_pending_ref", value: pendingRef });

    const event: Ocel2Event = {
      ...base,
      attributes: [...piAttrs, ...domainAttrs]
    };
    this.events.push(event);
    return structuredClone(event);
  }

  headHash(): string {
    return this.lastHash;
  }

  build(): Ocel2Document {
    if (this.objectsModifiedAfterLastEvent && this.events.length > 0) {
      const latestObjSha = computeObjectsSha256([...this.objects.values()]);
      const lastEv = this.events[this.events.length - 1]!;
      const objAttr = lastEv.attributes.find((a) => a.name === "pi_obj_sha256");
      if (objAttr) {
        objAttr.value = latestObjSha;
      } else {
        lastEv.attributes.unshift({ name: "pi_obj_sha256", value: latestObjSha });
      }
      this.objectsModifiedAfterLastEvent = false;
    }
    return {
      objectTypes: cloneTypeSchemas([...this.objectTypes.values()]),
      eventTypes: cloneTypeSchemas([...this.eventTypes.values()]),
      objects: [...this.objects.values()].map((o) => ({
        id: o.id,
        type: o.type,
        attributes: o.attributes.map((a) => ({ ...a })),
        relationships: o.relationships.map((r) => ({ ...r }))
      })),
      events: this.events.map((e) => ({
        id: e.id,
        type: e.type,
        time: e.time,
        attributes: e.attributes.map((a) => ({ ...a })),
        relationships: e.relationships.map((r) => ({ ...r }))
      }))
    };
  }

  seal(subjectId?: string): Ocel2SealResult {
    return {
      doc: this.build(),
      headHash: this.lastHash,
      sealedAt: new Date().toISOString(),
      ...(subjectId ? { subjectId } : {})
    };
  }
}

export interface UpgradeLegacyOcelMeta {
  sessionId?: string;
  providerId?: string;
  modelId?: string;
  overseerId?: string;
  profile?: ComplianceProfile;
  extraO2O?: Array<{ sourceObjectId: string; qualifier: string; targetObjectId: string }>;
  redactOptions?: RedactComplianceOptions;
  config?: ResolvedComplianceConfig;
  rechain?: boolean;
}

export type LegacyOcelInput =
  | OcelDoc
  | Ocel2Document
  | {
      objectTypes: Array<{ name: string; attributes: Array<{ name: string; type: string } | unknown> }>;
      eventTypes: Array<{ name: string; attributes: Array<{ name: string; type: string } | unknown> }>;
      objects: Array<{
        id: string;
        type: string;
        attributes: Array<{ name: string; value: string; time?: string } | unknown>;
        relationships: Array<{ objectId: string; qualifier: string } | unknown>;
      }>;
      events: Array<{
        id: string;
        type: string;
        time: string;
        attributes: Array<{ name: string; value: string } | unknown>;
        relationships: Array<{ objectId: string; qualifier: string }>;
      }>;
    };

function normalizeSchemaAttributes(raw: unknown[]): Ocel2AttributeSchema[] {
  const out: Ocel2AttributeSchema[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && "name" in item) {
      const rec = item as { name: unknown; type?: unknown };
      if (typeof rec.name === "string" && rec.name.length > 0) {
        out.push({
          name: rec.name,
          type: typeof rec.type === "string" && rec.type.length > 0 ? rec.type : "string"
        });
      }
    }
  }
  return out;
}

export function upgradeLegacyOcelToOcel2(
  legacyDoc: LegacyOcelInput,
  meta: UpgradeLegacyOcelMeta = {}
): Ocel2Document {
  const redactOpts = deriveRedactOptions(meta.config, meta.redactOptions);
  const objectTypeMap = new Map<string, Ocel2TypeSchema>();
  const eventTypeMap = new Map<string, Ocel2TypeSchema>();

  for (const s of COMPLIANCE_OBJECT_TYPES) mergeTypeSchema(objectTypeMap, s);
  for (const s of COMPLIANCE_EVENT_TYPES) mergeTypeSchema(eventTypeMap, s);

  for (const t of legacyDoc.objectTypes ?? []) {
    mergeTypeSchema(objectTypeMap, {
      name: t.name,
      attributes: normalizeSchemaAttributes(Array.isArray(t.attributes) ? t.attributes : [])
    });
  }
  for (const t of legacyDoc.eventTypes ?? []) {
    mergeTypeSchema(eventTypeMap, {
      name: t.name,
      attributes: normalizeSchemaAttributes(Array.isArray(t.attributes) ? t.attributes : [])
    });
  }

  for (const rawEv of legacyDoc.events) {
    const rawAttrs = Array.isArray(rawEv.attributes) ? rawEv.attributes : [];
    const seenPi = new Set<string>();
    for (const item of rawAttrs) {
      if (item === null || typeof item !== "object") continue;
      const name = (item as { name?: unknown }).name;
      if (typeof name === "string" && PI_ATTR_NAMES.has(name)) {
        if (seenPi.has(name)) {
          throw new ComplianceRefusalError(
            "PROVENANCE_SEAL_FAILED",
            `Legacy OCEL event '${rawEv.id}' contains duplicate reserved attribute '${name}'.`,
            "R_missing_consequence"
          );
        }
        seenPi.add(name);
      }
    }
  }

  const findEventAttrValue = (rawAttrs: unknown[], name: string): string | undefined => {
    for (const a of rawAttrs) {
      if (a !== null && typeof a === "object" && (a as { name?: unknown }).name === name) {
        return String((a as { value?: unknown }).value ?? "");
      }
    }
    return undefined;
  };
  const hasEventAttr = (rawAttrs: unknown[], name: string): boolean =>
    rawAttrs.some(
      (a) => a !== null && typeof a === "object" && (a as { name?: unknown }).name === name
    );

  const anyPiChainAttr = legacyDoc.events.some(
    (e) =>
      Array.isArray(e.attributes) &&
      (hasEventAttr(e.attributes, "pi_hash") ||
        hasEventAttr(e.attributes, "pi_parent") ||
        hasEventAttr(e.attributes, "pi_hash_alg"))
  );
  const inputHasPiChain =
    legacyDoc.events.length > 0 &&
    legacyDoc.events.every((e) => {
      if (!Array.isArray(e.attributes)) return false;
      const hash = findEventAttrValue(e.attributes, "pi_hash");
      const parent = findEventAttrValue(e.attributes, "pi_parent");
      const alg = findEventAttrValue(e.attributes, "pi_hash_alg");
      return (
        hash !== undefined &&
        SHA256_HEX_RE.test(hash) &&
        parent !== undefined &&
        alg === "sha256"
      );
    });

  const anyPiAttrSha = legacyDoc.events.some(
    (e) => Array.isArray(e.attributes) && hasEventAttr(e.attributes, "pi_attr_sha256")
  );
  const anyPiObjSha = legacyDoc.events.some(
    (e) => Array.isArray(e.attributes) && hasEventAttr(e.attributes, "pi_obj_sha256")
  );
  const anyF05SealAttr = anyPiAttrSha || anyPiObjSha;

  if ((anyPiChainAttr || anyF05SealAttr) && !meta.rechain && legacyDoc.events.length > 0) {
    if (!inputHasPiChain) {
      throw new ComplianceRefusalError(
        "PROVENANCE_SEAL_FAILED",
        "Legacy OCEL document has partial or incomplete hash-chain seal attributes before upgrade.",
        "R_missing_consequence"
      );
    }
    const chainErr = verifyChain(legacyDoc as OcelDoc, "sha256");
    if (chainErr !== null) {
      throw new ComplianceRefusalError(
        "PROVENANCE_SEAL_FAILED",
        `Legacy OCEL document failed hash-chain verification before upgrade: ${chainErr}`,
        "R_missing_consequence"
      );
    }
  }

  if (!meta.rechain && anyF05SealAttr && legacyDoc.events.length > 0) {
    for (const rawEv of legacyDoc.events) {
      const rawAttrs = Array.isArray(rawEv.attributes) ? rawEv.attributes : [];
      const objShaVal = findEventAttrValue(rawAttrs, "pi_obj_sha256");
      if (!objShaVal || !SHA256_HEX_RE.test(objShaVal)) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Legacy OCEL event '${rawEv.id}' has missing or invalid pi_obj_sha256 before upgrade.`,
          "R_missing_consequence"
        );
      }
      const attrShaVal = findEventAttrValue(rawAttrs, "pi_attr_sha256");
      if (!attrShaVal || !SHA256_HEX_RE.test(attrShaVal)) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Legacy OCEL event '${rawEv.id}' has missing or invalid pi_attr_sha256 before upgrade.`,
          "R_missing_consequence"
        );
      }
    }
    const lastRawEv = legacyDoc.events[legacyDoc.events.length - 1]!;
    const lastRawAttrs = Array.isArray(lastRawEv.attributes) ? lastRawEv.attributes : [];
    const lastObjShaVal = findEventAttrValue(lastRawAttrs, "pi_obj_sha256") ?? "";
    const normalizedPreEnrich: Ocel2Object[] = legacyDoc.objects.map((o) => ({
      id: o.id,
      type: o.type,
      attributes: Array.isArray(o.attributes)
        ? (o.attributes as unknown[]).flatMap((rawAttr) => {
            if (rawAttr === null || typeof rawAttr !== "object") return [];
            const a = rawAttr as Record<string, unknown>;
            return [
              {
                name: String(a["name"] ?? ""),
                time: String(a["time"] ?? ""),
                value: String(a["value"] ?? "")
              }
            ];
          })
        : [],
      relationships: Array.isArray(o.relationships)
        ? (o.relationships as unknown[]).flatMap((rawRel) => {
            if (rawRel === null || typeof rawRel !== "object") return [];
            const r = rawRel as Record<string, unknown>;
            return [
              {
                objectId: String(r["objectId"] ?? ""),
                qualifier: String(r["qualifier"] ?? "")
              }
            ];
          })
        : []
    }));
    const expectedPreObjSha = computeObjectsSha256(normalizedPreEnrich);
    if (lastObjShaVal !== expectedPreObjSha) {
      throw new ComplianceRefusalError(
        "PROVENANCE_SEAL_FAILED",
        `Legacy OCEL document failed pi_obj_sha256 verification before upgrade at event '${lastRawEv.id}'.`,
        "R_missing_consequence"
      );
    }
  }

  const objectsMap = new Map<string, Ocel2Object>();
  const objectEarliestEventTime = new Map<string, string>();
  for (const ev of legacyDoc.events) {
    for (const rel of ev.relationships) {
      const safeTarget = redactIdentifier(rel.objectId, redactOpts);
      if (!objectEarliestEventTime.has(safeTarget)) {
        objectEarliestEventTime.set(safeTarget, ev.time);
      }
    }
  }

  const fallbackTime = legacyDoc.events[0]?.time ?? new Date(0).toISOString();

  for (const rawObj of legacyDoc.objects) {
    const safeId = redactIdentifier(rawObj.id, redactOpts);
    if (!objectTypeMap.has(rawObj.type)) {
      mergeTypeSchema(objectTypeMap, { name: rawObj.type, attributes: [] });
    }
    const normalizedAttrs: Ocel2ObjectAttribute[] = [];
    const lastMsByName = new Map<string, number>();

    if (Array.isArray(rawObj.attributes)) {
      for (const rawAttr of rawObj.attributes) {
        if (!rawAttr || typeof rawAttr !== "object") continue;
        const a = rawAttr as { name?: unknown; time?: unknown; value?: unknown };
        if (typeof a.name !== "string" || a.name.length === 0) continue;
        let t =
          typeof a.time === "string" && isValidIsoTimestamp(a.time)
            ? a.time
            : objectEarliestEventTime.get(safeId) ?? fallbackTime;
        const prevMs = lastMsByName.get(a.name);
        const curMs = Date.parse(t);
        if (prevMs !== undefined && curMs < prevMs) {
          t = new Date(prevMs).toISOString();
        }
        lastMsByName.set(a.name, Date.parse(t));
        normalizedAttrs.push({
          name: a.name,
          time: t,
          value: redactKeyValuePair(a.name, String(a.value ?? ""), redactOpts)
        });
      }
    }

    const normalizedRels: Ocel2Relationship[] = [];
    if (Array.isArray(rawObj.relationships)) {
      for (const rawRel of rawObj.relationships) {
        if (!rawRel || typeof rawRel !== "object") continue;
        const r = rawRel as { objectId?: unknown; qualifier?: unknown };
        if (typeof r.objectId === "string" && typeof r.qualifier === "string" && r.qualifier.length > 0) {
          const safeTarget = redactIdentifier(r.objectId, redactOpts);
          const safeQualifier = redactIdentifier(r.qualifier, redactOpts);
          if (
            safeQualifier.trim().length > 0 &&
            !normalizedRels.some((x) => x.objectId === safeTarget && x.qualifier === safeQualifier)
          ) {
            normalizedRels.push({ objectId: safeTarget, qualifier: safeQualifier });
          }
        }
      }
    }

    objectsMap.set(safeId, {
      id: safeId,
      type: rawObj.type,
      attributes: normalizedAttrs,
      relationships: normalizedRels
    });
  }

  const ensureObj = (id: string, type: string, attrs?: Record<string, string>) => {
    const safeId = redactIdentifier(id, redactOpts);
    if (!objectTypeMap.has(type)) {
      mergeTypeSchema(objectTypeMap, { name: type, attributes: [] });
    }
    let obj = objectsMap.get(safeId);
    if (!obj) {
      obj = { id: safeId, type, attributes: [], relationships: [] };
      objectsMap.set(safeId, obj);
    }
    if (attrs) {
      const redacted = redactForComplianceChain(attrs, redactOpts);
      for (const [k, v] of Object.entries(redacted)) {
        if (!obj.attributes.some((a) => a.name === k)) {
          obj.attributes.push({ name: k, time: fallbackTime, value: String(v) });
        }
      }
    }
    return obj;
  };

  const addO2OEdge = (sourceId: string, qualifier: string, targetId: string) => {
    const safeQualifier = redactIdentifier(qualifier, redactOpts);
    if (!safeQualifier || safeQualifier.trim().length === 0) return;
    const src = objectsMap.get(sourceId);
    const dst = objectsMap.get(targetId);
    if (!src || !dst) return;
    if (!src.relationships.some((r) => r.objectId === targetId && r.qualifier === safeQualifier)) {
      src.relationships.push({ objectId: targetId, qualifier: safeQualifier });
    }
  };

  let hashedFieldChangedByRedaction = false;

  const redactedEventsPrep = legacyDoc.events.map((rawEv) => {
    if (!eventTypeMap.has(rawEv.type)) {
      mergeTypeSchema(eventTypeMap, { name: rawEv.type, attributes: [] });
    }
    const safeEventId = redactIdentifier(rawEv.id, redactOpts);
    if (safeEventId !== rawEv.id) hashedFieldChangedByRedaction = true;
    const safeRels: Ocel2Relationship[] = rawEv.relationships.map((r) => {
      const safeTarget = redactIdentifier(r.objectId, redactOpts);
      const safeQualifier = redactIdentifier(r.qualifier, redactOpts);
      if (safeTarget !== r.objectId || safeQualifier !== r.qualifier) {
        hashedFieldChangedByRedaction = true;
      }
      return { objectId: safeTarget, qualifier: safeQualifier };
    });

    const rawAttrs = Array.isArray(rawEv.attributes) ? rawEv.attributes : [];
    const domainEntries: Array<[string, string]> = [];
    let piParent = "";
    let piHash = "";
    let piHashAlg = "";
    let piAttrSha256: string | undefined;
    let piPhase = "";
    let piPendingRef = "";

    for (const item of rawAttrs) {
      if (!item || typeof item !== "object") continue;
      const a = item as { name?: unknown; value?: unknown };
      if (typeof a.name !== "string") continue;
      const val = String(a.value ?? "");
      if (a.name === "pi_parent") piParent = val;
      else if (a.name === "pi_hash") piHash = val;
      else if (a.name === "pi_hash_alg") piHashAlg = val;
      else if (a.name === "pi_attr_sha256") piAttrSha256 = val;
      else if (a.name === "pi_obj_sha256") continue;
      else if (a.name === "pi_phase") piPhase = val;
      else if (a.name === "pi_pending_ref") piPendingRef = val;
      else domainEntries.push([a.name, val]);
    }

    const rawDomainAttrs: Ocel2EventAttribute[] = domainEntries.map(([k, v]) => ({
      name: k,
      value: v
    }));
    const domainAttrs: Ocel2EventAttribute[] = domainEntries.map(([k, v]) => ({
      name: k,
      value: redactKeyValuePair(k, v, redactOpts)
    }));

    if (!meta.rechain && anyF05SealAttr) {
      if (!piAttrSha256 || !SHA256_HEX_RE.test(piAttrSha256)) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Legacy OCEL event '${rawEv.id}' has missing or invalid pi_attr_sha256 before upgrade.`,
          "R_missing_consequence"
        );
      }
      const expectedRaw = computePiAttrSha256(rawDomainAttrs);
      const expectedRedacted = computePiAttrSha256(domainAttrs);
      if (piAttrSha256 !== expectedRaw || piAttrSha256 !== expectedRedacted) {
        throw new ComplianceRefusalError(
          "PROVENANCE_SEAL_FAILED",
          `Legacy OCEL event '${rawEv.id}' failed pi_attr_sha256 verification before upgrade.`,
          "R_missing_consequence"
        );
      }
    }

    return {
      id: safeEventId,
      type: rawEv.type,
      time: rawEv.time,
      relationships: safeRels,
      domainAttrs,
      piParent,
      piHash,
      piHashAlg,
      piPhase,
      piPendingRef
    };
  });

  // Infer O2O links from E2O co-occurrences on events
  for (const ev of redactedEventsPrep) {
    const byType = new Map<string, string[]>();
    for (const rel of ev.relationships) {
      const obj = objectsMap.get(rel.objectId);
      if (!obj) continue;
      const arr = byType.get(obj.type) ?? [];
      arr.push(obj.id);
      byType.set(obj.type, arr);
    }
    const sessions = byType.get("session") ?? [];
    const turns = byType.get("turn") ?? [];
    const tools = byType.get("tool_call") ?? [];
    const reqs = byType.get("model_request") ?? [];
    const subagents = byType.get("subagent") ?? [];
    const perms = byType.get("permission") ?? [];
    const files = byType.get("workspace_file") ?? [];
    const receipts = byType.get("receipt") ?? [];

    for (const t of turns) for (const s of sessions) addO2OEdge(t, "in_session", s);
    for (const tc of tools) for (const t of turns) addO2OEdge(tc, "in_turn", t);
    for (const rq of reqs) for (const t of turns) addO2OEdge(rq, "in_turn", t);
    for (const sa of subagents) for (const s of sessions) addO2OEdge(sa, "spawned_by", s);
    for (const pm of perms) for (const tc of tools) addO2OEdge(pm, "governs", tc);
    for (const wf of files) for (const t of turns) addO2OEdge(wf, "mutated_in", t);
    for (const rc of receipts) for (const s of sessions) addO2OEdge(rc, "seals", s);
  }

  // Enrich from upgrade meta
  let resolvedSessionId: string | undefined = meta.sessionId
    ? redactIdentifier(meta.sessionId, redactOpts)
    : undefined;
  if (!resolvedSessionId) {
    for (const obj of objectsMap.values()) {
      if (obj.type === "session") {
        resolvedSessionId = obj.id;
        break;
      }
    }
  }
  if (meta.sessionId) ensureObj(meta.sessionId, "session");

  if (meta.providerId) {
    const provObj = ensureObj(meta.providerId, "provider", { provider_id: meta.providerId });
    for (const obj of objectsMap.values()) {
      if (obj.type === "model_request") {
        addO2OEdge(obj.id, "uses_provider", provObj.id);
      }
    }
  }
  if (meta.overseerId) {
    const ovObj = ensureObj(`overseer:${meta.overseerId}`, "human_overseer", {
      overseer_id: meta.overseerId,
      role: "deployer_oversight"
    });
    if (resolvedSessionId) addO2OEdge(ovObj.id, "governs", resolvedSessionId);
  }
  if (meta.modelId) {
    ensureObj(`model:${meta.modelId}`, "ai_model", {
      model_id: meta.modelId,
      ...(meta.providerId ? { provider_id: meta.providerId } : {})
    });
  }
  if (meta.profile) {
    const profObj = ensureObj(`profile:${meta.profile}`, "compliance_profile", {
      profile: meta.profile
    });
    if (resolvedSessionId) addO2OEdge(profObj.id, "governs", resolvedSessionId);
  }
  if (meta.extraO2O) {
    for (const edge of meta.extraO2O) {
      addO2OEdge(
        redactIdentifier(edge.sourceObjectId, redactOpts),
        edge.qualifier,
        redactIdentifier(edge.targetObjectId, redactOpts)
      );
    }
  }

  const preserveOriginalChain =
    inputHasPiChain && !meta.rechain && !hashedFieldChangedByRedaction;
  const finalObjSha256 = computeObjectsSha256([...objectsMap.values()]);

  let lastHash = "";
  const events: Ocel2Event[] = redactedEventsPrep.map((ev) => {
    const attrSha256 = computePiAttrSha256(ev.domainAttrs);
    let piParent: string;
    let piHash: string;
    let piHashAlg: string;

    if (preserveOriginalChain) {
      piParent = ev.piParent;
      piHash = ev.piHash;
      piHashAlg = ev.piHashAlg || "sha256";
    } else {
      piParent = lastHash;
      piHash = hashHex(
        "sha256",
        piParent +
          "\n" +
          canon(
            { id: ev.id, type: ev.type, time: ev.time, relationships: ev.relationships },
            ev.piPhase,
            ev.piPendingRef
          )
      );
      piHashAlg = "sha256";
      lastHash = piHash;
    }

    const piAttrs: Ocel2EventAttribute[] = [
      { name: "pi_parent", value: piParent },
      { name: "pi_hash", value: piHash },
      { name: "pi_hash_alg", value: piHashAlg },
      { name: "pi_attr_sha256", value: attrSha256 },
      { name: "pi_obj_sha256", value: finalObjSha256 }
    ];
    if (ev.piPhase) piAttrs.push({ name: "pi_phase", value: ev.piPhase });
    if (ev.piPendingRef) piAttrs.push({ name: "pi_pending_ref", value: ev.piPendingRef });

    return {
      id: ev.id,
      type: ev.type,
      time: ev.time,
      attributes: [...piAttrs, ...ev.domainAttrs],
      relationships: ev.relationships
    };
  });

  return {
    objectTypes: cloneTypeSchemas([...objectTypeMap.values()]),
    eventTypes: cloneTypeSchemas([...eventTypeMap.values()]),
    objects: [...objectsMap.values()],
    events
  };
}

export interface ValidateOcel2Options {
  requireHashChain?: boolean;
  requireAttrHash?: boolean;
  requireObjHash?: boolean;
  requireRedacted?: boolean;
  redactOptions?: RedactComplianceOptions;
}

export interface ValidateOcel2Result {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateOcel2(
  doc: Ocel2Document,
  options: ValidateOcel2Options = {}
): ValidateOcel2Result {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: ["Document must be an object."], warnings };
  }
  for (const key of ["objectTypes", "eventTypes", "objects", "events"] as const) {
    if (!Array.isArray(doc[key])) {
      errors.push(`Missing required array '${key}'.`);
    }
  }
  if (errors.length > 0) return { ok: false, errors, warnings };

  const objectTypeNames = new Set<string>();
  for (const ot of doc.objectTypes) {
    if (!ot || typeof ot.name !== "string" || ot.name.trim().length === 0) {
      errors.push("objectTypes contains an entry without a valid non-empty name.");
      continue;
    }
    if (objectTypeNames.has(ot.name)) {
      errors.push(`Duplicate objectType '${ot.name}'.`);
    }
    objectTypeNames.add(ot.name);
    if (!Array.isArray(ot.attributes)) {
      errors.push(`objectType '${ot.name}' is missing attributes array.`);
    }
  }

  const eventTypeNames = new Set<string>();
  for (const et of doc.eventTypes) {
    if (!et || typeof et.name !== "string" || et.name.trim().length === 0) {
      errors.push("eventTypes contains an entry without a valid non-empty name.");
      continue;
    }
    if (eventTypeNames.has(et.name)) {
      errors.push(`Duplicate eventType '${et.name}'.`);
    }
    eventTypeNames.add(et.name);
    if (!Array.isArray(et.attributes)) {
      errors.push(`eventType '${et.name}' is missing attributes array.`);
    }
  }

  const objectMap = new Map<string, Ocel2Object>();
  for (const obj of doc.objects) {
    if (!obj || typeof obj.id !== "string" || obj.id.trim().length === 0) {
      errors.push("objects contains an entry without a valid non-empty id.");
      continue;
    }
    if (objectMap.has(obj.id)) {
      errors.push(`Duplicate object id '${obj.id}'.`);
    }
    objectMap.set(obj.id, obj);
    if (!objectTypeNames.has(obj.type)) {
      errors.push(`Object '${obj.id}' has undeclared type '${obj.type}'.`);
    }
    if (!Array.isArray(obj.attributes)) {
      errors.push(`Object '${obj.id}' is missing attributes array.`);
    } else {
      const lastTimeByAttr = new Map<string, number>();
      for (const attr of obj.attributes) {
        if (!attr || typeof attr.name !== "string" || attr.name.length === 0) {
          errors.push(`Object '${obj.id}' has an attribute with an invalid name.`);
          continue;
        }
        if (typeof attr.value !== "string") {
          errors.push(`Object '${obj.id}' attribute '${attr.name}' value must be a string.`);
        }
        if (!isValidIsoTimestamp(attr.time)) {
          errors.push(
            `Object '${obj.id}' attribute '${attr.name}' has invalid ISO-8601 time '${String(attr.time)}'.`
          );
          continue;
        }
        const curMs = Date.parse(attr.time);
        const prevMs = lastTimeByAttr.get(attr.name);
        if (prevMs !== undefined && curMs < prevMs) {
          errors.push(
            `Object '${obj.id}' attribute '${attr.name}' has non-monotonic timestamp '${attr.time}' < '${new Date(prevMs).toISOString()}'.`
          );
        }
        lastTimeByAttr.set(attr.name, curMs);
      }
    }
    if (!Array.isArray(obj.relationships)) {
      errors.push(`Object '${obj.id}' is missing relationships array.`);
    }
  }

  // O2O referential integrity & canonical type-conformance
  for (const obj of doc.objects) {
    if (!obj || !Array.isArray(obj.relationships)) continue;
    for (const rel of obj.relationships) {
      if (!rel || typeof rel.objectId !== "string" || !objectMap.has(rel.objectId)) {
        errors.push(`Object '${obj.id}' has O2O relation to unknown object '${String(rel?.objectId)}'.`);
        continue;
      }
      if (!rel || typeof rel.qualifier !== "string" || rel.qualifier.trim().length === 0) {
        errors.push(`Object '${obj.id}' has an unqualified O2O relation.`);
        continue;
      }
      const targetObj = objectMap.get(rel.objectId)!;
      if (!isCanonicalO2OTypeAllowed(obj.type, rel.qualifier, targetObj.type)) {
        errors.push(
          `Object '${obj.id}' (${obj.type}) has invalid O2O edge '${rel.qualifier}' to '${targetObj.id}' (${targetObj.type}).`
        );
      }
    }
  }

  const eventIds = new Set<string>();
  let anyPiHash = false;
  let anyPiAttrSha = false;
  let anyPiObjSha = false;

  for (const ev of doc.events) {
    if (!ev || typeof ev.id !== "string" || ev.id.trim().length === 0) {
      errors.push("events contains an entry without a valid non-empty id.");
      continue;
    }
    if (eventIds.has(ev.id)) {
      errors.push(`Duplicate event id '${ev.id}'.`);
    }
    eventIds.add(ev.id);
    if (!eventTypeNames.has(ev.type)) {
      errors.push(`Event '${ev.id}' has undeclared type '${ev.type}'.`);
    }
    if (!isValidIsoTimestamp(ev.time)) {
      errors.push(`Event '${ev.id}' has invalid ISO-8601 time '${String(ev.time)}'.`);
    }
    if (!Array.isArray(ev.attributes)) {
      errors.push(`Event '${ev.id}' is missing attributes array.`);
    } else {
      const seenPiAttrs = new Set<string>();
      for (const attr of ev.attributes) {
        if (!attr || typeof attr.name !== "string" || attr.name.length === 0) {
          errors.push(`Event '${ev.id}' has an attribute with an invalid name.`);
        } else {
          if (PI_ATTR_NAMES.has(attr.name)) {
            if (seenPiAttrs.has(attr.name)) {
              errors.push(`Event '${ev.id}' has duplicate reserved attribute '${attr.name}'.`);
            }
            seenPiAttrs.add(attr.name);
          }
          if (attr.name === "pi_hash" || attr.name === "pi_parent" || attr.name === "pi_hash_alg") {
            anyPiHash = true;
          }
          if (attr.name === "pi_attr_sha256") anyPiAttrSha = true;
          if (attr.name === "pi_obj_sha256") anyPiObjSha = true;
        }
        if (typeof attr?.value !== "string") {
          errors.push(`Event '${ev.id}' attribute '${String(attr?.name)}' value must be a string.`);
        }
      }
    }
    if (!Array.isArray(ev.relationships)) {
      errors.push(`Event '${ev.id}' is missing relationships array.`);
    } else {
      for (const rel of ev.relationships) {
        if (!rel || typeof rel.objectId !== "string" || !objectMap.has(rel.objectId)) {
          errors.push(`Event '${ev.id}' relates unknown object '${String(rel?.objectId)}'.`);
        }
        if (!rel || typeof rel.qualifier !== "string" || rel.qualifier.trim().length === 0) {
          errors.push(`Event '${ev.id}' has an unqualified E2O relation.`);
        }
      }
    }
  }

  const anyF05Seal = anyPiAttrSha || anyPiObjSha;

  if (options.requireHashChain || anyPiHash || anyF05Seal) {
    if (doc.events.length > 0) {
      for (const ev of doc.events) {
        if (!Array.isArray(ev?.attributes)) continue;
        const alg = ev.attributes.find((a) => a?.name === "pi_hash_alg")?.value;
        if (alg !== "sha256") {
          errors.push(`Event '${ev.id}' missing pi_hash_alg='sha256'.`);
        }
        const hashVal = ev.attributes.find((a) => a?.name === "pi_hash")?.value;
        if (!hashVal || !SHA256_HEX_RE.test(hashVal)) {
          errors.push(`Event '${ev.id}' has missing or invalid SHA-256 hex pi_hash.`);
        }
      }
      if (
        doc.events.every(
          (e) =>
            Boolean(e) &&
            Array.isArray(e.attributes) &&
            e.attributes.every((a) => Boolean(a) && typeof a.name === "string") &&
            Array.isArray(e.relationships) &&
            e.relationships.every(
              (r) => Boolean(r) && typeof r.objectId === "string" && typeof r.qualifier === "string"
            )
        )
      ) {
        const chainReason = verifyChain(doc as unknown as OcelDoc, "sha256");
        if (chainReason !== null) {
          errors.push(`Hash chain verification failed: ${chainReason}`);
        }
      }
    }
  }

  if (options.requireAttrHash || anyF05Seal) {
    for (const ev of doc.events) {
      if (!Array.isArray(ev?.attributes)) continue;
      const recorded = ev.attributes.find((a) => a?.name === "pi_attr_sha256")?.value;
      if (!recorded) {
        errors.push(`Event '${ev.id}' is missing pi_attr_sha256.`);
        continue;
      }
      if (!SHA256_HEX_RE.test(recorded)) {
        errors.push(`Event '${ev.id}' has invalid SHA-256 hex pi_attr_sha256.`);
        continue;
      }
      if (
        ev.attributes.every(
          (a) => Boolean(a) && typeof a.name === "string" && typeof a.value === "string"
        )
      ) {
        const expected = computePiAttrSha256(ev.attributes);
        if (recorded !== expected) {
          errors.push(`Attribute digest mismatch at event '${ev.id}'.`);
        }
      }
    }
  }

  if ((options.requireObjHash || anyF05Seal) && doc.events.length > 0) {
    for (const ev of doc.events) {
      if (!Array.isArray(ev?.attributes)) continue;
      const recorded = ev.attributes.find((a) => a?.name === "pi_obj_sha256")?.value;
      if (!recorded) {
        errors.push(`Event '${ev.id}' is missing pi_obj_sha256.`);
      } else if (!SHA256_HEX_RE.test(recorded)) {
        errors.push(`Event '${ev.id}' has invalid SHA-256 hex pi_obj_sha256.`);
      }
    }
    const lastEv = doc.events[doc.events.length - 1]!;
    const lastObjSha = Array.isArray(lastEv?.attributes)
      ? lastEv.attributes.find((a) => a?.name === "pi_obj_sha256")?.value
      : undefined;
    if (
      lastObjSha &&
      SHA256_HEX_RE.test(lastObjSha) &&
      doc.objects.every(
        (o) =>
          Boolean(o) &&
          Array.isArray(o.attributes) &&
          Array.isArray(o.relationships) &&
          o.attributes.every((a) => Boolean(a) && typeof a.name === "string") &&
          o.relationships.every(
            (r) => Boolean(r) && typeof r.qualifier === "string" && typeof r.objectId === "string"
          )
      )
    ) {
      const expectedObjSha = computeObjectsSha256(doc.objects);
      if (lastObjSha !== expectedObjSha) {
        errors.push(`Object graph digest mismatch at event '${lastEv.id}'.`);
      }
    }
  }

  if (options.requireRedacted) {
    if (containsUnredactedSecretsOrPii(JSON.stringify(doc), options.redactOptions)) {
      errors.push("Document contains unredacted secrets or PII.");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function escapeXml(value: string): string {
  // Strip XML 1.0 disallowed control/noncharacter code points before escaping
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/gu, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function serializeOcel2Xml(doc: Ocel2Document): string {
  const check = validateOcel2(doc);
  if (!check.ok) {
    throw new ComplianceRefusalError(
      "INVALID_COMPLIANCE_CONFIG",
      `Cannot serialize invalid OCEL 2.0 document to XML: ${check.errors.join("; ")}`,
      "mu_on_O"
    );
  }

  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<log>"];

  lines.push("  <object-types>");
  for (const ot of doc.objectTypes) {
    if (ot.attributes.length === 0) {
      lines.push(`    <object-type name="${escapeXml(ot.name)}"/>`);
    } else {
      lines.push(`    <object-type name="${escapeXml(ot.name)}">`);
      lines.push("      <attributes>");
      for (const a of ot.attributes) {
        lines.push(`        <attribute name="${escapeXml(a.name)}" type="${escapeXml(String(a.type))}"/>`);
      }
      lines.push("      </attributes>");
      lines.push("    </object-type>");
    }
  }
  lines.push("  </object-types>");

  lines.push("  <event-types>");
  for (const et of doc.eventTypes) {
    if (et.attributes.length === 0) {
      lines.push(`    <event-type name="${escapeXml(et.name)}"/>`);
    } else {
      lines.push(`    <event-type name="${escapeXml(et.name)}">`);
      lines.push("      <attributes>");
      for (const a of et.attributes) {
        lines.push(`        <attribute name="${escapeXml(a.name)}" type="${escapeXml(String(a.type))}"/>`);
      }
      lines.push("      </attributes>");
      lines.push("    </event-type>");
    }
  }
  lines.push("  </event-types>");

  lines.push("  <objects>");
  for (const obj of doc.objects) {
    lines.push(`    <object id="${escapeXml(obj.id)}" type="${escapeXml(obj.type)}">`);
    if (obj.attributes.length > 0) {
      lines.push("      <attributes>");
      for (const a of obj.attributes) {
        lines.push(
          `        <attribute name="${escapeXml(a.name)}" time="${escapeXml(a.time)}">${escapeXml(a.value)}</attribute>`
        );
      }
      lines.push("      </attributes>");
    }
    if (obj.relationships.length > 0) {
      lines.push("      <objects>");
      for (const r of obj.relationships) {
        lines.push(
          `        <relationship object-id="${escapeXml(r.objectId)}" qualifier="${escapeXml(r.qualifier)}"/>`
        );
      }
      lines.push("      </objects>");
    }
    lines.push("    </object>");
  }
  lines.push("  </objects>");

  lines.push("  <events>");
  for (const ev of doc.events) {
    lines.push(
      `    <event id="${escapeXml(ev.id)}" type="${escapeXml(ev.type)}" time="${escapeXml(ev.time)}">`
    );
    if (ev.attributes.length > 0) {
      lines.push("      <attributes>");
      for (const a of ev.attributes) {
        lines.push(`        <attribute name="${escapeXml(a.name)}">${escapeXml(a.value)}</attribute>`);
      }
      lines.push("      </attributes>");
    }
    if (ev.relationships.length > 0) {
      lines.push("      <objects>");
      for (const r of ev.relationships) {
        lines.push(
          `        <relationship object-id="${escapeXml(r.objectId)}" qualifier="${escapeXml(r.qualifier)}"/>`
        );
      }
      lines.push("      </objects>");
    }
    lines.push("    </event>");
  }
  lines.push("  </events>");

  lines.push("</log>");
  return lines.join("\n") + "\n";
}

export function complianceTapEnabled(
  env: NodeJS.ProcessEnv = process.env,
  config?: ResolvedComplianceConfig
): boolean {
  if (env.ZCODE_COMPLIANCE_LOG === "1") return true;
  if (env.ZCODE_COMPLIANCE_LOG === "0") return false;
  if (config) return config.complianceLogEnabled || env.ZCODE_OCEL === "1";
  const prof = env.ZCODE_COMPLIANCE_PROFILE?.trim();
  if (
    prof === "art50-only" ||
    prof === "high-risk-annex-iii" ||
    prof === "high-risk-annex-i"
  ) {
    return true;
  }
  return env.ZCODE_OCEL === "1";
}

export function isKnownComplianceObjectType(type: string): boolean {
  return KNOWN_OBJECT_TYPE_SET.has(type);
}

export function isKnownComplianceEventType(type: string): boolean {
  return KNOWN_EVENT_TYPE_SET.has(type);
}
