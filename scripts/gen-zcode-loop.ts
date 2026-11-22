// Emits the DRAFT consumer ontology ontology/zcode-loop.ttl from the runtime's own event enums.
// The object mapping policy below is the reviewable part of the draft; everything else is read
// from vendor/zcode.cjs. Run: bun scripts/gen-zcode-loop.ts  (writes ontology/zcode-loop.ttl)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readRuntimeEvents, wireOf } from "./zcode-events.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Envelope-only event that stream-json appends after the last turn event (not in the wire enum).
const STREAM_ONLY = ["result"];

// Wire events deliberately kept out of the OCEL log, with the reason.
// Completeness tradeoff: EventType still emitted for wire-alphabet closure;
// RuntimeEvent is pi:Unmapped so Tap drops the name (FILTER_BIAS deliberate).
const UNMAPPED: Record<string, string> = {
  "part.delta":
    "token-level content delta; surrounding part.upserted/tool.updated carry the process step. EventType-part-delta kept for wire-alphabet completeness; Tap drops this name (FILTER_BIAS deliberate).",
  result:
    "end-of-run summary envelope; duplicates turn.completed and adds no process step. EventType-result kept for wire-alphabet completeness; Tap drops this name (FILTER_BIAS deliberate)."
};

type Rel = { object: string; qualifier: string; path: string };
const OBJECTS = ["session", "turn", "tool_call", "model_request", "subagent", "permission"] as const;
const QUALIFIERS: Record<(typeof OBJECTS)[number], string> = {
  session: "in_session",
  turn: "in_turn",
  tool_call: "about_tool_call",
  model_request: "about_model_request",
  subagent: "by_subagent",
  permission: "about_permission"
};
const PATHS: Record<(typeof OBJECTS)[number], string> = {
  session: "sessionId",
  turn: "turnId",
  tool_call: "payload.toolCallId",
  model_request: "payload.requestId",
  subagent: "payload.agentId",
  permission: "payload.requestId"
};

// Lease identity case notions (Explore 21cd2acc): work_order id is the sjira IRI;
// epoch / subject / base are distinct objects with namespaced ids (epoch:/subj:/base:),
// never collapsed into wo:${epoch}. Injected on stream + app + gall sources when present.
const IDENTITY_OBJECTS = ["work_order", "epoch", "subject", "base"] as const;
const IDENTITY_QUALIFIERS: Record<(typeof IDENTITY_OBJECTS)[number], string> = {
  work_order: "subject",
  epoch: "on_epoch",
  subject: "about_subject",
  base: "about_base"
};
const IDENTITY_PATHS: Record<(typeof IDENTITY_OBJECTS)[number], string> = {
  work_order: "work_order_iri",
  epoch: "epoch",
  subject: "subject",
  base: "base"
};
// Which objects each wire event relates. session + turn always; the rest where the payload carries the id.
function objectsFor(wire: string): (typeof OBJECTS)[number][] {
  const base: (typeof OBJECTS)[number][] = ["session", "turn"];
  if (wire === "session.updated") return [...base, "tool_call", "model_request", "subagent"];
  if (wire === "tool.updated" || wire === "streamRecovery.updated") return [...base, "tool_call"];
  if (wire.startsWith("permission.") || wire.startsWith("userInput.")) return [...base, "permission"];
  return base;
}

const snake = (wire: string) => wire.replace(/\./g, "_").replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const local = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-");
const q = (s: string) => JSON.stringify(s);

/** ALOOP gall-work lifecycle verbs (hand-authored; not present in vendor wire enums). */
const GALL_IDENTITY_RELS =
  "zl:Rel-Gall-work_order , zl:Rel-Gall-epoch , zl:Rel-Gall-subject , zl:Rel-Gall-base";
