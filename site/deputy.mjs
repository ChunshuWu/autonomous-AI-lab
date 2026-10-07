import {Invalid,agentFor,reportFor} from './logic.mjs';
import {orchestratorFor} from './orchestrator-inbox.mjs';
import {reviewTeamReport} from './team.mjs';
import {askReviewQuestion} from './review-chat.mjs';
import {agentName} from './identities.mjs';

const deputyText=(v,label,max=5000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Invalid('Provide '+label+'.');return v.trim();};
const deputyLive=(b,now)=>b?.status==='reviewing'&&Date.parse(b.delivery?.lease_until)>now;
const deputyTerminal=['decided','failed','cancelled'];
const deputyCurrent=s=>(s.deputy_reviews||[]).find(b=>b.epoch===s.deputy?.epoch&&b.report_id===s.latest_team_report);
// Fingerprint only decision inputs. Heartbeats and routine inbox bookkeeping do not stale a review.
const deputySnapshot=s=>JSON.stringify([s.latest_team_report,s.research_map?.revision||0,s.direction_revision,s.paused,
 s.agents.map(a=>[a.id,a.status,a.plan,a.prior_proposals,a.latest_report,a.latest_update,a.feedback]),s.decisions,
 (s.review_questions||[]).filter(q=>q.report_id===s.latest_team_report).map(q=>[q.id,q.body,q.replies,(q.coordination_replies||[])])]);
export function deputyBusy(s,id,now=Date.now()){return (s.deputy_reviews||[]).some(b=>b.agent_id===id&&deputyLive(b,now));}

