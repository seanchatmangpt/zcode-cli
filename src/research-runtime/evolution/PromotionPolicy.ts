export interface PromotionPolicyState{edges:readonly string[];excluded:readonly string[];receipts:readonly string[]}
export type PromotionPolicyOutcome={ok:true;edge:string}|{ok:false;edge:string;reason:string}
export const nextEdge=(s:PromotionPolicyState)=>s.edges.find(e=>!s.excluded.includes(e));
export function applyOutcome(s:PromotionPolicyState,o:PromotionPolicyOutcome):PromotionPolicyState{if(o.ok)return {...s,receipts:[...s.receipts,`ok:${o.edge}`]};if(s.excluded.includes(o.edge))return s;return {...s,excluded:[...s.excluded,o.edge],receipts:[...s.receipts,`fail:${o.edge}:${o.reason}`]}}
export const exhausted=(s:PromotionPolicyState)=>nextEdge(s)===undefined;
