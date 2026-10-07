import {encodeWorkspace,decodeWorkspace} from './workspace-codec.mjs';
import {configureHumanWorkflow,adoptHumanMeetings,decideHumanMeeting,clarifyResearchWorkflow,resumeAdvisoryWorkflow,configureWorkflow,consolidateWorkflowRevisions,workflowComplete,retryWorkflowPlan,retryWorkflowPreflight,reviewWorkflowObstacle,retryWorkflowLibrary,retryWorkflowReviews,repairWorkflowHandoff} from './workflow.mjs';
import {taskAction} from './tasks.mjs';
import {blockerRecoveryTick,blockerRecoveryComplete,blockerRecoveryReply} from './blocker-recovery.mjs';
import {prepareLibraryDelivery,registeredLibraryContext} from './library-delivery.mjs';
import {librarySeed} from './generated.mjs';
import {Invalid, transition, agentFor} from './logic.mjs';
import {changeWarning} from './warnings.mjs';
import {submitRequest, replyToRequest} from './requests.mjs';
import {upsertDirections,decideDirections} from './directions.mjs';
import {teamMode,submitUpdate,submitTeamReport,reviewTeamReport,acknowledgeTeam} from './team.mjs';
import {askReviewQuestion,replyReviewQuestion} from './review-chat.mjs';
import {reviewRunnerAction} from './review-runner.mjs';
import {coordinationAction,ackOrchestratorInbox} from './orchestrator-inbox.mjs';
import {upsertRecord,decideMethod,normalizeLibraryItem,askRecordQuestion,researchRecord,replyRecordQuestion} from './records.mjs';
import {deliverTaskRecords,recordDisplayVersion} from './record-handoff.mjs';

// Keep the original row and old slide links. New projects use their own IDs.
const firstProject='dashboard-test-20261001';
const storageKey=name=>name===firstProject?'live':name;
const projectId=name=>name==='live'?firstProject:name;
function projectText(value,label,max=300){
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Invalid(`Provide ${label}, up to ${max} characters.`);
  return value.trim();
}
function initialProject(key,state){
  const id=projectId(key),example=key==='example';
  const test=key==='live'&&state.agents.length===3&&state.agents.every(a=>/^Test · (Iris|Devon|Ellis)$/.test(a.name));
  return {id,name:example?'Example':key==='live'?'Dashboard test':state.name,
    topic:example?'Learning across different sites':test?'Three-agent dashboard test':'',
    topic_status:example?'example':test?'confirmed':'proposed',
    confirmation_note:test?'The director requested a dashboard test with three subagents. This is a workflow test, not a confirmed scientific research topic.':null,
    kind:example?'example':key==='live'?'test':'research',workspace:`projects/${id}/workspace`};
}
import {deputyAction,setDeputy,stopDeputy} from './deputy.mjs';
import {executionAction,stopExecution} from './execution.mjs';

