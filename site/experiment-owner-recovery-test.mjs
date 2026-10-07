import {configureWorkflow as configureHistoricalWorkflow} from './workflow.mjs';
import {encodeWorkspace as encodeHistoricalWorkspace} from './workspace-codec.mjs';
import assert from 'node:assert/strict';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
import {blockerRecoveryTick,blockerRecoveryComplete} from './blocker-recovery.mjs';
import {workflowComplete,workflowTick,incompleteExperimentTask} from './workflow.mjs';
import {completedTaskOutputs} from './tasks.mjs';

const store=new Store(adapter(),seeds);await store.init();const name='owner-recovery-check';
await store.apply(name,{action:'create_project',name:'Software fixture'},'director');
let agentNumber=0;
const add=role=>store.apply(name,{action:'add_agent',role,name:role+'-'+(++agentNumber),specialty:role,question:'Software test',plan:['Software test']},'director');
const o=await add('orchestrator'),a=await add('researcher'),b=await add('researcher'),e=await add('engineer'),l=await add('librarian');
await store.apply(name,{action:'assign_orchestrator',agent_id:o.id},'director');
await store.apply(name,{action:'task',task_action:'configure',enabled:true,research_enabled:true,usage_mode:'warn',client_id:'scope',scope:'Software fixture only'},'director');
{const saved=(await store.read(name)).state;configureHistoricalWorkflow(saved,{action:'workflow',id:'owner-fixture',researcher_ids:[a.id,b.id],engineer_id:e.id,librarian_id:l.id,max_rounds:3,max_cycles:1,max_checkpoints:30,waiting_minutes:5,resource_brief:'Software fixture; no scientific claims'},'director');await store.db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(await encodeHistoricalWorkspace(saved),name).run();}
const base=(await store.read(name)).state;
const result=(status='stopped')=>({outcome:'completed',summary:'Saved fixture',body:'Complete report',document:'Full saved implementation and settings',requests:[],artifacts:[{path:'/tmp/fixture/report.md',sha256:'a'.repeat(64),bytes:3}],records:{experiments:[{id:'fixture',status,purpose:'Test',setup:'Fixed toy fixture',results:'Original values'}]}});
function fixture(){
 const s=structuredClone(base);s.tasks=[];s.events=[];s.requests=[];s.blocker_recoveries=[];
 const w=s.workflow;Object.assign(w,{status:'blocked',stage:'Research',phase:'assess',checkpoint:19,chair_task:null,library_task:null,selected_proposal:'p',selected_proposal_text:'The selected question',selected_method:'m',selected_method_text:'The unchanged method',presentations:[],candidates:[],batch:['assess-a','assess-b'],batch_recorded:true,reason:'Missing original input',termination:{kind:'dependency',task_id:'stop',reason:'Missing original input'},history:[{stage:'Research',phase:'implement',task_ids:['implement']},{stage:'Research',phase:'assess',task_ids:['assess-a','assess-b']}]});
 const saved=(id,agent,kind,phase)=>({id,agent_id:agent.id,sender_id:o.id,kind,status:'completed',workflow_id:w.id,workflow_context:{phase,selected_method_id:'m',selected_method:w.selected_method_text,selected_proposal:w.selected_proposal_text},depends_on:[],document_ids:[],summary:id,completion_id:id+':result',policy_revision:w.policy_revision,direction_revision:w.direction_revision,result:result()});
 s.tasks.push(saved('implement',e,'engineering','implement'),saved('assess-a',a,'meeting','assess'),saved('assess-b',b,'meeting','assess'),saved('stop',o,'coordination','assess'));
 s.tasks.find(t=>t.id==='implement').document_ids=['method'];
 s.tasks.push({...saved('method',a,'research','response'),result:{...result(),records:null}});
 return s;
}
const s=fixture(),original=JSON.stringify(s.tasks);blockerRecoveryTick(s);
let c=s.blocker_recoveries[0],owner=s.tasks.find(t=>t.id===c.owner_recovery.task_id);
assert.equal(owner.agent_id,e.id);assert.equal(owner.kind,'engineering');assert.equal(c.status,'owner_repairing');assert.equal(s.requests.length,0);
assert.equal(owner.document_ids.length,5);assert(owner.document_ids.includes('method'));assert(owner.document_ids.includes('assess-b'));assert.deepEqual(owner.input_refs,['/tmp/fixture/report.md']);
assert.match(owner.prompt,/concrete repairs/);assert.match(owner.prompt,/negative finding is acceptable/);
assert(completedTaskOutputs(s,owner).some(t=>t.task_id==='implement'));assert.equal(JSON.stringify(s.tasks.slice(0,5)),original);
for(let i=0;i<4;i++)blockerRecoveryTick(s);assert.equal(s.tasks.length,6);assert.equal(s.task_policy.used_calls,base.task_policy.used_calls);
// A restart reuses the persisted attempt and preserves the worker's exact packet.
const restarted=structuredClone(s),packet=JSON.stringify(restarted.tasks.at(-1));blockerRecoveryTick(restarted);assert.equal(restarted.tasks.length,6);assert.equal(JSON.stringify(restarted.tasks.at(-1)),packet);

