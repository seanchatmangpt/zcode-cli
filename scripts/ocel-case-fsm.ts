// Case-projected ZcodeTurn FSM for OCEL logs.
// Turn lifecycle events are folded per `in_turn` object id (OCEL case), not as a
// single global machine — otherwise interleaved concurrent turns false-reject and
// cross-turn completion theft false-accepts (EU AI Act logging integrity).
import {
  ZcodeTurnInitial,
  ZcodeTurnTransitions,
  replayZcodeTurn,
  stepZcodeTurn,
  type ZcodeTurnState,
} from "../src/generated/loop.ts";
import type { OcelEvent } from "../src/generated/ocel.ts";

const machineNames = new Set(ZcodeTurnTransitions.map((t) => t.name));

/** Object id bound by qualifier `in_turn`, or undefined when absent. */
export function inTurnCaseId(e: OcelEvent): string | undefined {
  return e.relationships.find((r) => r.qualifier === "in_turn")?.objectId;
}

/**
 * Replay turn-lifecycle events per case. Returns deviation count:
 * - machine event missing `in_turn` → +1
 * - illegal step within a case → +1 per failed step
 * - replayZcodeTurn violations on the accepted steps of a case → +len
 */
export function deviationsByTurnCase(events: ReadonlyArray<OcelEvent>): number {
  const byCase = new Map<string, OcelEvent[]>();
  let deviations = 0;

  for (const e of events) {
    if (!machineNames.has(e.type)) continue;
    const cid = inTurnCaseId(e);
    if (!cid) {
      deviations++;
      continue;
    }
    const seq = byCase.get(cid);
    if (seq) seq.push(e);
    else byCase.set(cid, [e]);
  }

  for (const caseEvents of byCase.values()) {
    let state: ZcodeTurnState = ZcodeTurnInitial;
    const steps: { name: string; from: string; to: string }[] = [];
    for (const e of caseEvents) {
      try {
        const to = stepZcodeTurn(state, e.type, {});
        steps.push({ name: e.type, from: state, to });
        state = to;
      } catch {
        deviations++;
      }
    }
    deviations += replayZcodeTurn(steps).length;
  }

  return deviations;
}
