import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
import {taskDocumentText,renderTaskDocument} from './documents.mjs';
import {recordDisplayVersion} from './record-handoff.mjs';
const db=adapter(),store=new Store(db,seeds),ws='record-handoff-check';await store.init();
await store.apply(ws,{action:'create_project',name:'Record handoff software test'},'director');
const engineer=await store.apply(ws,{action:'add_agent',role:'engineer',name:'Engineer',specialty:'Fixture',question:'Fixture',plan:['Fixture']},'director');
const run=(action,fields={},role='task_runner')=>store.apply(ws,{action:'task',task_action:action,runner_id:'fixture',...fields},role);
const state=async()=>(await store.read(ws)).state;
await run('configure',{client_id:'allow',enabled:true,research_enabled:true,max_model_calls:100,scope:'Software fixtures only'},'director');
const artifact={path:'/tmp/test-result.json',sha256:'1'.repeat(64),bytes:10};
async function finish(id,records,extra={}){
 await run('submit',{id,agent_id:engineer.id,kind:'engineering',prompt:'Software fixture',summary:'Software fixture'},'director');
 const p=await run('claim',{task_id:id});
 const result={outcome:'completed',summary:'Fixture complete',body:'Saved software-test result.',document:null,requests:[],artifacts:[artifact],records,...extra};
 const request={...p.claim,completion_id:id+':result',result};await run('complete',request);return request;
}
const records={schema_version:1,experiments:[{id:'example-experiment',task_id:'grouped',title:'A test result',summary:'Saved fixture values.',status:'completed',purpose:'Check the handoff.',setup:{shots:20,controls:['a','b']},results:{table:[{condition:0.1,score:0.123},{condition:0.5,score:0.456}],interpretation:'A software fixture, not a research claim.',uncertainty:'Not scientific evidence.'},cost:{wall_seconds:2},links:[{label:'Saved output',path:'/tmp/test-result.json'}]}]};
const req=await finish('grouped',records);let s=await state();
let t=s.tasks.find(t=>t.id==='grouped'),r=s.research_records.experiment[0];
assert.equal(t.status,'completed');assert.deepEqual(t.result.records,records);assert.equal(t.record_delivery.status,'delivered');assert.equal(r.figures[0].rows[1][1],0.456);assert.equal(r.figures[0].detail_only,true);assert(r.setup.includes('20'));assert.equal(r.uncertainty,records.experiments[0].results.uncertainty);assert(r.evidence.some(e=>e.source==='/tmp/test-result.json'));
await run('complete',req);assert.equal((await state()).research_records.experiment.length,1);
const valid={type:'experiment',expected_revision:0,record:{id:'valid-array',title:'Array format',summary:'Fixture',status:'completed',purpose:'Test',setup:'Fixture',results:'Saved result'}};
const bad={type:'experiment',record:{...valid.record,id:'bad-chart',figures:[{type:'table',title:'Bad fixture',caption:'Test',columns:['One'],rows:[[1,2]]}]}};
await finish('mixed',[valid,bad]);s=await state();t=s.tasks.find(t=>t.id==='mixed');
assert.equal(t.status,'completed');assert(t.records_handled);assert(!t.records_delivered);assert.equal(t.record_delivery.status,'display_pending');assert(s.research_records.experiment.some(r=>r.id==='valid-array'));assert(s.warnings.some(w=>w.key==='task-display-repair'&&w.status==='open'));
assert(taskDocumentText(t).includes('bad-chart'));assert(renderTaskDocument(t,'Engineer',ws).includes('Saved details awaiting display repair'));
await finish('unknown-shape','{malformed record', {document:'x'.repeat(30001),summary:'Summary '.repeat(300),body:'Evidence '.repeat(1600)});t=(await state()).tasks.find(t=>t.id==='unknown-shape');assert.equal(t.status,'completed');assert.equal(t.result.document.length,30001);assert(taskDocumentText(t).includes('{malformed record'));
// Presentation problems cannot promote a blocked scientific outcome to completed.
await finish('science-block',{}, {outcome:'blocked',summary:'Input data are missing.'});assert.equal((await state()).tasks.find(t=>t.id==='science-block').status,'failed');
// Exercise the actual grouped engineer output, when supplied, without executing its code.
if(process.env.WULAB_ENGINEERING_RECORDS){
 const actual=JSON.parse(fs.readFileSync(process.env.WULAB_ENGINEERING_RECORDS,'utf8'));
 const record=actual.experiments[0];
 await store.apply(ws,{action:'upsert',actor:'Fixture',expected_revision:0,nodes:[{id:record.proposal_id,title:'Fixture proposal',summary:'Software check'}]},'mapper');
 await store.apply(ws,{action:'record_upsert',type:'method',agent_id:engineer.id,expected_revision:0,record:{id:record.method_id,title:'Fixture method',summary:'Software check',proposal_ids:[record.proposal_id]}},'worker');
 await finish(record.task_id,actual);s=await state();t=s.tasks.find(t=>t.id===record.task_id);r=s.research_records.experiment.find(r=>r.id===record.id);
 assert.equal(t.record_delivery.status,'delivered');assert.deepEqual(t.result.records,actual);assert.equal(r.figures[0].rows.length,2);assert.equal(r.status,'completed');
 assert.equal(r.figures[0].rows[0][r.figures[0].columns.indexOf('History vs stationary mixture reduction')],0);
}
console.log('Passed grouped/array records, structured results and figures, raw-output preservation, non-blocking display errors, long text, idempotence and genuine blocked outcomes.');
// The former 512 KB request cutoff must not reject a complete saved report.
{
 const {default:worker}=await import('./worker.mjs');
 await run('submit',{id:'large-saved-report',agent_id:engineer.id,kind:'engineering',prompt:'Fixture',summary:'Large saved report'},'director');
 const p=await run('claim',{task_id:'large-saved-report'}),document='Complete evidence. '.repeat(35000);
 const payload={workspace:ws,action:'complete',...p.claim,completion_id:'large-saved-report:result',result:{outcome:'completed',summary:'Large fixture',body:'Saved evidence follows.',document,requests:[],artifacts:[artifact],records:[]}};
 const response=await worker.fetch(new Request('http://local/api/task-runner',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(payload)}),{DB:db,RUNNER_TOKEN:'fixture'});
 assert.equal(response.status,200,await response.clone().text());assert.equal((await state()).tasks.find(t=>t.id==='large-saved-report').result.document,document);
 console.log('Passed complete report delivery above the old 512 KB request cutoff.');
}

