import {usageSummary} from './usage.mjs';
import {renderDocument,documentText,renderTaskDocument,taskDocumentText} from './documents.mjs';
import {withReportCatalog,reportLifecycle,reportLabel} from './report-lifecycle.mjs';
import {Store} from './store.mjs';
import {Invalid, agentFor, reportFor, permission} from './logic.mjs';
import {renderSlides} from './slides.mjs';
import {assets, seeds, slideStyle} from './generated.mjs';
import {agentName} from './identities.mjs';
import {reviewQuestions} from './review-chat.mjs';
import {earlierReports} from './report-history.mjs';
import {reviewRunnerContext} from './review-runner.mjs';
import {coordinationContext,readOrchestratorInbox} from './orchestrator-inbox.mjs';

import {deputyContext} from './deputy.mjs';
import {executionContext} from './execution.mjs';

const ready = new WeakMap();
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const html=body=>new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const textSchema={type:'string'};
const workspaceSchema={type:'string',description:'Exact project ID returned by lab_projects. live is a legacy alias for dashboard-test-20261001. Never reuse another project’s permissions.'};
const tools=[
  {name:'lab_workflow',description:'Read the saved workflow or start a director-requested run. Calls and tokens are counters; elapsed time may warn without stopping work; scientific scope and voting rules still apply. New workflows use one discussion and one researcher vote, with engineer and mathematician advice. The dashboard waits for a human decision after each meeting; votes never authorize the next step. human_meetings upgrades an existing run without deleting its evidence. Proposal votes choose the next small investment, not a finished solution. Optional feasibility_budget enables one engineer check in Proposal within the recorded scope and limits; omit it for reading-only runs. A hold or changed allowance prevents advancement. clarify_research applies an actual director clarification at a paused, complete Research response checkpoint after every researcher and the orchestrator have supplied saved question replies; document_ids names those replies. revision_only requests a director-directed method rewrite at the same paused complete checkpoint, preserving the agreed scientific brief and without claiming new peer agreement. retry_reviews can attach complete saved document_ids to a blocked review, preserving completed peers and the original findings.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['read','configure','human_meetings','retry_plan','review_obstacle','retry_library','retry_reviews','repair_handoff','retry_preflight','consolidate_revisions','resume_advisory','clarify_research']},sender_id:textSchema,task_id:textSchema,reason:textSchema,client_id:textSchema,revision_only:{type:'boolean'},document_ids:{type:'array',maxItems:6,items:textSchema},scope:textSchema,id:textSchema,researcher_ids:{type:'array',items:textSchema},librarian_id:textSchema,engineer_id:textSchema,mathematician_id:textSchema,max_rounds:{type:'integer'},max_cycles:{type:'integer'},max_checkpoints:{type:'integer'},waiting_minutes:{type:'integer'},resource_brief:textSchema,feasibility_budget:textSchema},['workspace','action']),annotations:{readOnlyHint:false}},
  {name:'lab_tasks',description:'Saved requests and scoped work for the task service. Agents submit questions to peers; the orchestrator assigns other tasks. Stable IDs prevent duplicates. Dependencies wait for confirmed results. Use kind vote with decision_packet containing criteria and final candidate task IDs; every ballot receives the complete frozen candidates. document_ids loads full saved task documents without truncation. Use handler library_delivery, kind library and one input_refs JSON path for prepared librarian handoffs; the service validates and delivers them without a model call. Read returns compact task status; get returns one result. Configuration requires an actual director instruction. New allowances default to usage_mode warn: calls and tokens are counters only; use hard only when explicitly requested. Selecting a proposal never grants task permission.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['read','get','submit','configure','retry','cancel']},id:textSchema,task_id:textSchema,sender_id:textSchema,agent_id:textSchema,kind:{type:'string',enum:['question','meeting','vote','proposal','research','engineering','mathematics','library','coordination']},handler:{type:'string',enum:['model','library_delivery','library_collect']},prompt:textSchema,summary:textSchema,input_refs:{type:'array',items:textSchema},depends_on:{type:'array',items:textSchema},document_ids:{type:'array',maxItems:6,items:textSchema},decision_packet:schema({criteria:textSchema,candidates:{type:'array',minItems:1,maxItems:10,items:schema({id:textSchema,task_id:textSchema},['id','task_id'])}},['criteria','candidates']),notify_orchestrator:{type:'boolean'},enabled:{type:'boolean'},research_enabled:{type:'boolean'},scope:textSchema,max_model_calls:{type:'integer'},usage_mode:{type:'string',enum:['warn','hard']},client_id:textSchema},['workspace','action']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'lab_records',description:'Read or save experiment records, completed meeting summaries, and candidate methods. Use stable IDs and the current item revision (0 for new records). Experiments include purpose/setup/results and labeled figures. Meetings include participants, suggestions, revealed votes, decisions, objections and actions. Suggestions use brief text; optional summary displays first while preserving full text, and task_id links the contributor’s saved document. Link proposal_ids/report_ids/method_ids/experiment_ids/meeting_ids/library_ids. Recording evidence never starts work or changes permissions.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['read','upsert','reply']},question_id:textSchema,body:textSchema,client_id:textSchema,type:{type:'string',enum:['experiment','meeting','method']},agent_id:textSchema,expected_revision:{type:'integer'},record:{type:'object',additionalProperties:true}},['workspace','action']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'lab_library',description:'Read the shared catalog, save an item, or deliver the librarian’s saved handoff JSON unchanged. deliver requires schema_version:1, a stable handoff_id and items using the catalog item fields plus expected_revision. All items and the receipt save together; an identical retry returns the same receipt. Read action receipt with handoff_id to confirm item IDs/versions. No downloads or scientific analysis.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['read','upsert','deliver','receipt']},agent_id:textSchema,expected_revision:{type:'integer'},handoff_id:textSchema,handoff:{type:'object',properties:{schema_version:{type:'integer',const:1},handoff_id:textSchema,items:{type:'array',minItems:1,maxItems:50,items:{type:'object',additionalProperties:true}}},required:['schema_version','handoff_id','items'],additionalProperties:false},item:{type:'object',additionalProperties:true}},['workspace','action']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'orchestrator_inbox',description:'Read short summaries of review conversations at a coordination checkpoint. Routine summaries do not wake agents. Acknowledge only notices the actual project orchestrator has reviewed; automatic in-flight reviews are protected. This never grants research permission.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['read','ack']},report_id:textSchema,agent_id:textSchema,unread_only:{type:'boolean'},notice_ids:{type:'array',items:textSchema}},['workspace','action']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'review_chat',description:'Read report-review questions and post the addressed agent’s real answer. Read/inbox are read-only. Questions and replies never approve work or change report versions. Answer from saved evidence while research is paused; do not impersonate another agent or invent its reply.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['read','inbox','reply']},report_id:textSchema,agent_id:textSchema,question_id:textSchema,client_id:textSchema,body:textSchema,summary:textSchema,attention_kind:{type:'string',enum:['routine','director_request','coordination','material_error','direction_change']},attention_reason:textSchema,references:{type:'array',items:schema({report_id:textSchema,slide_id:textSchema},['report_id'])}},['workspace','action']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'research_map',description:'Record a project’s brainstormed directions as a tree. Read lab_state for the current research_map revision (0 if absent). New nodes are unexplored; only the director changes status. Titles name the research gap, question or core method in simple words; exclude activity and status. Keep evidence, stable IDs and valid local report references. Does not release research.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['upsert']},actor:textSchema,expected_revision:{type:'integer'},nodes:{type:'array',items:schema({id:textSchema,parent_id:{type:['string','null']},title:textSchema,summary:textSchema,presentation:{type:['object','null'],additionalProperties:true},evidence:{type:'array',items:schema({note:textSchema,source:textSchema},['note','source'])},report_refs:{type:'array',items:schema({report_id:textSchema,anchor:textSchema},['report_id'])}},['id','title','summary'])}},['workspace','action','actor','expected_revision','nodes']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'lab_projects',description:'List separate WuLab projects and their confirmed or proposed topics. Does not start research.',inputSchema:schema({}),annotations:{readOnlyHint:true}},
  {name:'lab_state',description:'Read WuLab text requests, warnings, plans, reports, director comments, and work permissions. Read before each research action. This is the current saved state.',inputSchema:schema({workspace:workspaceSchema},['workspace']),annotations:{readOnlyHint:true}},
  {name:'researcher_action',description:'Carry out a WuLab worker action. Claim only released work. Use status at task changes with task_id, client_id, expected_revision (agent.status_revision or 0), work_state, summary and waiting_for for sleeping/blocked. The assigned orchestrator uses work_kind coordination under the enabled task allowance, without releasing research. Update your own agent_id; status cannot approve work. Repeat the same client_id only for an identical retry. Send meaningful findings using research_update and pause. The writer prepares the combined report; contributors acknowledge the team decision. Support roles send written outcomes to the orchestrator and use pause when a decision is needed or the assigned scope is complete. Never use this tool to impersonate director approval.',inputSchema:schema({workspace:workspaceSchema,agent_id:textSchema,action:{type:'string',enum:['status','heartbeat','claim','pause','begin_report','report','clarify','ack_feedback','research_update','activity']},client_id:textSchema,task_id:textSchema,expected_revision:{type:'integer'},work_state:{type:'string',enum:['working','sleeping','blocked','finished']},work_kind:{type:'string',enum:['research','coordination']},waiting_for:textSchema,summary:textSchema,kind:textSchema,report_id:textSchema,evidence:{type:'array',items:schema({note:textSchema,source:textSchema},['note','source'])},reason:textSchema,update:{type:'object',additionalProperties:true},report:{type:'object',additionalProperties:true},question:textSchema,context:textSchema,recommendation:textSchema,feedback_id:textSchema,understanding:textSchema,plan:{type:'array',items:schema({id:textSchema,task:textSchema},['id','task'])}},['workspace','agent_id','action']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'lab_warning',description:'Raise or resolve an evidence-backed warning about wasted effort in one WuLab project. Use a stable key to update the same issue. State the symptom, evidence, impact, and suggested response; distinguish possible issues from observed ones. Resolve only with evidence of improvement or a correction. Never fabricate examples in a real project. This does not change research permissions or record a human instruction.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['raise','resolve']},key:textSchema,reporter:textSchema,title:textSchema,symptom:textSchema,impact:textSchema,suggestion:textSchema,certainty:{type:'string',enum:['possible','observed']},agent_ids:{type:'array',items:textSchema},evidence:{type:'array',items:schema({note:textSchema,source:textSchema},['note','source'])},resolution:textSchema,expected_revision:{type:'integer',description:'Current warning revision, required when resolving an open warning.'}},['workspace','action','key','reporter','evidence']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'orchestrator_request',description:'Submit or update a short text request for human comment or a decision. Preserve the original requester and enough background, evidence, and clearly scoped choices. No slides required. This records an agent proposal, not human approval, and never changes research permission. Use the latest expected_revision when changing an existing key.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['submit']},key:textSchema,expected_revision:{type:'integer'},title:textSchema,requester:textSchema,context:textSchema,question:textSchema,recommendation:textSchema,agent_ids:{type:'array',items:textSchema},options:{type:'array',items:schema({id:textSchema,label:textSchema,detail:textSchema},['id','label','detail'])},evidence:{type:'array',items:schema({note:textSchema,source:textSchema},['note','source'])}},['workspace','action','key','title','requester','context','question','options']),annotations:{readOnlyHint:false,destructiveHint:false}},
  {name:'director_instruction',description:'Record an actual human director instruction received in chat. Only call when the human has requested this action. Preserve the selected action and any exact comment or answers. Text is optional; never invent missing answers. Never invent approval or use this to release research on an agent’s own authority. If unclear, keep affected work paused and clarify through the writer’s report or orchestrator text request. clear_project with archive:false clears a paused dashboard without a recovery copy; shared sources and cat profiles remain. request_reply records a response without changing work permission. team_review approves the selected direction’s explicit steps in the latest combined report. direction_choices saves statuses only. release_task must not bypass a team hold.',inputSchema:schema({workspace:workspaceSchema,action:{type:'string',enum:['work_retry','deputy_toggle','deputy_retry','assign_orchestrator','create_project','archive_project','clear_project','confirm_topic','add_agent','dismiss_agent','comment','review','direction','discussion','pause_lab','resume_lab','start_agent','release_task','request_reply','team_review','direction_choices','review_question']},archive:{type:'boolean'},reason:textSchema,handover:textSchema,round_id:textSchema,enabled:{type:'boolean'},expected_epoch:{type:'integer'},choices:{type:'array',items:schema({id:textSchema,status:{type:'string',enum:['unexplored','under_exploration','explored','discarded']}},['id','status'])},body:textSchema,client_id:textSchema,slide_id:textSchema,role:{type:'string',enum:['researcher','mathematician','engineer','reviewer','librarian','consultant','data_specialist','orchestrator','writer']},agent_id:textSchema,report_id:textSchema,request_id:textSchema,expected_revision:{type:'integer'},option_id:textSchema,comment:textSchema,decision:{type:'string',enum:['continue','revise_report','keep_paused','close','comment','keep_pending','option']},answers:{type:'object',additionalProperties:{type:'string'}},name:textSchema,topic:textSchema,specialty:textSchema,question:textSchema,phase:textSchema,plan:{type:'array',items:textSchema},title:textSchema,text:textSchema},['workspace','action']),annotations:{readOnlyHint:false,destructiveHint:true}}
];

