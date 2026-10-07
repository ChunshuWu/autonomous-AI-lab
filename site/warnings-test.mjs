import assert from 'node:assert/strict';
import {adapter} from './tests.mjs';
import {Store} from './store.mjs';
import {seeds} from './fixtures/seeds.mjs';
import {permission} from './logic.mjs';
import worker from './worker.mjs';

const db=adapter(),store=new Store(db,seeds);await store.init();
const state=async(project='example')=>(await store.read(project)).state;
const before=await state(),other=await state('live');
const warning={action:'raise',key:'meeting-loop-1',reporter:'Orchestrator',title:'Meetings repeat the same question',symptom:'Three fixture meetings repeated one question without new evidence or a decision.',impact:'The next study is still undefined.',suggestion:'End this discussion and bring the unresolved choice to the director.',certainty:'observed',agent_ids:[before.agents[0].id],evidence:[{note:'Fixture meeting summaries recorded the same unresolved question.',source:'workspace/discussions/fixture/summary.md'}]};
const post=(payload,project='example',role='observer')=>store.apply(project,payload,role);
for(const changes of [{evidence:[]},{evidence:[{note:'Only a claim'}]},{agent_ids:['foreign-agent']},{certainty:'certain'},{key:'bad key'},{evidence:[{note:'Bad link',source:'javascript:alert(1)'}]}])await assert.rejects(()=>post({...warning,...changes}));
assert.deepEqual(await state(),before);
await assert.rejects(()=>post({...warning,action:'review',decision:'continue'}));
await assert.rejects(()=>post({...warning,action:'confirm_topic',topic:'Not authorized'}));
await assert.rejects(()=>post({...warning,action:'create_project',name:'Not authorized'},'no-project'));
await assert.rejects(()=>post(warning,'example','worker'));
await assert.rejects(()=>post(warning,''));
await assert.rejects(()=>post(warning,'unknown'));
const first=await post(warning);assert.equal(first.status,'open');assert.equal(first.revision,1);
let current=await state();assert.equal(current.warnings.length,1);
const withoutWarnings=s=>{const copy=structuredClone(s);delete copy.warnings;copy.events=before.events;return copy;};
assert.deepEqual(withoutWarnings(current),before);
assert.deepEqual(await state('live'),other);
for(const a of current.agents)assert.deepEqual(permission(current,a),permission(before,before.agents.find(x=>x.id===a.id)));
const retry=await post(warning);assert.deepEqual(retry,first);assert.deepEqual(await state(),current);
const second=await post({...warning,symptom:'Four fixture meetings repeated the question.',evidence:[...warning.evidence,{note:'A fourth meeting reached no decision.',source:'workspace/discussions/fixture-4/summary.md'}]});
assert.equal(second.id,first.id);assert.equal(second.revision,2);assert.equal(second.history.length,2);assert.equal((await state()).warnings.length,1);
const resolution={action:'resolve',key:warning.key,reporter:'Orchestrator',expected_revision:1,resolution:'The team settled the question and ended the discussion.',evidence:[{note:'The final meeting note records the decision.',source:'workspace/discussions/fixture-decision/summary.md'}]};
await assert.rejects(()=>post(resolution));
const resolved=await post({...resolution,expected_revision:second.revision});assert.equal(resolved.status,'resolved');assert.equal(resolved.history.length,3);
assert.deepEqual(await post({...resolution,expected_revision:second.revision}),resolved);
// Replayed detection cannot resurrect a resolved warning without new evidence.
assert.deepEqual(await post({...warning,symptom:second.symptom,evidence:second.evidence}),resolved);
const reopened=await post({...warning,evidence:[{note:'A later, distinct meeting repeated the issue.',source:'workspace/discussions/fixture-new/summary.md'}]});
assert.equal(reopened.status,'open');assert.equal(reopened.id,first.id);assert.equal(reopened.history.at(-1).action,'reopen');
// Concurrent records use the existing store revision checks, not lost updates.
await Promise.all(['another-1','another-2'].map(key=>post({...warning,key})));
assert.equal((await state()).warnings.length,3);
assert.deepEqual(withoutWarnings(await state()),before);
await new Store(db,seeds).init();assert.equal((await state()).warnings.length,3);
// Agent API exposes a separate observation tool; no director instruction is fabricated.
const rpc=async(name,args)=>{
 const response=await worker.fetch(new Request('http://localhost/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),{DB:db});
 return (await response.json()).result;
};
const answer=await rpc('lab_warning',{workspace:'live',...warning,agent_ids:[]});assert.equal(answer.isError,undefined);
assert.equal(JSON.parse(answer.content[0].text).status,'open');
assert.equal((await rpc('lab_warning',{workspace:'live',action:'review',key:'test',reporter:'Agent'})).isError,true);
assert.equal((await state('live')).warnings.length,1);assert.deepEqual((await state('live')).agents,other.agents);assert.deepEqual((await state('live')).decisions,other.decisions);
console.log('PASS: warning evidence validation, deduplication, revisions, resolution, recurrence, concurrent saves, project isolation, persistent history, agent API, and unchanged research permissions.');
