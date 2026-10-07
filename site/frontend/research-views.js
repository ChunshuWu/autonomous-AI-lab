'use strict';
const richText=value=>'<div class="markdown-body">'+WuLabMarkdown.renderMarkdown(value)+'</div>';
let libraryCatalog={revision:0,items:[]};
const researchFilters={experiment:'all',libraryKind:'all',topic:'all',scope:'project',search:'',timelineAgent:'all',timelineKind:'all'};
const materialLabels={paper:'Papers',dataset:'Data',baseline:'Baselines',tool:'Tools',notes:'Notes'};
const libraryAvailability=r=>/partial/i.test(r.availability||'')?'Partly available':/^(available|referenced location exists|existing local source)/i.test(r.availability||'')?'Available locally':r.availability?.length<55?r.availability:'See availability';
const recordLabels={experiment:'Experiment',meeting:'Meeting',method:'Method',proposal:'Proposal',library:'Library item'};
const records=type=>state?.research_records?.[type]||[];
const niceStatus=value=>({under_exploration:'Active',active:'Active',unexplored:'Unexplored',explored:'Explored',discarded:'Discarded',planned:'Planned',running:'Running',completed:'Completed',failed:'Failed',stopped:'Stopped'}[value]||value||'Not recorded');
const recBadge=value=>`<span class="record-badge ${esc(value)}">${esc(niceStatus(value))}</span>`;
const textBlock=(title,value)=>value?`<section class="record-section"><h3>${esc(title)}</h3>${richText(value)}</section>`:'';
const recordButton=(type,id,title)=>`<button class="text-button record-link" data-action="open-record" data-type="${esc(type)}" data-id="${esc(id)}">${esc(title)}</button>`;
function libraryItems(){
 const shared=state.project.kind==='example'?[]:libraryCatalog.items;
 const legacy=(state.library||[]).map((r,i)=>({...r,id:r.id||'legacy-library-'+i,summary:r.summary||r.description,kind:r.kind||'notes',topics:r.topics||[],project_ids:[state.project.id],legacy:true}));
 return [...shared,...legacy.filter(r=>!shared.some(x=>x.id===r.id||x.path&&x.path===r.path))];
}
function meetings(){return [...records('meeting'),...(state.discussions||[]).map(r=>({...r,summary:r.text,purpose:r.title,owner_id:r.author,occurred_at:r.created_at,legacy:true}))].sort((a,b)=>String(b.occurred_at||b.created_at).localeCompare(String(a.occurred_at||a.created_at)));}
function researchPage(title,page){$('#page-title').textContent=title;$('#topic-label').textContent=state.project.topic||state.project.name;document.title=title+' · Wu Lab';$('#banner').innerHTML=state.project.kind==='example'?'<div class="example-banner">Fictional example</div>':archiveBanner();$('#content').dataset.page=page;}
function filterSelect(label,key,value,options){return `<label class="record-filter">${esc(label)}<select data-research-filter="${key}">${options.map(([v,t])=>`<option value="${esc(v)}"${v===value?' selected':''}>${esc(t)}</option>`).join('')}</select></label>`;}
function experimentOutcomes(r){
 const execution={complete:'Assigned experiment completed',partial:'Partial experiment',blocked:'Experiment blocked'}[r.execution_outcome]||(['stopped','failed'].includes(r.status)?'Experiment '+niceStatus(r.status).toLowerCase():r.status==='completed'?'Execution marked completed; see the report for its scope':'Execution '+niceStatus(r.status).toLowerCase());
 const finding={not_tested:'Scientific comparison not tested',inconclusive:'Scientific result inconclusive',positive:'Reported positive finding; see evidence and limits',negative:'Reported negative finding'}[r.scientific_outcome]||'Scientific outcome not explicitly recorded; see the results';
 return execution+'. '+finding+'.';
}
function recordCard(r,type){return `<article class="record-card"><div class="record-card-meta">${r.status?recBadge(r.status):'<span>Saved discussion</span>'}<span>${esc(date(r.occurred_at||r.updated_at||r.created_at))}</span></div><h2>${recordButton(type,r.id,r.title)}</h2>${type==='experiment'?`<p>${esc(experimentOutcomes(r))}</p>`:''}<p>${esc(type==='meeting'?meetingConvergence(r):r.summary||'')}</p>${r.owner_id&&type!=='meeting'?`<small>${esc(displayName(r.owner_id))}</small>`:''}</article>`;}
function renderExperiments(){
 researchPage('Experiments','experiments');const all=records('experiment'),shown=all.filter(r=>researchFilters.experiment==='all'||r.status===researchFilters.experiment).slice().reverse();
 $('#content').innerHTML=`<div class="record-toolbar">${filterSelect('Status','experiment',researchFilters.experiment,[['all','All experiments'],...['planned','running','completed','failed','stopped'].map(x=>[x,niceStatus(x)])])}<span>${shown.length} experiment${shown.length===1?'':'s'}</span></div><div class="record-grid">${shown.map(r=>recordCard(r,'experiment')).join('')}</div>${!shown.length?'<p class="empty">No experiments recorded'+(all.length?' with this status.':'. New experiments will appear here with their setup, results, and figures.')+'</p>':''}`;
}
function renderMeetings(){researchPage('Meetings','meetings');const rows=meetings();$('#content').innerHTML=`<div class="record-grid">${rows.map(r=>recordCard(r,'meeting')).join('')}</div>${!rows.length?'<p class="empty">No meeting summaries recorded yet.</p>':''}`;}
function renderLibrary(){
 researchPage('Library','library');const all=libraryItems(),topics=[...new Set(all.flatMap(r=>r.topics||[]))].sort();
 const shown=all.filter(r=>(researchFilters.scope==='shared'||r.project_ids?.includes(state.project.id))&&(researchFilters.libraryKind==='all'||r.kind===researchFilters.libraryKind)&&(researchFilters.topic==='all'||r.topics?.includes(researchFilters.topic))&&[r.title,r.summary,...r.topics||[]].join(' ').toLowerCase().includes(researchFilters.search.toLowerCase()));
 $('#content').innerHTML=`<div class="record-toolbar">${filterSelect('Show','scope',researchFilters.scope,[['project','Used by this project'],['shared','Shared library']])}${filterSelect('Field or topic','topic',researchFilters.topic,[['all','All topics'],...topics.map(t=>[t,t])])}<label class="record-filter record-search">Search<input type="search" data-library-search value="${esc(researchFilters.search)}" placeholder="Title or topic"></label></div><div class="library-categories" aria-label="Library categories">${[['all','All material'],...Object.entries(materialLabels)].map(([k,t])=>`<button data-action="library-category" data-kind="${k}" aria-pressed="${k===researchFilters.libraryKind}">${t}</button>`).join('')}</div><p class="record-count">${shown.length} item${shown.length===1?'':'s'}</p><div class="record-grid">${shown.map(r=>`<article class="record-card"><div class="record-card-meta"><span>${esc(materialLabels[r.kind]||r.kind)}</span><span title="${esc(r.availability||'')}">${esc(libraryAvailability(r)||'Not recorded')}</span></div><h2>${recordButton('library',r.id,r.title)}</h2><p>${esc(r.summary)}</p><div class="record-tags">${(r.topics||[]).slice(0,4).map(t=>`<span>${esc(t)}</span>`).join('')}</div></article>`).join('')}</div>${!shown.length?'<p class="empty">No matching library items.</p>':''}`;
}
function recordLinks(r,type){
 const refs=[];
 for(const id of r.proposal_ids||[]){const n=mapState().nodes.find(n=>n.id===id);if(n)refs.push(recordButton('proposal',id,n.title));}
 for(const key of ['method','experiment','meeting']){
  const ids=new Set(r[key+'_ids']||[]);
  for(const x of records(key))if(x[type+'_ids']?.includes(r.id))ids.add(x.id);
  for(const id of ids){const n=records(key).find(n=>n.id===id);if(n)refs.push(recordButton(key,id,n.title));}
 }
 for(const id of r.report_ids||[]){const n=state.reports.find(n=>n.id===id);if(n)refs.push(`<button class="text-button record-link" data-action="history-report" data-id="${esc(n.id)}">${esc(n.title)}</button>`);}
 for(const id of r.library_ids||[]){const n=libraryItems().find(n=>n.id===id);if(n)refs.push(recordButton('library',id,n.title));}
 return refs.length?`<section class="record-section"><h3>Related work</h3><div class="record-links">${refs.join('')}</div></section>`:'';
}
function recordHistory(r){return r.history?.length?`<details class="quiet-details" data-panel="record-history-${esc(r.type||r.kind)}-${esc(r.id)}"${panelOpen('record-history-'+(r.type||r.kind)+'-'+r.id)}><summary>Earlier versions (${r.history.length})</summary>${r.history.slice().reverse().map(h=>`<section class="history-entry"><strong>Version ${h.revision} · ${esc(date(h.updated_at))}</strong><p>${esc(h.summary)}</p>${textBlock('Results',h.results)}${textBlock('Interpretation',h.interpretation)}${textBlock('Decision',h.decision_reason||h.decision)}${(h.figures||[]).map(WuLabVisuals.renderVisual).join('')}</section>`).join('')}</details>`:'';}
function recordChat(type,id,agentId=null,candidateId=null){
 const coordinator=state.agents.find(a=>a.id===state.orchestrator_id||a.role==='orchestrator');
 const recipient=agentId?state.agents.find(a=>a.id===agentId&&!a.dismissal):coordinator;
 const qs=(state.record_questions||[]).filter(q=>q.record_type===type&&q.record_id===id&&(q.candidate_id||'')===(candidateId||''));
 const key=(candidateId||'general').replace(/[^a-zA-Z0-9_-]/g,'-');
 return `<section class="record-section record-questions"><h3>${candidateId?'Ask the researcher':'Questions'}</h3><div class="record-chat-log" data-type="${esc(type)}" data-id="${esc(id)}" data-candidate="${esc(candidateId||'')}">${recordMessages(qs)}</div>${recipient?`<form class="record-question-form" data-type="${esc(type)}" data-id="${esc(id)}" data-agent="${esc(recipient.id)}" data-candidate="${esc(candidateId||'')}"><label for="question-${key}">Ask ${esc(displayName(recipient.id))}</label><textarea id="question-${key}" name="body" required placeholder="Ask about this ${candidateId?.startsWith('method')?'experiment':'idea'}"></textarea><button class="button" type="submit">Send question</button><p class="form-error" role="alert"></p></form>`:'<p class="form-note">Ask the orchestrator about this former researcher’s work.</p>'}</section>`;
}
function recordQuestionWaiting(q){
 const task=(state.tasks||[]).find(t=>t.source?.question_id===q.id);
 if(task){
  const text=task.status==='running'?displayName(task.agent_id)+' is answering.':task.status==='queued'?'Queued for a worker.':['failed','cancelled'].includes(task.status)?'Reply needs attention.':'Reply saved; refreshing.';
  return `<p class="chat-waiting">${esc(text)}</p>`;
 }
 const n=state.orchestrator_inbox?.find(n=>n.question_id===q.id),b=state.coordination_batches?.find(b=>b.id===n?.batch_id);
 return `<p class="chat-waiting">${b?.delivery.status==='failed'?'Reply needs attention.':b?.delivery.status==='answering'?'Orchestrator is answering.':'Waiting for the orchestrator.'}${b?.delivery.status==='failed'?` <button class="text-button" data-action="coord-retry" data-id="${esc(b.id)}">Try again</button>`:''}</p>`;
}
function recordMessages(qs){return qs.map(q=>`<div class="chat-message director-message"><small>You · ${esc(date(q.created_at))}</small>${richText(q.body)}</div>${q.replies.length?q.replies.map(r=>`<div class="chat-message agent-message"><small>${esc(displayName(r.agent_id))} · ${esc(date(r.created_at))}</small>${richText(r.body)}${r.task_id?taskDocumentButton(r.task_id):''}</div>`).join(''):recordQuestionWaiting(q)}`).join('');}
function syncRecordChat(){for(const host of document.querySelectorAll('.record-chat-log')){const html=recordMessages((state.record_questions||[]).filter(q=>q.record_type===host.dataset.type&&q.record_id===host.dataset.id&&(q.candidate_id||'')===(host.dataset.candidate||'')));if(host.innerHTML!==html)host.innerHTML=html;}}
function experimentDesign(p){const e=p?.experiment;return e?`<section class="experiment-design"><h4>Experiment plan</h4><dl class="mindset-fields">${[['Data',e.data],['Method',e.method],['Setup',e.setup],['Expected result',e.expected_outcome],['What it could tell us',e.learning]].map(([label,text])=>`<dt>${label}</dt><dd>${richText(text||'Not specified yet.')}</dd>`).join('')}</dl></section>`:'';}
function meetingDecision(r){
 if(r.director_decision)return textBlock('Your decision',r.decision)+(state.workflow?.status==='briefing'&&state.workflow.pending_meeting_id===r.id?'<p>Sharing your decision and conversations with the whole team.</p>':'');
 if(state.workflow?.status!=='awaiting_director'||state.workflow.pending_meeting_id!==r.id)return '';
 const review=r.workflow_phase==='assess',candidates=meetingCandidates(r),options=review?[['design','Design another experiment'],['repeat','Continue the selected experiment'],['reconsider','Discuss whether to keep the research question'],['stop','Stop here']]:[['select','Choose a candidate'],['design',r.workflow_phase==='reconsider'?'Prepare new candidates':'Reject all and prepare new candidates'],['stop','Stop here']];
 const choices=r.workflow_phase==='reconsider'?[{id:'stay-in-research',title:'Keep this question'},{id:'return-to-proposal',title:'Return to Proposal'}]:candidates;
 return `<section class="record-section director-meeting-decision"><h3>Your next step</h3><form id="meeting-decision-form" data-id="${esc(r.id)}" data-revision="${r.revision}"><label>Next step<select name="next_step">${options.map(([v,label])=>`<option value="${v}">${label}</option>`).join('')}</select></label>${!review?`<label>Candidate<select name="choice">${choices.map((c,i)=>`<option value="${esc(c.id)}">${i+1}. ${esc(c.title)}</option>`).join('')}</select></label>`:''}<label>Instructions (optional)<textarea name="comment" placeholder="Any changes or limits for the next step"></textarea></label><button class="button" type="submit">Confirm next step</button><p class="form-error" role="alert"></p></form></section>`;
}
function voteReason(v){
 const reason=String(v.reason||'').trim(),brief=v.reason_summary||reason;
 if(!v.reason_summary&&reason.length<=280)return esc(reason);
 const preview=v.reason_summary||brief.slice(0,240).replace(/\s+\S*$/,'')+'…';
 return `${esc(preview)}<details class="vote-detail"><summary>Full reason</summary>${richText(reason)}</details>`;
}
function meetingConvergence(r){
 const votes=r.votes||[];if(!votes.length)return 'No vote recorded.';
 const counts=new Map();votes.forEach(v=>counts.set(v.choice,(counts.get(v.choice)||0)+1));
 return counts.size===1?(counts.has('none_is_ready')?'Converged: all '+votes.length+' chose none is ready.':'Converged: all '+votes.length+' chose the same candidate.'):'Not converged: the leading choice received '+Math.max(...counts.values())+' of '+votes.length+' votes.';
}
function meetingCandidates(r){
 if(r.presentations?.length)return r.presentations;
 return [...(r.method_ids?.length?r.method_ids:r.proposal_ids||[])].map(id=>{const n=records('method').find(n=>n.id===id)||mapState().nodes.find(n=>n.id===id);return {id,title:n?.title||id,presentation:null};});
}
function candidatePresentation(row,i,meeting){
 const p=row.presentation,label=row.id.startsWith('method')?'Method':'Proposal';
 return `<li class="meeting-candidate" id="meeting-candidate-${esc(row.id)}"><h3><span class="candidate-number">${label} ${i+1}</span>${esc(row.title)}</h3>${p?`${richText(p.question)}${richText(p.prior_work+" "+p.gap)}<dl class="mindset-fields">${[['Idea',p.factor],['Why it may help',p.support],['Outcome to test',p.outcome],['Conditions',p.conditions]].map(([label,text])=>`<dt>${label}</dt><dd>${richText(text)}</dd>`).join('')}</dl>`:''}${p?.rejection_check?textBlock('How this differs from rejected ideas',p.rejection_check):''}${experimentDesign(p)}${row.task_id?taskDocumentButton(row.task_id,"Read full "+label.toLowerCase()):''}${meeting?.id&&!state.project?.archived_at&&(row.agent_id||(state.tasks||[]).find(t=>t.id===row.task_id)?.agent_id)?recordChat('meeting',meeting.id,row.agent_id||(state.tasks||[]).find(t=>t.id===row.task_id)?.agent_id,row.id):''}</li>`;
}
function meetingBody(r){
 const candidates=meetingCandidates(r),choice=v=>{const i=candidates.findIndex(c=>c.id===v.choice);return v.choice==='none_is_ready'?'None is ready':i<0?esc(v.choice):`<button class="text-button" data-action="meeting-candidate-jump" data-id="${esc(v.choice)}">${candidates[i].id.startsWith('method')?'Method':'Proposal'} ${i+1}</button>`;};
 return textBlock('Summary',meetingConvergence(r))+(r.director_status==='waiting'?'<p class="meeting-awaiting">Waiting for your decision.</p>':'')+(r.participant_ids?.length?'<p class="meeting-attendees">With '+r.participant_ids.map(id=>esc(displayName(id))).join(', ')+'.</p>':'')+(candidates.length?`<section class="record-section"><h3>${r.method_ids?.length?'Methods':'Proposals'}</h3><ol class="meeting-candidates">${candidates.map((c,i)=>candidatePresentation(c,i,r)).join('')}</ol></section>`:'')+(r.votes?.length?`<section class="record-section"><h3>Votes</h3><div class="table-wrap votes-wrap"><table class="votes-table" aria-label="Votes"><colgroup><col class="vote-researcher"><col class="vote-choice"><col></colgroup><thead><tr><th scope="col">Researcher</th><th scope="col">Choice</th><th scope="col">Reason</th></tr></thead><tbody>${r.votes.map(v=>`<tr><td><span class="vote-label" aria-hidden="true">Researcher</span>${esc(displayName(v.agent_id))}</td><td><span class="vote-label" aria-hidden="true">Choice</span>${choice(v)}</td><td><span class="vote-label" aria-hidden="true">Reason</span>${voteReason(v)}</td></tr>`).join('')}</tbody></table></div></section>`:'');
}
function showResearchRecord(type,id){
 let r=type==='library'?libraryItems().find(x=>x.id===id):type==='meeting'?meetings().find(x=>x.id===id):type==='proposal'?(state.research_map?.nodes||[]).find(x=>x.id===id):records(type).find(x=>x.id===id);if(!r)return toast('This record is no longer available.');
 let body='';
 if(type==='experiment'){
  const figures=r.figures||[],mainFigures=figures.filter(f=>!f.detail_only),detailFigures=figures.filter(f=>f.detail_only);
  body=textBlock('Execution and scientific outcome',experimentOutcomes(r))+textBlock('What we tested',r.purpose)+textBlock('What we expected',r.prediction)+textBlock(r.results?'Result in brief':'Progress',r.summary)+mainFigures.map(WuLabVisuals.renderVisual).join('')+textBlock('What this tells us',r.interpretation)+textBlock('What remains uncertain',r.uncertainty)+textBlock('Repairs attempted',r.recovery_attempts)+textBlock('Remaining obstacle',r.remaining_obstacle)+textBlock('Next step',r.next_step)+textBlock('Errors',r.error)+(r.results||detailFigures.length?`<details class="quiet-details experiment-data" data-panel="results-${esc(id)}"${panelOpen('results-'+id)}><summary>Full results and data</summary>${detailFigures.map(WuLabVisuals.renderVisual).join('')}${textBlock('Saved results',r.results)}</details>`:'')+`<details class="quiet-details" data-panel="setup-${esc(id)}"${panelOpen('setup-'+id)}><summary>Experiment setup and cost</summary>${['setup','baseline','data','code_version','settings','measures','budget','cost'].map(k=>textBlock(k.replaceAll('_',' '),r[k])).join('')}</details>`;
 }else if(type==='meeting'){
  body=meetingBody(r)+(r.suggestions?.length?`<details class="quiet-details"><summary>Meeting notes</summary>${r.suggestions.map(x=>`<section><h4>${esc(displayName(x.agent_id))}</h4>${richText(x.text)}${x.task_id?taskDocumentButton(x.task_id):''}</section>`).join('')}</details>`:'')+meetingDecision(r);
 }else if(type==='library'){
  const uses=Object.entries(state.research_records||{}).flatMap(([t,rows])=>rows.filter(x=>x.library_ids?.includes(r.id)).map(x=>recordButton(t,x.id,x.title)));
  body=textBlock('Summary',r.summary)+`<dl class="record-facts">${[['Category',materialLabels[r.kind]],['Topics',(r.topics||[]).join(', ')],['Version',r.version],['Availability',r.availability],['Reading',r.reading||'Not recorded'],['Checks and limits',r.checks||'Not recorded'],['Acquired by',r.acquired_by?displayName(r.acquired_by):null],['Read by',(r.read_by||[]).map(displayName).join(', ')]].filter(x=>x[1]).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl><section class="record-section"><h3>Sources and files</h3>${[...(r.source?[{label:'Source',source:r.source}]:[]),...(r.path?[{label:'Saved location',source:r.path}]:[]),...(r.links||[])].map(x=>`<p><strong>${esc(x.label)}</strong><br>${warningSource(x.source)}</p>`).join('')}</section>${uses.length?'<section class="record-section"><h3>Used in this project</h3>'+uses.join('')+'</section>':''}${r.notes?`<details class="quiet-details"><summary>Saved notes</summary>${richText(r.notes)}</details>`:''}`;
 }else{
  body=type==='proposal'?textBlock('Research question',r.presentation?.question||r.title):textBlock('Method',r.presentation?.question||r.summary)+textBlock('Next step',r.next_step);
  if(r.presentation){const p=r.presentation;body+=textBlock('The problem',p.prior_work+' '+p.gap)+textBlock(type==='method'?'Shared idea and this method':'The proposed idea',p.factor)+textBlock('Why it may help',p.support)+textBlock('What we will measure',p.outcome)+textBlock('Test conditions',p.conditions)+textBlock('How this differs from rejected ideas',p.rejection_check)+experimentDesign(p);}
  if(type==='proposal'){
   if(r.revision_of)body+=`<p>Earlier draft of ${recordButton('proposal',r.revision_of,'the original proposal')}.</p>`;
   if(r.revision_note)body+=`<p>${esc(r.revision_note)}</p>`;
   if(r.proposal_versions?.length)body+=`<details class="quiet-details proposal-versions"><summary>Versions (${r.proposal_versions.length})</summary>${r.proposal_versions.slice().reverse().map(v=>`<p><strong>Round ${esc(v.round)}</strong> · ${esc(v.title)}<br>${taskDocumentButton(v.task_id)}</p>`).join('')}</details>`;
  }
  if(type==='proposal')r={...r,report_ids:(r.report_refs||[]).map(x=>x.report_id),method_ids:records('method').filter(x=>x.proposal_ids.includes(id)).map(x=>x.id),experiment_ids:records('experiment').filter(x=>x.proposal_ids?.includes(id)).map(x=>x.id),meeting_ids:records('meeting').filter(x=>x.proposal_ids?.includes(id)).map(x=>x.id)};
  if(type==='method'&&!state.project.archived_at)body+=`<button class="button secondary" data-action="method-choice" data-id="${esc(id)}">Change method status</button>`;
 }
 body+=type!=='meeting'&&r.evidence?.length?`<details class="quiet-details"><summary>Evidence</summary>${r.evidence.map(e=>`<p>${esc(e.note)}<br>${warningSource(e.source)}</p>`).join('')}</details>`:'';
 const ask=!r.legacy&&!state.project.archived_at&&!!state.project.id;
 openDialog(r.title,recordLabels[type],`<div class="dialog-body record-detail">${r.status?recBadge(r.status):''}${body}${type==='meeting'?'':recordLinks(r,type)}${['proposal','meeting'].includes(type)?'':recordHistory(r)}${ask?recordChat(type,id):''}</div>`);
}
function showMethodChoice(id){const r=records('method').find(r=>r.id===id);openDialog(r.title,'Method status',`<div class="dialog-body"><form id="method-choice-form" data-id="${esc(id)}" data-revision="${r.revision}"><label>Status<select name="status">${['unexplored','active','explored','discarded'].map(x=>`<option value="${x}"${r.status===x?' selected':''}>${niceStatus(x)}</option>`).join('')}</select></label><label>Reason<textarea name="reason" required></textarea></label><p class="form-note">This records your choice. It does not start work.</p><button class="button" type="submit">Save status</button><p class="form-error" role="alert"></p></form></div>`);}
document.addEventListener('change',e=>{const key=e.target.dataset.researchFilter;if(!key)return;researchFilters[key]=e.target.value;timelineLimit=60;render();});
document.addEventListener('input',e=>{if(!e.target.matches('[data-library-search]'))return;researchFilters.search=e.target.value;const start=e.target.selectionStart;renderLibrary();const input=$('[data-library-search]');input.focus();try{input.setSelectionRange(start,start);}catch{}});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.action==='meeting-candidate-jump')document.getElementById('meeting-candidate-'+b.dataset.id)?.scrollIntoView({block:'start'});if(b.dataset.action==='open-record')showResearchRecord(b.dataset.type,b.dataset.id);if(b.dataset.action==='library-category'){researchFilters.libraryKind=b.dataset.kind;renderLibrary();}if(b.dataset.action==='method-choice')showMethodChoice(b.dataset.id);});
document.addEventListener('submit',async e=>{
 const form=e.target;if(!form.matches('.record-question-form,#method-choice-form,#meeting-decision-form'))return;e.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;
 try{const data=Object.fromEntries(new FormData(form));if(form.matches('.record-question-form')){await act({action:'record_question',record_type:form.dataset.type,record_id:form.dataset.id,agent_id:form.dataset.agent,candidate_id:form.dataset.candidate||undefined,client_id:form.dataset.clientId||(form.dataset.clientId=crypto.randomUUID()),body:data.body});form.reset();delete form.dataset.clientId;syncRecordChat();toast('Question sent to '+displayName(form.dataset.agent)+'.');}else if(form.id==='meeting-decision-form'){await act({action:'workflow_meeting_decision',meeting_id:form.dataset.id,expected_revision:Number(form.dataset.revision),client_id:form.dataset.clientId||(form.dataset.clientId=crypto.randomUUID()),...data});showResearchRecord('meeting',form.dataset.id);toast('Decision saved. Sharing it with the team.');}else{await act({action:'method_status',id:form.dataset.id,expected_revision:Number(form.dataset.revision),...data});showResearchRecord('method',form.dataset.id);toast('Method status saved.');}}catch(err){form.querySelector('.form-error').textContent=err.message;}finally{button.disabled=false;}
});
