import { createHash } from "node:crypto";
import type { Sa2aReplanEnvelope } from "./contract.js";

function stable(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;

  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value)!;
    case "number":
      if (!Number.isFinite(value)) throw new Error("SA2A_NONFINITE_IDENTITY_VALUE");
      return Object.is(value, -0) ? "0" : JSON.stringify(value)!;
    case "object": {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right));
      return `{${entries
        .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
        .join(",")}}`;
    }
    default:
      throw new Error("SA2A_UNSUPPORTED_IDENTITY_VALUE");
  }
}

export const canonicalSubject = (value: unknown): string => stable(value);

export const subjectDigest = (value: unknown): string =>
  createHash("sha256").update(canonicalSubject(value)).digest("hex");

export const exactEnvelopeIdentity = (envelope: Sa2aReplanEnvelope): string =>
  createHash("sha256")
    .update(
      stable({
        version: envelope.version,
        subject: envelope.subject,
        effectId: envelope.effectId,
        replayIdentity: envelope.replayIdentity,
      }),
    )
    .digest("hex");
