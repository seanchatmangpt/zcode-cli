import { isSa2aEnvelope, type Sa2aReplanEnvelope } from "./contract.js";
export type Admission={ok:true;value:Sa2aReplanEnvelope}|{ok:false;reason:string};
export function admitPortable(value:unknown):Admission{
 if(!isSa2aEnvelope(value)) return {ok:false,reason:"SA2A_ENVELOPE_REFUSED"};
 if(value.authority!=="none") return {ok:false,reason:"SA2A_AUTHORITY_REFUSED"};
 if(!value.effectId||!value.replayIdentity) return {ok:false,reason:"SA2A_IDENTITY_REQUIRED"};
 return {ok:true,value};
}
