import assert from 'node:assert/strict';
import {deputyFixture} from './deputy-fixture.mjs';
import {change} from './logic.mjs';
import {submitUpdate,submitTeamReport,reviewTeamReport} from './team.mjs';
import {reviewRunnerAction} from './review-runner.mjs';
import {setDeputy} from './deputy.mjs';
import {executionAction,executionContext,stopExecution} from './execution.mjs';

function progress(a){return [...new Map([...(a.prior_proposals||[]),...a.plan].map(x=>[x.id,x])).values()].map(x=>({id:x.id,task:x.task,status:a.plan.some(p=>p.id===x.id)?'done':'not_started',outcome:a.plan.some(p=>p.id===x.id)?'Fictional local test output saved.':'This alternative was not approved.'}));}
export async function executionFixture(){
 const f=await deputyFixture(),s=f.state,[a,l,w,o]=f.agents;
 const b=change(s,{action:'add_agent',name:'Peer',role:'researcher',specialty:'Independent comparison',question:'Read the saved note.',plan:['Read the saved note.']},'director');
 const u=submitUpdate(s,{agent_id:b.id,update:{summary:'A second saved contribution.',evidence:[{note:'Fixture note',source:'notes/peer.md'}],previous_steps:b.plan.map(x=>({...x,status:'not_started',outcome:'Fictional setup only.'}))}});
 const draft=structuredClone(f.report);delete draft.previous_reports;delete draft.research_round_id;
 draft.contributors.push({agent_id:b.id,update_id:u.id,report_id:null,previous_steps:u.previous_steps,next_steps:[{id:'peer-a',direction_id:'idea-a',task:'Write a source comparison using the first researcher’s saved outline',why:'Connect the two perspectives.',success:'A short note, no experiment.'}]});
 const report=submitTeamReport(s,{agent_id:w.id,report:draft});
 reviewRunnerAction(s,{action:'heartbeat',runner_id:'fixture',agent_ids:s.agents.map(a=>a.id),orchestrator_id:o.id,capabilities:['deputy']});setDeputy(s,{enabled:true,expected_epoch:0});
 const review_id='fixture-review',decision=reviewTeamReport(s,{report_id:report.id,decision:'continue',choices:s.research_map.nodes.map(n=>({id:n.id,status:n.id==='idea-a'?'under_exploration':'unexplored'}))},{actor:'Fixture deputy',authority:{kind:'deputy',agent_id:o.id,epoch:s.deputy.epoch,review_id}});s.paused=false;
 s.deputy_reviews=[{id:review_id,agent_id:o.id,epoch:s.deputy.epoch,report_id:report.id,status:'decided',decision_id:decision.id,next_action:'continue'}];
 const heartbeat=(extra={})=>executionAction(s,{action:'work_heartbeat',runner_id:'fixture',agent_ids:s.agents.map(a=>a.id),reviewer_ids:[],...extra});
 return {s,a:s.agents.find(x=>x.id===a.id),b,w:s.agents.find(x=>x.id===w.id),o,heartbeat};
}
const {s,a,b,w,heartbeat}=await executionFixture();
let pending=heartbeat().pending;assert.equal(pending.length,2);assert.equal(a.status,'feedback_received');
const call=(action,p)=>executionAction(s,{runner_id:'fixture',action,...p});
function claim(job){const p=call('work_claim',{job_id:job.id,agent_id:job.agent_id,understanding:'Only the approved fixture task.'});assert.ok(p);return p;}
const first=claim(pending[0]);assert.equal(a.status,'working');assert.equal(a.plan[0].id,'read-a');
assert.equal(call('work_claim',{job_id:first.job_id,agent_id:a.id,understanding:'duplicate'}),null);
assert.equal(reviewRunnerAction(s,{action:'claim',runner_id:'fixture',agent_id:a.id,question_id:'absent'}),null);
const update=agent=>({update:{summary:'Saved fictional result.',evidence:[{note:'Fictional artifact',source:'work/findings.md'}],previous_steps:progress(agent)}});
call('work_complete',{...first,completion_id:'first',result:update(a)});
assert.equal(a.status,'awaiting_writer');assert.equal(b.status,'feedback_received','Early completion must not revoke the other approved task.');
assert.equal(call('work_complete',{...first,completion_id:'first',result:update(a)}).already_completed,true);
pending=heartbeat().pending;assert.equal(pending.length,1);const second=claim(pending[0]);call('work_complete',{...second,completion_id:'second',result:update(b)});
pending=heartbeat().pending;assert.equal(pending.length,1);assert.equal(pending[0].kind,'writer');const writer=claim(pending[0]);
const context=executionContext(s,{runner_id:'fixture',...writer});assert.equal(context.report_history.length,s.reports.length,'The writer preview needs real earlier reports for exact history links.');const draft=structuredClone(context.report);delete draft.previous_reports;delete draft.revision_of;
assert.equal(context.report_contract.kind,'progress');
// Even a copied correction pointer must not merge this completed research round
// into the previous report. Draft repair passes must keep the new round identity.
draft.revision_of=context.report.id;
draft.map_revision=s.research_map.revision;draft.title='Completed fictional reading round';
draft.contributors=draft.contributors.map(c=>{const owner=s.agents.find(a=>a.id===c.agent_id);return {...c,update_id:owner.latest_update,report_id:owner.latest_report||null,previous_steps:progress(owner),next_steps:[]};});
const missingOwner=structuredClone(draft);missingOwner.contributors.pop();
assert.throws(()=>call('work_complete',{...writer,completion_id:'bad-draft',result:{report:missingOwner}}),/every approved owner/);
const reviewer=change(s,{action:'add_agent',name:'Scientific checker',role:'reviewer',specialty:'Evidence checks',question:'Check saved work.',plan:['Review the draft.']},'director');reviewer.status='paused';heartbeat({reviewer_ids:[reviewer.id]});
call('work_complete',{...writer,completion_id:'writer',result:{report:draft}});assert.equal(s.latest_team_report,context.report.id,'Draft must not be published before checks.');
pending=heartbeat({reviewer_ids:[reviewer.id]}).pending;assert.equal(pending.length,3);assert.ok(pending.every(j=>j.kind==='check'));
for(const job of pending){const c=claim(job);const reject=job.agent_id===reviewer.id;call('work_complete',{...c,completion_id:job.id,result:{approved:!reject,issues:reject?['Explain the fictional example more clearly.']:[],summary:'Contributor accuracy is valid; the independent checker asks for clarity.'}});}
assert.equal(s.latest_team_report,context.report.id);assert.equal(s.execution_rounds[0].status,'writing');
const repair=claim(heartbeat({reviewer_ids:[reviewer.id]}).pending[0]);call('work_complete',{...repair,completion_id:'corrected-draft',result:{report:draft}});
for(const job of heartbeat({reviewer_ids:[reviewer.id]}).pending){const c=claim(job);call('work_complete',{...c,completion_id:job.id,result:{approved:true,issues:[],summary:'The corrected fictional draft matches the saved result.'}});}
assert.notEqual(s.latest_team_report,context.report.id);assert.equal(w.status,'awaiting_director');assert.equal(s.execution_rounds[0].status,'reported');assert.equal(heartbeat().pending.length,0);
const published=s.reports.find(r=>r.id===s.latest_team_report);
assert.equal(published.report_kind,'progress');assert.equal(published.progress_version,1);
assert.notEqual(published.progress_id,context.report.progress_id);
assert.equal(published.revision_of,undefined);
assert.equal(published.research_round_id,s.execution_rounds[0].id);
assert.equal(published.execution_round_id,s.execution_rounds[0].id);