export function stopDeputy(s,reason,{pause=true}={}){
 if(!s.deputy?.enabled)return;
 s.deputy={...s.deputy,enabled:false,epoch:s.deputy.epoch+1,changed_at:new Date().toISOString(),reason};
 if(pause)s.paused=true;
 for(const b of s.deputy_reviews||[])if(!deputyTerminal.includes(b.status)){b.status='cancelled';b.reason=reason;delete b.delivery;}
 for(const q of s.review_questions||[])if(q.sender_kind==='deputy'&&!q.replies.length)q.delivery={status:'cancelled',updated_at:new Date().toISOString()};
 s.events.push({at:new Date().toISOString(),actor:'Director',text:'Deputy director off. '+reason});
}
export function setDeputy(s,p){
 if(typeof p.enabled!=='boolean')throw new Invalid('Choose whether the deputy is on or off.');
 if(p.expected_epoch!==(s.deputy?.epoch||0))throw new Invalid('Deputy settings changed. Refresh before saving.');
 if(p.enabled===!!s.deputy?.enabled)return s.deputy||{enabled:false,epoch:0};
 if(!p.enabled){stopDeputy(s,'The director turned it off. Project paused.');return s.deputy;}
 const a=orchestratorFor(s);
 if(!a||a.status==='closed')throw new Invalid('Assign an active project orchestrator first.');
 if(s.project.topic_status!=='confirmed')throw new Invalid('Confirm this project’s research topic first.');
 if(s.review_runner?.orchestrator_id!==a.id||!s.review_runner?.capabilities?.includes('deputy'))throw new Invalid('Connect a deputy-capable runner first.');
 s.deputy={enabled:true,epoch:(s.deputy?.epoch||0)+1,agent_id:a.id,changed_at:new Date().toISOString(),reason:'The director delegated report review, team questions, direction choices and the next action for this project.'};
 s.events.push({at:s.deputy.changed_at,actor:'Director',text:'Deputy director on for this project.'});
 return s.deputy;
}
function cancelStaleDeputy(s){
 for(const b of s.deputy_reviews||[])if(!deputyTerminal.includes(b.status)&&(b.epoch!==s.deputy?.epoch||b.report_id!==s.latest_team_report)){
  b.status='cancelled';b.reason='A newer report or authority setting replaced this review.';delete b.delivery;
  for(const q of s.review_questions||[])if(q.deputy_review_id===b.id&&!q.replies.length)q.delivery={status:'cancelled',updated_at:new Date().toISOString()};
 }
}
export function deputyPending(s,now=Date.now()){
 if(!s.deputy?.enabled||!s.latest_team_report)return false;
 const a=orchestratorFor(s),r=s.reports.find(x=>x.id===s.latest_team_report),w=s.agents.find(a=>a.id===r?.agent_id);
 if(!a||a.id!==s.deputy.agent_id||a.status==='closed'||!r||r.report_type!=='team'||!['awaiting_director','paused'].includes(w?.status))return false;
 const b=deputyCurrent(s);
 if(!b)return true;
 if(deputyTerminal.includes(b.status)||deputyLive(b,now))return false;
 if(b.status==='waiting')return b.question_ids.every(id=>{const q=s.review_questions.find(q=>q.id===id);return q?.replies.length||['failed','cancelled'].includes(q?.delivery?.status);})||Date.parse(b.wait_until)<=now;
 return !b.delivery?.retry_at||Date.parse(b.delivery.retry_at)<=now;
}
function deputyClaim(s,p,now){
 const b=(s.deputy_reviews||[]).find(b=>b.id===p.review_id);
 if(!s.deputy?.enabled||s.deputy.epoch!==b?.epoch||s.deputy.agent_id!==p.agent_id||b.agent_id!==p.agent_id||b.report_id!==s.latest_team_report||b.turn!==p.turn||b.delivery?.runner_id!==p.runner_id||b.delivery?.lease_id!==p.lease_id||!deputyLive(b,now))throw new Invalid('Deputy authority or this review claim is no longer current.');
 return b;
}
export function deputyAction(s,p,now=Date.now()){
 const stamp=new Date(now).toISOString();cancelStaleDeputy(s);
 if(p.action==='deputy_retry'){
  const b=deputyCurrent(s);
  if(!s.deputy?.enabled||b?.status!=='failed')throw new Invalid('Only an enabled deputy’s failed review can be retried.');
  b.status='queued';b.turn++;b.delivery={attempts:0};return b;
 }
 if(!s.deputy?.enabled||p.agent_id!==s.deputy.agent_id||s.review_runner?.orchestrator_id!==p.agent_id||s.review_runner.runner_id!==p.runner_id)throw new Invalid('Use the enabled project deputy’s registered connection.');
 if(p.action==='deputy_claim'){
  if(!deputyPending(s,now)||deputyBusy(s,p.agent_id,now))return null;
  if((s.coordination_batches||[]).some(x=>x.agent_id===p.agent_id&&x.delivery?.status==='answering'&&Date.parse(x.delivery.lease_until)>now))return null;
  if((s.review_questions||[]).some(q=>q.agent_id===p.agent_id&&!q.replies.length&&!['failed','cancelled'].includes(q.delivery?.status)))return null;
  // Give an unanswered human question on this report priority over a deputy decision.
  if((s.review_questions||[]).some(q=>q.report_id===s.latest_team_report&&q.sender_kind!=='deputy'&&!q.replies.length&&!['failed','cancelled'].includes(q.delivery?.status)))return null;
  let b=deputyCurrent(s);
  if(!b){b={id:'deputy-'+crypto.randomUUID(),agent_id:p.agent_id,report_id:s.latest_team_report,epoch:s.deputy.epoch,status:'queued',turn:1,consultation_rounds:0,question_ids:[],history:[],created_at:stamp,delivery:{attempts:0}};(s.deputy_reviews||=[]).push(b);}
  if(b.status==='waiting'){b.turn++;b.delivery={attempts:0};}
  const attempts=(b.delivery?.attempts||0)+1;
  if(attempts>2){b.status='failed';b.reason='Deputy review was interrupted. Try again when ready.';return null;}
  b.status='reviewing';b.snapshot=deputySnapshot(s);
  b.delivery={runner_id:p.runner_id,lease_id:crypto.randomUUID(),lease_until:new Date(now+120000).toISOString(),attempts};
  return {review_id:b.id,agent_id:b.agent_id,report_id:b.report_id,turn:b.turn,...b.delivery};
 }
 if(p.action==='deputy_complete'){
  const saved=(s.deputy_reviews||[]).find(b=>b.id===p.review_id&&b.epoch===s.deputy.epoch);
  if(saved?.history.some(h=>h.turn===p.turn))return {already_completed:true,review_id:saved.id};
 }
 const b=deputyClaim(s,p,now);
 if(p.action==='deputy_renew'){b.delivery.lease_until=new Date(now+120000).toISOString();return {ok:true};}
 if(p.action==='deputy_fail'){
  const retry=p.retryable===true&&b.delivery.attempts<2;
  b.status=retry?'queued':'failed';b.reason=p.error_code==='auth'?'Deputy needs a Codex sign-in or usage check.':'Deputy review could not finish. No decision was applied.';
  b.delivery={attempts:b.delivery.attempts,retry_at:retry?new Date(now+30000).toISOString():null};return b;
 }
 if(p.action!=='deputy_complete')throw new Invalid('Unknown deputy action.');
 if(b.snapshot!==deputySnapshot(s)){b.status='queued';b.turn++;b.delivery={attempts:0};b.reason='New input arrived. Reviewing it before deciding.';return {stale:true};}
 const result=p.result||{},summary=deputyText(result.summary,'a short decision summary',1000),reason=deputyText(result.reason,'the reason for this action');
 if(!['consult','continue','revise_report','keep_paused','close'].includes(result.action))throw new Invalid('Choose a supported deputy action.');
 if(!Array.isArray(result.choices)||!Array.isArray(result.questions))throw new Invalid('Provide direction choices and questions as lists.');
 let feedback;
 if(result.action==='consult'){
  if(result.choices.length||!result.questions.length||result.questions.length>3||b.consultation_rounds>=2)throw new Invalid('Ask up to three focused questions per round, with at most two discussion rounds.');
  const questions=result.questions.map(q=>{const a=agentFor(s,q.agent_id);if(a.id===b.agent_id||a.status==='closed'||!s.review_runner.agent_ids.includes(a.id))throw new Invalid('Ask a connected team member other than yourself.');return {agent_id:a.id,body:deputyText(q.body,'a focused team question',4000)};});
  b.question_ids=questions.map((q,i)=>askReviewQuestion(s,{...q,report_id:b.report_id,client_id:b.id+':'+b.turn+':'+i},{sender:b.agent_id,deputy_review_id:b.id}).id);
  b.consultation_rounds++;b.status='waiting';b.wait_until=new Date(now+600000).toISOString();
 }else{
  if(result.questions.length)throw new Invalid('Finish a discussion before issuing a decision.');
  const choices=result.choices.map(c=>({id:c.id,status:c.status}));
  for(const c of result.choices)deputyText(c.reason,'the reason for this direction label',1000);
  const authority={kind:'deputy',agent_id:b.agent_id,epoch:b.epoch,review_id:b.id};
  const actor=agentName(agentFor(s,b.agent_id),s.agents)+' · Deputy director';
  feedback=reviewTeamReport(s,{report_id:b.report_id,decision:result.action,comment:summary+'\n\n'+reason,choices},{actor,authority,allowStaleRevision:true});
  feedback.choice_reasons=structuredClone(result.choices);
  if(result.action==='continue')s.paused=false;
  b.status='decided';b.decision_id=feedback.id;
  b.next_action=result.action;b.decided_at=stamp;
  for(const q of s.review_questions||[])if(q.deputy_review_id===b.id&&!q.replies.length)q.delivery={status:'cancelled',updated_at:stamp};
 }
 b.summary=summary;b.reason=reason;b.history.push({turn:b.turn,at:stamp,...structuredClone(result),decision_id:feedback?.id||null});delete b.delivery;delete b.snapshot;
 s.events.push({at:stamp,actor:agentName(agentFor(s,b.agent_id),s.agents)+' · Deputy director',text:summary});
 return {review_id:b.id,status:b.status,decision_id:b.decision_id||null};
}
export function deputyContext(s,p){
 const b=deputyClaim(s,p,Date.now()),a=agentFor(s,b.agent_id),r=reportFor(s,b.report_id);
 return {project:s.project,direction:s.direction,paused:s.paused,deputy:s.deputy,report:r,research_map:s.research_map,
  agent:{id:a.id,name:agentName(a,s.agents),role:'deputy_director'},
  team:s.agents.map(a=>({id:a.id,name:agentName(a,s.agents),role:a.role,specialty:a.specialty,status:a.status,connected:s.review_runner.agent_ids.includes(a.id)})),
  decisions:s.decisions.slice(-20),requests:(s.requests||[]).filter(q=>q.status==='pending'),
  conversations:(s.review_questions||[]).filter(q=>q.report_id===r.id),
  review:{id:b.id,turn:b.turn,consultation_rounds:b.consultation_rounds,history:b.history,wait_until:b.wait_until},
  report_is_current:r.map_revision===(s.research_map?.revision||0)&&r.direction_revision===s.direction_revision&&r.contributors.every(c=>{const a=agentFor(s,c.agent_id);return c.snapshot===JSON.stringify([a.latest_update||null,a.latest_report||null,a.plan,a.prior_proposals||[],a.status==='closed']);})};
}
