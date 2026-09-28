export interface AuthorityFenceState{edges:readonly string[];excluded:readonly string[];receipts:readonly string[]}
export type AuthorityFenceOutcome={ok:true;edge:string}|{ok:false;edge:string;reason:string}
export const nextEdge=(s:AuthorityFenceState)=>s.edges.find(e=>!s.excluded.includes(e));
export function applyOutcome(s:AuthorityFenceState,o:AuthorityFenceOutcome):AuthorityFenceState{if(o.ok)return {...s,receipts:[...s.receipts,`ok:${o.edge}`]};if(s.excluded.includes(o.edge))return s;return {...s,excluded:[...s.excluded,o.edge],receipts:[...s.receipts,`fail:${o.edge}:${o.reason}`]}}
export const exhausted=(s:AuthorityFenceState)=>nextEdge(s)===undefined;
