export interface SurvivalScoreInput{subjectSha:string;sourceSha:string;value:string}
export function survivalScore(x:SurvivalScoreInput){const exact=x.subjectSha.length>=7&&x.sourceSha.length>=7;const bounded=x.value.trim().length>0&&x.value.length<=4096;return {admitted:exact&&bounded,reason:!exact?"identity_refused":!bounded?"boundary_refused":"admitted",digest:[x.subjectSha,x.sourceSha,x.value].join("\\n")}}
export function sameSubject(a:SurvivalScoreInput,b:SurvivalScoreInput){return a.subjectSha===b.subjectSha&&a.sourceSha===b.sourceSha}
