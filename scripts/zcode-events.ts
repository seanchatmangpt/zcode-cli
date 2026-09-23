// Reads the runtime's own event definitions out of vendor/zcode.cjs:
//   W    internal session-event enum (name -> snake_case value)
//   iXn  wire (protocol / stream-json / app-server) event-type enum
//   wCs  internal -> wire projection (default arm: session.updated)
// Used by gen-zcode-loop.ts (draft ontology) and by test/ocel-coverage.test.ts (drift gate).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const runtimePath = join(dirname(fileURLToPath(import.meta.url)), "..", "vendor", "zcode.cjs");

export interface RuntimeEvents {
  internal: Record<string, string>; // key -> value, e.g. TurnStarted -> turn_started
  wire: string[];
  toWire: Record<string, string>; // internal value -> wire type
  defaultWire: string;
}

export function runtimeAvailable(): boolean {
  return existsSync(runtimePath);
}

function sliceBalanced(src: string, start: number, open: string, close: string): string {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error("unbalanced " + open);
}

export function readRuntimeEvents(path = runtimePath): RuntimeEvents {
  const src = readFileSync(path, "latin1");
  // The internal event enum's minified name varies per runtime build
  // (3.12.3: W, 3.14.1: ut); anchor on the SessionCreated first member.
  const wMatch = /([A-Za-z_$][\w$]*)=\{SessionCreated:/u.exec(src);
  if (!wMatch) throw new Error("internal event enum W not found in runtime");
  const enumName = wMatch[1];
  const wStart = wMatch.index;
  const wBody = sliceBalanced(src, wStart + enumName.length + 1, "{", "}");
  const internal: Record<string, string> = {};
  for (const m of wBody.matchAll(/([A-Za-z0-9]+):"([a-z_]+)"/g)) internal[m[1]] = m[2];

  const iStart = src.indexOf('=m.enum(["session.created"');
  if (iStart < 0) throw new Error("wire event enum not found in runtime");
  const wire = [...sliceBalanced(src, src.indexOf("[", iStart), "[", "]").matchAll(/"([A-Za-z.]+)"/g)].map((m) => m[1]);

  // The wire projection folds internal enum members to wire names. Shapes
  // vary per build: 3.12.3 switched on an event object (`case W.X:` inside a
  // function whose cases share one return), 3.14.1 switches on the value
  // directly (`case ut.SessionCreated:return"session.created";`). Anchor on
  // the first member case and walk back to the enclosing function.
  const fAnchor = new RegExp(`case ${enumName.replace(/\$/g, "\\$")}\\.SessionCreated:return"session\\.created"`).exec(src);
  if (!fAnchor) throw new Error("wire projection wCs not found in runtime");
  const fStart = src.lastIndexOf("function ", fAnchor.index);
  const fBody = sliceBalanced(src, src.indexOf("{", fStart), "{", "}");
  const toWire: Record<string, string> = {};
  const E = enumName.replace(/\$/g, "\\$");
  const caseRe = new RegExp(
    `case ${E}\\.([A-Za-z0-9]+):return"([A-Za-z.]+)"` // single case -> wire
    + `|case ${E}\\.([A-Za-z0-9]+):` // grouped case head (falls through)
    + `|return"([A-Za-z.]+)"` // group return: wires every pending member
    + `|default:return"([A-Za-z.]+)"`,
    "g"
  );
  let pending: string[] = [];
  let defaultWire = "";
  for (const m of fBody.matchAll(caseRe)) {
    if (m[1] && m[2]) {
      const iv = internal[m[1]];
      if (iv) toWire[iv] = m[2];
      // A single case also terminates any pending fall-through group
      // (`case A:case B:return W` wires A, B and every queued member to W).
      for (const p of pending) toWire[p] = m[2];
      pending = [];
    } else if (m[3]) {
      const iv = internal[m[3]];
      if (iv) pending.push(iv);
    } else if (m[4]) {
      for (const p of pending) toWire[p] = m[4];
      pending = [];
    } else if (m[5]) {
      defaultWire = m[5];
      for (const p of pending) toWire[p] = m[5];
      pending = [];
    }
  }
  return { internal, wire, toWire, defaultWire };
}

export function wireOf(events: RuntimeEvents, internalValue: string): string {
  return events.toWire[internalValue] ?? events.defaultWire;
}
