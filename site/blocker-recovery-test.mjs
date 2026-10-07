import {configureWorkflow as configureHistoricalWorkflow} from './workflow.mjs';
import {encodeWorkspace as encodeHistoricalWorkspace} from './workspace-codec.mjs';
import assert from 'node:assert/strict';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
import {blockerRecoveryTick,blockerRecoveryComplete} from './blocker-recovery.mjs';
import {timelineEntries} from './timeline.mjs';

const db=adapter();let store=new Store(db,seeds);await store.init();
const name='recovery-fixture';
await store.apply(name,{action:'create_project',name:'Recovery test',topic:'Software test only'},'director');
let agentNumber=0;
const add=role=>store.apply(name,{action:'add_agent',role,name:role+'-'+(++agentNumber),specialty:role,question:'Test',plan:['Test']},'director');
const o=await add('orchestrator'),a=await add('researcher'),b=await add('researcher'),l=await add('librarian');
await store.apply(name,{action:'assign_orchestrator',agent_id:o.id},'director');
const run=(action,p={},role='task_runner')=>store.apply(name,{action:'task',task_action:action,runner_id:'test',...p},role);
await run('configure',{enabled:true,research_enabled:true,usage_mode:'warn',max_model_calls:100,client_id:'allow',scope:'Software fixture only'},'director');
{const saved=(await store.read(name)).state;configureHistoricalWorkflow(saved,{action:'workflow',id:'recovery-fixture',researcher_ids:[a.id,b.id],librarian_id:l.id,max_rounds:3,max_cycles:1,max_checkpoints:30,waiting_minutes:5,resource_brief:'Software fixture only'},'director');await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(await encodeHistoricalWorkspace(saved),name).run();}
const state=async()=>(await store.read(name)).state;
const claim=async id=>run('claim',{task_id:id});
const art={path:'/tmp/test/result.json',sha256:'a'.repeat(64),bytes:5};
const result=(summary='Fixture')=>({outcome:'completed',summary,body:'Saved evidence',document:null,requests:[],artifacts:[art]});
const finish=(p,r)=>run('complete',{...p.claim,completion_id:p.task.id+':result',result:r});
const packet=await claim((await run('poll')).ready[0].id);
const invalidPlan={action:'advance',next_phase:'vote',summary:'Wrong transition',assignments:[],tie_choice:null,stop_reason:null};
await finish(packet,{...result(),workflow_plan:invalidPlan});
let s=await state();assert.equal(s.workflow.status,'blocked');assert.equal(s.blocker_recoveries.length,1);
const original=structuredClone(s.tasks.find(t=>t.id===packet.task.id).result),caseId=s.blocker_recoveries[0].id;
for(let i=0;i<3;i++){store=new Store(db,seeds);await run('poll');}
s=await state();assert.equal(s.tasks.filter(t=>t.source?.type==='blocker_recovery').length,1);
let recovery=await claim(s.blocker_recoveries[0].review_task_id);
assert.equal(recovery.agent.id,o.id);assert.equal(recovery.task.kind,'question');assert.equal(recovery.dependencies.length,1);assert.equal(recovery.documents[0].task_id,packet.task.id);assert(recovery.documents[0].text.includes('Saved evidence'));
assert(recovery.workflow_context.recovery.options.some(o=>o.id==='correct_plan'));
const response={...result('The plan skipped the required sharing step.'),body:JSON.stringify({action:'correct_plan',reason:'The plan skipped the required sharing step. Correct only that plan.',question:''})};
await finish(recovery,response);await finish(recovery,response);
s=await state();assert.equal(s.workflow.status,'running');assert.equal(s.blocker_recoveries[0].status,'repairing');
assert.deepEqual(s.tasks.find(t=>t.id===packet.task.id).result,original);assert.equal(s.workflow.plan_corrections.length,1);
const correction=await claim(s.workflow.chair_task);
assert.match(correction.task.prompt,/previous plan was rejected/);assert.deepEqual(correction.workflow_context.allowed_next_phases,['prepare','finished']);
const good={action:'advance',next_phase:'prepare',summary:'Prepare the two candidates.',assignments:[a,b].map(x=>({agent_id:x.id,summary:'Prepare a candidate',prompt:'Prepare one candidate under the saved test scope.'})),tie_choice:null,stop_reason:null};
await finish(correction,{...result(),workflow_plan:good});
s=await state();assert.equal(s.workflow.phase,'prepare');assert.equal(s.blocker_recoveries.find(c=>c.id===caseId).status,'resolved');
assert.equal(s.workflow.batch.length,2);assert(s.workflow.batch.every(id=>s.tasks.find(t=>t.id===id).status==='queued'));
assert(timelineEntries(s).some(e=>e.kind==='obstacle'&&e.description.includes('Workflow stopped')));
assert(s.events.some(e=>e.kind==='recovery'&&e.text.includes('block is cleared')));

