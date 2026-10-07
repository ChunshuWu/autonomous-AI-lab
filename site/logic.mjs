// The hosted version of WuLab's research permission rules.
import {assignDashboardIdentity,pinDashboardIdentities} from './identities.mjs';
import {reportLifecycle} from './report-lifecycle.mjs';
export class Invalid extends Error {}
const copy = v => structuredClone(v);
const now = () => new Date().toISOString();
const id = prefix => prefix + '-' + crypto.randomUUID();
const requireText = (v, label) => {
  if (typeof v !== 'string' || !v.trim()) throw new Invalid('Please provide ' + label + '.');
  if (v.length > 12000) throw new Invalid(label + ' is too long. Link to detailed evidence.');
  return v.trim();
};
const list = (v, label) => { if (!Array.isArray(v)) throw new Invalid(label + ' must be a list.'); return v; };
export const agentFor = (s, key) => { const a=s.agents.find(a=>a.id===key); if(!a)throw new Invalid('Unknown researcher.'); return a; };
export const reportFor = (s, key) => { const r=s.reports.find(r=>r.id===key); if(!r)throw new Invalid('Unknown report.'); return r; };
const event = (s,actor,text) => s.events.push({at:now(),actor,text});
export const permission = (s,a) => ({allowed:!s.paused&&a.status==='working'&&(!a.research_direction||(s.research_map?.nodes||[]).some(n=>n.id===a.research_direction&&n.status==='under_exploration')),scope:a.role==='writer'?'reporting':'research',status:a.status,agent:a});
const unique = (items,label) => { const ids=items.map(x=>requireText(x.id,label+' ID')); if(new Set(ids).size!==ids.length)throw new Invalid('Use unique IDs in '+label+'.'); };

export function validateVisual(v){
  if(v===undefined)return;
  if(!v||typeof v!=='object'||!['flow','bars','table','line'].includes(v.type))throw new Invalid('Use a flow, bars, table, or line figure.');
  requireText(v.title,'figure title');requireText(v.caption,'figure caption');
  if(v.type==='flow')for(const n of list(v.nodes,'figure nodes')){requireText(n.label,'node label');requireText(n.detail,'node detail');}
  if(v.type==='table'){
    const columns=list(v.columns,'table columns');for(const c of columns)requireText(c,'column label');
    for(const row of list(v.rows,'table rows'))if(!Array.isArray(row)||row.length!==columns.length)throw new Invalid('Each table row must match its columns.');
  }
  if(v.type==='line'){
    requireText(v.x_label,'horizontal axis label');requireText(v.y_label,'vertical axis label');
    for(const scale of [v.x_scale,v.y_scale])if(scale!==undefined&&!['linear','log'].includes(scale))throw new Invalid('Use linear or log axes.');
    const series=list(v.series,'plot series');if(!series.length||series.length>12)throw new Invalid('Use one to twelve plot series.');
    for(const row of series){requireText(row.label,'series label');const points=list(row.points,'plot points');if(!points.length||points.length>10000)throw new Invalid('Provide saved plot points.');for(const point of points)if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||(v.x_scale==='log'&&point.x<=0)||(v.y_scale==='log'&&point.y<=0))throw new Invalid('Plot points must be finite and positive on log axes.');}
  }
  if(v.type==='bars'){
    if(!Number.isFinite(v.max)||v.max<=0)throw new Invalid('Choose a positive chart scale.');
    requireText(v.unit,'chart unit');
    for(const row of list(v.rows,'chart rows')){requireText(row.label,'chart label');if(!Number.isFinite(row.value)||row.value<0||row.value>v.max)throw new Invalid('Chart values must fit the stated scale.');}
  }
}

export function validateProgress(steps,a) {
  const previous=list(steps,'previous steps');
  const expected=new Map([...(a.prior_proposals||[]),...a.plan].map(x=>[x.id,x.task]));
  unique(previous,'previous steps');
  if(previous.length!==expected.size||previous.some(x=>!expected.has(x.id)))throw new Invalid('Account for every current plan step and earlier proposed step, using its original ID.');
  for(const p of previous){
    if(!['done','partial','not_started','blocked','dropped'].includes(p.status))throw new Invalid('Choose a valid previous-step status.');
    requireText(p.outcome,'previous step outcome'); if(p.task&&p.task!==expected.get(p.id))p.display_task=requireText(p.task,'short step label'); p.task=expected.get(p.id); p.released=a.plan.some(x=>x.id===p.id);
    if(!p.released&&['done','partial'].includes(p.status))throw new Invalid('An unreleased proposal cannot be reported as executed.');
  }
}

