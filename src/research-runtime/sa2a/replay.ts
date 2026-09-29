import { exactEnvelopeIdentity } from "./identity.js";
import type { Sa2aReplanEnvelope } from "./contract.js";
export function assertReplayStable(previous:Sa2aReplanEnvelope,next:Sa2aReplanEnvelope):void{if(previous.replayIdentity!==next.replayIdentity)throw new Error("SA2A_REPLAY_IDENTITY_DRIFT");if(previous.effectId!==next.effectId)throw new Error("SA2A_EFFECT_ID_DRIFT");if(exactEnvelopeIdentity(previous)!==exactEnvelopeIdentity(next))throw new Error("SA2A_SUBJECT_DRIFT")}