async function mcp(request,store){
  if(request.method==='GET')return new Response(null,{status:405,headers:{Allow:'POST'}});
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  const body=await parseBody(request);
  const reply=result=>json({jsonrpc:'2.0',id:body.id,result});
  if(body.jsonrpc!=='2.0')return json({jsonrpc:'2.0',id:body.id??null,error:{code:-32600,message:'Invalid request'}},400);
  if(body.method==='initialize')return reply({protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'WuLab',version:'1.0.0'},instructions:'WuLab uses Proposal and Research stages. Use lab_tasks for saved requests and scoped assignments; the task service wakes only the needed agent. Use researcher, engineer, mathematician, librarian and orchestrator roles. Saved proposals and selection meetings can activate a direction; this does not release research. Check the task allowance and project pause before work. Use researcher_action status for your own state and lab_library deliver for catalog handoffs. Legacy report tools remain for existing reports; new work does not require a writer or report approval. Questions can be answered while research is held.'});
  if(body.method==='notifications/initialized')return new Response(null,{status:202});
  if(body.method==='ping')return reply({});
  if(body.method==='tools/list')return reply({tools});
  if(body.method==='tools/call'){
    try{
      const {name,arguments:args={}}=body.params||{};
      const workspace=args.workspace;
      let result;
      if(name==='lab_workflow'){
        if(args.action==='read')result=(await store.read(workspace)).state.workflow||null;
        else if(args.action==='configure')result=await store.apply(workspace,{...args,action:'workflow'},'director');
        else if(args.action==='human_meetings')result=await store.apply(workspace,{...args,action:'workflow_human_meetings'},'director');
        else if(args.action==='clarify_research')result=await store.apply(workspace,{...args,action:'workflow_clarify_research'},'director');
        else if(args.action==='resume_advisory')result=await store.apply(workspace,{...args,action:'workflow_resume_advisory'},'director');
        else if(args.action==='consolidate_revisions')result=await store.apply(workspace,{...args,action:'workflow_consolidate_revisions'},'worker');
        else if(args.action==='retry_preflight')result=await store.apply(workspace,{...args,action:'workflow_preflight_retry'},'worker');
        else if(args.action==='repair_handoff')result=await store.apply(workspace,{...args,action:'workflow_handoff_repair'},'worker');
        else if(args.action==='retry_reviews')result=await store.apply(workspace,{...args,action:'workflow_reviews_retry'},'worker');
        else if(args.action==='retry_library')result=await store.apply(workspace,{...args,action:'workflow_library_retry'},'worker');
        else if(args.action==='review_obstacle')result=await store.apply(workspace,{...args,action:'workflow_obstacle'},'worker');
        else if(args.action==='retry_plan')result=await store.apply(workspace,{...args,action:'workflow_retry'},'worker');
        else throw new Invalid('Choose read or configure.');
      }else if(name==='lab_tasks'){
        if(args.action==='read'){const s=(await store.read(workspace)).state;result={policy:s.task_policy,usage:usageSummary(s),service:s.task_service,tasks:(s.tasks||[]).map(t=>({id:t.id,agent_id:t.agent_id,kind:t.kind,summary:t.summary,status:t.status,attempts:t.attempts,error:t.error,result_summary:t.result?.summary}))};}
        else if(args.action==='get')result=(await store.read(workspace)).state.tasks?.find(t=>t.id===args.task_id)||null;
        else result=await store.apply(workspace,{...args,action:'task',task_action:args.action},args.action==='configure'?'director':'worker');
      }else if(name==='lab_records'){
        if(args.action==='read')result=(await store.read(workspace)).state.research_records||{experiment:[],meeting:[],method:[]};
        else if(args.action==='upsert')result=await store.apply(workspace,{...args,action:'record_upsert'},'worker');
        else if(args.action==='reply')result=await store.apply(workspace,{...args,action:'record_reply'},'worker');
        else throw new Invalid('Choose read or upsert.');
      }else if(name==='lab_library'){
        await store.read(workspace);
        if(args.action==='read')result=await store.library();
        else if(args.action==='upsert')result=await store.apply(workspace,{...args,action:'library_upsert'},'worker');
        else if(args.action==='deliver')result=await store.apply(workspace,{...args,action:'library_deliver'},'worker');
        else if(args.action==='receipt'){result=(await store.library()).deliveries?.find(d=>d.workspace===workspace&&d.handoff_id===args.handoff_id)?.receipt;if(!result)throw new Invalid('No saved receipt for this project and handoff_id.');}
        else throw new Invalid('Choose read, upsert, deliver, or receipt.');
      }else if(name==='lab_projects')result=await store.projects();
      else if(name==='lab_state')result=withReportCatalog((await store.read(workspace)).state);
      else if(name==='orchestrator_inbox'){
        if(args.action==='read')result=readOrchestratorInbox((await store.read(workspace)).state,args);
        else if(args.action==='ack')result=await store.apply(workspace,{...args,action:'inbox_ack'},'worker');
        else throw new Invalid('Use read or ack for the orchestrator inbox.');
      }
      else if(name==='review_chat'){
        if(['read','inbox'].includes(args.action))result=reviewQuestions((await store.read(workspace)).state,{...args,pending_only:args.action==='inbox'});
        else if(args.action==='reply')result=await store.apply(workspace,{...args,action:'review_reply'},'worker');
        else throw new Invalid('Use read, inbox or reply for review chat.');
      }
      else if(name==='researcher_action')result=await store.apply(workspace,args,'worker');
      else if(name==='orchestrator_request')result=await store.apply(workspace,args,'orchestrator');
      else if(name==='research_map')result=await store.apply(workspace,args,'mapper');
      else if(name==='lab_warning')result=await store.apply(workspace,args,'observer');
      else if(name==='director_instruction')result=await store.apply(workspace,args,'director');
      else throw new Invalid('Unknown tool.');
      return reply({content:[{type:'text',text:JSON.stringify(result)}]});
    }catch(e){return reply({isError:true,content:[{type:'text',text:e.message}]});}
  }
  if(body.id===undefined)return new Response(null,{status:202});
  return json({jsonrpc:'2.0',id:body.id,error:{code:-32601,message:'Method not found'}});
}

