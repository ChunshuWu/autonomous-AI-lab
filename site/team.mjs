import {Invalid, agentFor, reportFor, validateReport, validateProgress} from './logic.mjs';
import {directionMap,directionNode,decideDirections,attachDirectionReport} from './directions.mjs';
import {validateEarlierReports,earlierReports} from './report-history.mjs';
import {reportLifecycle} from './report-lifecycle.mjs';
const teamText=(v,label)=>{if(typeof v!=='string'||!v.trim()||v.length>12000)throw new Invalid('Provide '+label+'.');return v.trim();};
const teamCopy=x=>structuredClone(x);
const teamId=p=>p+'-'+crypto.randomUUID();
const teamEvent=(s,actor,text)=>s.events.push({at:new Date().toISOString(),actor,text});
export const teamMode=s=>s.reporting_mode==='team'||s.agents.some(a=>a.role==='writer');
const writerFor=(s,key)=>{const w=agentFor(s,key);if(w.role!=='writer'||w.status==='closed')throw new Invalid('Choose this project’s active writer.');return w;};
const contributorSnapshot=a=>JSON.stringify([a.latest_update||null,a.latest_report||null,a.plan,a.prior_proposals||[],a.status==='closed']);
export function submitUpdate(s,p,{preserve_agents=[]}={}){
 const a=agentFor(s,p.agent_id);if(a.status==='closed'||a.role==='writer')throw new Invalid('Only open research and support tasks submit findings.');
 const u=teamCopy(p.update||{});teamText(u.summary,'a short findings summary');
 if(!Array.isArray(u.evidence)||!u.evidence.length)throw new Invalid('Link the written findings or evidence.');
 for(const e of u.evidence){teamText(e.note,'an evidence note');teamText(e.source,'an evidence source');}
 validateProgress(u.previous_steps,a);
 for(const key of u.direction_ids||[])directionNode(s,key);
 u.id=teamId('update');u.agent_id=a.id;u.created_at=new Date().toISOString();
 (s.research_updates||=[]).push(u);a.latest_update=u.id;Object.assign(a,{status:'awaiting_writer',feedback:null});
 // New evidence withdraws unclaimed permission from a superseded combined review.
 const old=s.latest_team_report?s.reports.find(r=>r.id===s.latest_team_report):null;
 if(old?.contributors.some(c=>c.agent_id===a.id))for(const c of old.contributors){const other=agentFor(s,c.agent_id);if(other.status!=='closed'&&!preserve_agents.includes(other.id))Object.assign(other,{status:other.id===a.id?'awaiting_writer':'paused',feedback:null});}
 teamEvent(s,a.name,'Sent findings to the writer and paused affected work.');return u;
}
export function submitTeamReport(s,p){
 const writer=writerFor(s,p.agent_id),r=teamCopy(p.report||{}),map=directionMap(s);
 if(r.map_revision!==map.revision)throw new Invalid('Read the current research map before preparing the report.');
 if(!Array.isArray(r.contributors)||!r.contributors.length)throw new Invalid('Name the contributors covered by this report.');
 if(new Set(r.contributors.map(c=>c.agent_id)).size!==r.contributors.length)throw new Invalid('List each contributor once.');
 const previous=[],next=[],plans=[];
 for(const c of r.contributors){
  const a=agentFor(s,c.agent_id);if(a.role==='writer')throw new Invalid('The writer summarizes research contributions, not its own research.');
  if(c.update_id!== (a.latest_update||null)||c.report_id!== (a.latest_report||null))throw new Invalid('A contributor has newer findings or reports. Read the current records.');
  if(!c.update_id&&!c.report_id)throw new Invalid('Each contributor needs saved findings or a historical report.');
  validateProgress(c.previous_steps,a);
  for(const step of c.previous_steps){previous.push({...step,id:a.id+'::'+step.id,agent_id:a.id,task:a.name+': '+step.task,display_task:a.name+': '+(step.display_task||step.task)});plans.push({id:a.id+'::'+step.id,task:a.name+': '+step.task});}
  if(!Array.isArray(c.next_steps))throw new Invalid('List proposed steps for each contributor.');
  if(a.status==='closed'&&c.next_steps.length)throw new Invalid('Do not propose a restart for a stopped contributor.');
  if(new Set(c.next_steps.map(n=>n.id)).size!==c.next_steps.length)throw new Invalid('Use unique proposal IDs for each contributor.');
  for(const step of c.next_steps){
   teamText(step.id,'a next-step ID');directionNode(s,step.direction_id);
   next.push({...step,id:a.id+'::'+step.id,source_step_id:step.id,agent_id:a.id,task:step.task});
  }
  c.snapshot=contributorSnapshot(a);c.name=a.name;c.closed=a.status==='closed';
 }
 const entries=r.directions;if(!Array.isArray(entries)||!entries.length||new Set(entries.map(d=>d.id)).size!==entries.length)throw new Invalid('Explain the brainstormed directions in the report.');
 for(const d of entries){const node=directionNode(s,d.id);d.title=node.title;d.status=node.status;d.parent_id=node.parent_id;teamText(d.summary,'a direction explanation');teamText(d.reason,'why this direction is worth pursuing or deferring');}
 if(next.some(step=>!entries.some(d=>d.id===step.direction_id)))throw new Invalid('Explain every proposed next-step direction in the report.');
 r.previous_steps=previous;r.next_steps=next;r.kind=r.kind||'Team research update';
 validateReport(r,{plan:plans,prior_proposals:[],report_only_closed:true});
 // Keep the original released/proposed distinction; the validation facade above
 // is only for shared report content and must not relabel unrun proposals.
 r.previous_steps=previous.map((step,i)=>({...step,released:r.contributors.flatMap(c=>c.previous_steps)[i].released}));
 const supersedes=r.supersedes_request_ids||[];if(!Array.isArray(supersedes)||supersedes.some(id=>!(s.requests||[]).some(q=>q.id===id&&(q.status==='pending'||(q.status==='superseded'&&q.superseded_by_report===s.latest_team_report)))))throw new Invalid('Only pending requests or those already covered by the latest team report can move into this report.');
 const prior=s.latest_team_report?reportFor(s,s.latest_team_report):null;
 if(r.report_kind!==undefined&&!['progress','correction'].includes(r.report_kind))throw new Invalid('Choose progress for a new round or correction for the same report.');
 if(r.report_kind==='progress'&&r.revision_of)throw new Invalid('A new round must be a new report. Link earlier work with previous_reports.');
 if(!r.revision_of&&r.report_kind!=='progress'&&writer.status==='revising_report'&&prior)r.revision_of=prior.id;
 if(r.report_kind==='correction'&&!r.revision_of)throw new Invalid('Name the report being corrected with revision_of.');
 validateEarlierReports(s,r);
 const revised=r.revision_of?reportFor(s,r.revision_of):null;
 if(revised){
  const last=[...s.decisions].reverse().find(d=>d.report_id===revised.id&&['continue','revise_report','keep_paused','close'].includes(d.decision));
  if(last?.decision==='continue')throw new Invalid('The previous report already started another round. Submit a new progress report.');
  const previousRound=revised.research_round_id||revised.progress_id||revised.id;
  if(r.research_round_id&&r.research_round_id!==previousRound)throw new Invalid('A correction must belong to the same research round.');
  r.research_round_id=previousRound;
 }else{
  if(r.research_round_id!==undefined)teamText(r.research_round_id,'a research round ID');
  if(r.research_round_id&&s.reports.some(x=>x.research_round_id===r.research_round_id))throw new Invalid('This round already has a report. Use an explicit correction, or a new round ID.');
  r.research_round_id=r.research_round_id||teamId('research-round');
 }
 r.report_kind=revised?'correction':'progress';
 delete r.progress_id;
 Object.assign(r,{id:teamId('report'),report_type:'team',version:prior?prior.version+1:1,agent_id:writer.id,agent_name:writer.name,created_at:new Date().toISOString(),project_name:s.name,example:s.mode==='example',previous_report:prior?.id||null,direction_revision:s.direction_revision});
 r.progress_id=revised?(revised.progress_id||revised.id):r.id;
 r.progress_version=revised?(revised.progress_version||1)+1:1;
 r.workspace_id=s.project.id;r.previous_reports=earlierReports(s,r);
 s.reports.push(r);s.latest_team_report=r.id;s.reporting_mode='team';
 for(const id of supersedes){const q=s.requests.find(q=>q.id===id);q.status='superseded';q.superseded_by_report=r.id;q.revision++;q.updated_at=r.created_at;}
 Object.assign(writer,{latest_report:r.id,status:'awaiting_director',feedback:null});
 for(const c of r.contributors){const a=agentFor(s,c.agent_id);if(!c.closed)Object.assign(a,{status:'awaiting_director',feedback:null,team_report_id:r.id});}
 attachDirectionReport(s,entries.map(d=>d.id),r);
 for(const n of s.notifications)if(n.team_report||r.contributors.some(c=>c.agent_id===n.agent_id))n.read=true;
 s.notifications.push({id:teamId('notice'),agent_id:writer.id,report_id:r.id,team_report:true,created_at:r.created_at,read:false,text:'The writer’s team report is ready for your review.'});
 teamEvent(s,writer.name,'Submitted the combined team report. Affected research is paused.');return r;
}
export function reviewTeamReport(s,p,{actor="Director",authority=null,allowStaleRevision=false}={}){
 const r=reportFor(s,p.report_id);if(r.report_type!=='team')throw new Invalid('Choose a team report.');
 const comment=p.comment??'';
 if(typeof comment!=='string'||comment.length>12000)throw new Invalid('Comments must be text, up to 12000 characters.');
 if(!['continue','keep_paused','revise_report','close','comment'].includes(p.decision))throw new Invalid('Choose a review action.');
 if(p.decision==='comment'){const note={id:teamId('feedback'),kind:'team_review',report_id:r.id,at:new Date().toISOString(),decision:'comment',comment};s.decisions.push(note);return note;}
 if(r.id!==s.latest_team_report)throw new Invalid('Review the latest team report.');
 const writer=writerFor(s,r.agent_id);
 if(p.decision==='continue'&&reportLifecycle(s,r).status==='archived')throw new Invalid('This report is archived. Review a current report before approving new work.');
 if(!['awaiting_director','paused'].includes(writer.status))throw new Invalid('This report has already been reviewed.');
 const stale=r.map_revision!==directionMap(s).revision||r.direction_revision!==s.direction_revision||r.contributors.some(c=>c.snapshot!==contributorSnapshot(agentFor(s,c.agent_id)));
 if(stale&&!(allowStaleRevision&&p.decision==='revise_report'&&!(p.choices||[]).length))throw new Invalid('The report has changed. Ask the writer for an updated report.');
 const choices=p.choices||[];
 if(choices.length)decideDirections(s,{expected_revision:r.map_revision,choices,comment},{record:false,actor});
 const focus=directionMap(s).nodes.find(n=>n.status==='under_exploration');
 const steps=r.next_steps.filter(step=>step.direction_id===focus?.id);
 if(p.decision==='continue'&&(!focus||!steps.length))throw new Invalid('Choose one direction with proposed next steps to continue.');
 const feedback={id:teamId('feedback'),kind:'team_review',...(authority?{authority,actor}:{}),report_id:r.id,at:new Date().toISOString(),decision:p.decision,comment,answers:{},choices:teamCopy(choices),focus_id:focus?.id||null,map_revision:directionMap(s).revision,direction_revision:s.direction_revision};
 s.decisions.push(feedback);writer.feedback=teamCopy(feedback);writer.status=p.decision==='revise_report'?'revising_report':'paused';
 for(const c of r.contributors){
  const a=agentFor(s,c.agent_id);if(c.closed)continue;
  if(p.decision!=='keep_paused')a.prior_proposals=[...new Map([...(a.prior_proposals||[]),...c.next_steps].map(step=>[step.id,teamCopy(step)])).values()];
  const approved=c.next_steps.filter(step=>step.direction_id===focus?.id);
  Object.assign(a,{status:p.decision==='close'?'closed':'paused',feedback:null,team_report_id:r.id});
  if(p.decision==='continue'&&approved.length){a.feedback={...teamCopy(feedback),id:feedback.id+':'+a.id,approved_steps:teamCopy(approved)};a.status='feedback_received';a.research_direction=focus.id;}
 }
 // A keep-paused decision remains reviewable. A change to its map is captured
 // in the next report; it cannot silently approve the old proposal later.
 if(p.decision==='keep_paused')writer.status='awaiting_director';
 for(const n of s.notifications)if(n.report_id===r.id)n.read=p.decision!=='keep_paused';
 teamEvent(s,actor,'Reviewed the team report: '+p.decision.replaceAll('_',' ')+'.');return feedback;
}
export function acknowledgeTeam(s,p){
 const a=agentFor(s,p.agent_id),f=a.feedback;
 if(!f||f.kind!=='team_review'||f.decision!=='continue'||a.status!=='feedback_received'||f.id!==p.feedback_id)throw new Invalid('Read the current team decision first.');
 if(f.report_id!==s.latest_team_report||f.direction_revision!==s.direction_revision||directionNode(s,f.focus_id).status!=='under_exploration')throw new Invalid('The report or selected direction changed.');
 teamText(p.understanding,'your understanding');
 if(!Array.isArray(p.plan)||!p.plan.length||new Set(p.plan.map(x=>x.id)).size!==p.plan.length||p.plan.some(step=>!f.approved_steps.some(x=>x.id===step.id&&x.task===step.task)))throw new Invalid('Use only the exact approved steps. Ask the writer to revise changed plans.');
 a.plan=teamCopy(p.plan);a.status='ready';f.understanding=p.understanding;f.acknowledged_at=new Date().toISOString();
 (s.decisions||=[]).push({id:teamId('ack'),kind:'team_acknowledgment',agent_id:a.id,feedback_id:f.id,report_id:f.report_id,at:f.acknowledged_at,understanding:p.understanding,plan:teamCopy(p.plan)});
 teamEvent(s,a.name,'Acknowledged the approved steps in the team report.');return a;
}
