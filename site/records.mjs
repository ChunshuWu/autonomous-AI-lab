import {Invalid,agentFor,validateVisual} from './logic.mjs';
import {presentation} from './presentations.mjs';

const recordTypes=['experiment','meeting','method'];
const recordStates=['unexplored','active','explored','discarded'];
// Complete saved evidence has no writing-length cutoff. Explicit compact labels keep their own limits.
const recText=(v,label,max=Infinity)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Invalid('Provide '+label+'.');return v.trim();};
const recList=(v,label)=>{if(!Array.isArray(v)||v.length>200)throw new Invalid('Provide a list of '+label+'.');return v;};
const recId=v=>{if(typeof v!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(v))throw new Invalid('Use a stable record ID.');return v;};
export const projectRecords=s=>s.research_records||{experiment:[],meeting:[],method:[]};
export function researchRecord(s,type,id){const r=projectRecords(s)[type]?.find(r=>r.id===id);if(!r)throw new Invalid('Unknown record in this project.');return r;}
function recordLinks(s,r){
 for(const id of r.proposal_ids||[])if(!s.research_map?.nodes.some(n=>n.id===id))throw new Invalid('Link proposals from this project.');
 for(const id of r.report_ids||[])if(!s.reports.some(n=>n.id===id))throw new Invalid('Link reports from this project.');
 for(const type of ['experiment','meeting','method'])for(const id of r[type+'_ids']||[])researchRecord(s,type,id);
 for(const id of r.participant_ids||[])agentFor(s,id);
 if(r.owner_id)agentFor(s,r.owner_id);
}
export function upsertRecord(s,p){
 if(!recordTypes.includes(p.type))throw new Invalid('Choose experiment, meeting, or method.');
 const a=agentFor(s,p.agent_id);if(a.dismissal)throw new Invalid('A dismissed agent cannot add records.');
 const input=p.record;if(!input||typeof input!=='object'||Array.isArray(input))throw new Invalid('Provide a record.');
 recId(input.id);
 const old=projectRecords(s)[p.type].find(r=>r.id===input.id);
 if(p.expected_revision!==(old?.revision||0))throw new Invalid('This record changed. Reload it before saving.');
 if(old&&old.owner_id!==a.id&&a.id!==s.orchestrator_id&&a.role!=='orchestrator')throw new Invalid('The owner or orchestrator updates this record.');
 const r=old?structuredClone(old):{id:input.id,type:p.type,owner_id:a.id,created_at:new Date().toISOString(),history:[]};
 const fields=['title','summary','purpose','prediction','setup','baseline','data','code_version','settings','measures','budget','results','interpretation','uncertainty','next_step','cost','error','stage','round','decision','decision_reason','notes','selected_proposal_id','recovery_attempts','remaining_obstacle'];
 for(const key of fields)if(Object.hasOwn(input,key)){if(typeof input[key]!=='string')throw new Invalid('Use text for '+key+'.');r[key]=input[key];}
 r.title=recText(r.title,'a short title',240);r.summary=recText(r.summary,'a short summary',3000);
 if(Object.hasOwn(input,'presentation'))r.presentation=presentation(input.presentation);
 if(Object.hasOwn(input,'presentations'))r.presentations=recList(input.presentations,'candidate presentations').map(row=>({id:recId(row.id),title:recText(row.title,'a candidate title',240),task_id:row.task_id?recId(row.task_id):null,agent_id:row.agent_id?agentFor(s,row.agent_id).id:null,presentation:presentation(row.presentation)}));
 for(const key of ['proposal_ids','report_ids','experiment_ids','meeting_ids','method_ids','library_ids','participant_ids'])if(Object.hasOwn(input,key))r[key]=recList(input[key],key).map(recId);
 for(const key of ['evidence','suggestions','objections','actions','votes','figures'])if(Object.hasOwn(input,key))r[key]=structuredClone(recList(input[key],key));
 for(const e of r.evidence||[]){recText(e.note,'an evidence description');recText(e.source,'an evidence location');}
 for(const f of r.figures||[]){validateVisual(f);recText(f.caption,'a plain-language figure caption');}
 for(const row of r.suggestions||[]){agentFor(s,row.agent_id);recText(row.text,'a suggestion');if(row.summary!==undefined)recText(row.summary,'a contribution summary');if(row.task_id!==undefined&&!s.tasks?.some(t=>t.id===row.task_id&&t.agent_id===row.agent_id&&t.result))throw new Invalid('Link the contributor’s saved task.');}
 for(const row of r.objections||[]){recText(row.text,'an objection');if(row.agent_id)agentFor(s,row.agent_id);}
 for(const row of r.actions||[]){recText(row.task,'a next action');agentFor(s,row.owner_id);}
 for(const row of r.votes||[]){agentFor(s,row.agent_id);recText(row.choice,'a vote');recText(row.reason,'a voting reason');if(row.reason_summary!==undefined)recText(row.reason_summary,'a brief voting reason');}
 if(p.type==='experiment'){
  r.status=input.status??r.status??'planned';
  if(!['planned','running','completed','failed','stopped'].includes(r.status))throw new Invalid('Choose an experiment status.');
  recText(r.purpose,'the experiment purpose');recText(r.setup,'the experiment setup');
  if(r.status==='completed')recText(r.results,'the recorded results');
  if(r.status==='failed')recText(r.error,'the experiment failure');
  for(const [field,values] of [['execution_outcome',['complete','partial','blocked']],['scientific_outcome',['not_tested','inconclusive','positive','negative']]])if(Object.hasOwn(input,field)){
   if(!values.includes(input[field]))throw new Invalid('Choose a valid '+field.replaceAll('_',' ')+'.');r[field]=input[field];
  }
  if(r.execution_outcome==='complete'&&r.status!=='completed')throw new Invalid('A complete experiment has completed execution status.');
  if(r.scientific_outcome==='positive'&&(r.status!=='completed'||r.execution_outcome!=='complete'))throw new Invalid('A positive scientific outcome requires a completed experiment with recorded results.');
 }
 if(p.type==='meeting'){
  if(input.status!==undefined&&input.status!=='completed')throw new Invalid('Publish a summary after the meeting.');
  if(r.selected_proposal_id&&!r.proposal_ids?.includes(r.selected_proposal_id))throw new Invalid('Link the selected proposal in this meeting.');
  r.status='completed';recText(r.purpose,'the meeting purpose');
  if(!r.participant_ids?.length)throw new Invalid('Name the meeting participants.');
  if((r.votes||[]).some(v=>!r.participant_ids.includes(v.agent_id)))throw new Invalid('Voters must be meeting participants.');
  if(new Set((r.votes||[]).map(v=>v.agent_id)).size!==(r.votes||[]).length)throw new Invalid('Record each participant’s vote once per meeting round.');
  if(r.votes?.length&&input.votes_revealed!==true&&!r.votes_revealed)throw new Invalid('Publish votes only after their reveal.');
  if(r.votes?.length)r.votes_revealed=true;
 }
 if(p.type==='method'){
  if(input.status!==undefined&&input.status!==(old?.status||'unexplored'))throw new Invalid('Use a recorded decision to change method status.');
  r.status=old?.status||'unexplored';
  if(r.proposal_ids?.length!==1)throw new Invalid('Link the method to one proposal.');
 }
 if(input.occurred_at!==undefined){if(!Number.isFinite(Date.parse(input.occurred_at)))throw new Invalid('Provide the actual event time.');r.occurred_at=new Date(input.occurred_at).toISOString();}
 recordLinks(s,r);
 for(const row of r.presentations||[]){if(![...(r.proposal_ids||[]),...(r.method_ids||[])].includes(row.id))throw new Invalid('Link each presented candidate to this meeting.');if(row.task_id&&!s.tasks?.some(t=>t.id===row.task_id&&t.result))throw new Invalid('Link a saved candidate document.');}
 if(old){const {history,...snapshot}=old;r.history.push(snapshot);}
 r.revision=(old?.revision||0)+1;r.updated_at=new Date().toISOString();r.updated_by=a.id;
 s.research_records||={experiment:[],meeting:[],method:[]};
 const list=s.research_records[p.type],index=list.findIndex(x=>x.id===r.id);if(index<0)list.push(r);else list[index]=r;
 (s.events||=[]).push({id:'record-'+p.type+'-'+r.id+'-'+r.revision,at:r.updated_at,actor:a.name,agent_id:a.id,kind:p.type,text:(old?'Updated: ':'Recorded: ')+r.title,record_ref:{type:p.type,id:r.id}});
 return r;
}
export function decideMethod(s,p){
 const r=researchRecord(s,'method',p.id);
 if(p.expected_revision!==r.revision)throw new Invalid('The method changed. Reload before choosing.');
 if(!recordStates.includes(p.status))throw new Invalid('Choose a valid method status.');
 const reason=recText(p.reason,'the decision reason');
 if(p.status==='active'){
  if(!r.proposal_ids.some(id=>s.research_map?.nodes.some(n=>n.id===id&&n.status==='under_exploration')))throw new Invalid('Select this method’s proposal as the active direction first.');
  if(projectRecords(s).method.some(n=>n.id!==r.id&&n.status==='active'))throw new Invalid('Finish or set aside the current active method first.');
 }
 if(p.status==='explored'&&!r.experiment_ids?.length&&!r.evidence?.length&&!r.report_ids?.length)throw new Invalid('Link the findings before marking a method explored.');
 const {history,...prior}=r;r.history.push(structuredClone(prior));
 r.status=p.status;r.decision_reason=reason;r.revision++;r.updated_at=new Date().toISOString();r.updated_by='Director';
 (s.events||=[]).push({id:'method-choice-'+r.id+'-'+r.revision,at:r.updated_at,actor:'Director',kind:'decision',text:r.title+': '+p.status+'. '+reason,record_ref:{type:'method',id:r.id}});
 return r;
}