async function parseBody(request){
  const body=await request.text();
  if(new TextEncoder().encode(body).byteLength>1000000)console.warn('WuLab request exceeded the 1 MB advisory size threshold.');
  let parsed;try{parsed=JSON.parse(body);}catch{throw new Invalid('Request must be valid JSON.');}
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Invalid('Request must be a JSON object.');
  return parsed;
}

export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url),path=url.pathname;
      if(assets[path]&&request.method==='GET'){
        const asset=assets[path],body=asset.encoding==='base64'?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body;
        return new Response(body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
      }
      // Sites enforces private visitor access before reaching this Worker.
      // Reject cross-origin writes even for an authenticated visitor.
      const origin=request.headers.get('Origin');
      if(request.method==='POST'&&origin&&origin!==url.origin)return json({error:'Open WuLab in its own app tab to save changes.'},403);
      if(!env.DB)return json({error:'WuLab storage is not connected.'},503);
      const store=new Store(env.DB,seeds);
      if(!ready.has(env.DB))ready.set(env.DB,store.init({freshStart:true}).catch(e=>{ready.delete(env.DB);throw e;}));
      await ready.get(env.DB);
      if(path==='/health')return json({ok:true,storage:'connected'});
      if(path==='/mcp'||path==='/api/agent')return await mcp(request,store);
      if(path==='/api/task-runner'){
        if(request.method!=='POST')return json({error:'Use POST.'},405);
        if(!env.RUNNER_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.RUNNER_TOKEN)return json({error:'Runner authentication required.'},403);
        const p=await parseBody(request);if(!['poll','preview','preflight_fail','claim','renew','complete','redeliver','fail','library_deliver','library_catalog','maintenance'].includes(p.action))throw new Invalid('Unknown task service action.');
        if(p.action==='library_catalog'){await store.read(p.workspace);return json({ok:true,result:await store.library()});}
        if(p.action==='library_deliver'){const held=await store.apply(p.workspace,{...p,action:'task',task_action:'validate'},'task_runner');const result=await store.apply(p.workspace,{action:'library_deliver',agent_id:held.agent_id,handoff:p.handoff},'worker');return json({ok:true,result});}
        const result=await store.apply(p.workspace,{...p,action:'task',task_action:p.action},'task_runner');return json({ok:true,result});
      }
      if(path==='/api/review-runner'){
        if(request.method!=='POST')return json({error:'Use POST.'},405);
        if(!env.RUNNER_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.RUNNER_TOKEN)return json({error:'Runner authentication required.'},403);
        const p=await parseBody(request);
        if(!p.workspace)throw new Invalid('Choose a project.');
        if((await store.read(p.workspace)).state.project.archived_at)throw new Invalid('This project is archived; its workers are stopped.');
        if(!['maintenance','heartbeat','claim','context','renew','complete','fail','coord_claim','coord_context','coord_renew','coord_complete','coord_fail','deputy_claim','deputy_context','deputy_renew','deputy_complete','deputy_fail','work_heartbeat','work_claim','work_context','work_renew','work_complete','work_fail'].includes(p.action))throw new Invalid('This connection handles review assistance, enabled deputy decisions and their approved work.');
        const result=p.action==='work_context'?executionContext((await store.read(p.workspace)).state,p):p.action==='deputy_context'?deputyContext((await store.read(p.workspace)).state,p):p.action==='coord_context'?coordinationContext((await store.read(p.workspace)).state,p):p.action==='context'?reviewRunnerContext((await store.read(p.workspace)).state,p):await store.apply(p.workspace,p,'reply_runner');
        return json({ok:true,result});
      }
      const workspace=url.searchParams.get('workspace')||'';
      if(request.method==='GET'){
        if(path==='/api/projects'){const all=await store.projects({includeArchived:true});return json({projects:all.filter(p=>!p.archived_at),archives:all.filter(p=>p.archived_at)});}
        if(path==='/api/state'){
          const all=await store.projects({includeArchived:true}),projects=all.filter(p=>!p.archived_at),selected=workspace||projects[0]?.id;
          let state=selected?(await store.read(selected)).state:store.emptyState();
          if(state.project.cleared_at)state=projects[0]?(await store.read(projects[0].id)).state:store.emptyState();
          return json({state:withReportCatalog(state),library:await store.library(),projects,archives:all.filter(p=>p.archived_at),csrf:await store.csrf()});
        }
        if(path.startsWith('/task-documents/')){
          const {state}=await store.read(workspace),id=decodeURIComponent(path.slice('/task-documents/'.length)),t=state.tasks?.find(t=>t.id===id);
          if(!t?.result)throw new Invalid('No saved reply for this task in this project.');
          const text=taskDocumentText(t);
          if(url.searchParams.get('format')==='markdown')return new Response(text,{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename=reply.md','Cache-Control':'no-store'}});
          return html(renderTaskDocument(t,agentName(agentFor(state,t.agent_id),state.agents),workspace));
        }
        if(path==='/api/permission'){const {state}=await store.read(workspace);return json(permission(state,agentFor(state,url.searchParams.get('agent_id'))));}
        if(path.startsWith('/slides/')||path.startsWith('/reports/')||path.startsWith('/documents/')){
          const {state}=await store.read(workspace),r=reportFor(state,path.split('/').at(-1).replace(/\.md$/,''));
          const author=state.agents.find(a=>a.id===r.agent_id);
          const presented=author?{...r,agent_name:agentName(author,state.agents),previous_steps:r.report_type==='team'?r.previous_steps.map(step=>{const owner=state.agents.find(a=>a.id===step.agent_id);return owner?{...step,task:agentName(owner,state.agents)+step.task.slice(owner.name.length),display_task:step.display_task?agentName(owner,state.agents)+step.display_task.slice(owner.name.length):undefined}:step;}):r.previous_steps,contributors:r.contributors?.map(c=>({...c,name:agentName(state.agents.find(a=>a.id===c.agent_id),state.agents)}))}:r;
          presented.earlier_reports=earlierReports(state,r);presented.workspace_id=state.project.id;
          if(path.startsWith('/documents/'))return path.endsWith('.md')?new Response(documentText(presented),{headers:{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':'attachment; filename=report.md'}}):html(renderDocument({...presented,report_label:reportLabel(state,r),report_lifecycle:reportLifecycle(state,r)}));
          if(path.startsWith('/slides/')&&r.document)return html(renderDocument({...presented,report_label:reportLabel(state,r),report_lifecycle:reportLifecycle(state,r)}));
          return path.startsWith('/slides/')?html(renderSlides({...presented,report_label:reportLabel(state,r),report_lifecycle:reportLifecycle(state,r)},slideStyle)):json({...r,earlier_reports:presented.earlier_reports,workspace_id:state.project.id});
        }
      }
      if(request.method==='POST'&&['/api/director','/api/worker'].includes(path)){
        const role=path.endsWith('worker')?'worker':'director';
        if(role==='director'&&request.headers.get('X-WuLab-CSRF')!==await store.csrf())return json({error:'Refresh WuLab before sending comments.'},403);
        if(role==='worker'&&(!env.WORKER_TOKEN||request.headers.get('Authorization')!=='Bearer '+env.WORKER_TOKEN))return json({error:'Connect through the WuLab tools or an authorized worker connection.'},403);
        const payload=await parseBody(request);
        const result=await store.apply(payload.workspace,payload,role);
        return json({ok:true,result});
      }
      return json({error:'Not found'},404);
    }catch(e){
      if(e instanceof Invalid||e instanceof TypeError)return json({error:e.message},400);
      console.error('WuLab request failed:',e.message);
      return json({error:'The change could not be saved. Please refresh and try again.'},500);
    }
  }
};
