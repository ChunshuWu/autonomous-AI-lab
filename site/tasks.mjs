import {taskDocumentText} from './documents.mjs';
import {advisoryUsage,remainingCalls,usageWarnings} from './usage.mjs';
import {workflowTick,researchGuidance} from './workflow.mjs';
import {Invalid,agentFor} from './logic.mjs';
import {changeWarning} from './warnings.mjs';
import {presentation} from './presentations.mjs';
import {blockerRecoveryTick} from './blocker-recovery.mjs';
const writingGuidanceVersion='nonexpert-language-v5';
const experimentFigureGuidance='In records.json, figures accepts bars {type,title,caption,unit,max,rows:[{label,value,display,series}]} (zero-based scale, values from 0 to max), line {type,title,caption,x_label,y_label,series:[{label,points:[{x,y}]}]}, or table {type,title,caption,columns:[plain labels],rows:[[cells]]}. Use display for a readable value including units. All fields are data, not HTML.';
const writingGuidance='The director requires simple language whenever any agent writes. Apply this to task titles, assignments, summary, body, document, presentation, questions, vote reasons, library notes, workflow_plan.summary and every assignment summary/prompt. Write for a non-expert who may not know the field at all. Explain the physical situation or problem before naming the technical term; acronym expansions alone are not explanations. Proposal and method summaries must stand on their own: what goes wrong, what is shared, the concrete change, a small example, and what would improve. For example, explain an extra ideal correction using error-free measurements before saying perfect recovery. Keep precise formulas and conventions after that explanation. Say what you did or plan to do, what you learned or still do not know, and what happens next. Use concrete verbs and short sentences; explain unfamiliar terms before using them, with a small example when helpful. More clear sentences are better than a dense short phrase. For example, replace "isolate chronology value" with "check whether the order of earlier runs matters". Keep the main summary to one or two complete, easy sentences; avoid packed lists of technical checks and unexplained abbreviations. Keep needed equations, exact names, methods, evidence and limits in explained detail. Do not turn a planned test into a result or remove uncertainty. Before sending, check that a new reader can explain your main point back in everyday words. Vote reasons should be one or two short sentences; 280 characters is a writing target only. Never reject a vote or block a meeting just because its reason is longer. Preserve the full reason. Other answer and document length targets are also guidance: preserve complete evidence. A dashboard display-repair warning alone must not stop research when the complete saved result is available. For experiment records, lead with the answer in the summary and include figures that explain the result. Prefer bars for method comparisons and curves for trends; use a compact table when exact values or mixed facts are clearer. Explain what is measured in everyday words, with units, baseline, whether higher or lower is better, and a caption stating the finding and limits. Distinguish calculated probabilities from observed counts; show uncertainty only for the quantity it describes. Do not copy every raw field into a display table. Keep full data and technical checks in results or linked evidence, and put a short explanation in interpretation and uncertainty. This is a writing rule, not a change to the science or work permission.';
const taskKinds=['question','meeting','vote','proposal','research','engineering','mathematics','library','coordination'];
const needsModel=t=>!['library_delivery','library_collect'].includes(t.handler);
const taskScience=k=>!['question','meeting','vote'].includes(k);
// Review workers cannot open a bare file link. The dispatcher reads these full
// saved Markdown files into their packet; completedTaskOutputs supplies access.
export function taskReportRefs(s,ids){
 return [...new Set(ids.flatMap(id=>{
  const files=(s.tasks||[]).find(t=>t.id===id)?.result?.artifacts||[];
  const report=files.find(a=>/\/report\.md$/.test(a.path));
  const manifest=files.find(a=>/\/artifact_manifest\.json$/.test(a.path));
  return report?[report.path]:manifest?[manifest.path]:[];
 }))];
}
const taskText=(v,label,max=4000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Invalid('Provide '+label+' (up to '+max+' characters).');return v.trim();};
const taskList=s=>s.tasks||=[];
const taskById=(s,id)=>{const t=taskList(s).find(t=>t.id===id);if(!t)throw new Invalid('Unknown task.');return t;};
function decisionSpec(s,p){
 if(p.kind!=='vote'){if(p.decision_packet)throw new Invalid('Use a vote task for a decision packet.');return null;}
 const d=p.decision_packet;
 if(!d||!Array.isArray(d.candidates)||!d.candidates.length||d.candidates.length>10)throw new Invalid('A vote needs its final candidates and criteria.');
 const candidates=d.candidates.map(c=>{taskById(s,c.task_id);return {id:taskText(c.id,'candidate ID',80),task_id:c.task_id};});
 if(new Set(candidates.map(c=>c.id)).size!==candidates.length||candidates.some(c=>c.id==='none_is_ready'))throw new Invalid('Use unique candidate IDs; none_is_ready is reserved.');
 return {criteria:taskText(d.criteria,'the selection criteria',6000),candidates};
}
function decisionPacket(s,t){
 if(t.kind!=='vote')return null;
 if(!t.decision_packet)throw new Invalid('This vote has no saved decision packet.');
 return {criteria:t.decision_packet.criteria,options:[...t.decision_packet.candidates.map(c=>c.id),'none_is_ready'],candidates:t.decision_packet.candidates.map(c=>{const source=taskById(s,c.task_id);if(source.status!=='completed')throw new Invalid('Wait for every candidate to be delivered.');return {...c,agent_id:source.agent_id,completion_id:source.completion_id,summary:source.result.summary,body:source.result.body,document:source.result.document||null};})};
}
function taskEvent(s,t,text,now){s.events.push({id:'task-event-'+crypto.randomUUID(),at:new Date(now).toISOString(),actor:agentFor(s,t.agent_id).name,agent_id:t.agent_id,kind:t.status==='failed'?'obstacle':'task',text,task_id:t.id});}
function taskStatus(s,t,state,note,now){
 const active=taskList(s).find(o=>o.id!==t.id&&o.agent_id===t.agent_id&&o.status==='running'&&(!directorQuestion(s,o)||state!=='working'));
 if(active&&(directorQuestion(s,t)||state!=='working')){t=active;state='working';note=active.summary;}
 const a=agentFor(s,t.agent_id);a.last_seen=new Date(now).toISOString();a.status_revision=(a.status_revision||0)+1;a.work_status={task_id:t.id,state,summary:note,waiting_for:state==='blocked'?'Check the task error before retrying.':'',base_status:a.status,updated_at:a.last_seen,revision:a.status_revision};}
