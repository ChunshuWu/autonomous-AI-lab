import {configureWorkflow as configureHistoricalWorkflow} from './workflow.mjs';
import {encodeWorkspace as encodeHistoricalWorkspace} from './workspace-codec.mjs';
import assert from 'node:assert/strict';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
import {workflowTick,workflowComplete,reviewStoppedInvestigation} from './workflow.mjs';
import {blockerRecoveryTick,blockerRecoveryComplete} from './blocker-recovery.mjs';
const db=adapter();let store=new Store(db,seeds);await store.init();
const art={path:'/tmp/fixture/result.json',sha256:'1'.repeat(64),bytes:20};
async function fixture(name,options={}){
 const {researcher_count=2,usage_mode='hard',...workflowOptions}=options;
 await store.apply(name,{action:'create_project',name:'Controller software check',topic:'Fictional test, not science'},'director');
 let sequence=0;const add=role=>store.apply(name,{action:'add_agent',name:role+'-'+(++sequence),role,specialty:role,question:'Fixture only',plan:['Test workflow']},'director');
 const o=await add('orchestrator'),r=[];for(let i=0;i<researcher_count;i++)r.push(await add('researcher'));const lib=await add('librarian'),eng=await add('engineer');await store.apply(name,{action:'assign_orchestrator',agent_id:o.id},'director');
 const run=(a,p={},role='task_runner')=>store.apply(name,{action:'task',task_action:a,runner_id:'fixture',...p},role);
 await run('configure',{client_id:'allow',enabled:true,research_enabled:true,max_model_calls:100,usage_mode,scope:'Local test fixtures only'},'director');
 const configuration={action:'workflow',id:name,researcher_ids:r.map(a=>a.id),librarian_id:lib.id,engineer_id:eng.id,max_rounds:3,max_cycles:1,max_checkpoints:30,waiting_minutes:5,resource_brief:'Fixture only; do not run real scientific work.',...workflowOptions};
 const historical=(await store.read(name)).state;configureHistoricalWorkflow(historical,configuration,'director');await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(await encodeHistoricalWorkspace(historical),name).run();
 const state=async()=>(await store.read(name)).state;
 async function claimReady(){const ready=(await run('poll')).ready;return Promise.all(ready.map(t=>run('claim',{task_id:t.id})));}
 async function finish(p,extra={}){const result={outcome:'completed',summary:'Complete fixture '+p.task.id,body:'Full saved evidence '+p.agent.id,document:null,requests:[],artifacts:[art],...extra};const req={...p.claim,completion_id:p.task.id+':result',result};await run('complete',req);return req;}
 async function chair(p,phase=null,action='advance'){
  const c=p.workflow_context,next=phase||c.allowed_next_phases.find(x=>x!=='finished')||'finished';const stopped=action==='stop'||next==='finished';const plan={action:stopped?'stop':'advance',next_phase:stopped?'finished':next,summary:'Fixture '+next,assignments:stopped?[]:(c.expected_owners[next]||[]).map(id=>({agent_id:id,prompt:'Carry out the saved fixture step.',summary:'Fixture '+next})).reverse(),tie_choice:c.ballot?.outcome==='tie'?c.ballot.leaders[0]:null,stop_reason:stopped?'Fixture stopping checkpoint':null};return finish(p,{workflow_plan:plan});
 }
 return {name,o,r,lib,eng,run,state,claimReady,finish,chair};
}
async function automatic(f,{ballot='winner',stopAfterAssess=true,limit=90}={}){
 for(let n=0;n<limit;n++){
  // Reopening Store between every event simulates process restarts; no in-memory controller state.
  store=new Store(db,seeds);const before=await f.state();if(['blocked','finished'].includes(before.workflow.status))return before;
  const ready=await f.claimReady();assert(ready.length,'Expected a task or terminal checkpoint');
  for(const p of ready){
   if(p.task.kind==='coordination'){if(p.workflow_context.phase==='assess'&&stopAfterAssess)await f.chair(p,'finished','stop');else await f.chair(p);}
   else if(p.task.handler==='library_collect')await f.finish(p,{handler:'library_collect',usage:{input_tokens:0,output_tokens:0}});
   else if(['proposal','research'].includes(p.task.kind))await f.finish(p,{document:'Complete candidate '+p.agent.id,artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});
   else if(p.task.kind==='vote'){const choices=p.decision_packet.options;const who=f.r.findIndex(a=>a.id===p.agent.id);const choice=ballot==='none'?'none_is_ready':ballot==='mixed'?choices[who]:ballot==='split'?choices[who<3?0:1]:choices[0];await f.finish(p,{body:JSON.stringify({choice,reason:'Fixture reason'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});}
   else await f.finish(p,{document:p.task.kind==='meeting'?'Complete reply '+p.agent.id:null});
  }
 }
 throw Error('Test did not stop within its bounded iterations');
}
// Wait for the whole team, register sources, then wake the chair only once.
const f=await fixture('wf-basic');let [chair]=await f.claimReady();await f.chair(chair);let prepared=await f.claimReady();assert.equal(prepared.length,2);
await f.finish(prepared[0],{artifacts:[art,{...art,path:'/tmp/fixture/a/sources.json'}]});assert.equal((await f.run('poll')).ready.length,0);assert.equal((await f.state()).tasks.filter(t=>t.kind==='coordination').length,1);
await f.finish(prepared[1],{artifacts:[art,{...art,path:'/tmp/fixture/b/sources.json'}]});let [catalog]=await f.claimReady();assert.equal(catalog.task.handler,'library_collect');assert.equal(catalog.source_inputs.length,2);assert.equal((await f.state()).task_policy.used_calls,3);await f.finish(catalog,{handler:'library_collect'});
[chair]=await f.claimReady();assert.equal(chair.workflow_context.phase,'prepare');const delivered=await f.chair(chair);const after=await f.state();await f.run('complete',delivered);assert.equal((await f.state()).tasks.length,after.tasks.length);
let result=await automatic(f);assert.equal(result.workflow.status,'finished');assert.equal(result.workflow.stage,'Research');assert.equal(result.agents.find(a=>a.id===f.o.id).work_status.state,'finished');assert.equal(result.research_records.meeting.length,2);assert.equal(result.research_map.nodes.filter(n=>n.status==='under_exploration').length,0);assert(result.tasks.some(t=>t.kind==='engineering'));
assert.equal(result.research_map.nodes.find(n=>n.id===result.workflow.selected_proposal).status,'explored');assert.equal(result.research_records.method.find(m=>m.id===result.workflow.selected_method).status,'explored');
{
 const legacy=structuredClone(result);legacy.research_map.nodes.find(n=>n.id===legacy.workflow.selected_proposal).status='under_exploration';legacy.research_records.method.find(m=>m.id===legacy.workflow.selected_method).status='active';delete legacy.workflow.investigation_closures;
 const tasks=JSON.stringify(legacy.tasks),calls=legacy.task_policy.used_calls;
 const held=structuredClone(legacy);held.paused=true;workflowTick(held);assert.equal(held.research_records.method.find(m=>m.id===held.workflow.selected_method).status,'active');
 workflowTick(legacy);const revision=legacy.research_map.revision;workflowTick(legacy);assert.equal(legacy.research_map.revision,revision);assert.equal(legacy.workflow.status,'finished');assert.equal(JSON.stringify(legacy.tasks),tasks);assert.equal(legacy.task_policy.used_calls,calls);assert.equal(legacy.research_records.method.find(m=>m.id===legacy.workflow.selected_method).status,'explored');assert.equal(legacy.workflow.investigation_closures.length,1);
}
// Reversed chair assignment order must not cross-wire proposal ownership.
for(const t of result.tasks.filter(t=>t.summary==='Fixture response')){const own=result.tasks.find(x=>x.id===t.document_ids[0]);assert.equal(own.agent_id,t.agent_id);}
for(const c of result.workflow.candidates)assert.equal(result.tasks.find(t=>t.id===c.task_id).agent_id,c.owner_id);
for(const t of result.tasks.filter(t=>t.kind==='research'&&t.workflow_context.phase==='prepare')){assert.equal(t.document_ids?.length||0,0);assert(t.workflow_context.selected_proposal);assert.equal(t.workflow_context.candidates.length,1);}
for(const t of result.tasks.filter(t=>t.kind==='research'&&t.workflow_context.phase==='prepare'))assert(t.prompt.includes('do not reuse a method ID belonging to a previous question'));
for(const t of result.tasks.filter(t=>t.kind==='meeting'&&t.workflow_context?.stage==='Research'&&t.workflow_context.phase==='response')){const c=result.workflow.candidates.find(c=>c.owner_id===t.agent_id);assert(t.prompt.includes('Your assigned method ID for this question is '+c.id));}
// A none-is-ready decision stops at the search-cycle limit without selecting a question.
const no=await fixture('wf-none');result=await automatic(no,{ballot:'none'});assert.equal(result.workflow.status,'finished');assert.equal(result.workflow.selected_proposal,null);assert.equal(result.research_records.meeting[0].decision,'No candidate justifies the next bounded step.');assert.equal(result.workflow.cycle,1);
// Three rounds with a tie: chair resolves only among tied candidates.
const mixed=await fixture('wf-mixed',{max_checkpoints:12});result=await automatic(mixed,{ballot:'mixed'});assert.equal(result.workflow.status,'finished');assert.equal(result.research_records.meeting.length,3);assert(result.workflow.selected_proposal);assert.equal(result.workflow.checkpoint,12);
// Human hold prevents new claims or transitions; the same saved state resumes after release.
const held=await fixture('wf-held');await store.apply(held.name,{action:'pause_lab'},'director');assert.equal((await held.run('poll')).ready.length,0);assert.equal((await held.state()).workflow.checkpoint,0);
// Invalid plans are accepted as evidence but blocked, with no partial batch.
const invalid=await fixture('wf-invalid');[chair]=await invalid.claimReady();await invalid.finish(chair,{workflow_plan:{action:'advance',next_phase:'implement',summary:'Skip the votes',assignments:[],tie_choice:null,stop_reason:null}});result=await invalid.state();assert.equal(result.workflow.status,'blocked');assert.equal(result.tasks.filter(t=>t.workflow_id===result.workflow.id).length,1);assert.equal(result.tasks.filter(t=>t.source?.type==='blocker_recovery').length,1);assert(result.warnings.some(w=>w.key==='workflow-stopped'));
// A phase error can retry only the coordinator with corrected inputs, preserving the saved result.
const originalInvalid=structuredClone(result.tasks[0]);
const phaseRepair={action:'workflow_retry',sender_id:invalid.o.id,task_id:chair.task.id,reason:'Restrict the response to the current allowed phases; preserve all original evidence.'};
await store.apply(invalid.name,{action:'pause_lab'},'director');await assert.rejects(()=>store.apply(invalid.name,phaseRepair,'worker'));await store.apply(invalid.name,{action:'resume_lab'},'director');
await assert.rejects(()=>store.apply(invalid.name,{...phaseRepair,sender_id:invalid.r[0].id},'worker'));
await store.apply(invalid.name,phaseRepair,'worker');let phaseState=await invalid.state();
assert.equal(phaseState.workflow.status,'running');assert.equal(phaseState.workflow.phase,'start');assert.equal(phaseState.tasks.filter(t=>t.workflow_id===phaseState.workflow.id).length,2);assert.deepEqual(phaseState.tasks[0],originalInvalid);
const replacementPhase=phaseState.tasks.find(t=>t.id===phaseState.workflow.chair_task);assert.equal(replacementPhase.kind,'coordination');assert.deepEqual(replacementPhase.workflow_context.previous_phase_error.allowed_next_phases,['prepare','finished']);assert(replacementPhase.prompt.includes('implement is not allowed'));
await store.apply(invalid.name,phaseRepair,'worker');assert.equal((await invalid.state()).tasks.filter(t=>t.workflow_id===phaseState.workflow.id).length,2);
[chair]=await invalid.claimReady();await invalid.chair(chair);assert.equal((await invalid.state()).workflow.phase,'prepare');
// Worker failure and timeout stop dependent work without another model retry.
const failed=await fixture('wf-failed');[chair]=await failed.claimReady();await failed.run('fail',{...chair.claim,error:'Fixture failure'});await failed.run('poll');assert.equal((await failed.state()).workflow.status,'blocked');
const timeout=await fixture('wf-timeout');[chair]=await timeout.claimReady();await timeout.chair(chair);const timed=await timeout.state();workflowTick(timed,Date.now()+6*60000);assert.equal(timed.workflow.status,'blocked');
// A partial batch cannot start when the remaining allowance cannot cover it and its chair.
const budget=await fixture('wf-budget');[chair]=await budget.claimReady();const state=await budget.state();state.task_policy.max_model_calls=2;await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(state),budget.name).run();await budget.chair(chair);result=await budget.state();assert.equal(result.workflow.status,'blocked');assert.equal(result.tasks.filter(t=>t.workflow_id===result.workflow.id).length,1);
// The same owners retain proposal IDs through all three revision rounds.
const proposalRevisionState=await mixed.state();assert.equal(proposalRevisionState.research_map.nodes.length,2);
assert.equal(new Set(proposalRevisionState.research_records.meeting.flatMap(m=>m.proposal_ids)).size,2);
for(const node of proposalRevisionState.research_map.nodes){assert(node.proposal_versions.length>=6);assert(new Set(node.proposal_versions.map(v=>v.round)).size===3);}
for(const task of proposalRevisionState.tasks.filter(t=>t.workflow_context?.original_candidate&&['prepare','response'].includes(t.workflow_context.phase))){assert(task.document_ids.includes(task.workflow_context.original_candidate.task_id));assert(task.prompt.includes('Revise your own original candidate'));}
console.log('Passed automatic Proposal→Research→engineer→assessment, full-team barriers, scripted sources, restart/idempotence, ownership, none-ready, three-round ties, holds, invalid plans, failures, timeout and budget limits.');

// Blocking a checkpoint cancels queued siblings; only the orchestrator recovery review can start.
const siblings=await fixture('wf-siblings');[chair]=await siblings.claimReady();await siblings.chair(chair);let ready=(await siblings.run('poll')).ready;let lone=await siblings.run('claim',{task_id:ready[0].id});await siblings.run('fail',{...lone.claim,error:'One participant failed'});const calls=(await siblings.state()).task_policy.used_calls;const recoveryReady=(await siblings.run('poll')).ready;assert.equal(recoveryReady.length,1);assert.equal((await siblings.state()).tasks.find(t=>t.id===recoveryReady[0].id).source.type,'blocker_recovery');assert.equal((await siblings.state()).task_policy.used_calls,calls);assert.equal((await siblings.state()).tasks.find(t=>t.id===ready[1].id).status,'cancelled');
// A coordinator cannot create peer tasks through the ordinary question channel.
const request=await fixture('wf-request');[chair]=await request.claimReady();await assert.rejects(()=>request.finish(chair,{requests:[{agent_id:request.r[0].id,question:'Bypass the checked plan'}],workflow_plan:{action:'stop',next_phase:'finished',assignments:[],summary:'Stop',tie_choice:null,stop_reason:'Fixture'}}));assert.equal((await request.state()).tasks.length,1);
console.log('Passed no repeated research after checkpoint failure and no unvalidated coordinator follow-up requests.');

// Maintenance holds only new claims; active outputs can still be saved.
const maintenance=await fixture('wf-maintenance');[chair]=await maintenance.claimReady();await maintenance.run('maintenance',{enabled:true});await maintenance.chair(chair);assert.equal((await maintenance.run('poll')).ready.length,0);await maintenance.run('maintenance',{enabled:false});assert.equal((await maintenance.run('poll')).ready.length,2);console.log('Passed maintenance without cancelling active work.');

// A blocked scientific finding wakes the chair and targets only its missing reading.
const scientific=await fixture('wf-science-block');[chair]=await scientific.claimReady();await scientific.chair(chair);let peers=await scientific.claimReady();await scientific.finish(peers[0],{outcome:'blocked',document:'Provisional candidate; closest paper still unread.',artifacts:[art,{...art,path:'/tmp/fixture/blocked/sources.json'}]});await scientific.finish(peers[1],{document:'Completed independent candidate.',artifacts:[art,{...art,path:'/tmp/fixture/complete/sources.json'}]});let follow=await scientific.claimReady();assert.equal(follow[0].task.handler,'library_collect');await scientific.finish(follow[0],{handler:'library_collect'});[chair]=await scientific.claimReady();assert.equal(chair.workflow_context.phase,'obstacle');assert.deepEqual(chair.workflow_context.expected_owners.prepare,[peers[0].agent.id]);await scientific.chair(chair);let repaired=await scientific.claimReady();assert.equal(repaired.length,1);assert.equal(repaired[0].agent.id,peers[0].agent.id);await scientific.finish(repaired[0],{document:'Complete revised candidate with explicit reading limits.',artifacts:[art,{...art,path:'/tmp/fixture/repaired/sources.json'}]});result=await automatic(scientific,{ballot:'none'});assert.equal(result.workflow.status,'finished');assert.equal(result.workflow.recoveries.length,1);assert(result.tasks.find(t=>t.id===peers[0].task.id).status==='failed');assert.equal(result.workflow.history.filter(h=>h.phase==='prepare').length,1);console.log('Passed focused recovery of blocked science with sources registered and completed peers preserved.');
// Failed plan application must preserve the exact response for duplicate delivery.
const immutable=await fixture('wf-immutable');[chair]=await immutable.claimReady();const limited=await immutable.state();limited.task_policy.max_model_calls=2;await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(limited),immutable.name).run();const rejectedPlan=await immutable.chair(chair);await immutable.run('complete',rejectedPlan);assert.deepEqual((await immutable.state()).tasks[0].result,rejectedPlan.result);
console.log('Passed unchanged saved responses after a plan is rejected.');
// Fix review inputs once, preserving completed peers and original failed evidence.
const review=await fixture('wf-review-repair');[chair]=await review.claimReady();await review.chair(chair);for(const p of await review.claimReady())await review.finish(p,{artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});[catalog]=await review.claimReady();await review.finish(catalog,{handler:'library_collect'});[chair]=await review.claimReady();await review.chair(chair);const reviews=await review.claimReady();assert.equal(reviews[0].source_inputs.length,2);assert(reviews[0].workflow_context.source_registration);await review.finish(reviews[0]);const taskCount=(await review.state()).tasks.length;await review.finish(reviews[1],{outcome:'blocked',requests:[{agent_id:review.lib.id,question:'Missing evidence'}]});assert.equal((await review.state()).tasks.length,taskCount);await review.run('poll');const beforeRepair=await review.state();assert.equal(beforeRepair.workflow.status,'blocked');const recovery={action:'workflow_reviews_retry',sender_id:review.o.id,task_id:reviews[0].task.id,reason:'Repaired missing source evidence.'};await store.apply(review.name,recovery,'worker');result=await review.state();assert.equal(result.workflow.batch[0],reviews[0].task.id);assert.equal(result.workflow.review_recoveries[0].tasks.length,1);assert.equal(result.tasks.find(t=>t.id===reviews[1].task.id).status,'failed');const repairedCount=result.tasks.length;await store.apply(review.name,recovery,'worker');assert.equal((await review.state()).tasks.length,repairedCount);const newReview=(await review.claimReady())[0];assert.equal(newReview.source_inputs.length,2);assert.equal(newReview.task.input_refs.length,2);assert(newReview.workflow_context.source_registration);
console.log('Passed source evidence and catalog confirmation in reviews, no peer-request loops, targeted recovery and no duplicate retry.');
// A delivered but unready response can be put to a vote by the real chair;
// its blocked scientific outcome remains intact and no missing document is invented.
const provisional=await fixture('wf-provisional');[chair]=await provisional.claimReady();await provisional.chair(chair);for(const p of await provisional.claimReady())await provisional.finish(p,{document:'Complete provisional proposal',artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});[catalog]=await provisional.claimReady();await provisional.finish(catalog,{handler:'library_collect'});[chair]=await provisional.claimReady();await provisional.chair(chair);for(const p of await provisional.claimReady())await provisional.finish(p,{document:'Complete critique'});[chair]=await provisional.claimReady();await provisional.chair(chair);const responses=await provisional.claimReady();await provisional.finish(responses[0],{document:'Complete revised candidate'});const blockedResponse=await provisional.finish(responses[1],{outcome:'blocked',document:'Complete provisional candidate; cost estimate remains unverified.'});[chair]=await provisional.claimReady();assert.equal(chair.workflow_context.obstacle.phase,'response');assert.equal(chair.workflow_context.expected_owners.vote.length,2);await provisional.chair(chair,'vote');result=await provisional.state();const accepted=result.tasks.find(t=>t.id===responses[1].task.id);assert.equal(accepted.status,'completed');assert.equal(accepted.result.outcome,'blocked');assert.deepEqual(accepted.result,blockedResponse.result);assert(accepted.checkpoint_accepted);const ballots=await provisional.claimReady();assert.equal(ballots.length,2);assert(ballots[0].decision_packet.candidates[1].document.includes('unverified'));assert.equal(result.workflow.checkpoint,3);assert.equal(result.workflow.history.filter(h=>h.phase==='response').length,1);
console.log('Passed chair acceptance of delivered provisional responses with unchanged scientific outcomes and complete ballots.');
// Preparation can deliver an uncertain candidate for critique after source registration;
// reserve the remaining calls for peer judgment instead of another reading loop.
const uncertain=await fixture('wf-uncertain');[chair]=await uncertain.claimReady();await uncertain.chair(chair);const preparedCandidates=await uncertain.claimReady();await uncertain.finish(preparedCandidates[0],{outcome:'blocked',document:'Complete provisional proposal; CPU cost remains uncertain.',artifacts:[art,{...art,path:'/tmp/fixture/u/sources.json'}]});await uncertain.finish(preparedCandidates[1],{document:'Another complete candidate',artifacts:[art,{...art,path:'/tmp/fixture/v/sources.json'}]});[catalog]=await uncertain.claimReady();assert.equal(catalog.task.handler,'library_collect');await uncertain.finish(catalog,{handler:'library_collect'});const bounded=await uncertain.state();bounded.task_policy.max_model_calls=13;await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(bounded),uncertain.name).run();[chair]=await uncertain.claimReady();assert(chair.workflow_context.allowed_next_phases.includes('critique'));assert(!chair.workflow_context.allowed_next_phases.includes('prepare'));assert.equal(chair.workflow_context.expected_owners.critique.length,2);await uncertain.chair(chair,'critique');result=await uncertain.state();assert.equal(result.workflow.checkpoint,1);assert.equal(result.workflow.candidates.length,2);assert.equal(result.tasks.find(t=>t.id===preparedCandidates[0].task.id).result.outcome,'blocked');assert.equal((await uncertain.run('poll')).ready.length,2);
console.log('Passed provisional preparation with confirmed sources and reserved calls for the selection round.');
// Science titles survive preparation, revisions and meeting publication; activity
// summaries and complete evidence remain separate from the map label.
const shortPresentation=i=>({question:'Can factor '+i+' improve the outcome?',prior_work:'Earlier methods use the whole record.',gap:'Local changes remain uncertain.',factor:'Use the local signal.',support:'A small example suggests a benefit, not yet tested.',outcome:'Error rate.',conditions:'A fixed small simulation.'});
const titles=await fixture('wf-science-titles');[chair]=await titles.claimReady();await titles.chair(chair);
let titleTasks=await titles.claimReady();
for(const [i,p] of titleTasks.entries())await titles.finish(p,{summary:'Saved a proposal and read papers.',document:'# Does mechanism '+i+' change the outcome?\n\n'+'Complete proposal evidence. '.repeat(600),artifacts:[art,{...art,path:'/tmp/fixture/title-'+i+'/sources.json'}]});
[catalog]=await titles.claimReady();await titles.finish(catalog,{handler:'library_collect'});[chair]=await titles.claimReady();
let titleState=await titles.state();const originalNodeIds=titleState.research_map.nodes.map(n=>n.id);
assert.equal(titleState.research_map.nodes[0].title,'Does mechanism 0 change the outcome?');
await titles.chair(chair,'critique');titleTasks=await titles.claimReady();const longComment='A complete objection with necessary reasoning. '.repeat(80);
for(const p of titleTasks)await titles.finish(p,{body:longComment,document:'# Detailed critique\nAll supporting reasoning.'});
[chair]=await titles.claimReady();await titles.chair(chair,'response');titleTasks=await titles.claimReady();
for(const [i,p] of titleTasks.entries())await titles.finish(p,{summary:'Saved revision; readiness uncertain.',presentation:shortPresentation(i),document:'# When does mechanism '+i+' help?\n\n'+'Complete revised evidence. '.repeat(650)});
[chair]=await titles.claimReady();titleState=await titles.state();
assert.deepEqual(titleState.research_map.nodes.map(n=>n.id),originalNodeIds);
assert.equal(titleState.research_map.nodes[0].title,'When does mechanism 0 help?');
assert.equal(titleState.research_map.nodes[0].summary,shortPresentation(0).question);
assert.deepEqual(titleState.research_map.nodes[0].presentation,shortPresentation(0));
assert(titleState.tasks.find(t=>t.id===titleTasks[0].task.id).result.document.length>12000);
assert.equal(titleState.research_map.nodes[0].evidence.length,2);
assert(titleState.research_map.history.some(h=>h.nodes[0]?.title==='Does mechanism 0 change the outcome?'));
assert(titleState.research_map.nodes.every(n=>n.status==='unexplored'));
await titles.chair(chair,'vote');result=await automatic(titles,{ballot:'none'});
const recorded=result.research_records.meeting[0];
assert.deepEqual(recorded.presentations[0].presentation,shortPresentation(0));
assert.equal(recorded.presentations[0].task_id,titleTasks[0].task.id);
result.research_map.nodes[0].presentation.question='A later revised question';
assert.equal(recorded.presentations[0].presentation.question,shortPresentation(0).question);
assert.match(recorded.summary,/Converged/);
assert.equal(recorded.suggestions[0].text,longComment);
assert(result.tasks.some(t=>t.id===recorded.suggestions[0].task_id&&t.result.document.includes('All supporting reasoning.')));
assert.equal(recorded.votes.length,2);
assert.equal(result.tasks.find(t=>t.id===titleTasks[0].task.id).result.summary,'Saved revision; readiness uncertain.');
console.log('Passed question-based titles, revised map history, linked full meeting contributions and non-blocking long critique delivery.');

