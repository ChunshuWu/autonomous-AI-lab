// Build a chronology from saved records. Reading it never creates activity.
const shortActivity=value=>{const text=String(value||'').replace(/\s+/g,' ').trim();return text.length<=220?text:text.slice(0,217).replace(/\s+\S*$/,'')+'…';};
function taskActivity(task,event){
 if(task.source?.type==='blocker_recovery'){
  if(event.text.startsWith('Queued:'))return 'Waiting for the orchestrator to check the block.';
  if(event.text.startsWith('Started:'))return 'The orchestrator started checking the block.';
  if(event.text.startsWith('Finished:'))return task.result?.outcome==='blocked'?'The recovery review could not finish.':'The orchestrator checked the block and saved its next action.';
 }
 const phase=task.workflow_context?.phase,methods=task.workflow_context?.stage==='Research';
 const subject=methods?'methods':'proposals';
 const work=task.kind==='coordination'?['review the team’s progress','Reviewed the team’s progress.']:
 task.kind==='library'?['update the paper library','Updated the paper library.']:
 task.kind==='question'?['answer a question','Answered a question.']:
 task.kind==='vote'?['vote on the next step','Submitted a vote.']:
 task.kind==='engineering'?['carry out the agreed implementation or test','Finished the assigned implementation or test.']:
 task.kind==='mathematics'?['work through the mathematical question','Finished the assigned mathematical work.']:
 phase==='critique'?['review the other researchers’ '+subject,'Finished reviewing the other researchers’ '+subject+'.']:
 phase==='response'?['revise the '+(methods?'method':'proposal')+' after feedback','Revised the '+(methods?'method':'proposal')+' after feedback.']:
 phase==='assess'?['review the results','Finished reviewing the results.']:
 ['proposal','research'].includes(task.kind)?['prepare a research '+(methods?'method':'proposal'),'Prepared a research '+(methods?'method':'proposal')+'.']:
 ['work on the assigned task','Finished the assigned task.'];
 if(event.text.startsWith('Queued:'))return 'Waiting to '+work[0]+'.';
 if(event.text.startsWith('Started:'))return 'Started to '+work[0]+'.';
 if(event.text.startsWith('Cancelled:'))return 'This task was stopped.';
 if(event.text.startsWith('Finished:')){
  if(task.result?.outcome==='blocked')return 'Could not finish the task. Help or more information is needed.';
  // A vote stays private until the full team has voted. Old summaries remain in Details.
  if(task.kind!=='vote'&&['simple-language-v1','nonexpert-language-v2'].includes(task.writing_guidance_version)&&task.result?.summary)return task.result.summary;
  return work[1];
 }
 return null;
}
function workflowActivity(event,tasks){
 const match=event.text.match(/^Checkpoint complete: (Proposal|Research) \/ (\w+) \/ round (\d+)\.$/);
 if(match){
  const subject=match[1]==='Proposal'?'proposals':'methods';
  const steps={prepare:'Everyone has prepared their '+subject+'.',critique:'Everyone has reviewed the '+subject+'.',response:'Everyone has revised their '+subject+'.',vote:'Everyone has voted.',reconsider:'Everyone has voted on whether to change the research question.',implement:'The assigned implementation work is complete.',feasibility:'The initial feasibility check is complete.',assess:'Everyone has reviewed the results.'};
  return 'Round '+match[3]+': '+(steps[match[2]]||'The current step is complete.');
 }
 if(event.text.startsWith('Workflow started:'))return 'The team is starting to look for a useful research question.';
 if(event.text.startsWith('Next step:')){
  const chair=tasks.find(t=>t.kind==='coordination'&&t.finished_at===event.at),plan=chair?.result?.workflow_plan;
  if(['simple-language-v1','nonexpert-language-v2'].includes(chair?.writing_guidance_version)&&plan?.summary)return plan.summary;
  const subjects=chair?.workflow_context?.stage==='Research'?'methods':'proposals';
  return {prepare:'Next: prepare '+subjects+' for the team to discuss.',critique:'Next: review each other’s '+subjects+'.',response:'Next: revise the '+subjects+' using the feedback.',vote:'Next: vote on which idea to try.',implement:'Next: the engineer will implement the selected method.',feasibility:'Next: check whether the proposed test can run.',assess:'Next: the researchers will review the results.'}[plan?.next_phase]||'The next tasks have been assigned.';
 }
 return null;
}
export function timelineEntries(s,library=[]){
 const rows=[],reports=s.reports||[],add=(id,at,actor,kind,description,ref={})=>{if(at&&Number.isFinite(Date.parse(at)))rows.push({id,at,actor,kind,description:shortActivity(description),detail:String(description||''),...ref});};
 for(const [i,event] of (s.events||[]).entries()){
  // A saved report has a more useful title, summary and link than a generic notice.
  const report=reports.find(r=>Math.abs(Date.parse(r.created_at)-Date.parse(event.at))<2000&&/submitted.*(?:report|slides)|published.*report/i.test(event.text));
  if(report)continue;
  const task=(s.tasks||[]).find(t=>t.id===event.task_id);
  const description=(task?taskActivity(task,event):null)||workflowActivity(event,s.tasks||[])||shortActivity(event.text);
  const detail=task&&event.text.startsWith('Finished:')&&task.result?.summary?task.summary+' — '+task.result.summary:event.text;
  const blocked=event.kind==='obstacle'||event.status_content?.state==='blocked'||event.work_status?.state==='blocked'||/^Workflow stopped:|^Task stopped:|^Stopped before a model call:|^Worker stopped checking in\.|^A required task failed/.test(event.text)||event.text.startsWith('Finished:')&&task?.result?.outcome==='blocked';
  add(event.id||'event-'+i,event.at,event.actor,blocked?'obstacle':event.kind||'activity',event.text,{description,detail,blocked,task_id:task?.result?task.id:null,report_id:event.report_id||null,evidence:event.evidence||[],agent_id:event.agent_id,record_ref:event.record_ref});
 }
 for(const r of reports)add('report-'+r.id,r.created_at,r.agent_id,'report',r.title+' — '+r.summary,{report_id:r.id});
 const decisions={continue:'Approved the proposed next steps.',keep_paused:'Kept the work paused.',revise_report:'Requested a report correction.',close:'Stopped the covered work.',comment:'Left a report comment.'};
 for(const d of s.decisions||[])if(d.report_id&&decisions[d.decision])add('decision-'+d.id,d.at,d.actor||'Director','decision',decisions[d.decision]+(d.comment?' '+d.comment:''),{report_id:d.report_id});
 for(const job of s.execution_jobs||[]){
  const task={research:'the approved research task',writer:'the combined report',check:'the scientific report check'}[job.kind]||'the assigned task';
  const round=(s.execution_rounds||[]).find(r=>r.id===job.round_id),ref={report_id:round?.published_report_id||round?.report_id||null};
  add('start-'+job.id,job.started_at,job.agent_id,'work','Started '+task+'.'+(job.approved_steps?.[0]?.task?' '+job.approved_steps[0].task:''),ref);
  if(job.finished_at)add('finish-'+job.id,job.finished_at,job.agent_id,job.status==='failed'?'obstacle':'work',job.status==='failed'?'Stopped: '+job.error:'Finished '+task+'. '+(job.result?.summary||''),ref);
 }
 for(const q of s.review_questions||[]){
  add('question-'+q.id,q.created_at,q.sender_agent_id||'Director','question',q.body,{report_id:q.report_id});
  for(const reply of [...(q.replies||[]),...(q.coordination_replies||[])])add('reply-'+reply.id,reply.created_at,reply.agent_id,'reply',reply.body,{report_id:q.report_id});
 }
 for(const m of s.discussions||[])add('meeting-'+m.id,m.created_at,m.author,'meeting',m.title+' — '+m.text,{record_ref:{type:'meeting',id:m.id}});
 for(const item of library.filter(r=>r.project_ids?.includes(s.project?.id))){
  for(const r of [...item.history||[],item])add('library-'+item.id+'-'+r.revision,r.updated_at,r.updated_by||r.acquired_by,'library',(r.revision===1?'Added to library: ':'Updated library item: ')+r.title,{record_ref:{type:'library',id:item.id}});
 }
 for(const q of s.record_questions||[])for(const reply of q.replies||[])add(reply.id,reply.created_at,reply.agent_id,'reply',reply.body,{record_ref:{type:q.record_type,id:q.record_id}});
 const unique=new Map();for(const row of rows)unique.set(row.id,row);
 return [...unique.values()].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||a.id.localeCompare(b.id));
}
