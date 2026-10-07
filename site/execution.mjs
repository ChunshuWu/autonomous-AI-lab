import {Invalid,agentFor,reportFor,change,validateProgress} from './logic.mjs';
import {acknowledgeTeam,submitUpdate,submitTeamReport} from './team.mjs';
import {agentName} from './identities.mjs';
import {submitRequest} from './requests.mjs';

const execStamp=()=>new Date().toISOString();
const execTerminal=['completed','cancelled','failed'];
const execRoundDone=['reported','cancelled','blocked'];
const execText=(v,label,max=12000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Invalid('Provide '+label+'.');return v.trim();};
const execRound=(s,id)=>(s.execution_rounds||[]).find(r=>r.id===id);
const execJob=(s,id)=>(s.execution_jobs||[]).find(j=>j.id===id);
const execLive=(j,now)=>j.status==='running'&&Date.parse(j.lease_until)>now;
export const executionBusy=(s,id,now=Date.now())=>(s.execution_jobs||[]).some(j=>j.agent_id===id&&execLive(j,now));
const execEvent=(s,actor,text)=>s.events.push({at:execStamp(),actor,text});

function execAuthority(s,r){
 if(!r||!s.deputy?.enabled||s.deputy.epoch!==r.epoch||s.latest_team_report!==r.report_id||s.direction_revision!==r.direction_revision||(s.research_map?.revision||0)!==r.map_revision||execRoundDone.includes(r.status))return false;
 return r.action==='revise_report'||(!s.paused&&(s.research_map?.nodes||[]).some(n=>n.id===r.focus_id&&n.status==='under_exploration'));
}
function execNewJob(s,r,agent_id,kind,extra={}){
 const j={id:'work-'+crypto.randomUUID(),round_id:r.id,agent_id,kind,status:'queued',attempts:0,created_at:execStamp(),...extra};
 (s.execution_jobs||=[]).push(j);r.job_ids.push(j.id);return j;
}
function execBlock(s,r,j,reason){
 if(j){j.status='failed';j.error=reason;j.finished_at=execStamp();delete j.lease_until;const a=agentFor(s,j.agent_id);if(j.kind!=='check'&&a.status!=='closed')a.status='paused';}
 r.status='blocked';r.reason=reason;
 for(const other of s.execution_jobs||[])if(other.round_id===r.id&&!execTerminal.includes(other.status)){
  other.status='cancelled';other.error='The round needs attention.';delete other.lease_until;
  const a=agentFor(s,other.agent_id);if(other.kind!=='check'&&a.status!=='closed')a.status='paused';
 }
 const key='execution-'+r.id,old=(s.requests||[]).find(q=>q.key===key);
 submitRequest(s,{action:'submit',key,...(old?{expected_revision:old.revision}:{}),title:'Approved work needs attention',requester:agentName(agentFor(s,s.orchestrator_id),s.agents),context:'The deputy approved this round, but it could not finish. Saved work is kept. '+reason,question:'Please review the obstacle before retrying or changing the plan.',options:[],recommendation:'Resolve the obstacle, then use Retry approved work if the same steps are still appropriate.',agent_ids:r.owner_ids,evidence:[{note:'Execution round and saved failure',source:'execution:'+r.id}]});
 execEvent(s,'WuLab','Paused the automatic round: '+reason);
}
export function stopExecution(s,reason){
 for(const r of s.execution_rounds||[])if(!execRoundDone.includes(r.status)){
  r.status='cancelled';r.reason=reason;
  for(const j of s.execution_jobs||[])if(j.round_id===r.id&&!execTerminal.includes(j.status)){
   j.status='cancelled';j.error=reason;delete j.lease_until;
   const a=agentFor(s,j.agent_id);if(j.kind!=='check'&&a.status!=='closed')a.status='paused';
  }
 }
}
function execAdvance(s,r){
 const jobs=s.execution_jobs.filter(j=>j.round_id===r.id);
 if(r.status==='research'&&jobs.filter(j=>j.kind==='research').every(j=>j.status==='completed')){
  r.status='writing';execNewJob(s,r,r.writer_id,'writer');
 }
 if(r.status==='checking'){
  const checks=jobs.filter(j=>j.kind==='check'&&j.draft_version===r.draft_version);
  if(!checks.length||!checks.every(j=>j.status==='completed'))return;
  const failed=checks.filter(j=>!j.result.approved);
  if(failed.length){
   r.corrections=failed.map(j=>({agent_id:j.agent_id,...j.result}));
   if(r.draft_version>=3){execBlock(s,r,null,'The report still needs corrections after two revision attempts.');return;}
   r.status='writing';execNewJob(s,r,r.writer_id,'writer',{revision:true});return;
  }
  const report=submitTeamReport(s,{agent_id:r.writer_id,report:r.draft});
  r.status='reported';r.published_report_id=report.id;r.finished_at=execStamp();
  execEvent(s,'WuLab','Published the checked team report for the deputy to review.');
 }
}
function execSync(s,now){
 for(const r of s.execution_rounds||[])if(!execRoundDone.includes(r.status)){
  if(!execAuthority(s,r)){r.status='cancelled';r.reason='The approval, focus or deputy setting changed.';
   for(const j of s.execution_jobs||[])if(j.round_id===r.id&&!execTerminal.includes(j.status)){j.status='cancelled';delete j.lease_until;const a=agentFor(s,j.agent_id);if(j.kind!=='check'&&a.status!=='closed')a.status='paused';}continue;}
  const lost=(s.execution_jobs||[]).find(j=>j.round_id===r.id&&j.status==='running'&&!execLive(j,now));
  if(lost){execBlock(s,r,lost,'A worker stopped reporting its status. Check its saved work before retrying.');continue;}
  execAdvance(s,r);
 }
 if(!s.deputy?.enabled)return;
 const review=(s.deputy_reviews||[]).find(b=>b.epoch===s.deputy.epoch&&b.report_id===s.latest_team_report&&b.status==='decided');
 if(!review||!['continue','revise_report'].includes(review.next_action)||(s.execution_rounds||[]).some(r=>r.decision_id===review.decision_id))return;
 const d=s.decisions.find(d=>d.id===review.decision_id),report=reportFor(s,review.report_id),writer=agentFor(s,report.agent_id);
 if(!d||writer.status==='closed')return;
 const owners=d.decision==='continue'?report.contributors.filter(c=>{const a=agentFor(s,c.agent_id);return a.status==='feedback_received'&&a.feedback?.id===d.id+':'+a.id;}).map(c=>c.agent_id):[];
 const r={id:'round-'+crypto.randomUUID(),decision_id:d.id,epoch:s.deputy.epoch,report_id:report.id,focus_id:d.focus_id,map_revision:d.map_revision,direction_revision:d.direction_revision,action:d.decision,writer_id:writer.id,owner_ids:owners,job_ids:[],status:d.decision==='continue'?'research':'writing',created_at:execStamp(),draft_version:0};
 (s.execution_rounds||=[]).push(r);
 const registered=new Set(s.execution_runner.agent_ids);
 if(!registered.has(writer.id)||owners.some(id=>!registered.has(id))||(d.decision==='continue'&&!owners.length)){execBlock(s,r,null,'A required worker or writer is not connected, or the approved tasks are no longer available.');return;}
 if(d.decision==='continue')for(const id of owners){const a=agentFor(s,id);execNewJob(s,r,id,'research',{feedback_id:a.feedback.id,approved_steps:structuredClone(a.feedback.approved_steps)});}
 else execNewJob(s,r,writer.id,'writer',{revision:true});
 execEvent(s,'WuLab','Queued the deputy-approved work.');
}
function execClaimed(s,p,now){
 const j=execJob(s,p.job_id),r=execRound(s,j?.round_id);
 if(!j||!execAuthority(s,r)||!execLive(j,now)||j.runner_id!==p.runner_id||j.lease_id!==p.lease_id||j.agent_id!==p.agent_id)throw new Invalid('This work is no longer approved or its claim expired.');
 const a=agentFor(s,j.agent_id);
 if(a.status==='closed'||(j.kind==='research'&&(a.status!=='working'||a.feedback?.id!==j.feedback_id||JSON.stringify(a.plan)!==JSON.stringify(j.approved_steps.map(x=>({id:x.id,task:x.task}))))))throw new Invalid('The worker’s approved plan or state changed.');
 return {j,r,a};
}
export function executionAction(s,p,now=Date.now()){
 if(p.action==='work_retry'){
  const r=execRound(s,p.round_id);if(!r||r.status!=='blocked'||!s.deputy?.enabled||s.deputy.epoch!==r.epoch||s.latest_team_report!==r.report_id||s.direction_revision!==r.direction_revision||(s.research_map?.revision||0)!==r.map_revision)throw new Invalid('This round cannot be retried under the current decision.');
  const failed=s.execution_jobs.filter(j=>j.round_id===r.id&&['failed','cancelled'].includes(j.status));if(!failed.length||failed.some(j=>j.attempts>=2))throw new Invalid('This round needs a revised plan, not another retry.');
  for(const j of failed){
   if(j.kind==='research'){const a=agentFor(s,j.agent_id);if(a.feedback?.id!==j.feedback_id)throw new Invalid('The task approval changed.');if(!j.attempts)a.status='feedback_received';}
   j.status='queued';delete j.error;delete j.lease_until;
  }
  r.status=failed.some(j=>j.kind==='research')?'research':failed.some(j=>j.kind==='writer')?'writing':'checking';delete r.reason;
  const request=(s.requests||[]).find(q=>q.key==='execution-'+r.id&&q.status==='pending');if(request){request.status='superseded';request.revision++;}
  return r;
 }
 if(p.action==='work_heartbeat'){
  if(!Array.isArray(p.agent_ids)||!p.agent_ids.length||p.agent_ids.length>100)throw new Invalid('Register the execution workers.');
  p.agent_ids.forEach(id=>agentFor(s,id));
  if(s.review_runner?.runner_id!==p.runner_id)throw new Invalid('Use the registered lab service.');
  const reviewer_ids=(p.reviewer_ids||[]).filter(id=>p.agent_ids.includes(id)&&id!==s.orchestrator_id);
  s.execution_runner={runner_id:p.runner_id,agent_ids:[...new Set(p.agent_ids)],reviewer_ids,last_seen:new Date(now).toISOString(),mode:'approved_tasks'};
  execSync(s,now);
  return {pending:(s.execution_jobs||[]).filter(j=>j.status==='queued'&&execAuthority(s,execRound(s,j.round_id))).map(j=>({id:j.id,agent_id:j.agent_id,kind:j.kind})),active:(s.execution_jobs||[]).filter(j=>execLive(j,now)).map(j=>j.id)};
 }
 if(s.execution_runner?.runner_id!==p.runner_id||!s.execution_runner.agent_ids.includes(p.agent_id))throw new Invalid('Register this execution worker first.');
 const j=execJob(s,p.job_id),r=execRound(s,j?.round_id);
 if(p.action==='work_complete'&&j?.status==='completed'&&j.agent_id===p.agent_id&&j.runner_id===p.runner_id&&j.completion_id===p.completion_id)return {already_completed:true,result:j.result};
 if(p.action==='work_claim'){
  if(!j||j.agent_id!==p.agent_id||j.status!=='queued'||!execAuthority(s,r))return null;
  if(executionBusy(s,j.agent_id,now)||(s.review_questions||[]).some(q=>q.agent_id===j.agent_id&&q.delivery?.status==='answering'&&Date.parse(q.delivery.lease_until)>now))return null;
  const a=agentFor(s,j.agent_id);try{if(a.status==='closed')throw new Invalid('Stopped tasks cannot restart.');
  if(j.kind==='research'){
   if(a.feedback?.id!==j.feedback_id)throw new Invalid('This approval changed.');
   if(a.status==='feedback_received')acknowledgeTeam(s,{agent_id:a.id,feedback_id:j.feedback_id,understanding:execText(p.understanding,'the worker’s understanding'),plan:j.approved_steps.map(x=>({id:x.id,task:x.task}))});
   if(a.status==='paused'&&j.attempts>0)a.status='ready';
   change(s,{action:'claim',agent_id:a.id,runtime:'Automatic approved task'},'worker');
  }else if(j.kind==='writer')a.status='preparing_report';
  }catch(error){if(!(error instanceof Invalid))throw error;execBlock(s,r,j,'The approved worker could not start: '+error.message);return null;}
  j.status='running';j.runner_id=p.runner_id;j.lease_id=crypto.randomUUID();j.lease_until=new Date(now+60000).toISOString();j.attempts++;j.started_at=execStamp();
  return {job_id:j.id,agent_id:j.agent_id,kind:j.kind,lease_id:j.lease_id,round_id:r.id};
 }
 const held=execClaimed(s,p,now),a=held.a;
 if(p.action==='work_renew'){j.lease_until=new Date(now+60000).toISOString();j.last_seen=execStamp();a.last_seen=j.last_seen;return {allowed:true};}
 if(p.action==='work_fail'){execBlock(s,r,j,execText(p.reason,'the obstacle',2000));return {status:'blocked'};}
 if(p.action!=='work_complete')throw new Invalid('Unknown execution action.');
 execText(p.completion_id,'a completion ID',200);
 if(j.kind==='research'){
  const update=structuredClone(p.result?.update||{});validateProgress(update.previous_steps,a);
  update.direction_ids=[r.focus_id];update.execution_round_id=r.id;
  const saved=submitUpdate(s,{agent_id:a.id,update},{preserve_agents:r.owner_ids});j.result={update_id:saved.id,summary:saved.summary};
 }else if(j.kind==='writer'){
  const draft=structuredClone(p.result?.report||{});
  if(r.owner_ids.some(id=>!draft.contributors?.some(c=>c.agent_id===id)))throw new Invalid('Include every approved owner in this round’s report.');
  // The approved round determines identity, never fields copied from an old
  // report or an unpublished draft's repair pass.
  draft.execution_round_id=r.id;
  if(r.action==='revise_report'){
   const source=reportFor(s,r.report_id);
   draft.report_kind='correction';draft.revision_of=source.id;
   draft.research_round_id=source.research_round_id||source.progress_id||source.id;
  }else{
   draft.report_kind='progress';draft.research_round_id=r.id;
   delete draft.revision_of;
  }
  // Validate against a copy before any checker sees the draft; nothing is published yet.
  const trial=structuredClone(s);submitTeamReport(trial,{agent_id:a.id,report:draft});
  r.draft=draft;r.draft_version++;r.status='checking';a.status='paused';
  const authors=r.owner_ids.length?r.owner_ids:draft.contributors.map(c=>c.agent_id);
  const checkers=[...new Set([...authors,...s.execution_runner.reviewer_ids])].filter(id=>id!==a.id&&s.execution_runner.agent_ids.includes(id)&&agentFor(s,id).status!=='closed');
  if(!checkers.length)throw new Invalid('A report needs a connected scientific checker.');
  for(const id of checkers)execNewJob(s,r,id,'check',{draft_version:r.draft_version});
  j.result={draft_version:r.draft_version,summary:'Draft ready for scientific and clarity checks.'};
 }else{
  if(typeof p.result?.approved!=='boolean'||!Array.isArray(p.result?.issues))throw new Invalid('Provide the report check and issues.');
  p.result.issues.forEach(x=>execText(x,'a report issue',3000));
  if(!p.result.approved&&!p.result.issues.length)throw new Invalid('Explain what needs fixing.');
  j.result={approved:p.result.approved,issues:p.result.issues,summary:execText(p.result.summary,'a report check summary',2000)};
 }
 j.status='completed';j.completion_id=p.completion_id;j.finished_at=execStamp();delete j.lease_until;
 execAdvance(s,r);return {status:j.status,result:j.result,round_status:r.status};
}
export function executionContext(s,p){
 const {j,r,a}=execClaimed(s,p,Date.now());
 return {report_contract:r.action==='continue'?{format:'document',kind:'progress',research_round_id:r.id,instruction:'Write a separate document with useful embedded figures for this research round; do not create slides or run visual inspection. Save report.md and the review metadata in your current task folder. Explain its new findings and prior-step outcomes. Link older decks through previous_reports; do not copy their report IDs, revision_of, progress identity, or presentation overrides. A repair of this unpublished draft stays within this new round.'}:{format:'document',kind:'correction',revision_of:r.report_id,instruction:'Correct the identified report as a document with useful embedded figures for the same research round. Save report.md; do not create slides or run visual inspection. Preserve the old published version and its questions; this task permits no new research.'},project:s.project,job:j,round:r,agent:{...a,display_name:agentName(a,s.agents)},deputy:s.deputy,direction:s.direction,decision:s.decisions.find(d=>d.id===r.decision_id),report:reportFor(s,r.report_id),report_history:j.kind==='writer'?s.reports:[],research_map:s.research_map,
  team:s.agents.map(a=>({...a,display_name:agentName(a,s.agents)})),updates:(s.research_updates||[]).filter(u=>s.agents.some(a=>a.latest_update===u.id)),questions:(s.review_questions||[]).filter(q=>q.report_id===r.report_id),instructions:'Execute only this claimed task. Research ends at its approved boundary. Checks and writing use saved evidence only. The current deputy switch and claim must remain valid.'};
}