async function atChair(f,phase){
 for(let i=0;i<30;i++){
  const batch=await f.claimReady();assert(batch.length,'Expected progress towards '+phase);
  for(const p of batch){
   if(p.task.kind==='coordination'){if(p.workflow_context.phase===phase)return p;await f.chair(p);}
   else if(p.task.handler==='library_collect')await f.finish(p,{handler:'library_collect'});
   else if(['proposal','research'].includes(p.task.kind))await f.finish(p,{document:'# A question worth checking\nComplete candidate, with unknown runtime.',artifacts:[art,{...art,path:'/tmp/fixture/check/'+p.agent.id+'/sources.json'}]});
   else if(p.task.kind==='vote')await f.finish(p,{body:JSON.stringify({choice:'none_is_ready',reason:'Fixture needs measured cost.'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});
   else await f.finish(p,{document:'# Revised candidate\nFull scientific reasoning.'});
  }
 }
 throw Error('Did not reach '+phase);
}
// One optional engineer check before a vote, with a complete saved result in
// every revision and ballot. It does not select a proposal or repeat reading.
const check=await fixture('wf-feasibility',{max_cycles:2,feasibility_budget:'Fixture evidence only, one result, no real computation.'});
chair=await atChair(check,'critique');assert(chair.workflow_context.allowed_next_phases.includes('feasibility'));
const savedCheckPlan=await check.chair(chair,'feasibility');let checkState=await check.state();const countBeforeRetry=checkState.tasks.length;
await check.run('complete',savedCheckPlan);assert.equal((await check.state()).tasks.length,countBeforeRetry);
let [engineer]=await check.claimReady();assert.equal(engineer.agent.id,check.eng.id);assert.equal(engineer.task.kind,'engineering');assert.equal(engineer.workflow_context.stage,'Proposal');assert.equal(engineer.documents.length,2);
assert.equal(checkState.workflow.selected_proposal,null);assert(checkState.research_map.nodes.every(n=>n.status==='unexplored'));
assert.equal((await check.claimReady()).length,0,'Researchers remain idle during the check.');
const measured='NEGATIVE FEASIBILITY RESULT: fixture cost exceeds the allowance; full explanation preserved.';
await check.finish(engineer,{document:measured,records:[{type:'experiment',expected_revision:0,record:{id:'feasibility-result',title:'Fixture cost check',summary:'Software fixture, not a real measurement.',purpose:'Check the saved-cost handoff.',setup:'No experiment was run.',status:'completed',results:measured,proposal_ids:[checkState.workflow.candidates[0].id]}}]});
[chair]=await check.claimReady();assert.equal(chair.workflow_context.phase,'feasibility');assert.equal(chair.workflow_context.feasibility_results[0].text,measured);
await check.chair(chair,'response');let revisions=await check.claimReady();assert.equal(revisions.length,2);
for(const p of revisions){assert.equal(p.workflow_context.feasibility_results[0].text,measured);await check.finish(p,{document:'# Revised after the check\nThe cost exceeds the allowance; narrow or stop.'});}
[chair]=await check.claimReady();await check.chair(chair,'vote');let checkVotes=await check.claimReady();
for(const p of checkVotes){assert.equal(p.workflow_context.feasibility_results[0].text,measured);assert(p.decision_packet.candidates.every(c=>c.document.includes('cost exceeds')));await check.finish(p,{body:JSON.stringify({choice:'none_is_ready',reason:'The measured fixture cost rules out this bounded step.'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});}
[chair]=await check.claimReady();assert(!chair.workflow_context.allowed_next_phases.includes('feasibility'),'No automatic repeat check.');await check.chair(chair,'finished','stop');checkState=await check.state();
assert.equal(checkState.workflow.selected_proposal,null);assert(checkState.research_records.meeting[0].evidence.some(e=>e.source.includes(engineer.task.id)));assert.equal(checkState.research_records.experiment[0].results,measured);assert.equal(checkState.tasks.filter(t=>t.kind==='engineering').length,1);
// A none-is-ready vote can route straight to measurement, preserving prior work.
const afterNone=await fixture('wf-check-after-none',{max_cycles:2,feasibility_budget:'Fixture only: one bounded check.'});
chair=await atChair(afterNone,'vote');const proposalsBefore=(await afterNone.state()).tasks.filter(t=>t.kind==='proposal').length;
assert(chair.workflow_context.allowed_next_phases.includes('feasibility'));await afterNone.chair(chair,'feasibility');[engineer]=await afterNone.claimReady();assert(engineer.documents.every(d=>d.text.includes('Full scientific reasoning.')));
await afterNone.finish(engineer,{document:'Fixture check resolves the missing runtime evidence.'});[chair]=await afterNone.claimReady();await afterNone.chair(chair,'response');
const afterNoneState=await afterNone.state();assert.equal(afterNoneState.workflow.cycle,2);assert.equal(afterNoneState.workflow.stage,'Proposal');assert.equal(afterNoneState.tasks.filter(t=>t.kind==='proposal').length,proposalsBefore);assert.equal(afterNoneState.research_records.meeting.length,1);
result=await automatic(afterNone,{ballot:'none'});assert.equal(result.workflow.status,'finished');assert.equal(result.research_records.meeting.length,2);assert.equal(result.workflow.selected_proposal,null);
// No implicit check permission; enforce checkpoint/call/cycle limits and holds.
const readingOnly=await fixture('wf-no-check');chair=await atChair(readingOnly,'critique');assert(!chair.workflow_context.allowed_next_phases.includes('feasibility'));
await readingOnly.finish(chair,{workflow_plan:{action:'advance',next_phase:'feasibility',summary:'Forbidden check',assignments:[{agent_id:readingOnly.eng.id,prompt:'Run a check',summary:'Check'}],tie_choice:null,stop_reason:null}});assert.equal((await readingOnly.state()).workflow.status,'blocked');assert(!(await readingOnly.state()).tasks.some(t=>t.kind==='engineering'));
const shortRun=await fixture('wf-check-limit',{max_checkpoints:4,feasibility_budget:'Fixture check.'});chair=await atChair(shortRun,'critique');assert(!chair.workflow_context.allowed_next_phases.includes('feasibility'));
const noSecondCycle=await fixture('wf-check-cycle-limit',{max_cycles:1,feasibility_budget:'Fixture check.'});chair=await atChair(noSecondCycle,'vote');assert.deepEqual(chair.workflow_context.allowed_next_phases,['finished']);
const checkHold=await fixture('wf-check-hold',{feasibility_budget:'Fixture check.'});chair=await atChair(checkHold,'critique');await checkHold.chair(chair,'feasibility');await store.apply(checkHold.name,{action:'pause_lab'},'director');assert.equal((await checkHold.run('poll')).ready.length,0);
const lowCalls=await fixture('wf-check-call-limit',{feasibility_budget:'Fixture check.'});chair=await atChair(lowCalls,'critique');const lowState=await lowCalls.state();lowState.task_policy.max_model_calls=lowState.task_policy.used_calls+7;await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(lowState),lowCalls.name).run();await lowCalls.chair(chair,'feasibility');assert.equal((await lowCalls.state()).workflow.status,'blocked');assert(!(await lowCalls.state()).tasks.some(t=>t.kind==='engineering'));
await assert.rejects(()=>fixture('wf-check-no-engineer',{engineer_id:null,feasibility_budget:'Fixture check.'}),/engineer/);
console.log('Passed one bounded Proposal check, full result delivery, negative results, post-vote measurement without repeated reading, durable experiment/meeting records, idempotence, no implicit selection, permission, hold and budget limits.');
// A valid long chair assignment plus framework instructions must be deliverable.
// Keep the complete resource allowance in context, without copying it into prompt.
const longAssignment=await fixture('wf-complete-instructions',{resource_brief:'Complete resource allowance. '+('r'.repeat(5600))});
[chair]=await longAssignment.claimReady();
const longPlan={action:'advance',next_phase:'prepare',summary:'Prepare within the saved allowance.',assignments:longAssignment.r.map(a=>({agent_id:a.id,prompt:'a'.repeat(3990),summary:'Prepare one independent proposal.'})),tie_choice:null,stop_reason:null};
await longAssignment.finish(chair,{workflow_plan:longPlan});let longReady=await longAssignment.claimReady();assert.equal(longReady.length,2,(await longAssignment.state()).workflow.reason);
for(const p of longReady){assert.equal(p.workflow_context.resource_brief,'Complete resource allowance. '+('r'.repeat(5600)));assert(!p.task.prompt.includes('r'.repeat(100)));assert(p.task.prompt.startsWith('a'.repeat(3990)));}
console.log('Passed valid complete controller assignments without duplicating the resource brief.');

// A chair stopped before any model call can resume its unchanged checkpoint after repair.
const chairPreflight=await fixture('wf-chair-preflight');
let pending=(await chairPreflight.run('poll')).ready[0];
await chairPreflight.run('preflight_fail',{task_id:pending.id,error:'Fresh-session preflight: evidence is above the advisory threshold.'});
await chairPreflight.run('poll');
const stoppedChair=await chairPreflight.state();assert.equal(stoppedChair.workflow.status,'blocked');assert.equal(stoppedChair.task_policy.used_calls,0);
const preflightRecovery={action:'workflow_retry',sender_id:chairPreflight.o.id,task_id:pending.id,reason:'Complete coordination evidence now uses an advisory size warning.'};
await store.apply(chairPreflight.name,preflightRecovery,'worker');
await store.apply(chairPreflight.name,preflightRecovery,'worker');
const recoveredChair=await chairPreflight.state();assert.equal(recoveredChair.workflow.status,'running');assert.equal(recoveredChair.tasks.filter(t=>t.workflow_id===recoveredChair.workflow.id).length,1);assert.equal(recoveredChair.task_policy.used_calls,0);assert.deepEqual(recoveredChair.tasks[0].workflow_context,stoppedChair.tasks[0].workflow_context);
[chair]=await chairPreflight.claimReady();await chairPreflight.chair(chair);assert.equal((await chairPreflight.claimReady()).length,2);
console.log('Passed unchanged chair checkpoint recovery after preflight, with no duplicate tasks or model calls.');
// Recover only unstarted byte-check failures; retain all saved assignments and limits.
const sized=await fixture('wf-size-warning');[chair]=await sized.claimReady();await sized.chair(chair);
const waiting=(await sized.run('poll')).ready;
for(const t of waiting)await sized.run('preflight_fail',{task_id:t.id,error:'Fresh-session preflight: evidence is 92000 bytes, above 80000. Complete input retained.'});
await sized.run('poll');const stoppedSize=await sized.state();assert.equal(stoppedSize.workflow.status,'blocked');
const repair={action:'workflow_preflight_retry',sender_id:sized.o.id,task_id:waiting[0].id,reason:'Complete saved inputs pass the repaired advisory size checks.'};
await store.apply(sized.name,repair,'worker');const recoveredSize=await sized.state();assert.equal(recoveredSize.workflow.status,'running');assert.equal(recoveredSize.task_policy.used_calls,stoppedSize.task_policy.used_calls);
for(const id of recoveredSize.workflow.batch){const t=recoveredSize.tasks.find(t=>t.id===id);assert.equal(t.status,'queued');assert.equal(t.attempts,0);assert.deepEqual(t.request,stoppedSize.tasks.find(x=>x.id===id).request);}
await store.apply(sized.name,repair,'worker');assert.equal((await sized.state()).workflow.size_recoveries.length,1);
for(const mutate of [s=>s.paused=true,s=>s.task_policy.revision++,s=>s.direction_revision++,s=>s.task_policy.max_model_calls=s.task_policy.used_calls,s=>s.tasks.find(t=>t.id===repair.task_id).attempts=1,s=>s.tasks.find(t=>t.id===repair.task_id).error='Missing evidence']){
 const rejected=structuredClone(stoppedSize);mutate(rejected);await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(rejected),sized.name).run();await assert.rejects(()=>store.apply(sized.name,repair,'worker'));assert.deepEqual(await sized.state(),rejected);
}
console.log('Passed byte-check recovery, unchanged evidence and calls, idempotence, and rejection for holds, changed allowance/direction, exhausted budget, started work, or missing evidence.');

// Five researchers need their current draft, five reviews, and original proposal.
{
const fiveRevision=await fixture('wf-five-revisions',{researcher_count:5,max_checkpoints:8});
const fiveResult=await automatic(fiveRevision,{ballot:'mixed'});
assert.equal(fiveResult.workflow.status,'finished');assert.equal(fiveResult.research_map.nodes.length,5);
const responses=fiveResult.tasks.filter(t=>t.workflow_context?.phase==='response'&&t.workflow_context.original_candidate);
assert.equal(responses.length,5);
for(const t of responses){
 assert.equal(t.document_ids.length,7);assert.equal(new Set(t.document_ids).size,7);assert(t.document_ids.includes(t.workflow_context.original_candidate.task_id));
 const original=fiveResult.tasks.find(x=>x.id===t.workflow_context.original_candidate.task_id);assert.equal(original.agent_id,t.agent_id);
 assert.equal(t.document_ids.map(id=>fiveResult.tasks.find(x=>x.id===id)).filter(x=>x.workflow_context?.phase==='critique').length,5);
 assert.equal(t.status,'completed');
}
assert.equal(fiveResult.research_records.meeting.length,2);
console.log('Passed five-researcher round-2 revisions with all seven documents, stable proposal IDs, and both completed meetings.');
}

// A finished budget stop resumes exactly once, preserving evidence, votes and spent calls.
const resumed=await fixture('wf-advisory-resume',{researcher_count:5,max_checkpoints:8});
let saved=await automatic(resumed,{ballot:'split'});assert.equal(saved.workflow.round,2);assert.equal(saved.workflow.checkpoint,8);
saved.workflow.reason='The remaining allowance cannot cover a third round.';
await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),resumed.name).run();
const priorCalls=saved.task_policy.used_calls,priorVotes=saved.tasks.filter(t=>t.kind==='vote').map(t=>[t.id,t.result.body]);
const resume={action:'workflow_resume_advisory',client_id:'continue-1',reason:'Director requested warnings only.',scope:'Software fixture; do not run real work.',resource_brief:'Fixture; usage warns only; finish after first Research assessment.',feasibility_budget:'One fixture check; no real computing.'};
await assert.rejects(()=>store.apply(resumed.name,resume,'worker'));
await store.apply(resumed.name,{action:'pause_lab'},'director');
await assert.rejects(()=>store.apply(resumed.name,resume,'director'));
// Restore the unchanged snapshot after the separate hold test.
await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),resumed.name).run();
await store.apply(resumed.name,resume,'director');let once=await resumed.state();await store.apply(resumed.name,resume,'director');
assert.equal((await resumed.state()).tasks.length,once.tasks.length);assert.equal(once.task_policy.used_calls,priorCalls);
assert.deepEqual(once.tasks.filter(t=>t.kind==='vote').map(t=>[t.id,t.result.body]),priorVotes);
let [newChair]=await resumed.claimReady();assert.equal(newChair.workflow_context.remaining_model_calls,null);assert.equal(newChair.workflow_context.checkpoint_limit,null);
await resumed.chair(newChair);
result=await automatic(resumed,{ballot:'split'});if(result.workflow.status==='blocked')console.log(result.workflow.reason);assert.equal(result.workflow.status,'finished');assert.equal(result.workflow.phase,'assess');assert(result.tasks.some(t=>t.kind==='engineering'));
assert(result.task_policy.used_calls>100);assert(result.workflow.checkpoint>8);assert(!result.warnings.some(w=>w.key==='usage-calls'));assert(result.warnings.some(w=>w.key==='usage-checkpoints'));
assert.equal(result.research_records.meeting.filter(m=>m.stage==='Proposal').length,3);
assert.equal(result.research_map.nodes.filter(n=>n.original_task_id&&n.id.startsWith('proposal-')).length,5);
console.log('Passed warning-only continuation beyond 100 calls and 8 checkpoints, three-round selection, saved evidence, idempotence and user holds.');
// Elapsed time warns while a healthy worker keeps its lease.
const slow=await fixture('wf-advisory-time',{usage_mode:'warn',max_checkpoints:1});
[chair]=await slow.claimReady();await slow.chair(chair);const slowState=await slow.state();workflowTick(slowState,Date.now()+60*60000);
assert.equal(slowState.workflow.status,'running');assert(slowState.warnings.some(w=>w.key==='workflow-long-checkpoint'));