const GALL_WORK_EVENTS: ReadonlyArray<{
  wire: string;
  typeId: string;
  rels: string;
}> = [
  { wire: "provider.select", typeId: "provider_select", rels: `zl:Rel-Gall-provider , ${GALL_IDENTITY_RELS} , zl:Rel-Gall-authority` },
  { wire: "provider.replace", typeId: "provider_replace", rels: `zl:Rel-Gall-provider , zl:Rel-Gall-replaces-from , ${GALL_IDENTITY_RELS}` },
  { wire: "worker.claim", typeId: "worker_claim", rels: `zl:Rel-Gall-lease , zl:Rel-Gall-provider , zl:Rel-Gall-worker , ${GALL_IDENTITY_RELS} , zl:Rel-Gall-authority` },
  { wire: "execution.crash", typeId: "execution_crash", rels: `zl:Rel-Gall-lease , zl:Rel-Gall-provider , zl:Rel-Gall-worker , ${GALL_IDENTITY_RELS}` },
  { wire: "receipt.persist", typeId: "receipt_persist", rels: `zl:Rel-Gall-receipt , zl:Rel-Gall-lease , zl:Rel-Gall-provider , ${GALL_IDENTITY_RELS} , zl:Rel-Gall-authority` },
  { wire: "falsifier.run", typeId: "falsifier_run", rels: `zl:Rel-Gall-lease , zl:Rel-Gall-provider , zl:Rel-Gall-worker , ${GALL_IDENTITY_RELS}` },
  { wire: "reobserve", typeId: "reobserve", rels: `zl:Rel-Gall-lease , zl:Rel-Gall-provider , ${GALL_IDENTITY_RELS}` }
];

function emitGallWorkHook(w: (s?: string) => void): void {
  w("# ===== execution-provider / worker lifecycle (ALOOP vocabulary, gall-work hook) =====");
  w("# Emitted by the gall-work orchestrator (ZCODE_OCEL=1) as one hook record per");
  w("# lifecycle transition: {event, id, ts, epoch_id, worker_id, ...}. The dotted");
  w("# sourceEvent names are the ALOOP canonical verbs; the OCEL event type ids are");
  w("# their snake_case projections, matching the repo convention.");
  w("# work_order object id is work_order_iri (sjira IRI); epoch/subject/base are");
  w("# distinct E2O targets — never wo:${epoch} (Explore 21cd2acc).");
  w('zl:Source-GallWorkHook a pi:EventSource ; pi:sourceId "gall_work" ; pi:sourceKind "hook" ;');
  w('  pi:nameField "event" ; pi:idField "id" ; pi:timeField "ts" ; pi:chainPolicy zl:ChainPolicy ;');
  w('  rdfs:comment "gall-work orchestrator lifecycle: provider selection, worker claim, execution crash, receipt persistence, falsifier run, provider replacement, stale-lease reobservation (ALOOP-ZCODE-DOGFOOD-001)" .');
  w();
  // work_order / epoch / subject / base are declared with stream identity objects above.
  for (const o of ["lease", "provider", "worker", "receipt", "authority"]) {
    w(`zl:ObjectType-${o} a pi:ObjectType ; pi:typeId ${q(o)} .`);
  }
  w();
  w('zl:Qualifier-provider a pi:Qualifier ; pi:qualifierId "provider" .');
  w('zl:Qualifier-worker a pi:Qualifier ; pi:qualifierId "worker" .');
  w('zl:Qualifier-receipt a pi:Qualifier ; pi:qualifierId "receipt" .');
  w('zl:Qualifier-on_lease a pi:Qualifier ; pi:qualifierId "on_lease" .');
  w('zl:Qualifier-origin_authority a pi:Qualifier ; pi:qualifierId "originAuthority" .');
  w('zl:Qualifier-replaces_from a pi:Qualifier ; pi:qualifierId "replaces_from" .');
  w();
  w('zl:Rel-Gall-work_order a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-work_order ; pi:hasQualifier pi:Qualifier-Subject ; pi:objectIdPath "work_order_iri" .');
  w('zl:Rel-Gall-epoch a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-epoch ; pi:hasQualifier zl:Qualifier-on_epoch ; pi:objectIdPath "epoch" .');
  w('zl:Rel-Gall-subject a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-subject ; pi:hasQualifier zl:Qualifier-about_subject ; pi:objectIdPath "subject" .');
  w('zl:Rel-Gall-base a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-base ; pi:hasQualifier zl:Qualifier-about_base ; pi:objectIdPath "base" .');
  w('zl:Rel-Gall-provider a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-provider ; pi:hasQualifier zl:Qualifier-provider ; pi:objectIdPath "provider" .');
  w('zl:Rel-Gall-worker a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-worker ; pi:hasQualifier zl:Qualifier-worker ; pi:objectIdPath "worker" .');
  w('zl:Rel-Gall-receipt a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-receipt ; pi:hasQualifier zl:Qualifier-receipt ; pi:objectIdPath "receipt" .');
  w('zl:Rel-Gall-lease a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-lease ; pi:hasQualifier zl:Qualifier-on_lease ; pi:objectIdPath "lease" .');
  w('zl:Rel-Gall-authority a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-authority ; pi:hasQualifier zl:Qualifier-origin_authority ; pi:objectIdPath "origin_authority" .');
  w('zl:Rel-Gall-replaces-from a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-provider ; pi:hasQualifier zl:Qualifier-replaces_from ; pi:objectIdPath "from_provider" .');
  w();
  for (const ev of GALL_WORK_EVENTS) {
    w(`zl:EventType-${local(ev.typeId)} a pi:EventType ; pi:typeId ${q(ev.typeId)} .`);
  }
  w();
  for (const ev of GALL_WORK_EVENTS) {
    const ruleId = `gall-${ev.typeId}`;
    w(`zl:Rule-Gall-${local(ev.typeId)} a pi:MappingRule ; pi:ruleId ${q(ruleId)} ; pi:fromSource zl:Source-GallWorkHook ; pi:sourceEvent ${q(ev.wire)} ;`);
    w(`  pi:emitsEventType zl:EventType-${local(ev.typeId)} ; pi:hasRelation ${ev.rels} .`);
    w(`zl:RuntimeEvent-Gall-${local(ev.typeId)} a pi:RuntimeEvent ; pi:runtimeEventName ${q(ev.wire)} ; pi:emittedBy zl:Source-GallWorkHook .`);
  }
}

