import type { CandidateProvider } from "./provider.js";
import type { Sa2aReplanEnvelope } from "./contract.js";
import { assertReplayStable } from "./replay.js";
export async function substituteProvider(providers:readonly CandidateProvider[],envelope:Sa2aReplanEnvelope):Promise<Sa2aReplanEnvelope>{for(const provider of providers){const candidate=await provider.propose(envelope);if(candidate.authority!=="none")continue;try{assertReplayStable(envelope,candidate);return candidate}catch{continue}}return {...envelope,recovery:"reconcile",authority:"none"}}
