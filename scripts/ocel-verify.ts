// Verifies a recorded .jsonocel + sibling .receipt.json with the generated verifier, table and chain.
//   bun scripts/ocel-verify.ts <log.jsonocel> [--require type1,type2]
// Exit 0 and prints "chain-verified" + "deviations: 0" only when all checks hold.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { EVENT_TYPES, verifyChain, type OcelDoc } from "../src/generated/ocel.ts";
import { ZcodeTurnInitial, ZcodeTurnState, ZcodeTurnTransitions, replayZcodeTurn, stepZcodeTurn } from "../src/generated/loop.ts";
import { verify as verifyReceiptChain } from "../src/generated/receipt.ts";

const args = process.argv.slice(2);
const log = args.find((a) => a.endsWith(".jsonocel"));
if (!log) { console.error("usage: ocel-verify.ts <log.jsonocel> [--require a,b]"); process.exit(2); }
const req = args.includes("--require") ? args[args.indexOf("--require") + 1].split(",") : ["turn_started", "turn_completed"];
const text = readFileSync(log, "utf8");
let doc: OcelDoc;
try { doc = JSON.parse(text) as OcelDoc; } catch (e) { console.error(`unparseable log: ${(e as Error).message}`); process.exit(1); }
const receipt = JSON.parse(readFileSync(log.replace(/\.jsonocel$/, ".receipt.json"), "utf8"));
const fail: string[] = [];

const chainErr = verifyChain(doc, "sha256");
if (chainErr) fail.push(`ocel chain: ${chainErr}`);
if (createHash("sha256").update(text).digest("hex") !== receipt.ocel_file_sha256) fail.push("file digest differs from receipt");
if (receipt.event_count !== doc.events.length) fail.push("event_count differs from receipt");
try { if (!(verifyReceiptChain as any)(receipt.chain)) fail.push("receipt chain not intact"); } catch (e) { fail.push(`receipt chain: ${(e as Error).message}`); }

const types = new Set(doc.events.map((e) => e.type));
for (const t of req) if (!types.has(t)) fail.push(`coverage: declared event type ${t} absent`);
for (const t of types) if (!EVENT_TYPES.includes(t)) fail.push(`undeclared event type ${t}`);

const names = new Set(ZcodeTurnTransitions.map((t) => t.name));
let state: ZcodeTurnState = ZcodeTurnInitial;
const steps: { name: string; from: string; to: string }[] = [];
let deviations = 0;
for (const e of doc.events) {
  if (!names.has(e.type)) continue;
  try { const to = stepZcodeTurn(state, e.type, {}); steps.push({ name: e.type, from: state, to }); state = to; } catch { deviations++; }
}
deviations += replayZcodeTurn(steps).length;
console.log(`deviations: ${deviations}`);
if (deviations) fail.push(`${deviations} replay deviations`);

if (fail.length) { console.error(fail.join("\n")); process.exit(1); }
console.log(`chain-verified: ${doc.events.length} events, head ${receipt.head_hash}`);