const events = readRuntimeEvents();
const wires = [...events.wire, ...STREAM_ONLY];

const out: string[] = [];
const w = (s = "") => out.push(s);

w("# DRAFT consumer ontology for the zcode agent runtime loop.");
w("# Generated by scripts/gen-zcode-loop.ts from vendor/zcode.cjs (internal enum W, wire enum, wire projection).");
w("# Review status: VERIFIED. Object paths for both stream-json and app-server subscription (session/event params.*) are verified against live runtime capture and fixtures.");
w("@prefix zl: <https://zcode.dev/ontology/zcode-loop#> .");
w("@prefix pi: <https://ggen.dev/ontology/process-intelligence#> .");
w("@prefix st: <https://ggen.dev/ontology/state-transition#> .");
w("@prefix es: <https://ggen.dev/ontology/evidence-standing#> .");
w("@prefix sp: <http://seanchatmangpt.github.io/packs/shacl-projection#> .");
w("@prefix sh: <http://www.w3.org/ns/shacl#> .");
w("@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .");
w("@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .");
w("@prefix ex: <https://zcode.dev/ontology/zcode-loop/shape#> .");
w();
w("# ===== chain policy (sha256; Bun 1.3.7 has no BLAKE3, no new deps) =====");
w('zl:ChainPolicy a pi:ChainPolicy ; pi:hashAlgorithm "sha256" ; pi:targetLanguage "ts" , "py" , "rs" , "ex" .');
w('zl:StChainPolicy a st:ChainPolicy ; st:chosenAlgo "sha256" ; st:policyPrecedence 10 ; st:policyLanguage "ts" , "py" , "rs" , "ex" .');
w("zl:EsChainPolicy a es:ChainPolicy ; es:hashAlgorithm es:Sha256 ; es:canonicalization es:CanonLinesV1 ;");
w('  es:genesisHash "0000000000000000000000000000000000000000000000000000000000000000" ; es:policyPrecedence 10 ;');
w("  es:targetLanguage es:LangTs , es:LangPy , es:LangRs , es:LangEx .");
w();
w("# ===== event sources =====");
w('zl:Source-StreamJson a pi:EventSource ; pi:sourceId "zcode_stream" ; pi:sourceKind "stream-json" ;');
w('  pi:nameField "type" ; pi:idField "eventId" ; pi:timeField "timestamp" ; pi:chainPolicy zl:ChainPolicy ;');
w('  rdfs:comment "zcode -p --output-format stream-json: one wire event per line (VERIFIED against a recorded real run)" .');
w('zl:Source-AppServer a pi:EventSource ; pi:sourceId "zcode_app_server" ; pi:sourceKind "app-server-subscription" ;');
w('  pi:nameField "params.type" ; pi:idField "params.eventId" ; pi:timeField "params.timestamp" ; pi:chainPolicy zl:ChainPolicy ;');
w('  rdfs:comment "zcode app-server event notifications: params carries the wire event (VERIFIED against live vendor/zcode.cjs app-server session/subscribe + session/event capture and test/fixtures/zcode-ocel/app-server-list.jsonocel)" .');
w();
w("# ===== objects and qualifiers =====");
for (const o of OBJECTS) w(`zl:ObjectType-${o} a pi:ObjectType ; pi:typeId ${q(o)} .`);
for (const o of OBJECTS) w(`zl:Qualifier-${QUALIFIERS[o]} a pi:Qualifier ; pi:qualifierId ${q(QUALIFIERS[o])} .`);
w();
w("# ===== lease identity objects (stream + gall; Explore 21cd2acc) =====");
w("# work_order id = work_order_iri; epoch/subject/base use epoch:/subj:/base: namespaces.");
for (const o of IDENTITY_OBJECTS) w(`zl:ObjectType-${o} a pi:ObjectType ; pi:typeId ${q(o)} .`);
for (const o of IDENTITY_OBJECTS) {
  if (IDENTITY_QUALIFIERS[o] === "subject") continue; // pi:Qualifier-Subject
  w(`zl:Qualifier-${IDENTITY_QUALIFIERS[o]} a pi:Qualifier ; pi:qualifierId ${q(IDENTITY_QUALIFIERS[o])} .`);
}
w();
w("# ===== event types (one per wire event) =====");
w("# Completeness tradeoff (discovery FILTER_BIAS, deliberate): every wire name has a");
w("# pi:EventType so EVENT_TYPES is a closed wire alphabet. RuntimeEvents for");
w("# part.delta / result are pi:Unmapped (no MappingRule) — the Tap drops them and");
w("# they never enter the sealed log. Prefer this over deleting the EventTypes");
w("# (would hide known wire names) or mapping them (would flood the log with");
w("# token deltas / duplicate the turn.completed outcome envelope).");
for (const wire of wires) {
  if (wire === "part.delta") {
    w(`zl:EventType-${local(wire)} a pi:EventType ; pi:typeId ${q(snake(wire))} ;`);
    w(
      '  rdfs:comment "Wire-alphabet completeness only: RuntimeEvent is Unmapped; Tap never emits part_delta into the sealed log (see unmappedReason on RuntimeEvent-*-part-delta)." .'
    );
    continue;
  }
  if (wire === "result") {
    w(`zl:EventType-${local(wire)} a pi:EventType ; pi:typeId ${q(snake(wire))} ;`);
    w(
      '  rdfs:comment "Wire-alphabet completeness only: RuntimeEvent is Unmapped; Tap never emits result into the sealed log (see unmappedReason on RuntimeEvent-Stream-result)." .'
    );
    continue;
  }
  w(`zl:EventType-${local(wire)} a pi:EventType ; pi:typeId ${q(snake(wire))} .`);
}
w();

