import assert from 'node:assert/strict';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
import {usageSummary,usageWarnings} from './usage.mjs';
import {changeWarning} from './warnings.mjs';
const db=adapter(),store=new Store(db,seeds),ws='usage-fixture';await store.init();
await store.apply(ws,{action:'create_project',name:'Usage fixture'},'director');
const a=await store.apply(ws,{action:'add_agent',name:'Researcher',role:'researcher',specialty:'Fixture',question:'Fixture',plan:['Fixture']},'director');
const run=(action,p={},role='task_runner')=>store.apply(ws,{action:'task',task_action:action,runner_id:'fixture',...p},role);
await run('configure',{client_id:'usage-policy',enabled:true,research_enabled:true,max_model_calls:1,scope:'Fixture only'},'director');
assert.equal((await store.read(ws)).state.task_policy.usage_mode,'warn');
for(let i=0;i<2;i++){
 await run('submit',{id:'task-'+i,agent_id:a.id,kind:'question',prompt:'Fixture '+i,summary:'Fixture'},'director');
 const ready=await run('poll');assert.equal(ready.ready.length,1);
 const p=await run('claim',{task_id:'task-'+i});assert(p);
 const result={outcome:'completed',summary:'Saved fixture',body:'Fixture',artifacts:[{path:'/tmp/fixture.json',sha256:'0'.repeat(64),bytes:1}],requests:[],usage_scope:'task',usage:{input_tokens:700000,cached_input_tokens:600000,output_tokens:400000}};
 const done={...p.claim,completion_id:'done-'+i,result};await run('complete',done);await run('complete',done);
}
let s=(await store.read(ws)).state;assert.equal(s.task_policy.used_calls,2);assert.equal(usageSummary(s).total_tokens,2200000);assert.equal(usageSummary(s).cached_input_tokens,1200000);
assert(!(s.warnings||[]).some(w=>['usage-tokens','usage-calls'].includes(w.key)));
const count=s.events.length;await run('poll');await run('poll');assert.equal((await store.read(ws)).state.events.length,count);
s.tasks.push({result:{usage_scope:'unknown',usage:{input_tokens:9000000}}});assert.equal(usageSummary(s).total_tokens,2200000);assert.equal(usageSummary(s).unknown_tasks,1);
console.log('Passed usage counters without warnings, continued claims, exact per-task token totals, unknown usage and duplicate delivery/poll handling.');

changeWarning(s,{action:'raise',key:'usage-calls',reporter:'Old service',title:'Old usage warning',symptom:'Many calls',impact:'Counter only',suggestion:'Keep working',evidence:[{note:'Old count',source:'tasks:'+ws}]});
usageWarnings(s);assert.equal(s.warnings.find(w=>w.key==='usage-calls').status,'resolved');
const events=s.events.length;usageWarnings(s);assert.equal(s.events.length,events);