export function normalizeLibraryItem(input,old,actor,projectIds){
 recId(input.id);
 const r={...old,id:input.id};
 for(const key of ['title','summary','source','path','version','availability','reading','checks','notes','acquired_by'])if(Object.hasOwn(input,key)){if(typeof input[key]!=='string'||input[key].length>30000)throw new Invalid('Use text for '+key+'.');r[key]=input[key];}
 r.title=recText(r.title,'a library title',500);r.summary=recText(r.summary,'a library summary',4000);
 r.kind=input.kind??r.kind??'paper';if(!['paper','dataset','baseline','tool','notes'].includes(r.kind))throw new Invalid('Choose a library category.');
 for(const key of ['topics','project_ids','read_by'])if(Object.hasOwn(input,key))r[key]=recList(input[key],key).map(v=>recText(v,key,300));
 for(const id of r.project_ids||[])if(!projectIds.includes(id))throw new Invalid('Choose an existing project for this library item.');
 if(Object.hasOwn(input,'links'))r.links=recList(input.links,'links').map(v=>({label:recText(v.label,'a link label',300),source:recText(v.source,'a link location',2000)}));
 if(!r.source&&!r.path&&!r.links?.length)throw new Invalid('Provide a source or file location.');
 r.created_at=old?.created_at||new Date().toISOString();r.updated_at=new Date().toISOString();r.updated_by=actor;r.revision=(old?.revision||0)+1;
 r.history=old?[...(old.history||[]),Object.fromEntries(Object.entries(old).filter(([k])=>k!=='history'))]:[];
 return r;
}

