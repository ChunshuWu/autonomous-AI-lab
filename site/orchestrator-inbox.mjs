import {Invalid,agentFor,reportFor} from './logic.mjs';
import {agentName} from './identities.mjs';

export const attentionKinds=['routine','director_request','coordination','material_error','direction_change'];
export const orchestratorFor=s=>s.agents.find(a=>a.id===s.orchestrator_id)||s.agents.find(a=>a.role==='orchestrator');
const brief=(v,label,max)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Invalid('Provide '+label+' (up to '+max+' characters).');return v.trim();};
const excerpt=(v,n)=>String(v||'').replace(/\s+/g,' ').trim().slice(0,n);
const inboxQuestion=(s,n)=>n.record_type?(s.record_questions||[]).find(q=>q.id===n.question_id):(s.review_questions||[]).find(q=>q.id===n.question_id);
const inboxRecord=(s,n)=>n.record_type?inboxQuestion(s,n)?.record_snapshot:reportFor(s,n.report_id);
const coordLive=(b,now)=>b.delivery?.status==='answering'&&Date.parse(b.delivery.lease_until)>now;
export const coordinatorBusy=(s,id,now=Date.now())=>(s.coordination_batches||[]).some(b=>b.agent_id===id&&coordLive(b,now))||(s.deputy_reviews||[]).some(b=>b.agent_id===id&&b.status==='reviewing'&&Date.parse(b.delivery?.lease_until)>now);

