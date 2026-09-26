import { describe,expect,test } from "bun:test";
import { readFileSync } from "node:fs";
import { selectPlanner,sha256 } from "../src/planner-cost.ts";
const d=(c:string)=>"sha256:"+c.repeat(64);
const e=(planner:string,outcome:"alive"|"blocked"|"refused",steps:number,subjectClass="known.patch")=>({schema:"chatman.planner-experience/1" as const,subjectClass,planner,provider:"portable",outcome,semanticSteps:steps,durationMs:100,authorityCeiling:"CONSTRUCT" as const,externalDoCount:0 as const,receiptDigest:d(planner==="hddl"?"a":planner==="fond"?"b":"c")});
describe("planner cost court",()=>{
 test("cheaper successful planner wins without authority",()=>{const r=selectPlanner("known.patch",[e("hddl","alive",8),e("fond","alive",3)]); expect(r.selectedPlanner).toBe("fond"); expect([r.standing,r.authority,r.externalDoCount]).toEqual(["CANDIDATE","NONE",0]);});
 test("exact-subject fence excludes adjacent evidence",()=>{expect(selectPlanner("known.patch",[e("hddl","alive",8),e("fond","alive",1,"novel")]).selectedPlanner).toBe("hddl");});
 test("consequential evidence refuses",()=>{expect(selectPlanner("known.patch",[{...e("hddl","alive",1),externalDoCount:1}]).refusal).toBe("experience_invalid");});
 test("malformed evidence and empty subject refuse",()=>{expect(selectPlanner("",[e("hddl","alive",1)]).refusal).toBe("subject_missing"); expect(selectPlanner("known.patch",[{...e("hddl","alive",1),receiptDigest:"bad"}]).refusal).toBe("experience_invalid");});
 test("planner allowlist fails closed",()=>{expect(selectPlanner("known.patch",[e("rogue","alive",0)],["hddl","fond","powl"]).refusal).toBe("no_admitted_candidate");});
 test("permutation preserves selection and evidence identity",()=>{const xs=[e("hddl","alive",8),e("fond","alive",3),e("powl","blocked",1)]; const a=selectPlanner("known.patch",xs),b=selectPlanner("known.patch",[...xs].reverse()); expect(a.selectedPlanner).toBe(b.selectedPlanner); expect(a.evidenceDigest).toBe(b.evidenceDigest); expect(a.candidates).toEqual(b.candidates);});
 test("canonical hashing ignores object key order",()=>expect(sha256({a:1,b:2})).toBe(sha256({b:2,a:1})));
 test("TTL participates in separation and BRCE-only DO",()=>{const ttl=readFileSync(new URL("../ontology/planner-cost.ttl",import.meta.url),"utf8"); for(const t of ["ce:HDDL","ce:FOND","ce:POWL","ce:authorityCeiling ce:SELECT","ce:externalDoCount 0","ce:DO ce:soleBoundary ce:BRCE"]) expect(ttl).toContain(t); expect(ttl).toContain("ce:SELECT ce:distinctFrom ce:DO");});
});
