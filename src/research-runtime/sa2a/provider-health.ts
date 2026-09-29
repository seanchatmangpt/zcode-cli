export type ProviderHealth="healthy"|"excluded"|"unknown";
export interface ProviderHealthState{provider:string;health:ProviderHealth;failures:number;lastOutcome?:string}
export const recordProviderOutcome=(s:ProviderHealthState,outcome:string):ProviderHealthState=>{const bad=["unknown","unknown_outcome","indeterminate","failed"].includes(outcome.toLowerCase());return {...s,lastOutcome:outcome,failures:s.failures+(bad?1:0),health:bad?"excluded":"healthy"}};
