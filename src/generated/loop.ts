// Generated FSM projection; edit the ontology, not this file.
import { createHash } from "node:crypto";
export const CHAIN_ALGO = "sha256";
export function chainDigest(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}
/** Hash chain over event names: each link digests parent hash + event. */
export function chainEvents(events: ReadonlyArray<string>): string[] {
  const out: string[] = [];
  let parent = "";
  for (const e of events) {
    parent = chainDigest(parent + "|" + e);
    out.push(parent);
  }
  return out;
}

export type Violation = { index: number; kind: "illegal" | "skipped"; detail: string };
export type TransitionEvent = { name: string; from: string; to: string };

export enum MxLoopState {
  Observed = "Observed",
  Decomposed = "Decomposed",
  Planned = "Planned",
  Selected = "Selected",
  Constructed = "Constructed",
  Executed = "Executed",
  Receipted = "Receipted",
  Replayed = "Replayed",
  Experienced = "Experienced",
}
export const MxLoopInitial = MxLoopState.Observed;
export const MxLoopTransitions: ReadonlyArray<{ name: string; from: MxLoopState; to: MxLoopState; guard: string | null }> = [
  { name: "construct", from: MxLoopState.Selected, to: MxLoopState.Constructed, guard: null },
  { name: "decompose", from: MxLoopState.Observed, to: MxLoopState.Decomposed, guard: null },
  { name: "execute", from: MxLoopState.Constructed, to: MxLoopState.Executed, guard: "admitted" },
  { name: "next", from: MxLoopState.Experienced, to: MxLoopState.Observed, guard: null },
  { name: "plan", from: MxLoopState.Decomposed, to: MxLoopState.Planned, guard: null },
  { name: "receipt", from: MxLoopState.Executed, to: MxLoopState.Receipted, guard: null },
  { name: "record", from: MxLoopState.Replayed, to: MxLoopState.Experienced, guard: null },
  { name: "replay", from: MxLoopState.Receipted, to: MxLoopState.Replayed, guard: null },
  { name: "select", from: MxLoopState.Planned, to: MxLoopState.Selected, guard: null },
];
export function stepMxLoop(state: MxLoopState, name: string, ctx: Record<string, boolean>): MxLoopState {
  const t = MxLoopTransitions.find((x) => x.name === name && x.from === state);
  if (!t) throw new Error(`no transition ${name} from ${state}`);
  if (t.guard !== null && !ctx[t.guard]) throw new Error(`guard ${t.guard} refused`);
  return t.to;
}
/** Replay events from the initial state; report illegal and skipped transitions. */
export function replayMxLoop(events: ReadonlyArray<TransitionEvent>): Violation[] {
  const violations: Violation[] = [];
  let current: string = MxLoopInitial;
  events.forEach((e, index) => {
    if (e.from !== current) {
      violations.push({ index, kind: "skipped", detail: `expected from ${current} but event claims ${e.from}` });
    }
    const t = MxLoopTransitions.find((x) => x.name === e.name && x.from === e.from);
    if (!t || t.to !== e.to) {
      violations.push({ index, kind: "illegal", detail: `no transition ${e.name} ${e.from} -> ${e.to}` });
      return;
    }
    current = t.to;
  });
  return violations;
}

export enum ZcodeTurnState {
  Idle = "Idle",
  Running = "Running",
  Completed = "Completed",
  Failed = "Failed",
}
export const ZcodeTurnInitial = ZcodeTurnState.Idle;
export const ZcodeTurnTransitions: ReadonlyArray<{ name: string; from: ZcodeTurnState; to: ZcodeTurnState; guard: string | null }> = [
  { name: "turn_completed", from: ZcodeTurnState.Running, to: ZcodeTurnState.Completed, guard: null },
  { name: "turn_failed", from: ZcodeTurnState.Running, to: ZcodeTurnState.Failed, guard: null },
  { name: "turn_started", from: ZcodeTurnState.Failed, to: ZcodeTurnState.Running, guard: null },
  { name: "turn_started", from: ZcodeTurnState.Completed, to: ZcodeTurnState.Running, guard: null },
  { name: "turn_started", from: ZcodeTurnState.Idle, to: ZcodeTurnState.Running, guard: null },
];
export function stepZcodeTurn(state: ZcodeTurnState, name: string, ctx: Record<string, boolean>): ZcodeTurnState {
  const t = ZcodeTurnTransitions.find((x) => x.name === name && x.from === state);
  if (!t) throw new Error(`no transition ${name} from ${state}`);
  if (t.guard !== null && !ctx[t.guard]) throw new Error(`guard ${t.guard} refused`);
  return t.to;
}
/** Replay events from the initial state; report illegal and skipped transitions. */
export function replayZcodeTurn(events: ReadonlyArray<TransitionEvent>): Violation[] {
  const violations: Violation[] = [];
  let current: string = ZcodeTurnInitial;
  events.forEach((e, index) => {
    if (e.from !== current) {
      violations.push({ index, kind: "skipped", detail: `expected from ${current} but event claims ${e.from}` });
    }
    const t = ZcodeTurnTransitions.find((x) => x.name === e.name && x.from === e.from);
    if (!t || t.to !== e.to) {
      violations.push({ index, kind: "illegal", detail: `no transition ${e.name} ${e.from} -> ${e.to}` });
      return;
    }
    current = t.to;
  });
  return violations;
}