// The chair must receive the actual source handoff and its delivery receipt.
const handoff=await fixture('wf-chair-handoff');[chair]=await handoff.claimReady();await handoff.chair(chair);
for(const p of await handoff.claimReady())await handoff.finish(p,{artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});
[catalog]=await handoff.claimReady();
const libraryArtifacts=[art,{...art,path:'/tmp/fixture/catalog/library.json'},{...art,path:'/tmp/fixture/catalog/library-receipt.json'}];
await handoff.finish(catalog,{handler:'library_collect',artifacts:libraryArtifacts});
[chair]=await handoff.claimReady();
assert.deepEqual(chair.task.input_refs,libraryArtifacts.slice(1).map(a=>a.path));
assert.equal(chair.workflow_context.source_registration.task_id,catalog.task.id);
assert.equal(chair.workflow_context.source_registration.receipt_available,true);
assert.equal(chair.workflow_context.source_record_task_ids.length,2);
assert.equal(chair.source_inputs.length,4); // Original source checksums plus both registered artifacts.
const blockedChair=await handoff.finish(chair,{outcome:'blocked',body:'Missing source handoff in the old packet.',workflow_plan:{action:'stop',next_phase:'finished',assignments:[],summary:'Missing handoff evidence.',stop_reason:'Restore the source records and receipt.'}});
await handoff.run('poll');
const savedHandoff=await handoff.state(),savedBatch=[...savedHandoff.workflow.batch],savedCandidates=structuredClone(savedHandoff.workflow.candidates);
const handoffRetry={action:'workflow_retry',sender_id:handoff.o.id,task_id:chair.task.id,reason:'Attach the actual source handoff and receipt.'};
// A failed review of the same complete evidence cannot be retried in a loop.
await assert.rejects(()=>store.apply(handoff.name,handoffRetry,'worker'),/unchanged evidence/);
// Recreate the old controller packet which omitted source evidence.
const oldChair=savedHandoff.tasks.find(t=>t.id===chair.task.id);
oldChair.input_refs=[];delete oldChair.source_inputs;delete oldChair.workflow_context.source_registration;
savedHandoff.paused=true;
await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(savedHandoff),handoff.name).run();
await assert.rejects(()=>store.apply(handoff.name,handoffRetry,'worker'),/allowance or hold/);
savedHandoff.paused=false;
await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(savedHandoff),handoff.name).run();
await store.apply(handoff.name,handoffRetry,'worker');
let recoveredHandoff=await handoff.state();
assert.equal(recoveredHandoff.workflow.status,'running');
assert.equal(recoveredHandoff.tasks.length,savedHandoff.tasks.length+1);
assert.equal(recoveredHandoff.workflow.checkpoint,savedHandoff.workflow.checkpoint);
assert.deepEqual(recoveredHandoff.workflow.batch,savedBatch);
assert.deepEqual(recoveredHandoff.workflow.candidates,savedCandidates);
assert.deepEqual(recoveredHandoff.tasks.find(t=>t.id===chair.task.id).result,blockedChair.result);
assert.equal(recoveredHandoff.tasks.find(t=>t.id===chair.task.id).status,'failed');
await store.apply(handoff.name,handoffRetry,'worker');
assert.equal((await handoff.state()).tasks.length,recoveredHandoff.tasks.length);
[chair]=await handoff.claimReady();
assert.equal(chair.task.id,recoveredHandoff.workflow.coordination_recoveries[0].replacement_task);
assert.equal(chair.workflow_context.source_registration.receipt_available,true);
await handoff.chair(chair,'critique');
assert.equal((await handoff.state()).workflow.phase,'critique');
assert.equal((await handoff.claimReady()).length,2);
console.log('Passed registered source and receipt handoff, targeted chair recovery, unchanged evidence protection, holds, idempotence and next review batch.');

