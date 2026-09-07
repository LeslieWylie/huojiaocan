// Opt-in paid generation comparison. Retrieval/browser checks are separate gates.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateGroundedAnswer } from '../serverless/grounded-answer.js';
const cases=JSON.parse(readFileSync(new URL('../evaluation/teaching-skills-cases.json',import.meta.url)));
if (process.env.RUN_PAID_SKILLS_EVAL !== 'true') {
 console.log(JSON.stringify({status:'not_run',cases:cases.length,reason:'Requires RUN_PAID_SKILLS_EVAL=true and verified evidence input'}));
 process.exitCode=2;
} else {
 const source=process.env.SKILLS_EVAL_EVIDENCE;
 if (!source) throw new Error('SKILLS_EVAL_EVIDENCE must point to verified evidence grouped by case id');
 const evidence=JSON.parse(readFileSync(source,'utf8'));
 for(const c of cases) {
  if(!Array.isArray(evidence[c.id]) || !evidence[c.id].length || evidence[c.id].some(e=>!e.text || !e.documentId || !Number.isInteger(e.pdfPage) || e.pdfPage<1)) throw new Error(`Missing verified evidence: ${c.id}`);
 }
 const dir=resolve(process.env.SKILLS_EVAL_OUTPUT || 'node_modules/.cache/teaching-skills-evaluation');mkdirSync(dir,{recursive:true,mode:0o700});
 const results=[];
 for(const c of cases) for(const mode of ['baseline','skills']) {
  const start=Date.now();let result;
  try {
   const answer=await generateGroundedAnswer({question:c.question,lessonIdentity:{title:c.lessonTitle},lessonContext:{periods:c.periods,classLevel:'普通'},scope:[...new Set(evidence[c.id].map(e=>e.documentId))],evidence:evidence[c.id],env:{...process.env,TEACHING_SKILLS_ENABLED:String(mode==='skills')},deadlineAt:Date.now()+110000});
   if(!answer) throw new Error('model_unavailable');
   result={caseId:c.id,mode,elapsedMs:Date.now()-start,model:answer.model,answer,manualReview:'pending',coverage:'generation_only_fixed_evidence_not_continuous_draft_flow'};
  } catch { result={caseId:c.id,mode,elapsedMs:Date.now()-start,error:'generation_failed',manualReview:'blocked'}; }
  results.push(result);
  writeFileSync(`${dir}/${c.id}-${mode}.json`,JSON.stringify(result,null,2),{mode:0o600});
 }
 console.log(JSON.stringify({status:'requires_manual_review',cases:cases.length,completed:results.filter(r=>!r.error).length,output:dir}));
 if(results.some(r=>r.error))process.exitCode=1;
}
