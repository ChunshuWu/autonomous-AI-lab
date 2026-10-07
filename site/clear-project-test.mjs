import assert from 'node:assert/strict';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
import worker from './worker.mjs';
const db=adapter(),store=new Store(db,seeds);await store.init();
await store.apply('old-study',{action:'create_project',name:'Old study'},'director');
const researcher=await store.apply('old-study',{action:'add_agent',name:'Researcher',role:'researcher',specialty:'Test',question:'Test',plan:['Saved work']},'director');
const old=(await store.read('old-study')).state,library=await store.library();
await assert.rejects(()=>store.apply('old-study',{action:'clear_project',reason:'Fresh start'},'worker'));
await assert.rejects(()=>store.apply('old-study',{action:'clear_project',reason:'Fresh start'},'director'),/archive/);
for(const p of await store.projects({includeArchived:true})){
 await store.apply(p.id,{action:'archive_project',reason:'Requested fresh dashboard'},'director');
 await store.apply(p.id,{action:'clear_project',reason:'Clear current and archived dashboards'},'director');
}
assert.deepEqual(await store.projects({includeArchived:true}),[]);
assert.deepEqual(await store.library(),library);
const cleared=(await store.read('old-study')).state;
assert(cleared.project.cleared_at);assert.equal(cleared.agents.length,0);assert.equal(cleared.events.length,0);
assert.equal(cleared.reports.length,0);assert(!cleared.tasks);assert(!cleared.workflow);
const rows=await db.prepare('SELECT name,value FROM settings').all();
const backup=JSON.parse(rows.results.find(r=>r.name.startsWith('cleared:old-study:')).value);
assert.equal(backup.agents[0].id,researcher.id);
await store.apply('old-study',{action:'clear_project',reason:'Retry same request'},'director');
await assert.rejects(()=>store.apply('old-study',{action:'resume_lab'},'director'));
await new Store(db,seeds).init();assert.deepEqual(await store.projects({includeArchived:true}),[]);
await store.apply('fresh-study',{action:'create_project',name:'Shot history'},'director');
const librarian=await store.apply('fresh-study',{action:'add_agent',name:'Librarian',role:'librarian',specialty:'Sources',question:'Find saved papers',plan:['Wait']},'director');
assert.equal(librarian.dashboard_cat_id,old.agents[0].dashboard_cat_id);
// Sources remain reusable with references to the cleared project.
await store.saveLibrary('fresh-study',{agent_id:librarian.id,expected_revision:0,item:{id:'history-provenance',kind:'notes',title:'Source with past use',summary:'Saved evidence',source:'https://example.org/source',project_ids:['old-study','fresh-study']}});
assert((await store.library()).items.find(i=>i.id==='history-provenance').project_ids.includes('old-study'));
const response=await worker.fetch(new Request('http://local/api/state?workspace=old-study'),{DB:db});
const view=await response.json();assert.equal(view.state.project.id,'fresh-study');assert.equal(view.archives.length,0);
console.log('Passed clearing current/archive views, hidden recovery, preserved library/provenance/cats, idempotence, restart persistence and old-tab fallback.');
