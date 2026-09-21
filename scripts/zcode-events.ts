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
  const wStart = src.indexOf("W={SessionCreated:");
  if (wStart < 0) throw new Error("internal event enum W not found in runtime");
  const wBody = sliceBalanced(src, wStart + 2, "{", "}");
  const internal: Record<string, string> = {};
  for (const m of wBody.matchAll(/([A-Za-z0-9]+):"([a-z_]+)"/g)) internal[m[1]] = m[2];

  const iStart = src.indexOf('=m.enum(["session.created"');
  if (iStart < 0) throw new Error("wire event enum not found in runtime");
  const wire = [...sliceBalanced(src, src.indexOf("[", iStart), "[", "]").matchAll(/"([A-Za-z.]+)"/g)].map((m) => m[1]);

  const fStart = src.indexOf("function wCs(e){");
  if (fStart < 0) throw new Error("wire projection wCs not found in runtime");
  const fBody = sliceBalanced(src, src.indexOf("{", fStart), "{", "}");
  const keyToValue = internal;
  const toWire: Record<string, string> = {};
  let pending: string[] = [];
  for (const m of fBody.matchAll(/case W\.([A-Za-z0-9]+):|return"([A-Za-z.]+)"|default:return"([A-Za-z.]+)"/g)) {
    if (m[1]) pending.push(keyToValue[m[1]]);
    else if (m[2]) {
      for (const p of pending) toWire[p] = m[2];
      pending = [];
    }
  }
  const defaultWire = /default:return"([A-Za-z.]+)"/.exec(fBody)?.[1] ?? "";
  return { internal, wire, toWire, defaultWire };
}

export function wireOf(events: RuntimeEvents, internalValue: string): string {
  return events.toWire[internalValue] ?? events.defaultWire;
}
