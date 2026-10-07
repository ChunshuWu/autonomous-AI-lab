import assert from 'node:assert/strict';
import {decideHumanMeeting,workflowTick} from './workflow.mjs';
import {taskAction,rejectedCandidates} from './tasks.mjs';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
const db=adapter();let store=new Store(db,seeds);await store.init();
const name='human-meeting-fixture';await store.apply(name,{action:'create_project',name:'Meeting software test',topic:'Fictional example; no science claims'},'director');
let count=0;const add=role=>store.apply(name,{action:'add_agent',name:role+'-'+(++count),role,specialty:role,question:'Fixture only',plan:['Check the meeting flow']},'director');
const o=await add('orchestrator'),researchers=[await add('researcher'),await add('researcher'),await add('researcher')],engineer=await add('engineer'),math=await add('mathematician'),lib=await add('librarian');
await store.apply(name,{action:'assign_orchestrator',agent_id:o.id},'director');
const run=(action,p={},role='task_runner')=>store.apply(name,{action:'task',task_action:action,runner_id:'fixture',...p},role);
await run('configure',{client_id:'allow',enabled:true,research_enabled:true,max_model_calls:100,usage_mode:'warn',scope:'Software fixtures only'},'director');
const config={action:'workflow',id:name,researcher_ids:researchers.map(a=>a.id),engineer_id:engineer.id,mathematician_id:math.id,librarian_id:lib.id,max_rounds:3,max_cycles:1,max_checkpoints:40,waiting_minutes:5,resource_brief:'No real experiments; software test fixtures.'};
await store.apply(name,config,'director');await store.apply(name,config,'director');
const state=async()=>(await store.read(name)).state;
const ready=async()=>{store=new Store(db,seeds);const tasks=(await run('poll')).ready;return Promise.all(tasks.map(t=>run('claim',{task_id:t.id})));};
const art={path:'/tmp/fixture/result.json',sha256:'1'.repeat(64),bytes:20};
async function finish(p,extra={}){return run('complete',{...p.claim,completion_id:p.task.id+':done',result:{outcome:'completed',summary:'Saved software fixture',body:'Fixture evidence only.',requests:[],artifacts:[art],...extra}});}
const presentation={question:'Can earlier examples help?',prior_work:'A fixed rule uses each example alone.',gap:'It may miss a recent change.',factor:'Use a summary of earlier examples.',support:'Earlier changes may persist; this is untested.',outcome:'Count mistakes on new examples.',conditions:'Use the same held-out examples.'};
async function selection(){
 let batch=await ready();assert.equal(batch.length,3);for(const p of batch){assert(['proposal','research'].includes(p.task.kind));const extra=p.task.kind==='research'?{experiment:{data:'Synthetic sequence with a fixed seed; no external data.',method:'Update the weight from the last ten examples.',setup:'Compare against a fixed weight on the same later examples.',expected_outcome:'Fewer mistakes if the change persists; otherwise no gain.',learning:'Tests whether recent history adds information.'}}:{};await finish(p,{document:'# Can earlier examples help?\nFull candidate with fixture settings.',presentation:{...presentation,...extra},artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});}
 batch=await ready();assert.equal(batch.length,1);assert.equal(batch[0].task.handler,'library_collect');await finish(batch[0],{handler:'library_collect'});
 batch=await ready();assert.equal(batch.length,5);assert(batch.some(p=>p.agent.role==='engineer'));assert(batch.some(p=>p.agent.role==='mathematician'));for(const p of batch){assert.equal(p.workflow_context.phase,'critique');assert.equal(p.documents.length,3);await finish(p,{body:'One specific concern about the setup.'});}
 batch=await ready();assert.equal(batch.length,3);for(let i=0;i<batch.length;i++){const p=batch[i];assert.equal(p.task.kind,'vote');assert.equal(p.documents.length,5,'Every voter gets engineer and mathematician advice');await finish(p,{body:JSON.stringify({choice:i===0?p.decision_packet.options[0]:'none_is_ready',reason:'Useful next test, with uncertainty.'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});}
 assert.equal((await ready()).length,0);const s=await state();assert.equal(s.workflow.status,'awaiting_director');assert.equal(s.workflow.configuration.max_rounds,1);assert(!s.tasks.some(t=>t.workflow_context?.phase==='response'));assert.equal(s.research_records.meeting.at(-1).participant_ids.length,6);return s;
}
function rejectionCheck(original){
 const s=structuredClone(original),w=s.workflow,m=s.research_records.meeting.at(-1),stage=w.stage;
 const candidateIds=(stage==='Proposal'?m.proposal_ids:m.method_ids).slice();
 const list=stage==='Proposal'?s.research_map.nodes:s.research_records.method;
 const other=structuredClone(list.find(n=>n.id===candidateIds[0]));other.id='unrelated-saved-candidate';list.push(other);
 const votes=JSON.stringify(m.votes),evidence=JSON.stringify(m.presentations),selected=w.selected_proposal;
 const request={meeting_id:m.id,expected_revision:m.revision,client_id:'reject-all',next_step:'design',comment:'Read more broadly before proposing another option.'};
 const decision=decideHumanMeeting(s,request,'director');
 const current=stage==='Proposal'?s.research_map.nodes:s.research_records.method;
 assert(candidateIds.every(id=>current.find(n=>n.id===id).status==='discarded'));
 assert.equal(current.find(n=>n.id===other.id).status,other.status,'Other meetings are unchanged');
 assert.equal(JSON.stringify(m.votes),votes);assert.equal(JSON.stringify(m.presentations),evidence);
 assert.deepEqual(decision.discarded_ids,candidateIds);
 assert.equal(w.direction_revision,s.direction_revision,'The saved decision must not make its own handoff stale');
 if(stage==='Research'){assert.equal(w.selected_proposal,selected);assert.equal(s.research_map.nodes.find(n=>n.id===selected).status,'under_exploration');assert(candidateIds.every(id=>current.find(n=>n.id===id).history.at(-1).status==='unexplored'));}
 const oldRejected={...structuredClone(other),id:'older-rejected-candidate',status:'discarded',title:'An older rejected option',decision_reason:'This older method needed unavailable data.'};
 if(stage==='Proposal')s.research_map.nodes.push(oldRejected);else s.research_records.method.push(oldRejected);
 s.decisions.push({id:'older-rejection',choices:[{id:oldRejected.id,status:'discarded'}],comment:'This older proposal needed unavailable data.'});
 const saved=JSON.stringify(s);decideHumanMeeting(s,request,'director');assert.equal(JSON.stringify(s),saved,'Repeating the same decision is safe');
 for(const id of decision.briefing_ids){const t=s.tasks.find(t=>t.id===id);assert.deepEqual(t.workflow_context.director_decision.discarded_ids,candidateIds);t.status='completed';t.result={summary:'Read the rejection and feedback.',body:'Acknowledged.',artifacts:[]};}
 workflowTick(s);
 assert.equal(w.stage,stage);assert.equal(w.phase,'prepare');assert.equal(w.status,'running');assert.equal(w.batch.length,3);
 // Preview from a serialized state, as a new worker would after a restart.
 const restored=JSON.parse(JSON.stringify(s));
 for(const id of w.batch){const packet=taskAction(restored,{action:'preview',task_id:id,runner_id:'fresh-worker'},'task_runner');assert(packet);const index=packet.rejected_candidates;assert(candidateIds.every(id=>index.some(r=>r.id===id&&r.rejection_reason.includes('Read more broadly'))));assert(index.some(r=>r.id===oldRejected.id&&r.rejection_reason.includes('unavailable data')),'Earlier meetings survive the latest handoff');assert(!index.some(r=>r.id===other.id),'Unshared or unexplored work is not exposed');assert(candidateIds.every(id=>packet.reusable_outputs.some(o=>o.task_id===index.find(r=>r.id===id).source_task_id)),'Full saved rejected files are readable');}
 assert.deepEqual(rejectedCandidates(restored,{kind:'library'}),[],'Routine catalog work does not need the rejection history');

 assert(candidateIds.every(id=>(stage==='Proposal'?s.research_map.nodes:s.research_records.method).find(n=>n.id===id).status==='discarded'));
}
let s=await selection();rejectionCheck(s);assert.equal(s.workflow.stage,'Proposal');assert.equal(s.workflow.selected_proposal,null);const meeting=s.research_records.meeting.at(-1),candidate=meeting.presentations[1];
await assert.rejects(()=>store.apply(name,{action:'workflow_meeting_decision',meeting_id:meeting.id,expected_revision:meeting.revision,client_id:'bad',next_step:'select',choice:candidate.id},'worker'));
await assert.rejects(()=>run('submit',{id:'bypass',sender_id:o.id,agent_id:engineer.id,kind:'engineering',prompt:'Start without human decision'},'worker'));
const q=await store.apply(name,{action:'record_question',record_type:'meeting',record_id:meeting.id,candidate_id:candidate.id,agent_id:candidate.agent_id,body:'What would this test tell us?',client_id:'ask1'},'director');assert.equal(q.agent_id,candidate.agent_id);assert(q.record_snapshot.document.includes('Full candidate'));
await assert.rejects(()=>store.apply(name,{action:'record_reply',question_id:q.id,agent_id:o.id,client_id:'wrong-reply',body:'Wrong agent'},'worker'));
await store.apply(name,{action:'record_reply',question_id:q.id,agent_id:candidate.agent_id,client_id:'answer1',body:'It checks whether earlier examples add useful information.'},'worker');
const choose={action:'workflow_meeting_decision',meeting_id:meeting.id,expected_revision:meeting.revision,client_id:'choose1',next_step:'select',choice:candidate.id,comment:'Use the same examples for both methods.'};
await store.apply(name,choose,'director');await store.apply(name,choose,'director');s=await state();assert.equal(s.workflow.status,'briefing');assert.equal(s.workflow.selected_proposal,null,'Wait for the shared handoff');
const late=await store.apply(name,{action:'record_question',record_type:'meeting',record_id:meeting.id,candidate_id:candidate.id,agent_id:candidate.agent_id,body:'Which examples will you compare?',client_id:'ask-late'},'director');
let batch=await ready();assert.equal(batch.length,6);for(const p of batch){assert.equal(p.workflow_context.director_decision.conversations[0].replies[0].body,'It checks whether earlier examples add useful information.');await finish(p);}
assert.equal((await ready()).length,0,'Pending human questions keep dependent work waiting');
await store.apply(name,{action:'record_reply',question_id:late.id,agent_id:candidate.agent_id,client_id:'late-answer',body:'Both methods see exactly the same later examples.'},'worker');
batch=await ready();assert.equal(batch.length,6,'A late reply is shared with every participant');for(const p of batch){assert.equal(p.workflow_context.director_decision.conversations.length,2);await finish(p);}
s=await selection();rejectionCheck(s);assert.equal(s.workflow.stage,'Research');assert.equal(s.workflow.selected_proposal,candidate.id);assert(s.research_map.nodes.filter(n=>n.id!==candidate.id).every(n=>n.status==='unexplored'),'Unselected candidates are not automatically rejected');assert(s.research_records.meeting.at(-1).presentations.every(c=>c.presentation.experiment?.setup));
const methodMeeting=s.research_records.meeting.at(-1),method=methodMeeting.presentations[0];assert.equal(s.tasks.filter(t=>t.kind==='engineering').length,0);
await store.apply(name,{action:'workflow_meeting_decision',meeting_id:methodMeeting.id,expected_revision:methodMeeting.revision,client_id:'choose2',next_step:'select',choice:method.id,comment:''},'director');
batch=await ready();assert.equal(batch.length,6);await finish(batch[0]);assert.equal((await ready()).length,0,'Unfinished handoffs cannot launch an experiment');for(const p of batch.slice(1))await finish(p);
batch=await ready();assert.equal(batch.length,1);assert.equal(batch[0].task.kind,'engineering');assert.equal(batch[0].workflow_context.selected_method_id,method.id);assert(batch[0].documents.some(d=>d.task_id===method.task_id),'Engineer receives the selected full design');await finish(batch[0]);
batch=await ready();assert.equal(batch.length,5);for(const p of batch){assert.equal(p.workflow_context.phase,'assess');await finish(p);}
assert.equal((await ready()).length,0);s=await state();assert.equal(s.workflow.status,'awaiting_director');assert.equal(s.workflow.phase,'assess');
const resultsReview=structuredClone(s),statuses=resultsReview.research_records.method.map(m=>[m.id,m.status]),resultsMeeting=resultsReview.research_records.meeting.at(-1);decideHumanMeeting(resultsReview,{meeting_id:resultsMeeting.id,expected_revision:resultsMeeting.revision,client_id:'next-experiment',next_step:'design',comment:''},'director');assert.deepEqual(resultsReview.research_records.method.map(m=>[m.id,m.status]),statuses,'Designing another experiment after results does not discard tested methods');
console.log('Passed: rejected proposals and methods become Discarded, unrelated records and votes survive, feedback restarts preparation, and one round, adviser attendance, full advice in ballots, human choice despite none-ready votes, direct researcher replies, shared handoff before work, concrete designs, saved-state restart, and result review hold.');
