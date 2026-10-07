import {Invalid,agentFor,reportFor} from './logic.mjs';
import {replyReviewQuestion} from './review-chat.mjs';
import {agentName} from './identities.mjs';
import {earlierReports} from './report-history.mjs';
import {renderDocument} from './documents.mjs';
import {orchestratorFor,backfillExchanges,coordinationPending,coordinatorBusy} from './orchestrator-inbox.mjs';

import {deputyPending} from './deputy.mjs';
import {executionBusy} from './execution.mjs';

const leaseMs=120000,maxAttempts=2;
const runnerText=(v,label)=>{if(typeof v!=='string'||!v.trim()||v.length>160)throw new Invalid('Provide '+label+'.');return v;};
const liveLease=(q,now)=>q.delivery?.status==='answering'&&Date.parse(q.delivery.lease_until)>now;
const retryable=(q,now)=>!q.replies.length&&!liveLease(q,now)&&!['failed','cancelled'].includes(q.delivery?.status)&&(!q.delivery?.retry_at||Date.parse(q.delivery.retry_at)<=now);
function claimedQuestion(s,p,now){
 const q=(s.review_questions||[]).find(q=>q.id===p.question_id);
 if(!q||q.delivery?.runner_id!==p.runner_id||q.delivery?.lease_id!==p.lease_id||!liveLease(q,now))throw new Invalid('This reply claim expired or belongs to another runner.');
 return q;
}
export function reviewRunnerAction(s,p,now=Date.now()){
 const stamp=new Date(now).toISOString();
 if(p.action==='retry'){
  const q=(s.review_questions||[]).find(q=>q.id===p.question_id);
  if(!q||q.replies.length||q.delivery?.status!=='failed'||(q.sender_kind==='deputy'&&(!s.deputy?.enabled||(s.deputy_reviews||[]).find(b=>b.id===q.deputy_review_id)?.status!=='waiting')))throw new Invalid('Only a failed unanswered question can be retried.');
  q.delivery={status:'queued',attempts:0,updated_at:stamp};return q;
 }
 const runner_id=runnerText(p.runner_id,'a runner ID');
 if(p.action==='heartbeat'){
  if(!Array.isArray(p.agent_ids)||!p.agent_ids.length||p.agent_ids.length>100)throw new Invalid('Choose the registered reply agents.');
  const ids=[...new Set(p.agent_ids)];ids.forEach(id=>agentFor(s,id));
  const coordinator=orchestratorFor(s);
  if(p.orchestrator_id&&(!coordinator||p.orchestrator_id!==coordinator.id||!ids.includes(coordinator.id)))throw new Invalid('Register the project’s assigned orchestrator.');
  backfillExchanges(s);
  s.review_runner={runner_id,agent_ids:ids,orchestrator_id:p.orchestrator_id||null,last_seen:stamp,mode:'review_assistance',capabilities:Array.isArray(p.capabilities)?p.capabilities.filter(x=>x==='deputy'):[]};
  return {ok:true,deputy_pending:s.review_runner.capabilities.includes('deputy')&&deputyPending(s,now),coordination_pending:!!p.orchestrator_id&&coordinationPending(s,now),pending:(s.review_questions||[]).filter(q=>ids.includes(q.agent_id)&&retryable(q,now)).map(q=>({id:q.id,agent_id:q.agent_id,report_id:q.report_id}))};
 }
 if(p.action==='claim'){
  if(s.review_runner?.runner_id!==runner_id||!s.review_runner.agent_ids.includes(p.agent_id))throw new Invalid('Register this agent with a heartbeat first.');
  const q=(s.review_questions||[]).find(q=>q.id===p.question_id&&q.agent_id===p.agent_id);
  if(!q||!retryable(q,now)||coordinatorBusy(s,p.agent_id,now)||executionBusy(s,p.agent_id,now))return null;
  // One turn per role, even when two service instances race for different questions.
  if((s.review_questions||[]).some(other=>other.agent_id===q.agent_id&&other.id!==q.id&&liveLease(other,now)))return null;
  const attempts=(q.delivery?.attempts||0)+1;
  if(attempts>maxAttempts){q.delivery={...q.delivery,status:'failed',error:'Reply interrupted. You can try again.',updated_at:stamp};return null;}
  q.delivery={status:'answering',runner_id,lease_id:crypto.randomUUID(),lease_until:new Date(now+leaseMs).toISOString(),attempts,updated_at:stamp};
  return {question_id:q.id,agent_id:q.agent_id,report_id:q.report_id,...q.delivery};
 }
 if(p.action==='complete'){
  const q=(s.review_questions||[]).find(q=>q.id===p.question_id);
  // A lost HTTP response is safe to retry after the lease has been released.
  const old=q?.replies.find(r=>r.client_id===p.client_id);
  if(old)return replyReviewQuestion(s,p);
  const held=claimedQuestion(s,p,now);
  if(held.replies.length)return {already_answered:true};
  const answer=replyReviewQuestion(s,p);
  if(orchestratorFor(s)?.id===held.agent_id&&Array.isArray(p.reviewed_notice_ids)){
   for(const n of s.orchestrator_inbox||[])if(p.reviewed_notice_ids.includes(n.id)&&n.attention_kind==='routine'&&!n.batch_id&&!n.reviewed_at){n.reviewed_at=stamp;n.reviewed_by=held.agent_id;}
  }
  held.delivery={status:'answered',attempts:held.delivery.attempts,updated_at:stamp};return answer;
 }
 const q=claimedQuestion(s,p,now);
 if(q.replies.length){q.delivery={status:'answered',updated_at:stamp};return {already_answered:true};}
 if(p.action==='renew'){q.delivery.lease_until=new Date(now+leaseMs).toISOString();q.delivery.updated_at=stamp;return {ok:true};}
 if(p.action==='fail'){
  const reasons={auth:'Codex needs attention: check its sign-in or usage limit.',timeout:'The reply took too long.',context:'The saved context could not be loaded.',model:'The reply could not be completed.',connection:'The connection was interrupted.'};
  const retry=p.retryable===true&&q.delivery.attempts<maxAttempts;
  q.delivery={status:retry?'queued':'failed',attempts:q.delivery.attempts,error:reasons[p.error_code]||reasons.model,retry_at:retry?new Date(now+30000).toISOString():null,updated_at:stamp};return q.delivery;
 }
 throw new Invalid('Unknown runner action.');
}
export function reviewRunnerContext(s,p){
 const q=claimedQuestion(s,p,Date.now()),agent=agentFor(s,q.agent_id),report=reportFor(s,q.report_id);
 const ids=new Set([...(report.contributors||[]).map(c=>c.report_id).filter(Boolean),...earlierReports(s,report).map(r=>r.report_id)]);
 const source_reports=s.reports.filter(r=>ids.has(r.id));
 return {project:s.project,paused:s.paused,direction:s.direction,question:q,
  agent:{id:agent.id,name:agentName(agent,s.agents),role:orchestratorFor(s)?.id===agent.id?'orchestrator':agent.role,specialty:agent.specialty,question:agent.question,status:agent.status},
  report,source_reports,research_map:s.research_map,
  orchestrator_notices:orchestratorFor(s)?.id===agent.id?(s.orchestrator_inbox||[]).filter(n=>!n.reviewed_at&&!n.batch_id).slice(0,20):[],
  conversation:(s.review_questions||[]).filter(x=>x.report_id===q.report_id&&x.created_at<=q.created_at).slice(-20),
  slide_html:renderDocument({...report,earlier_reports:earlierReports(s,report)})};
}