function taskWarning(s,key,title,symptom,suggestion){changeWarning(s,{action:'raise',key,reporter:'Task service',title,symptom,impact:'Unneeded model calls or unfinished handoffs may waste time and tokens.',suggestion,certainty:'observed',evidence:[{note:'Saved task queue',source:'tasks:'+s.project.id}]});}
export function submitTask(s,p,role='worker',now=Date.now()){
 const policy=s.task_policy;if(!policy?.enabled)throw new Invalid('Enable the task service for this project first.');
 const sender=p.sender_id?agentFor(s,p.sender_id):null,recipient=agentFor(s,p.agent_id);
 if(role!=='director'&&(!sender||sender.dismissal))throw new Invalid('Name the sending agent.');
 if(recipient.dismissal||recipient.status==='closed')throw new Invalid('Choose a current agent.');
 const id=taskText(p.id,'a stable task ID',120);if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(id))throw new Invalid('Use a stable task ID.');
 const kind=p.kind||'question';if(!taskKinds.includes(kind))throw new Invalid('Choose a task kind.');
 const handler=p.handler||'model';if(!['model','library_delivery','library_collect'].includes(handler))throw new Invalid('Choose model, library_delivery or library_collect.');
 if(handler==='library_delivery'&&(kind!=='library'||!['librarian','orchestrator'].includes(recipient.role)||(p.input_refs||[]).length!==1))throw new Invalid('Prepared library delivery needs a librarian, kind library and one saved JSON handoff path.');
 if(handler==='library_collect'&&(kind!=='library'||recipient.role!=='librarian'||!(p.input_refs||[]).length||(p.input_refs||[]).length>10))throw new Invalid('Source collection needs a librarian and saved source paths.');
 if(kind==='coordination'&&recipient.id!==s.orchestrator_id)throw new Invalid('Only the assigned orchestrator coordinates checkpoints.');
 if(kind!=='question'&&role!=='director'&&sender?.id!==s.orchestrator_id)throw new Invalid('The orchestrator assigns meeting and research work.');
 if(taskScience(kind)&&(!policy.research_enabled||s.paused))throw new Invalid('Research remains paused or outside the task allowance.');
 if(s.workflow?.meeting_policy==='human'&&['awaiting_director','briefing'].includes(s.workflow.status)&&taskScience(kind)&&kind!=='library')throw new Invalid('Wait for the human meeting decision and the team handoff.');
 const decision_packet=decisionSpec(s,p),document_ids=p.document_ids||[];
 if(!Array.isArray(document_ids)||new Set(document_ids).size!==document_ids.length)throw new Invalid('Use distinct saved task documents.');document_ids.forEach(id=>taskById(s,id));
 const deps=[...(p.depends_on||[]),...document_ids,...(decision_packet?.candidates||[]).map(c=>c.task_id)];if(!Array.isArray(p.depends_on||[])||new Set(deps).size>20)throw new Invalid('Use at most 20 task dependencies.');deps.forEach(id=>taskById(s,id));
 const refs=p.input_refs||[];if(!Array.isArray(refs)||refs.length>12||refs.some(x=>typeof x!=='string'||x.length>1500))throw new Invalid('Use at most 12 evidence paths or links.');
 const body={id,agent_id:recipient.id,sender_id:sender?.id||'Director',kind,prompt:taskText(p.prompt,'the task or question',p.workflow_context?12000:7000),summary:taskText(p.summary||p.prompt.slice(0,200),'a short task title',280),depends_on:[...new Set(deps)],input_refs:refs,notify_orchestrator:p.notify_orchestrator===true,depth:p.depth||0,source:p.source||null};
 if(handler!=='model')body.handler=handler;
 if(p.workflow_context)body.workflow_context=structuredClone(p.workflow_context);
 if(decision_packet)body.decision_packet=decision_packet;
 if(document_ids.length)body.document_ids=document_ids;
 if(!Number.isInteger(body.depth)||body.depth<0||body.depth>3)throw new Invalid('Three request hops reached. Ask the orchestrator to resolve the question.');
 const old=taskList(s).find(t=>t.id===id);if(old){if(JSON.stringify(old.request)!==JSON.stringify(body))throw new Invalid('This task ID has different content.');return old;}
 if(taskList(s).filter(t=>['queued','running','delivery_pending'].includes(t.status)).length>=30)throw new Invalid('The queue is full. Resolve existing tasks first.');
 const duplicate=taskList(s).find(t=>t.agent_id===body.agent_id&&(t.handler||'model')===(body.handler||'model')&&t.prompt===body.prompt&&JSON.stringify(t.decision_packet)===JSON.stringify(body.decision_packet)&&JSON.stringify(t.document_ids)===JSON.stringify(body.document_ids)&&JSON.stringify(t.depends_on)===JSON.stringify(body.depends_on)&&JSON.stringify(t.input_refs)===JSON.stringify(body.input_refs)&&['queued','running','delivery_pending'].includes(t.status));if(duplicate)return duplicate;
 const task={...body,request:body,status:'queued',created_at:new Date(now).toISOString(),attempts:0,direction_revision:s.direction_revision,policy_revision:policy.revision};taskList(s).push(task);taskEvent(s,task,'Queued: '+task.summary,now);return task;
}
export function importTaskQuestions(s,now){
 if(!s.task_policy?.enabled)return;
 for(const [type,rows] of [['record',s.record_questions||[]],['report',s.review_questions||[]]])for(const q of rows){
  if(q.replies?.length||now-Date.parse(q.created_at)<10000||taskList(s).some(t=>t.source?.question_id===q.id))continue;
  try{submitTask(s,{id:'question:'+q.id,agent_id:q.agent_id,kind:'question',prompt:q.body,summary:q.body.slice(0,200),source:{type,question_id:q.id}},'director',now);}catch{break;}
 }
}
function directorQuestion(s,t){
 if(t.kind!=='question'||t.sender_id!=='Director')return false;
 const rows=t.source?.type==='record'?s.record_questions:s.review_questions;
 const q=rows?.find(q=>q.id===t.source?.question_id);
 return q?.sender_kind!=='deputy';
}
function taskConflicts(s,t,other){
 if(other.agent_id!==t.agent_id||other.status!=='running')return false;
 // A fresh, read-only director reply may overlap one research task, never another question.
 return !((directorQuestion(s,t)&&other.kind!=='question')||(directorQuestion(s,other)&&t.kind!=='question'));
}
function questionContext(s,t){
 if(!t.source)return null;
 const q=(t.source.type==='record'?s.record_questions:s.review_questions)?.find(q=>q.id===t.source.question_id);
 const record=q?.record_snapshot||(s.reports||[]).find(r=>r.id===q?.report_id);
 if(!record)return null;
 const snapshot=Object.fromEntries(Object.entries(record).filter(([key])=>!['history','html','document_html','slides_html'].includes(key)));
 const text=JSON.stringify(snapshot);return {record_id:record.id,text,truncated:false};
}
function taskAllowed(s,t){if(s.workflow?.meeting_policy==='human'&&['awaiting_director','briefing'].includes(s.workflow.status)&&t.status==='queued'&&taskScience(t.kind)&&t.kind!=='library')return false;if(t.source?.type==='blocker_recovery'&&t.status==='queued'&&(s.paused||!s.task_policy?.research_enabled||t.direction_revision!==s.direction_revision))return false;return !(t.status==='queued'&&Math.max(Date.parse(s.runner_maintenance?.until)||0,Date.parse(s.task_maintenance?.until)||0)>Date.now())&&s.task_policy?.enabled&&t.policy_revision===s.task_policy.revision&&(!taskScience(t.kind)||s.task_policy.research_enabled&&!s.paused&&t.direction_revision===s.direction_revision)&&!agentFor(s,t.agent_id).dismissal;}
function taskHeld(s,p,now){const t=taskById(s,p.task_id);if(t.status!=='running'||t.runner_id!==p.runner_id||t.lease_id!==p.lease_id||Date.parse(t.lease_until)<now)throw new Invalid('Task claim expired or belongs to another worker.');if(!taskAllowed(s,t))throw new Invalid('Task allowance changed; stop the worker.');return t;}
// Rebuild from saved project records, not the last worker session or last meeting.
// Only discarded work is shared here; current independent drafts stay private.
export function rejectedCandidates(s,t=null){
 if(t&&!['proposal','research','meeting','vote','coordination'].includes(t.kind))return [];
 const meetings=s.research_records?.meeting||[],tasks=s.tasks||[];
 return [...(s.research_map?.nodes||[]).map(r=>({kind:'proposal',r})),...(s.research_records?.method||[]).map(r=>({kind:'method',r}))].filter(({r})=>r.status==='discarded').map(({kind,r})=>{
  const meeting=[...meetings].reverse().find(m=>m.director_decision?.discarded_ids?.includes(r.id));
  const decision=meeting?.director_decision;
  const presented=meeting?.presentations?.find(c=>c.id===r.id)||[...meetings].reverse().flatMap(m=>m.presentations||[]).find(c=>c.id===r.id);
  const taskId=presented?.task_id||r.proposal_versions?.at(-1)?.task_id||r.original_task_id||null;
  const saved=tasks.find(t=>t.id===taskId&&t.status==='completed');
  const mapDecision=kind==='proposal'?[...(s.decisions||[])].reverse().find(d=>d.choices?.some(c=>c.id===r.id&&c.status==='discarded')):null;
  const original=presentationForRejection(presented?.presentation||r.presentation||saved?.result?.presentation);
  return {id:r.id,kind,title:r.title,proposal_ids:kind==='method'?(r.proposal_ids||[]):[],presentation:original,summary:original?null:r.summary||null,rejection_reason:(kind==='method'?r.decision_reason:mapDecision?.comment)||decision?.discard_reason||decision?.comment||'No rejection reason was recorded; do not invent one.',meeting_id:meeting?.id||null,source_task_id:saved?.id||null,source:saved?'/task-documents/'+encodeURIComponent(saved.id)+'?workspace='+encodeURIComponent(s.project.id):null,feedback:(decision?.conversations||[]).filter(q=>!q.candidate_id||q.candidate_id===r.id).map(q=>({question:q.question,replies:(q.replies||[]).map(a=>a.body)})),...(!original?{document:saved?.result?.document||saved?.result?.body||r.notes||null}:{})};
 });
}
function presentationForRejection(p){if(!p)return null;const {rejection_check,...science}=p;return science;}
export function completedTaskOutputs(s,t){
 const queue=[...(t.document_ids||[]),...t.depends_on,...(t.workflow_context?.completed||[]).map(c=>c.task_id),...(t.workflow_context?.previous_investigation?.experiment_task_ids||[]),...(t.workflow_context?.previous_investigation?.assessment_task_ids||[]),...(t.workflow_context?.feasibility_results||[]).map(c=>c.task_id)],seen=new Set([t.id]),outputs=[];
 // A completed vote or report may link to evidence from its prerequisites.
 // Follow that saved chain, never unrelated tasks or unfinished peer drafts.
 for(let i=0;i<queue.length;i++){
  const id=queue[i];if(seen.has(id))continue;seen.add(id);
  const d=taskById(s,id);if(d.status!=='completed'||t.workflow_id&&d.workflow_id!==t.workflow_id&&!t.document_ids?.includes(id))continue;
  queue.push(...(d.depends_on||[]),...(d.document_ids||[]));
  if(d.result?.artifacts?.length)outputs.push({task_id:d.id,kind:d.kind,completion_id:d.completion_id,artifacts:d.result.artifacts});
 }
 // Give workers read-only access to the rejected candidate itself without
 // loading all of its old dependencies or making them new prerequisites.
 for(const row of rejectedCandidates(s,t)){if(!row.source_task_id||outputs.some(o=>o.task_id===row.source_task_id))continue;const d=taskById(s,row.source_task_id);if(d.result?.artifacts?.length)outputs.push({task_id:d.id,kind:d.kind,completion_id:d.completion_id,artifacts:d.result.artifacts});}
 return outputs;
}