// A failure in the correction wakes no endless chain of recovery agents.
let copy=structuredClone(s);copy.workflow.status='blocked';copy.workflow.phase='start';copy.workflow.checkpoint=0;copy.workflow.chair_task=correction.task.id;copy.workflow.reason='Orchestrator plan was not applied: Still invalid';
copy.blocker_recoveries[0].status='repairing';blockerRecoveryTick(copy);
assert.equal(copy.blocker_recoveries[0].status,'needs_help');assert.equal(copy.requests.length,1);
for(let i=0;i<4;i++)blockerRecoveryTick(copy);
assert.equal(copy.requests.length,1);assert.equal(copy.tasks.filter(t=>t.source?.type==='blocker_recovery').length,1);

// Missing scientific data is a request, never fabricated evidence or a changed result.
const root={...structuredClone(s),workflow:null,blocker_recoveries:[],requests:[],tasks:[],events:[]};
const blocked={id:'missing-data',agent_id:a.id,sender_id:o.id,kind:'research',status:'failed',policy_revision:root.task_policy.revision,direction_revision:root.direction_revision,attempts:1,summary:'Check the data',result:{...result('The required data is unavailable.'),outcome:'blocked'}};
root.tasks.push(blocked);blockerRecoveryTick(root);
assert.equal(root.blocker_recoveries.length,1);const review=root.tasks.find(t=>t.source?.type==='blocker_recovery');
assert.deepEqual(review.workflow_context.recovery.options,[]);
review.status='completed';review.result={...result(),body:JSON.stringify({action:'ask_director',reason:'The required data file is missing; the saved report has no substitute.',question:'Please provide the original measurement file and its column description.'})};
blockerRecoveryComplete(root,review.id);assert.equal(root.requests[0].status,'pending');assert.equal(blocked.status,'failed');assert.equal(blocked.result.outcome,'blocked');
blockerRecoveryComplete(root,review.id);assert.equal(root.requests.length,1);
// The worker may save a longer structured answer as a reply document.
const longReply=structuredClone(root),longCase=longReply.blocker_recoveries[0],longTask=longReply.tasks.find(t=>t.id===review.id);
longCase.status='reviewing';longReply.requests=[];delete longCase.request_id;
longTask.result.document=longTask.result.body+'\n\n---\n\nFull supporting explanation.';longTask.result.body='The diagnosis is saved in the full document.';
blockerRecoveryComplete(longReply,longTask.id);assert.equal(longReply.requests.length,1);assert.match(longReply.requests[0].question,/original measurement file/);

// Holds defer automatic work. Changing the allowance does not revive an old task.
const held=structuredClone(root);held.tasks=[structuredClone(blocked)];held.blocker_recoveries=[];held.requests=[];held.paused=true;blockerRecoveryTick(held);assert.equal(held.tasks.length,1);
held.paused=false;held.task_policy.revision++;blockerRecoveryTick(held);assert.equal(held.tasks.length,1);
const external={...structuredClone(root),tasks:[],blocker_recoveries:[],requests:[]};external.agents.find(x=>x.id===a.id).work_status={state:'blocked',task_id:'external-work',summary:'Missing paper',waiting_for:'A readable PDF'};
blockerRecoveryTick(external);assert.equal(external.blocker_recoveries.length,1);assert.equal(external.tasks[0].agent_id,o.id);

// A failure in recovery itself asks for service help, with no recursive model calls.
const broken=structuredClone(external);broken.tasks[0].status='failed';broken.tasks[0].error='Worker stopped checking in.';blockerRecoveryTick(broken);assert.equal(broken.requests.length,1);assert.equal(broken.blocker_recoveries.length,1);
console.log('PASS: persistent wake-up, checked plan repair, duplicate delivery, saved evidence, verification, missing-data requests, holds, external status and bounded recovery failures.');