// A real director clarification preserves work, gathers every explanation, and
// requires one corrected method revision before a new ballot can start.
const focus=await fixture('wf-shared-focus');
for(let step=0;step<60;step++){
 const s=await focus.state();
 if(s.workflow.stage==='Research'&&s.workflow.phase==='response'&&s.workflow.batch.every(id=>s.tasks.find(t=>t.id===id).status==='completed'))break;
 for(const p of await focus.claimReady()){
  if(p.task.kind==='coordination')await focus.chair(p);
  else if(p.task.handler==='library_collect')await focus.finish(p,{handler:'library_collect'});
  else if(['proposal','research'].includes(p.task.kind))await focus.finish(p,{document:'# Complete method\nShared scientific question.',artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});
  else if(p.task.kind==='vote')await focus.finish(p,{body:JSON.stringify({choice:p.decision_packet.options[0],reason:'Worth the next test.'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});
  else await focus.finish(p,{document:'# Complete revision\n'+('Complete saved method evidence. '.repeat(800))+' IMPORTANT FINAL LIMIT.'});
 }
}
let fs0=await focus.state();assert.equal(fs0.workflow.stage,'Research');assert.equal(fs0.workflow.phase,'response');
const stableIds=fs0.workflow.candidates.map(c=>c.id),oldTasks=structuredClone(fs0.tasks),oldRounds=fs0.workflow.round,policy=structuredClone(fs0.task_policy);
await store.apply(focus.name,{action:'pause_lab'},'director');
const answers=focus.r.map((r,i)=>'focus-answer-'+i),summaryId='focus-chair-answer';
for(const [i,r] of focus.r.entries())await focus.run('submit',{id:answers[i],sender_id:focus.o.id,agent_id:r.id,kind:'question',prompt:'Explain the same research idea.',summary:'Shared idea'},'worker');
await focus.run('submit',{id:summaryId,sender_id:focus.o.id,agent_id:focus.o.id,kind:'question',prompt:'Read all replies and settle the shared comparison.',summary:'Shared comparison',depends_on:answers,document_ids:answers},'worker');
const clarification={action:'workflow_clarify_research',client_id:'same-idea',reason:'Compare implementations of the same idea and outcome.',document_ids:[...answers,summaryId]};
await assert.rejects(()=>store.apply(focus.name,clarification,'worker'),/director clarification/);
await assert.rejects(()=>store.apply(focus.name,clarification,'director'),/every researcher/);
for(const p of await focus.claimReady()){assert.equal(p.task.kind,'question');await focus.finish(p,{body:'Same idea and outcome. My test plan is part of the method.'});}
const [summaryPacket]=await focus.claimReady();assert.equal(summaryPacket.task.id,summaryId);assert.equal(summaryPacket.documents.length,answers.length);
const commonBasis='Same idea, measured outcome and conditions. Compare complete implementations; testing and cost checks are tasks within a method.';
await focus.finish(summaryPacket,{body:commonBasis});
assert((await focus.state()).tasks.some(t=>t.kind==='meeting'&&t.result?.document?.length>24000));
const queuedBefore=(await focus.state()).tasks.length;
await store.apply(focus.name,clarification,'director');let clarified=await focus.state();
assert(clarified.paused);assert(clarified.workflow.focus_review_pending);assert.equal(clarified.workflow.round,oldRounds);assert.deepEqual(clarified.workflow.candidates.map(c=>c.id),stableIds);assert.equal(clarified.tasks.length,queuedBefore);
assert.equal(clarified.task_policy.used_calls,policy.used_calls+answers.length+1);
for(const old of oldTasks)assert.deepEqual(clarified.tasks.find(t=>t.id===old.id),old);
await store.apply(focus.name,clarification,'director');assert.equal((await focus.state()).events.length,clarified.events.length);
await assert.rejects(()=>store.apply(focus.name,{...clarification,reason:'A different request'},'director'),/different content/);
assert.equal((await focus.run('poll')).ready.length,0);
const methodRevision={action:'workflow_clarify_research',client_id:'individual-methods',revision_only:true,reason:'Every researcher should explain its own complete method in everyday language before a vote.'};
await assert.rejects(()=>store.apply(focus.name,methodRevision,'worker'),/director clarification/);
const beforeMethodRevision=await focus.state();await store.apply(focus.name,methodRevision,'director');const afterMethodRevision=await focus.state();
assert.deepEqual(afterMethodRevision.workflow.research_clarification,beforeMethodRevision.workflow.research_clarification);assert.deepEqual(afterMethodRevision.workflow.candidates,beforeMethodRevision.workflow.candidates);assert.deepEqual(afterMethodRevision.workflow.history,beforeMethodRevision.workflow.history);assert.equal(afterMethodRevision.tasks.length,beforeMethodRevision.tasks.length);assert.equal(afterMethodRevision.workflow.method_revisions.length,1);
await store.apply(focus.name,methodRevision,'director');assert.equal((await focus.state()).events.length,afterMethodRevision.events.length);
await store.apply(focus.name,{action:'resume_lab'},'director');
await assert.rejects(()=>store.apply(focus.name,{...methodRevision,client_id:'new-instruction'},'director'),/paused/);
const [focusChair]=await focus.claimReady();assert.equal(focusChair.task.kind,'coordination');assert((await focus.state()).research_records.method.every(m=>m.notes.endsWith('IMPORTANT FINAL LIMIT.')));assert(focusChair.research_guidance.includes('its own complete method'));assert.equal(focusChair.workflow_context.research_focus.director_method_instruction,methodRevision.reason);
assert.equal(focusChair.workflow_context.research_focus.proposal_id,fs0.workflow.selected_proposal);
assert.equal(focusChair.workflow_context.research_focus.clarification.text,commonBasis);
assert(focusChair.workflow_context.allowed_next_phases.includes('response'));assert(!focusChair.workflow_context.allowed_next_phases.includes('vote'));
await focus.chair(focusChair,'response');
const correctionCandidates=(await focus.state()).workflow.candidates;
let corrections=await focus.claimReady();assert.equal(corrections.length,focus.r.length);
for(const p of corrections){assert.equal(p.workflow_context.research_focus.clarification.text,commonBasis);for(const c of correctionCandidates)assert(p.documents.some(d=>d.task_id===c.task_id));}
await focus.finish(corrections[0],{document:'# Corrected method\nSame idea, outcome and conditions.'});
// Model the earlier missing-document packet without changing its saved result.
const missingPacket=await focus.state(),missingTask=missingPacket.tasks.find(t=>t.id===corrections[1].task.id),extraDocument=correctionCandidates[0].task_id;
missingTask.document_ids=missingTask.document_ids.filter(id=>id!==extraDocument);missingTask.request.document_ids=[...missingTask.document_ids];
await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(missingPacket),focus.name).run();
const missingReply=await focus.finish(corrections[1],{outcome:'blocked',body:'The complete peer method is missing.',document:null});
const [inputChair]=await focus.claimReady();assert.equal(inputChair.workflow_context.phase,'obstacle');
const inputRecovery={action:'workflow_reviews_retry',sender_id:focus.o.id,task_id:corrections[0].task.id,reason:'Attach the missing complete peer method.',document_ids:[extraDocument]};
await assert.rejects(()=>store.apply(focus.name,inputRecovery,'worker'),/stopped review/);
const inputChairReply=await focus.finish(inputChair,{outcome:'blocked',body:'Supply the missing peer document; keep the finished revision.',workflow_plan:{action:'stop',next_phase:'finished',assignments:[],summary:'Missing peer document.',stop_reason:'Repair only the missing input.'}});await focus.run('poll');
const beforeInputRepair=await focus.state();assert.equal(beforeInputRepair.workflow.status,'blocked');
await assert.rejects(()=>store.apply(focus.name,{...inputRecovery,document_ids:[]},'worker'),/missing documents/);
await assert.rejects(()=>store.apply(focus.name,{...inputRecovery,document_ids:[corrections[1].task.id]},'worker'),/complete saved/);
await store.apply(focus.name,{action:'pause_lab'},'director');
await assert.rejects(()=>store.apply(focus.name,inputRecovery,'worker'),/allowance/);
await store.apply(focus.name,{action:'resume_lab'},'director');
await store.apply(focus.name,inputRecovery,'worker');
const afterInputRepair=await focus.state();assert.equal(afterInputRepair.tasks.length,beforeInputRepair.tasks.length+1);assert.equal(afterInputRepair.workflow.status,'running');assert.equal(afterInputRepair.workflow.obstacle,null);
assert.deepEqual(afterInputRepair.tasks.find(t=>t.id===corrections[0].task.id).result,beforeInputRepair.tasks.find(t=>t.id===corrections[0].task.id).result);
assert.deepEqual(afterInputRepair.tasks.find(t=>t.id===corrections[1].task.id).result,missingReply.result);assert.deepEqual(afterInputRepair.tasks.find(t=>t.id===inputChair.task.id).result,inputChairReply.result);
assert.deepEqual(afterInputRepair.workflow.candidates,beforeInputRepair.workflow.candidates);assert.deepEqual(afterInputRepair.workflow.history,beforeInputRepair.workflow.history);
await store.apply(focus.name,inputRecovery,'worker');assert.equal((await focus.state()).tasks.length,afterInputRepair.tasks.length);
const [onlyMissingReviewer]=await focus.claimReady();assert.equal(onlyMissingReviewer.agent.id,corrections[1].agent.id);assert(onlyMissingReviewer.documents.find(d=>d.task_id===extraDocument).text.endsWith('IMPORTANT FINAL LIMIT.'));
await focus.finish(onlyMissingReviewer,{document:'# Corrected method\nSame idea, outcome and conditions.'});
console.log('Passed complete peer documents in focus revisions, targeted blocked-input repair, preserved peers/results/history, hold checks, unchanged-input protection and idempotence.');
const [readyForVote]=await focus.claimReady();assert(readyForVote.workflow_context.allowed_next_phases.includes('vote'));assert(!readyForVote.workflow_context.focus_review_pending);
await focus.chair(readyForVote,'vote');
for(const p of await focus.claimReady()){assert.equal(p.task.kind,'vote');assert.equal(p.workflow_context.research_focus.clarification.text,commonBasis);assert.deepEqual(p.decision_packet.candidates.map(c=>c.id),stableIds);}
console.log('Passed shared Research focus, real team explanations, scope-preserving clarification, stable IDs/history, one correction before voting, idempotence and director holds.');
// A locally saved ballot can be delivered after its worker lease expired, without a new model call.
{
 const f=await fixture('wf-saved-vote',{researcher_count:3,usage_mode:'warn'});let ballots=[];
 for(let n=0;n<20&&!ballots.length;n++){
  const ready=await f.claimReady();
  if(ready[0]?.task.kind==='vote'){ballots=ready;break;}
  for(const p of ready){
   if(p.task.kind==='coordination')await f.chair(p);
   else if(p.task.handler==='library_collect')await f.finish(p,{handler:'library_collect'});
   else await f.finish(p,{document:'Complete candidate or review',artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});
  }
 }
 assert.equal(ballots.length,3);
 const longReason='A'.repeat(281),voteResult=p=>({outcome:'completed',summary:'Saved vote',body:JSON.stringify({choice:p.decision_packet.options[0],reason:longReason}),requests:[],artifacts:[art],decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});
 for(const p of ballots.slice(0,2))await f.finish(p,voteResult(p));
 const last=ballots[2],payload={...last.claim,completion_id:last.task.id+':result',result:voteResult(last)};
 const saved=await store.read(f.name);saved.state.tasks.find(t=>t.id===last.task.id).lease_until='2000-01-01T00:00:00Z';
 const {encodeWorkspace}=await import('./workspace-codec.mjs');
 await db.prepare('UPDATE workspaces SET document=?,revision=revision+1 WHERE name=? AND revision=?').bind(await encodeWorkspace(saved.state),f.name,saved.revision).run();
 await f.run('poll');const stopped=await f.state();assert.equal(stopped.workflow.status,'blocked');
 const calls=stopped.task_policy.used_calls,peers=stopped.tasks.filter(t=>ballots.slice(0,2).some(p=>p.task.id===t.id));
 await assert.rejects(()=>f.run('redeliver',{...payload,lease_id:'wrong'}),/this worker/);
 await assert.rejects(()=>f.run('redeliver',payload,'worker'),/authenticated/);
 const {taskAction}=await import('./tasks.mjs');
 for(const alter of [s=>s.paused=true,s=>s.direction_revision++,s=>s.task_policy.revision++,s=>s.workflow.reason='A different failure',s=>s.tasks.find(t=>t.id===last.task.id).status='running']){
  const s=structuredClone(stopped);alter(s);assert.throws(()=>taskAction(s,{...payload,action:'redeliver',runner_id:'fixture'},'task_runner'));
 }
 await f.run('redeliver',payload);await f.run('redeliver',payload);await f.run('poll');
 const recovered=await f.state();assert.equal(recovered.task_policy.used_calls,calls);assert.equal(recovered.workflow.status,'running');
 assert.equal(recovered.tasks.find(t=>t.id===last.task.id).result.body,payload.result.body);
 for(const peer of peers)assert.deepEqual(recovered.tasks.find(t=>t.id===peer.id),peer);
 assert.equal(recovered.workflow.ballot.votes.length,3);assert.equal(recovered.workflow.ballot.votes[2].reason,longReason);
 assert.equal(recovered.tasks.filter(t=>t.id===recovered.workflow.chair_task).length,1);
 assert(!(recovered.warnings||[]).some(w=>w.status==='open'&&['workflow-stopped','task-worker-lost'].includes(w.key)));
 await assert.rejects(()=>f.run('redeliver',{...payload,result:{...payload.result,body:'changed'}}),/different content/);
 const [nextChair]=await f.claimReady();await f.chair(nextChair);const chaired=await f.state();assert.equal(chaired.research_records.meeting.length,1);assert.equal(chaired.research_records.meeting[0].votes[2].reason,longReason);
 console.log('Passed full 281-character votes, saved-result recovery without model calls, unchanged peers, one completed meeting, idempotence, expired-claim ownership and holds.');
}

// A new research round needs the actual experiment and assessments, not inaccessible paths.
{
const postResult=await fixture('wf-post-result',{usage_mode:'warn'});let selectedMethod,experimentTask,assessmentTasks,oldMethodIds;
for(let n=0;n<60;n++){
 const ready=await postResult.claimReady();assert(ready.length);
 let arrived=false;
 for(const p of ready){
  if(p.task.kind==='coordination'){
   if(p.workflow_context.phase==='assess'){
    const s=await postResult.state();selectedMethod=s.workflow.selected_method;oldMethodIds=s.workflow.candidates.map(c=>c.id);experimentTask=s.workflow.history.find(h=>h.phase==='implement').task_ids[0];assessmentTasks=[...s.workflow.batch];
    await postResult.chair(p,'prepare');arrived=true;
   }else await postResult.chair(p);
  }else if(p.task.handler==='library_collect')await postResult.finish(p,{handler:'library_collect'});
  else if(p.task.kind==='vote')await postResult.finish(p,{body:JSON.stringify({choice:p.decision_packet.options[0],reason:'Fixture selection'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});
  else await postResult.finish(p,{document:'Complete evidence, including the important final limitation for '+p.task.id,artifacts:[art,{...art,path:'/tmp/fixture/'+p.task.id+'/sources.json'}]});
 }
 if(arrived)break;
}
assert(selectedMethod);const legacyRound=await postResult.state();delete legacyRound.workflow.revising_methods;await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(legacyRound),postResult.name).run();const nextResearchers=await postResult.claimReady();assert.equal(nextResearchers.length,2);
for(const p of nextResearchers){
 assert.equal(p.workflow_context.selected_method_id,selectedMethod);assert(p.workflow_context.selected_method);assert.equal(p.workflow_context.previous_investigation.method_id,selectedMethod);
 for(const id of [experimentTask,...assessmentTasks])assert(p.documents.some(d=>d.task_id===id&&d.text.endsWith(id)),id);
 assert.equal(new Set(p.documents.map(d=>d.task_id)).size,p.documents.length);
}
await postResult.finish(nextResearchers[0],{document:'Complete revised method',artifacts:[art,{...art,path:'/tmp/fixture/complete/sources.json'}]});
await postResult.finish(nextResearchers[1],{outcome:'blocked',document:'Cannot complete this candidate until missing input is provided.',artifacts:[art,{...art,path:'/tmp/fixture/blocked/sources.json'}]});
const sourceTask=(await postResult.run('poll')).ready[0];assert(sourceTask);
await postResult.run('preflight_fail',{task_id:sourceTask.id,error:'Use a nonempty sources object.'});
const stale=await postResult.state();workflowTick(stale);const callsBefore=stale.task_policy.used_calls;
// A director hold must prevent even a known automatic repair.
const held=structuredClone(stale);held.paused=true;const heldTask=held.tasks.find(t=>t.id===sourceTask.id);heldTask.status='failed';heldTask.error='Use a nonempty sources object.';delete heldTask.empty_source_recovery;held.workflow.status='blocked';workflowTick(held);assert.equal(heldTask.status,'failed');
await postResult.run('poll');await postResult.run('poll');let fixed=await postResult.state();assert.equal(fixed.tasks.find(t=>t.id===sourceTask.id).status,'queued');assert.equal(fixed.task_policy.used_calls,callsBefore);
const repeat=structuredClone(fixed),repeatTask=repeat.tasks.find(t=>t.id===sourceTask.id);repeatTask.status='failed';repeatTask.error='Use a nonempty sources object.';repeat.workflow.status='blocked';workflowTick(repeat);assert.equal(repeatTask.status,'failed');
const [sourceRepair]=await postResult.claimReady();await postResult.finish(sourceRepair,{handler:'library_collect'});
const [obstacleChair]=await postResult.claimReady();assert.equal(obstacleChair.workflow_context.phase,'obstacle');assert(obstacleChair.documents.some(d=>d.task_id===experimentTask));
await postResult.chair(obstacleChair,'prepare');const [followup]=await postResult.claimReady();assert.equal(followup.agent.id,nextResearchers[1].agent.id);
for(const id of [experimentTask,...assessmentTasks])assert(followup.documents.some(d=>d.task_id===id&&d.text.endsWith(id)));
assert.equal(followup.workflow_context.selected_method_id,selectedMethod);
await postResult.finish(followup,{document:'Complete repaired revision',artifacts:[art,{...art,path:'/tmp/fixture/repaired/sources.json'}]});
const [sourceAgain]=await postResult.claimReady();await postResult.finish(sourceAgain,{handler:'library_collect'});await postResult.run('poll');fixed=await postResult.state();assert.deepEqual(fixed.workflow.candidates.map(c=>c.id),oldMethodIds);
assert.equal(fixed.tasks.find(t=>t.id===nextResearchers[0].task.id).attempts,1);
assert.equal(fixed.tasks.find(t=>t.id===nextResearchers[1].task.id).result.outcome,'blocked');
console.log('Passed post-experiment evidence, selected method identity, focused repair, no repeated completed peer, stable method IDs, empty-source recovery and director holds.');
let engineering;
for(let n=0;n<20&&!engineering;n++)for(const p of await postResult.claimReady()){
 if(p.task.kind==='engineering'){engineering=p;break;}
 if(p.task.kind==='coordination')await postResult.chair(p);
 else if(p.task.kind==='vote')await postResult.finish(p,{body:JSON.stringify({choice:p.decision_packet.options[0],reason:'Reuse the completed work.'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});
 else await postResult.finish(p,{document:'Complete revised candidate or peer review',artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});
}
assert(engineering);for(const id of [experimentTask,...assessmentTasks])assert(engineering.documents.some(d=>d.task_id===id));
assert(engineering.reusable_outputs.some(o=>o.task_id===experimentTask&&o.artifacts.length));
// Reproduce an old saved packet that omitted the preceding results; preserve its blocked finding.
let old=await postResult.state(),oldTask=old.tasks.find(t=>t.id===engineering.task.id);oldTask.document_ids=[];oldTask.request.document_ids=[];
await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(old),postResult.name).run();
await postResult.finish(engineering,{outcome:'blocked',body:'Earlier code and assessments could not be opened.'});await postResult.run('poll');
const blocked=await postResult.state();assert.equal(blocked.workflow.status,'blocked');
const repair={action:'workflow_handoff_repair',sender_id:postResult.o.id,task_id:engineering.task.id,reason:'Attach the completed files and full assessments.'};
const {repairWorkflowHandoff}=await import('./workflow.mjs');const heldEngineering=structuredClone(blocked);heldEngineering.paused=true;assert.throws(()=>repairWorkflowHandoff(heldEngineering,repair,'worker'),/allowance/);
await store.apply(postResult.name,repair,'worker');await store.apply(postResult.name,repair,'worker');
const repairedState=await postResult.state();assert.equal(repairedState.workflow.engineering_input_repairs.length,1);assert.equal(repairedState.tasks.find(t=>t.id===engineering.task.id).result.outcome,'blocked');
const [engineerRetry]=await postResult.claimReady();assert(engineerRetry.reusable_outputs.some(o=>o.task_id===experimentTask));for(const id of [experimentTask,...assessmentTasks])assert(engineerRetry.documents.some(d=>d.task_id===id));
await postResult.finish(engineerRetry,{outcome:'blocked',body:'A different scientific barrier remains.'});await postResult.run('poll');
await assert.rejects(()=>store.apply(postResult.name,{...repair,task_id:engineerRetry.task.id},'worker'),/unchanged inputs/);
console.log('Passed engineering reuse packets, complete assessments, one focused input repair, preserved findings and no unchanged retry.');


}

// Result reviewers can inspect the supplied completed files; other completed peers are preserved.
{
 const f=await fixture('wf-assess-file-access',{usage_mode:'warn'});let assessments=[];
 for(let n=0;n<60&&!assessments.length;n++){
  const ready=await f.claimReady();assert(ready.length);
  for(const p of ready){
   if(p.workflow_context?.phase==='assess'&&p.task.kind==='meeting'){assessments.push(p);continue;}
   if(p.task.kind==='coordination')await f.chair(p);
   else if(p.task.handler==='library_collect')await f.finish(p,{handler:'library_collect'});
   else if(p.task.kind==='vote')await f.finish(p,{body:JSON.stringify({choice:p.decision_packet.options[0],reason:'Read the existing evidence.'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});
   else await f.finish(p,{document:'Complete scientific document',artifacts:[art,{...art,path:'/tmp/fixture/'+p.agent.id+'/sources.json'}]});
  }
 }
 assert.equal(assessments.length,2);for(const p of assessments){assert(p.reusable_outputs.some(o=>o.kind==='engineering'&&p.documents.some(d=>d.task_id===o.task_id)));}
 await f.finish(assessments[0]);let saved=await f.state(),failed=saved.tasks.find(t=>t.id===assessments[1].task.id);failed.output_access_version=0;await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),f.name).run();
 await f.finish(assessments[1],{outcome:'blocked',body:'The detailed checks were linked, but file tools were disabled.'});await f.run('poll');saved=await f.state();assert.equal(saved.workflow.status,'blocked');const peer=structuredClone(saved.tasks.find(t=>t.id===assessments[0].task.id));
 const repair={action:'workflow_reviews_retry',sender_id:f.o.id,task_id:saved.workflow.batch[0],reason:'Read-only access to the completed experiment files is now available.'};
 await store.apply(f.name,repair,'worker');const [retry]=await f.claimReady();assert(retry.reusable_outputs.some(o=>o.kind==='engineering'));assert.equal(retry.agent.id,assessments[1].agent.id);assert(retry.task.prompt.includes('read-only file tools'));
 const withAccess=await f.state();assert.equal(withAccess.tasks.find(t=>t.id===retry.task.id).output_access_version,4);assert.deepEqual(withAccess.tasks.find(t=>t.id===peer.id),peer);
 await f.finish(retry,{outcome:'blocked',body:'A different missing input remains.'});await f.run('poll');
 const blocked=await f.state();blocked.workflow.review_recoveries=[];const {retryWorkflowReviews}=await import('./workflow.mjs');assert.throws(()=>retryWorkflowReviews(blocked,{...repair,task_id:blocked.workflow.batch[0]},'worker'),/unchanged inputs/);
 console.log('Passed result-review file access, focused recovery, preserved completed peer, access-version checks and no blind repeat.');
}

// Reconsideration must carry peer assessment files, not just engineer files and summary links.
{
 const f=await fixture('wf-reconsider-files',{usage_mode:'warn'});let votes=[];
 for(let n=0;n<65&&!votes.length;n++){
  const ready=await f.claimReady();assert(ready.length);
  for(const p of ready){
   if(p.workflow_context?.phase==='reconsider'&&p.task.kind==='vote'){votes.push(p);continue;}
   if(p.task.kind==='coordination')await f.chair(p,p.workflow_context.phase==='assess'?'reconsider':null);
   else if(p.task.handler==='library_collect')await f.finish(p,{handler:'library_collect'});
   else if(p.task.kind==='vote')await f.finish(p,{body:JSON.stringify({choice:p.decision_packet.options[0],reason:'Fixture'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});
   else await f.finish(p,{document:p.workflow_context?.phase==='assess'?'Full assessment is in the saved assessment.md file.':'Complete candidate',artifacts:[art,{...art,path:'/tmp/fixture/'+p.task.id+'/sources.json'},{...art,path:'/tmp/fixture/'+p.task.id+'/assessment.md'}]});
  }
 }
 assert.equal(votes.length,2);let saved=await f.state();const assessments=saved.workflow.history.findLast(h=>h.phase==='assess').task_ids;
 for(const p of votes){for(const id of assessments){assert(p.documents.some(d=>d.task_id===id));assert(p.reusable_outputs.some(o=>o.task_id===id&&o.kind==='meeting'));}assert(!p.reusable_outputs.some(o=>o.task_id.includes('-option-')));}
 for(const p of votes){const t=saved.tasks.find(t=>t.id===p.task.id);t.output_access_version=2;delete t.file_access_task_ids;}
 // Several unrelated earlier repairs must not prevent a specific, newly fixed input problem.
 saved.workflow.review_retries=5;await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),f.name).run();
 for(const p of votes)await f.finish(p,{outcome:'blocked',body:'Required full assessment files are inaccessible.'});await f.run('poll');
 saved=await f.state();assert.equal(saved.workflow.status,'blocked');
 const repair={action:'workflow_reviews_retry',sender_id:f.o.id,task_id:saved.workflow.batch[0],reason:'Complete peer assessment folders are now readable.'};await store.apply(f.name,repair,'worker');
 const repaired=await f.claimReady();assert.equal(repaired.length,2);
 for(const p of repaired){for(const id of assessments)assert(p.reusable_outputs.some(o=>o.task_id===id));await f.finish(p,{body:JSON.stringify({choice:'return-to-proposal',reason:'The complete evidence supports a new question.'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});}
 await f.run('poll');saved=await f.state();assert.equal(saved.workflow.status,'running');assert.equal(saved.workflow.ballot.outcome,'return-to-proposal');assert.equal(saved.workflow.review_recoveries.at(-1).file_access_upgrade,true);
 for(const p of votes)assert.equal(saved.tasks.find(t=>t.id===p.task.id).result.outcome,'blocked');
 console.log('Passed reconsideration with full peer files, a new identified repair after earlier repairs, original findings, complete ballots and automatic continuation.');
}

// Returning to Proposal must preserve access through the votes to older reports and assessments.
{
 const f=await fixture('wf-return-input-chain',{usage_mode:'warn'});let proposals=[];
 for(let n=0;n<70&&!proposals.length;n++){
  const ready=await f.claimReady();assert(ready.length);
  for(const p of ready){
   const state=await f.state();
   if(p.task.kind==='proposal'&&state.workflow.history.some(h=>h.phase==='reconsider')){proposals.push(p);continue;}
   if(p.task.kind==='coordination')await f.chair(p,p.workflow_context.phase==='assess'?'reconsider':null);
   else if(p.task.handler==='library_collect')await f.finish(p,{handler:'library_collect'});
   else if(p.task.kind==='vote')await f.finish(p,{body:JSON.stringify({choice:p.workflow_context.phase==='reconsider'?'return-to-proposal':p.decision_packet.options[0],reason:'Fixture evidence'}),decision_receipt:p.decision_packet.candidates.map(({id,task_id,completion_id})=>({id,task_id,completion_id}))});
   else await f.finish(p,{document:'Full file linked by this completed document.',artifacts:[art,{...art,path:'/tmp/fixture/'+p.task.id+'/sources.json'}]});
  }
 }
 assert.equal(proposals.length,2);let saved=await f.state();assert.equal(saved.workflow.stage,'Proposal');
 const assessments=saved.workflow.history.findLast(h=>h.phase==='assess').task_ids,experiment=saved.workflow.history.findLast(h=>h.phase==='implement').task_ids[0];
 const testedMethod=saved.tasks.find(t=>t.id===experiment).workflow_context.selected_method_id;
 const oldMethod=saved.research_records.method.find(m=>m.id===testedMethod),oldProposal=saved.research_map.nodes.find(n=>oldMethod.proposal_ids.includes(n.id));
 assert.equal(oldMethod.status,'explored');assert.equal(oldProposal.status,'explored');assert(oldMethod.evidence.some(e=>e.source.includes(experiment)));assert.equal(saved.workflow.investigation_closures.length,1);
 // Repair the historical stale labels without changing an ongoing assignment or its allowance.
 const legacy=structuredClone(saved);legacy.research_records.method.find(m=>m.id===testedMethod).status='active';legacy.research_map.nodes.find(n=>n.id===oldProposal.id).status='unexplored';delete legacy.workflow.investigation_closures;
 const permission=legacy.direction_revision,tasks=JSON.stringify(legacy.tasks),calls=legacy.task_policy.used_calls;
 const held=structuredClone(legacy);held.paused=true;workflowTick(held);assert.equal(held.research_records.method.find(m=>m.id===testedMethod).status,'active');
 workflowTick(legacy);workflowTick(legacy);assert.equal(legacy.research_records.method.find(m=>m.id===testedMethod).status,'explored');assert.equal(legacy.research_map.nodes.find(n=>n.id===oldProposal.id).status,'explored');assert.equal(legacy.workflow.investigation_closures.length,1);assert.equal(legacy.direction_revision,permission);assert.equal(JSON.stringify(legacy.tasks),tasks);assert.equal(legacy.task_policy.used_calls,calls);
 for(const p of proposals)for(const id of [...assessments,experiment])assert(p.reusable_outputs.some(o=>o.task_id===id));
 // Keep one finished researcher; restore missing prerequisites only for the other.
 const failed=saved.tasks.find(t=>t.id===proposals[0].task.id);failed.output_access_version=3;failed.file_access_task_ids=failed.depends_on;
 await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),f.name).run();
 await f.run('maintenance',{enabled:true});
 await f.finish(proposals[0],{outcome:'blocked',body:'The earlier report and assessment files could not be opened.',artifacts:[art,{...art,path:'/tmp/fixture/blocked/sources.json'}]});
 await f.finish(proposals[1],{document:'Complete new proposal',artifacts:[art,{...art,path:'/tmp/fixture/complete/sources.json'}]});
 await f.run('poll');saved=await f.state();const library=saved.workflow.library_task,peer=structuredClone(saved.tasks.find(t=>t.id===proposals[1].task.id));assert(library);
 const repair={action:'workflow_handoff_repair',sender_id:f.o.id,task_id:saved.workflow.batch[0],reason:'Completed prerequisite folders are now supplied.'};
 await store.apply(f.name,repair,'worker');await store.apply(f.name,repair,'worker');saved=await f.state();assert.equal(saved.workflow.prerequisite_input_repairs.length,1);assert.deepEqual(saved.tasks.find(t=>t.id===peer.id),peer);assert.equal(saved.tasks.find(t=>t.id===library).status,'cancelled');assert.equal(saved.workflow.library_task,null);
 await f.run('maintenance',{enabled:false});const [retry]=await f.claimReady();for(const id of [...assessments,experiment])assert(retry.reusable_outputs.some(o=>o.task_id===id));assert.equal(retry.agent.id,proposals[0].agent.id);
 await f.finish(retry,{document:'Completed new proposal from the restored inputs.',artifacts:[art,{...art,path:'/tmp/fixture/restored/sources.json'}]});
 const [catalog]=await f.claimReady();assert.equal(catalog.task.handler,'library_collect');assert.notEqual(catalog.task.id,library);await f.finish(catalog,{handler:'library_collect'});await f.run('poll');assert.equal((await f.state()).workflow.status,'running');
 // A saved prerequisite chain cannot expose unrelated completed work or active drafts.
 const {completedTaskOutputs}=await import('./tasks.mjs');const testState={tasks:[{id:'read',status:'completed',workflow_id:'w',kind:'meeting',depends_on:['older'],result:{artifacts:[art]}},{id:'older',status:'completed',workflow_id:'w',kind:'research',depends_on:['read','private'],result:{artifacts:[art]}},{id:'private',status:'running',workflow_id:'w',kind:'research',result:{artifacts:[art]}},{id:'unrelated',status:'completed',workflow_id:'w',kind:'research',result:{artifacts:[art]}}]};
 assert.deepEqual(completedTaskOutputs(testState,{id:'consumer',workflow_id:'w',depends_on:['read']}).map(o=>o.task_id),['read','older']);
 console.log('Passed return-to-Proposal prerequisite files, cycle protection, draft isolation, focused preparation repair, preserved peers and fresh source collection.');
}

// A delivered provisional finding remains scientifically blocked but can be read as an input.
{
 const f=await fixture('wf-provisional-receipt',{usage_mode:'warn'});const [chair]=await f.claimReady();await f.chair(chair);let saved=await f.state();
 saved.tasks.push({id:'prior-provisional',status:'completed',agent_id:f.r[0].id,kind:'research',workflow_id:saved.workflow.id,depends_on:[],result:{outcome:'blocked',body:'Provisional finding',artifacts:[art]},checkpoint_accepted:{by:f.o.id,scientific_outcome:'blocked'}});
 for(const id of saved.workflow.batch){const t=saved.tasks.find(t=>t.id===id);t.status='failed';t.error='The earlier task has no matching completed delivery: prior-provisional';t.attempts=0;}
 saved.workflow.status='blocked';const source=structuredClone(saved.tasks.at(-1));await db.prepare('UPDATE workspaces SET document=? WHERE name=?').bind(JSON.stringify(saved),f.name).run();
 const repair={action:'workflow_handoff_repair',sender_id:f.o.id,task_id:saved.workflow.batch[0],reason:'Use delivery receipts independently of scientific outcome.'};
 const {repairWorkflowHandoff}=await import('./workflow.mjs');const held=structuredClone(saved);held.paused=true;assert.throws(()=>repairWorkflowHandoff(held,repair,'worker'),/allowance/);
 const undelivered=structuredClone(saved);delete undelivered.tasks.at(-1).checkpoint_accepted;assert.throws(()=>repairWorkflowHandoff(undelivered,repair,'worker'),/real delivered result/);
 await store.apply(f.name,repair,'worker');await store.apply(f.name,repair,'worker');const repaired=await f.state();assert.equal(repaired.workflow.status,'running');assert.equal(repaired.workflow.receipt_input_repairs.length,1);assert.equal(repaired.task_policy.used_calls,saved.task_policy.used_calls);assert.deepEqual(repaired.tasks.find(t=>t.id===source.id),source);for(const id of saved.workflow.batch)assert.equal(repaired.tasks.find(t=>t.id===id).status,'queued');
 console.log('Passed provisional-file receipt recovery without changing science or spending model calls, with hold and delivery checks.');
}

// Missing-input stops must stay incomplete and keep the selected method available.
{
 const base=await f.state(),legacy=structuredClone(base);let w=legacy.workflow;
 delete w.termination;
 const implementation=legacy.tasks.find(t=>t.id===w.investigation_closures[0].task_ids[0]);
 implementation.result.records={experiments:[{status:'stopped',results:'Missing original inputs. No accuracy evaluation.'}]};
 const oldTasks=JSON.stringify(legacy.tasks),calls=legacy.task_policy.used_calls;
 const held=structuredClone(legacy);held.paused=true;workflowTick(held);assert.equal(held.workflow.status,'finished');
 const revoked=structuredClone(legacy);revoked.task_policy.revision++;workflowTick(revoked);assert.equal(revoked.workflow.status,'finished');
 const cleared=structuredClone(legacy);cleared.project.cleared_at=new Date().toISOString();workflowTick(cleared);assert.equal(cleared.workflow.status,'finished');
 workflowTick(legacy);
 assert.equal(w.status,'blocked');assert.equal(w.termination.kind,'dependency');assert.equal(w.termination.legacy,true);
 assert.equal(legacy.research_records.method.find(m=>m.id===w.selected_method).status,'active');
 assert.equal(legacy.research_map.nodes.find(n=>n.id===w.selected_proposal).status,'under_exploration');
 assert(w.investigation_closures[0].retracted_at);assert.equal(JSON.stringify(legacy.tasks),oldTasks);assert.equal(legacy.task_policy.used_calls,calls);
 workflowTick(legacy);blockerRecoveryTick(legacy);const count=legacy.tasks.length;blockerRecoveryTick(legacy);assert.equal(legacy.tasks.length,count);
 const recovery=legacy.blocker_recoveries.at(-1),owner=legacy.tasks.find(t=>t.id===recovery.owner_recovery.task_id);
 assert.equal(recovery.status,'owner_repairing');assert.equal(owner.agent_id,f.eng.id);assert(owner.document_ids.includes(implementation.id));
 owner.status='completed';owner.completion_id=owner.id+':repair';owner.result={outcome:'completed',summary:'Owner returned a useful repair check',body:'Saved new repair evidence',artifacts:[art],records:{experiments:[{status:'stopped',execution_outcome:'partial',scientific_outcome:'not_tested'}]}};
 blockerRecoveryTick(legacy);w=legacy.workflow;
 const chair=legacy.tasks.find(t=>t.id===w.chair_task);assert(chair);assert(chair.workflow_context.allowed_next_phases.includes('assess'));assert(!chair.workflow_context.allowed_next_phases.includes('implement'));
 assert(chair.document_ids.includes(implementation.id));assert(chair.document_ids.includes(owner.id));assert(chair.workflow_context.dependency_stop);
 chair.status='completed';chair.result={summary:'Assess the owner repair',workflow_plan:{action:'advance',next_phase:'assess',stop_kind:null,summary:'Review the new repair evidence',assignments:f.r.map(a=>({agent_id:a.id,prompt:'Review the full repair and original limits without experiments.',summary:'Assess new owner evidence'})),tie_choice:null,stop_reason:null}};
 workflowComplete(legacy,chair.id);w=legacy.workflow;assert.equal(w.phase,'assess');assert.equal(w.status,'running');
 for(const id of w.batch){const next=legacy.tasks.find(t=>t.id===id);assert(next.document_ids.includes(implementation.id));assert(next.document_ids.includes(owner.id));assert(next.workflow_context.previous_investigation);}
 assert.equal(legacy.task_policy.used_calls,calls);assert.equal(JSON.stringify(legacy.tasks.slice(0,base.tasks.length)),oldTasks);
 // An explicit endpoint claim cannot close an unperformed required implementation.
 const rejected=structuredClone(base),rw=rejected.workflow;rw.status='running';delete rw.termination;
 const final=rejected.tasks.find(t=>t.id===rw.investigation_closures[0].decision_task_id);rw.chair_task=final.id;
 rejected.tasks.find(t=>t.id===implementation.id).result.records={experiments:[{status:'stopped'}]};
 final.result.workflow_plan.stop_kind='endpoint';workflowComplete(rejected,final.id);assert.equal(rejected.workflow.status,'blocked');assert(rejected.workflow.reason.includes('unmet inputs'));
 // A scientific decision to end without a next step is distinct from completion.
 const stopped=structuredClone(base),sw=stopped.workflow;sw.status='running';delete sw.termination;
 const sf=stopped.tasks.find(t=>t.id===sw.investigation_closures[0].decision_task_id);sw.chair_task=sf.id;sf.result.workflow_plan.stop_kind='no_next_step';workflowComplete(stopped,sf.id);assert.equal(stopped.workflow.status,'stopped');assert.equal(stopped.workflow.termination.kind,'no_next_step');
 console.log('Passed dependency vs endpoint vs no-next-step, guarded legacy repair, preserved method/history, one recovery review, focused engineer continuation, full previous inputs, holds and unchanged saved results.');
}
