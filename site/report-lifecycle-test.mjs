import assert from 'node:assert/strict';
import {deputyFixture} from './deputy-fixture.mjs';
import {submitTeamReport,reviewTeamReport} from './team.mjs';
import {reportLifecycle,reportCatalog,reportLabel} from './report-lifecycle.mjs';
import {earlierReports} from './report-history.mjs';

export function freshReport(source){
 const r=structuredClone(source);
 for(const key of ['id','version','report_kind','progress_id','progress_version','research_round_id','execution_round_id','revision_of','previous_reports','previous_report'])delete r[key];
 return r;
}
export async function archiveFixture(){
 const f=await deputyFixture(),s=f.state,w=f.agents[2];
 const correction=submitTeamReport(s,{agent_id:w.id,report:{...freshReport(f.report),report_kind:'correction',revision_of:f.report.id,title:'A clearer explanation of the first round'}});
 const progress=submitTeamReport(s,{agent_id:w.id,report:{...freshReport(correction),report_kind:'progress',title:'A separate report for the second round'}});
 return {...f,state:s,correction,progress};
}
const f=await archiveFixture(),s=f.state,w=f.agents[2],saved=structuredClone(s);
assert.equal(reportLifecycle(s,f.report).status,'archived');
assert.equal(reportLifecycle(s,f.correction).status,'archived');
assert.equal(reportLifecycle(s,f.progress).status,'current');
assert.deepEqual(reportCatalog(s).current_ids,[f.progress.id]);
assert.equal(reportLabel(s,f.report),'Round 1 · Version 1');
assert.equal(reportLabel(s,f.correction),'Round 1 · Version 2');
assert.equal(reportLabel(s,f.progress),'Round 2 · Version 1');
assert.equal(f.correction.research_round_id,f.report.research_round_id);
assert.notEqual(f.progress.research_round_id,f.correction.research_round_id);
assert.equal(earlierReports(s,f.progress)[0].report_id,f.correction.id);
assert.deepEqual(s,saved,'Classifying the archive must not alter reports, decisions, permissions or jobs.');
assert.throws(()=>submitTeamReport(s,{agent_id:w.id,report:{...freshReport(f.progress),research_round_id:f.progress.research_round_id}}),/already has a report/);
assert.throws(()=>submitTeamReport(s,{agent_id:w.id,report:{...freshReport(f.progress),report_kind:'progress',revision_of:f.progress.id}}),/new round must be a new report/);
assert.throws(()=>submitTeamReport(s,{agent_id:w.id,report:{...freshReport(f.progress),report_kind:'correction',revision_of:f.progress.id,research_round_id:'different-round'}}),/same research round/);
const stale=structuredClone(s);stale.agents.find(a=>a.id===f.agents[0].id).latest_update='new-findings';
assert.equal(reportLifecycle(stale,f.progress).status,'archived');
assert.match(reportLifecycle(stale,f.progress).reason,/New findings/);
assert.throws(()=>reviewTeamReport(stale,{report_id:f.progress.id,decision:'continue'}),/archived/);
const moved=structuredClone(s);moved.research_map.revision++;
assert.equal(reportLifecycle(moved,f.progress).status,'archived');
// An approved source report becomes history while its task permission survives.
reviewTeamReport(s,{report_id:f.progress.id,decision:'continue',choices:s.research_map.nodes.map(n=>({id:n.id,status:n.id==='idea-a'?'under_exploration':'unexplored'}))});
const approved=structuredClone(s.agents.find(a=>a.id===f.agents[0].id).feedback);
assert.equal(reportLifecycle(s,f.progress).status,'archived');
assert.deepEqual(s.agents.find(a=>a.id===f.agents[0].id).feedback,approved);
assert.throws(()=>reviewTeamReport(s,{report_id:f.progress.id,decision:'continue'}),/archived/);
const badCorrection={...freshReport(f.progress),map_revision:s.research_map.revision,revision_of:f.progress.id};
badCorrection.contributors=badCorrection.contributors.map(c=>({...c,previous_steps:[...new Map([...s.agents.find(a=>a.id===c.agent_id).plan,...s.agents.find(a=>a.id===c.agent_id).prior_proposals].map(p=>[p.id,{...p,status:'not_started',outcome:'No new work was run.'}])).values()]}));
assert.throws(()=>submitTeamReport(s,{agent_id:w.id,report:badCorrection}),/already started another round/);
// A stopped individual report and all legacy individual reports in a team project are archived.
const legacy={id:'legacy',agent_id:f.agents[0].id,version:1};
const old=structuredClone(saved);old.reports.unshift(legacy);old.agents[0].latest_report=legacy.id;
assert.equal(reportLifecycle(old,legacy).status,'archived');
// Saving a historical comment must not turn the deputy off or revoke work.
const live=await deputyFixture();
await live.store.apply(live.workspace,{action:'heartbeat',runner_id:'fixture',agent_ids:live.agents.map(a=>a.id),orchestrator_id:live.agents[3].id,capabilities:['deputy']},'reply_runner');
await live.store.apply(live.workspace,{action:'deputy_toggle',enabled:true,expected_epoch:0},'director');
const second=await live.store.apply(live.workspace,{action:'report',agent_id:live.agents[2].id,report:{...freshReport(live.report),report_kind:'progress'}},'worker');
const before=(await live.store.read(live.workspace)).state;
await live.store.apply(live.workspace,{action:'team_review',report_id:live.report.id,decision:'comment',comment:''},'director');
const after=(await live.store.read(live.workspace)).state;
for(const key of ['deputy','agents','reports','paused','execution_jobs','execution_rounds'])assert.deepEqual(after[key],before[key],key);
assert.equal(after.latest_team_report,second.id);
console.log('PASS: archive classification, stable round/version history, separate new reports, correction boundaries, no old approvals, preserved permissions and historical comments.');
