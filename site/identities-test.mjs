import assert from 'node:assert/strict';
import {cats,catFor,agentName} from './identities.mjs';
import {assets} from './generated.mjs';
import {seeds} from './fixtures/seeds.mjs';
import {adapter} from './tests.mjs';
import worker from './worker.mjs';
import {Store} from './store.mjs';

assert.equal(cats.length,12);
assert.deepEqual(cats.map(c=>c.name),['Alugalug','George Rufus','Chai Kichi','Johnson','Billy','Leo','Serafino','Cala','Maodie','Comet','Norma','Potato']);
const roster=Array.from({length:14},(_,i)=>({id:'agent-'+i,name:'Original '+i,status:i===0?'closed':'working'}));
const original=JSON.stringify(roster);
assert.equal(new Set(roster.slice(0,12).map(a=>catFor(a,roster).id)).size,12);
assert.equal(agentName(roster[10],roster),'Norma');
assert.equal(agentName(roster[11],roster),'Potato');
assert.equal(catFor(roster[12],roster),null);
assert.equal(agentName(roster[12],roster),'Original 12');
assert.equal(catFor({id:'missing'},roster),null);
assert.equal(agentName(roster[0],roster),'Alugalug'); // Stopping a task does not recycle its portrait.
assert.equal(agentName(roster[2],roster.slice(0,3)),agentName(roster[2],roster));
assert.equal(JSON.stringify(roster),original);
for(const c of cats){
 assert.match(c.name,/^[A-Z][a-z]+(?: [A-Z][a-z]+)*$/);
 assert.ok(assets[c.image]);
 const result=await worker.fetch(new Request('http://test'+c.image),{});
 assert.equal(result.status,200);
 const bytes=new Uint8Array(await result.arrayBuffer());
 assert.ok(bytes.length>1000);
 assert.equal(bytes[0],c.image.endsWith('.png')?137:255);
 for(const source of [c.source,c.extraSource].filter(Boolean))assert.equal(new URL(source.url).protocol,'https:');
}
const env={DB:adapter()};await new Store(env.DB,seeds).init();
const get=async path=>worker.fetch(new Request('http://test'+path),env);
const before=(await (await get('/api/state?workspace=example')).json()).state;
const report=before.reports[0],author=before.agents.find(a=>a.id===report.agent_id);
const slides=await (await get('/slides/'+report.id+'?workspace=example')).text();
assert.ok(slides.includes(agentName(author,before.agents)+' ·'));
const exported=await (await get('/reports/'+report.id+'?workspace=example')).json();
assert.equal(exported.workspace_id,'example');assert.deepEqual(exported.earlier_reports,[]);
const {workspace_id,earlier_reports,...saved}=exported;assert.deepEqual(saved,report);
assert.deepEqual((await (await get('/api/state?workspace=example')).json()).state,before);
assert.ok(cats[9].byline.includes('Male'));assert.ok(cats[10].byline.includes('Female'));
// Dismissal releases a presentation identity, never its scientific record or permission.
const db=adapter(),store=new Store(db,seeds);await store.init();
const beforeDismissal=(await store.read('example')).state;
const old=beforeDismissal.agents[0],oldName=agentName(old,beforeDismissal.agents);
const dismiss={action:'dismiss_agent',agent_id:old.id,reason:'This specialty is not needed for the selected direction.',handover:'projects/example/workspace/researchers/original/handover.md'};
await assert.rejects(()=>store.apply('example',dismiss,'worker'));
await assert.rejects(()=>store.apply('example',{...dismiss,handover:''},'director'));
await store.apply('example',dismiss,'director');
const afterDismissal=(await store.read('example')).state;
assert.equal(afterDismissal.agents[0].status,'closed');
assert.deepEqual(afterDismissal.reports,beforeDismissal.reports);
const newAgent=await store.apply('example',{action:'add_agent',name:'Replacement specialist',specialty:'New expertise',question:'The same selected question',plan:['Prepare a proposal']},'director');
const after=(await store.read('example')).state;
assert.notEqual(old.id,newAgent.id);assert.equal(newAgent.status,'planned');
assert.equal(newAgent.feedback,null);assert.equal(newAgent.latest_report,null);
assert.equal(agentName(newAgent,after.agents),oldName);
assert.equal(agentName(after.agents[0],after.agents),oldName);
assert.deepEqual(after.agents.slice(1,-1).map(a=>agentName(a,after.agents)),beforeDismissal.agents.slice(1).map(a=>agentName(a,beforeDismissal.agents)));
assert.equal((await store.apply('example',{action:'heartbeat',agent_id:newAgent.id},'worker')).allowed,false);
for(const action of ['claim','begin_report','research_update','report'])await assert.rejects(()=>store.apply('example',{action,agent_id:old.id},'worker'));
await assert.rejects(()=>store.apply('example',{action:'review',agent_id:old.id,report_id:old.latest_report,decision:'revise_report'},'director'));
const loaded=(await new Store(db,seeds).read('example')).state;
assert.equal(agentName(loaded.agents.at(-1),loaded.agents),oldName);
const oldSlides=await (await worker.fetch(new Request('http://test/slides/'+old.latest_report+'?workspace=example'),{DB:db})).text();
assert.ok(oldSlides.includes(oldName+' ·'));
// Retrying dismissal cannot release or rename its replacement.
await store.apply('example',dismiss,'director');
const another=await store.apply('example',{action:'add_agent',name:'Another specialist',specialty:'Different expertise',question:'Same question',plan:['Prepare a proposal']},'director');
assert.notEqual(another.dashboard_cat_id,newAgent.dashboard_cat_id);
// Running/queued work cannot be dismissed, even if a card happens to say paused.
for(const fixture of [
 {...beforeDismissal,agents:beforeDismissal.agents.map(a=>a.id===old.id?{...a,status:'working'}:a)},
 {...beforeDismissal,execution_jobs:[{agent_id:old.id,status:'queued'}]},
 {...beforeDismissal,execution_rounds:[{status:'research',owner_ids:[old.id]}]},
 {...beforeDismissal,review_questions:[{agent_id:old.id,replies:[],delivery:{status:'queued'}}]}
]){
 const s=new Store(adapter(),{example:fixture});await s.init();
 await assert.rejects(()=>s.apply('example',dismiss,'director'));
 assert.equal((await s.read('example')).state.agents[0].dismissal,undefined);
}
// A paused agent reserves its portrait. Allocation remains unique under concurrent adds.
const pair=await Promise.all(['One','Two'].map(name=>store.apply('example',{action:'add_agent',name:'Concurrent '+name,specialty:'Check',question:'Same question',plan:['Prepare']},'director')));
assert.notEqual(pair[0].dashboard_cat_id,pair[1].dashboard_cat_id);
const final=(await store.read('example')).state;
const activeCats=final.agents.filter(a=>!a.dismissal).map(a=>catFor(a,final.agents)?.id).filter(Boolean);
assert.equal(new Set(activeCats).size,activeCats.length);
assert.deepEqual(final.reports,beforeDismissal.reports);
console.log('PASS: reusable names only on dismissal, stable historical authors, paused-name reservation, fresh IDs and permissions, restart persistence, safe dismissal boundaries, concurrent allocation, overflow fallback, and image routes.');