export function askRecordQuestion(s,p,record){
 recId(p.client_id);const body=recText(p.body,'your question',7000),old=(s.record_questions||[]).find(q=>q.client_id===p.client_id);
 if(old){if(old.body!==body||old.record_type!==p.record_type||old.record_id!==p.record_id||(p.agent_id&&p.agent_id!==old.agent_id)||((p.candidate_id||null)!==(old.candidate_id||null)))throw new Invalid('This question ID was already used.');return old;}
 const coordinator=s.agents.find(a=>a.id===s.orchestrator_id)||s.agents.find(a=>a.role==='orchestrator');
 if(!coordinator)throw new Invalid('This project needs an orchestrator to route questions.');
 let recipient=coordinator,candidate=null;
 if(p.candidate_id){if(p.record_type!=='meeting')throw new Invalid('Choose a candidate in this meeting.');candidate=record.presentations?.find(c=>c.id===p.candidate_id);const owner=candidate&&(candidate.agent_id||s.tasks?.find(t=>t.id===candidate.task_id)?.agent_id);if(!owner||p.agent_id!==owner)throw new Invalid('Ask the researcher who prepared this candidate.');recipient=agentFor(s,owner);if(recipient.dismissal)throw new Invalid('This researcher has left the project. Ask the orchestrator.');}
 else if(p.agent_id&&p.agent_id!==coordinator.id)throw new Invalid('Choose a candidate to ask its researcher.');
 const snapshot=candidate?{id:record.id,title:record.title,candidate,document:s.tasks?.find(t=>t.id===candidate.task_id)?.result?.document,discussion:(record.suggestions||[]),votes:record.votes,decision:record.decision,thread:(s.record_questions||[]).filter(q=>q.record_type===p.record_type&&q.record_id===p.record_id&&q.candidate_id===p.candidate_id).map(q=>({question:q.body,replies:q.replies}))}:record;
 const now=new Date().toISOString(),q={id:'record-question-'+crypto.randomUUID(),client_id:p.client_id,record_type:p.record_type,record_id:p.record_id,agent_id:recipient.id,candidate_id:p.candidate_id||null,body,created_at:now,replies:[],record_snapshot:structuredClone(snapshot)};
 (s.record_questions||=[]).push(q);
 (s.orchestrator_inbox||=[]).push({id:'notice-'+q.id,question_id:q.id,record_type:p.record_type,record_id:p.record_id,question_excerpt:body.slice(0,350),summary:record.title,summary_kind:'summary',attention_kind:'director_request',attention_reason:'The director asked about '+record.title,created_at:now,reviewed_at:recipient.id===coordinator.id?null:now,reviewed_by:recipient.id===coordinator.id?null:'Routed to the candidate author'});
 (s.events||=[]).push({id:q.id,at:now,actor:'Director',kind:'question',text:body,record_ref:{type:p.record_type,id:p.record_id}});
 return q;
}
export function replyRecordQuestion(s,p){
 const a=agentFor(s,p.agent_id),q=(s.record_questions||[]).find(q=>q.id===p.question_id);
 if(!q||q.agent_id!==a.id)throw new Invalid('The addressed agent answers this question.');
 if((s.coordination_batches||[]).some(b=>b.delivery?.status==='answering'&&Date.parse(b.delivery.lease_until)>Date.now()&&b.attention_ids.includes('notice-'+q.id)))throw new Invalid('An automatic reply is already in progress.');
 const body=recText(p.body,'the reply',7000);recId(p.client_id);
 const old=q.replies.find(r=>r.client_id===p.client_id);if(old){if(old.body!==body)throw new Invalid('This reply ID was already used.');return old;}
 const reply={id:'record-reply-'+crypto.randomUUID(),client_id:p.client_id,agent_id:a.id,body,created_at:new Date().toISOString()};q.replies.push(reply);
 const note=s.orchestrator_inbox.find(n=>n.question_id===q.id);if(note){note.reviewed_at=reply.created_at;note.reviewed_by=a.id;}
 return reply;
}