function taskPacket(s,t,libraryContext=null){
  const a=agentFor(s,t.agent_id);
  const decision_packet=decisionPacket(s,t),included=new Set([...(t.document_ids||[]),...(t.decision_packet?.candidates||[]).map(c=>c.task_id),...(t.workflow_context?.completed||[]).map(c=>c.task_id)]);
  return {rejected_candidates:rejectedCandidates(s,t),reusable_outputs:completedTaskOutputs(s,t),registered_library:libraryContext,research_guidance:researchGuidance,writing_guidance:writingGuidance+(t.kind==='engineering'?' '+experimentFigureGuidance:''),writing_guidance_version:writingGuidanceVersion,workflow_context:t.workflow_context||null,source_inputs:t.source_inputs||null,task:{id:t.id,kind:t.kind,interactive_reply:directorQuestion(s,t),handler:t.handler||'model',prompt:t.prompt,summary:t.summary,input_refs:t.input_refs,depth:t.depth},claim:{task_id:t.id,runner_id:t.runner_id,lease_id:t.lease_id},agent:{id:a.id,name:a.name,role:a.role,specialty:a.specialty},team:s.agents.filter(a=>!a.dismissal).map(a=>({id:a.id,role:a.role,specialty:a.specialty.slice(0,160)})),project:s.project,scope:s.task_policy.scope,research_paused:s.paused,reviewed_record:questionContext(s,t),active_work:directorQuestion(s,t)?taskList(s).filter(o=>o.id!==t.id&&o.agent_id===t.agent_id&&o.status==='running').map(o=>({task_id:o.id,summary:o.summary})):[],decision_packet,documents:(t.document_ids||[]).map(id=>{const d=taskById(s,id);return {task_id:id,completion_id:d.completion_id,title:d.summary,text:taskDocumentText(d),format:'markdown'};}),dependencies:t.depends_on.map(id=>{const d=taskById(s,id);return {id,completion_id:d.completion_id,...(included.has(id)?{body_location:(t.document_ids||[]).includes(id)?'documents':t.workflow_context?.completed?.some(c=>c.task_id===id)?'workflow_context.completed':'decision_packet'}:{summary:d.result.summary,body:taskDocumentText(d)}),document_available:!!d.result.document,...(included.has(id)&&t.workflow_id?{}:{artifacts:d.result.artifacts})};})};
}
export function taskAction(s,p,role,now=Date.now(),libraryContext=null){
 const at=new Date(now).toISOString();
 if(p.action==='configure'){
  if(role!=='director')throw new Invalid('Only a recorded director instruction changes the task allowance.');
  const limit=p.max_model_calls??60;if(!Number.isInteger(limit)||limit<1||limit>100)throw new Invalid('Choose 1–100 model calls for this allowance.');
  const usage_mode=p.usage_mode??'warn';if(!['warn','hard'].includes(usage_mode))throw new Invalid('Choose warn or hard usage policy.');
  const client_id=taskText(p.client_id,'an allowance change ID',120),settings={enabled:p.enabled===true,research_enabled:p.research_enabled===true,scope:taskText(p.scope,'the allowed work'),max_model_calls:limit,usage_mode};
  if(s.task_policy?.client_id===client_id){if(JSON.stringify(s.task_policy.settings)!==JSON.stringify(settings))throw new Invalid('Allowance ID has different settings.');return s.task_policy;}
  for(const t of taskList(s))if(['queued','running'].includes(t.status)){t.status='cancelled';taskStatus(s,t,'blocked','Task allowance changed.',now);}
  s.task_policy={...settings,settings,client_id,used_calls:0,revision:(s.task_policy?.revision||0)+1,updated_at:at};return s.task_policy;
 }
 if(p.action==='submit')return submitTask(s,p,role,now);
 if(p.action==='retry'||p.action==='cancel'){
  const t=taskById(s,p.task_id);if(role!=='director'&&p.sender_id!==s.orchestrator_id)throw new Invalid('The orchestrator handles task recovery.');
  if(p.action==='cancel'){t.status='cancelled';taskEvent(s,t,'Cancelled: '+t.summary,now);return t;}
  if(t.status!=='failed')throw new Invalid('Retry only a failed task after checking its saved output.');
  if(t.attempts>=2)throw new Invalid('Two attempts reached. Resolve the problem before making a new task.');
  t.status='queued';t.policy_revision=s.task_policy.revision;delete t.error;return t;
 }
 if(role!=='task_runner')throw new Invalid('Use the authenticated task service for worker delivery.');
 taskText(p.runner_id,'runner ID',120);
 if(p.action==='maintenance'){
  if(typeof p.enabled!=='boolean')throw new Invalid('Choose whether to hold new task claims.');
  s.task_maintenance=p.enabled?{runner_id:p.runner_id,until:new Date(now+300000).toISOString()}:null;return {held:p.enabled,until:s.task_maintenance?.until||null};
 }
 if(p.action==='poll'){
  importTaskQuestions(s,now);
  for(const t of taskList(s))if(t.status==='running'&&Date.parse(t.lease_until)<now){t.status='failed';t.error='Worker stopped checking in. Check saved output before retrying.';taskStatus(s,t,'blocked',t.error,now);taskEvent(s,t,t.error,now);taskWarning(s,'task-worker-lost','A task lost its worker',t.summary,'Inspect its saved result before retrying; do not start a second copy.');}
  for(const t of taskList(s))if(t.status==='queued'&&t.depends_on.some(id=>['failed','cancelled'].includes(taskById(s,id).status))){t.status='failed';t.error='A required task failed or was cancelled.';taskEvent(s,t,t.error,now);}
  workflowTick(s,now);
  blockerRecoveryTick(s,now);
  const ready=taskList(s).filter(t=>t.status==='queued'&&taskAllowed(s,t)&&t.depends_on.every(id=>taskById(s,id).status==='completed')&&!taskList(s).some(o=>taskConflicts(s,t,o)));
  // Give the director the next free slot; eligibility and active work stay unchanged.
  ready.sort((a,b)=>Number(directorQuestion(s,b))-Number(directorQuestion(s,a)));
  usageWarnings(s);
  s.task_service={runner_id:p.runner_id,last_seen:at,mode:'task_queue'};
  if(ready.some(needsModel)&&remainingCalls(s)<=0)taskWarning(s,'task-call-budget','Task allowance reached',s.task_policy.used_calls+' model calls used.','Review completed work before extending the allowance.');
  return {ready:ready.filter(t=>!needsModel(t)||remainingCalls(s)>0).map(t=>({id:t.id,agent_id:t.agent_id,interactive_reply:directorQuestion(s,t)})),pending:taskList(s).filter(t=>t.status==='running').length};
 }
 if(p.action==='preview'||p.action==='preflight_fail'){
  const t=taskById(s,p.task_id);
  if(t.status!=='queued'||!taskAllowed(s,t)||!t.depends_on.every(id=>taskById(s,id).status==='completed'))return null;
  if(p.action==='preview')return taskPacket(s,t,libraryContext);
  t.status='failed';t.error=taskText(p.error,'the preflight failure',2000);taskStatus(s,t,'blocked',t.error.slice(0,280),now);taskEvent(s,t,'Stopped before a model call: '+t.summary,now);
  taskWarning(s,'task-preflight','A task needs its inputs checked',t.error,'The orchestrator should fix the packet or input record before retrying. No model call was made.');return t;
 }
 if(p.action==='claim'){
  const t=taskById(s,p.task_id);
  if(t.status!=='queued'||!taskAllowed(s,t)||(needsModel(t)&&remainingCalls(s)<=0)||!t.depends_on.every(id=>taskById(s,id).status==='completed')||taskList(s).some(o=>taskConflicts(s,t,o)))return null;
  t.output_access_version=completedTaskOutputs(s,t).length?4:0;t.file_access_task_ids=completedTaskOutputs(s,t).map(o=>o.task_id);if(libraryContext)t.library_context_versions=structuredClone(libraryContext.versions);if(needsModel(t))s.task_policy.used_calls++;t.writing_guidance_version=writingGuidanceVersion;t.attempts++;Object.assign(t,{status:'running',runner_id:p.runner_id,lease_id:crypto.randomUUID(),lease_until:new Date(now+90000).toISOString(),started_at:at});taskStatus(s,t,'working',t.summary,now);taskEvent(s,t,'Started: '+t.summary,now);
  return taskPacket(s,t,libraryContext);
 }
 if(p.action==='complete'||p.action==='redeliver'){
  const t=taskById(s,p.task_id),old=t.completion_id;
  if(old===p.completion_id){if(JSON.stringify(t.result)!==JSON.stringify(p.result))throw new Invalid('Completion ID has different content.');return {task_id:t.id,status:t.status,delivered:true};}
  if(p.action==='redeliver'){
   const w=s.workflow;
   if(t.status!=='failed'||t.result||t.runner_id!==p.runner_id||t.lease_id!==p.lease_id||!/^Worker stopped checking in\.|^Saved result could not be delivered:/.test(t.error||''))throw new Invalid('Recover only this worker’s saved, undelivered result.');
   if(!taskAllowed(s,t)||s.paused||t.direction_revision!==s.direction_revision||!s.task_policy.research_enabled||!w||w.status!=='blocked'||!w.reason?.startsWith('A required task failed:')||!w.batch.includes(t.id)||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('Preserve holds, changed permissions and unrelated workflow blocks.');
  }else taskHeld(s,p,now);
  taskText(p.completion_id,'completion ID',120);
  const r=p.result;if(t.kind==='coordination'&&(r?.requests?.length||!r?.workflow_plan||!['advance','stop'].includes(r.workflow_plan.action)||!Array.isArray(r.workflow_plan.assignments)))throw new Invalid('Coordination requires a structured plan and no peer requests.');taskText(r?.summary,'a result summary',Infinity);taskText(r.body,'the saved answer or findings',Infinity);
  if(r.document!==undefined&&r.document!==null)taskText(r.document,'the reply document',Infinity);
  if(r.presentation!==undefined)presentation(r.presentation);
  if(t.kind==='vote'&&r.outcome!=='blocked'){
   let vote;try{vote=JSON.parse(r.body);}catch{throw new Invalid('Return the vote as JSON with choice and reason.');}
   const packet=decisionPacket(s,t);
   if(!packet.options.includes(vote.choice))throw new Invalid('Vote for a supplied candidate or none_is_ready.');
   if(typeof vote.reason!=='string'||!vote.reason.trim())throw new Invalid('Include a voting reason.');
   const versions=packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}));
   if(JSON.stringify(r.decision_receipt)!==JSON.stringify(versions))throw new Invalid('Confirm the complete decision packet before delivering a vote.');
  }
  if(!['completed','blocked'].includes(r.outcome)||!Array.isArray(r.artifacts)||!r.artifacts.length||r.artifacts.length>20)throw new Invalid('Provide a saved result and outcome.');
  for(const a of r.artifacts){taskText(a.path,'artifact path',1500);if(!/^[0-9a-f]{64}$/.test(a.sha256)||!Number.isInteger(a.bytes)||a.bytes<0)throw new Invalid('Include file size and SHA-256 after saving.');}
  t.result=structuredClone(r);t.completion_id=p.completion_id;t.status=r.outcome==='blocked'?'failed':'completed';t.finished_at=at;
  if(p.action==='redeliver'){
   t.delivery_recovered_at=at;delete t.error;
   const w=s.workflow;
   if(w.batch.every(id=>taskById(s,id).status==='completed')){
    w.status='running';delete w.reason;w.updated_at=at;
    for(const key of ['workflow-stopped','task-worker-lost']){
     if(key==='task-worker-lost'&&taskList(s).some(o=>o.status==='failed'&&o.error?.startsWith('Worker stopped checking in.')))continue;
     const warning=s.warnings?.find(o=>o.key===key&&o.status==='open');
     if(warning)changeWarning(s,{action:'resolve',key,reporter:'Task service',expected_revision:warning.revision,resolution:'Delivered the saved result. The model did not repeat its work.',evidence:[{note:'Original task and result restored after delivery failed.',source:'tasks:'+s.project.id}]});
    }
   }
   taskEvent(s,t,'Delivered the saved result without repeating the model work.',now);
  }
  taskStatus(s,t,r.outcome==='blocked'?'blocked':'finished',r.summary.slice(0,280),now);taskEvent(s,t,'Finished: '+t.summary+' — '+r.summary,now);
  if(t.source){const rows=t.source.type==='record'?s.record_questions:s.review_questions;const q=rows?.find(q=>q.id===t.source.question_id);if(q&&!q.replies.some(reply=>reply.client_id===p.completion_id)){q.replies.push({id:'task-reply-'+t.id,client_id:p.completion_id,agent_id:t.agent_id,body:r.body,task_id:t.id,created_at:at});if(q.delivery)q.delivery={status:'answered',updated_at:at};const n=s.orchestrator_inbox?.find(n=>n.question_id===q.id);if(n){n.reviewed_at=at;n.reviewed_by=t.agent_id;}}}
  const ownerRecovery=t.source?.type==='experiment_owner_recovery'||s.blocker_recoveries?.some(c=>c.owner_recovery?.task_id===t.id);
  const requests=r.outcome==='completed'&&!t.workflow_id&&!ownerRecovery&&Array.isArray(r.requests)?r.requests:[],replyTasks=[],handoffDocuments=[...new Set([t.id,...(t.document_ids||[])])];
  if((t.workflow_id||ownerRecovery)&&r.requests?.length)taskEvent(s,t,'Saved input requests for the workflow checkpoint; no peer-request chain was started.',now);
  for(const [i,request] of requests.slice(0,3).entries())try{const requested=submitTask(s,{id:t.id+':request:'+i,agent_id:request.agent_id,sender_id:t.agent_id,kind:'question',prompt:request.question+'\nUse the complete attached saved evidence. A question reply can report a missing artifact but cannot acquire it without tools. Answer what is known and specify any tools-enabled task needed; do not send the same unanswered request back to its sender.',summary:request.question.slice(0,200),document_ids:handoffDocuments,input_refs:taskReportRefs(s,handoffDocuments),depth:t.depth+1,source:{type:'peer_request',parent_task_id:t.id,root_task_id:t.source?.root_task_id||t.id}},'worker',now);replyTasks.push(requested.id);}catch(e){taskWarning(s,'task-request-limit','A follow-up request needs attention',e.message,'Let the orchestrator resolve the request instead of repeating it.');}
  if(replyTasks.length&&t.depth<3)try{submitTask(s,{id:t.id+':answers',sender_id:t.agent_id,agent_id:t.agent_id,kind:'question',prompt:'Use the returned peer answers and complete documents to finish this question. Do not start research. '+t.prompt,summary:'Peer replies: '+t.summary.slice(0,180),depends_on:replyTasks,document_ids:[...new Set([...handoffDocuments,...replyTasks])],input_refs:taskReportRefs(s,[...handoffDocuments,...replyTasks]),depth:t.depth+1,source:t.source},'worker',now);}catch(e){taskWarning(s,'task-followup-blocked','Peer replies need routing',e.message,'The orchestrator should collect the saved replies.');}
  if(t.notify_orchestrator&&!ownerRecovery&&t.agent_id!==s.orchestrator_id)try{submitTask(s,{id:t.id+':notify',sender_id:t.agent_id,agent_id:s.orchestrator_id,kind:'question',prompt:'Checkpoint reached. Read the full saved report, summarize the implication and next needed decision; do not start extra work. '+r.summary,summary:'Review checkpoint: '+t.summary.slice(0,170),document_ids:[t.id],input_refs:taskReportRefs(s,[t.id]),depth:t.depth+1},'worker',now);}catch{}
  const promptSize=Number.isSafeInteger(r.prompt_bytes)&&r.prompt_bytes>=0?r.prompt_bytes:r.prompt_characters||0;
  if(promptSize>1000000)taskWarning(s,'task-large-packet','A task input exceeded the 1 MB warning threshold',String(promptSize)+(Number.isSafeInteger(r.prompt_bytes)&&r.prompt_bytes>=0?' bytes':' characters (legacy count)')+' were supplied for '+t.summary+'. This is input length, not total model context.','This is advisory; work can continue. Keep needed evidence complete and remove redundant material when useful.');
  usageWarnings(s);
  return {task_id:t.id,status:t.status,delivered:true};
 }
 if(p.action==='validate'){taskHeld(s,p,now);return {agent_id:taskById(s,p.task_id).agent_id};}
 if(p.action==='renew'){const t=taskHeld(s,p,now);t.lease_until=new Date(now+90000).toISOString();agentFor(s,t.agent_id).last_seen=at;
  if(advisoryUsage(s)&&!t.duration_warned&&now-Date.parse(t.started_at)>(s.workflow?.configuration.waiting_minutes||10)*60000){t.duration_warned=true;taskWarning(s,'task-long-running','A task is taking longer',t.summary+' has exceeded its time estimate; the worker is still checking in.','Inspect progress. Work continues; elapsed time alone does not stop the task.');}
  return {ok:true};}
 if(p.action==='fail'){const t=taskHeld(s,p,now);t.status='failed';t.error=taskText(p.error,'the failure',2000);taskStatus(s,t,'blocked',t.error.slice(0,280),now);taskEvent(s,t,'Task stopped: '+t.error,now);return t;}
 throw new Invalid('Unknown task action.');
}
