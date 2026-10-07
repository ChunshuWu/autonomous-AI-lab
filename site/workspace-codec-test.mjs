import assert from 'node:assert/strict';
import fs from 'node:fs';
import {encodeWorkspace,decodeWorkspace} from './workspace-codec.mjs';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
const unusual={text:'\u001f17',nested:{literal:'\u001fnot-a-reference'},unicode:'猫 🐈 — α',null:null,number:3,flag:false};
const long='Full unchanged evidence: 猫 🐈 — α. '.repeat(3500),sample={project:{id:'codec-fixture'},agents:[],unusual,tasks:Array.from({length:90},(_,i)=>({id:String(i),document:long,context:long+'Tail '+i}))};
const encoded=await encodeWorkspace(sample);
assert(Buffer.byteLength(JSON.stringify(sample))>2000000);assert(Buffer.byteLength(encoded)<2000000);assert.deepEqual(await decodeWorkspace(encoded),sample);assert.deepEqual(await decodeWorkspace(JSON.stringify(sample)),sample);
const tiny={project:{id:'small'},agents:[]};assert.equal(await encodeWorkspace(tiny),JSON.stringify(tiny));
await assert.rejects(()=>decodeWorkspace(JSON.stringify({...JSON.parse(encoded),payload:'broken'})));
const db=adapter(),store=new Store(db,seeds);await store.init();
await store.apply('codec-project',{action:'create_project',name:'Storage test'},'director');
const initial=(await store.read('codec-project')).state;initial.evidence=sample;
await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(initial),'codec-project').run();
await Promise.all([store.apply('codec-project',{action:'direction',text:'First saved instruction'},'director'),store.apply('codec-project',{action:'direction',text:'Second saved instruction'},'director')]);
const saved=await store.read('codec-project');assert.equal(saved.state.direction_revision,3);assert.deepEqual(saved.state.evidence,sample);
const raw=await db.prepare('SELECT document FROM workspaces WHERE name=?').bind('codec-project').first();assert.equal(JSON.parse(raw.document)._wulab_storage,'wulab-gzip-intern-v1');assert((await store.projects()).some(p=>p.id==='codec-project'));
await new Store(db,seeds).init();assert.deepEqual((await store.read('codec-project')).state,saved.state);
await store.archiveProject('codec-project',{reason:'Test archive'},'director');
const backup=await db.prepare('SELECT value FROM settings WHERE name=?').bind('archive:manual:codec-project:'+saved.revision).first();assert.deepEqual(await decodeWorkspace(backup.value),saved.state);
const archived=await store.read('codec-project');await store.clearProject('codec-project',{reason:'Test clear'},'director');
const recovery=await db.prepare('SELECT value FROM settings WHERE name=?').bind('cleared:codec-project:'+archived.revision).first();assert.deepEqual(await decodeWorkspace(recovery.value),archived.state);
assert((await store.read('codec-project')).state.project.cleared_at);
console.log('Passed lossless large and legacy workspaces, Unicode and literal markers, concurrent updates, listing, restart, corrupted-input rejection, independent archives and clear recovery.');
// Optionally reproduce the actual stopped checkpoint without touching the live service.
if(process.env.WULAB_CHECKPOINT_FIXTURE){
 const actual=JSON.parse(fs.readFileSync(process.env.WULAB_CHECKPOINT_FIXTURE,'utf8')),name=actual.project.id;
 await db.prepare('INSERT INTO workspaces(name,document,revision) VALUES(?,?,1)').bind(name,JSON.stringify(actual)).run();
 const ready=await store.apply(name,{action:'task',task_action:'poll',runner_id:'storage-fixture'},'task_runner');
 const after=(await store.read(name)).state;assert.equal(after.workflow.checkpoint,actual.workflow.checkpoint+1);assert(ready.ready.some(t=>t.id===after.workflow.chair_task));
 for(const old of actual.tasks.filter(t=>t.status==='completed'))assert.deepEqual(after.tasks.find(t=>t.id===old.id).result,old.result);
 const row=await db.prepare('SELECT document FROM workspaces WHERE name=?').bind(name).first();assert(Buffer.byteLength(row.document)<2000000);
 const count=after.tasks.length;await store.apply(name,{action:'task',task_action:'poll',runner_id:'storage-fixture'},'task_runner');assert.equal((await store.read(name)).state.tasks.length,count);
 console.log('Passed actual checkpoint recovery, unchanged completed results, one next chair, repeat-poll idempotence, and saved record below 2 MB:',Buffer.byteLength(row.document),'bytes.');
}
