export interface GraphInvariantInput{subjectSha:string;sourceSha:string;value:string}
export function graphInvariant(x:GraphInvariantInput){const exact=x.subjectSha.length>=7&&x.sourceSha.length>=7;const bounded=x.value.trim().length>0&&x.value.length<=4096;return{admitted:exact&&bounded,reason:!exact?"identity_refused":!bounded?"boundary_refused":"admitted",digest:[x.subjectSha,x.sourceSha,x.value].join("\\n")}}
export const sameSubject=(a:GraphInvariantInput,b:GraphInvariantInput)=>a.subjectSha===b.subjectSha&&a.sourceSha===b.sourceSha;