// A previously authorized live owner continuation is adopted, including a legacy
// pending help request. The task/request/result itself is never rewritten.
const adopted=fixture();adopted.tasks.push({id:'explicit-owner-repair',agent_id:e.id,sender_id:o.id,kind:'engineering',status:'running',depends_on:['implement'],document_ids:['implement'],policy_revision:adopted.task_policy.revision,direction_revision:adopted.direction_revision,request:{prompt:'Existing authorized repair'},summary:'Existing recovery'});
blockerRecoveryTick(adopted);assert.equal(adopted.tasks.length,6);assert.equal(adopted.blocker_recoveries[0].owner_recovery.task_id,'explicit-owner-repair');assert.equal(adopted.blocker_recoveries[0].owner_recovery.adopted,true);
const prior=fixture();prior.blocker_recoveries=[{...adopted.blocker_recoveries[0],status:'needs_help',owner_recovery:null,request_id:'help'}];prior.requests=[{id:'help',status:'pending'}];prior.tasks.push(structuredClone(adopted.tasks.at(-1)));const before=JSON.stringify(prior.tasks);
blockerRecoveryTick(prior);assert.equal(prior.requests[0].status,'closed');assert.equal(JSON.stringify(prior.tasks),before);

// A new completed repair must reach every peer with original and new full files.
owner.status='completed';owner.result=result('completed');owner.result.records.experiments[0].execution_outcome='complete';owner.result.records.experiments[0].scientific_outcome='negative';owner.completion_id=owner.id+':result';
blockerRecoveryTick(s);c=s.blocker_recoveries[0];let chair=s.tasks.find(t=>t.id===s.workflow.chair_task);
assert.equal(s.workflow.status,'running');assert.equal(c.status,'repairing');assert.deepEqual(chair.workflow_context.allowed_next_phases,['assess','finished']);assert(chair.document_ids.includes(owner.id));assert(chair.document_ids.includes('implement'));assert.deepEqual(chair.input_refs,['/tmp/fixture/report.md']);assert.match(chair.prompt,/every researcher/);assert(completedTaskOutputs(s,chair).some(t=>t.task_id===owner.id));
const finished={action:'stop',stop_kind:'endpoint',next_phase:'finished',summary:'Premature closure',assignments:[],tie_choice:null,stop_reason:'Wrongly skipped peer assessment'};
const premature=structuredClone(s),pchair=premature.tasks.find(t=>t.id===chair.id);pchair.status='completed';pchair.result={...result(),workflow_plan:finished};workflowComplete(premature,pchair.id);assert.equal(premature.workflow.status,'blocked');assert.match(premature.workflow.reason,/Assess the new owner recovery/);
chair.status='completed';chair.result={...result(),workflow_plan:{action:'advance',stop_kind:null,next_phase:'assess',summary:'Assess the repaired experiment',assignments:[a,b].map(x=>({agent_id:x.id,summary:'Assess saved result',prompt:'Assess the complete new repair report; do not run experiments.'})),tie_choice:null,stop_reason:null}};
workflowComplete(s,chair.id);assert.equal(s.workflow.status,'running');assert.equal(s.workflow.batch.length,2);
for(const id of s.workflow.batch){const t=s.tasks.find(t=>t.id===id);assert(t.document_ids.includes(owner.id));assert(t.document_ids.includes('implement'));assert.equal(t.kind,'meeting');t.status='completed';t.result={...result(),records:null};t.completion_id=id+':result';}
workflowTick(s);chair=s.tasks.find(t=>t.id===s.workflow.chair_task);assert(!chair.workflow_context.allowed_next_phases.includes('assess'));assert(chair.workflow_context.allowed_next_phases.includes('implement'));
assert.equal(s.tasks.filter(t=>t.source?.type==='experiment_owner_recovery').length,1);assert.equal(s.requests.length,0);

// A failed owner repair produces one precise diagnosis, not recursive retries.
const failed=fixture();blockerRecoveryTick(failed);const ft=failed.tasks.at(-1);ft.status='failed';ft.result={...result(),outcome:'blocked'};blockerRecoveryTick(failed);const fc=failed.blocker_recoveries[0],review=failed.tasks.find(t=>t.id===fc.review_task_id);
assert.equal(failed.blocker_recoveries.length,1);assert(review.workflow_context.recovery.failed_tasks.some(t=>t.id===ft.id&&t.result.outcome==='blocked'));
review.status='completed';review.result={...result(),body:JSON.stringify({action:'ask_director',reason:'Owner checked available readers and their exact dependency is unavailable.',question:'Provide the original executed-circuit listing or permit a compatible reader.'})};
blockerRecoveryComplete(failed,review.id);assert.equal(fc.status,'needs_help');assert.equal(failed.requests.length,1);
for(let i=0;i<4;i++)blockerRecoveryTick(failed);assert.equal(failed.requests.length,1);assert.equal(failed.tasks.filter(t=>t.source?.type==='experiment_owner_recovery').length,1);

// Scientific negatives, holds, changed scopes, cleared projects and the completed
// selection-only plasma endpoint never launch an experiment recovery.
const negative=fixture();negative.tasks[0].result=result('completed');negative.tasks[0].result.records.experiments[0].scientific_outcome='negative';assert.equal(incompleteExperimentTask(negative.tasks[0]),false);blockerRecoveryTick(negative);assert(!negative.tasks.some(t=>t.source?.type==='experiment_owner_recovery'));
for(const change of [x=>x.paused=true,x=>x.task_policy.revision++,x=>x.direction_revision++,x=>x.project.cleared_at='2026-10-06',x=>x.project.archived_at='2026-10-06',x=>x.workflow.status='finished']){const held=fixture();change(held);blockerRecoveryTick(held);assert.equal(held.tasks.length,5);}
const busy=fixture();busy.tasks.push({id:'other-work',agent_id:e.id,kind:'engineering',status:'running'});blockerRecoveryTick(busy);assert.equal(busy.tasks.length,6);assert.equal(busy.blocker_recoveries[0].status,'waiting_owner');assert.equal(busy.requests.length,0);
console.log('PASS: owner repairs first, complete inputs, restart and poll idempotency, existing-worker adoption, verified routing to all peers, bounded failure escalation, negative results, holds, scope changes and finished demos.');
