import { createHash } from "node:crypto";
export type PlannerId = "hddl"|"fond"|"powl"|string;
export interface PlannerExperience { schema:"chatman.planner-experience/1"; subjectClass:string; planner:PlannerId; provider:string; outcome:"alive"|"blocked"|"refused"; semanticSteps:number; durationMs:number; authorityCeiling:"OBSERVE"|"SELECT"|"CONSTRUCT"; externalDoCount:0; receiptDigest:string; }
export interface Candidate { planner:PlannerId; samples:number; alive:number; meanSteps:number; meanMs:number; score:number; }
export interface Selection { schema:"chatman.planner-selection/1"; subjectClass:string; evidenceDigest:string; selectedPlanner?:PlannerId; candidates:Candidate[]; standing:"CANDIDATE"|"REFUSED"; authority:"NONE"; externalDoCount:0; refusal?:"subject_missing"|"experience_invalid"|"no_admitted_candidate"; }
const digest=/^sha256:[0-9a-f]{64}$/u;
function canon(v:unknown):string { if(Array.isArray(v)) return "["+v.map(canon).join(",")+"]"; if(v&&typeof v==="object") return "{"+Object.entries(v as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>JSON.stringify(k)+":"+canon(x)).join(",")+"}"; return JSON.stringify(v); }
export function sha256(v:unknown):string { return "sha256:"+createHash("sha256").update(canon(v)).digest("hex"); }
export function parseExperience(v:unknown):PlannerExperience|undefined { if(!v||typeof v!=="object"||Array.isArray(v)) return; const x=v as Record<string,unknown>; if(x.schema!=="chatman.planner-experience/1"||typeof x.subjectClass!=="string"||!x.subjectClass.trim()||typeof x.planner!=="string"||!x.planner.trim()||typeof x.provider!=="string"||!x.provider.trim()) return; if(!["alive","blocked","refused"].includes(String(x.outcome))||!Number.isSafeInteger(x.semanticSteps)||Number(x.semanticSteps)<0||!Number.isFinite(x.durationMs)||Number(x.durationMs)<0) return; if(!["OBSERVE","SELECT","CONSTRUCT"].includes(String(x.authorityCeiling))||x.externalDoCount!==0||typeof x.receiptDigest!=="string"||!digest.test(x.receiptDigest)) return; return x as unknown as PlannerExperience; }
function refused(subjectClass:string,evidence:readonly unknown[],refusal:Selection["refusal"]):Selection { return {schema:"chatman.planner-selection/1",subjectClass,evidenceDigest:sha256(evidence),candidates:[],standing:"REFUSED",authority:"NONE",externalDoCount:0,refusal}; }
export function selectPlanner(subjectClass:string, experiences:readonly unknown[], allowed:readonly PlannerId[]=["hddl","fond","powl"]):Selection {
 const subject=subjectClass.trim(); if(!subject) return refused("",[],"subject_missing");
 const parsed=experiences.map(parseExperience); if(parsed.some(x=>!x)) return refused(subject,[],"experience_invalid");
 const exact=(parsed as PlannerExperience[]).filter(x=>x.subjectClass===subject); const allow=new Set(allowed); const groups=new Map<string,PlannerExperience[]>();
 for(const x of exact){ if(!allow.has(x.planner)) continue; const xs=groups.get(x.planner)??[]; xs.push(x); groups.set(x.planner,xs); }
 const candidates=[...groups].map(([planner,xs]):Candidate=>{ const alive=xs.filter(x=>x.outcome==="alive").length; const meanSteps=xs.reduce((n,x)=>n+x.semanticSteps,0)/xs.length; const meanMs=xs.reduce((n,x)=>n+x.durationMs,0)/xs.length; const failures=xs.length-alive; return {planner,samples:xs.length,alive,meanSteps,meanMs,score:(alive/xs.length)*1e6-meanSteps*1e3-failures*100-meanMs/1e3}; }).sort((a,b)=>b.score-a.score||a.planner.localeCompare(b.planner));
 if(!candidates.length) return refused(subject,exact,"no_admitted_candidate");
 const normalized=[...exact].sort((a,b)=>canon(a).localeCompare(canon(b)));
 return {schema:"chatman.planner-selection/1",subjectClass:subject,evidenceDigest:sha256(normalized),selectedPlanner:candidates[0]!.planner,candidates,standing:"CANDIDATE",authority:"NONE",externalDoCount:0};
}
