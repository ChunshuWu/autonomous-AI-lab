import assert from 'node:assert/strict';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
import worker from './worker.mjs';
const db=adapter(),store=new Store(db,seeds),ws='runtime-check';await store.init();await store.apply(ws,{action:'create_project',name:'Isolated runtime check'},'director');
const add=role=>store.apply(ws,{action:'add_agent',name:role,role,specialty:'Fixture',question:'Check service delivery',plan:['One software test']},'director');const o=await add('orchestrator'),l=await add('librarian'),r=await add('researcher');await store.apply(ws,{action:'assign_orchestrator',agent_id:o.id},'director');
const run=(action,p={},role='task_runner')=>store.apply(ws,{action:'task',task_action:action,runner_id:'fixture',...p},role);
await run('configure',{client_id:'runtime',usage_mode:'hard',enabled:true,research_enabled:true,max_model_calls:1,scope:'Isolated software fixture only'},'director');
const submit=(id,extra={})=>run('submit',{id,sender_id:o.id,agent_id:r.id,kind:'question',prompt:id,summary:id,...extra},'worker');
await submit('oversize');let s=(await store.read(ws)).state;const preview=await run('preview',{task_id:'oversize'});assert.equal(preview.task.id,'oversize');assert.equal((await store.read(ws)).state.task_policy.used_calls,0);assert.equal((await store.read(ws)).state.tasks[0].status,'queued');
await run('preflight_fail',{task_id:'oversize',error:'Fresh fixture packet exceeds its configured budget.'});s=(await store.read(ws)).state;assert.equal(s.task_policy.used_calls,0);assert.equal(s.tasks[0].status,'failed');assert.equal(s.tasks[0].attempts,0);assert(s.warnings.some(w=>w.key==='task-preflight'));
await submit('one-model');const a=await run('claim',{task_id:'one-model'});await run('complete',{...a.claim,completion_id:'one-model:done',result:{outcome:'completed',summary:'Fixture answer',body:'Fixture.',document:null,requests:[],artifacts:[{path:'/tmp/fixture/result.json',sha256:'0'.repeat(64),bytes:1}],usage:{input_tokens:10,output_tokens:1}}});assert.equal((await store.read(ws)).state.task_policy.used_calls,1);
const spec={agent_id:l.id,kind:'library',handler:'library_delivery',input_refs:['/tmp/fixture/handoff.json']};await submit('catalog',spec);await assert.rejects(()=>submit('bad-handler',{...spec,agent_id:r.id}),/Prepared library/);
assert((await run('poll')).ready.some(t=>t.id==='catalog'));const c=await run('claim',{task_id:'catalog'});assert.equal(c.task.handler,'library_delivery');assert.equal((await store.read(ws)).state.task_policy.used_calls,1);
const handoff={schema_version:1,handoff_id:'script-fixture',items:[{id:'paper-runtime-fixture',expected_revision:0,kind:'paper',title:'Fixture source',summary:'Reader-supplied metadata',source:'https://example.org/paper',project_ids:[ws],version:'v1',reading:'Abstract only',checks:'Not reproduced',read_by:[r.id]}]};
const receipt=await store.apply(ws,{action:'library_deliver',agent_id:l.id,handoff},'worker');assert.equal(receipt.status,'delivered');assert.deepEqual(await store.apply(ws,{action:'library_deliver',agent_id:l.id,handoff},'worker'),receipt);
await run('complete',{...c.claim,completion_id:'catalog:done',result:{outcome:'completed',summary:'Fixture catalog saved',body:'Saved without a model.',document:null,requests:[],artifacts:[{path:'/tmp/fixture/result.json',sha256:'0'.repeat(64),bytes:1}],handler:'library_delivery',model:'none',usage:{input_tokens:0,output_tokens:0},usage_scope:'task'}});assert.equal((await store.read(ws)).state.task_policy.used_calls,1);
await submit('held-model');assert.equal(await run('claim',{task_id:'held-model'}),null);
// HTTP allowlist and runner authentication support preflight without permitting unauthenticated access.
const req=(token,action)=>worker.fetch(new Request('https://fixture.test/api/task-runner',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({workspace:ws,action,task_id:'held-model',runner_id:'fixture'})}),{DB:db,RUNNER_TOKEN:'fixture-secret'});
assert.equal((await req('wrong','preview')).status,403);const http=await req('fixture-secret','preview');assert.equal(http.status,200);assert((await http.json()).result.task.id==='held-model');
console.log('Passed preflight without claims/cost, script-only library delivery, idempotent receipt, model budget separation, role checks and authenticated runner preview.');
// Warn only above 1 MB; oversized inputs still complete and consume only their normal call.
await run('configure',{client_id:'size-warning',enabled:true,research_enabled:true,max_model_calls:5,scope:'Isolated size-warning fixtures'},'director');
for(const [i,bytes] of [92000,144000,1000000,1000003,1500000].entries()){
 const id='size-'+i;await submit(id);const packet=await run('claim',{task_id:id});
 await run('complete',{...packet.claim,completion_id:id+':done',result:{outcome:'completed',summary:'Size fixture',body:'Complete saved response.',requests:[],artifacts:[{path:'/tmp/fixture/result.json',sha256:'0'.repeat(64),bytes:1}],prompt_bytes:bytes,prompt_characters:Math.floor(bytes/3)}});
 const state=(await store.read(ws)).state;assert.equal(state.tasks.find(t=>t.id===id).status,'completed');assert.equal(state.task_policy.used_calls,i+1);assert.equal(state.warnings.some(w=>w.key==='task-large-packet'&&w.status==='open'),bytes>1000000);
}
console.log('Passed exact 1 MB byte-warning boundary and successful delivery above it.');
