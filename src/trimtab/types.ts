export type TrimtabDecision="CONTINUE"|"STEER"|"REFUSE"|"COMPLETE";
export type Boundary="context"|"evidence"|"authority"|"budget"|"tool";
export interface Subject{repo:string;baseSha:string;task:string}
export interface Observation{kind:string;value:unknown;source:string;digest?:string}
export interface SteeringInput{subject:Subject;goal:string;observations:Observation[];budget:number}
export interface SteeringOutput{decision:TrimtabDecision;context:string[];reasons:string[];authority:"none";externalDoCount:0}
export interface Receipt{schema:"zcode.trimtab-receipt/1";subject:Subject;decision:TrimtabDecision;contextDigest:string;observationDigests:string[];authority:"none";externalDoCount:0}