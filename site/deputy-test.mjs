import assert from 'node:assert/strict';
import {deputyFixture} from './deputy-fixture.mjs';
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
import {deputyPending,deputyContext} from './deputy.mjs';
import {reviewRunnerAction} from './review-runner.mjs';
const base=(await deputyFixture()).state;
const id=base.orchestrator_id,runner='deputy-test-runner';
async function setup(){const store=new Store(adapter(),seeds);await store.init();await store.db.prepare('INSERT INTO workspaces(name,document,revision) VALUES(?,?,1)').bind('deputy-test',JSON.stringify(base)).run();
 const call=(action,p={},role='reply_runner')=>store.apply('deputy-test',{action,runner_id:runner,agent_id:id,...p},role),read=async()=>(await store.read('deputy-test')).state;
 await call('heartbeat',{agent_ids:base.agents.map(a=>a.id),orchestrator_id:id,capabilities:['deputy']});return {store,call,read};}
const enable=call=>call('deputy_toggle',{enabled:true,expected_epoch:0},'director');
const fields=c=>({review_id:c.review_id,agent_id:c.agent_id,turn:c.turn,lease_id:c.lease_id});
const decide={action:'continue',summary:'Start with the uncertainty question.',reason:'First check whether prior work already solves it; approve only the displayed preparation tasks.',choices:[{id:'idea-a',status:'under_exploration',reason:'A concrete comparison to check first.'}],questions:[]};

{
 const {call,read}=await setup();assert.equal(deputyPending(await read()),false);
 await assert.rejects(()=>call('deputy_claim'));
 await assert.rejects(()=>call('deputy_toggle',{enabled:true,expected_epoch:0},'worker'));
 await enable(call);let s=await read();assert.equal(s.paused,true);assert.equal(deputyPending(s),true);
 const c=await call('deputy_claim');assert(c);assert.equal(await call('deputy_claim'),null);
 assert.equal(await call('coord_claim'),null);
 const decision=await call('deputy_complete',{...fields(c),result:decide});assert.equal(decision.status,'decided');
 s=await read();assert.equal(s.paused,false);assert.equal(s.deputy.enabled,true);
 assert.equal(s.research_map.nodes.filter(n=>n.status==='under_exploration').length,1);
 assert.equal(s.decisions.at(-1).authority.kind,'deputy');assert.match(s.research_map.history.at(-1).actor,/Deputy director/);
 assert(s.agents.filter(a=>a.status==='feedback_received').length===1);
 assert(!s.agents.some(a=>a.status==='working'));assert.deepEqual(s.reports,base.reports);
 const count=s.decisions.length;assert((await call('deputy_complete',{...fields(c),result:decide})).already_completed);assert.equal((await read()).decisions.length,count);
 assert.equal(deputyPending(await read()),false);
 await call('deputy_toggle',{enabled:false,expected_epoch:1},'director');s=await read();assert.equal(s.paused,true);assert.equal(s.deputy.enabled,false);
 await assert.rejects(()=>call('deputy_complete',{...fields(c),result:decide}));
}
{
 const {call,read}=await setup();await enable(call);const c=await call('deputy_claim');
 await call('deputy_toggle',{enabled:false,expected_epoch:1},'director');
 await assert.rejects(()=>call('deputy_complete',{...fields(c),result:decide}));
 assert.equal((await read()).decisions.length,base.decisions.length);
 await call('deputy_toggle',{enabled:true,expected_epoch:2},'director');
 await assert.rejects(()=>call('deputy_complete',{...fields(c),result:decide}));
 const fresh=await call('deputy_claim');assert.notEqual(fresh.review_id,c.review_id);
 await call('pause_lab',{},'director');assert.equal((await read()).deputy.enabled,false);
 await assert.rejects(()=>call('deputy_renew',fields(fresh)));
}
{
 const {call,read}=await setup();await enable(call);const c=await call('deputy_claim');
 const specialist=base.agents.find(a=>a.specialty?.includes('review'))||base.agents[0];
 const consult={action:'consult',summary:'Check the remaining gap.',reason:'The saved summary may already describe an existing solution.',choices:[],questions:[{agent_id:specialist.id,body:'Does the saved evidence already settle this gap?'}]};
 await call('deputy_complete',{...fields(c),result:consult});
 let s=await read(),q=s.review_questions.at(-1);assert.equal(q.sender_kind,'deputy');assert.equal(q.sender_agent_id,id);assert.equal(deputyPending(s),false);assert.deepEqual(s.decisions,base.decisions);
 const qc=await call('claim',{agent_id:specialist.id,question_id:q.id});assert(qc);
 await call('complete',{...qc,agent_id:specialist.id,question_id:q.id,report_id:q.report_id,client_id:'consult-reply',body:'Not settled. A focused source check remains needed.',summary:'Gap remains uncertain.',attention_kind:'direction_change',attention_reason:'Do not claim novelty.',references:[]});
 s=await read();assert.equal((s.orchestrator_inbox||[]).length,0);assert.equal(deputyPending(s),true);
 const next=await call('deputy_claim');assert.equal(next.turn,2);assert(deputyContext(await read(),{...fields(next),runner_id:runner}).conversations.at(-1).replies.length);
 await call('deputy_complete',{...fields(next),result:decide});assert.equal((await read()).deputy_reviews[0].history.length,2);
}
{
 const {call,read}=await setup();await enable(call);const c=await call('deputy_claim');
 const r=base.reports.find(r=>r.id===base.latest_team_report);
 await call('review_question',{agent_id:r.agent_id,report_id:r.id,client_id:'human-question',body:'Before deciding, what is the main uncertainty?'},'director');
 const result=await call('deputy_complete',{...fields(c),result:decide});assert.equal(result.stale,true);
 assert.deepEqual((await read()).decisions,base.decisions);assert.equal(await call('deputy_claim'),null);
}
{
 const {call,read}=await setup();await enable(call);const c=await call('deputy_claim');
 await assert.rejects(()=>call('deputy_complete',{...fields(c),result:{...decide,choices:[...decide.choices,{id:'idea-b',status:'under_exploration',reason:'Also selected'}]}}));
 assert.deepEqual((await read()).decisions,base.decisions);
 await call('deputy_fail',{...fields(c),retryable:false});assert.equal((await read()).deputy_reviews[0].status,'failed');assert.equal(deputyPending(await read()),false);
 await call('deputy_retry',{},'director');assert.equal(deputyPending(await read()),true);
}
{
 const {call,read}=await setup();await enable(call);const c=await call('deputy_claim');
 await call('team_review',{report_id:base.latest_team_report,decision:'keep_paused',comment:''},'director');
 assert.equal((await read()).deputy.enabled,false);await assert.rejects(()=>call('deputy_complete',{...fields(c),result:decide}));
}
console.log('PASS: off by default, human-only switch, delegated review, exact plans, one focus, real consultations, source attribution, role locks, duplicate delivery, stale input, human override and immediate revocation.');
