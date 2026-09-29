import type { Sa2aReplanEnvelope } from "./contract.js";
import { canonicalSubject } from "./identity.js";
import { reconcileOutcome } from "./reconciliation.js";
export interface Sa2aPortableReceipt {
  subject: unknown; effectId: string; replayIdentity: string; outcome: string; authority: "none"; provider?: string
}
export function applyReceiptFeedback(envelope: Sa2aReplanEnvelope, receipt: Sa2aPortableReceipt): Sa2aReplanEnvelope {
  if (receipt.authority !== "none") throw new Error("SA2A_RECEIPT_AUTHORITY_REFUSED");
  if (canonicalSubject(receipt.subject) !== canonicalSubject(envelope.subject)) throw new Error("SA2A_RECEIPT_SUBJECT_DRIFT");
  if (receipt.effectId !== envelope.effectId) throw new Error("SA2A_RECEIPT_EFFECT_DRIFT");
  if (receipt.replayIdentity !== envelope.replayIdentity) throw new Error("SA2A_RECEIPT_REPLAY_DRIFT");
  return reconcileOutcome({ ...envelope, outcome: receipt.outcome, provider: receipt.provider ?? envelope.provider, authority: "none" });
}