export function validateReport(r,a) {
  for(const k of ['title','summary','kind'])requireText(r[k],k);
  if(r.document!==undefined){
    if(!r.document||typeof r.document!=='object'||Array.isArray(r.document))throw new Invalid('Provide a document with background, progress and next_steps sections.');
    for(const key of ['background','progress','next_steps']){
      if(typeof r.document[key]!=='string'||!r.document[key].trim()||r.document[key].length>60000)throw new Invalid('Write the document '+key+' section, up to 60000 characters.');
    }
    if(!list(r.sources,'document sources').length)throw new Invalid('Link the saved evidence used in this report.');
    for(const source of r.sources){requireText(source.label,'source label');requireText(source.url,'source location');}
    for(const figure of list(r.figures||[],'figures')){
      if(!['background','progress','next_steps'].includes(figure.section))throw new Invalid('Place the figure in a report section.');
      if(figure.visual){validateVisual(figure.visual);if(figure.image)throw new Invalid('Choose a chart or an image for each figure.');}
      else{
        if(!figure.image||typeof figure.image.url!=='string'||(!/^https:\/\/[^\s<>"\\]+$/.test(figure.image.url)&&!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(figure.image.url)))throw new Invalid('Use an HTTPS image or an embedded PNG, JPEG or WebP.');
        if(figure.image.url.length>200000)throw new Invalid('Keep each embedded figure under 150 KB.');
        requireText(figure.image.alt,'figure image description');requireText(figure.title,'figure title');requireText(figure.caption,'figure caption');
      }
      if(!list(figure.evidence,'figure evidence').length)throw new Invalid('Give each figure a source or label it as an illustration.');
    }
    r.format='document';delete r.presentation;
  }else{
  if(!r.background||typeof r.background!=='object')throw new Invalid('Explain the background for a reader outside the specialty.');
  for(const k of ['problem','known','gap'])requireText(r.background[k],'background '+k);
  for(const t of list(r.background.terms||[],'terms')) { requireText(t.term,'term'); requireText(t.meaning,'term meaning'); }
  for(const x of list(r.background.explanation||[],'background explanation')){requireText(x.title,'background slide title');requireText(x.text,'background slide explanation');validateVisual(x.visual);}
  if(!list(r.findings,'findings').length)throw new Invalid('Describe the progress in at least one finding.');
  for(const f of r.findings){
    validateVisual(f.visual);
    for(const k of ['kind','claim','detail'])requireText(f[k],'finding '+k);
    if(['result','observation'].includes(f.kind)&&!list(f.evidence||[],'evidence').length)throw new Invalid('A result or observation needs an evidence reference.');
  }
  }
  validateProgress(r.previous_steps,a);
  for(const field of ['next_steps','questions']){r[field]=list(r[field]||[],field);unique(r[field],field);}
  for(const p of r.next_steps)for(const k of ['task','why','success'])requireText(p[k],'next step '+k);
  for(const q of r.questions)requireText(q.text,'question');
  if(!r.next_steps.length&&!r.questions.length&&!a.report_only_closed)throw new Invalid('Propose next steps or ask how to close the project.');
}

function submit(s,a,report){
  const r=copy(report);validateReport(r,a);r.closed=!!a.report_only_closed;
  const old=a.latest_report?reportFor(s,a.latest_report):null;
  Object.assign(r,{id:id('report'),version:old?old.version+1:1,agent_id:a.id,agent_name:a.name,created_at:now(),example:s.mode==='example',project_name:s.name,previous_report:a.latest_report});
  s.reports.push(r);
  for(const n of s.notifications)if(n.agent_id===a.id)n.read=true;
  s.notifications.push({id:id('notice'),agent_id:a.id,report_id:r.id,created_at:now(),read:r.closed,text:r.closed?`${a.name} revised the report. Research remains stopped.`:`${a.name} submitted a report. Research is paused.`});
  Object.assign(a,{status:r.closed?'closed':'awaiting_director',latest_report:r.id,feedback:null});delete a.report_only_closed;
  event(s,a.name,r.closed?'Revised the report. Research remains stopped.':'Submitted a report and paused for the director.');return r;
}

export function change(s,p,role){
  const action=p.action;
  const worker=['status','heartbeat','claim','pause','begin_report','report','clarify','ack_feedback','activity'];
  const director=['add_agent','dismiss_agent','comment','review','direction','discussion','pause_lab','resume_lab','start_agent','release_task'];
  if(!(role==='worker'?worker:director).includes(action))throw new Invalid('This action is not available through this interface.');
  if(action==='add_agent'){
    const key=id('agent');const tasks=list(p.plan,'plan');if(!tasks.length)throw new Invalid('Add at least one first step.');
    if(s.agents.some(a=>a.name===p.name?.trim()))throw new Invalid('Use a unique internal researcher label. Available dashboard names and portraits are assigned automatically.');
    const role=p.role||'researcher';
    if(!['researcher','mathematician','engineer','reviewer','librarian','consultant','data_specialist','orchestrator','writer'].includes(role))throw new Invalid('Choose a recognized WuLab role.');
    if(role==='writer'&&s.agents.some(a=>a.role==='writer'&&a.status!=='closed'))throw new Invalid('This project already has a writer.');
    const a={id:key,role,name:requireText(p.name,'researcher name'),specialty:requireText(p.specialty,'specialty'),question:requireText(p.question,'research question'),phase:p.phase||'Generate',status:'planned',plan:tasks.map((t,i)=>({id:key+'-step-'+(i+1),task:requireText(t,'plan step')})),latest_report:null,feedback:null,prior_proposals:[],last_seen:null,runtime:'Not connected',foundation:'Read shared research methods, field foundations, and source papers before starting.'};
    assignDashboardIdentity(a,s.agents);
    s.agents.push(a);event(s,'Director',`Added ${a.name}. Its plan is waiting to be released.`);return a;
  }
  if(['pause_lab','resume_lab'].includes(action)){s.paused=action==='pause_lab';event(s,'Director',s.paused?'Paused all research.':'Removed the lab-wide pause. Individual report pauses remain.');return s.paused;}
  if(action==='direction'){
    s.direction=requireText(p.text,'research direction');s.direction_revision++;
    for(const a of s.agents)if(a.status!=='closed')Object.assign(a,{status:'paused',feedback:null});
    s.decisions.push({id:id('direction'),at:now(),kind:'direction',comment:s.direction,revision:s.direction_revision});
    event(s,'Director','Changed direction. Researchers must report how their plans should change.');return s.direction;
  }
  if(action==='discussion'){const d={id:id('discussion'),title:requireText(p.title,'discussion title'),text:requireText(p.text,'discussion text'),author:'Director',created_at:now()};s.discussions.push(d);event(s,'Director','Added discussion: '+d.title);return d;}
  const a=agentFor(s,p.agent_id);
  if(action==='dismiss_agent'){
    if(a.dismissal)return a;
    if(a.id===s.orchestrator_id)throw new Invalid('Keep the assigned project orchestrator; this action dismisses other team members.');
    if(!['planned','paused','closed','awaiting_writer','awaiting_director'].includes(a.status))throw new Invalid('Stop the agent at a checkpoint and save its handover before dismissal.');
    if((s.execution_jobs||[]).some(j=>j.agent_id===a.id&&!['completed','cancelled','failed'].includes(j.status))||(s.execution_rounds||[]).some(r=>!['reported','cancelled','blocked'].includes(r.status)&&(r.writer_id===a.id||(r.owner_ids||[]).includes(a.id))))throw new Invalid('Finish or cancel the agent’s automatic round before dismissal.');
    if((s.review_questions||[]).some(q=>q.agent_id===a.id&&!q.replies.length&&!['cancelled','failed'].includes(q.delivery?.status)))throw new Invalid('Resolve the agent’s pending review questions before dismissal.');
    const dismissal={at:now(),reason:requireText(p.reason,'the reason for dismissal'),handover:requireText(p.handover,'the saved handover location')};
    pinDashboardIdentities(s.agents);
    Object.assign(a,{dismissal,status:'closed',feedback:null});
    s.decisions.push({id:id('dismissal'),kind:'dismiss_agent',agent_id:a.id,...dismissal});
    event(s,'Director',`Dismissed ${a.name}. Records are kept; its dashboard name is available again.`);
    return a;
  }
  if(action==='status'){
    if(a.dismissal||a.status==='closed')throw new Invalid('Stopped agents cannot report new work.');
    const task_id=requireText(p.task_id,'the task ID'),client_id=requireText(p.client_id,'a status update ID');
    const summary=requireText(p.summary,'a brief task update');
    if(summary.length>280)throw new Invalid('Keep the status summary within 280 characters.');
    if(!['working','sleeping','blocked','finished'].includes(p.work_state))throw new Invalid('Choose working, sleeping, blocked, or finished.');
    const waiting_for=['sleeping','blocked'].includes(p.work_state)?requireText(p.waiting_for,'what will wake or unblock this agent'):'';
    const evidence=copy(list(p.evidence||[],'status evidence'));for(const e of evidence){requireText(e.note,'an evidence note');requireText(e.source,'an evidence location');}
    const work_kind=p.work_kind||'research';
    if(!['research','coordination'].includes(work_kind))throw new Invalid('Choose research or coordination work.');
    const coordination=work_kind==='coordination'&&a.id===s.orchestrator_id&&a.role==='orchestrator'&&s.task_policy?.enabled;
    if(work_kind==='coordination'&&!coordination)throw new Invalid('Coordination status requires the assigned orchestrator and an enabled task allowance.');
    const content={task_id,state:p.work_state,summary,waiting_for,evidence,...(work_kind==='coordination'?{work_kind}: {})};
    const prior=s.events.find(e=>e.kind==='status'&&e.agent_id===a.id&&e.client_id===client_id);
    if(prior){if(JSON.stringify(prior.status_content)!==JSON.stringify(content))throw new Invalid('That status update ID was already used for different content.');return prior.work_status;}
    if(p.expected_revision!==(a.status_revision||0))throw new Invalid('The agent status changed. Reload before updating it.');
    if(p.work_state==='working'&&!coordination&&!permission(s,a).allowed)throw new Invalid('Claim released work before reporting working. A status update cannot approve research.');
    if(p.work_state!=='working'&&['working','ready'].includes(a.status))a.status='paused';
    const at=now(),revision=(a.status_revision||0)+1;
    const work_status={...content,base_status:a.status,updated_at:at,revision};
    Object.assign(a,{work_status,status_revision:revision,last_seen:at});
    s.events.push({id:id('status'),client_id,agent_id:a.id,actor:a.name,at,kind:'status',text:summary,evidence,status_content:content,work_status:copy(work_status)});
    return work_status;
  }
  if(action==='activity'){
    if(a.dismissal)throw new Invalid('A dismissed agent cannot record new activity.');
    const key=requireText(p.client_id,'an activity ID'),summary=requireText(p.summary,'a short activity description');
    if(summary.length>280)throw new Invalid('Keep the timeline description within 280 characters.');
    if(!['meeting','idea','reading','data','experiment','implementation','review','coordination'].includes(p.kind))throw new Invalid('Choose the activity kind.');
    if(p.report_id)reportFor(s,p.report_id);
    const evidence=list(p.evidence||[],'activity evidence');for(const e of evidence){requireText(e.note,'an evidence note');requireText(e.source,'an evidence location');}
    const prior=s.events.find(e=>e.client_id===key&&e.agent_id===a.id);
    if(prior){if(prior.text!==summary||prior.kind!==p.kind||prior.report_id!==(p.report_id||null)||JSON.stringify(prior.evidence)!==JSON.stringify(evidence))throw new Invalid('That activity ID already describes a different event.');return prior;}
    const record={id:id('activity'),client_id:key,agent_id:a.id,at:now(),actor:a.name,kind:p.kind,text:summary,report_id:p.report_id||null,evidence:copy(evidence)};
    s.events.push(record);a.last_seen=record.at;return record;
  }
  if(a.dismissal&&!['comment','heartbeat','pause'].includes(action))throw new Invalid('This agent was dismissed. Use a new agent ID and saved handover for any new assignment.');
  if(action==='comment'){
    if(!s.reports.some(r=>r.id===p.report_id&&r.agent_id===a.id))throw new Invalid('Choose a saved report by this agent.');
    const comment=p.comment??'';
    if(typeof comment!=='string'||comment.length>12000)throw new Invalid('Comments must be text, up to 12000 characters.');
    const note={id:id('comment'),agent_id:a.id,report_id:p.report_id,at:now(),decision:'comment',comment,answers:{},direction_revision:s.direction_revision};
    s.decisions.push(note);event(s,'Director',`Saved a comment on ${a.name}'s report.`);
    // Comments alone never alter state, current feedback, or permission.
    return note;
  }
  if(action==='heartbeat'){Object.assign(a,{last_seen:now(),runtime:requireText(p.runtime||'Connected agent','runtime')});return permission(s,a);}
  if(action==='release_task'){
    if(!a.role||a.role==='researcher')throw new Invalid('Researchers need their report review; this action is for support roles.');
    if(a.status==='closed'||a.latest_report)throw new Invalid('Do not use this action to reopen stopped work or bypass a slide report.');
    if(!['planned','paused','ready'].includes(a.status))throw new Invalid('Pause the support task before changing its plan.');
    const plan=list(p.plan,'approved support plan');if(!plan.length)throw new Invalid('Record the approved work.');
    const steps=plan.map((task,i)=>({id:id('step'),task:requireText(task,'approved step')}));
    const decision={id:id('release'),kind:'release_task',agent_id:a.id,at:now(),comment:p.comment??'',approved_steps:copy(steps),direction_revision:s.direction_revision};
    if(typeof decision.comment!=='string'||decision.comment.length>12000)throw new Invalid('Comments must be text, up to 12000 characters.');
    Object.assign(a,{status:'ready',plan:steps,feedback:null});s.decisions.push(decision);
    event(s,'Director','Released the recorded support task for '+a.name+'.');
  }else if(action==='pause'){
    if(a.status==='closed')return a;
    const reason=requireText(p.reason,'why the affected work is paused');
    Object.assign(a,{status:'paused',feedback:null});event(s,a.name,'Paused affected work: '+reason);
  }else if(action==='start_agent'){
    if(a.status!=='planned'||a.latest_report)throw new Invalid('Use the report review to release a researcher who has already reported.');
    a.status='ready';event(s,'Director','Released the first plan for '+a.name+'.');
  }else if(action==='claim'){
    if(a.research_direction&&!(s.research_map?.nodes||[]).some(n=>n.id===a.research_direction&&n.status==='under_exploration'))throw new Invalid('This direction is no longer selected.');
    if(s.paused||a.status!=='ready')throw new Invalid('Research is not released. Wait for clear director feedback and acknowledge it first.');
    Object.assign(a,{status:'working',last_seen:now(),runtime:p.runtime||'Connected agent'});delete a.work_status;event(s,a.name,'Started the agreed next steps.');
  }else if(action==='begin_report'){
    if(a.role&&!['researcher','writer'].includes(a.role))throw new Invalid('The writer prepares combined slides. Send a written request through the orchestrator.');
    if(a.status==='closed')throw new Invalid('This researcher is closed.');
    Object.assign(a,{status:'preparing_report',feedback:null});event(s,a.name,'Stopped research to prepare a progress report.');
  }else if(action==='report'){
    if(a.role&&!['researcher','writer'].includes(a.role))throw new Invalid('The writer prepares combined slides. Send written findings to the responsible researcher.');
    if(a.status==='closed')throw new Invalid('This researcher is closed.');return submit(s,a,p.report||{});
  }else if(action==='clarify'){
    if(a.role&&!['researcher','writer'].includes(a.role))throw new Invalid('Ask for clarification through the orchestrator’s text request.');
    if(!a.latest_report||!['awaiting_director','feedback_received','revising_report','preparing_report','paused','ready'].includes(a.status))throw new Invalid('Submit a progress report before asking a follow-up question.');
    const r=copy(reportFor(s,a.latest_report));
    if(a.status==='ready')r.previous_steps=[...new Map([...(a.prior_proposals||[]),...a.plan].map(x=>[x.id,x.task]))].map(([id,task])=>({id,task,status:'not_started',outcome:'No new research was started. The comments need clarification.',evidence:[]}));
    const answers=a.feedback?.answers||{};
    for(const q of r.questions)if(String(answers[q.id]||'').trim())r.findings.push({kind:'director answer',claim:q.text,detail:answers[q.id],evidence:[]});
    r.questions=r.questions.filter(q=>!String(answers[q.id]||'').trim());
    r.questions.push({id:id('q'),text:requireText(p.question,'follow-up question'),recommendation:p.recommendation||'Please clarify before I continue.',options:[]});
    r.findings.push({kind:'clarification',claim:'I need to clarify the director’s comments',detail:p.context||'The next direction is not clear enough to start research.',evidence:[]});
    if(a.feedback){
      r.findings.push({kind:'director decision',claim:'The action the director selected',detail:a.feedback.decision.replaceAll('_',' '),evidence:[]});
      if(a.feedback.comment.trim())r.findings.push({kind:'director comment',claim:'The comment I am responding to',detail:a.feedback.comment,evidence:[]});
    }
    return submit(s,a,r);
  }else if(action==='review'){
    if(p.report_id!==a.latest_report)throw new Invalid('A newer report exists. Refresh and review the latest report.');
    const closedRevision=a.status==='closed'&&p.decision==='revise_report';
    if(!['awaiting_director','paused'].includes(a.status)&&!closedRevision)throw new Invalid('This report is not waiting for review.');
    const r=reportFor(s,a.latest_report),comment=p.comment??'',decision=p.decision,answers=p.answers||{};
    if(decision==='continue'&&reportLifecycle(s,r).status==='archived')throw new Invalid('This report is archived. Review a current report before approving new work.');
    if(typeof comment!=='string'||comment.length>12000)throw new Invalid('Comments must be text, up to 12000 characters.');
    if(!['continue','revise_report','keep_paused','close'].includes(decision))throw new Invalid('Choose how the researcher should respond.');
    if(Array.isArray(answers)||typeof answers!=='object')throw new Invalid('Question answers must be an object.');
    // The selected action is the director instruction. Optional prose is preserved as written.
    // Never fabricate an answer for a question that the director did not answer.
    const feedback={id:id('feedback'),report_id:r.id,at:now(),comment,decision,answers,direction_revision:s.direction_revision};
    if(decision==='continue')feedback.approved_steps=copy(r.next_steps);
    if(decision==='revise_report'){
      a.prior_proposals=[...new Map([...(a.prior_proposals||[]),...r.next_steps].map(x=>[x.id,copy(x)])).values()];
      if(closedRevision)a.report_only_closed=true;
    }
    a.feedback=feedback;s.decisions.push({agent_id:a.id,...copy(feedback)});
    a.status={continue:'feedback_received',revise_report:'revising_report',keep_paused:'awaiting_director',close:'closed'}[decision];
    for(const n of s.notifications)if(n.report_id===r.id)n.read=decision==='close';
    event(s,'Director',`Commented on ${a.name}'s report: ${decision.replaceAll('_',' ')}.`);
  }else if(action==='ack_feedback'){
    const f=a.feedback;
    if(a.status!=='feedback_received'||!f||f.decision!=='continue')throw new Invalid('There is no clear permission to continue.');
    if(p.feedback_id!==f.id||f.direction_revision!==s.direction_revision)throw new Invalid('The feedback or direction has changed. Read the latest version.');
    const understanding=requireText(p.understanding,'your understanding of the comments'),plan=list(p.plan,'revised plan');
    if(!plan.length)throw new Invalid('Record the revised next steps before continuing.');
    unique(plan,'plan');for(const step of plan)requireText(step.task,'step text');
    if(!f.comment.trim()&&!Object.keys(f.answers||{}).length&&f.approved_steps){
      if(plan.some(step=>!f.approved_steps.some(x=>x.id===step.id&&x.task===step.task)))throw new Invalid('The director approved the proposed steps. Use those steps or clarify a changed plan.');
    }
    Object.assign(a,{status:'ready',plan,prior_proposals:copy(reportFor(s,a.latest_report).next_steps)});
    Object.assign(f,{understanding,acknowledged_at:now()});
    const saved=s.decisions.find(d=>d.id===f.id);if(saved)Object.assign(saved,copy(f));
    for(const n of s.notifications)if(n.agent_id===a.id)n.read=true;
    event(s,a.name,'Read the director’s comments and recorded the revised plan.');
  }
  return a;
}

export function transition(state,payload,role){
  const next=copy(state);
  try{return {state:next,result:change(next,copy(payload),role)};}
  catch(error){
    if(payload.action!=='report'||role!=='worker')throw error;
    if(agentFor(next,payload.agent_id).role&&agentFor(next,payload.agent_id).role!=='researcher')throw error;
    const a=agentFor(next,payload.agent_id);if(a.status==='closed')throw error;
    Object.assign(a,{status:'preparing_report',feedback:null});event(next,a.name,'Report needs repair. Research remains paused.');
    return {state:next,error:error.message||'Invalid report.'};
  }
}
