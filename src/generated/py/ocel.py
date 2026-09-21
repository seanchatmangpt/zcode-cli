# Generated OCEL 2.0 type registry, source adapter, event-tap mapper, serializer and hash chain.
# Source of truth: the consumer's pi: individuals. Do not edit.
import hashlib
import json

EVENT_TYPES = ["checkpoint_created", "message_removed", "message_upserted", "model_streaming", "part_delta", "part_removed", "part_started", "part_upserted", "permission_requested", "permission_resolved", "place_order", "result", "rewind_triggered", "session_closed", "session_created", "session_resumed", "session_title_updated", "session_updated", "ship_order", "stream_recovery_updated", "tool_updated", "turn_completed", "turn_failed", "turn_started", "turn_steer_drained", "turn_steer_queued", "user_input_requested", "user_input_resolved"]
OBJECT_TYPES = ["item", "model_request", "order", "permission", "session", "subagent", "tool_call", "turn"]
SUPPORTED_HASHES = ["blake2b256", "sha256"]
SOURCES = [
    {"id": "order_hook", "kind": "hook", "nameField": "event", "idField": "id", "timeField": "ts", "hash": "sha256"},
    {"id": "zcode_app_server", "kind": "app-server-subscription", "nameField": "params.type", "idField": "params.eventId", "timeField": "params.timestamp", "hash": "sha256"},
    {"id": "zcode_stream", "kind": "stream-json", "nameField": "type", "idField": "eventId", "timeField": "timestamp", "hash": "sha256"},
]
RULES = [
    {"rule": "app-checkpoint_created", "source": "zcode_app_server", "name": "checkpoint.created", "event": "checkpoint_created", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-checkpoint_created", "source": "zcode_app_server", "name": "checkpoint.created", "event": "checkpoint_created", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-message_removed", "source": "zcode_app_server", "name": "message.removed", "event": "message_removed", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-message_removed", "source": "zcode_app_server", "name": "message.removed", "event": "message_removed", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-message_upserted", "source": "zcode_app_server", "name": "message.upserted", "event": "message_upserted", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-message_upserted", "source": "zcode_app_server", "name": "message.upserted", "event": "message_upserted", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-model_streaming", "source": "zcode_app_server", "name": "model.streaming", "event": "model_streaming", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-model_streaming", "source": "zcode_app_server", "name": "model.streaming", "event": "model_streaming", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-part_removed", "source": "zcode_app_server", "name": "part.removed", "event": "part_removed", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-part_removed", "source": "zcode_app_server", "name": "part.removed", "event": "part_removed", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-part_started", "source": "zcode_app_server", "name": "part.started", "event": "part_started", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-part_started", "source": "zcode_app_server", "name": "part.started", "event": "part_started", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-part_upserted", "source": "zcode_app_server", "name": "part.upserted", "event": "part_upserted", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-part_upserted", "source": "zcode_app_server", "name": "part.upserted", "event": "part_upserted", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-permission_requested", "source": "zcode_app_server", "name": "permission.requested", "event": "permission_requested", "object": "permission", "qualifier": "about_permission", "path": "params.payload.requestId"},
    {"rule": "app-permission_requested", "source": "zcode_app_server", "name": "permission.requested", "event": "permission_requested", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-permission_requested", "source": "zcode_app_server", "name": "permission.requested", "event": "permission_requested", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-permission_resolved", "source": "zcode_app_server", "name": "permission.resolved", "event": "permission_resolved", "object": "permission", "qualifier": "about_permission", "path": "params.payload.requestId"},
    {"rule": "app-permission_resolved", "source": "zcode_app_server", "name": "permission.resolved", "event": "permission_resolved", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-permission_resolved", "source": "zcode_app_server", "name": "permission.resolved", "event": "permission_resolved", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-rewind_triggered", "source": "zcode_app_server", "name": "rewind.triggered", "event": "rewind_triggered", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-rewind_triggered", "source": "zcode_app_server", "name": "rewind.triggered", "event": "rewind_triggered", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-session_closed", "source": "zcode_app_server", "name": "session.closed", "event": "session_closed", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-session_closed", "source": "zcode_app_server", "name": "session.closed", "event": "session_closed", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-session_created", "source": "zcode_app_server", "name": "session.created", "event": "session_created", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-session_created", "source": "zcode_app_server", "name": "session.created", "event": "session_created", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-session_resumed", "source": "zcode_app_server", "name": "session.resumed", "event": "session_resumed", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-session_resumed", "source": "zcode_app_server", "name": "session.resumed", "event": "session_resumed", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-session_title_updated", "source": "zcode_app_server", "name": "session.titleUpdated", "event": "session_title_updated", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-session_title_updated", "source": "zcode_app_server", "name": "session.titleUpdated", "event": "session_title_updated", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-session_updated", "source": "zcode_app_server", "name": "session.updated", "event": "session_updated", "object": "model_request", "qualifier": "about_model_request", "path": "params.payload.requestId"},
    {"rule": "app-session_updated", "source": "zcode_app_server", "name": "session.updated", "event": "session_updated", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-session_updated", "source": "zcode_app_server", "name": "session.updated", "event": "session_updated", "object": "subagent", "qualifier": "by_subagent", "path": "params.payload.agentId"},
    {"rule": "app-session_updated", "source": "zcode_app_server", "name": "session.updated", "event": "session_updated", "object": "tool_call", "qualifier": "about_tool_call", "path": "params.payload.toolCallId"},
    {"rule": "app-session_updated", "source": "zcode_app_server", "name": "session.updated", "event": "session_updated", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-stream_recovery_updated", "source": "zcode_app_server", "name": "streamRecovery.updated", "event": "stream_recovery_updated", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-stream_recovery_updated", "source": "zcode_app_server", "name": "streamRecovery.updated", "event": "stream_recovery_updated", "object": "tool_call", "qualifier": "about_tool_call", "path": "params.payload.toolCallId"},
    {"rule": "app-stream_recovery_updated", "source": "zcode_app_server", "name": "streamRecovery.updated", "event": "stream_recovery_updated", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-tool_updated", "source": "zcode_app_server", "name": "tool.updated", "event": "tool_updated", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-tool_updated", "source": "zcode_app_server", "name": "tool.updated", "event": "tool_updated", "object": "tool_call", "qualifier": "about_tool_call", "path": "params.payload.toolCallId"},
    {"rule": "app-tool_updated", "source": "zcode_app_server", "name": "tool.updated", "event": "tool_updated", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-turn_completed", "source": "zcode_app_server", "name": "turn.completed", "event": "turn_completed", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-turn_completed", "source": "zcode_app_server", "name": "turn.completed", "event": "turn_completed", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-turn_failed", "source": "zcode_app_server", "name": "turn.failed", "event": "turn_failed", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-turn_failed", "source": "zcode_app_server", "name": "turn.failed", "event": "turn_failed", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-turn_started", "source": "zcode_app_server", "name": "turn.started", "event": "turn_started", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-turn_started", "source": "zcode_app_server", "name": "turn.started", "event": "turn_started", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-turn_steer_drained", "source": "zcode_app_server", "name": "turn.steerDrained", "event": "turn_steer_drained", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-turn_steer_drained", "source": "zcode_app_server", "name": "turn.steerDrained", "event": "turn_steer_drained", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-turn_steer_queued", "source": "zcode_app_server", "name": "turn.steerQueued", "event": "turn_steer_queued", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-turn_steer_queued", "source": "zcode_app_server", "name": "turn.steerQueued", "event": "turn_steer_queued", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-user_input_requested", "source": "zcode_app_server", "name": "userInput.requested", "event": "user_input_requested", "object": "permission", "qualifier": "about_permission", "path": "params.payload.requestId"},
    {"rule": "app-user_input_requested", "source": "zcode_app_server", "name": "userInput.requested", "event": "user_input_requested", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-user_input_requested", "source": "zcode_app_server", "name": "userInput.requested", "event": "user_input_requested", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "app-user_input_resolved", "source": "zcode_app_server", "name": "userInput.resolved", "event": "user_input_resolved", "object": "permission", "qualifier": "about_permission", "path": "params.payload.requestId"},
    {"rule": "app-user_input_resolved", "source": "zcode_app_server", "name": "userInput.resolved", "event": "user_input_resolved", "object": "session", "qualifier": "in_session", "path": "params.sessionId"},
    {"rule": "app-user_input_resolved", "source": "zcode_app_server", "name": "userInput.resolved", "event": "user_input_resolved", "object": "turn", "qualifier": "in_turn", "path": "params.turnId"},
    {"rule": "rule-place", "source": "order_hook", "name": "order.placed", "event": "place_order", "object": "item", "qualifier": "contains", "path": "items"},
    {"rule": "rule-place", "source": "order_hook", "name": "order.placed", "event": "place_order", "object": "order", "qualifier": "subject", "path": "order.id"},
    {"rule": "rule-ship", "source": "order_hook", "name": "order.shipped", "event": "ship_order", "object": "order", "qualifier": "subject", "path": "order.id"},
    {"rule": "stream-checkpoint_created", "source": "zcode_stream", "name": "checkpoint.created", "event": "checkpoint_created", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-checkpoint_created", "source": "zcode_stream", "name": "checkpoint.created", "event": "checkpoint_created", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-message_removed", "source": "zcode_stream", "name": "message.removed", "event": "message_removed", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-message_removed", "source": "zcode_stream", "name": "message.removed", "event": "message_removed", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-message_upserted", "source": "zcode_stream", "name": "message.upserted", "event": "message_upserted", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-message_upserted", "source": "zcode_stream", "name": "message.upserted", "event": "message_upserted", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-model_streaming", "source": "zcode_stream", "name": "model.streaming", "event": "model_streaming", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-model_streaming", "source": "zcode_stream", "name": "model.streaming", "event": "model_streaming", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-part_removed", "source": "zcode_stream", "name": "part.removed", "event": "part_removed", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-part_removed", "source": "zcode_stream", "name": "part.removed", "event": "part_removed", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-part_started", "source": "zcode_stream", "name": "part.started", "event": "part_started", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-part_started", "source": "zcode_stream", "name": "part.started", "event": "part_started", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-part_upserted", "source": "zcode_stream", "name": "part.upserted", "event": "part_upserted", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-part_upserted", "source": "zcode_stream", "name": "part.upserted", "event": "part_upserted", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-permission_requested", "source": "zcode_stream", "name": "permission.requested", "event": "permission_requested", "object": "permission", "qualifier": "about_permission", "path": "payload.requestId"},
    {"rule": "stream-permission_requested", "source": "zcode_stream", "name": "permission.requested", "event": "permission_requested", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-permission_requested", "source": "zcode_stream", "name": "permission.requested", "event": "permission_requested", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-permission_resolved", "source": "zcode_stream", "name": "permission.resolved", "event": "permission_resolved", "object": "permission", "qualifier": "about_permission", "path": "payload.requestId"},
    {"rule": "stream-permission_resolved", "source": "zcode_stream", "name": "permission.resolved", "event": "permission_resolved", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-permission_resolved", "source": "zcode_stream", "name": "permission.resolved", "event": "permission_resolved", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-rewind_triggered", "source": "zcode_stream", "name": "rewind.triggered", "event": "rewind_triggered", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-rewind_triggered", "source": "zcode_stream", "name": "rewind.triggered", "event": "rewind_triggered", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-session_closed", "source": "zcode_stream", "name": "session.closed", "event": "session_closed", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-session_closed", "source": "zcode_stream", "name": "session.closed", "event": "session_closed", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-session_created", "source": "zcode_stream", "name": "session.created", "event": "session_created", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-session_created", "source": "zcode_stream", "name": "session.created", "event": "session_created", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-session_resumed", "source": "zcode_stream", "name": "session.resumed", "event": "session_resumed", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-session_resumed", "source": "zcode_stream", "name": "session.resumed", "event": "session_resumed", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-session_title_updated", "source": "zcode_stream", "name": "session.titleUpdated", "event": "session_title_updated", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-session_title_updated", "source": "zcode_stream", "name": "session.titleUpdated", "event": "session_title_updated", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-session_updated", "source": "zcode_stream", "name": "session.updated", "event": "session_updated", "object": "model_request", "qualifier": "about_model_request", "path": "payload.requestId"},
    {"rule": "stream-session_updated", "source": "zcode_stream", "name": "session.updated", "event": "session_updated", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-session_updated", "source": "zcode_stream", "name": "session.updated", "event": "session_updated", "object": "subagent", "qualifier": "by_subagent", "path": "payload.agentId"},
    {"rule": "stream-session_updated", "source": "zcode_stream", "name": "session.updated", "event": "session_updated", "object": "tool_call", "qualifier": "about_tool_call", "path": "payload.toolCallId"},
    {"rule": "stream-session_updated", "source": "zcode_stream", "name": "session.updated", "event": "session_updated", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-stream_recovery_updated", "source": "zcode_stream", "name": "streamRecovery.updated", "event": "stream_recovery_updated", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-stream_recovery_updated", "source": "zcode_stream", "name": "streamRecovery.updated", "event": "stream_recovery_updated", "object": "tool_call", "qualifier": "about_tool_call", "path": "payload.toolCallId"},
    {"rule": "stream-stream_recovery_updated", "source": "zcode_stream", "name": "streamRecovery.updated", "event": "stream_recovery_updated", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-tool_updated", "source": "zcode_stream", "name": "tool.updated", "event": "tool_updated", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-tool_updated", "source": "zcode_stream", "name": "tool.updated", "event": "tool_updated", "object": "tool_call", "qualifier": "about_tool_call", "path": "payload.toolCallId"},
    {"rule": "stream-tool_updated", "source": "zcode_stream", "name": "tool.updated", "event": "tool_updated", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-turn_completed", "source": "zcode_stream", "name": "turn.completed", "event": "turn_completed", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-turn_completed", "source": "zcode_stream", "name": "turn.completed", "event": "turn_completed", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-turn_failed", "source": "zcode_stream", "name": "turn.failed", "event": "turn_failed", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-turn_failed", "source": "zcode_stream", "name": "turn.failed", "event": "turn_failed", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-turn_started", "source": "zcode_stream", "name": "turn.started", "event": "turn_started", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-turn_started", "source": "zcode_stream", "name": "turn.started", "event": "turn_started", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-turn_steer_drained", "source": "zcode_stream", "name": "turn.steerDrained", "event": "turn_steer_drained", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-turn_steer_drained", "source": "zcode_stream", "name": "turn.steerDrained", "event": "turn_steer_drained", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-turn_steer_queued", "source": "zcode_stream", "name": "turn.steerQueued", "event": "turn_steer_queued", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-turn_steer_queued", "source": "zcode_stream", "name": "turn.steerQueued", "event": "turn_steer_queued", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-user_input_requested", "source": "zcode_stream", "name": "userInput.requested", "event": "user_input_requested", "object": "permission", "qualifier": "about_permission", "path": "payload.requestId"},
    {"rule": "stream-user_input_requested", "source": "zcode_stream", "name": "userInput.requested", "event": "user_input_requested", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-user_input_requested", "source": "zcode_stream", "name": "userInput.requested", "event": "user_input_requested", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
    {"rule": "stream-user_input_resolved", "source": "zcode_stream", "name": "userInput.resolved", "event": "user_input_resolved", "object": "permission", "qualifier": "about_permission", "path": "payload.requestId"},
    {"rule": "stream-user_input_resolved", "source": "zcode_stream", "name": "userInput.resolved", "event": "user_input_resolved", "object": "session", "qualifier": "in_session", "path": "sessionId"},
    {"rule": "stream-user_input_resolved", "source": "zcode_stream", "name": "userInput.resolved", "event": "user_input_resolved", "object": "turn", "qualifier": "in_turn", "path": "turnId"},
]
PHASE_OPEN = "pending"
PHASE_CLOSE = "outcome"
PHASED = {
}
CLOSES = {
}

CALLBACK_KINDS = ("sdk-callback", "app-server-subscription")


def hash_hex(alg, data):
    if alg == "blake2b256":
        return hashlib.blake2b(data.encode("utf-8"), digest_size=32).hexdigest()
    if alg == "sha256":
        return hashlib.sha256(data.encode("utf-8")).hexdigest()
    raise ValueError("unsupported hash algorithm: " + alg)


def _s(v):
    return json.dumps(v, ensure_ascii=False)


def canon(e, phase="", ref=""):
    """Canonical form: keys sorted, no whitespace. Identical across all generated languages.
    A phased event (phase != "") additionally binds pendingRef and phase into the digest."""
    rels = ",".join(
        '{"objectId":' + _s(r["objectId"]) + ',"qualifier":' + _s(r["qualifier"]) + "}"
        for r in e["relationships"]
    )
    bound = ',"pendingRef":' + _s(ref) + ',"phase":' + _s(phase) if phase else ""
    return '{"id":' + _s(e["id"]) + bound + ',"relationships":[' + rels + '],"time":' + _s(e["time"]) + ',"type":' + _s(e["type"]) + "}"


def _get_path(raw, path):
    cur = raw
    for k in path.split("."):
        if not isinstance(cur, dict) or k not in cur:
            return None
        cur = cur[k]
    return cur


def _ids(v):
    if v is None:
        return []
    return [_str(x) for x in (v if isinstance(v, list) else [v])]


def _str(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v == int(v):
        return str(int(v))
    return str(v)


def _flatten_otel(raw):
    attrs = raw.get("attributes")
    if not isinstance(attrs, list):
        return raw
    flat = {}
    for kv in attrs:
        v = kv.get("value")
        if isinstance(v, dict):
            for k in ("stringValue", "intValue", "boolValue", "doubleValue"):
                if k in v:
                    v = v[k]
                    break
        flat[kv["key"]] = v
    return {**raw, "attributes": flat}


class Tap:
    def __init__(self, source_id):
        found = [s for s in SOURCES if s["id"] == source_id]
        if not found:
            raise ValueError("unknown source: " + source_id)
        self.spec = found[0]
        self.events = []
        self.objects = {}
        self.last = ""
        self.sealed = False
        self.orphans = []

    def ingest(self, data):
        """stream-json: pass newline-delimited text. every other kind: pass one parsed record."""
        if self.sealed:
            raise RuntimeError("tap sealed")
        if self.spec["kind"] == "stream-json":
            if not isinstance(data, str):
                raise TypeError("stream-json expects text")
            records = [json.loads(line) for line in data.split("\n") if line.strip()]
        else:
            if isinstance(data, str):
                raise TypeError(self.spec["kind"] + " expects a parsed record")
            records = [data]
        out = []
        for r in records:
            e = self._append(r)
            if e is not None:
                out.append(e)
        return out

    def attach(self, register):
        """sdk-callback and app-server-subscription: hand the runtime a callback."""
        if self.spec["kind"] not in CALLBACK_KINDS:
            raise ValueError(self.spec["kind"] + " has no callback attachment")
        register(lambda record: self.ingest(record))

    def _append(self, raw):
        if self.spec["kind"] == "otel":
            raw = _flatten_otel(raw)
        name = _get_path(raw, self.spec["nameField"])
        ident = _get_path(raw, self.spec["idField"])
        when = _get_path(raw, self.spec["timeField"])
        if name is None or ident is None or when is None:
            return None
        rs = [r for r in RULES if r["source"] == self.spec["id"] and r["name"] == _str(name)]
        if not rs:
            return None
        rels = []
        found = []
        for r in rs:
            for oid in _ids(_get_path(raw, r["path"])):
                rels.append({"objectId": oid, "qualifier": r["qualifier"]})
                found.append((oid, r["object"]))
        etype = rs[0]["event"]
        phase = PHASED.get(etype, "")
        ref = ""
        if phase == PHASE_CLOSE:
            pending = self._open_pending(etype, rels)
            if pending is None:
                self.orphans.append(_str(ident))  # outcome with no open pending: reported, not emitted
                return None
            ref = pending["pi_hash"]
        for oid, otype in found:
            self.objects.setdefault(oid, otype)
        base = {"id": _str(ident), "type": etype, "time": _str(when), "relationships": rels}
        parent = self.last
        digest = hash_hex(self.spec["hash"], parent + "\n" + canon(base, phase, ref))
        self.last = digest
        attrs = [
            {"name": "pi_parent", "value": parent},
            {"name": "pi_hash", "value": digest},
            {"name": "pi_hash_alg", "value": self.spec["hash"]},
        ]
        if phase:
            attrs.append({"name": "pi_phase", "value": phase})
        if phase == PHASE_CLOSE:
            attrs.append({"name": "pi_pending_ref", "value": ref})
        ev = {**base, "attributes": attrs}
        self.events.append(ev)
        return ev

    def _open_pending(self, outcome_type, rels):
        """Oldest pending event this outcome type may close, over the same object set."""
        closed = {a["value"] for e in self.events for a in e["attributes"] if a["name"] == "pi_pending_ref"}
        want = sorted(r["objectId"] for r in rels)
        for e in self.events:
            attr = {a["name"]: a["value"] for a in e["attributes"]}
            if (attr.get("pi_phase") == PHASE_OPEN and attr["pi_hash"] not in closed
                    and (outcome_type, e["type"]) in CLOSES
                    and sorted(r["objectId"] for r in e["relationships"]) == want):
                return attr
        return None

    def unpaired(self):
        """ids of pending events no outcome has closed yet (reported; the tap may still seal)."""
        closed = {a["value"] for e in self.events for a in e["attributes"] if a["name"] == "pi_pending_ref"}
        return [e["id"] for e in self.events
                if any(a["name"] == "pi_phase" and a["value"] == PHASE_OPEN for a in e["attributes"])
                and next(a["value"] for a in e["attributes"] if a["name"] == "pi_hash") not in closed]

    def seal(self):
        """seal once: no further ingest; returns the head hash."""
        if self.sealed:
            raise RuntimeError("tap already sealed")
        self.sealed = True
        return self.last

    def to_ocel(self):
        return {
            "objectTypes": [{"name": n, "attributes": []} for n in OBJECT_TYPES],
            "eventTypes": [{"name": n, "attributes": []} for n in EVENT_TYPES],
            "objects": [{"id": i, "type": t, "attributes": [], "relationships": []} for i, t in self.objects.items()],
            "events": self.events,
        }

    def serialize(self):
        return json.dumps(self.to_ocel(), ensure_ascii=False)


def verify_chain(doc, alg):
    """Recompute the chain over an OCEL document and enforce phase pairing. None when intact, else the reason."""
    parent = ""
    seen = {}
    used = set()
    for e in doc["events"]:
        attr = {a["name"]: a["value"] for a in e["attributes"]}
        phase = PHASED.get(e["type"], "")
        ref = attr.get("pi_pending_ref", "")
        if attr.get("pi_parent") != parent:
            return "parent mismatch at " + e["id"]
        want = hash_hex(alg, parent + "\n" + canon(e, attr.get("pi_phase", ""), ref))
        if attr.get("pi_hash") != want:
            return "hash mismatch at " + e["id"]
        if attr.get("pi_phase", "") != phase:
            return "phase mismatch at " + e["id"]
        if phase == PHASE_OPEN:
            if ref:
                return "pairing mismatch at " + e["id"]
            seen[want] = e
        elif phase == PHASE_CLOSE:
            p = seen.get(ref)
            ok = (p is not None and ref not in used and (e["type"], p["type"]) in CLOSES
                  and sorted(r["objectId"] for r in p["relationships"]) == sorted(r["objectId"] for r in e["relationships"]))
            if not ok:
                return "pairing mismatch at " + e["id"]
            used.add(ref)
        parent = want
    return None
