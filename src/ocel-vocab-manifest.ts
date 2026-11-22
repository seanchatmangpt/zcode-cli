// Shared-vocabulary manifest: zcode-cli generated OCEL registries vs beam4pm CastleOcel.
// Provenance: CastleOcel vocabulary read from beam4pm lib/beam4pm_castle_ocel.ex
// (closed vocabulary per its moduledoc: "It shares the OCEL wire shapes but NO
// event names with BeamPM.GallOcel"). zcode side: src/generated/ocel.ts
// EVENT_TYPES (31) / OBJECT_TYPES (16). The drift test
// test/ocel-vocab-manifest.test.ts refuses any classification that no longer
// matches the live registries, so a new type cannot land unclassified.
// Pack demo place_order/ship_order/order/item quarantined (process-intelligence-pack
// examples/order-hook.ttl); falsifier_run kept — gall-work emits falsifier.run.
// ELIMINATE-3: part_delta / result omitted (never Tap-emitted; OMITTED_WIRE).

/** zcode-cli event type -> classification vs CastleOcel event vocabulary. */
export const EVENT_CLASSIFICATION: Record<string, "shared" | "disjoint" | "deliberate-local"> = {
  checkpoint_created: "disjoint",
  execution_crash: "disjoint",
  falsifier_run: "disjoint",
  message_removed: "disjoint",
  message_upserted: "disjoint",
  model_streaming: "disjoint",
  part_removed: "disjoint",
  part_started: "disjoint",
  part_upserted: "disjoint",
  permission_requested: "disjoint",
  permission_resolved: "disjoint",
  provider_replace: "disjoint",
  provider_select: "disjoint",
  receipt_persist: "disjoint",
  reobserve: "disjoint",
  rewind_triggered: "disjoint",
  session_closed: "disjoint",
  session_created: "disjoint",
  session_resumed: "disjoint",
  session_title_updated: "disjoint",
  session_updated: "disjoint",
  stream_recovery_updated: "disjoint",
  tool_updated: "disjoint",
  turn_completed: "disjoint",
  turn_failed: "disjoint",
  turn_started: "disjoint",
  turn_steer_drained: "disjoint",
  turn_steer_queued: "disjoint",
  user_input_requested: "disjoint",
  user_input_resolved: "disjoint",
  worker_claim: "disjoint",
};

/** zcode-cli object type -> classification vs CastleOcel object vocabulary. */
export const OBJECT_CLASSIFICATION: Record<string, "shared" | "disjoint" | "deliberate-local"> = {
  authority: "disjoint",
  base: "disjoint",
  epoch: "disjoint",
  lease: "disjoint",
  model_request: "disjoint",
  permission: "disjoint",
  provider: "disjoint",
  receipt: "disjoint",
  session: "disjoint",
  subagent: "disjoint",
  subject: "disjoint",
  tool_call: "disjoint",
  turn: "disjoint",
  user_input: "disjoint",
  work_order: "disjoint",
  worker: "disjoint",
};

/**
 * beam4pm BeamPM.CastleOcel closed vocabularies, pinned verbatim (see
 * `event_names/0` / `object_types/0` in lib/beam4pm_castle_ocel.ex at the SHA
 * recorded in the lane receipt). Updated only by re-reading the source.
 */
export const CASTLE_EVENT_TYPES: string[] = [
  "system_bootstrapped",
  "pod_provisioned",
  "container_started",
  "ggen_sync_observed",
  "activity_started",
  "activity_finished",
  "episode_recorded",
  "evidence_admitted",
  "episode_receipt_sealed",
  "refused_observation",
];

export const CASTLE_OBJECT_TYPES: string[] = [
  "system",
  "pod",
  "container",
  "gym_act_episode",
];

export type VocabClass = "shared" | "disjoint" | "deliberate-local";
