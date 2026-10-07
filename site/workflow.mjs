import {taskDocumentText} from './documents.mjs';
import {advisoryUsage,remainingCalls,checkpointCeiling,usageSummary,usageWarnings} from './usage.mjs';
import {Invalid,agentFor} from './logic.mjs';
import {submitTask,taskAction,completedTaskOutputs,taskReportRefs} from './tasks.mjs';
import {upsertRecord,decideMethod} from './records.mjs';
import {upsertDirections,decideDirections} from './directions.mjs';
import {changeWarning} from './warnings.mjs';
import {convergence} from './presentations.mjs';
const wfText=(v,label,max=7000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Invalid('Provide '+label+' within '+max+' characters.');return v.trim();};
const wfTask=(s,id)=>{const t=s.tasks?.find(t=>t.id===id);if(!t)throw new Invalid('Missing workflow task: '+id);return t;};
export const researchGuidance='Proposal chooses the shared research question. In Research, every researcher uses the same agreed factor or idea, measured outcome and test conditions from research_focus and the selected proposal. Each researcher owns and independently develops its own complete method to implement that same idea. Explore meaningful implementation choices and explain your method’s steps, why it may help, cost and difference from peers. The team discusses each candidate once and researchers vote. The human director chooses what happens next before an engineer implements the approved experiment; do not merge candidates or assign only components before this vote. Expertise is a viewpoint, not a separate question. A noise model, decoder component, proof, test plan or cost check can be a task within one method, not a competing method by itself. State the shared idea and the specific implementation choice in a few simple sentences. Peers check whether candidates really differ in implementation or merely describe the same method, different components or changed outcomes. If drafts overlap, acknowledge it and investigate useful alternative implementations; do not invent cosmetic differences or claim untested superiority. The orchestrator must give each researcher a complete-method assignment and settle a common comparison basis before voting. Use useful component suggestions in the chosen method. Raise changes to the central idea, outcome or setting explicitly; do not silently preserve a conflicting older assignment. Record unexplained scope changes as unresolved, not as scientific agreement.';
export function workflowResearchFocus(s){
 const w=s.workflow;if(w?.stage!=='Research'||!w.selected_proposal)return null;
 const n=s.research_map?.nodes.find(n=>n.id===w.selected_proposal),p=n?.presentation||{},c=w.research_clarification;
 const focus={proposal_id:w.selected_proposal,question:p.question||n?.summary||'',idea:p.factor||'',outcome:p.outcome||'',conditions:p.conditions||'',source_task_id:n?.proposal_versions?.at(-1)?.task_id||null};
 if(w.method_revision)focus.director_method_instruction=w.method_revision.reason;
 if(c&&c.proposal_id===w.selected_proposal){const t=wfTask(s,c.summary_task_id);focus.clarification={reason:c.reason,task_id:t.id,text:taskDocumentText(t)};}
 return focus;
}
const wfEvent=(s,text,now)=>s.events.push({id:'workflow-'+crypto.randomUUID(),at:new Date(now).toISOString(),actor:'Orchestrator',agent_id:s.orchestrator_id,kind:'coordination',text});
const wfCriteria={Proposal:'Which proposal deserves the next small investment? Choose a significant, narrow question that remains open in the closest checked work, with a promising concrete idea, a meaningful outcome and clear test conditions. Require a credible data route and a useful next step with an affordable budget, expected learning and stopping point. Estimate full-study cost, but do not require measured full-study runtime, a finished method or proof that the idea helps before investigation. Distinguish real access/cost barriers from uncertainty a bounded check can resolve. Vote none_is_ready only when no candidate justifies that next step; never force a winner or ignore answered, unimportant or demonstrably infeasible questions.',Research:'Which method deserves the next small investment for the selected question? Prefer the simplest promising use of the proposed idea with fair comparisons, obtainable data, an affordable next test and a stopping point. A test may find no benefit; require useful learning, not a guaranteed improvement. Vote none_is_ready only when no option justifies that bounded test.'};
function wfBlock(s,reason,now){const w=s.workflow;if(w.status==='blocked'&&w.reason===reason)return;w.status='blocked';w.reason=reason;for(const t of s.tasks||[])if(t.workflow_id===w.id&&t.status==='queued'){t.status='cancelled';t.error=reason;const a=agentFor(s,t.agent_id);a.status_revision=(a.status_revision||0)+1;a.work_status={task_id:t.id,state:'blocked',summary:reason.slice(0,280),waiting_for:'Orchestrator review of the workflow failure.',updated_at:new Date(now).toISOString(),revision:a.status_revision};}w.updated_at=new Date(now).toISOString();wfEvent(s,'Workflow stopped: '+reason,now);s.events.at(-1).kind='obstacle';changeWarning(s,{action:'raise',key:'workflow-stopped',reporter:'Workflow controller',title:'Workflow needs attention',symptom:reason,impact:'Dependent work is stopped. The orchestrator will check the cause before a repair.',suggestion:'Check the saved recovery note or request for help before changing the run.',certainty:'observed',evidence:[{note:'Checkpoint '+w.checkpoint+' ('+w.phase+'): '+reason.slice(0,600),source:'workflow:'+s.project.id}]});}
function wfAllowed(s){const w=s.workflow;return w&&w.status==='running'&&s.task_policy?.enabled&&s.task_policy.research_enabled&&!s.paused&&w.policy_revision===s.task_policy.revision&&w.direction_revision===s.direction_revision;}
export function configureWorkflow(s,p,role,now=Date.now()){
 if(role!=='director')throw new Invalid('Only a director instruction starts a workflow.');
 const id=wfText(p.id,'a workflow ID',70);if(!/^[a-z0-9][a-z0-9-]*$/.test(id))throw new Invalid('Use a short lowercase workflow ID.');
 if(s.workflow){if(s.workflow.id===id&&JSON.stringify(s.workflow.configuration)===JSON.stringify(p))return s.workflow;throw new Invalid('This project already has a workflow; preserve its history and use a new project for a new run.');}
 if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused)throw new Invalid('A research allowance and an unpaused project are required.');
 if((s.tasks||[]).some(t=>['running','queued'].includes(t.status)))throw new Invalid('Start at an empty task checkpoint.');
 const researchers=p.researcher_ids;if(!Array.isArray(researchers)||researchers.length<2||researchers.length>5||new Set(researchers).size!==researchers.length||researchers.some(id=>agentFor(s,id).role!=='researcher'))throw new Invalid('Choose two to five researchers for complete peer packets.');
 if(agentFor(s,s.orchestrator_id).role!=='orchestrator'||agentFor(s,p.librarian_id).role!=='librarian')throw new Invalid('Assign the orchestrator and librarian.');
 if(p.engineer_id&&agentFor(s,p.engineer_id).role!=='engineer')throw new Invalid('Choose an engineer.');
 if(p.feasibility_budget!==undefined){wfText(p.feasibility_budget,'the allowed feasibility-check budget and stopping limit',1500);if(!p.engineer_id)throw new Invalid('A feasibility check needs an engineer.');}
 if(p.meeting_policy==='human'){p={...p,max_rounds:1};for(const role of ['engineer','mathematician'])if(agentFor(s,p[role+'_id']).role!==role)throw new Invalid('Assign an '+role+' for the meeting.');}
 for(const [key,min,max] of [['max_rounds',1,3],['max_cycles',1,3],['max_checkpoints',1,40],['waiting_minutes',1,120]])if(!Number.isInteger(p[key])||p[key]<min||p[key]>max)throw new Invalid('Choose a bounded '+key+'.');
 s.workflow={id,meeting_policy:p.meeting_policy||null,configuration:structuredClone(p),status:'running',stage:'Proposal',phase:'start',round:1,cycle:1,checkpoint:0,batch:[],candidates:[],presentations:[],critiques:[],responses:[],selected_proposal:null,selected_method:null,selected_proposal_text:null,selected_method_text:null,history:[],policy_revision:s.task_policy.revision,direction_revision:s.direction_revision,resource_brief:wfText(p.resource_brief,'the resource allowance',6000),created_at:new Date(now).toISOString(),updated_at:new Date(now).toISOString()};
 wfEvent(s,'Workflow started: independent proposals, complete peer meetings and checked next assignments.',now);workflowTick(s,now);return s.workflow;
}
function wfExpected(s,next){const w=s.workflow;if(next==='finished')return [];if(w.meeting_policy==='human'&&['critique','assess'].includes(next))return humanParticipants(s).filter(id=>id!==s.orchestrator_id);if(w.obstacle?.phase==='prepare'&&next==='prepare')return w.obstacle.failed.map(t=>t.agent_id);if(['implement','feasibility'].includes(next))return w.configuration.engineer_id?[w.configuration.engineer_id]:[];return w.configuration.researcher_ids;}
function wfCanCheck(s){
 const w=s.workflow,remaining=remainingCalls(s)-(w.chair_task?0:1);
 return w.stage==='Proposal'&&!!w.configuration.feasibility_budget&&!!w.configuration.engineer_id&&!w.feasibility_task&&w.checkpoint+3<=checkpointCeiling(s)&&remaining>=2*w.configuration.researcher_ids.length+4;
}
function wfCheckEvidence(s){const id=s.workflow.feasibility_task;return id&&wfTask(s,id).status==='completed'?wfEvidence(s,[id]):[];}
function wfNextOptions(s){const w=s.workflow;if(w.obstacle){
  if(w.checkpoint+1>=checkpointCeiling(s))return ['finished'];
  if(w.obstacle.phase==='response')return w.batch.every(id=>wfTask(s,id).result?.document?.trim())?['vote','finished']:['finished'];
  const options=[];const readingRetries=w.reading_recoveries??w.recoveries?.length??0;
  const remaining=remainingCalls(s)-(w.chair_task?0:1);
  if(readingRetries<2&&remaining>=w.obstacle.failed.length+1+3*(w.configuration.researcher_ids.length+1))options.push('prepare');
  if(w.library_task&&wfTask(s,w.library_task).status==='completed'&&w.batch.every(id=>wfTask(s,id).result?.document?.trim()))options.push('critique');
  return [...options,'finished'];
 }
 if(w.checkpoint>=checkpointCeiling(s))return ['finished'];
 if(w.phase==='start')return ['prepare'];
 if(w.phase==='prepare')return ['critique'];
 if(w.meeting_policy==='human'&&w.phase==='critique')return ['vote'];
 if(w.phase==='critique')return wfCanCheck(s)?['response','feasibility']:['response'];
 if(w.phase==='feasibility')return ['response'];
 if(w.meeting_policy==='human'&&w.phase==='response')return ['vote'];
 if(w.phase==='response')return w.focus_review_pending?['response']:['vote'];
 if(w.phase==='implement')return ['assess'];
 if(w.phase==='assess')return wfUnassessedOwnerRecovery(s).length?['assess']:['prepare','reconsider',...(w.configuration.engineer_id&&w.selected_method?['implement']:[]),'finished'];
 if(w.phase==='vote'||w.phase==='reconsider'){
  const v=w.ballot;
  if(!v.final)return ['prepare'];
  if(v.outcome==='none_is_ready')return w.cycle<w.configuration.max_cycles?['prepare',...(wfCanCheck(s)?['feasibility']:[]),'finished']:['finished'];
  if(w.phase==='reconsider')return ['prepare','finished'];
  return w.stage==='Proposal'?['prepare','finished']:(w.configuration.engineer_id?['implement','finished']:['finished']);
 }
 return ['finished'];
}
const wfOptions=s=>[...new Set([...wfNextOptions(s),'finished'])];
function wfBallot(s){const w=s.workflow,rows=w.batch.map(id=>wfTask(s,id)),votes=rows.map(t=>({agent_id:t.agent_id,...JSON.parse(t.result.body)}));const counts={};for(const v of votes)counts[v.choice]=(counts[v.choice]||0)+1;const high=Math.max(...Object.values(counts)),leaders=Object.keys(counts).filter(k=>counts[k]===high),unanimous=high===w.configuration.researcher_ids.length,final=unanimous||w.round>=w.configuration.max_rounds;const outcome=final?(leaders.includes('none_is_ready')?'none_is_ready':leaders.length===1?leaders[0]:'tie'):null;return {votes,counts,leaders,unanimous,final,outcome};}
function wfEvidence(s,ids){return ids.map(id=>{const t=wfTask(s,id);return {task_id:id,completion_id:t.completion_id,agent_id:t.agent_id,summary:t.result.summary,text:taskDocumentText(t)};});}
// Carry actual experiment evidence across rounds; another worker cannot open arbitrary artifact paths.
function wfOwnerRecoveryTasks(s){
 const w=s.workflow;
 return (s.blocker_recoveries||[]).filter(c=>c.workflow_id===w.id&&c.owner_recovery?.method_id===w.selected_method).map(c=>s.tasks.find(t=>t.id===c.owner_recovery.task_id)).filter(t=>t?.status==='completed'&&t.result);
}
function wfUnassessedOwnerRecovery(s){
 const assessments=(s.workflow.history||[]).filter(h=>h.stage==='Research'&&h.phase==='assess').flatMap(h=>h.task_ids).map(id=>s.tasks.find(t=>t.id===id)).filter(t=>t?.status==='completed');
 return wfOwnerRecoveryTasks(s).filter(t=>!s.workflow.configuration.researcher_ids.every(agentId=>assessments.some(a=>a.agent_id===agentId&&a.document_ids?.includes(t.id))));
}
function wfResearchEvidence(s){
 const w=s.workflow;if(w.stage!=='Research')return {document_ids:[],previous_investigation:null};
 const history=w.history||[],index=history.findLastIndex(h=>h.stage==='Research'&&h.phase==='implement');
 if(index<0)return {document_ids:[],previous_investigation:null};
 const experimentIds=[...new Set([...history[index].task_ids.filter(id=>wfTask(s,id).status==='completed'),...wfOwnerRecoveryTasks(s).map(t=>t.id)])];
 const assessments=history.slice(index+1).filter(h=>h.stage==='Research'&&h.phase==='assess').at(-1)?.task_ids||[];
 const implementation=experimentIds.length?wfTask(s,experimentIds[0]):null;
 if(implementation?.workflow_context?.selected_proposal!==w.selected_proposal_text)return {document_ids:[],previous_investigation:null};
 const methodText=implementation?.workflow_context?.selected_method||null;
 return {document_ids:[...new Set([...experimentIds,...assessments])],previous_investigation:{method_id:implementation?.workflow_context?.selected_method_id||(methodText===w.selected_method_text?w.selected_method:null),method_text:methodText,experiment_task_ids:experimentIds,assessment_task_ids:assessments}};
}
function wfReviewSources(s,ids=s.workflow.presentations){
 return ids.map(id=>{const t=wfTask(s,id),f=t.result.artifacts?.find(a=>a.path.endsWith('/sources.json'));if(!f)throw new Invalid('Missing saved source records for '+id);return {task_id:id,agent_id:t.agent_id,...f};});
}
function wfRegistration(s,sources){if(!sources.length)return null;const task=[...(s.tasks||[])].reverse().find(t=>t.status==='completed'&&t.handler==='library_collect'&&sources.every(f=>t.source_inputs?.some(x=>x.path===f.path&&x.sha256===f.sha256)));return task?{task_id:task.id,completion_id:task.completion_id,summary:task.result.summary}:null;}
function wfChairEvidence(s){
 const w=s.workflow,ids=w.phase==='start'?[]:w.phase==='prepare'?w.batch:w.presentations;
 const available=ids.filter(id=>wfTask(s,id).result?.artifacts?.some(a=>a.path.endsWith('/sources.json')));
 const sources=wfReviewSources(s,available),registration=wfRegistration(s,sources);
 const task=registration?wfTask(s,registration.task_id):null;
 const saved=(task?.result.artifacts||[]).filter(a=>a.path.endsWith('/library.json')||a.path.endsWith('/library-receipt.json')).map(a=>({task_id:task.id,agent_id:task.agent_id,...a}));
 // The registered handoff contains the source records, project links and reading limits.
 // Include its real delivery receipt; never manufacture a confirmation from a summary.
 const complete=saved.some(a=>a.path.endsWith('/library.json'))&&saved.some(a=>a.path.endsWith('/library-receipt.json'));
 const inputs=complete?saved:[...sources,...saved];
 return {input_refs:inputs.map(f=>f.path),source_inputs:[...sources,...saved],context:{source_registration:registration?{...registration,artifacts:saved,receipt_available:complete}:null,source_record_task_ids:available,missing_source_task_ids:ids.filter(id=>!available.includes(id))}};
}
function wfQueueChair(s,now,replacementId=null,evidence=wfChairEvidence(s)){const w=s.workflow,id=replacementId||w.id+'-chair-'+w.checkpoint+(w.resume_count?'-resume-'+w.resume_count:'')+(w.obstacle?'-obstacle-'+w.recovery_count:'')+(w.focus_revision?'-focus-'+w.focus_revision:'');
 const next=wfOptions(s),ids=w.phase==='start'?[]:w.batch,researchEvidence=wfResearchEvidence(s);
 evidence={...evidence,input_refs:[...new Set([...evidence.input_refs,...taskReportRefs(s,researchEvidence.document_ids)])]};
 const context={...evidence.context,previous_investigation:researchEvidence.previous_investigation,research_focus:workflowResearchFocus(s),focus_review_pending:!!w.focus_review_pending,id:w.id,stage:w.stage,phase:w.obstacle?'obstacle':w.phase,obstacle:w.obstacle||null,round:w.round,cycle:w.cycle,checkpoint:w.checkpoint,allowed_next_phases:next,feasibility_budget:w.configuration.feasibility_budget||null,feasibility_results:wfCheckEvidence(s),expected_owners:Object.fromEntries(next.map(k=>[k,wfExpected(s,k)])),resource_brief:w.resource_brief,selected_proposal:w.selected_proposal_text,selected_method:w.selected_method_text,ballot:w.ballot||null,candidates:w.candidates,revision_rule:w.stage==='Research'?'Revise your implementation under the same selected research idea, outcome and conditions. Keep method IDs and earlier evidence. Correct conflicting scope assumptions explicitly; do not preserve a different research question merely to keep an option distinct.':'After a non-converged vote, each owner revises their original question. A peer’s different question is not a revision. Keep the same proposal IDs and retain prior documents.',candidate_documents:['vote','reconsider'].includes(w.phase)?wfEvidence(s,w.candidates.map(c=>c.task_id)):[],criteria:wfCriteria[w.stage],completed:wfEvidence(s,ids),usage_mode:advisoryUsage(s)?'warn':'hard',usage:usageSummary(s),checkpoint_limit:advisoryUsage(s)?null:w.configuration.max_checkpoints,remaining_model_calls:advisoryUsage(s)?null:remainingCalls(s)-1,calls_to_complete_selection:w.phase==='prepare'?3*(w.configuration.researcher_ids.length+1):null};
 const t=submitTask(s,{id,sender_id:s.orchestrator_id,agent_id:s.orchestrator_id,kind:'coordination',prompt:'Chair the saved checkpoint. In warning mode, model calls, tokens, checkpoints and elapsed time are advisory: never stop solely for these counts. Null remaining_model_calls or checkpoint_limit means no hard cap. Use the CURRENT resource_brief over older limits in saved proposals. Keep the three-round voting rule, genuine resource constraints, user holds and the agreed scientific endpoint. After repeated disagreement, target new evidence rather than another broad rewrite; if no useful next action is identified, stop and state why. If obstacle.phase is prepare, choose focused follow-up only if prepare is allowed; assign only those owners and preserve completed peers. If critique is allowed, you may instead accept complete provisional candidates with their registered source records for peer review, preserving every uncertainty. An unmeasured cost or uncertain novelty is not itself a delivery failure. Never claim scientific readiness merely because delivery is accepted. If obstacle.phase is response, decide whether every saved response contains a complete provisional candidate with its uncertainties clearly stated. Only then may you advance to vote: this accepts delivery, not scientific readiness. If required candidate text is missing, stop and state what is needed. Never fill in missing science or convert a blocked outcome into a positive finding. Frame selection as which candidate deserves the next small investment. Unmeasured full-study cost, unfinished code or unknown benefit alone is not grounds to reject an affordable informative next step. Do not supply voters a rejection checklist or demand proof of success before investigation. Retain genuine access, significance and prior-work concerns. If feasibility is an allowed phase, you may give the engineer one small check on the most promising candidate whose code, data or runtime uncertainty prevents a decision. Name that candidate, the question, allowed budget, expected evidence and stop condition in its assignment. This is evidence gathering, not selection or permission for a full study. Use reading for literature questions, measurements for measurement questions. Never assign a check outside resource_brief, scope or feasibility_budget. After the check, researchers revise and vote from the full result. A provisional proposal may be delivered without proving novelty or running future tests. Stop if it cannot be resolved within the allowance. After assessing an experiment, implement may continue the SAME selected method with a focused engineer check and complete previous evidence; another method-selection meeting is unnecessary unless the method changes. Check missing inputs within the allowed sources before requesting director help. A missing IBM prerequisite blocks only dependent IBM work; consider independently useful synthetic work within the agreed question and comparisons. Never open sealed test outcomes or bypass acceptance checks. Return workflow_plan with action advance or stop, stop_kind (endpoint when the agreed scientific endpoint was reached, dependency for missing input/access/service, no_next_step for a concluded investigation with no useful next action, otherwise null), next_phase chosen from allowed_next_phases, summary, assignments for exactly the expected_owners (each agent_id, prompt, summary), tie_choice (only a listed tied candidate when needed), and stop_reason (required to stop, otherwise null). A selected method alone finishes only a director-authorized selection-only demonstration. A missing prerequisite must use dependency, not endpoint. A completed negative result may reach the endpoint; an unperformed comparison does not establish success. Do not invent a vote, bypass a source gate, or turn weak proposals into accepted science. Keep assignments concise; state the new question or missing evidence without repeating the shared review checklist. Keep each assignment prompt below 4000 characters. Give each assignment concrete inputs, expected output and stopping point within resource_brief. The controller attaches complete saved documents and validates transitions. Use simple language. Requests must be empty. If finished is the only allowed phase, stop with no assignments. A valid final tied candidate needs your evidence-based tie_choice and explanation even when stopping at the run limit.',summary:'Review the team’s progress and choose the next step',input_refs:evidence.input_refs,document_ids:researchEvidence.document_ids.filter(id=>!ids.includes(id)),depends_on:w.obstacle?[]:ids,workflow_context:context},'worker',now);t.workflow_context=context;t.source_inputs=evidence.source_inputs;if(w.meeting_policy==='human'){t.prompt='Repair only the reported obstacle within the already approved work. Meetings have one discussion and one researcher vote, followed by a human decision. Do not create a response/revision round, select a candidate, break a tie or start a new experiment. Use the supplied allowed phases and exact owners. Return a workflow_plan with empty requests. Preserve complete provisional findings and genuine uncertainty; if useful repair is unavailable, explain the missing input to the human.';t.request.prompt=t.prompt;}
 if(w.meeting_policy==='human'){t.prompt='Repair only the reported obstacle within the already approved work. Meetings have one discussion and one researcher vote, followed by a human decision. Do not create a response or revision round, select a candidate, break a tie or start a new experiment. Use the supplied allowed phases and exact owners. Return a workflow_plan with empty requests. Preserve complete provisional findings and genuine uncertainty; if useful repair is unavailable, explain the missing input to the human.';t.request.prompt=t.prompt;}
 t.workflow_id=w.id;w.chair_task=t.id;w.updated_at=new Date(now).toISOString();
}
// Candidate titles describe the science; task summaries describe the activity.
function wfCandidateTitle(task,fallback){
 const document=task.result.document||task.result.body||'';
 const title=document.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
 if(!title)return fallback;
 const plain=title.replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*_`]/g,'').trim();
 if(!plain)return fallback;
 return plain.length<=150?plain:plain.slice(0,147).replace(/\s+\S*$/,'')+'…';
}
function wfCandidateVersion(s,c){const t=wfTask(s,c.task_id);return {task_id:t.id,round:s.workflow.round,title:c.title,at:t.finished_at||new Date().toISOString()};}
function wfSaveCandidates(s){
 const w=s.workflow;
 if(w.stage==='Proposal'){
  upsertDirections(s,{expected_revision:s.research_map?.revision||0,actor:'Orchestrator',nodes:w.candidates.map(c=>{const old=s.research_map?.nodes.find(n=>n.id===c.id),t=wfTask(s,c.task_id);return {id:c.id,title:c.title,summary:t.result.presentation?.question||t.result.body,presentation:t.result.presentation||null,evidence:[...(old?.evidence||[]),{note:'Round '+w.round+' proposal version',source:'/task-documents/'+encodeURIComponent(t.id)+'?workspace='+encodeURIComponent(s.project.id)}]};})});
  for(const c of w.candidates){const n=s.research_map.nodes.find(n=>n.id===c.id);n.owner_id=c.owner_id;n.original_task_id=c.original_task_id;n.proposal_versions=[...(n.proposal_versions||[]).filter(v=>v.task_id!==c.task_id),wfCandidateVersion(s,c)];delete n.revision_note;}
 }else for(const c of w.candidates){const old=s.research_records?.method?.find(m=>m.id===c.id),t=wfTask(s,c.task_id);upsertRecord(s,{agent_id:s.orchestrator_id,type:'method',expected_revision:old?.revision||0,record:{id:c.id,title:c.title,summary:t.result.summary,presentation:t.result.presentation||null,notes:t.result.document||t.result.body,proposal_ids:[w.selected_proposal],evidence:[...(old?.evidence||[]),{note:'Round '+w.round+' method version',source:'/task-documents/'+encodeURIComponent(t.id)+'?workspace='+encodeURIComponent(s.project.id)}]}});}
}
function wfRefreshCandidates(s,now){
 const w=s.workflow;
 w.candidates=w.candidates.map(c=>{const t=w.batch.map(id=>wfTask(s,id)).find(t=>t.agent_id===c.owner_id);if(!t)throw new Invalid('Missing the candidate owner’s revision.');return {...c,task_id:t.id,title:wfCandidateTitle(t,c.title)};});
 wfSaveCandidates(s);
}
function wfCandidates(s,now){
 const w=s.workflow,prior=[...w.history].reverse().find(h=>h.phase==='prepare'),revise=(w.round>1&&prior?.stage===w.stage&&prior.cycle===w.cycle)||(w.stage==='Research'&&prior?.stage==='Research');
 const oldByOwner=new Map(w.candidates.map(c=>[c.owner_id,c]));
 w.candidates=w.batch.map((id,i)=>{const t=wfTask(s,id),old=revise?oldByOwner.get(t.agent_id):null;return {id:old?.id||(w.stage==='Proposal'?'proposal':'method')+'-c'+w.cycle+'-r'+w.round+'-a'+(i+1)+'-n'+w.checkpoint,task_id:t.id,original_task_id:old?.original_task_id||old?.task_id||t.id,owner_id:t.agent_id,title:wfCandidateTitle(t,old?.title||(w.stage==='Proposal'?'Proposal':'Method')+' '+(i+1))};});
 wfSaveCandidates(s);
}
function wfSourceBarrier(s,now){const w=s.workflow;if(w.library_task)return wfTask(s,w.library_task).status==='completed';
 const source_inputs=w.batch.map(id=>{const t=wfTask(s,id),f=t.result.artifacts.find(a=>a.path.endsWith('/sources.json'));if(!f)throw new Invalid('Researcher '+agentFor(s,t.agent_id).name+' did not save sources.json; register its real reading before a meeting.');return {task_id:id,agent_id:t.agent_id,...f};});
 const t=submitTask(s,{id:w.id+'-sources-'+w.checkpoint+'-recovery-'+(w.recovery_count||0),sender_id:s.orchestrator_id,agent_id:w.configuration.librarian_id,kind:'library',handler:'library_collect',prompt:'Register the researchers’ saved source records without scientific analysis or a model call.',summary:'Add this round’s papers to the library',input_refs:source_inputs.map(f=>f.path),depends_on:w.batch.filter(id=>wfTask(s,id).status==='completed')},'worker',now);t.source_inputs=source_inputs;t.workflow_id=w.id;w.library_task=t.id;return false;
}
// A recorded return vote ends the old investigation; it does not erase its findings.
function wfCloseInvestigation(s,meeting,now,repair=false){
 const w=s.workflow;if(w.investigation_closures?.some(c=>(c.decision_id||c.meeting_id)===meeting.id))return;
 const proposals=meeting.proposal_ids||[],methods=s.research_records?.method||[];
 const tested=(s.tasks||[]).filter(t=>t.workflow_id===w.id&&t.status==='completed'&&t.kind==='engineering'&&t.workflow_context?.phase==='implement'&&methods.some(m=>m.id===t.workflow_context.selected_method_id&&m.proposal_ids?.some(id=>proposals.includes(id))));
 if(!tested.length)return;
 const ids=[...new Set(tested.map(t=>t.workflow_context.selected_method_id))],at=new Date(now).toISOString(),reason=meeting.decision_task_id?'The team finished this investigation after reviewing the saved results.':'The team returned to Proposal after reviewing the saved results.';
 for(const m of methods.filter(m=>ids.includes(m.id)&&['active','unexplored'].includes(m.status))){
  const {history,...snapshot}=m;(m.history||=[]).push(structuredClone(snapshot));
  m.status='explored';m.decision_reason=reason;m.revision++;m.updated_at=at;m.updated_by=s.orchestrator_id;
  const own=tested.filter(t=>t.workflow_context.selected_method_id===m.id);
  m.experiment_ids=[...new Set([...(m.experiment_ids||[]),...(s.research_records.experiment||[]).filter(e=>own.some(t=>t.id===e.task_id)||e.method_ids?.includes(m.id)).map(e=>e.id)])];
  m.evidence=[...(m.evidence||[]),...own.map(t=>({note:'Completed investigation result',source:'/task-documents/'+encodeURIComponent(t.id)+'?workspace='+encodeURIComponent(s.project.id)}))];
 }
 const nodes=s.research_map?.nodes.filter(n=>proposals.includes(n.id)&&['under_exploration','unexplored'].includes(n.status))||[];
 if(repair){
  // Historical label repair must not invalidate the permission of healthy current tasks.
  if(nodes.some(n=>n.status==='under_exploration'))return;
  if(nodes.length){const map=s.research_map;map.history.push({revision:map.revision,at,actor:'Workflow controller',note:reason,nodes:structuredClone(map.nodes)});for(const n of nodes)n.status='explored';map.revision++;}
 }else if(nodes.length){decideDirections(s,{expected_revision:s.research_map.revision,choices:nodes.map(n=>({id:n.id,status:'explored'})),comment:reason},{actor:'Orchestrator (team vote)'});w.direction_revision=s.direction_revision;}
 (w.investigation_closures||=[]).push({decision_id:meeting.id,...(meeting.decision_task_id?{decision_task_id:meeting.decision_task_id}:{meeting_id:meeting.id}),proposal_ids:proposals,method_ids:ids,task_ids:tested.map(t=>t.id),at,repair});
 wfEvent(s,'The previous question and tested methods are now marked explored. Their results remain available.',now);
}
export function incompleteExperimentTask(task){
 if(!task?.result)return false;
 const raw=task.result.records,entries=Array.isArray(raw)?raw:raw?.records||raw?.experiments||[];
 return task.result.outcome==='blocked'||entries.some(e=>{const r=e.record||e;return (!e.type||e.type==='experiment')&&(['stopped','blocked'].includes(r.status)||['partial','blocked'].includes(r.execution_outcome));});
}
function wfIncompleteInvestigation(s){
 const w=s.workflow;
 if(w?.stage!=='Research'||w.phase!=='assess')return false;
 const latest=wfOwnerRecoveryTasks(s).at(-1)||[...(s.tasks||[])].reverse().find(t=>t.workflow_id===w.id&&t.kind==='engineering'&&t.workflow_context?.phase==='implement'&&t.workflow_context.selected_method_id===w.selected_method);
 return incompleteExperimentTask(latest);
}
function wfDependencyStop(s,taskId,reason,now,legacy=false){
 const w=s.workflow;w.termination={kind:'dependency',task_id:taskId,reason,at:new Date(now).toISOString(),legacy};
 w.chair_task=null;w.next_action=reason;wfBlock(s,reason,now);
 const a=agentFor(s,s.orchestrator_id);a.status_revision=(a.status_revision||0)+1;
 a.work_status={task_id:taskId,state:'blocked',summary:reason.slice(0,280),waiting_for:'A checked dependency repair using the saved investigation.',updated_at:new Date(now).toISOString(),revision:a.status_revision};
}
function wfRestoreIncompleteStop(s,now){
 const w=s.workflow;
 if(w?.status!=='finished'||w.termination||!wfIncompleteInvestigation(s)||s.paused||!s.task_policy?.enabled||!s.task_policy.research_enabled||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision||s.project?.archived_at||s.project?.cleared_at||s.tasks.some(t=>['queued','running'].includes(t.status)))return;
 const final=[...s.tasks].reverse().find(t=>t.workflow_id===w.id&&t.kind==='coordination'&&t.status==='completed'&&t.workflow_context?.phase==='assess'&&t.result?.workflow_plan?.action==='stop');
 if(!final)return;
 const closure=w.investigation_closures?.find(c=>c.decision_task_id===final.id&&!c.retracted_at);
 if(closure){
  // Undo only the controller's own closure, retaining both the old decision and audit trail.
  const map=s.research_map,prior=map.history?.at(-1),n=map.nodes.find(n=>n.id===w.selected_proposal);
  if(n?.status==='explored'&&prior?.actor==='Orchestrator (team vote)'&&prior.revision===map.revision-1&&prior.nodes.find(n=>n.id===w.selected_proposal)?.status==='under_exploration'&&!map.nodes.some(n=>n.status==='under_exploration')){
   map.history.push({revision:map.revision,at:new Date(now).toISOString(),actor:'Workflow controller',note:'Corrected a missing-input stop; the research question remains active.',nodes:structuredClone(map.nodes)});
   n.status='under_exploration';map.revision++;s.direction_revision++;w.direction_revision=s.direction_revision;
  }
  const m=s.research_records?.method?.find(m=>m.id===w.selected_method),old=m?.history?.at(-1);
  if(m?.status==='explored'&&m.updated_by===s.orchestrator_id&&m.updated_at===closure.at&&old?.status==='active'){
   const {history,...snapshot}=m;m.history.push(structuredClone(snapshot));m.status='active';m.decision_reason='Selected method remains under investigation; missing inputs prevented completion.';m.revision++;m.updated_at=new Date(now).toISOString();
  }
  closure.retracted_at=new Date(now).toISOString();closure.retraction_reason='The saved implementation explicitly stopped for missing inputs; this did not finish the investigation.';
 }
 wfDependencyStop(s,final.id,w.reason||final.result.workflow_plan.stop_reason,now,true);
 wfEvent(s,'Corrected the old finished label from the saved stopped experiment. No tasks or scientific results were repeated or changed.',now);
}

// One review of a dependency stop can assign a focused continuation of the chosen method.
export function reviewStoppedInvestigation(s,p,role,now=Date.now()){
 const w=s.workflow;
 if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator reviews dependency stops.');
 if(w?.status!=='blocked'||w.stage!=='Research'||w.phase!=='assess'||w.termination?.kind!=='dependency'||p.task_id!==w.termination.task_id)throw new Invalid('Review only the saved missing-input assessment stop.');
 if(s.paused||!s.task_policy?.enabled||!s.task_policy.research_enabled||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision||s.project?.archived_at||s.project?.cleared_at)throw new Invalid('Preserve the project scope and director hold.');
 if(s.tasks.some(t=>t.workflow_id===w.id&&['queued','running'].includes(t.status)))throw new Invalid('Wait for existing work.');
 const ownerIds=wfOwnerRecoveryTasks(s).map(t=>t.id);
 if(w.dependency_reviews?.some(r=>r.checkpoint===w.checkpoint&&JSON.stringify(r.owner_recovery_task_ids||[])===JSON.stringify(ownerIds)))throw new Invalid('This dependency stop has already been reviewed; a changed input is required.');
 const reason=wfText(p.reason,'the dependency-review reason',1000),previous=structuredClone(w.termination);
 w.status='running';delete w.reason;
 const reviewNumber=(w.dependency_reviews||[]).filter(r=>r.checkpoint===w.checkpoint).length+1;
 wfQueueChair(s,now,w.id+'-dependency-review-'+w.checkpoint+(reviewNumber>1?'-'+reviewNumber:''));
 const t=wfTask(s,w.chair_task);t.workflow_context.dependency_stop=previous;
 if(wfUnassessedOwnerRecovery(s).length)t.prompt+='\nNew owner recovery results are attached. Advance to assess and assign every researcher to review this full report, its repair evidence and remaining limits. Do not conclude or assign another experiment before that assessment.';
 t.prompt+='\nReview the stopped investigation using its original full implementation and assessments. Diagnose the missing prerequisites and assign only a useful repair or independently valid synthetic next test within the selected method and existing scope. Reuse completed code. Do not repeat selection or completed experiments. Keep final test data sealed. If no permitted next action exists, return stop with stop_kind dependency and state the specific help needed.';
 t.request.prompt=t.prompt;t.request.workflow_context=structuredClone(t.workflow_context);
 (w.dependency_reviews||=[]).push({checkpoint:w.checkpoint,task_id:t.id,previous_task_id:previous.task_id,owner_recovery_task_ids:ownerIds,reason,at:new Date(now).toISOString()});
 wfEvent(s,'The orchestrator will review the missing inputs and a focused continuation, using the saved results.',now);
 return w;
}

export function workflowTick(s,now=Date.now()){
 const w=s.workflow;
 if(w?.meeting_policy==='human'&&humanBriefingTick(s,now))return;
 if(w?.meeting_policy!=='human')wfRestoreIncompleteStop(s,now);
 if(w?.status==='finished'&&w.stage==='Research'&&w.phase==='assess'&&!s.paused&&s.task_policy?.enabled&&s.task_policy.research_enabled&&w.policy_revision===s.task_policy.revision&&w.direction_revision===s.direction_revision&&!s.tasks?.some(t=>['running','queued'].includes(t.status))){
  const final=[...s.tasks].reverse().find(t=>t.workflow_id===w.id&&t.kind==='coordination'&&t.status==='completed'&&t.workflow_context?.phase==='assess'&&t.workflow_context.selected_proposal===w.selected_proposal_text&&t.result?.workflow_plan?.action==='stop');
  if(final)wfCloseInvestigation(s,{id:final.id,decision_task_id:final.id,proposal_ids:[w.selected_proposal]},now);
 }
 if(w?.status==='blocked'&&w.library_task&&!s.paused&&s.task_policy?.enabled&&s.task_policy.research_enabled&&w.policy_revision===s.task_policy.revision&&w.direction_revision===s.direction_revision){
  const t=wfTask(s,w.library_task);
  if(t.status==='failed'&&t.handler==='library_collect'&&!t.result&&t.attempts===0&&t.error==='Use a nonempty sources object.'&&!t.empty_source_recovery&&!(s.tasks||[]).some(t=>t.workflow_id===w.id&&t.status==='running')&&Math.max(Date.parse(s.task_maintenance?.until)||0,Date.parse(s.runner_maintenance?.until)||0)<=now){
   t.empty_source_recovery={at:new Date(now).toISOString(),error:t.error};
   t.status='queued';delete t.error;w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();
   wfEvent(s,'The library now accepts a round with no new papers. Retrying its saved records without repeating researcher work.',now);
   for(const key of ['workflow-stopped','task-preflight']){const warning=s.warnings?.find(x=>x.key===key&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key,reporter:'Workflow controller',expected_revision:warning.revision,resolution:'The empty-paper-list format is fixed. The saved source script will be checked again without a model call.',evidence:[{note:'One-time format recovery for '+t.id,source:'tasks:'+s.project.id}]});}
  }
 }
 if(!wfAllowed(s))return;
 for(const m of s.research_records?.meeting||[])if(m.id.startsWith(w.id+'-meeting-')&&m.decision?.startsWith('Selected return-to-proposal ')&&m.votes_revealed&&!m.proposal_ids?.includes(w.selected_proposal)&&!s.research_map?.nodes.some(n=>m.proposal_ids?.includes(n.id)&&n.status==='under_exploration'))wfCloseInvestigation(s,m,now,true);
 usageWarnings(s);
 if(w.chair_task){const t=wfTask(s,w.chair_task);if(['failed','cancelled'].includes(t.status))wfBlock(s,'The orchestrator task failed: '+(t.error||t.result?.summary||t.id),now);return;}
 if(w.batch.length){
  const rows=w.batch.map(id=>wfTask(s,id));const failed=rows.filter(t=>['failed','cancelled'].includes(t.status));if(failed.length){
   if(['prepare','response'].includes(w.phase)&&failed.every(t=>t.status==='failed'&&t.result?.outcome==='blocked'&&t.result.artifacts?.length)){
    if(rows.some(t=>!['completed','failed','cancelled'].includes(t.status)))return;
    if(w.phase==='prepare'&&rows.every(t=>t.result.artifacts?.some(a=>a.path.endsWith('/sources.json')))){if(w.library_task&&['failed','cancelled'].includes(wfTask(s,w.library_task).status)){wfBlock(s,'Source registration failed before obstacle review.',now);return;}try{if(!wfSourceBarrier(s,now))return;}catch(e){wfBlock(s,e.message,now);return;}}
    if(!w.obstacle){w.recovery_count=(w.recovery_count||0)+1;w.obstacle={phase:w.phase,failed:failed.map(t=>({task_id:t.id,agent_id:t.agent_id,summary:t.result.summary})),instruction:w.phase==='response'?'Judge whether complete provisional candidates can be put to a vote with all uncertainty preserved. Do not declare them scientifically ready.':'Address the missing evidence; do not repeat the other researchers’ finished work.'};wfEvent(s,'The team has saved findings, but some need targeted follow-up. Waking the orchestrator once.',now);}
    if(remainingCalls(s)<=0){wfBlock(s,'No model allowance remains to review the blocked findings.',now);return;}
    wfQueueChair(s,now);return;
   }
   const t=failed[0];wfBlock(s,'A required task failed: '+t.summary+'. '+(t.error||t.result?.summary||''),now);return;
  }
  if(rows.some(t=>t.status!=='completed')){if(now-Date.parse(w.updated_at)>w.configuration.waiting_minutes*60000){
   if(advisoryUsage(s))changeWarning(s,{action:'raise',key:'workflow-long-checkpoint',reporter:'Workflow controller',title:'This step is taking longer',symptom:'Checkpoint '+w.checkpoint+' has exceeded its time estimate.',impact:'Work continues while workers remain healthy.',suggestion:'Inspect progress and saved outputs; elapsed time alone does not mean a job is stuck.',certainty:'observed',evidence:[{note:'Waiting for '+w.phase+' results at checkpoint '+w.checkpoint,source:'workflow:'+s.project.id}]});
   else wfBlock(s,'The team checkpoint exceeded its waiting limit. Inspect unfinished tasks before retrying.',now);
  }return;}
  if(w.phase==='prepare'){
   if(w.library_task&&['failed','cancelled'].includes(wfTask(s,w.library_task).status)){wfBlock(s,'Source registration failed. Check the saved source handoff before a meeting.',now);return;}
   try{if(!wfSourceBarrier(s,now))return;}catch(e){wfBlock(s,e.message,now);return;}
  }
  if(!w.batch_recorded){
   if(w.phase==='prepare'){wfCandidates(s,now);w.presentations=[...w.batch];}
   if(w.phase==='critique')w.critiques=[...w.batch];
   if(w.phase==='response'){w.responses=[...w.batch];wfRefreshCandidates(s,now);}
   if(['vote','reconsider'].includes(w.phase))w.ballot=wfBallot(s);
   w.checkpoint++;w.batch_recorded=true;w.history.push({phase:w.phase,stage:w.stage,round:w.round,cycle:w.cycle,task_ids:[...w.batch],at:new Date(now).toISOString()});wfEvent(s,'Checkpoint complete: '+w.stage+' / '+w.phase+' / round '+w.round+'.',now);
  }
 }
 if(w.meeting_policy==='human'){
  if(['vote','reconsider','assess'].includes(w.phase)){humanMeetingGate(s,now);return;}
  humanAdvance(s,({start:'prepare',prepare:'critique',critique:'vote',response:'vote',feasibility:'critique',implement:'assess'})[w.phase]||'prepare',now);return;
 }
 if(remainingCalls(s)<=0){wfBlock(s,'Model-call allowance reached before the next orchestrator checkpoint.',now);return;}
 wfQueueChair(s,now);
}
function wfMeeting(s,plan,selected,now){const w=s.workflow,v=w.ballot,id=w.id+'-meeting-'+w.checkpoint;const proposal_ids=w.stage==='Proposal'?w.candidates.map(c=>c.id):[w.selected_proposal];
 const previous=(s.research_records?.meeting||[]).filter(m=>m.stage===w.stage&&Number(m.round)===w.round-1).at(-1);
 const voteCounts=votes=>{const counts={};for(const row of votes||[])counts[row.choice]=(counts[row.choice]||0)+1;return JSON.stringify(Object.entries(counts).sort());};
 if(!v.unanimous&&previous&&voteCounts(previous.votes)===voteCounts(v.votes))changeWarning(s,{action:'raise',key:'repeated-vote-split',reporter:'Orchestrator',title:'The vote has not moved',symptom:'Two successive '+w.stage+' meetings ended with the same vote counts.',impact:'Another broad rewrite may add little useful evidence.',suggestion:'Target the missing paper, argument or useful check behind the disagreement. Keep the three-round selection rule.',certainty:'observed',evidence:[{note:'Saved ballots from consecutive rounds.',source:'meeting:'+previous.id}]});

 upsertRecord(s,{agent_id:s.orchestrator_id,type:'meeting',expected_revision:s.research_records?.meeting?.find(m=>m.id===id)?.revision||0,record:{id,title:w.meeting_policy==='human'?w.stage+' meeting':w.stage+' selection · round '+w.round,summary:convergence(v.votes),presentations:w.phase==='reconsider'?[]:w.candidates.map(c=>({id:c.id,title:c.title,task_id:c.task_id,agent_id:c.owner_id||wfTask(s,c.task_id).agent_id,presentation:wfTask(s,c.task_id).result.presentation||null})),purpose:wfCriteria[w.stage],stage:w.stage,round:String(w.round),participant_ids:w.meeting_policy==='human'?humanParticipants(s):w.configuration.researcher_ids,proposal_ids,method_ids:w.stage==='Research'&&w.phase!=='reconsider'?w.candidates.map(c=>c.id):[],suggestions:w.critiques.map(id=>({agent_id:wfTask(s,id).agent_id,text:wfTask(s,id).result.body,task_id:id})),votes:v.votes.map(({agent_id,choice,reason})=>({agent_id,choice,reason})),votes_revealed:true,decision:w.meeting_policy==='human'?'Waiting for the human director.':selected?'Selected '+selected+' for the next bounded step; benefit remains unproven.':v.final?'No candidate justifies the next bounded step.':'No convergence; revise for the next round.',decision_reason:plan.summary,selected_proposal_id:w.stage==='Proposal'&&selected?selected:'',actions:plan.assignments.map(a=>({owner_id:a.agent_id,task:a.summary})),evidence:[...new Set([...w.presentations,...w.critiques,...w.responses,...w.batch,...(w.feasibility_task?[w.feasibility_task]:[])])].map(id=>({note:wfTask(s,id).summary,source:'/task-documents/'+encodeURIComponent(id)+'?workspace='+encodeURIComponent(s.project.id)}))}});
 if(selected&&w.stage==='Proposal'){
  decideDirections(s,{expected_revision:s.research_map.revision,choices:[...(s.research_map.nodes.filter(n=>n.status==='under_exploration'&&n.id!==selected).map(n=>({id:n.id,status:'unexplored'}))),{id:selected,status:'under_exploration'}],comment:plan.summary},{actor:'Orchestrator (team vote)'});w.direction_revision=s.direction_revision;
 }
 if(selected&&w.stage==='Research'&&w.phase!=='reconsider'){
  for(const r of s.research_records.method){if(r.status==='active'&&r.id!==selected)r.status='unexplored';if(r.id===selected){r.status='active';r.decision_reason=plan.summary;r.revision++;r.updated_at=new Date(now).toISOString();r.updated_by=s.orchestrator_id;}}
 }
 if(selected==='return-to-proposal'&&w.phase==='reconsider')wfCloseInvestigation(s,s.research_records.meeting.find(m=>m.id===id),now);
}
function wfPhasePrompt(s,phase,assignment){const w=s.workflow;
 const revisionOwner=w.candidates.find(c=>c.owner_id===assignment.agent_id);
 if(['prepare','response'].includes(phase)&&w.round>1&&revisionOwner?.original_task_id)assignment={...assignment,prompt:assignment.prompt+'\nRevise your own original candidate, supplied as original_candidate and a complete document. Keep its central research question and owner; use feedback to improve its evidence, scope and test. Do not switch to a peer’s topic. Explain what changed and why. If a different question is necessary, flag it as a proposed replacement for a separate team decision; do not silently present it as a revision.'};
 if(w.stage==='Research'&&['prepare','response'].includes(phase)){
  const ownMethod=s.research_records?.method?.find(m=>m.id===revisionOwner?.id&&m.proposal_ids?.includes(w.selected_proposal));
  const identity=ownMethod?'Your assigned method ID for this question is '+ownMethod.id+'. Use this ID in your revised document; any conflicting ID from a previous question in an earlier draft is historical.':'Prepare a new method for this selected question. Its ID will be assigned after preparation; do not reuse a method ID belonging to a previous question.';
  assignment={...assignment,prompt:assignment.prompt+'\nThe selected proposal defines the shared idea, measured outcome and conditions. '+identity+' Correct any older interpretation that changed that shared question. Use research_focus.clarification when supplied. Your contribution must be a complete implementation choice or clearly identify itself as the same method or a component; do not invent a separate goal.'};
 }
 if(['prepare','response'].includes(phase))assignment={...assignment,prompt:assignment.prompt+'\nBefore proposing, read rejected_candidates, including older meetings, and the human rejection reasons. Compare the substance, not just titles or wording. Do not submit the same rejected question or method, rename it, or change trivial settings and call it new. Use the feedback to guide further reading, including other fields when useful. When rejections exist, include presentation.rejection_check: name the closest rejected candidate IDs, explain the real difference and how it addresses their rejection reasons, and identify the new evidence or reasoning. If new evidence only suggests reopening an old idea, say so explicitly for the human to decide; do not present it as a new idea or quietly reactivate it. Respect any instruction not to revisit an option. Use readable saved candidate files when the summary is insufficient. Do not invent a rejection reason or differences; state honestly if no useful new candidate was found.'};
 if(['critique','vote'].includes(phase))assignment={...assignment,prompt:assignment.prompt+'\nCompare each candidate with rejected_candidates and its human feedback. Check the claimed differences: new wording or a small parameter change is not a new idea. Flag repeats and unsupported claims of novelty in your advice or vote. A substantive repair or new evidence must explicitly address the rejection and still goes to human review; a vote cannot reopen a discarded item.'};
 const common='\n'+(w.stage==='Research'?researchGuidance+'\n':'')+'Write for peer researchers from other specialties. Write for a non-expert with no assumed QEC knowledge. Give enough background to explain the problem and why it matters. Before technical terms, describe a concrete situation, the missing information, and your steps in everyday words. For example, explain an ideal extra correction using error-free measurements before calling it perfect recovery. An acronym expansion or another technical synonym is not an explanation. For a Research presentation, factor should state the shared idea and the particular steps YOUR method uses to implement it. The dashboard presentation must be understandable on its own: explain what is shared, what this method changes and why. Keep exact formulas, conventions and settings in the later technical section. Define unfamiliar terms, acronyms and symbols before using them; do not assume peers read the same papers. Use actual concepts and descriptive headings, not mindset placeholders such as G/Y/Z. Explain the idea in ordinary words first, with a small concrete example when helpful. State what existing methods miss, the proposed change, its evidence and uncertainty, and what the next step would teach us. Keep necessary equations, implementation details and sources after the explanation; preserve all evidence needed for decisions. Prefer a few extra clear sentences to compressed jargon. Check that a peer could restate the question, idea and next test. Aim for 80–120 words in body when that is enough to explain it clearly: the main point, reason and suggested next step. Omit reading receipts, routine disclaimers and repeated background. For a multi-peer critique, give one useful concern and suggested change per peer; say briefly when there is no new concern. Extend only for a decision-changing objection, uncertainty or requested explanation; put needed detail in document. These are writing targets, not reasons to block delivery. Keep a complete candidate document, aiming for 5000 characters; do not drop evidence needed for the decision. Include enough detail for peers to assess the question without browsing history. Return requests as an empty array. Describe missing inputs in your result; the controller handles obstacles at the team checkpoint. Use the current resource_brief and scope over historical limits in earlier documents. Resource estimates guide planning; advisory counts or elapsed time do not stop work. Respect actual server availability and explicit holds. End after saving the assigned output.';
 if(phase==='prepare'&&w.stage==='Research')assignment={...assignment,prompt:assignment.prompt+'\nDesign a concrete experiment, not just a possible idea. Return presentation.experiment with five plain-language fields: data (exact dataset, version/path, chosen samples, access and any synthetic generation); method (ordered steps implementing the same shared idea); setup (baseline, split or time order, controls, parameters, metrics, repetitions, uncertainty and resource estimate); expected_outcome (a prediction, not an observed result, and a useful negative outcome); learning (what each outcome would tell us and what remains untested). State real unknown settings as unknown and how to resolve them; never invent data or measurements. Explain enough detail for the engineer to run this design after the human approves it.'};
 if(phase==='prepare')return assignment.prompt+'\n'+wfCriteria[w.stage]+'\nCheck registered_library first for current project records; reuse existing IDs, canonical URLs and exact versions. These include earlier rounds, even when the latest delivery has no update for that source. Use local library search for other sources. Use a distinct ID for a genuinely different version. For an initial proposal, find and read relevant primary sources, including work that might already answer the question. For revisions, reuse saved reading and do new reading only when it is needed and assigned. Initial proposals must be independent; later revisions should address saved peer feedback. Save sources.json inside output_folder with {"sources":[{"id":"stable-lowercase-paper-id","kind":"paper","title":"actual title","source":"canonical https URL","version":"checked version","summary":"your brief description","reading":"what you actually read","availability":"access limits","checks":"what was verified or not","read_by":["your supplied agent ID"]}]}. Use consistent canonical paper IDs/URLs and versions; preserve exact IDs when reusing supplied records. Use read_by: [] for sources you could not read. Include actual sources and access limits. An empty sources list is valid when no sources were added or updated; this does not erase prior reading or satisfy missing scientific evidence. Do not claim a gap is novel when the closest work is unchecked. Also return presentation with question, prior_work, gap, factor, support, outcome and conditions: one or two simple sentences each. These explain the mindset in real terms: factor is G, support is H, outcome is Y. Label intuition and uncertainty honestly; do not repeat who suggested changes. Return your full proposal/method as document, including a next bounded step, expected learning, budget and stopping point. Separate known barriers from uncertainties that step could resolve. Start it with one Markdown H1 (# title): a short research question, gap or core method in simple words, ideally 6–12 words. This becomes its map title; exclude activity, readiness, file names and status. Do not imply an untested benefit is proven.\nUse the resource allowance and selected question supplied in workflow_context; otherwise use the project topic.'+common;
 if(phase==='critique'&&agentFor(s,assignment.agent_id).role!=='researcher')assignment={...assignment,prompt:assignment.prompt+'\nAttend as the '+agentFor(s,assignment.agent_id).role+'. Read every complete candidate and comment on each from your role: the engineer checks runnable steps, data, comparisons and cost; the mathematician checks assumptions, arguments and what the test can establish. You are an adviser, not a researcher voter. Save concise advice; do not implement or derive a new result during the meeting.'};
 if(phase==='critique')return assignment.prompt+'\nRead every candidate in full in its listed round-table order. Give each peer a brief, specific critique from your specialty; label the candidate ID. Assess significance, closest-work overlap, data/compute feasibility and missing evidence, but report only the most useful concern and change for each peer. Do not repeat the whole checklist in each contribution. Critique all other researchers; avoid duplicating your own presentation. Explain how each concern affects the conclusion or next step in ordinary words. If a key point is unclear, state your understanding and a focused clarification question rather than guessing; unclear wording alone is not evidence the idea is wrong.'+common;
 if(phase==='response')return assignment.prompt+'\nAlso return the updated short presentation (question, prior_work, gap, factor, support, outcome, conditions) for the dashboard; describe the science, not the revision history. Respond to peer suggestions and supply your complete revised candidate, not merely a change list. Include the question/method, closest work, proposed idea, measured outcome, test conditions, resource plan, success criteria and main uncertainty. Use actual concepts and clear headings. State the next bounded step, what it would teach us, its budget and stopping point. Review any supplied feasibility_results in full and update claims accordingly; a failed check must remain visible. Start the document with # and a short title naming the research question or core method, without activity or status. This full document will be used for voting. A complete provisional candidate with explicit uncertainty is a completed response; it need not prove readiness. Use blocked only if missing inputs prevent you from supplying the candidate.'+common;
 if(phase==='vote'||phase==='reconsider')return assignment.prompt+'\nApply the supplied selection criteria to the next bounded investment. Distinguish a known reason to reject from an uncertainty the next step can resolve. Reconsidering the central question remains an evidence-based stay/return decision.'+'\nRead the complete decision_packet. Return body as JSON {"choice":"one supplied option or none_is_ready","reason":"at most 280 characters"}. Vote independently; other votes are hidden. Choose none_is_ready when no candidate justifies a useful affordable next step, not simply because its benefit or full-study runtime is unknown. Explain the decisive difference from the strongest alternative, using your own specialty and the saved evidence. Agreement is fine; do not invent differences or objections merely to sound independent. Preserve genuine scientific or resource limits. Return blocked only if the supplied decision evidence is incomplete or unreadable. Use document only for necessary extra detail.';
 if(phase==='feasibility')return assignment.prompt+'\nCheck only the named candidate and uncertainty within the recorded scope. This is a small Proposal-stage check, not a full research implementation. Use the supplied complete candidates; do not run all their studies. Save actual settings, measurements, costs and limits; an unsuccessful or inconclusive check is a completed finding, not a reason to retry. Save records.json with an experiment record, purpose/setup/results or failure and the candidate proposal_ids. Stop at the assigned limit; do not install, download or run anything disallowed by the recorded allowance. If no allowed check can answer it, report that obstacle.\nCheck allowance: '+w.configuration.feasibility_budget+'\nUse the overall resource allowance in workflow_context.'+common;
 if(phase==='implement')return assignment.prompt+'\nImplement only the selected method and agreed comparisons. Own a functioning experiment: diagnose a fixable implementation or input problem and attempt concrete repairs within the allowance before escalating. Reuse saved work and ask the relevant specialist about scientific ambiguities. Missing inputs block only dependent tests; pursue independently valid assigned work. Do not repeat an unchanged failed attempt, alter a comparison or seek favorable seeds. Save settings, code, results, measured costs, repair attempts and any exact remaining obstacle. Save records.json containing an experiment record with execution_outcome (complete, partial or blocked) and scientific_outcome (not_tested, inconclusive, positive or negative), and real result evidence. Successful software checks alone do not establish the agreed scientific comparison. A valid negative result completes an experiment; improvement is never required for delivery. Do not invent evidence or change the scientific question. Respect actual constraints and the assigned scientific stopping point.\nUse the resource allowance, selected question and method in workflow_context.'+common;
 return assignment.prompt+'\nAssess the returned results, limitations, comparison fairness and next step. A score alone does not establish a mechanism. State whether the same question remains worthwhile and feasible. Do not run extra experiments.'+common;
}
function wfApply(s,task,plan,now,controller=false){plan=structuredClone(plan);const w=s.workflow,previousStage=w.stage;if(!wfAllowed(s)||!controller&&w.chair_task!==task.id)throw new Invalid('The workflow or allowance changed; no assignments were started.');
 if(w.meeting_policy==='human'&&!controller&&!w.obstacle)throw new Invalid('The human director decides after the meeting.');
 if(!plan||!['advance','stop'].includes(plan.action)||!wfOptions(s).includes(plan.next_phase))throw new Invalid('The orchestrator must choose an allowed next phase.');
 wfText(plan.summary,'the plan summary',280);if(!Array.isArray(plan.assignments))throw new Invalid('Supply assignments.');
 if(plan.action==='stop'){if(plan.next_phase!=='finished'||plan.assignments.length)throw new Invalid('Stopping requires finished and no assignments.');if(w.stage==='Research'&&w.phase==='assess'&&wfUnassessedOwnerRecovery(s).length)throw new Invalid('Assess the new owner recovery with all researchers before concluding.');wfText(plan.stop_reason,'the stopping reason',1500);}
 else {if(plan.stop_kind!==undefined&&plan.stop_kind!==null)throw new Invalid('Advancement has no stopping kind.');if(plan.next_phase==='finished')throw new Invalid('Use stop for a finished workflow.');const expected=wfExpected(s,plan.next_phase);if(!expected.length||plan.assignments.length!==expected.length||new Set(plan.assignments.map(a=>a.agent_id)).size!==expected.length||expected.some(id=>!plan.assignments.some(a=>a.agent_id===id)))throw new Invalid('Assign exactly the expected participants once.');for(const a of plan.assignments){wfText(a.prompt,'an assignment',4000);wfText(a.summary,'an assignment title',200);}plan.assignments=expected.map(id=>plan.assignments.find(a=>a.agent_id===id));}
 if(w.obstacle?.phase==='prepare'&&plan.action==='advance'&&plan.next_phase==='prepare'){
  if(plan.next_phase!=='prepare')throw new Invalid('Recover preparation through focused follow-up.');
  if(remainingCalls(s)<plan.assignments.length+1)throw new Invalid('The recovery exceeds the remaining allowance.');
  w.reading_recoveries=(w.reading_recoveries??w.recoveries?.length??0)+1;const repaired=[];
  for(const a of plan.assignments){const previous=w.obstacle.failed.find(t=>t.agent_id===a.agent_id);const prior=wfTask(s,previous.task_id);const refs=prior.result.artifacts.filter(f=>/\/(sources.json|reply.md|findings.md|method.md)$/.test(f.path)).map(f=>f.path);const researchEvidence=wfResearchEvidence(s);const docs=[...new Set([...(prior.document_ids||[]),...prior.depends_on.filter(id=>wfTask(s,id).status==='completed'),...researchEvidence.document_ids])];
   const t=submitTask(s,{id:w.id+'-recovery-'+w.recovery_count+'-'+(repaired.length+1),sender_id:s.orchestrator_id,agent_id:a.agent_id,kind:w.stage==='Proposal'?'proposal':'research',summary:a.summary,prompt:wfPhasePrompt(s,'prepare',a)+'\nThis is focused follow-up for your own saved blocked findings. Reuse earlier sources and notes; do not repeat completed reading. Save a complete revised candidate and sources.json covering all sources it uses. If the candidate is provisional but ready for peers to assess, return completed and clearly state the remaining uncertainty. Return blocked only when the assigned follow-up itself cannot be completed.',input_refs:['lab/resources.md','lab/resource-allocations.md',...refs],document_ids:docs,workflow_context:{...prior.workflow_context,research_focus:workflowResearchFocus(s),resource_brief:w.resource_brief,selected_proposal:w.selected_proposal_text,selected_method:w.selected_method_text,selected_method_id:w.selected_method,previous_investigation:researchEvidence.previous_investigation,previous_result:wfEvidence(s,[previous.task_id])[0]}},'worker',now);t.workflow_id=w.id;w.batch=w.batch.map(id=>id===previous.task_id?t.id:id);repaired.push({previous_task:previous.task_id,replacement_task:t.id});
  }
  w.recoveries||=[];w.recoveries.push({reason:plan.summary,tasks:repaired,at:new Date(now).toISOString()});w.obstacle=null;w.chair_task=null;w.library_task=null;w.batch_recorded=false;w.updated_at=new Date(now).toISOString();w.next_action=plan.summary;wfEvent(s,'Focused recovery: '+plan.summary,now);return;
 }
 if(w.obstacle&&plan.action==='advance'){
  const preparation=w.obstacle.phase==='prepare';
  if(plan.next_phase!==(preparation?'critique':'vote'))throw new Invalid('Review complete provisional candidates through the next peer checkpoint.');
  if(preparation&&(!w.library_task||wfTask(s,w.library_task).status!=='completed'))throw new Invalid('Register source records before peer review.');
  const rows=w.batch.map(id=>wfTask(s,id));if(rows.some(t=>!t.result?.document?.trim()))throw new Invalid('Every candidate needs its complete saved response document before voting.');
  for(const t of rows.filter(t=>t.status==='failed')){
   if(t.result.outcome!=='blocked'||!t.completion_id)throw new Invalid('Do not accept transport failures as delivered evidence.');
   t.status='completed';t.checkpoint_accepted={by:s.orchestrator_id,at:new Date(now).toISOString(),reason:plan.summary,scientific_outcome:t.result.outcome};
   const a=agentFor(s,t.agent_id);a.status_revision=(a.status_revision||0)+1;a.work_status={task_id:t.id,state:'sleeping',summary:'Provisional candidate saved; readiness remains unresolved.',waiting_for:'Peer review and vote on the saved evidence.',updated_at:new Date(now).toISOString(),revision:a.status_revision};
  }
  if(preparation){wfCandidates(s,now);w.presentations=[...w.batch];}else{w.responses=[...w.batch];wfRefreshCandidates(s,now);}w.history.push({phase:w.phase,stage:w.stage,round:w.round,cycle:w.cycle,task_ids:[...w.batch],at:new Date(now).toISOString(),note:'The orchestrator accepted complete provisional candidates for peer judgment; original blocked outcomes are preserved.'});w.checkpoint++;w.batch_recorded=true;w.obstacle=null;wfEvent(s,'Provisional candidates delivered for peer judgment. This does not establish readiness or approve experiments.',now);
 }
 let selected=null;if(['vote','reconsider'].includes(w.phase)&&w.meeting_policy!=='human'){
  const b=w.ballot;if(b.final&&b.outcome!=='none_is_ready'){selected=b.outcome==='tie'?plan.tie_choice:b.outcome;if(!b.leaders.includes(selected))throw new Invalid('Resolve a tied vote using a tied candidate and explain the choice.');}
  wfMeeting(s,plan,selected,now);
  if(b.final){if(selected){const c=w.candidates.find(c=>c.id===selected);if(w.phase==='reconsider'){if(selected==='return-to-proposal'){w.stage='Proposal';w.selected_proposal=null;w.selected_method=null;w.selected_proposal_text=null;w.selected_method_text=null;}}else if(w.stage==='Proposal'){w.selected_proposal=selected;w.selected_proposal_text=wfTask(s,c.task_id).result.document||wfTask(s,c.task_id).result.body;w.stage='Research';}else {w.selected_method=selected;w.selected_method_text=wfTask(s,c.task_id).result.document||wfTask(s,c.task_id).result.body;}w.round=1;w.cycle=1;}else if(plan.action==='advance'){w.cycle++;w.round=1;}}
  else if(plan.action==='advance')w.round++;
 }
 if(plan.action==='stop'){
  if(Object.hasOwn(plan,'stop_kind')&&plan.stop_kind===null)throw new Invalid('Choose the reason for stopping: endpoint, dependency or no_next_step.');
  const kind=plan.stop_kind??(wfIncompleteInvestigation(s)?'dependency':'endpoint');
  if(!['endpoint','dependency','no_next_step'].includes(kind))throw new Invalid('Choose an explicit stopping kind.');
  if(kind==='endpoint'&&advisoryUsage(s)&&w.stage==='Research'&&w.phase==='vote'&&w.selected_method&&w.configuration.engineer_id)throw new Invalid('Selecting a method does not complete its investigation. Continue implementation, or record dependency or no_next_step.');
  if(kind==='endpoint'&&wfIncompleteInvestigation(s))throw new Invalid('A stopped implementation with unmet inputs cannot finish the research endpoint. Use dependency or no_next_step.');
  if(kind==='dependency'){wfDependencyStop(s,task.id,plan.stop_reason,now);return;}
  if(w.stage==='Research'&&w.phase==='assess')wfCloseInvestigation(s,{id:task.id,decision_task_id:task.id,proposal_ids:[w.selected_proposal]},now);
  w.status=kind==='endpoint'?'finished':'stopped';w.termination={kind,task_id:task.id,reason:plan.stop_reason,at:new Date(now).toISOString()};w.reason=plan.stop_reason;w.next_action=plan.stop_reason;w.chair_task=null;w.updated_at=new Date(now).toISOString();wfEvent(s,'Workflow '+w.status+': '+plan.stop_reason,now);return;
 }
 const previous=[...w.batch],next=plan.next_phase,ids=[];
 if(remainingCalls(s)<plan.assignments.length+1)throw new Invalid('Not enough model calls for this full batch and its next checkpoint.');
 if(next==='prepare'){w.revising_methods=w.stage==='Research'&&w.phase==='assess';if(w.revising_methods){w.round=1;w.cycle=1;}}
 if(next==='reconsider'){
  w.round=1;w.cycle=1;w.candidates=[{id:'stay-in-research',task_id:null},{id:'return-to-proposal',task_id:null}];
  // These are options, not fabricated agent findings. Persist their text for complete ballots.
  for(const c of w.candidates){const id=w.id+'-option-'+w.checkpoint+'-'+c.id;const body=c.id==='stay-in-research'?'Keep the selected research question and develop another method.':'Return to Proposal because the current question may have lost its value or feasibility.';s.tasks.push({id,agent_id:s.orchestrator_id,kind:'question',status:'completed',completion_id:id+':option',summary:body,result:{summary:body,body,document:null,artifacts:[]},input_refs:[],depends_on:[]});c.task_id=id;}
 }
 for(const [i,a] of plan.assignments.entries()){
  let docs=[];if(next==='critique')docs=w.presentations;if(next==='response')docs=[...new Set([w.candidates[i].task_id,...w.critiques,...(w.focus_review_pending?w.candidates.map(c=>c.task_id):[])])];if(next==='feasibility')docs=w.candidates.map(c=>c.task_id);if(next==='assess')docs=previous;if(next==='implement'&&w.meeting_policy==='human'&&w.director_decisions?.at(-1)?.selection_task_id)docs=[w.director_decisions.at(-1).selection_task_id];if(next==='vote'&&w.meeting_policy==='human')docs=w.critiques;if(next==='prepare'&&w.phase!=='start'&&w.stage===previousStage)docs=w.responses.length?w.responses:w.presentations;
  const own=w.candidates.find(c=>c.owner_id===a.agent_id),originalCandidate=w.round>1&&w.stage===previousStage&&own?.original_task_id?wfEvidence(s,[own.original_task_id])[0]:null;
  const researchEvidence=wfResearchEvidence(s);if(['prepare','critique','response','vote','implement','reconsider','assess'].includes(next))docs=[...new Set([...docs,...researchEvidence.document_ids])];
  if(['prepare','response'].includes(next)&&originalCandidate)docs=[...new Set([...docs,originalCandidate.task_id])];
  const kind=next==='prepare'?(w.stage==='Proposal'?'proposal':'research'):['implement','feasibility'].includes(next)?'engineering':['vote','reconsider'].includes(next)?'vote':'meeting';
  const p={id:w.id+'-b'+w.checkpoint+'-'+next+'-'+(i+1),sender_id:s.orchestrator_id,agent_id:a.agent_id,kind,prompt:wfPhasePrompt(s,next,a),summary:a.summary,input_refs:[...(next==='prepare'?['lab/resources.md','lab/resource-allocations.md']:[]),...taskReportRefs(s,docs)],depends_on:previous,document_ids:docs};
  if(['vote','reconsider'].includes(next))p.decision_packet={criteria:next==='reconsider'?'Should the team keep the current question or return to Proposal? Vote none_is_ready if evidence is insufficient. '+wfCriteria[w.stage]:wfCriteria[w.stage],candidates:w.candidates.map(({id,task_id})=>({id,task_id}))};
  p.workflow_context={meeting_policy:w.meeting_policy,director_decision:w.director_decisions?.at(-1)||null,research_focus:workflowResearchFocus(s),stage:w.stage,phase:next,original_candidate:originalCandidate?{task_id:originalCandidate.task_id,summary:originalCandidate.summary}:null,feasibility_results:wfCheckEvidence(s),resource_brief:w.resource_brief,selected_proposal:w.selected_proposal_text,selected_method:w.selected_method_text,selected_method_id:w.selected_method,previous_investigation:researchEvidence.previous_investigation,candidates:(w.stage!==previousStage?w.candidates.filter(c=>c.id===w.selected_proposal):w.candidates).map(({id,task_id})=>({id,task_id}))};
  const sources=['critique','response','vote'].includes(next)?wfReviewSources(s):[];p.input_refs.push(...sources.map(f=>f.path));
  const t=submitTask(s,p,'worker',now);t.workflow_id=w.id;if(next==='feasibility')w.feasibility_task=t.id;if(sources.length){t.source_inputs=sources;t.workflow_context.source_registration=wfRegistration(s,sources);}ids.push(t.id);
 }
 if(w.focus_review_pending&&next==='response')w.focus_review_pending=false;
 w.phase=next;w.batch=ids;w.chair_task=null;w.library_task=null;w.batch_recorded=false;w.next_action=plan.summary;w.updated_at=new Date(now).toISOString();delete w.ballot;
 wfEvent(s,'Next step: '+plan.summary,now);
}
export function workflowComplete(s,taskId,now=Date.now()){
 const task=wfTask(s,taskId);if(!s.workflow||s.workflow.chair_task!==taskId||task.status!=='completed')return;
 const draft=structuredClone(s);try{wfApply(draft,wfTask(draft,taskId),task.result.workflow_plan,now);Object.assign(s,draft);}catch(e){wfBlock(s,'Orchestrator plan was not applied: '+e.message,now);}
}

// A rejected checkpoint plan gets one correction with explicit validation feedback.
// Preserve the rejected answer and all peer work; never turn it into an accepted plan.
export function repairWorkflowChair(s,p,role,now=Date.now()){
 const w=s.workflow,t=s.tasks?.find(t=>t.id===p.task_id);
 if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator handles recovery.');
 if(w?.status!=='blocked'||w.chair_task!==p.task_id||t?.status!=='completed'||!w.reason?.startsWith('Orchestrator plan was not applied:'))throw new Invalid('Correct only a saved plan rejected by the controller.');
 if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The original scope and hold must still permit this work.');
 if(w.plan_corrections?.some(r=>r.checkpoint===w.checkpoint&&r.phase===w.phase&&r.stage===w.stage))throw new Invalid('This checkpoint already had one plan correction. Diagnose the remaining cause before another attempt.');
 if(s.tasks.some(t=>t.workflow_id===w.id&&t.status==='running'))throw new Invalid('Wait for running tasks to save their work.');
 const reason=wfText(p.reason,'the cause of the rejected plan',1000),failure=w.reason;
 wfQueueChair(s,now,w.id+'-plan-correction-'+w.checkpoint);
 const replacement=wfTask(s,w.chair_task);
 replacement.workflow_context.plan_correction={previous_task_id:t.id,rejected_plan:structuredClone(t.result.workflow_plan),validation_error:failure};
 replacement.prompt+='\nYour previous plan was rejected: '+failure+' Correct only this plan. The saved team work remains complete. Choose exactly one of allowed_next_phases and its expected_owners; one meeting round still includes critiques, revisions and voting. Do not skip these steps or invent results. Preserve the director’s stopping instruction.';
 replacement.request.prompt=replacement.prompt;replacement.request.workflow_context=structuredClone(replacement.workflow_context);
 (w.plan_corrections||=[]).push({checkpoint:w.checkpoint,phase:w.phase,stage:w.stage,previous_task:t.id,replacement_task:replacement.id,reason,at:new Date(now).toISOString()});
 w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();
 wfEvent(s,'The orchestrator will correct its rejected plan. Completed researcher work will be reused.',now);
 return w;
}

export function clarifyResearchWorkflow(s,p,role,now=Date.now()){
 if(role!=='director')throw new Invalid('Only a recorded director clarification can request this correction.');
 const w=s.workflow,client_id=wfText(p.client_id,'the clarification ID',120),reason=wfText(p.reason,'the director clarification',2000),ids=p.document_ids;
 if(!p.revision_only&&(!Array.isArray(ids)||new Set(ids).size!==ids.length))throw new Invalid('Supply the team’s saved clarification replies.');
 const request={client_id,reason,document_ids:ids,...(p.revision_only?{revision_only:true}:{})};
 if(w?.method_revisions?.some(x=>x.client_id===client_id)){const old=w.method_revisions.find(x=>x.client_id===client_id);if(JSON.stringify(old.request)!==JSON.stringify(request))throw new Invalid('This clarification ID has different content.');return w;}
 if(w?.research_clarification?.client_id===client_id){if(JSON.stringify(w.research_clarification.request)!==JSON.stringify(request))throw new Invalid('This clarification ID has different content.');return w;}
 if(!s.paused||w?.status!=='running'||w.stage!=='Research'||w.phase!=='response'||!w.selected_proposal||w.selected_method||w.batch.some(id=>wfTask(s,id).status!=='completed'))throw new Invalid('Clarify at a paused, complete Research response checkpoint before method selection.');
 if((s.tasks||[]).some(t=>t.workflow_id===w.id&&t.status==='running'))throw new Invalid('Let the current workflow task finish before clarifying.');
 if(p.revision_only){
  if(ids?.length)throw new Invalid('A director method-revision instruction does not claim a new team agreement.');
  if(w.chair_task){const t=wfTask(s,w.chair_task);if(t.status!=='queued')throw new Invalid('The previous chair must still be unstarted.');t.status='cancelled';t.error='Replaced by the director’s method-revision instruction.';w.chair_task=null;}
  const entry={client_id,reason,request,at:new Date(now).toISOString()};w.method_revisions||=[];w.method_revisions.push(entry);w.method_revision=entry;
  w.focus_revision=(w.focus_revision||0)+1;w.focus_review_pending=true;w.updated_at=entry.at;
  wfEvent(s,'Director instruction: '+reason+' The existing methods will be revised before the vote; earlier work is preserved.',now);return w;
 }
 const owners=[...w.configuration.researcher_ids,s.orchestrator_id],replies=ids.map(id=>wfTask(s,id));
 if(replies.length!==owners.length||new Set(replies.map(t=>t.agent_id)).size!==owners.length||owners.some(id=>!replies.some(t=>t.agent_id===id))||replies.some(t=>t.kind!=='question'||t.status!=='completed'||!(t.result?.document||t.result?.body)))throw new Invalid('Wait for every researcher and the orchestrator to deliver their real explanation.');
 const chair=replies.find(t=>t.agent_id===s.orchestrator_id);
 if(replies.some(t=>t!==chair&&!chair.depends_on.includes(t.id)))throw new Invalid('The orchestrator must read all researcher explanations first.');
 if(w.chair_task){const t=wfTask(s,w.chair_task);if(t.status!=='queued')throw new Invalid('The previous chair must still be unstarted.');t.status='cancelled';t.error='Replaced after the director clarified the shared research focus.';w.chair_task=null;}
 w.research_clarification={...request,request,proposal_id:w.selected_proposal,summary_task_id:chair.id,at:new Date(now).toISOString()};
 w.focus_revision=(w.focus_revision||0)+1;w.focus_review_pending=true;w.updated_at=new Date(now).toISOString();
 wfEvent(s,'The team explained the shared research idea. Each method will be corrected to the same goal and conditions before the next vote.',now);
 return w;
}

export function retryWorkflowPreflight(s,p,role,now=Date.now()){
 const w=s.workflow;
 if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator handles recovery.');
 if(w?.size_recoveries?.some(x=>x.batch_id===p.task_id))return w;
 if(w?.status!=='blocked'||w.chair_task||!w.batch?.length||p.task_id!==w.batch[0]||(w.size_recoveries?.length||0)>=2)throw new Invalid('Choose the exact stopped batch within its repair limit.');
 if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The original allowance and hold must still permit this step.');
 const reason=wfText(p.reason,'the verified size-check repair',1000),rows=w.batch.map(id=>wfTask(s,id));
 if(rows.some(t=>t.workflow_id!==w.id||t.status!=='failed'||t.attempts!==0||t.result||!/^Fresh-session preflight: (evidence|instructions|fresh_prompt) is \d+ bytes, above \d+\./.test(t.error||'')))throw new Invalid('Retry only a wholly unstarted batch stopped by the byte threshold. Preserve started work and other input failures.');
 if(remainingCalls(s)<rows.length+1)throw new Invalid('Not enough model calls for this batch and its checkpoint.');
 const recovery={batch_id:p.task_id,reason,at:new Date(now).toISOString(),tasks:rows.map(t=>({id:t.id,error:t.error}))};
 for(const t of rows){
  taskAction(s,{action:'retry',task_id:t.id,sender_id:p.sender_id},'worker',now);
  const a=agentFor(s,t.agent_id);a.status_revision=(a.status_revision||0)+1;a.work_status={task_id:t.id,state:'sleeping',summary:t.summary,waiting_for:'The task service to start the saved assignment.',revision:a.status_revision,updated_at:new Date(now).toISOString()};
 }
 w.size_recoveries||=[];w.size_recoveries.push(recovery);w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();
 wfEvent(s,'Size-check repair: '+reason+' Resuming the unchanged assignments and evidence; no completed model work was repeated.',now);
 for(const key of ['workflow-stopped','task-preflight']){const warning=s.warnings?.find(x=>x.key===key&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key,reporter:'Orchestrator',expected_revision:warning.revision,resolution:reason,evidence:[{note:'Unstarted batch verified after the byte-policy repair',source:'workflow:'+s.project.id}]});}
 return w;
}

export function retryWorkflowPlan(s,p,role,now=Date.now(),libraryContext=null){
 const w=s.workflow;if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator handles recovery.');
 if(w?.phase_plan_recoveries?.some(x=>x.previous_task===p.task_id))return w;
 if(w?.recovered_preflights?.includes(p.task_id))return w;
 const pending=s.tasks?.find(t=>t.id===p.task_id);
 if(w?.status==='blocked'&&w.chair_task===p.task_id&&pending?.kind==='coordination'&&pending.status==='completed'&&w.reason==='Orchestrator plan was not applied: The orchestrator must choose an allowed next phase.'&&!wfOptions(s).includes(pending.result?.workflow_plan?.next_phase)){
  if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The allowance or hold must still permit this step.');
  if((w.phase_plan_recoveries?.length||0)>=2)throw new Invalid('Review repeated invalid phase plans before another coordination attempt.');
  const reason=wfText(p.reason,'the corrected phase-plan input',1000),allowed=wfOptions(s),attempted=pending.result.workflow_plan.next_phase;
  wfQueueChair(s,now,pending.id+'-phase-retry');
  const replacement=wfTask(s,w.chair_task);
  replacement.workflow_context.previous_phase_error={task_id:pending.id,attempted_phase:attempted,allowed_next_phases:allowed,reason};
  replacement.prompt+='\nCorrect the previous coordination format error: '+attempted+' is not allowed at this checkpoint. Choose only from '+allowed.join(', ')+'. Return assignments for exactly the supplied owners of that phase. Do not skip peer critique or revision to reach voting. The original completed result remains saved; do not repeat researcher work or invent a selection.';
  replacement.request.prompt=replacement.prompt;replacement.request.workflow_context=structuredClone(replacement.workflow_context);
  w.phase_plan_recoveries||=[];w.phase_plan_recoveries.push({previous_task:pending.id,replacement_task:replacement.id,attempted_phase:attempted,allowed_next_phases:allowed,reason,at:new Date(now).toISOString()});
  w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();
  wfEvent(s,'Corrected the allowed-phase input for the orchestrator. Only coordination will be reviewed again; completed researchers, sources and votes are unchanged. '+reason,now);
  const warning=s.warnings?.find(x=>x.key==='workflow-stopped'&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key:warning.key,reporter:'Orchestrator',expected_revision:warning.revision,resolution:reason,evidence:[{note:'Replacement coordinator with explicit permitted phases',source:'tasks:'+s.project.id}]});
  return w;
 }
 if(w?.status==='blocked'&&w.chair_task===p.task_id&&pending?.status==='failed'&&!pending.result&&pending.attempts===0&&pending.error?.startsWith('Fresh-session preflight:')){
  if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The allowance or hold must still permit this step.');
  wfText(p.reason,'the corrected preflight problem',1000);
  taskAction(s,{action:'retry',task_id:p.task_id,sender_id:p.sender_id},'worker',now);w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();w.recovered_preflights||=[];w.recovered_preflights.push(p.task_id);
  wfEvent(s,'Corrected the orchestrator preflight: '+p.reason+' The original checkpoint and evidence are preserved; its model had not started.',now);
  for(const key of ['workflow-stopped','task-preflight']){const warning=s.warnings?.find(x=>x.key===key&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key,reporter:'Orchestrator',expected_revision:warning.revision,resolution:p.reason,evidence:[{note:'Saved checkpoint preflight recovery',source:'workflow:'+s.project.id}]});}
  return w;
 }
 if(w?.coordination_recoveries?.some(x=>x.previous_task===p.task_id))return w;
 if(w?.status==='blocked'&&w.chair_task===p.task_id&&pending?.status==='failed'&&pending.result?.outcome==='blocked'){
  if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The allowance or hold must still permit this step.');
  const reason=wfText(p.reason,'the repaired evidence handoff',1000),evidence=wfChairEvidence(s);
  const before={input_refs:pending.input_refs||[],source_inputs:pending.source_inputs||[],registration:pending.workflow_context?.source_registration||null};
  const after={input_refs:evidence.input_refs,source_inputs:evidence.source_inputs,registration:evidence.context.source_registration};
  const catalogChanged=libraryContext?.items.length&&JSON.stringify(pending.library_context_versions||[])!==JSON.stringify(libraryContext.versions);
  if(evidence.context.missing_source_task_ids.length||!after.registration?.receipt_available||JSON.stringify(before)===JSON.stringify(after)&&!catalogChanged)throw new Invalid('Restore the registered sources and saved receipt before retrying; unchanged evidence cannot trigger another model call.');
  wfQueueChair(s,now,pending.id+'-evidence-retry',evidence);
  w.status='running';delete w.reason;w.coordination_recoveries||=[];w.coordination_recoveries.push({previous_task:pending.id,replacement_task:w.chair_task,reason,at:new Date(now).toISOString()});
  wfEvent(s,'Restored the source records and registration receipt for the orchestrator. Retrying only its blocked review; completed researchers and the original finding are unchanged. '+reason,now);
  const warning=s.warnings?.find(x=>x.key==='workflow-stopped'&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key:'workflow-stopped',reporter:'Orchestrator',expected_revision:warning.revision,resolution:reason,evidence:[{note:'Replacement orchestrator task with verified handoff paths',source:'workflow:'+s.project.id}]});
  return w;
 }
 if(w?.recovered_plans?.includes(p.task_id))return w;
 if(!w||w.status!=='blocked'||w.chair_task!==p.task_id||wfTask(s,p.task_id).status!=='completed')throw new Invalid('Only a blocked, saved orchestrator plan can be retried.');
 if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The allowance or hold must still permit this step.');
 w.status='running';delete w.reason;workflowComplete(s,p.task_id,now);if(w.status==='running'&&s.workflow.status!=='blocked'){s.workflow.recovered_plans||=[];s.workflow.recovered_plans.push(p.task_id);wfEvent(s,'Retried the unchanged saved orchestrator plan after checking the error. No model call was repeated.',now);const warning=s.warnings?.find(x=>x.key==='workflow-stopped'&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key:'workflow-stopped',reporter:'Orchestrator',expected_revision:warning.revision,resolution:'The unchanged saved plan passed the corrected checks and its assignments were saved.',evidence:[{note:'Saved plan and recovery',source:'workflow:'+s.project.id}]});}return s.workflow;
}

export function reviewWorkflowObstacle(s,p,role,now=Date.now()){
 const w=s.workflow;if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator handles recovery.');
 if(!w||w.status!=='blocked'||w.chair_task||!['prepare','response'].includes(w.phase))throw new Invalid('Choose a stopped preparation or response checkpoint with saved blocked findings.');
 const rows=w.batch.map(id=>wfTask(s,id));if(rows.some(t=>!['completed','failed'].includes(t.status))||!rows.some(t=>t.status==='failed')||rows.some(t=>t.status==='failed'&&t.result?.outcome!=='blocked'))throw new Invalid('Do not restart transport failures or unfinished workers through this action.');
 if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The original allowance must still permit this checkpoint.');
 w.status='running';delete w.reason;workflowTick(s,now);return s.workflow;
}

export function retryWorkflowLibrary(s,p,role,now=Date.now()){
 const w=s.workflow;if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator handles recovery.');
 if(!w||w.status!=='blocked'||!w.library_task||(w.library_retries||0)>=2)throw new Invalid('Use a stopped library checkpoint within its two-retry limit.');
 const t=wfTask(s,w.library_task);if(t.status!=='failed'||t.handler!=='library_collect')throw new Invalid('Only the failed source script can be retried here.');
 if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The original allowance must still permit this checkpoint.');
 taskAction(s,{action:'retry',task_id:t.id,sender_id:p.sender_id},'worker',now);w.library_retries=(w.library_retries||0)+1;w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();wfEvent(s,'Retrying the saved source script after checking its format. Researcher work is unchanged; no model call is repeated.',now);return w;
}

export function retryWorkflowReviews(s,p,role,now=Date.now()){
 const w=s.workflow;if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator handles recovery.');
 if(w?.review_recoveries?.some(x=>x.batch_id===p.task_id))return w;
 const stoppedChair=w?.chair_task?wfTask(s,w.chair_task):null;
 const inputObstacle=w?.phase==='response'&&w.obstacle?.phase==='response'&&stoppedChair?.status==='failed'&&stoppedChair.result?.outcome==='blocked';
 if(!w||w.status!=='blocked'||(w.chair_task&&!inputObstacle)||!['critique','response','vote','assess','reconsider'].includes(w.phase))throw new Invalid('Use a stopped review batch with a specific repaired input problem.');
 if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The original allowance must still permit this checkpoint.');
 if(p.task_id!==w.batch[0])throw new Invalid('Identify the exact stopped batch by its first task ID.');
 wfText(p.reason,'the repaired input problem',1000);
 const rows=w.batch.map(id=>wfTask(s,id));if(rows.some(t=>!['completed','failed','cancelled'].includes(t.status)))throw new Invalid('Wait for active reviewers to save their results.');
 const failed=rows.filter(t=>t.status!=='completed');if(!failed.length||failed.some(t=>t.status==='failed'&&t.result&&t.result.outcome!=='blocked'))throw new Invalid('Inspect the failed review inputs before recovery.');
 const fileAccessUpgrade=failed.every(t=>(t.output_access_version||0)<4&&completedTaskOutputs(s,t).some(o=>!(t.file_access_task_ids||(t.output_access_version===2?completedTaskOutputs(s,t).filter(o=>o.kind==='engineering').map(o=>o.task_id):[])).includes(o.task_id)));
 if(w.phase==='assess'&&!fileAccessUpgrade&&(!wfResearchEvidence(s).previous_investigation?.experiment_task_ids?.length||failed.some(t=>(t.output_access_version||0)>=2)))throw new Invalid('Retry this assessment only after restoring access to its completed experiment files; unchanged inputs cannot trigger another call.');
 const documentIds=p.document_ids||[];
 if(!Array.isArray(documentIds)||documentIds.length>6||new Set(documentIds).size!==documentIds.length)throw new Invalid('Provide up to six distinct saved input documents.');
 for(const id of documentIds){const t=wfTask(s,id);if(t.status!=='completed'||!(t.result?.document||t.result?.body)?.trim())throw new Invalid('Attach only complete saved input documents.');}
 const addedEvidence=failed.every(t=>documentIds.some(id=>!(t.document_ids||[]).includes(id)));
 if((w.phase==='reconsider'||(w.review_retries||0)>=2)&&!fileAccessUpgrade&&!addedEvidence)throw new Invalid('Restore missing files or attach new complete documents; unchanged inputs cannot trigger another call.');
 if(inputObstacle&&!fileAccessUpgrade&&(!documentIds.length||failed.some(t=>!documentIds.some(id=>!(t.document_ids||[]).includes(id)))))throw new Invalid('Supply the missing documents before retrying this response; unchanged inputs cannot trigger another call.');
 if(remainingCalls(s)<failed.length+1)throw new Invalid('Not enough model calls for corrected reviews and their checkpoint.');
 const sources=wfReviewSources(s);w.review_retries=(w.review_retries||0)+1;const replacements=[];
 for(const t of failed){
  const req=structuredClone(t.request);req.id=w.id+'-review-repair-'+w.review_retries+'-'+(replacements.length+1);req.input_refs=[...new Set([...(req.input_refs||[]),...sources.map(f=>f.path)])];
  req.document_ids=[...new Set([...(req.document_ids||[]),...documentIds])];
  if(fileAccessUpgrade)req.prompt+='\nAll completed tasks attached to this assignment now have verified read-only folders in reusable_work, including researchers’ assessment files and experiment files. Open the complete linked evidence needed for this decision; the earlier file-access failure is fixed. Preserve the previous blocked finding and complete only this review or ballot. This access does not authorize new experiments.';
  if(w.phase==='assess')req.prompt+='\nThe completed experiment folder is now available through reusable_work with read-only file tools. Open its full report and the saved checks needed for your assessment. This access is for reviewing existing evidence, not running new experiments. Earlier linked files were inaccessible; preserve your prior finding as provisional and finish only the missing review.';
  req.prompt+='\nThe current source records and requested saved documents are attached as complete evidence. This repeats only the interrupted review; completed peers keep their results. Use documents for full text rather than relying on dependency summaries. Return requests: []; report any remaining missing inputs once in the result.';
  const replacement=submitTask(s,req,'worker',now);replacement.workflow_id=w.id;replacement.source_inputs=sources;replacement.workflow_context.source_registration=wfRegistration(s,sources);w.batch=w.batch.map(id=>id===t.id?replacement.id:id);replacements.push({previous_task:t.id,replacement_task:replacement.id});
 }
 w.review_recoveries||=[];w.review_recoveries.push({batch_id:p.task_id,reason:p.reason,document_ids:documentIds,file_access_upgrade:fileAccessUpgrade,obstacle_task:inputObstacle?stoppedChair.id:null,tasks:replacements,at:new Date(now).toISOString()});if(inputObstacle){w.chair_task=null;w.obstacle=null;}w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();wfEvent(s,'Corrected review inputs: '+p.reason+' Completed reviews and all prior findings were preserved.',now);
 const warning=s.warnings?.find(x=>x.key==='workflow-stopped'&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key:warning.key,reporter:'Orchestrator',expected_revision:warning.revision,resolution:p.reason,evidence:[{note:'Missing documents attached to replacement review',source:'workflow:'+s.project.id}]});
 return w;
}

export function repairWorkflowHandoff(s,p,role,now=Date.now()){
 const w=s.workflow;if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator repairs this handoff.');
 if(w?.receipt_input_repairs?.some(r=>r.batch_id===p.task_id))return w;
 if(w?.status==='blocked'&&w.phase==='prepare'&&w.batch[0]===p.task_id){
  const rows=w.batch.map(id=>wfTask(s,id)),prefix='The earlier task has no matching completed delivery: ';
  if(rows.every(t=>t.status==='failed'&&t.attempts===0&&!t.result&&t.error?.startsWith(prefix))){
   if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The original allowance must still permit this work.');
   for(const t of rows){const source=wfTask(s,t.error.slice(prefix.length));if(source.status!=='completed'||source.result?.outcome!=='blocked'||!source.checkpoint_accepted)throw new Invalid('The earlier finding must have a real delivered result accepted for peer review.');}
   const reason=wfText(p.reason,'the corrected delivery check',1000);
   for(const t of rows)taskAction(s,{action:'retry',task_id:t.id,sender_id:p.sender_id},'worker',now);
   w.receipt_input_repairs||=[];w.receipt_input_repairs.push({batch_id:p.task_id,reason,at:new Date(now).toISOString()});w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();
   wfEvent(s,'Corrected the delivery check for saved provisional findings. No model had started; the original scientific status remains unchanged. '+reason,now);
   for(const key of ['workflow-stopped','task-preflight']){const warning=s.warnings?.find(x=>x.key===key&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key,reporter:'Orchestrator',expected_revision:warning.revision,resolution:reason,evidence:[{note:'Saved provisional files can be read without declaring their science accepted.',source:'tasks:'+s.project.id}]});}
   return w;
  }
 }
 if(w?.prerequisite_input_repairs?.some(r=>r.batch_id===p.task_id))return w;
 if(w&&w.phase==='prepare'&&w.batch[0]===p.task_id&&['running','blocked'].includes(w.status)){
  if(w.chair_task||w.obstacle)throw new Invalid('Let the active orchestrator finish its checkpoint before repairing this batch.');
  if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The original allowance must still permit this work.');
  const rows=w.batch.map(id=>wfTask(s,id));if(rows.some(t=>!['completed','failed'].includes(t.status)))throw new Invalid('Wait for active researchers to save their work.');
  const failed=rows.filter(t=>t.status==='failed'),reason=wfText(p.reason,'the restored prerequisite inputs',1000);
  if(!failed.length||failed.some(t=>t.result?.outcome!=='blocked'||(t.output_access_version||0)>=4||!completedTaskOutputs(s,t).some(o=>!(t.file_access_task_ids||[]).includes(o.task_id))))throw new Invalid('Restore missing prerequisite files before retrying; unchanged inputs cannot trigger another call.');
  if(w.library_task){const library=wfTask(s,w.library_task);if(library.status==='running')throw new Invalid('Wait for the active source delivery to finish.');if(library.status==='queued'){library.status='cancelled';library.error='Source inputs will be collected after the repaired preparation finishes.';}w.library_task=null;}
  w.recovery_count=(w.recovery_count||0)+1;
  const replacements=[];
  for(const prior of failed){
   const ownFiles=(prior.result.artifacts||[]).filter(f=>/\/(sources.json|reply.md|findings.md|proposal.md|method.md|assessment.md)$/.test(f.path)).map(f=>f.path);
   const req={...structuredClone(prior.request),id:prior.id+'-prerequisites-repaired',input_refs:[...new Set([...(prior.input_refs||[]),...ownFiles])],workflow_context:{...prior.workflow_context,previous_result:wfEvidence(s,[prior.id])[0]}};
   req.prompt+='\nYour saved findings and source notes are attached. Continue from them without repeating completed reading. The completed input chain is now readable through reusable_work, including earlier reports and assessments linked by the supplied votes. Finish your original assignment using those saved files; do not repeat completed experiments or change the scientific question merely to repair access.';
   const replacement=submitTask(s,req,'worker',now);replacement.workflow_id=w.id;w.batch=w.batch.map(id=>id===prior.id?replacement.id:id);replacements.push({previous_task:prior.id,replacement_task:replacement.id});
  }
  w.prerequisite_input_repairs||=[];w.prerequisite_input_repairs.push({batch_id:p.task_id,reason,tasks:replacements,at:new Date(now).toISOString()});w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();
  wfEvent(s,'Restored earlier reports and assessments needed by the new assignments. Resuming only interrupted preparation; completed peers and experiments remain saved. '+reason,now);
  const warning=s.warnings?.find(x=>x.key==='workflow-stopped'&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key:warning.key,reporter:'Orchestrator',expected_revision:warning.revision,resolution:reason,evidence:[{note:'Completed prerequisite files restored for the interrupted owners.',source:'tasks:'+s.project.id}]});
  return w;
 }
 if(w?.engineering_input_repairs?.some(r=>r.previous_task===p.task_id))return w;
 if(w?.status==='blocked'&&w.phase==='implement'&&w.batch.includes(p.task_id)){
  const prior=wfTask(s,p.task_id),evidence=wfResearchEvidence(s);
  if(prior.kind!=='engineering'||prior.status!=='failed'||prior.result?.outcome!=='blocked'||w.chair_task)throw new Invalid('Repair only a saved blocked engineering handoff.');
  if(!s.task_policy?.enabled||!s.task_policy.research_enabled||s.paused||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)throw new Invalid('The original allowance must still permit this work.');
  const reason=wfText(p.reason,'the repaired engineering inputs',1000);
  if(!evidence.document_ids.some(id=>!(prior.document_ids||[]).includes(id)))throw new Invalid('Supply missing experiment documents before retrying; unchanged inputs cannot trigger another call.');
  const req={...structuredClone(prior.request),id:prior.id+'-inputs-repaired',document_ids:[...new Set([...(prior.document_ids||[]),...evidence.document_ids])],workflow_context:{...prior.workflow_context,previous_investigation:evidence.previous_investigation}};
  const replacement=submitTask(s,req,'worker',now);replacement.workflow_id=w.id;
  w.batch=w.batch.map(id=>id===prior.id?replacement.id:id);w.engineering_input_repairs||=[];w.engineering_input_repairs.push({previous_task:prior.id,replacement_task:replacement.id,reason,at:new Date(now).toISOString()});
  w.status='running';delete w.reason;w.updated_at=new Date(now).toISOString();
  wfEvent(s,'Restored the earlier experiment files and full assessments for the engineer. Retrying only the blocked assignment; earlier results and team votes are preserved. '+reason,now);
  const warning=s.warnings?.find(x=>x.key==='workflow-stopped'&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key:'workflow-stopped',reporter:'Orchestrator',expected_revision:warning.revision,resolution:reason,evidence:[{note:'Saved experiment inputs restored for '+replacement.id,source:'tasks:'+s.project.id}]});
  return w;
 }
 if(w?.handoff_repair?.batch_id===p.task_id)return w;
 if(w?.status!=='blocked'||w.stage!=='Research'||w.phase!=='prepare'||w.chair_task||w.selected_method||w.batch[0]!==p.task_id||w.history.at(-1)?.stage!=='Proposal'||w.history.at(-1)?.phase!=='vote')throw new Invalid('Repair only the stopped Proposal-to-Research handoff.');
 const rows=w.batch.map(id=>wfTask(s,id));
 if(rows.some(t=>t.status!=='failed'||t.attempts!==0||t.result||!t.error?.startsWith('Fresh-session preflight:')||!t.document_ids?.length||t.document_ids.some(id=>!w.responses.includes(id))||t.workflow_context?.selected_proposal!==w.selected_proposal_text))throw new Invalid('Preserve started work and required evidence; this repair is only for unstarted duplicate packets.');
 const repairs=[];
 for(const t of rows){
  const removed=[...t.document_ids];repairs.push({task_id:t.id,document_ids:removed,depends_on:[...t.depends_on],error:t.error});
  t.document_ids=[];t.depends_on=t.depends_on.filter(id=>!removed.includes(id));t.workflow_context.candidates=t.workflow_context.candidates.filter(c=>c.id===w.selected_proposal);
  t.request.document_ids=[];t.request.depends_on=t.request.depends_on.filter(id=>!removed.includes(id));t.request.workflow_context=structuredClone(t.workflow_context);
  t.error='Input duplication repaired. The bounded trial remains stopped; no work has restarted.';
  const a=agentFor(s,t.agent_id);a.status_revision=(a.status_revision||0)+1;a.work_status={...a.work_status,state:'sleeping',summary:'Research handoff repaired; trial remains stopped.',waiting_for:'A new research continuation instruction and allocation.',revision:a.status_revision,updated_at:new Date(now).toISOString()};
 }
 w.handoff_repair={batch_id:p.task_id,tasks:repairs,at:new Date(now).toISOString()};w.reason='Research handoff repaired. The bounded trial remains stopped; no work has restarted.';w.updated_at=new Date(now).toISOString();
 wfEvent(s,w.reason+' The selected proposal is supplied once; other proposals remain saved in the map and meeting.',now);
 return w;
}

export function consolidateWorkflowRevisions(s,p,role,now=Date.now()){
 const w=s.workflow;if(role!=='worker'||p.sender_id!==s.orchestrator_id)throw new Invalid('The assigned orchestrator maintains proposal versions.');
 if(w?.proposal_revision_repair)return w;
 if(!w||w.stage!=='Proposal'||w.round<2||!['prepare','critique','response'].includes(w.phase)||w.chair_task||s.tasks.some(t=>['queued','running'].includes(t.status)&&['vote','coordination'].includes(t.kind)))throw new Invalid('Consolidate before the next vote or orchestrator decision.');
 const first=w.history.find(h=>h.stage==='Proposal'&&h.phase==='prepare'&&h.cycle===w.cycle&&h.round===1);
 if(!first)throw new Invalid('Missing original proposal records.');
 const plans=w.candidates.map(c=>{const original=first.task_ids.map(id=>wfTask(s,id)).find(t=>t.agent_id===c.owner_id),node=s.research_map.nodes.find(n=>n.id===c.id);const root=original&&s.research_map.nodes.find(n=>n.evidence?.some(e=>e.source==='/task-documents/'+encodeURIComponent(original.id)+'?workspace='+encodeURIComponent(s.project.id))&&!n.revision_of);if(!original||!node||!root||node===root||node.status!=='unexplored'||root.status!=='unexplored')throw new Invalid('Only confirmed, unselected revision pairs can be combined.');return {c,original,node,root};});
 s.research_map.history.push({revision:s.research_map.revision,at:new Date(now).toISOString(),actor:'Orchestrator',note:'Before grouping proposal versions',nodes:structuredClone(s.research_map.nodes)});
 for(const {c,original,node,root} of plans){
  root.owner_id=c.owner_id;root.original_task_id=original.id;
  root.proposal_versions=[...root.evidence,...node.evidence].flatMap(e=>{const id=e.source.match(/^\/task-documents\/([^?]+)/)?.[1];const t=id&&s.tasks.find(t=>t.id===decodeURIComponent(id));return t?.result?[{task_id:t.id,round:root.evidence.includes(e)?1:w.round,title:wfCandidateTitle(t,root.title),at:t.finished_at}]:[];});
  root.proposal_versions=[...new Map(root.proposal_versions.map(v=>[v.task_id,v])).values()];
  root.evidence=[...root.evidence,...node.evidence];root.revision_note='A round '+w.round+' draft is saved below. The next revision must keep this original research question.';
  node.revision_of=root.id;c.id=root.id;c.original_task_id=original.id;c.title=root.title;
 }
 s.research_map.revision++;w.proposal_revision_repair={at:new Date(now).toISOString(),pairs:plans.map(({root,node})=>({original_id:root.id,draft_id:node.id}))};
 wfEvent(s,'Grouped later drafts under their original proposals. Prior documents and votes are unchanged; the next response must revise each owner’s original question.',now);return w;
}

export function resumeAdvisoryWorkflow(s,p,role,now=Date.now()){
 const w=s.workflow;
 if(role!=='director')throw new Invalid('Only the director changes resource policy and resumes a stopped trial.');
 const id=wfText(p.client_id,'a continuation ID',120),reason=wfText(p.reason,'the continuation reason',1500);
 const scope=wfText(p.scope,'the current scope',4000),brief=wfText(p.resource_brief,'the current resource brief',6000),feasibility=wfText(p.feasibility_budget,'the current feasibility scope',1500);
 const settings={id,reason,scope,brief,feasibility};
 if(w?.continuation?.id===id){if(JSON.stringify(w.continuation.settings)!==JSON.stringify(settings))throw new Invalid('Continuation ID has different settings.');return w;}
 if(!w||w.status!=='finished'||w.phase!=='vote'||w.ballot?.final||w.round>=w.configuration.max_rounds||!/remaining|allowance|budget/i.test(w.reason||''))throw new Invalid('Resume only an unfinished selection stopped for its allowance.');
 if(s.paused||!s.task_policy?.enabled||!s.task_policy.research_enabled||w.direction_revision!==s.direction_revision||w.policy_revision!==s.task_policy.revision)throw new Invalid('Preserve project holds and changed permissions.');
 if(s.tasks.some(t=>['running','queued','delivery_pending'].includes(t.status)))throw new Invalid('Wait for an idle checkpoint.');
 if(!w.batch_recorded||w.batch.some(id=>wfTask(s,id).status!=='completed'))throw new Invalid('Resume only a fully saved ballot.');
 const previous={reason:w.reason,resource_brief:w.resource_brief,configuration:structuredClone(w.configuration),policy:structuredClone(s.task_policy),at:new Date(now).toISOString()};
 s.task_policy={...s.task_policy,usage_mode:'warn',scope,revision:s.task_policy.revision+1,updated_at:new Date(now).toISOString()};
 s.task_policy.settings={...s.task_policy.settings,usage_mode:'warn',scope};
 w.policy_revision=s.task_policy.revision;w.configuration.resource_brief=brief;w.configuration.feasibility_budget=feasibility;w.resource_brief=brief;
 w.continuation={id,settings,previous};w.resume_count=(w.resume_count||0)+1;w.status='running';w.reason=null;w.chair_task=null;w.updated_at=new Date(now).toISOString();w.next_action=reason;
 for(const key of ['workflow-stopped','task-call-budget']){const warning=s.warnings?.find(x=>x.key===key&&x.status==='open');if(warning)changeWarning(s,{action:'resolve',key,reporter:'Director',expected_revision:warning.revision,resolution:reason,evidence:[{note:'Saved director continuation '+id,source:'workflow:'+s.project.id}]});}
 wfEvent(s,'Resumed from the saved vote. Calls, checkpoints and elapsed time warn without stopping; current server resources govern experiments.',now);workflowTick(s,now);return w;
}

// Human-led meetings use a single saved round. The controller only carries out
// its fixed preparation/discussion/vote sequence and the director's decision.
export function configureHumanWorkflow(s,p,role,now=Date.now()){
 const args={...p,meeting_policy:'human',max_rounds:1};
 for(const role of ['engineer','mathematician']){args[role+'_id'] ||= s.agents.find(a=>a.role===role&&!a.dismissal)?.id;if(!args[role+'_id'])throw new Invalid('Register a '+role+' to attend meetings.');}
 return configureWorkflow(s,args,role,now);
}
function humanParticipants(s){const w=s.workflow;return [...new Set([...w.configuration.researcher_ids,w.configuration.engineer_id,w.configuration.mathematician_id,s.orchestrator_id].filter(Boolean))];}
function humanAdvance(s,next,now){
 const w=s.workflow;
 if(!next)throw new Invalid('Choose the next step.');
 const labels={prepare:w.stage==='Proposal'?'Prepare an independent proposal':'Design an experiment for the shared idea',critique:'Discuss the candidates',vote:'Vote on the next useful test',implement:'Run the approved experiment',assess:'Review the experiment results',reconsider:'Vote on keeping the research question'};
 const plan={action:'advance',next_phase:next,summary:labels[next],assignments:wfExpected(s,next).map(agent_id=>({agent_id,summary:labels[next],prompt:labels[next]+'. Use the saved brief and evidence. '+(w.director_decisions?.at(-1)?.comment||'')}))};
 wfApply(s,{id:null},plan,now,true);
}
function humanMeetingGate(s,now){
 const w=s.workflow,id=w.id+'-meeting-'+w.checkpoint;
 if(w.phase==='assess'){
  upsertRecord(s,{agent_id:s.orchestrator_id,type:'meeting',expected_revision:0,record:{id,title:'Research results',summary:'Results reviewed. Waiting for your next step.',purpose:'Review the evidence from the approved experiment.',stage:'Research',round:'1',participant_ids:humanParticipants(s),proposal_ids:[w.selected_proposal],method_ids:w.selected_method?[w.selected_method]:[],presentations:[],suggestions:w.batch.map(id=>({agent_id:wfTask(s,id).agent_id,text:taskDocumentText(wfTask(s,id)),task_id:id})),votes:[],decision:'Waiting for the human director.',evidence:w.batch.map(id=>({note:wfTask(s,id).summary,source:'/task-documents/'+encodeURIComponent(id)+'?workspace='+encodeURIComponent(s.project.id)}))}});
 }else wfMeeting(s,{summary:'The vote is advice. The human director will choose the next step.',assignments:[]},null,now);
 const m=s.research_records.meeting.find(m=>m.id===id);m.director_status='waiting';m.workflow_id=w.id;m.workflow_phase=w.phase;
 w.status='awaiting_director';w.pending_meeting_id=id;w.chair_task=null;w.next_action='Waiting for your decision in Meetings.';w.updated_at=new Date(now).toISOString();
 for(const agent_id of humanParticipants(s)){const a=agentFor(s,agent_id);if(!s.tasks.some(t=>t.agent_id===agent_id&&t.status==='running')){a.status_revision=(a.status_revision||0)+1;a.work_status={state:'sleeping',summary:'Waiting for your meeting decision',waiting_for:'You can ask questions in the meeting.',revision:a.status_revision,updated_at:w.updated_at};}}
 wfEvent(s,'The meeting is complete. Review the vote, ask questions, and choose the next step.',now);s.events.at(-1).record_ref={type:'meeting',id};
}
function humanConversations(s,meeting){
 const related=new Set([...(meeting.proposal_ids||[]),...(meeting.method_ids||[])]);
 return (s.record_questions||[]).filter(q=>q.record_type==='meeting'&&q.record_id===meeting.id||['method','proposal'].includes(q.record_type)&&related.has(q.record_id)).map(q=>({id:q.id,agent_id:q.agent_id,candidate_id:q.candidate_id,question:q.body,created_at:q.created_at,replies:q.replies.map(r=>({agent_id:r.agent_id,body:r.body,document:r.task_id?s.tasks.find(t=>t.id===r.task_id)?.result?.document||null:null,created_at:r.created_at}))}));
}
function humanQueueBriefing(s,now){
 const w=s.workflow,d=w.director_decisions.at(-1),m=s.research_records.meeting.find(m=>m.id===d.meeting_id);
 d.conversations=humanConversations(s,m);d.briefing_round=(d.briefing_round||0)+1;d.briefing_ids=[];
 const docs=[...new Set((m.presentations||[]).map(c=>c.task_id).filter(Boolean))];
 for(const agent_id of humanParticipants(s)){
  const t=submitTask(s,{id:d.id+'-brief-'+d.briefing_round+'-'+(d.briefing_ids.length+1),sender_id:s.orchestrator_id,agent_id,kind:'meeting',summary:'Read the director’s decision and team questions',prompt:'Read the saved meeting, the human decision, and every supplied human–agent conversation. Acknowledge the decision in one short sentence and note only a real ambiguity relevant to your role. This is a read-only handoff, not another vote, revision round or permission to start experiments. Do not issue requests or change the decision. Keep this shared context for the next assigned task.',document_ids:docs,workflow_context:{meeting_policy:'human',phase:'human_briefing',director_decision:{id:d.id,action:d.action,choice:d.choice,comment:d.comment,discarded_ids:d.discarded_ids||[],conversations:d.conversations},meeting:{title:m.title,stage:m.stage,votes:m.votes,suggestions:m.suggestions,decision:m.decision},research_focus:workflowResearchFocus(s)}},'worker',now);
  d.briefing_ids.push(t.id);
 }
 w.status='briefing';w.next_action='Sharing your decision and conversations with the team.';
}
export function decideHumanMeeting(s,p,role,now=Date.now()){
 if(role!=='director')throw new Invalid('Only the human director decides after a meeting.');
 const w=s.workflow;if(!w||w.meeting_policy!=='human')throw new Invalid('This project is not using human meeting decisions.');
 const client=wfText(p.client_id,'a decision ID',100),old=w.director_decisions?.find(d=>d.client_id===client);
 if(old){if(old.meeting_id!==p.meeting_id||old.action!==p.next_step||old.choice!==(p.next_step==='select'?p.choice:null)||old.comment!==(p.comment||'').trim())throw new Invalid('This decision ID has different content.');return old;}
 if(w.status!=='awaiting_director'||w.pending_meeting_id!==p.meeting_id)throw new Invalid('This meeting is not waiting for a decision.');
 const m=s.research_records.meeting.find(m=>m.id===p.meeting_id);
 if(m.revision!==p.expected_revision)throw new Invalid('The meeting changed. Reopen it before deciding.');
 const phase=w.phase,allowed=phase==='assess'?['design','repeat','reconsider','stop']:['select','design','stop'];
 if(!allowed.includes(p.next_step))throw new Invalid('Choose an available next step.');
 if(p.next_step==='select'&&!w.candidates.some(c=>c.id===p.choice))throw new Invalid('Choose a candidate from this meeting.');
 if(p.next_step==='repeat'&&!w.selected_method)throw new Invalid('There is no selected experiment to repeat.');
 const d={id:w.id+'-decision-'+w.checkpoint,client_id:client,meeting_id:m.id,phase,stage:w.stage,action:p.next_step,choice:p.next_step==='select'?p.choice:null,comment:typeof p.comment==='string'?p.comment.trim():'',created_at:new Date(now).toISOString()};
 d.selection_task_id=p.next_step==='select'?w.candidates.find(c=>c.id===p.choice)?.task_id||null:null;
 // Reject only the candidates in this selection meeting. A request for another
 // experiment after results does not reject the tested method or its proposal.
 if(d.action==='design'&&phase==='vote'){
  const ids=w.stage==='Proposal'?m.proposal_ids:m.method_ids;
  const reason='The director rejected all '+(w.stage==='Proposal'?'proposals':'methods')+' in this meeting and requested new candidates.'+(d.comment?' '+d.comment:'');
  if(w.stage==='Proposal'){
   decideDirections(s,{expected_revision:s.research_map.revision,choices:ids.map(id=>({id,status:'discarded'})),comment:reason},{actor:'Director'});
   w.direction_revision=s.direction_revision;
  }else for(const id of ids){const method=s.research_records.method.find(r=>r.id===id);decideMethod(s,{id,expected_revision:method.revision,status:'discarded',reason});}
  d.discarded_ids=[...ids];d.discard_reason=reason;
 }
 (w.director_decisions||=[]).push(d);m.director_status='decided';m.director_decision=structuredClone(d);m.decision='Human decision: '+(d.choice||({design:phase==='vote'?'discard these candidates and prepare new ones':'prepare new candidates',repeat:'continue the selected experiment',reconsider:'discuss whether to keep the question',stop:'stop'}[d.action]))+(d.comment?'. '+d.comment:'');m.revision++;m.updated_at=d.created_at;
 humanQueueBriefing(s,now);wfEvent(s,d.discarded_ids?.length?'You rejected all '+(d.stage==='Proposal'?'proposals':'methods')+' in this meeting. They are now Discarded; sharing your feedback with the team.':'You chose the next step. Sharing your decision and conversations with the whole team.',now);s.events.at(-1).actor='Director';s.events.at(-1).record_ref={type:'meeting',id:m.id};return d;
}
function humanBriefingTick(s,now){
 const w=s.workflow;if(w.status!=='briefing')return ['awaiting_director','finished','stopped'].includes(w.status);
 if(s.paused||!s.task_policy?.research_enabled||w.policy_revision!==s.task_policy.revision||w.direction_revision!==s.direction_revision)return true;
 const d=w.director_decisions.at(-1),rows=d.briefing_ids.map(id=>wfTask(s,id));
 if(rows.some(t=>['failed','cancelled'].includes(t.status))){w.next_action='A team member could not read the decision. Check the saved handoff.';return true;}
 if(rows.some(t=>t.status!=='completed'))return true;
 const m=s.research_records.meeting.find(m=>m.id===d.meeting_id),latest=humanConversations(s,m);
 if(latest.some(q=>!q.replies.length)){w.next_action='Waiting for answers to your meeting questions before starting the next step.';return true;}
 // A reply arriving during the handoff must reach every participant too.
 if(JSON.stringify(latest)!==JSON.stringify(d.conversations)){humanQueueBriefing(s,now);return true;}
 d.delivered_at=new Date(now).toISOString();d.acknowledged_by=rows.map(t=>t.agent_id);m.director_decision=structuredClone(d);w.pending_meeting_id=null;w.status='running';w.chair_task=null;
 if(d.action==='stop'){
  w.status='stopped';w.reason=d.comment||'Stopped by the human director.';w.next_action=w.reason;w.termination={kind:'director',reason:w.reason,at:d.delivered_at};wfEvent(s,w.reason,now);return true;
 }
 if(d.action==='select'){
  const c=w.candidates.find(c=>c.id===d.choice);
  if(w.phase==='reconsider'){
   if(d.choice==='return-to-proposal'){wfCloseInvestigation(s,m,now);w.stage='Proposal';w.selected_proposal=null;w.selected_method=null;w.selected_proposal_text=null;w.selected_method_text=null;}
  }else if(w.stage==='Proposal'){
   m.selected_proposal_id=c.id;
   decideDirections(s,{expected_revision:s.research_map.revision,choices:[...s.research_map.nodes.filter(n=>n.status==='under_exploration'&&n.id!==c.id).map(n=>({id:n.id,status:'unexplored'})),{id:c.id,status:'under_exploration'}],comment:d.comment||'Selected by the human director.'},{actor:'Director'});w.direction_revision=s.direction_revision;
   w.selected_proposal=c.id;w.selected_proposal_text=taskDocumentText(wfTask(s,c.task_id));w.stage='Research';w.selected_method=null;w.selected_method_text=null;
  }else{
   w.selected_method=c.id;w.selected_method_text=taskDocumentText(wfTask(s,c.task_id));
   for(const r of s.research_records.method){if(r.status==='active'&&r.id!==c.id)r.status='unexplored';if(r.id===c.id){r.status='active';r.decision_reason=d.comment||'Selected by the human director.';r.revision++;r.updated_by='Director';r.updated_at=d.delivered_at;}}
  }
 }
 let next=d.action==='repeat'?'implement':d.action==='reconsider'?'reconsider':d.action==='select'&&d.stage==='Research'&&d.phase!=='reconsider'?'implement':'prepare';
 // The saved human choice, not a ballot majority, now supplies the next action.
 w.phase=next==='implement'?'assess':'start';w.round=1;w.cycle++;w.batch=[];w.presentations=[];w.critiques=[];w.responses=[];w.candidates=[];w.batch_recorded=false;delete w.ballot;
 if(next==='reconsider')w.phase='assess';
 humanAdvance(s,next,now);return true;
}
export function adoptHumanMeetings(s,p,role,now=Date.now()){
 if(role!=='director')throw new Invalid('Only the director changes meeting rules.');
 const w=s.workflow;if(!w)throw new Invalid('This project has no workflow.');
 for(const role of ['engineer','mathematician']){const id=p[role+'_id']||w.configuration[role+'_id']||s.agents.find(a=>a.role===role&&!a.dismissal)?.id;if(!id||agentFor(s,id).role!==role)throw new Invalid('Assign the '+role+' before changing meetings.');w.configuration[role+'_id']=id;}
 if(w.chair_task&&wfTask(s,w.chair_task).status==='running')throw new Invalid('Let the current checkpoint save before changing meeting rules.');
 if(w.chair_task){const t=wfTask(s,w.chair_task);if(t.status==='queued'){t.status='cancelled';t.error='Replaced by the human meeting rules.';}w.chair_task=null;}
 w.meeting_policy='human';w.configuration.meeting_policy='human';w.configuration.max_rounds=1;w.round=1;
 if(w.status==='blocked'&&w.batch.every(id=>wfTask(s,id).status==='completed')){w.status='running';delete w.reason;}
 wfEvent(s,'Meetings now have one round. Engineers and mathematicians join the discussion; the human director chooses after the vote.',now);workflowTick(s,now);return w;
}
