import type { Sa2aReplanEnvelope } from "./contract.js";

export interface OcelRecoveryEvent {
  type: "sa2a.recovery";
  effectId: string;
  replayIdentity: string;
  provider?: string;
  outcome: string;
  recovery: Sa2aReplanEnvelope["recovery"];
  authority: "none";
}

export function toOcelRecoveryEvent(envelope: Sa2aReplanEnvelope): OcelRecoveryEvent {
  return {
    type: "sa2a.recovery",
    effectId: envelope.effectId,
    replayIdentity: envelope.replayIdentity,
    provider: envelope.provider,
    outcome: envelope.outcome,
    recovery: envelope.recovery,
    authority: "none",
  };
}