export class Store {
  constructor(db,seeds){this.db=db;this.seeds=seeds;}
  async init({freshStart=false}={}){
    await this.db.prepare('CREATE TABLE IF NOT EXISTS workspaces (name TEXT PRIMARY KEY, document TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1)').run();
    await this.db.prepare('CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)').run();
    await this.db.batch(Object.entries(this.seeds).map(([name,state])=>this.db.prepare('INSERT OR IGNORE INTO workspaces(name,document,revision) VALUES(?,?,1)').bind(name,JSON.stringify(state))));
    await this.db.prepare('INSERT OR IGNORE INTO settings(name,value) VALUES(?,?)').bind('csrf',crypto.randomUUID()).run();
    // Import the existing shared catalog once; later agent edits remain authoritative.
    await this.db.prepare('INSERT OR IGNORE INTO settings(name,value) VALUES(?,?)').bind('shared-library',JSON.stringify({revision:1,items:librarySeed})).run();
    // Add metadata only. Existing reports, decisions and work permissions survive.
    for(const name of Object.keys(this.seeds)){
      for(let attempt=0;attempt<8;attempt++){
        const {state,revision}=await this.read(name);if(state.project)break;
        state.project=initialProject(name,state);state.name=state.project.name;
        const result=await this.db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE name=? AND revision=?').bind(await encodeWorkspace(state),name,revision).run();
        if(result.meta.changes===1)break;
        if(attempt===7)throw new Invalid('Project setup changed while saving. Try again.');
      }
    }
    if(freshStart)await this.freshStart();
    await this.migrateRoles();
  }
  async migrateRoles(){
    const marker='researcher-roles-20261005';if((await this.db.prepare('SELECT value FROM settings WHERE name=?').bind(marker).first())?.value==='complete')return;
    const rows=await this.db.prepare('SELECT name FROM workspaces ORDER BY rowid').all();
    for(const row of rows.results)for(let attempt=0;attempt<8;attempt++){
      const saved=await this.db.prepare('SELECT document,revision FROM workspaces WHERE name=?').bind(row.name).first(),s=await decodeWorkspace(saved.document);
      if(s.project?.archived_at||!s.agents.some(a=>a.role==='domain_expert'))break;
      for(const a of s.agents)if(a.role==='domain_expert')a.role='researcher';
      const r=await this.db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE name=? AND revision=?').bind(await encodeWorkspace(s),row.name,saved.revision).run();
      if(r.meta.changes===1)break;if(attempt===7)throw new Invalid('Role migration is busy; retry.');
    }
    await this.db.prepare('INSERT OR IGNORE INTO settings(name,value) VALUES(?,?)').bind(marker,'complete').run();
  }
  // One requested fresh start. Keep every original document before making it read-only.
  async freshStart(){
    const key='fresh-start-20261005';
    const saved=await this.db.prepare('SELECT value FROM settings WHERE name=?').bind(key).first();
    if(saved?.value==='complete')return;
    if(!saved){
      const rows=await this.db.prepare('SELECT name FROM workspaces ORDER BY rowid').all();
      await this.db.prepare('INSERT OR IGNORE INTO settings(name,value) VALUES(?,?)').bind(key,JSON.stringify(rows.results.map(r=>r.name))).run();
    }
    const marker=await this.db.prepare('SELECT value FROM settings WHERE name=?').bind(key).first();
    if(marker.value==='complete')return;
    for(const name of JSON.parse(marker.value)){
      for(let attempt=0;attempt<8;attempt++){
        const {state,revision}=await this.read(name);
        if(state.project.archived_at)break;
        const at=new Date().toISOString(),reason='Archived for the director’s fresh start.';
        stopDeputy(state,reason);stopExecution(state,reason);state.paused=true;
        for(const a of state.agents)if(a.status!=='closed')a.status='paused';
        for(const q of state.review_questions||[])if(!q.replies?.length)q.delivery={status:'cancelled',updated_at:at};
        for(const b of state.coordination_batches||[])if(b.delivery?.status!=='completed')b.delivery={status:'cancelled',updated_at:at};
        state.project={...state.project,archived_at:at,archive_reason:reason};
        state.events.push({at,actor:'Director',text:reason});
        const result=await this.db.batch([
          this.db.prepare('INSERT OR IGNORE INTO settings(name,value) SELECT ?,document FROM workspaces WHERE name=? AND revision=?').bind('archive:'+key+':'+name+':'+revision,name,revision),
          this.db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE name=? AND revision=?').bind(await encodeWorkspace(state),name,revision)
        ]);
        if(result[1].meta.changes===1)break;
        if(attempt===7)throw new Invalid('Project changed while archiving. Retry the fresh start.');
      }
    }
    await this.db.prepare('UPDATE settings SET value=? WHERE name=?').bind('complete',key).run();
  }
  async archiveProject(name,p,role){
    if(role!=='director')throw new Invalid('Only the director can archive a project.');
    if(typeof p.reason!=='string'||!p.reason.trim())throw new Invalid('Give the archive reason.');
    for(let attempt=0;attempt<8;attempt++){
      const {state,revision}=await this.read(name);if(state.project.archived_at)return state.project;
      const at=new Date().toISOString();stopDeputy(state,p.reason);stopExecution(state,p.reason);state.paused=true;
      for(const a of state.agents)if(a.status!=='closed')a.status='paused';
      if(state.task_policy)state.task_policy={...state.task_policy,enabled:false,research_enabled:false,revision:state.task_policy.revision+1};
      for(const t of state.tasks||[])if(['queued','running','delivery_pending'].includes(t.status)){t.status='cancelled';t.error='Project archived.';}
      for(const q of state.review_questions||[])if(!q.replies?.length)q.delivery={status:'cancelled',updated_at:at};
      for(const b of state.coordination_batches||[])if(b.delivery?.status!=='completed')b.delivery={status:'cancelled',updated_at:at};
      state.project={...state.project,archived_at:at,archive_reason:p.reason};state.events.push({at,actor:'Director',text:p.reason});
      const result=await this.db.batch([
        this.db.prepare('INSERT OR IGNORE INTO settings(name,value) SELECT ?,document FROM workspaces WHERE name=? AND revision=?').bind('archive:manual:'+name+':'+revision,storageKey(name),revision),
        this.db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE name=? AND revision=?').bind(await encodeWorkspace(state),storageKey(name),revision)
      ]);
      if(result[1].meta.changes===1)return state.project;
    }
    throw new Invalid('Project changed while archiving. Retry.');
  }
  async clearProject(name,p,role){
    if(role!=='director')throw new Invalid('Only the director can clear a dashboard project.');
    const reason=projectText(p.reason,'the reason for clearing',1000);
    for(let attempt=0;attempt<8;attempt++){
      const {state,revision}=await this.read(name);
      if(state.project.cleared_at)return state.project;
      if(p.archive===false){
        if(!state.paused)throw new Invalid('Pause this project before clearing without an archive.');
        const project={...state.project,cleared_at:new Date().toISOString(),clear_reason:reason};
        // Only the project ID and metadata remain for shared-library provenance.
        // No recovery copy is created when the director requests no archive.
        delete project.archived_at;delete project.archive_reason;
        const cleared={...this.emptyState(),name:project.name,project};
        const result=await this.db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE name=? AND revision=?').bind(await encodeWorkspace(cleared),storageKey(name),revision).run();
        if(result.meta.changes===1)return project;
        continue;
      }
      if(!state.project.archived_at)throw new Invalid('Stop and archive this project before clearing its dashboard.');
      const at=new Date().toISOString(),project={...state.project,cleared_at:at,clear_reason:reason};
      // Keep a hidden recovery copy and a minimal ID record for shared-library provenance.
      const cleared={...this.emptyState(),name:project.name,project};
      const result=await this.db.batch([
        this.db.prepare('INSERT OR IGNORE INTO settings(name,value) SELECT ?,document FROM workspaces WHERE name=? AND revision=?').bind('cleared:'+name+':'+revision,storageKey(name),revision),
        this.db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE name=? AND revision=?').bind(await encodeWorkspace(cleared),storageKey(name),revision)
      ]);
      if(result[1].meta.changes===1)return project;
    }
    throw new Invalid('Project changed while clearing. Retry.');
  }
  emptyState(){return {name:'Wu Lab',mode:'live',project:{id:'',name:'Wu Lab',kind:'empty',topic:'',topic_status:'proposed'},paused:true,agents:[],reports:[],events:[],decisions:[],notifications:[],discussions:[],library:[],direction:''};}
  async csrf(){return (await this.db.prepare('SELECT value FROM settings WHERE name=?').bind('csrf').first()).value;}
  async read(name){const row=await this.db.prepare('SELECT document,revision FROM workspaces WHERE name=?').bind(storageKey(name)).first();if(!row)throw new Invalid('Unknown project.');const state=await decodeWorkspace(row.document);for(const a of state.agents)if(a.role==='domain_expert')a.role='researcher';return {state,revision:row.revision};}
  async projects({includeArchived=false,includeCleared=false}={}){
    const rows=await this.db.prepare('SELECT name,document FROM workspaces ORDER BY rowid').all();
    return rows.results.map(row=>JSON.parse(row.document).project||initialProject(row.name,JSON.parse(row.document))).filter(p=>(includeCleared||!p.cleared_at)&&(includeArchived||!p.archived_at));
  }
  async library(){
    const row=await this.db.prepare('SELECT value FROM settings WHERE name=?').bind('shared-library').first();
    return row?JSON.parse(row.value):{revision:0,items:[]};
  }
  async saveLibrary(name,p){
    const {state}=await this.read(name);if(state.project.archived_at)throw new Invalid('This project is archived and read-only.');const a=agentFor(state,p.agent_id);
    if(a.dismissal)throw new Invalid('A dismissed agent cannot change the library.');
    const projectIds=(await this.projects({includeArchived:true,includeCleared:true})).filter(x=>x.kind!=='example').map(x=>x.id);
    if(state.project.kind==='example')throw new Invalid('Example material stays separate from the shared library.');
    for(let attempt=0;attempt<8;attempt++){
      const catalog=await this.library(),old=catalog.items.find(x=>x.id===p.item?.id);
      if(p.expected_revision!==(old?.revision||0))throw new Invalid('The library item changed. Reload it before saving.');
      const item=normalizeLibraryItem(p.item||{},old,a.id,projectIds),next={...catalog,revision:catalog.revision+1,items:old?catalog.items.map(x=>x.id===item.id?item:x):[...catalog.items,item]};
      const result=catalog.revision===0?await this.db.prepare('INSERT OR IGNORE INTO settings(name,value) VALUES(?,?)').bind('shared-library',JSON.stringify(next)).run():await this.db.prepare('UPDATE settings SET value=? WHERE name=? AND value=?').bind(JSON.stringify(next),'shared-library',JSON.stringify(catalog)).run();
      if(result.meta.changes===1)return item;
    }
    throw new Invalid('The library is busy. Reload before trying again.');
  }
  async deliverLibrary(name,p){
    const {state}=await this.read(name),a=agentFor(state,p.agent_id);
    if(state.project.archived_at||state.project.kind==='example')throw new Invalid('Choose an active research project for library delivery.');
    if(a.dismissal||!['librarian','orchestrator'].includes(a.role))throw new Invalid('Send source records to the librarian for catalog delivery.');
    const projectIds=(await this.projects({includeArchived:true,includeCleared:true})).filter(x=>x.kind!=='example').map(x=>x.id);
    for(let attempt=0;attempt<8;attempt++){
      const catalog=await this.library(),prepared=await prepareLibraryDelivery(catalog,p,a.id,state.project.id,projectIds);
      if(prepared.replayed)return prepared.receipt;
      const result=await this.db.prepare('UPDATE settings SET value=? WHERE name=? AND value=?').bind(JSON.stringify(prepared.catalog),'shared-library',JSON.stringify(catalog)).run();
      if(result.meta.changes===1)return prepared.receipt;
    }
    throw new Invalid('Library delivery is busy. Retry the unchanged handoff.');
  }
  async create(name,payload,role){
    if(role!=='director')throw new Invalid('Only the director can create a project.');
    if(typeof name!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)||name.length>80||['live','example',firstProject].includes(name))throw new Invalid('Use a new project ID with lowercase letters, numbers and hyphens.');
    const title=projectText(payload.name,'a project name',120);
    const topic=payload.topic?projectText(payload.topic,'a proposed topic'):'';
    const project={id:name,name:title,topic,topic_status:'proposed',kind:'research',workspace:`projects/${name}/workspace`};
    const state={name:title,mode:'live',reporting_mode:'team',project,direction:topic||'Research topic not confirmed.',direction_revision:1,paused:false,agents:[],reports:[],notifications:[],decisions:[],discussions:[],events:[],library:[],created_at:new Date().toISOString()};
    const result=await this.db.prepare('INSERT OR IGNORE INTO workspaces(name,document,revision) VALUES(?,?,1)').bind(name,JSON.stringify(state)).run();
    if(result.meta.changes!==1)throw new Invalid('That project already exists. Choose a different ID.');
    return project;
  }
  async apply(name,payload,role){
    if(!name)throw new Invalid('Choose the project explicitly.');
    if(payload.action==='clear_project')return this.clearProject(name,payload,role);
    if(payload.action==='archive_project')return this.archiveProject(name,payload,role);
    if(payload.action==='create_project')return this.create(name,payload,role);
    if(payload.action==='library_deliver'){
      if(role!=='worker')throw new Invalid('Use the agent connection for library delivery.');
      return this.deliverLibrary(name,payload);
    }
    if(payload.action==='library_upsert'){
      if(role!=='worker')throw new Invalid('Use the agent connection to maintain the library.');
      return this.saveLibrary(name,payload);
    }
    for(let attempt=0;attempt<8;attempt++){
      const {state,revision}=await this.read(name);
      if(state.project.cleared_at)throw new Invalid('This dashboard was cleared. Create a new project for new work.');
      if(state.project.archived_at)throw new Invalid('This project is archived and read-only. Create a new project for new work.');
      const previousAgents=structuredClone(state.agents);
      let next;
      const target=payload.agent_id?agentFor(state,payload.agent_id):null;
      if(target?.dismissal&&['assign_orchestrator','research_update','report','begin_report','clarify','ack_feedback','claim','release_task','start_agent','review'].includes(payload.action))throw new Invalid('This agent was dismissed. Create a new agent ID for new work; its saved history remains available.');
      // A direct human decision takes precedence and suspends delegated control.
      if(role==='director'&&!(payload.action==='team_review'&&payload.decision==='comment')&&['pause_lab','team_review','direction_choices','direction','confirm_topic','review','release_task','start_agent'].includes(payload.action)){stopDeputy(state,'The director took control.',{pause:true});stopExecution(state,'The director took control.');}
      if(payload.action==='workflow_clarify_research'){
        next={state,result:clarifyResearchWorkflow(state,payload,role)};
      }else if(payload.action==='workflow_resume_advisory'){
        next={state,result:resumeAdvisoryWorkflow(state,payload,role)};
      }else if(payload.action==='workflow_consolidate_revisions'){
        next={state,result:consolidateWorkflowRevisions(state,payload,role)};
      }else if(payload.action==='workflow_preflight_retry'){
        next={state,result:retryWorkflowPreflight(state,payload,role)};
      }else if(payload.action==='workflow_handoff_repair'){
        next={state,result:repairWorkflowHandoff(state,payload,role)};
      }else if(payload.action==='workflow_reviews_retry'){
        next={state,result:retryWorkflowReviews(state,payload,role)};
      }else if(payload.action==='workflow_library_retry'){
        next={state,result:retryWorkflowLibrary(state,payload,role)};
      }else if(payload.action==='workflow_obstacle'){
        next={state,result:reviewWorkflowObstacle(state,payload,role)};
      }else if(payload.action==='workflow_retry'){
        next={state,result:retryWorkflowPlan(state,payload,role,Date.now(),registeredLibraryContext(await this.library(),state.project.id))};
      }else if(payload.action==='workflow_meeting_decision'){
        next={state,result:decideHumanMeeting(state,payload,role)};
      }else if(payload.action==='workflow_human_meetings'){
        next={state,result:adoptHumanMeetings(state,payload,role)};
      }else if(payload.action==='workflow'){
        next={state,result:configureHumanWorkflow(state,payload,role)};
      }else if(payload.action==='task'){
        const libraryContext=['preview','claim'].includes(payload.task_action)?registeredLibraryContext(await this.library(),state.project.id):null;
        next={state,result:taskAction(state,{...payload,action:payload.task_action},role,Date.now(),libraryContext)};
        if(payload.task_action==='poll')for(const task of state.tasks||[]){
          if(task.record_delivery?.status==='display_pending'&&(task.record_delivery.display_version||0)<recordDisplayVersion)deliverTaskRecords(state,task);
        }
        const completed=state.tasks?.find(t=>t.id===payload.task_id);
        if(['complete','redeliver'].includes(payload.task_action)&&!completed?.records_handled&&!completed?.records_delivered){
          deliverTaskRecords(state,completed);
          workflowComplete(state,payload.task_id);
        }
        if(['complete','redeliver'].includes(payload.task_action))blockerRecoveryComplete(state,payload.task_id);
      }else if(payload.action==='record_upsert'){
        if(role!=='worker')throw new Invalid('Use the agent connection to record research.');
        next={state,result:upsertRecord(state,payload)};
      }else if(payload.action==='record_reply'){
        if(role!=='worker')throw new Invalid('Use the agent connection to reply.');
        next={state,result:replyRecordQuestion(state,payload)};
      }else if(payload.action==='method_status'){
        if(role!=='director')throw new Invalid('Use a director decision to change method status.');
        next={state,result:decideMethod(state,payload)};
      }else if(payload.action==='record_question'){
        if(role!=='director')throw new Invalid('Only the director asks review questions.');
        const record=payload.record_type==='library'?(await this.library()).items.find(x=>x.id===payload.record_id):payload.record_type==='proposal'?state.research_map?.nodes.find(x=>x.id===payload.record_id):researchRecord(state,payload.record_type,payload.record_id);
        if(!record)throw new Invalid('Unknown review item.');
        next={state,result:askRecordQuestion(state,payload,record)};
      }else if(payload.action==='deputy_toggle'){
        if(role!=='director')throw new Invalid('Only the human director controls this switch.');
        next={state,result:setDeputy(state,payload)};if(!state.deputy?.enabled)stopExecution(state,'The director turned the deputy off.');
      }else if(payload.action==='work_retry'){
        if(role!=='director')throw new Invalid('Only the director retries stopped automatic work.');
        next={state,result:executionAction(state,payload)};
      }else if(payload.action==='deputy_retry'){
        if(role!=='director')throw new Invalid('Only the director retries deputy reviews.');
        next={state,result:deputyAction(state,payload)};
      }else if(role==='reply_runner'&&payload.action==='maintenance'){
        if(state.review_runner?.runner_id!==payload.runner_id)throw new Invalid('Use the registered service for a maintenance hold.');
        if(typeof payload.enabled!=='boolean')throw new Invalid('Choose whether to hold new service claims.');
        if(payload.enabled)state.runner_maintenance={runner_id:payload.runner_id,until:new Date(Date.now()+300000).toISOString()};else delete state.runner_maintenance;
        next={state,result:{held:payload.enabled,until:state.runner_maintenance?.until||null}};
      }else if(role==='reply_runner'){
        if(['claim','work_claim','deputy_claim','coord_claim'].includes(payload.action)&&Date.parse(state.runner_maintenance?.until)>Date.now())return null;
        next={state,result:payload.action.startsWith('work_')?executionAction(state,payload):payload.action.startsWith('deputy_')?deputyAction(state,payload):payload.action.startsWith('coord_')?coordinationAction(state,payload):reviewRunnerAction(state,payload)};
      }else if(payload.action==='assign_orchestrator'){
        if(role!=='director')throw new Invalid('Only the director assigns the project orchestrator.');
        const a=agentFor(state,payload.agent_id);
        if(state.orchestrator_id&&state.orchestrator_id!==a.id)throw new Invalid('An orchestrator is already assigned.');
        state.orchestrator_id=a.id;next={state,result:{orchestrator_id:a.id}};
      }else if(payload.action==='coord_retry'){
        if(role!=='director')throw new Invalid('Only the director retries an orchestrator review.');
        next={state,result:coordinationAction(state,payload)};
      }else if(payload.action==='inbox_ack'){
        if(role!=='worker')throw new Invalid('Use the orchestrator agent connection.');
        next={state,result:ackOrchestratorInbox(state,payload)};
      }else if(payload.action==='review_retry'){
        if(role!=='director')throw new Invalid('Only the director can retry a failed question.');
        next={state,result:reviewRunnerAction(state,{...payload,action:'retry'})};
      }else if(payload.action==='review_question'){
        if(role!=='director')throw new Invalid('Only the director sends review questions.');
        next={state,result:askReviewQuestion(state,payload)};
      }else if(payload.action==='review_reply'){
        if(role!=='worker')throw new Invalid('Use the agent connection to answer.');
        next={state,result:replyReviewQuestion(state,payload)};
      }else if(role==='mapper'){
        if(payload.action!=='upsert')throw new Invalid('Use upsert to record directions.');
        next={state,result:upsertDirections(state,payload)};
      }else if(payload.action==='direction_choices'){
        if(role!=='director')throw new Invalid('Only the director chooses a direction.');
        next={state,result:decideDirections(state,payload)};
      }else if(payload.action==='team_review'){
        if(role!=='director')throw new Invalid('Only the director reviews the team report.');
        next={state,result:reviewTeamReport(state,payload)};
      }else if(payload.action==='research_update'){
        if(role!=='worker')throw new Invalid('Use the worker interface for findings.');
        next={state,result:submitUpdate(state,payload)};
      }else if(role==='worker'&&payload.action==='report'&&agentFor(state,payload.agent_id).role==='writer'){
        next={state,result:submitTeamReport(state,payload)};
      }else if(role==='worker'&&payload.action==='ack_feedback'&&agentFor(state,payload.agent_id).feedback?.kind==='team_review'){
        next={state,result:acknowledgeTeam(state,payload)};
      }else if(role==='orchestrator'){
        next={state,result:submitRequest(state,payload)};
      }else if(payload.action==='request_reply'){
        if(role!=='director')throw new Invalid('Only the director can answer a request.');
        next={state,result:replyToRequest(state,payload)};
        blockerRecoveryReply(state,payload.request_id);
      }else if(role==='observer'){
        const result=changeWarning(state,payload);next={state,result};
      }else if(payload.action==='confirm_topic'){
        if(role!=='director')throw new Invalid('Only the director can confirm a research topic.');
        if(state.project.kind==='example')throw new Invalid('Choose a research project, not the fictional example.');
        const topic=projectText(payload.topic,'the confirmed topic');
        next=state.project.topic_status==='confirmed'&&topic===state.project.topic?{state,result:null}:transition(state,{action:'direction',text:topic},role);
        next.state.project={...state.project,topic,topic_status:'confirmed',confirmed_at:new Date().toISOString()};
        next.result=next.state.project;
      }else {
        const agent=payload.agent_id?agentFor(state,payload.agent_id):null;
        if(role==='worker'&&teamMode(state)&&['report','begin_report','clarify'].includes(payload.action)&&agent?.role!=='writer')throw new Invalid('Send a research_update to the writer; it prepares the combined slides.');
        if(role==='worker'&&agent?.role==='writer'&&payload.action==='clarify')throw new Invalid('Submit a revised team report containing the follow-up question.');
        if(role==='director'&&['review','release_task','start_agent'].includes(payload.action)&&agent?.team_report_id)throw new Invalid('Use the combined team review for this task.');
        next=transition(state,payload,role);
      }
      // A later assignment or permission change invalidates in-flight status updates.
      if(payload.action!=='status'&&!(payload.action==='task'&&['complete','redeliver'].includes(payload.task_action)&&next.state.workflow))for(const agent of next.state.agents){
        const old=previousAgents.find(a=>a.id===agent.id);
        if(old?.status_revision!==undefined&&(old.status!==agent.status||JSON.stringify(old.plan)!==JSON.stringify(agent.plan))){agent.status_revision=old.status_revision+1;delete agent.work_status;}
      }
      blockerRecoveryTick(next.state);
      const result=await this.db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE name=? AND revision=?').bind(await encodeWorkspace(next.state),storageKey(name),revision).run();
      if(result.meta.changes===1){if(next.error)throw new Invalid(next.error);return next.result;}
    }
    throw new Invalid('The project changed while saving. Refresh and try again.');
  }
}
