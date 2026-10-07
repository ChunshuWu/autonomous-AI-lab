import {Invalid,agentFor,reportFor} from './logic.mjs';
import {reportAnchorExists} from './documents.mjs';
import {earlierReports} from './report-history.mjs';
import {orchestratorFor,recordExchange} from './orchestrator-inbox.mjs';
const chatText=(v,label,max=8000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Invalid(`Provide ${label}, up to ${max} characters.`);return v.trim();};
export const chatRecipients=(r,s)=>[...new Set([r.agent_id,...(r.contributors||[]).map(c=>c.agent_id),...(s&&orchestratorFor(s)?[orchestratorFor(s).id]:[])])];
function chatAnchor(s,r,anchor){
 if(!anchor)return null;
 if(typeof anchor!=='string'||!/^(slide-[1-9][0-9]{0,3}|section-(background|progress|next-steps))$/.test(anchor)||!reportAnchorExists({...r,earlier_reports:earlierReports(s,r)},anchor))throw new Invalid('Choose an existing section in this report.');
 return anchor;
}
export function reviewQuestions(s,p){
 if(p.report_id)reportFor(s,p.report_id);
 if(p.agent_id)agentFor(s,p.agent_id);
 return (s.review_questions||[]).filter(q=>(!p.report_id||q.report_id===p.report_id)&&(!p.agent_id||q.agent_id===p.agent_id)&&(!p.pending_only||!q.replies.length));
}
export function askReviewQuestion(s,p,{sender=null,deputy_review_id=null}={}){
 const r=reportFor(s,p.report_id),a=agentFor(s,p.agent_id);
 if(!sender&&!chatRecipients(r,s).includes(a.id))throw new Invalid('Choose the writer, a contributor, or the project orchestrator.');
 const body=chatText(p.body,'a question'),key=chatText(p.client_id,'a message ID',160),slide_id=chatAnchor(s,r,p.slide_id);
 const old=(s.review_questions||[]).find(q=>q.client_id===key);
 if(old){if(old.report_id!==r.id||old.agent_id!==a.id||old.body!==body||old.slide_id!==slide_id)throw new Invalid('That message ID belongs to a different question.');return old;}
 const q={...(sender?{sender_kind:'deputy',sender_agent_id:sender,deputy_review_id}:{}),id:'question-'+crypto.randomUUID(),client_id:key,report_id:r.id,agent_id:a.id,body,slide_id,created_at:new Date().toISOString(),replies:[]};
 (s.review_questions||=[]).push(q);
 // Conversation has its own records: it never becomes a director decision,
 // changes a contributor snapshot, or releases work.
 return q;
}
export function replyReviewQuestion(s,p){
 const a=agentFor(s,p.agent_id),q=(s.review_questions||[]).find(q=>q.id===p.question_id);
 if(!q||q.report_id!==p.report_id)throw new Invalid('Choose a question on this report in this project.');
 if(q.agent_id!==a.id)throw new Invalid('Only the addressed agent can answer this question.');
 const body=chatText(p.body,'the answer'),key=chatText(p.client_id,'a reply ID',160);
 const refs=p.references||[];
 if(!Array.isArray(refs)||refs.length>12)throw new Invalid('Provide up to 12 report references.');
 const references=refs.map(ref=>{const r=reportFor(s,ref.report_id);return {report_id:r.id,title:r.title,slide_id:chatAnchor(s,r,ref.slide_id)};});
 const old=(s.review_questions||[]).flatMap(x=>x.replies).find(x=>x.client_id===key);
 if(old){if(old.question_id!==q.id||old.agent_id!==a.id||old.body!==body||JSON.stringify(old.references)!==JSON.stringify(references))throw new Invalid('That reply ID is already used.');return old;}
 const answer={id:'reply-'+crypto.randomUUID(),question_id:q.id,client_id:key,agent_id:a.id,body,references,created_at:new Date().toISOString()};
 recordExchange(s,q,answer,p);q.replies.push(answer);return answer;
}