// Repair old blocked-experiment displays without rerunning work or changing its outcome.
{
 const raw={experiments:[{id:'missing-input-report',task_id:'missing-input-task',title:'Inputs unavailable',summary:'No calculation was run.',status:'blocked',purpose:'Use earlier code',setup:{run:'Not started'},results:null,cost:null,evidence:['test-result.json']}]};
 const request=await finish('missing-input-task',raw,{outcome:'blocked'});let saved=await state(),task=saved.tasks.find(t=>t.id==='missing-input-task');
 assert.equal(task.record_delivery.status,'delivered');assert.equal(task.status,'failed');assert.deepEqual(task.result.records,raw);
 let record=saved.research_records.experiment.find(r=>r.id==='missing-input-report');assert.equal(record.status,'stopped');assert.equal(record.results,undefined);assert.equal(record.cost,undefined);assert.equal(record.evidence[0].source,'/tmp/test-result.json');
 // Replay state written by the earlier renderer. First poll repairs it; later polls do not create duplicates.
 saved.research_records.experiment=saved.research_records.experiment.filter(r=>r.id!==record.id);task.record_delivery={status:'display_pending',records:[],errors:[{index:0,message:'Provide an evidence description.'}]};
 const original=JSON.stringify(task.result),calls=saved.task_policy.used_calls;
 await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),ws).run();
 await run('poll');await run('poll');saved=await state();task=saved.tasks.find(t=>t.id==='missing-input-task');
 assert.equal(task.record_delivery.status,'delivered');assert.equal(task.record_delivery.display_version,recordDisplayVersion);assert.equal(JSON.stringify(task.result),original);assert.equal(task.status,'failed');assert.equal(saved.task_policy.used_calls,calls);assert.equal(saved.research_records.experiment.filter(r=>r.id===record.id).length,1);
 assert.equal(saved.tasks.find(t=>t.id==='mixed').record_delivery.records.length,1);assert.equal(saved.tasks.find(t=>t.id==='mixed').record_delivery.display_version,recordDisplayVersion);assert.equal(saved.tasks.find(t=>t.id==='mixed').record_delivery.status,'display_pending');
 console.log('Passed automatic display repair, local evidence links, honest stopped status, omitted empty metrics, unchanged scientific results, no model calls and no duplicate records.');
}