const stopped=await executionFixture();let job=stopped.heartbeat().pending[0];const c=executionAction(stopped.s,{action:'work_claim',runner_id:'fixture',job_id:job.id,agent_id:job.agent_id,understanding:'approved task'});
stopped.s.deputy.enabled=false;stopExecution(stopped.s,'Human pause');
assert.throws(()=>executionAction(stopped.s,{action:'work_renew',runner_id:'fixture',...c}),/no longer approved/);assert.equal(stopped.s.execution_jobs[0].status,'cancelled');assert.equal(stopped.a.status,'paused');
assert.throws(()=>executionAction(stopped.s,{action:'work_complete',runner_id:'fixture',...c,completion_id:'late',result:update(stopped.a)}),/no longer approved/);

const lost=await executionFixture();job=lost.heartbeat().pending[0];const lease=executionAction(lost.s,{action:'work_claim',runner_id:'fixture',job_id:job.id,agent_id:job.agent_id,understanding:'approved task'});
executionAction(lost.s,{action:'work_heartbeat',runner_id:'fixture',agent_ids:lost.s.agents.map(a=>a.id)},Date.now()+61000);
assert.equal(lost.s.execution_rounds[0].status,'blocked');assert.equal(lost.s.requests.at(-1).status,'pending');assert.equal(lost.heartbeat().pending.length,0);
executionAction(lost.s,{action:'work_retry',round_id:lost.s.execution_rounds[0].id});assert.equal(lost.heartbeat().pending.length,2);
for(const next of lost.heartbeat().pending){const restarted=executionAction(lost.s,{action:'work_claim',runner_id:'fixture',job_id:next.id,agent_id:next.agent_id,understanding:'Retry the exact approved task.'});assert.ok(restarted,'Both a previously started and a never-started owner must be claimable after retry.');}
const invalid=await executionFixture();const invalidJob=invalid.heartbeat().pending[0];invalid.a.status='paused';assert.equal(executionAction(invalid.s,{action:'work_claim',runner_id:'fixture',job_id:invalidJob.id,agent_id:invalidJob.agent_id,understanding:'A changed status cannot silently loop.'}),null);assert.equal(invalid.s.execution_rounds[0].status,'blocked');assert.equal(invalid.s.requests.at(-1).status,'pending');
console.log('Execution: exact approvals, exclusive claims, synchronized findings, writer/check/publication, idempotency, human stop, lost worker and explicit retry passed.');

const changed=await executionFixture();let staleJob=changed.heartbeat().pending[0];const staleClaim=executionAction(changed.s,{action:'work_claim',runner_id:'fixture',job_id:staleJob.id,agent_id:staleJob.agent_id,understanding:'Exact plan.'});changed.s.research_map.revision++;assert.throws(()=>executionAction(changed.s,{action:'work_renew',runner_id:'fixture',...staleClaim}),/no longer approved/);changed.heartbeat();assert.equal(changed.s.execution_rounds[0].status,'cancelled');
