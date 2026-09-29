import { createHash } from "node:crypto";
import type { Sa2aReplanEnvelope } from "./contract.js";
const stable=(v:unknown):string=>Array.isArray(v)?`[${v.map(stable).join(",")}]`:v&&typeof v==="object"?`{${Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${JSON.stringify(k)}:${stable(x)}`).join(",")}}`:JSON.stringify(v);
export const canonicalSubject=(v:unknown)=>stable(v);
export const subjectDigest=(v:unknown)=>createHash("sha256").update(canonicalSubject(v)).digest("hex");
export const exactEnvelopeIdentity=(e:Sa2aReplanEnvelope)=>createHash("sha256").update(stable({version:e.version,subject:e.subject,effectId:e.effectId,replayIdentity:e.replayIdentity})).digest("hex");