// Long numerical evidence used to fail both the field limit and the required-results check.
{
 const results='A saved calculation with exact bounds.\n'.repeat(2000),raw=[{type:'experiment',record:{id:'long-details',title:'Full numerical evidence',summary:'Short readable result.',status:'completed',purpose:'Preserve evidence',setup:'Saved calculation',results}}];
 await finish('long-details-task',raw);let saved=await state(),task=saved.tasks.find(t=>t.id==='long-details-task');
 assert.equal(task.record_delivery.status,'delivered');assert.equal(saved.research_records.experiment.find(r=>r.id==='long-details').results,results);
 const original=JSON.stringify(task.result),calls=saved.task_policy.used_calls;
 saved.research_records.experiment=saved.research_records.experiment.filter(r=>r.id!=='long-details');
 task.record_delivery={status:'display_pending',records:[],errors:[{index:0,message:'Use text for results.'}],display_version:2};
 await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),ws).run();
 await run('poll');await run('poll');saved=await state();task=saved.tasks.find(t=>t.id==='long-details-task');
 assert.equal(task.record_delivery.status,'delivered');assert.equal(task.record_delivery.display_version,recordDisplayVersion);assert.equal(JSON.stringify(task.result),original);assert.equal(saved.task_policy.used_calls,calls);
 assert.equal(saved.research_records.experiment.filter(r=>r.id==='long-details').length,1);assert.equal(saved.research_records.experiment.find(r=>r.id==='long-details').results,results);
 console.log('Passed long experiment details and automatic repair with unchanged evidence, no model calls and no duplicate records.');
}

// Missing record summaries reuse the confirmed task summary. Existing restored records
// are adopted only when source, owner and scientific content match exactly.
{
 const raw={experiments:[{id:'summary-missing',title:'Saved input check',task_id:'summary-missing-task',purpose:'Validate earlier inputs',setup:'Read-only check',status:'stopped',results:{failures:0,decoded_shots:0},cost:{seconds:0.25}}]};
 await finish('summary-missing-task',raw,{summary:'Validation stopped; inputs are unavailable.'});let saved=await state(),task=saved.tasks.find(t=>t.id==='summary-missing-task'),record=saved.research_records.experiment.find(r=>r.id==='summary-missing');
 assert.equal(task.record_delivery.status,'delivered');assert.equal(record.summary,task.result.summary);assert.equal(record.status,'stopped');assert.deepEqual(task.result.records,raw);
 // Simulate a director's faithful restoration from JSON, before renderer migration.
 record.summary='Director restored the original stopped finding.';record.results='```json\n'+JSON.stringify(raw.experiments[0].results,null,2)+'\n```';record.cost='```json\n'+JSON.stringify(raw.experiments[0].cost,null,2)+'\n```';
 const original=JSON.stringify(task.result),originalRecord=JSON.stringify(record),calls=saved.task_policy.used_calls;
 task.record_delivery={status:'display_pending',records:[],errors:[{message:'Provide a short summary.'}],display_version:3};
 await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),ws).run();
 await run('poll');await run('poll');saved=await state();task=saved.tasks.find(t=>t.id==='summary-missing-task');
 assert.equal(task.record_delivery.status,'delivered');assert.equal(task.record_delivery.records.length,1);assert.equal(JSON.stringify(task.result),original);assert.equal(JSON.stringify(saved.research_records.experiment.find(r=>r.id===record.id)),originalRecord);assert.equal(saved.task_policy.used_calls,calls);
 // The same ID is insufficient when the displayed result differs.
 saved.research_records.experiment.find(r=>r.id===record.id).results='Conflicting result';task.record_delivery={status:'display_pending',records:[],errors:[],display_version:3};
 await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),ws).run();await run('poll');saved=await state();
 assert.equal(saved.tasks.find(t=>t.id===task.id).record_delivery.status,'display_pending');assert.equal(saved.research_records.experiment.find(r=>r.id===record.id).results,'Conflicting result');
 console.log('Passed missing summary fallback, stopped findings, version-3 migration, faithful manual restorations, conflicting-record protection and no repeated work.');
}
