import {submitTask,completedTaskOutputs,taskReportRefs} from './tasks.mjs';
import {repairWorkflowChair,retryWorkflowPlan,repairWorkflowHandoff,reviewWorkflowObstacle,retryWorkflowReviews,reviewStoppedInvestigation,incompleteExperimentTask} from './workflow.mjs';
import {submitRequest} from './requests.mjs';
import {changeWarning} from './warnings.mjs';

// One persisted case per stopped checkpoint. Polling itself never calls a model.
const brLive=t=>['queued','running','delivery_pending'].includes(t?.status);
const brTask=(s,id)=>(s.tasks||[]).find(t=>t.id===id);
const brAllowed=(s,c)=>s.task_policy?.enabled&&s.task_policy.research_enabled&&!s.paused&&!s.project?.archived_at&&!s.project?.cleared_at&&c.policy_revision===s.task_policy.revision&&c.direction_revision===s.direction_revision;
const brCoveredOwnerReply=(s,t)=>(s.blocker_recoveries||[]).some(c=>c.owner_recovery?.review_started&&c.owner_recovery.review_started!=='unavailable'&&t.id.startsWith(c.owner_recovery.task_id+':'));
function brEvent(s,c,text,now,blocked=false){
 s.events.push({id:'recovery-event-'+crypto.randomUUID(),at:new Date(now).toISOString(),actor:'Orchestrator',agent_id:s.orchestrator_id,kind:blocked?'obstacle':'recovery',text,recovery_id:c.id,evidence:c.task_ids.map(id=>({note:brTask(s,id)?.summary||'Blocked task',source:'/task-documents/'+encodeURIComponent(id)+'?workspace='+encodeURIComponent(s.project.id)}))});
}
function brCases(s){
 const w=s.workflow,rows=[];
 if(w?.status==='blocked')rows.push({key:'workflow:'+w.id+':'+w.stage+':'+w.phase+':'+w.checkpoint,workflow_id:w.id,checkpoint:w.checkpoint,phase:w.phase,stage:w.stage,task_ids:[...new Set([w.chair_task,w.library_task,...w.batch,...(w.termination?.kind==='dependency'?[w.termination.task_id,...(s.tasks||[]).filter(t=>t.workflow_id===w.id&&t.kind==='engineering'&&t.workflow_context?.phase==='implement'&&t.workflow_context.selected_method_id===w.selected_method&&t.status==='completed').slice(-1).map(t=>t.id)]:[])].filter(id=>id&&(w.termination?.kind==='dependency'||['failed','cancelled'].includes(brTask(s,id)?.status)||id===w.chair_task)))],reason:w.reason||'The workflow could not continue.',policy_revision:w.policy_revision,direction_revision:w.direction_revision});
 for(const t of s.tasks||[])if(t.status==='failed'&&!t.workflow_id&&!['blocker_recovery','experiment_owner_recovery'].includes(t.source?.type)&&!s.blocker_recoveries?.some(c=>c.owner_recovery?.task_id===t.id)&&!brCoveredOwnerReply(s,t))rows.push({key:'task:'+t.id,task_ids:[t.id],reason:t.error||t.result?.summary||'The task could not finish.',policy_revision:t.policy_revision,direction_revision:t.direction_revision});
 for(const a of s.agents||[])if(!a.dismissal&&a.work_status?.state==='blocked'&&!brTask(s,a.work_status.task_id))rows.push({key:'status:'+a.id+':'+a.work_status.task_id,agent_id:a.id,external_task_id:a.work_status.task_id,task_ids:[],reason:a.work_status.summary+' '+a.work_status.waiting_for,policy_revision:s.task_policy?.revision,direction_revision:s.direction_revision});
 return rows;
}
function brIssue(s,c){
 if(c.workflow_id){const w=s.workflow;return w?.id===c.workflow_id&&w.stage===c.stage&&w.phase===c.phase&&w.checkpoint===c.checkpoint&&w.status==='blocked';}
 if(c.agent_id){const status=s.agents.find(a=>a.id===c.agent_id)?.work_status;return status?.state==='blocked'&&status.task_id===c.external_task_id;}
 return c.task_ids.some(id=>brTask(s,id)?.status==='failed'&&!brCoveredOwnerReply(s,brTask(s,id)));
}
function brResolveIdleStatus(s,c,now){
 if(c.status!=='resolved'||s.paused||brIssue(s,c))return;
 for(const a of s.agents||[]){
  const work=a.work_status;
  if(a.dismissal||a.status==='closed'||work?.state!=='blocked'||!(c.task_ids.includes(work.task_id)||c.agent_id===a.id&&c.external_task_id===work.task_id))continue;
  if((s.tasks||[]).some(t=>t.agent_id===a.id&&brLive(t)))continue;
  if((s.blocker_recoveries||[]).some(other=>other.id!==c.id&&other.status!=='resolved'&&other.task_ids.includes(work.task_id)&&brIssue(s,other)))continue;
  // Clear only this resolved task's current badge. Keep the original failure,
  // agent permission, last real check-in and all newer assignments unchanged.
  (a.work_status_resolutions||=[]).push({recovery_id:c.id,at:new Date(now).toISOString(),previous:structuredClone(work)});
  a.status_revision=(a.status_revision||0)+1;
  a.work_status={...work,state:'sleeping',summary:'The earlier blocking handoff was resolved. Waiting for the next assignment.',waiting_for:'The next assigned task.',base_status:a.status,updated_at:new Date(now).toISOString(),revision:a.status_revision,resolution_id:c.id,status_source:'Workflow controller'};
  brEvent(s,c,'Cleared '+a.name+'’s old blocked status after its recovery was verified. The agent is sleeping; the original failed request remains saved.',now);
 }
}
// A delivered but unperformed experiment needs its owner, before human help.
// Persist one attempt per original implementation, and adopt an already assigned
// continuation instead of changing or duplicating the active worker's request.
function brOwnerRecovery(s,c,now){
 const w=s.workflow;
 if(!c.workflow_id||w?.id!==c.workflow_id||w.status!=='blocked'||w.stage!=='Research'||w.phase!=='assess'||w.termination?.kind!=='dependency')return false;
 const original=[...(s.tasks||[])].reverse().find(t=>t.workflow_id===w.id&&t.kind==='engineering'&&t.workflow_context?.phase==='implement'&&t.workflow_context.selected_method_id===w.selected_method&&t.result);
 if(!original||!incompleteExperimentTask(original))return false;
 if(!brAllowed(s,c))return true;
 let saved=c.owner_recovery,task=brTask(s,saved?.task_id);
 if(saved){
  if(brLive(task)){c.status='owner_repairing';return true;}
  if(saved.result_seen_at)return false;
  if(!task||!['completed','failed','cancelled'].includes(task.status))return true;
  saved.result_seen_at=new Date(now).toISOString();saved.outcome=task.result?.outcome||task.status;
  c.task_ids=[...new Set([...c.task_ids,task.id])];c.status='pending';
  brEvent(s,c,'The experiment owner returned the repair attempt. The orchestrator will review the complete report and remaining obstacle.',now);
  return false;
 }
 const owner=s.agents.find(a=>a.id===original.agent_id);
 if(!owner||owner.dismissal||owner.status==='closed'||owner.role!=='engineer')return false;
 task=[...(s.tasks||[])].reverse().find(t=>t.id!==original.id&&t.kind==='engineering'&&t.agent_id===owner.id&&!t.workflow_id&&t.policy_revision===c.policy_revision&&t.direction_revision===c.direction_revision&&t.depends_on?.includes(original.id)&&(!t.workflow_context?.selected_method_id||t.workflow_context.selected_method_id===w.selected_method));
 if(!task){
  if((s.tasks||[]).some(t=>t.agent_id===owner.id&&brLive(t))){c.status='waiting_owner';return true;}
  if(Math.max(Date.parse(s.task_maintenance?.until)||0,Date.parse(s.runner_maintenance?.until)||0)>now){c.status='waiting_owner';return true;}
  const docs=[...new Set([original.id,...c.task_ids,...(original.document_ids||[])])].filter(id=>brTask(s,id)?.status==='completed'&&brTask(s,id)?.result);
  if(docs.length>20)throw new Error('The owner recovery needs a scoped input handoff before assignment.');
  const context={stage:'Research',phase:'owner_recovery',resource_brief:w.resource_brief,selected_proposal:w.selected_proposal_text,selected_method:w.selected_method_text,selected_method_id:w.selected_method,owner_recovery:{case_id:c.id,original_task_id:original.id,reason:c.reason},previous_investigation:{experiment_task_ids:[original.id],assessment_task_ids:c.task_ids.filter(id=>brTask(s,id)?.workflow_context?.phase==='assess')},director_reply:c.director_reply||null};
  task=submitTask(s,{id:c.id+'-owner',sender_id:s.orchestrator_id,agent_id:owner.id,kind:'engineering',summary:'Repair the stopped experiment using its saved work',document_ids:docs,input_refs:taskReportRefs(s,docs),source:{type:'experiment_owner_recovery',case_id:c.id,original_task_id:original.id},workflow_context:context,prompt:'You own the stopped implementation. Reuse its complete code, results and peer assessments. Diagnose the actual obstacle and attempt concrete repairs within the existing scope before asking for human help. Check approved inputs and available tools; use the relevant specialist for ambiguities. Preserve raw inputs, sealed evaluation data, physical semantics and comparison fairness. An unavailable prerequisite blocks only dependent work: complete independently valid parts of the assigned selected-method experiment when possible. Do not invent missing provenance, silently change the method or baseline, choose favorable seeds, or repeat an unchanged failed attempt. A scientific change requires researcher review. Save reproducible code/settings, actual measurements and costs, commands or tests for each repair, their outcomes, and the exact remaining missing file, access or specialist question. Successful unit checks alone do not complete an unperformed scientific comparison. Return records.json with execution_outcome complete, partial or blocked and scientific_outcome not_tested, inconclusive, positive or negative. A valid negative finding is acceptable; do not force a gain. Stop when the assigned experiment is validly measured or a specific obstacle is demonstrated after useful permitted repairs. Completed delivery and positive scientific evidence are separate. The orchestrator will inspect this saved attempt and route new results to the researchers; keep requests empty.'},'worker',now);
 }
 c.owner_recovery={original_task_id:original.id,task_id:task.id,agent_id:owner.id,method_id:w.selected_method,adopted:task.source?.type!=='experiment_owner_recovery',at:new Date(now).toISOString()};
 c.status='owner_repairing';c.updated_at=new Date(now).toISOString();
 const request=s.requests?.find(r=>r.id===c.request_id);if(request?.status==='pending'){request.status='closed';request.closed_reason='The experiment owner is attempting permitted repairs before any further human escalation.';}
 brEvent(s,c,'The experiment owner will attempt a focused repair before human escalation. '+(c.owner_recovery.adopted?'Watching the already assigned continuation; no duplicate task was created.':'The saved implementation and full assessments are attached.'),now);
 return true;
}
function brHelp(s,c,reason,question,now){
 try{if(brOwnerRecovery(s,c,now))return;}catch(e){reason+=' Owner recovery could not be assigned: '+e.message;}
 const request=submitRequest(s,{action:'submit',key:c.id,title:'Help needed to unblock the team',requester:'Orchestrator',context:(reason+'\nOriginal problem: '+c.reason).slice(0,12000),question:question.slice(0,3000),agent_ids:[...new Set([c.agent_id,...c.task_ids.map(id=>brTask(s,id)?.agent_id)].filter(Boolean))],options:[],evidence:c.task_ids.slice(0,12).map(id=>({note:(brTask(s,id)?.summary||'Saved task').slice(0,3000),source:'/task-documents/'+encodeURIComponent(id)+'?workspace='+encodeURIComponent(s.project.id)})),...(c.request_id?{expected_revision:s.requests.find(r=>r.id===c.request_id)?.revision}:{})});
 c.status='needs_help';c.request_id=request.id;c.resolution=reason;c.updated_at=new Date(now).toISOString();
 brEvent(s,c,'The team is still blocked. '+reason+' '+question,now,true);
}
function brApply(s,c,option,reason,now){
 const p={sender_id:s.orchestrator_id,task_id:option.task_id,reason:reason.slice(0,1000)};
 switch(option.id){
  case 'review_dependency':return reviewStoppedInvestigation(s,p,'worker',now);
  case 'correct_plan':return repairWorkflowChair(s,p,'worker',now);
  case 'saved_plan':return retryWorkflowPlan(s,p,'worker',now);
  case 'saved_findings':return reviewWorkflowObstacle(s,p,'worker',now);
  case 'restore_handoff':return repairWorkflowHandoff(s,p,'worker',now);
  case 'restore_reviews':return retryWorkflowReviews(s,p,'worker',now);
  default:throw new Error('This repair is not available.');
 }
}
function brOptions(s,c,now){
 const w=s.workflow;if(!c.workflow_id||w?.id!==c.workflow_id)return [];
 const proposals=[{id:'review_dependency',task_id:w.termination?.task_id,description:'Review the saved missing-input stop once and choose a focused engineer continuation of the selected method or ask for specific help. Preserve all completed work.'},{id:'correct_plan',task_id:w.chair_task,description:'Ask the orchestrator to correct its rejected plan using the saved work and the allowed next steps. Do not repeat researcher work.'},
 {id:'saved_plan',task_id:w.chair_task,description:'Apply the unchanged saved plan only if the current controller checks accept it.'},
 {id:'saved_findings',task_id:w.batch[0],description:'Review the saved blocked findings and assign only the missing follow-up.'},
 {id:'restore_handoff',task_id:w.phase==='implement'?w.batch.find(id=>brTask(s,id)?.status==='failed'):w.batch[0],description:'Restore missing links to completed evidence and continue only interrupted work.'}];
 const failed=w.batch.map(id=>brTask(s,id)).filter(t=>t&&t.status==='failed');
 if(failed.length&&failed.every(t=>completedTaskOutputs(s,t).some(o=>!(t.file_access_task_ids||[]).includes(o.task_id))))proposals.push({id:'restore_reviews',task_id:w.batch[0],description:'Restore read access to completed files needed by the interrupted reviews.'});
 // Trial each existing repair against a copy. Nothing is offered just because a model says it is safe.
 return proposals.filter(o=>{try{if(o.id==='saved_plan'&&!brTask(s,o.task_id)?.result)return false;const copy=structuredClone(s);brApply(copy,c,o,'Checked the saved failure and the existing repair conditions.',now);if(o.id==='saved_plan'&&brTask(s,o.task_id).status==='completed'&&copy.workflow.chair_task!==s.workflow.chair_task&&copy.workflow.phase===s.workflow.phase)return false;return copy.workflow.status==='running';}catch{return false;}});
}
function brQueue(s,c,now){
 const options=brOptions(s,c,now),tasks=c.task_ids.map(id=>brTask(s,id)).filter(Boolean);
 c.review_number=(c.review_number||0)+1;
 const context={recovery:{case_id:c.id,reason:c.reason,options,director_reply:c.director_reply||null,scope:s.task_policy.scope,failed_tasks:tasks.map(t=>({id:t.id,agent_id:t.agent_id,kind:t.kind,summary:t.summary,error:t.error||null,attempts:t.attempts,result:t.result?{outcome:t.result.outcome,summary:t.result.summary,body:t.result.body,document:t.result.document||null,records:t.result.records||null,workflow_plan:t.result.workflow_plan||null}:null})),previous_attempt:c.resolution||null}};
 const task=submitTask(s,{id:c.id+'-review-'+c.review_number,sender_id:s.orchestrator_id,agent_id:s.orchestrator_id,kind:'question',summary:'Find a way to unblock the team',document_ids:c.task_ids.filter(id=>brTask(s,id)?.status==='completed'&&brTask(s,id)?.result),input_refs:taskReportRefs(s,c.task_ids),source:{type:'blocker_recovery',case_id:c.id},workflow_context:context,prompt:'A team member or the workflow is blocked. You are the orchestrator: inspect the supplied failure and saved results, explain the cause in simple language, and choose a listed repair if it addresses that cause. These options were checked by the controller; it will check again before acting. Do not invent missing evidence, change the research question, bypass meetings or holds, repeat completed experiments, or claim a repair has worked before it is checked. For a dependency stop, review_dependency can assign a focused engineer check or an independently valid synthetic test through the current research checkpoint; it does not pretend the missing external inputs have appeared. Inspect the attached full implementation, assessments and original stop before deciding. Do not block unaffected work solely because IBM acceptance is waiting. If no listed option supports a useful next action, ask the director for the specific missing file, access, or service repair, explaining what you checked. Return outcome completed when this diagnosis is complete, even if help is still needed. Return requests: [] and body as one JSON object {"action":"one listed option ID or ask_director","reason":"brief diagnosis and why this action fits","question":"specific help needed, or empty for a repair"}. This is a recovery review, not a normal research checkpoint or a request for a workflow_plan.'},'worker',now);
 c.options=options;c.review_task_id=task.id;c.status='reviewing';c.updated_at=new Date(now).toISOString();
 task.source_inputs=tasks.filter(t=>t.completion_id&&t.result).flatMap(t=>(t.result.artifacts||[]).filter(a=>task.input_refs.includes(a.path)).map(a=>({task_id:t.id,agent_id:t.agent_id,...a})));
 brEvent(s,c,'The orchestrator is checking why work stopped and how to fix it.',now);
}
export function blockerRecoveryTick(s,now=Date.now()){
 if(!s.orchestrator_id||s.project?.archived_at||s.project?.cleared_at)return;
 const cases=s.blocker_recoveries||=[];
 for(const c of cases)brResolveIdleStatus(s,c,now);
 for(const issue of brCases(s)){
  const previous=cases.find(c=>c.key===issue.key);
  // Version-88 dependency reviews omitted the completed reports because only
  // failed tasks were treated as recovery evidence. Retry once with NEW inputs.
  if(previous){
   if(s.workflow?.termination?.kind==='dependency'&&previous.workflow_id&&previous.status==='needs_help'&&!previous.evidence_handoff_repair&&brAllowed(s,previous)&&issue.task_ids.some(id=>!previous.task_ids.includes(id))&&brTask(s,previous.review_task_id)?.status==='completed'){
    previous.evidence_handoff_repair={at:new Date(now).toISOString(),previous_task_id:previous.review_task_id,added_task_ids:issue.task_ids.filter(id=>!previous.task_ids.includes(id))};
    previous.task_ids=issue.task_ids;previous.status='pending';
    const request=s.requests?.find(r=>r.id===previous.request_id);if(request?.status==='pending'){request.status='closed';request.closed_reason='Recovery reports were missing from the first review; checking once with their full saved evidence.';}
    brEvent(s,previous,'Attached the original implementation, peer assessments and stopping decision. Reviewing once with the missing saved evidence; research is not repeated.',now);
   }
   continue;
  }
  const c={...issue,id:'blocker-'+crypto.randomUUID(),status:'pending',created_at:new Date(now).toISOString()};cases.push(c);
  brEvent(s,c,'Work is blocked. '+c.reason,now,true);
 }
 for(const c of cases){
  if(c.status==='resolved')continue;
  if(!brIssue(s,c)){
   if(c.status==='repairing'&&c.workflow_id&&s.workflow?.checkpoint===c.checkpoint&&s.workflow.phase===c.phase&&s.workflow.stage===c.stage)continue;
   c.status='resolved';c.updated_at=new Date(now).toISOString();
   const review=brTask(s,c.review_task_id);if(review?.status==='queued'){review.status='cancelled';review.error='The original block was resolved before this review started.';}
   const request=s.requests?.find(r=>r.id===c.request_id);if(request?.status==='pending')request.status='closed';
   brEvent(s,c,'The block is cleared. Saved work has been kept.',now);
   brResolveIdleStatus(s,c,now);
   continue;
  }
  if(brAllowed(s,c)&&!(c.status==='reviewing'&&brLive(brTask(s,c.review_task_id)))){
   try{if(brOwnerRecovery(s,c,now))continue;}catch(e){brHelp(s,c,'The owner recovery could not be assigned: '+e.message,'Please resolve the stated assignment obstacle; no experiment was repeated.',now);continue;}
  }
  if(c.status==='pending'&&brAllowed(s,c)&&c.owner_recovery?.result_seen_at&&!c.owner_recovery.review_started&&brTask(s,c.owner_recovery.task_id)?.status==='completed'){
   // Routing a new saved experiment to assessment is procedural, not a verdict.
   // Use the ordinary chair/peer checkpoint with full files, without a second
   // model diagnosis that could again request human help before reading results.
   const draft=structuredClone(s),saved=draft.blocker_recoveries.find(x=>x.id===c.id);
   try{
    reviewStoppedInvestigation(draft,{sender_id:s.orchestrator_id,task_id:s.workflow.termination.task_id,reason:'The experiment owner returned a new saved repair report. Assess it with the complete prior evidence.'},'worker',now);
    saved.owner_recovery.review_started=draft.workflow.chair_task;saved.status='repairing';saved.action='review_dependency';
    brEvent(draft,saved,'New owner results are going to the research checkpoint for assessment; no accuracy improvement is presumed.',now);
    Object.assign(s,draft);continue;
   }catch(e){c.owner_recovery.review_error=e.message;c.owner_recovery.review_started='unavailable';}
  }
  if(c.status==='reviewing'&&brTask(s,c.review_task_id)?.status==='failed'){
   brHelp(s,c,'The recovery review itself failed: '+(brTask(s,c.review_task_id).error||brTask(s,c.review_task_id).result?.summary||'No usable answer was delivered.'),'Please check the task service or the saved recovery error.',now);continue;
  }
  if(c.status==='repairing'){brHelp(s,c,'The attempted repair did not unblock this step. '+(s.workflow?.reason||c.reason),'Please help resolve the remaining cause shown in the saved recovery note.',now);continue;}
  if(c.status!=='pending'||!brAllowed(s,c)||s.agents.find(a=>a.id===s.orchestrator_id)?.dismissal||s.agents.find(a=>a.id===s.orchestrator_id)?.status==='closed')continue;
  if(Math.max(Date.parse(s.task_maintenance?.until)||0,Date.parse(s.runner_maintenance?.until)||0)>now||(s.tasks||[]).some(t=>t.agent_id===s.orchestrator_id&&brLive(t)))continue;
  try{brQueue(s,c,now);}catch(e){brHelp(s,c,'Could not start the recovery review: '+e.message,'Please check the orchestrator and task-service settings.',now);}
 }
}
export function blockerRecoveryComplete(s,taskId,now=Date.now()){
 const task=brTask(s,taskId);if(task?.source?.type!=='blocker_recovery')return;
 const c=s.blocker_recoveries?.find(c=>c.id===task.source.case_id);
 if(!c||c.review_task_id!==taskId||c.status!=='reviewing'||task.status!=='completed')return;
 if(!brIssue(s,c)){c.status='resolved';brEvent(s,c,'The block was cleared while the orchestrator checked it. No extra work was started.',now);return;}
 // The task service may move a long answer into its full reply document.
 let plan;for(const text of [task.result.body,task.result.document?.split('\n\n---\n\n')[0]])try{const value=JSON.parse(text);if(typeof value.reason==='string'&&value.reason.trim()&&typeof value.question==='string'){plan=value;break;}}catch{}
 if(!plan){
  brHelp(s,c,'The orchestrator’s recovery note did not contain a usable repair decision.','Please inspect its saved answer before retrying.',now);return;
 }
 c.resolution=plan.reason;
 if(plan.action==='ask_director'){brHelp(s,c,plan.reason,plan.question||'Please provide the missing input described in the recovery note.',now);return;}
 if(!brAllowed(s,c)){c.status='pending';brEvent(s,c,'The repair is waiting because the project permission or hold changed.',now);return;}
 const option=c.options.find(o=>o.id===plan.action),stillAvailable=brOptions(s,c,now).some(o=>o.id===option?.id&&o.task_id===option?.task_id);
 if(!stillAvailable){brHelp(s,c,'The proposed repair is unavailable or its conditions changed. '+plan.reason,'Please review the saved failure; no research was repeated.',now);return;}
 // Apply the checked action atomically. A failed repair must not partly alter the queue.
 const draft=structuredClone(s);
 try{brApply(draft,c,option,plan.reason,now);}catch(e){brHelp(s,c,'The repair failed its checks: '+e.message,'Please help resolve this cause before retrying.',now);return;}
 const saved=draft.blocker_recoveries.find(x=>x.id===c.id);saved.status='repairing';saved.action=option.id;saved.updated_at=new Date(now).toISOString();
 brEvent(draft,saved,'Trying a repair: '+plan.reason+' The next task will confirm whether it worked.',now);
 const warning=draft.warnings?.find(w=>w.key==='workflow-stopped'&&w.status==='open');if(warning)changeWarning(draft,{action:'resolve',key:warning.key,reporter:'Orchestrator',expected_revision:warning.revision,resolution:'A checked recovery has been queued; its outcome is still being watched.',evidence:[{note:'Saved recovery decision',source:'/task-documents/'+encodeURIComponent(taskId)+'?workspace='+encodeURIComponent(s.project.id)}]});
 Object.assign(s,draft);
}
export function blockerRecoveryReply(s,requestId){
 const c=s.blocker_recoveries?.find(c=>c.request_id===requestId&&c.status==='needs_help'),r=s.requests?.find(r=>r.id===requestId),reply=r?.responses?.at(-1);
 if(!c||!reply||['close','keep_pending'].includes(reply.decision))return;
 c.director_reply=structuredClone(reply);c.status='pending';
}