export function recordExchange(s,q,reply,meta={}){
 if(q.sender_kind==='deputy')return null; // The deputy receives this discussion in its own review.
 const id='notice-'+reply.id,old=(s.orchestrator_inbox||[]).find(n=>n.id===id);if(old)return old;
 const kind=meta.attention_kind||'routine';if(!attentionKinds.includes(kind))throw new Invalid('Choose a supported attention reason.');
 const summary=meta.summary?brief(meta.summary,'a short exchange summary',1000):excerpt(reply.body,800);
 const reason=kind==='routine'?'':brief(meta.attention_reason,'the reason to wake the orchestrator',500);
 const coordinator=orchestratorFor(s),own=coordinator?.id===reply.agent_id;
 const n={id,question_id:q.id,reply_id:reply.id,report_id:q.report_id,slide_id:q.slide_id,from_agent_id:reply.agent_id,
  question_excerpt:excerpt(q.body,350),summary,summary_kind:meta.summary?'summary':'excerpt',
  attention_kind:own?'routine':kind,attention_reason:own?'':reason,created_at:new Date().toISOString(),
  reviewed_at:own?new Date().toISOString():null,reviewed_by:own?coordinator.id:null};
 (s.orchestrator_inbox||=[]).push(n);return n;
}
export function backfillExchanges(s){
 // Old/manual answers leave labeled excerpts. Never guess a historical escalation.
 for(const q of s.review_questions||[])for(const r of q.replies)recordExchange(s,q,r);
}
export function readOrchestratorInbox(s,p={}){
 return (s.orchestrator_inbox||[]).filter(n=>(!p.unread_only||!n.reviewed_at)&&(!p.report_id||n.report_id===p.report_id));
}
export function ackOrchestratorInbox(s,p){
 const a=orchestratorFor(s);if(!a||p.agent_id!==a.id)throw new Invalid('Only the project orchestrator acknowledges its inbox.');
 if(!Array.isArray(p.notice_ids)||p.notice_ids.length>100)throw new Invalid('Choose up to 100 notices.');
 const notes=p.notice_ids.map(id=>{const n=(s.orchestrator_inbox||[]).find(n=>n.id===id);if(!n)throw new Invalid('Choose notices from this project.');return n;});
 if(notes.some(n=>n.batch_id&&(s.coordination_batches||[]).some(b=>b.id===n.batch_id&&b.delivery.status!=='answered')))throw new Invalid('This notice is assigned to an automatic review.');
 for(const n of notes){n.reviewed_at||=new Date().toISOString();n.reviewed_by=a.id;}
 return notes;
}
export function coordinationPending(s,now=Date.now()){
 const retry=(s.coordination_batches||[]).some(b=>!['answered','failed'].includes(b.delivery.status)&&!coordLive(b,now)&&(!b.delivery.retry_at||Date.parse(b.delivery.retry_at)<=now));
 // Briefly collect nearby escalations; ordinary notices never start a model turn.
 const fresh=(s.orchestrator_inbox||[]).some(n=>!n.reviewed_at&&!n.batch_id&&n.attention_kind!=='routine'&&Date.parse(n.created_at)+15000<=now);
 return retry||fresh;
}
function coordBatch(s,p,now){
 const b=(s.coordination_batches||[]).find(b=>b.id===p.batch_id);
 if(!b||b.agent_id!==p.agent_id||b.delivery.runner_id!==p.runner_id||b.delivery.lease_id!==p.lease_id||!coordLive(b,now))throw new Invalid('This orchestrator claim expired or belongs to another worker.');
 return b;
}
export function coordinationAction(s,p,now=Date.now()){
 const stamp=new Date(now).toISOString(),a=orchestratorFor(s);
 if(!a)throw new Invalid('Connect this project’s orchestrator first.');
 if(p.action==='coord_retry'){
  const b=(s.coordination_batches||[]).find(b=>b.id===p.batch_id);
  if(!b||b.delivery.status!=='failed')throw new Invalid('Choose a failed orchestrator review.');
  b.delivery={status:'queued',attempts:0,updated_at:stamp};return b;
 }
 if(p.agent_id!==a.id||s.review_runner?.orchestrator_id!==a.id||s.review_runner.runner_id!==p.runner_id)throw new Invalid('Use the registered orchestrator connection.');
 if(p.action==='coord_claim'){
  if(coordinatorBusy(s,a.id,now)||(s.review_questions||[]).some(q=>q.agent_id===a.id&&coordLive(q,now)))return null;
  // Prefer direct human questions before background inbox work.
  if((s.review_questions||[]).some(q=>q.agent_id===a.id&&!q.replies.length&&q.delivery?.status!=='failed'))return null;
  let b=(s.coordination_batches||[]).find(b=>!['answered','failed'].includes(b.delivery.status)&&(!b.delivery.retry_at||Date.parse(b.delivery.retry_at)<=now));
  if(!b){
   if(!coordinationPending(s,now))return null;
   const attention=[],reports=new Set();let size=0;
   for(const n of (s.orchestrator_inbox||[]).filter(n=>!n.reviewed_at&&!n.batch_id&&n.attention_kind!=='routine').slice(0,8)){
    const q=inboxQuestion(s,n),weight=JSON.stringify(q).length+(reports.has(n.report_id||n.record_id)?0:JSON.stringify(inboxRecord(s,n)).length);
    if(attention.length&&size+weight>110000)break;
    attention.push(n);reports.add(n.report_id||n.record_id);size+=weight;
   }
   if(!attention.length)return null;
   const routine=(s.orchestrator_inbox||[]).filter(n=>!n.reviewed_at&&!n.batch_id&&n.attention_kind==='routine').slice(0,20);
   b={id:'coord-'+crypto.randomUUID(),agent_id:a.id,notice_ids:[...attention,...routine].map(n=>n.id),attention_ids:attention.map(n=>n.id),created_at:stamp,delivery:{attempts:0}};
   (s.coordination_batches||=[]).push(b);
   for(const n of [...attention,...routine])n.batch_id=b.id;
  }
  const attempts=(b.delivery.attempts||0)+1;
  if(attempts>2){b.delivery={...b.delivery,status:'failed',error:'Orchestrator review interrupted. You can try again.',updated_at:stamp};return null;}
  b.delivery={status:'answering',runner_id:p.runner_id,lease_id:crypto.randomUUID(),lease_until:new Date(now+120000).toISOString(),attempts,updated_at:stamp};
  return {batch_id:b.id,agent_id:a.id,...b.delivery};
 }
 if(p.action==='coord_complete'){
  const saved=(s.coordination_batches||[]).find(b=>b.id===p.batch_id&&b.agent_id===a.id);
  if(saved?.delivery.status==='answered')return {already_answered:true,batch_id:saved.id};
  const b=coordBatch(s,p,now);
  if(!Array.isArray(p.messages)||p.messages.length!==b.attention_ids.length||new Set(p.messages.map(m=>m.notice_id)).size!==b.attention_ids.length)throw new Invalid('Reply once to each flagged notice.');
  const messages=p.messages.map(m=>{
   if(!b.attention_ids.includes(m.notice_id))throw new Invalid('Reply only to this review’s flagged notices.');
   const n=s.orchestrator_inbox.find(n=>n.id===m.notice_id),q=inboxQuestion(s,n);
   return {q,n,body:brief(m.body,'the orchestrator reply',7000)};
  });
  b.summary=brief(p.summary,'the review summary',1000);
  for(const {q,n,body} of messages){
   const reply={id:'coord-reply-'+crypto.randomUUID(),batch_id:b.id,notice_id:n.id,agent_id:a.id,body,created_at:stamp,references:n.record_type?[{record_type:n.record_type,record_id:n.record_id,title:q.record_snapshot.title}]:[{report_id:q.report_id,title:reportFor(s,q.report_id).title,slide_id:q.slide_id}]};
   if(n.record_type)(q.replies||=[]).push(reply);else (q.coordination_replies||=[]).push(reply);
  }
  for(const n of s.orchestrator_inbox.filter(n=>b.notice_ids.includes(n.id))){n.reviewed_at=stamp;n.reviewed_by=a.id;}
  b.delivery={status:'answered',attempts:b.delivery.attempts,updated_at:stamp};return {batch_id:b.id,reviewed:b.notice_ids.length};
 }
 const b=coordBatch(s,p,now);
 if(p.action==='coord_renew'){b.delivery.lease_until=new Date(now+120000).toISOString();return {ok:true};}
 if(p.action==='coord_fail'){
  const again=p.retryable===true&&b.delivery.attempts<2;
  b.delivery={status:again?'queued':'failed',attempts:b.delivery.attempts,error:p.error_code==='auth'?'Orchestrator reply needs a Codex sign-in or usage check.':'The orchestrator reply could not be completed.',retry_at:again?new Date(now+30000).toISOString():null,updated_at:stamp};return b.delivery;
 }
 throw new Invalid('Unknown orchestrator review action.');
}
export function coordinationContext(s,p){
 const b=coordBatch(s,p,Date.now()),a=agentFor(s,b.agent_id);
 const notices=s.orchestrator_inbox.filter(n=>b.notice_ids.includes(n.id));
 return {project:s.project,paused:s.paused,direction:s.direction,research_map:s.research_map,
  agent:{id:a.id,name:agentName(a,s.agents),role:'orchestrator',specialty:a.specialty,status:a.status},
  batch_id:b.id,attention_ids:b.attention_ids,notices,
  exchanges:notices.filter(n=>b.attention_ids.includes(n.id)).map(n=>({notice_id:n.id,question:inboxQuestion(s,n),report:n.record_type?{...inboxRecord(s,n),id:'record:'+n.record_type+':'+n.record_id,record_id:n.record_id,context_type:n.record_type}:inboxRecord(s,n)}))};
}