const sources = [
  { key: "Stream", iri: "zl:Source-StreamJson", prefix: "", wires, identity: true },
  // App identity feasible: ocel-tap bindLeaseIdentityObjects mirrors facts into params.*.
  { key: "App", iri: "zl:Source-AppServer", prefix: "params.", wires: events.wire, identity: true }
];
w("# ===== e2o relations (path into the raw record) =====");
for (const s of sources)
  for (const o of OBJECTS)
    w(`zl:Rel-${s.key}-${o} a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-${o} ; pi:hasQualifier zl:Qualifier-${QUALIFIERS[o]} ; pi:objectIdPath ${q(s.prefix + PATHS[o])} .`);
// Stream + App: lease identity E2O (ocel-tap injects under XAAS_WORKER=1; App under params.*).
for (const s of sources.filter((src) => src.identity)) {
  for (const o of IDENTITY_OBJECTS) {
    const qual =
      IDENTITY_QUALIFIERS[o] === "subject" ? "pi:Qualifier-Subject" : `zl:Qualifier-${IDENTITY_QUALIFIERS[o]}`;
    w(
      `zl:Rel-${s.key}-${o} a pi:E2ORelation ; pi:relatesObjectType zl:ObjectType-${o} ; pi:hasQualifier ${qual} ; pi:objectIdPath ${q(s.prefix + IDENTITY_PATHS[o])} .`
    );
  }
}
w();
w("# ===== mapping rules and runtime events =====");
for (const s of sources) {
  const identityRels = s.identity
    ? IDENTITY_OBJECTS.map((o) => `zl:Rel-${s.key}-${o}`).join(" , ")
    : "";
  for (const wire of s.wires) {
    const ev = `zl:RuntimeEvent-${s.key}-${local(wire)}`;
    if (UNMAPPED[wire]) {
      w(`${ev} a pi:RuntimeEvent , pi:Unmapped ; pi:runtimeEventName ${q(wire)} ; pi:emittedBy ${s.iri} ; pi:unmappedReason ${q(UNMAPPED[wire])} .`);
      continue;
    }
    const baseRels = objectsFor(wire).map((o) => `zl:Rel-${s.key}-${o}`).join(" , ");
    const rels = identityRels ? `${baseRels} , ${identityRels}` : baseRels;
    w(`zl:Rule-${s.key}-${local(wire)} a pi:MappingRule ; pi:ruleId ${q(`${s.key.toLowerCase()}-${snake(wire)}`)} ; pi:fromSource ${s.iri} ; pi:sourceEvent ${q(wire)} ;`);
    w(`  pi:emitsEventType zl:EventType-${local(wire)} ; pi:hasRelation ${rels} .`);
    w(`${ev} a pi:RuntimeEvent ; pi:runtimeEventName ${q(wire)} ; pi:emittedBy ${s.iri} .`);
  }
}
w();
// Gall-work hook is launcher residue (ALOOP vocabulary), not in vendor/zcode.cjs enums.
// Emitting it here keeps `bun scripts/gen-zcode-loop.ts` from wiping Source-GallWorkHook.
emitGallWorkHook(w);
w();
w("# ===== internal enum W -> wire projection (documentation of what each wire event folds) =====");
w("zl:InternalEvent a rdfs:Class .");
for (const [key, value] of Object.entries(events.internal)) {
  w(`zl:Internal-${key} a zl:InternalEvent ; zl:internalName ${q(value)} ; zl:foldsToWire ${q(wireOf(events, value))} .`);
}
w();
w("# ===== loop states: turn machine. Transition names equal OCEL event type ids, so replay folds the log. =====");
w('zl:TurnMachine a st:Machine ; st:machineName "ZcodeTurn" ; st:initial zl:TurnIdle .');
w('zl:TurnIdle a st:State ; st:inMachine zl:TurnMachine ; st:stateName "Idle" ; st:seq 0 .');
w('zl:TurnRunning a st:State ; st:inMachine zl:TurnMachine ; st:stateName "Running" ; st:seq 1 .');
w('zl:TurnCompleted a st:State ; st:inMachine zl:TurnMachine ; st:stateName "Completed" ; st:seq 2 .');
w('zl:TurnFailed a st:State ; st:inMachine zl:TurnMachine ; st:stateName "Failed" ; st:seq 3 .');
w('zl:TurnStart a st:Transition ; st:transitionName "turn_started" ; st:kind "advance" ; st:from zl:TurnIdle ; st:to zl:TurnRunning .');
w('zl:TurnComplete a st:Transition ; st:transitionName "turn_completed" ; st:kind "advance" ; st:from zl:TurnRunning ; st:to zl:TurnCompleted .');
w('zl:TurnFail a st:Transition ; st:transitionName "turn_failed" ; st:kind "abort" ; st:from zl:TurnRunning ; st:to zl:TurnFailed .');
w('zl:TurnStartAgain a st:Transition ; st:transitionName "turn_started" ; st:kind "loop" ; st:from zl:TurnCompleted ; st:to zl:TurnRunning .');
w('zl:TurnRetry a st:Transition ; st:transitionName "turn_started" ; st:kind "retry" ; st:from zl:TurnFailed ; st:to zl:TurnRunning .');
w();
w("# ===== receipt / event-record shapes (shacl-projection-pack -> zod + JSON Schema) =====");
w("ex:ReceiptEntryShape a sh:NodeShape ;");
w("  sh:property " + ["entry_id", "parent_hash", "phase", "standing", "subject", "action", "hash"].map((f) => `[ sh:path ex:${f} ; sh:datatype xsd:string ; sp:isPrimaryOutput true ]`).join(" ,\n    ") + " .");
w('zl:ReceiptEntry a sp:SchemaModel ; sp:className "ReceiptEntry" ; sp:derivedFromShape ex:ReceiptEntryShape .');
w("ex:OcelEventShape a sh:NodeShape ;");
w("  sh:property " + ["id", "type", "time"].map((f) => `[ sh:path ex:${f} ; sh:datatype xsd:string ; sp:isPrimaryOutput true ]`).join(" ,\n    ") + " .");
w('zl:OcelEventRecord a sp:SchemaModel ; sp:className "OcelEventRecord" ; sp:derivedFromShape ex:OcelEventShape .');
w();

mkdirSync(join(root, "ontology"), { recursive: true });
writeFileSync(join(root, "ontology", "zcode-loop.ttl"), out.join("\n"));
console.log(`wrote ontology/zcode-loop.ttl (${wires.length} wire events, ${Object.keys(events.internal).length} internal)`);