// A dependency stop has completed evidence, not a failed transport task. All
// implementation and assessment reports must accompany its recovery review.
{
 const dep=structuredClone(s);dep.tasks=[];dep.blocker_recoveries=[];dep.requests=[];dep.events=[];
 const w=dep.workflow;w.status='blocked';w.stage='Research';w.phase='assess';w.chair_task=null;w.library_task=null;w.presentations=[];w.history=[];w.selected_method='fixture-method';w.batch=['assessment-a','assessment-b','assessment-c'];
 const report=(id,kind,phase)=>({id,agent_id:kind==='coordination'?o.id:a.id,kind,status:'completed',workflow_id:w.id,workflow_context:{phase,selected_method_id:'fixture-method'},summary:id,depends_on:[],document_ids:[],result:{...result(id),document:'Complete saved report '+id}});
 dep.tasks.push(report('implementation','engineering','implement'),...w.batch.map(id=>report(id,'meeting','assess')),report('original-stop','coordination','assess'));
 w.termination={kind:'dependency',task_id:'original-stop',reason:'Missing original conversion source'};w.reason=w.termination.reason;
 blockerRecoveryTick(dep);let c=dep.blocker_recoveries[0],t=dep.tasks.find(t=>t.id===c.review_task_id);
 assert.equal(t.document_ids.length,5);assert(t.document_ids.includes('implementation'));assert(t.document_ids.includes('original-stop'));assert(c.options.some(o=>o.id==='review_dependency'));
 // Replay the old renderer's incomplete review and ask for help. Newly attached
 // inputs justify exactly one fresh review; no experiment or peer task repeats.
 t.status='completed';c.status='needs_help';c.task_ids=[];c.request_id='old-help';dep.requests.push({id:'old-help',status:'pending'});
 const original=JSON.stringify(dep.tasks.slice(0,5)),calls=dep.task_policy.used_calls;
 blockerRecoveryTick(dep);assert.equal(c.review_number,2);assert(c.evidence_handoff_repair);assert.equal(dep.requests[0].status,'closed');
 const retry=dep.tasks.find(t=>t.id===c.review_task_id);assert.equal(retry.document_ids.length,5);const count=dep.tasks.length;blockerRecoveryTick(dep);assert.equal(dep.tasks.length,count);assert.equal(JSON.stringify(dep.tasks.slice(0,5)),original);assert.equal(dep.task_policy.used_calls,calls);
 retry.status='completed';c.status='needs_help';blockerRecoveryTick(dep);assert.equal(dep.tasks.length,count);
 console.log('PASS: full stopped-investigation evidence, five attached reports, one versioned handoff repair, preserved original tasks and no unchanged retry.');
}

// Resolving a handoff must reconcile the idle role's current status as well as
// its recovery case. Historical failures and genuine active blocks stay intact.
{
 const idle=structuredClone(s);idle.tasks=[];idle.blocker_recoveries=[];idle.requests=[];idle.events=[];idle.workflow=null;
 const failed={...structuredClone(blocked),id:'owner:request:0',agent_id:l.id};idle.tasks.push(failed);
 const actor=idle.agents.find(x=>x.id===l.id);actor.work_status={task_id:failed.id,state:'blocked',summary:'Old missing report',waiting_for:'Report',base_status:actor.status};actor.status_revision=3;actor.last_seen='2026-10-06T01:00:00Z';
 idle.blocker_recoveries.push({id:'owner-case',status:'resolved',task_ids:[],owner_recovery:{task_id:'owner',review_started:'actual-new-review'}},{id:'librarian-case',key:'task:'+failed.id,status:'resolved',task_ids:[failed.id]});
 const original=JSON.stringify(failed),permission=actor.status,calls=idle.task_policy.used_calls;
 blockerRecoveryTick(idle);assert.equal(actor.work_status.state,'sleeping');assert.equal(actor.work_status.resolution_id,'librarian-case');assert.equal(actor.status_revision,4);assert.equal(actor.work_status_resolutions.length,1);assert.equal(actor.last_seen,'2026-10-06T01:00:00Z');assert.equal(actor.status,permission);assert.equal(JSON.stringify(failed),original);assert.equal(idle.task_policy.used_calls,calls);
 const clean=JSON.stringify(idle);for(let i=0;i<3;i++)blockerRecoveryTick(idle);assert.equal(JSON.stringify(idle),clean);
 const reset=()=>{const x=structuredClone(idle),a=x.agents.find(a=>a.id===l.id);a.work_status={task_id:failed.id,state:'blocked',summary:'Original block',base_status:a.status};return x;};
 for(const status of ['queued','running','delivery_pending']){const busy=reset();busy.tasks.push({id:'new-task',agent_id:l.id,status});blockerRecoveryTick(busy);assert.equal(busy.agents.find(a=>a.id===l.id).work_status.state,'blocked');}
 const later=reset();later.agents.find(a=>a.id===l.id).work_status.task_id='newer-block';later.tasks.push({id:'newer-block',status:'failed',agent_id:l.id,workflow_id:'unrelated'});blockerRecoveryTick(later);assert.equal(later.agents.find(a=>a.id===l.id).work_status.state,'blocked');
 const real=reset();delete real.blocker_recoveries[0].owner_recovery;blockerRecoveryTick(real);assert.equal(real.agents.find(a=>a.id===l.id).work_status.state,'blocked');
 for(const change of [x=>x.paused=true,x=>x.project.cleared_at='2026-10-06',x=>x.project.archived_at='2026-10-06']){const held=reset();change(held);blockerRecoveryTick(held);assert.equal(held.agents.find(a=>a.id===l.id).work_status.state,'blocked');}
 console.log('PASS: resolved idle role status, saved original block, no fake check-in, no model call or duplicate event, active lanes, newer blocks, genuine failures and holds.');
}
