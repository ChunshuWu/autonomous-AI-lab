import assert from 'node:assert/strict';
import {deputyFixture} from './deputy-fixture.mjs';
import {timelineEntries} from './timeline.mjs';
const f=await deputyFixture(),before=structuredClone(f.state),body={action:'activity',agent_id:f.agents[0].id,client_id:'saved-meeting',kind:'meeting',summary:'Compared the two reading questions; the source check is still needed.',report_id:f.report.id,evidence:[{note:'Saved meeting note',source:'coordination/meeting.md'}]};
const record=await f.store.apply(f.workspace,body,'worker');assert(record.at);const duplicate=await f.store.apply(f.workspace,body,'worker');assert.equal(duplicate.id,record.id);
await assert.rejects(()=>f.store.apply(f.workspace,{...body,summary:'A different outcome'},'worker'),/different event/);
await assert.rejects(()=>f.store.apply(f.workspace,{...body,client_id:'oversized',summary:'x'.repeat(281)},'worker'),/280/);
await assert.rejects(()=>f.store.apply(f.workspace,{...body,client_id:'foreign',report_id:'foreign-report'},'worker'));
const state=(await f.store.read(f.workspace)).state;
assert.equal(state.agents.find(a=>a.id===body.agent_id).last_seen,record.at);
const agentsWithoutSeen=rows=>rows.map(({last_seen,...a})=>a);assert.deepEqual(agentsWithoutSeen(state.agents),agentsWithoutSeen(before.agents));
for(const key of ['reports','paused','decisions','research_map'])assert.deepEqual(state[key],before[key],key);
const snapshot=structuredClone(state),entries=timelineEntries(state);assert(entries.some(e=>e.kind==='report'&&e.report_id===f.report.id));assert.equal(entries.filter(e=>e.id===record.id).length,1);
assert(entries.every((e,i)=>!i||Date.parse(entries[i-1].at)>=Date.parse(e.at)));assert(entries.every(e=>e.description&&e.at&&e.actor));assert.deepEqual(state,snapshot);
assert.deepEqual(timelineEntries({}),[]);
console.log('PASS: factual timeline, saved report links, stable chronology, retry deduplication, project boundaries, and no permission changes.');

// Show the activity in ordinary words without rewriting the saved evidence.
const history={events:[
 {id:'start',at:'2026-10-06T09:00:00Z',actor:'Researcher',kind:'task',task_id:'revision',text:'Started: Isolate correction-relevant chronology headroom.'},
 {id:'finish',at:'2026-10-06T09:01:00Z',actor:'Researcher',kind:'task',task_id:'revision',text:'Finished: Isolate correction-relevant chronology headroom. — A truncated'},
 {id:'blocked',at:'2026-10-06T09:02:00Z',actor:'Engineer',kind:'task',task_id:'check',text:'Finished: Numerical check — Missing data.'},
 {id:'checkpoint',at:'2026-10-06T09:03:00Z',actor:'Orchestrator',kind:'coordination',text:'Checkpoint complete: Proposal / response / round 1.'}
],tasks:[
 {id:'revision',kind:'meeting',summary:'Isolate correction-relevant chronology headroom.',workflow_context:{phase:'response',stage:'Proposal'},result:{summary:'Complete saved detail, including the final limitation.',outcome:'completed',body:'The scientific answer stays unchanged.'}},
 {id:'check',kind:'engineering',result:{summary:'Missing data.',outcome:'blocked'}}
]};
const original=structuredClone(history),plain=timelineEntries(history);
assert.match(plain.find(x=>x.id==='start').description,/revise.*proposal.*feedback/);
assert(!plain.find(x=>x.id==='finish').description.includes('chronology'));
assert.equal(plain.find(x=>x.id==='finish').task_id,'revision');
assert(plain.find(x=>x.id==='finish').detail.endsWith('final limitation.'));
assert.match(plain.find(x=>x.id==='blocked').description,/Could not finish/);
assert.equal(plain.find(x=>x.id==='blocked').kind,'obstacle');
assert.match(plain.find(x=>x.id==='checkpoint').description,/Everyone has revised/);
assert.deepEqual(history,original);
history.tasks[0].writing_guidance_version='simple-language-v1';history.tasks[0].result.summary='I revised the proposal. The test has not run yet.';
assert.equal(timelineEntries(history).find(x=>x.id==='finish').description,history.tasks[0].result.summary);
history.tasks[0].kind='vote';history.tasks[0].result.summary='Voted for candidate 1.';
assert.equal(timelineEntries(history).find(x=>x.id==='finish').description,'Submitted a vote.');
console.log('PASS: readable task progress, complete linked details, honest blocked states, unchanged evidence and private votes.');
const durable={events:[{id:'saved-block',at:'2026-10-06T09:00:00Z',actor:'Researcher',kind:'obstacle',task_id:'fixed',text:'Task stopped: Missing file.'},{id:'manual-block',at:'2026-10-06T09:01:00Z',actor:'Researcher',kind:'status',text:'Missing paper.',status_content:{state:'blocked'}}],tasks:[{id:'fixed',status:'completed',kind:'research',result:{outcome:'completed',summary:'Fixed'}}]};
assert(timelineEntries(durable).every(e=>e.kind==='obstacle'&&e.blocked));
console.log('PASS: red blocker classification survives repair and includes direct agent status reports.');
