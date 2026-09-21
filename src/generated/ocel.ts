// Generated OCEL 2.0 type registry, source adapter, event-tap mapper, serializer and hash chain.
// Source of truth: the consumer's pi: individuals. Do not edit.
import { createHash } from "node:crypto";

export const EVENT_TYPES: string[] = ["checkpoint_created", "message_removed", "message_upserted", "model_streaming", "part_delta", "part_removed", "part_started", "part_upserted", "permission_requested", "permission_resolved", "place_order", "result", "rewind_triggered", "session_closed", "session_created", "session_resumed", "session_title_updated", "session_updated", "ship_order", "stream_recovery_updated", "tool_updated", "turn_completed", "turn_failed", "turn_started", "turn_steer_drained", "turn_steer_queued", "user_input_requested", "user_input_resolved"];
export const OBJECT_TYPES: string[] = ["item", "model_request", "order", "permission", "session", "subagent", "tool_call", "turn"];
export const SUPPORTED_HASHES: string[] = ["sha256"];
export type SourceSpec = { id: string; kind: string; nameField: string; idField: string; timeField: string; hash: string };
export type RuleSpec = { rule: string; source: string; name: string; event: string; object: string; qualifier: string; path: string };
export const SOURCES: SourceSpec[] = [
  { id: "order_hook", kind: "hook", nameField: "event", idField: "id", timeField: "ts", hash: "sha256" },
  { id: "zcode_app_server", kind: "app-server-subscription", nameField: "params.type", idField: "params.eventId", timeField: "params.timestamp", hash: "sha256" },
  { id: "zcode_stream", kind: "stream-json", nameField: "type", idField: "eventId", timeField: "timestamp", hash: "sha256" },
];
export const RULES: RuleSpec[] = [
  { rule: "app-checkpoint_created", source: "zcode_app_server", name: "checkpoint.created", event: "checkpoint_created", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-checkpoint_created", source: "zcode_app_server", name: "checkpoint.created", event: "checkpoint_created", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-message_removed", source: "zcode_app_server", name: "message.removed", event: "message_removed", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-message_removed", source: "zcode_app_server", name: "message.removed", event: "message_removed", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-message_upserted", source: "zcode_app_server", name: "message.upserted", event: "message_upserted", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-message_upserted", source: "zcode_app_server", name: "message.upserted", event: "message_upserted", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-model_streaming", source: "zcode_app_server", name: "model.streaming", event: "model_streaming", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-model_streaming", source: "zcode_app_server", name: "model.streaming", event: "model_streaming", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-part_removed", source: "zcode_app_server", name: "part.removed", event: "part_removed", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-part_removed", source: "zcode_app_server", name: "part.removed", event: "part_removed", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-part_started", source: "zcode_app_server", name: "part.started", event: "part_started", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-part_started", source: "zcode_app_server", name: "part.started", event: "part_started", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-part_upserted", source: "zcode_app_server", name: "part.upserted", event: "part_upserted", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-part_upserted", source: "zcode_app_server", name: "part.upserted", event: "part_upserted", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-permission_requested", source: "zcode_app_server", name: "permission.requested", event: "permission_requested", object: "permission", qualifier: "about_permission", path: "params.payload.requestId" },
  { rule: "app-permission_requested", source: "zcode_app_server", name: "permission.requested", event: "permission_requested", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-permission_requested", source: "zcode_app_server", name: "permission.requested", event: "permission_requested", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-permission_resolved", source: "zcode_app_server", name: "permission.resolved", event: "permission_resolved", object: "permission", qualifier: "about_permission", path: "params.payload.requestId" },
  { rule: "app-permission_resolved", source: "zcode_app_server", name: "permission.resolved", event: "permission_resolved", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-permission_resolved", source: "zcode_app_server", name: "permission.resolved", event: "permission_resolved", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-rewind_triggered", source: "zcode_app_server", name: "rewind.triggered", event: "rewind_triggered", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-rewind_triggered", source: "zcode_app_server", name: "rewind.triggered", event: "rewind_triggered", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-session_closed", source: "zcode_app_server", name: "session.closed", event: "session_closed", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-session_closed", source: "zcode_app_server", name: "session.closed", event: "session_closed", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-session_created", source: "zcode_app_server", name: "session.created", event: "session_created", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-session_created", source: "zcode_app_server", name: "session.created", event: "session_created", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-session_resumed", source: "zcode_app_server", name: "session.resumed", event: "session_resumed", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-session_resumed", source: "zcode_app_server", name: "session.resumed", event: "session_resumed", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-session_title_updated", source: "zcode_app_server", name: "session.titleUpdated", event: "session_title_updated", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-session_title_updated", source: "zcode_app_server", name: "session.titleUpdated", event: "session_title_updated", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-session_updated", source: "zcode_app_server", name: "session.updated", event: "session_updated", object: "model_request", qualifier: "about_model_request", path: "params.payload.requestId" },
  { rule: "app-session_updated", source: "zcode_app_server", name: "session.updated", event: "session_updated", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-session_updated", source: "zcode_app_server", name: "session.updated", event: "session_updated", object: "subagent", qualifier: "by_subagent", path: "params.payload.agentId" },
  { rule: "app-session_updated", source: "zcode_app_server", name: "session.updated", event: "session_updated", object: "tool_call", qualifier: "about_tool_call", path: "params.payload.toolCallId" },
  { rule: "app-session_updated", source: "zcode_app_server", name: "session.updated", event: "session_updated", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-stream_recovery_updated", source: "zcode_app_server", name: "streamRecovery.updated", event: "stream_recovery_updated", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-stream_recovery_updated", source: "zcode_app_server", name: "streamRecovery.updated", event: "stream_recovery_updated", object: "tool_call", qualifier: "about_tool_call", path: "params.payload.toolCallId" },
  { rule: "app-stream_recovery_updated", source: "zcode_app_server", name: "streamRecovery.updated", event: "stream_recovery_updated", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-tool_updated", source: "zcode_app_server", name: "tool.updated", event: "tool_updated", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-tool_updated", source: "zcode_app_server", name: "tool.updated", event: "tool_updated", object: "tool_call", qualifier: "about_tool_call", path: "params.payload.toolCallId" },
  { rule: "app-tool_updated", source: "zcode_app_server", name: "tool.updated", event: "tool_updated", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-turn_completed", source: "zcode_app_server", name: "turn.completed", event: "turn_completed", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-turn_completed", source: "zcode_app_server", name: "turn.completed", event: "turn_completed", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-turn_failed", source: "zcode_app_server", name: "turn.failed", event: "turn_failed", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-turn_failed", source: "zcode_app_server", name: "turn.failed", event: "turn_failed", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-turn_started", source: "zcode_app_server", name: "turn.started", event: "turn_started", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-turn_started", source: "zcode_app_server", name: "turn.started", event: "turn_started", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-turn_steer_drained", source: "zcode_app_server", name: "turn.steerDrained", event: "turn_steer_drained", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-turn_steer_drained", source: "zcode_app_server", name: "turn.steerDrained", event: "turn_steer_drained", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-turn_steer_queued", source: "zcode_app_server", name: "turn.steerQueued", event: "turn_steer_queued", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-turn_steer_queued", source: "zcode_app_server", name: "turn.steerQueued", event: "turn_steer_queued", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-user_input_requested", source: "zcode_app_server", name: "userInput.requested", event: "user_input_requested", object: "permission", qualifier: "about_permission", path: "params.payload.requestId" },
  { rule: "app-user_input_requested", source: "zcode_app_server", name: "userInput.requested", event: "user_input_requested", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-user_input_requested", source: "zcode_app_server", name: "userInput.requested", event: "user_input_requested", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "app-user_input_resolved", source: "zcode_app_server", name: "userInput.resolved", event: "user_input_resolved", object: "permission", qualifier: "about_permission", path: "params.payload.requestId" },
  { rule: "app-user_input_resolved", source: "zcode_app_server", name: "userInput.resolved", event: "user_input_resolved", object: "session", qualifier: "in_session", path: "params.sessionId" },
  { rule: "app-user_input_resolved", source: "zcode_app_server", name: "userInput.resolved", event: "user_input_resolved", object: "turn", qualifier: "in_turn", path: "params.turnId" },
  { rule: "rule-place", source: "order_hook", name: "order.placed", event: "place_order", object: "item", qualifier: "contains", path: "items" },
  { rule: "rule-place", source: "order_hook", name: "order.placed", event: "place_order", object: "order", qualifier: "subject", path: "order.id" },
  { rule: "rule-ship", source: "order_hook", name: "order.shipped", event: "ship_order", object: "order", qualifier: "subject", path: "order.id" },
  { rule: "stream-checkpoint_created", source: "zcode_stream", name: "checkpoint.created", event: "checkpoint_created", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-checkpoint_created", source: "zcode_stream", name: "checkpoint.created", event: "checkpoint_created", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-message_removed", source: "zcode_stream", name: "message.removed", event: "message_removed", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-message_removed", source: "zcode_stream", name: "message.removed", event: "message_removed", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-message_upserted", source: "zcode_stream", name: "message.upserted", event: "message_upserted", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-message_upserted", source: "zcode_stream", name: "message.upserted", event: "message_upserted", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-model_streaming", source: "zcode_stream", name: "model.streaming", event: "model_streaming", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-model_streaming", source: "zcode_stream", name: "model.streaming", event: "model_streaming", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-part_removed", source: "zcode_stream", name: "part.removed", event: "part_removed", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-part_removed", source: "zcode_stream", name: "part.removed", event: "part_removed", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-part_started", source: "zcode_stream", name: "part.started", event: "part_started", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-part_started", source: "zcode_stream", name: "part.started", event: "part_started", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-part_upserted", source: "zcode_stream", name: "part.upserted", event: "part_upserted", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-part_upserted", source: "zcode_stream", name: "part.upserted", event: "part_upserted", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-permission_requested", source: "zcode_stream", name: "permission.requested", event: "permission_requested", object: "permission", qualifier: "about_permission", path: "payload.requestId" },
  { rule: "stream-permission_requested", source: "zcode_stream", name: "permission.requested", event: "permission_requested", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-permission_requested", source: "zcode_stream", name: "permission.requested", event: "permission_requested", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-permission_resolved", source: "zcode_stream", name: "permission.resolved", event: "permission_resolved", object: "permission", qualifier: "about_permission", path: "payload.requestId" },
  { rule: "stream-permission_resolved", source: "zcode_stream", name: "permission.resolved", event: "permission_resolved", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-permission_resolved", source: "zcode_stream", name: "permission.resolved", event: "permission_resolved", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-rewind_triggered", source: "zcode_stream", name: "rewind.triggered", event: "rewind_triggered", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-rewind_triggered", source: "zcode_stream", name: "rewind.triggered", event: "rewind_triggered", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-session_closed", source: "zcode_stream", name: "session.closed", event: "session_closed", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-session_closed", source: "zcode_stream", name: "session.closed", event: "session_closed", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-session_created", source: "zcode_stream", name: "session.created", event: "session_created", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-session_created", source: "zcode_stream", name: "session.created", event: "session_created", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-session_resumed", source: "zcode_stream", name: "session.resumed", event: "session_resumed", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-session_resumed", source: "zcode_stream", name: "session.resumed", event: "session_resumed", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-session_title_updated", source: "zcode_stream", name: "session.titleUpdated", event: "session_title_updated", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-session_title_updated", source: "zcode_stream", name: "session.titleUpdated", event: "session_title_updated", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-session_updated", source: "zcode_stream", name: "session.updated", event: "session_updated", object: "model_request", qualifier: "about_model_request", path: "payload.requestId" },
  { rule: "stream-session_updated", source: "zcode_stream", name: "session.updated", event: "session_updated", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-session_updated", source: "zcode_stream", name: "session.updated", event: "session_updated", object: "subagent", qualifier: "by_subagent", path: "payload.agentId" },
  { rule: "stream-session_updated", source: "zcode_stream", name: "session.updated", event: "session_updated", object: "tool_call", qualifier: "about_tool_call", path: "payload.toolCallId" },
  { rule: "stream-session_updated", source: "zcode_stream", name: "session.updated", event: "session_updated", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-stream_recovery_updated", source: "zcode_stream", name: "streamRecovery.updated", event: "stream_recovery_updated", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-stream_recovery_updated", source: "zcode_stream", name: "streamRecovery.updated", event: "stream_recovery_updated", object: "tool_call", qualifier: "about_tool_call", path: "payload.toolCallId" },
  { rule: "stream-stream_recovery_updated", source: "zcode_stream", name: "streamRecovery.updated", event: "stream_recovery_updated", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-tool_updated", source: "zcode_stream", name: "tool.updated", event: "tool_updated", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-tool_updated", source: "zcode_stream", name: "tool.updated", event: "tool_updated", object: "tool_call", qualifier: "about_tool_call", path: "payload.toolCallId" },
  { rule: "stream-tool_updated", source: "zcode_stream", name: "tool.updated", event: "tool_updated", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-turn_completed", source: "zcode_stream", name: "turn.completed", event: "turn_completed", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-turn_completed", source: "zcode_stream", name: "turn.completed", event: "turn_completed", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-turn_failed", source: "zcode_stream", name: "turn.failed", event: "turn_failed", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-turn_failed", source: "zcode_stream", name: "turn.failed", event: "turn_failed", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-turn_started", source: "zcode_stream", name: "turn.started", event: "turn_started", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-turn_started", source: "zcode_stream", name: "turn.started", event: "turn_started", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-turn_steer_drained", source: "zcode_stream", name: "turn.steerDrained", event: "turn_steer_drained", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-turn_steer_drained", source: "zcode_stream", name: "turn.steerDrained", event: "turn_steer_drained", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-turn_steer_queued", source: "zcode_stream", name: "turn.steerQueued", event: "turn_steer_queued", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-turn_steer_queued", source: "zcode_stream", name: "turn.steerQueued", event: "turn_steer_queued", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-user_input_requested", source: "zcode_stream", name: "userInput.requested", event: "user_input_requested", object: "permission", qualifier: "about_permission", path: "payload.requestId" },
  { rule: "stream-user_input_requested", source: "zcode_stream", name: "userInput.requested", event: "user_input_requested", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-user_input_requested", source: "zcode_stream", name: "userInput.requested", event: "user_input_requested", object: "turn", qualifier: "in_turn", path: "turnId" },
  { rule: "stream-user_input_resolved", source: "zcode_stream", name: "userInput.resolved", event: "user_input_resolved", object: "permission", qualifier: "about_permission", path: "payload.requestId" },
  { rule: "stream-user_input_resolved", source: "zcode_stream", name: "userInput.resolved", event: "user_input_resolved", object: "session", qualifier: "in_session", path: "sessionId" },
  { rule: "stream-user_input_resolved", source: "zcode_stream", name: "userInput.resolved", event: "user_input_resolved", object: "turn", qualifier: "in_turn", path: "turnId" },
];
export const PHASE_OPEN = "pending";
export const PHASE_CLOSE = "outcome";
export const PHASED: Record<string, string> = {
};
export const CLOSES: [string, string][] = [
];

const closesPair = (outcome: string, pending: string): boolean => CLOSES.some(([o, p]) => o === outcome && p === pending);
const objectSet = (rels: Relationship[]): string => JSON.stringify(rels.map((r) => r.objectId).sort());
export type Relationship = { objectId: string; qualifier: string };
export type Attribute = { name: string; value: string };
export type OcelEvent = { id: string; type: string; time: string; attributes: Attribute[]; relationships: Relationship[] };
export type OcelDoc = {
  objectTypes: { name: string; attributes: unknown[] }[];
  eventTypes: { name: string; attributes: unknown[] }[];
  objects: { id: string; type: string; attributes: unknown[]; relationships: unknown[] }[];
  events: OcelEvent[];
};

export function hashHex(alg: string, data: string): string {
  if (alg === "sha256") return createHash("sha256").update(data, "utf8").digest("hex");
  throw new Error("unsupported hash algorithm: " + alg);
}

// Canonical form: keys sorted, no whitespace. Identical across all generated languages.
// A phased event (phase !== "") additionally binds pendingRef and phase into the digest.
export function canon(e: { id: string; type: string; time: string; relationships: Relationship[] }, phase = "", ref = ""): string {
  const rels = e.relationships
    .map((r) => "{\"objectId\":" + JSON.stringify(r.objectId) + ",\"qualifier\":" + JSON.stringify(r.qualifier) + "}")
    .join(",");
  const bound = phase ? ",\"pendingRef\":" + JSON.stringify(ref) + ",\"phase\":" + JSON.stringify(phase) : "";
  return "{\"id\":" + JSON.stringify(e.id) + bound + ",\"relationships\":[" + rels + "],\"time\":" + JSON.stringify(e.time) + ",\"type\":" + JSON.stringify(e.type) + "}";
}

function getPath(raw: unknown, path: string): unknown {
  let cur: unknown = raw;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}
function ids(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => String(x));
}
function flattenOtel(raw: any): any {
  if (!Array.isArray(raw.attributes)) return raw;
  const attrs: Record<string, unknown> = {};
  for (const kv of raw.attributes) {
    const v = kv.value;
    attrs[kv.key] = v !== null && typeof v === "object" ? (v.stringValue ?? v.intValue ?? v.boolValue ?? v.doubleValue) : v;
  }
  return { ...raw, attributes: attrs };
}

export const CALLBACK_KINDS = ["sdk-callback", "app-server-subscription"];

export class Tap {
  readonly spec: SourceSpec;
  private events: OcelEvent[] = [];
  private objects = new Map<string, string>();
  private last = "";
  private sealed = false;
  readonly orphans: string[] = [];

  constructor(sourceId: string) {
    const s = SOURCES.find((x) => x.id === sourceId);
    if (!s) throw new Error("unknown source: " + sourceId);
    this.spec = s;
  }

  /** stream-json: pass newline-delimited text. every other kind: pass one parsed record. */
  ingest(input: string | object): OcelEvent[] {
    if (this.sealed) throw new Error("tap sealed");
    let records: unknown[];
    if (this.spec.kind === "stream-json") {
      if (typeof input !== "string") throw new Error("stream-json expects text");
      records = input.split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));
    } else {
      if (typeof input === "string") throw new Error(this.spec.kind + " expects a parsed record");
      records = [input];
    }
    const out: OcelEvent[] = [];
    for (const r of records) {
      const e = this.append(r);
      if (e) out.push(e);
    }
    return out;
  }

  /** sdk-callback and app-server-subscription: hand the runtime a callback. */
  attach(register: (cb: (record: object) => void) => void): void {
    if (!CALLBACK_KINDS.includes(this.spec.kind)) throw new Error(this.spec.kind + " has no callback attachment");
    register((r) => {
      this.ingest(r);
    });
  }

  private append(raw0: unknown): OcelEvent | null {
    const raw = this.spec.kind === "otel" ? flattenOtel(raw0) : raw0;
    const name = getPath(raw, this.spec.nameField);
    const id = getPath(raw, this.spec.idField);
    const time = getPath(raw, this.spec.timeField);
    if (name === undefined || id === undefined || time === undefined) return null;
    const rs = RULES.filter((r) => r.source === this.spec.id && r.name === String(name));
    if (rs.length === 0) return null;
    const relationships: Relationship[] = [];
    const found: [string, string][] = [];
    for (const r of rs) {
      for (const oid of ids(getPath(raw, r.path))) {
        relationships.push({ objectId: oid, qualifier: r.qualifier });
        found.push([oid, r.object]);
      }
    }
    const type = rs[0].event;
    const phase = PHASED[type] ?? "";
    let ref = "";
    if (phase === PHASE_CLOSE) {
      const open = this.openPending(type, relationships);
      if (!open) {
        this.orphans.push(String(id)); // outcome with no open pending: reported, not emitted
        return null;
      }
      ref = open.hash;
    }
    for (const [oid, otype] of found) if (!this.objects.has(oid)) this.objects.set(oid, otype);
    const base = { id: String(id), type, time: String(time), relationships };
    const parent = this.last;
    const hash = hashHex(this.spec.hash, parent + "\n" + canon(base, phase, ref));
    this.last = hash;
    const attributes: Attribute[] = [
      { name: "pi_parent", value: parent },
      { name: "pi_hash", value: hash },
      { name: "pi_hash_alg", value: this.spec.hash },
    ];
    if (phase) attributes.push({ name: "pi_phase", value: phase });
    if (phase === PHASE_CLOSE) attributes.push({ name: "pi_pending_ref", value: ref });
    const ev: OcelEvent = { ...base, attributes };
    this.events.push(ev);
    return ev;
  }

  private attr(e: OcelEvent, n: string): string | undefined {
    return e.attributes.find((a) => a.name === n)?.value;
  }

  private closedRefs(): Set<string> {
    return new Set(this.events.map((e) => this.attr(e, "pi_pending_ref")).filter((v): v is string => !!v));
  }

  /** Oldest pending event this outcome type may close, over the same object set. */
  private openPending(outcome: string, rels: Relationship[]): { id: string; hash: string } | null {
    const closed = this.closedRefs();
    for (const e of this.events) {
      const hash = this.attr(e, "pi_hash") as string;
      if (this.attr(e, "pi_phase") === PHASE_OPEN && !closed.has(hash) && closesPair(outcome, e.type) && objectSet(e.relationships) === objectSet(rels)) {
        return { id: e.id, hash };
      }
    }
    return null;
  }

  /** ids of pending events no outcome has closed yet (reported; the tap may still seal). */
  unpaired(): string[] {
    const closed = this.closedRefs();
    return this.events.filter((e) => this.attr(e, "pi_phase") === PHASE_OPEN && !closed.has(this.attr(e, "pi_hash") as string)).map((e) => e.id);
  }

  /** seal once: no further ingest; returns the head hash. */
  seal(): string {
    if (this.sealed) throw new Error("tap already sealed");
    this.sealed = true;
    return this.last;
  }

  toOcel(): OcelDoc {
    return {
      objectTypes: OBJECT_TYPES.map((name) => ({ name, attributes: [] })),
      eventTypes: EVENT_TYPES.map((name) => ({ name, attributes: [] })),
      objects: [...this.objects].map(([id, type]) => ({ id, type, attributes: [], relationships: [] })),
      events: this.events,
    };
  }

  serialize(): string {
    return JSON.stringify(this.toOcel());
  }
}

/** Recompute the chain over a serialized OCEL document and enforce phase pairing. Null when intact, else the reason. */
export function verifyChain(doc: OcelDoc, alg: string): string | null {
  let parent = "";
  const seen = new Map<string, OcelEvent>();
  const used = new Set<string>();
  for (const e of doc.events) {
    const attr = (n: string) => e.attributes.find((a) => a.name === n)?.value;
    const phase = PHASED[e.type] ?? "";
    const ref = attr("pi_pending_ref") ?? "";
    if (attr("pi_parent") !== parent) return "parent mismatch at " + e.id;
    const want = hashHex(alg, parent + "\n" + canon(e, attr("pi_phase") ?? "", ref));
    if (attr("pi_hash") !== want) return "hash mismatch at " + e.id;
    if ((attr("pi_phase") ?? "") !== phase) return "phase mismatch at " + e.id;
    if (phase === PHASE_OPEN) {
      if (ref) return "pairing mismatch at " + e.id;
      seen.set(want, e);
    } else if (phase === PHASE_CLOSE) {
      const p = seen.get(ref);
      if (!p || used.has(ref) || !closesPair(e.type, p.type) || objectSet(p.relationships) !== objectSet(e.relationships)) return "pairing mismatch at " + e.id;
      used.add(ref);
    }
    parent = want;
  }
  return null;
}

