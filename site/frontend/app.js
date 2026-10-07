'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusText={planned:'Plan to review',ready:'Ready',working:'Working',preparing_report:'Preparing report',awaiting_writer:'With the writer',awaiting_director:'Needs your review',feedback_received:'Ready for agent',revising_report:'Revising report',paused:'Paused',closed:'Stopped'};
const decisionText={comment:'Comment',keep_paused:'Keep paused',continue:'Continue proposed steps',revise_report:'Revise report only',close:'Stop this work'};
const freshStartVersion='qec-shot-history-20261006';
if(localStorage.getItem('wulab-start-version')!==freshStartVersion){localStorage.removeItem('wulab-hosted-workspace');localStorage.setItem('wulab-start-version',freshStartVersion);}
let state,csrf,workspace=localStorage.getItem('wulab-hosted-workspace')||'';
let selectedAgent,selectedReport,selectedRequest,selectedMapRevision,selectedTeamMapRevision,toastTimer;
let pendingView=null,renderedSignature=null,refreshSequence=0,appliedRefresh=0;
let reportTrail=[],reviewDrafts=new Map(),chatDrafts=new Map(),chatPending=null,currentSlide=null,reviewTab='questions';
let expandedPanels={};
let mapView=null,mapViewSignature=null;
try{expandedPanels=JSON.parse(sessionStorage.getItem('wulab-expanded-panels')||'{}');}catch{}
const {cats,catFor,agentName}=WuLabCats;
const {progressGroup,reportLabel,reportLifecycle}=WuLabReports;
let timelineLimit=60;
const {timelineEntries}=WuLabTimeline;
let currentPage=(['cats','map','timeline','experiments','meetings','library'].includes(location.hash.slice(1))?location.hash.slice(1):'research');
const cleanName=value=>String(value??'').replace(/^Test\s*[·:-]\s*/i,'');
const displayName=value=>{const a=state?.agents.find(a=>a.name===value||a.id===value);return a?agentName(a,state.agents):cleanName(value);};
const avatar=a=>{const cat=catFor(a,state.agents);return cat?`<span class="avatar cat-avatar" aria-hidden="true"><img src="${cat.image}" alt="" style="object-position:${cat.position||'50% 50%'}" width="40" height="40"></span>`:`<span class="avatar ${['','rose','purple','gold'][Math.max(0,state.agents.findIndex(x=>x.id===a.id))%4]}" aria-hidden="true">${esc(cleanName(a.name).charAt(0).toUpperCase())}</span>`;};
function activityText(value){
 // Only format event sentences; research text, source paths and saved names stay intact.
 const names=new Map((state?.agents||[]).map(a=>[a.name,agentName(a,state.agents)]));
 if(!names.size)return String(value??'');
 const escaped=[...names.keys()].sort((a,b)=>b.length-a.length).map(n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
 return String(value??'').replace(new RegExp('(^|[^\\p{L}\\p{N}_])('+escaped.join('|')+')(?=$|[^\\p{L}\\p{N}_])','gu'),(_,before,name)=>before+names.get(name));
}
const panelOpen=key=>expandedPanels[workspace+':'+key]?' open':'';
function rememberPanels(){
 document.querySelectorAll('details[data-panel]').forEach(d=>{expandedPanels[workspace+':'+d.dataset.panel]=d.open;});
 sessionStorage.setItem('wulab-expanded-panels',JSON.stringify(expandedPanels));
}
document.addEventListener('toggle',e=>{if(e.target.isConnected&&e.target.matches('details[data-panel]'))rememberPanels();},true);

// Project IDs come from saved project records, not a fixed list.
$('#workspace').value=workspace;
const reportURL=id=>`/documents/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`;
const reportFor=a=>{const r=state.reports.find(r=>r.id===(a.team_report_id||a.latest_report));return r&&reportLifecycle(state,r).status==='current'?r:null;};
const pending=()=>state.agents.filter(a=>['awaiting_director','paused'].includes(a.status));
function activeRound(){return (state.execution_rounds||[]).findLast(r=>r.epoch===state.deputy?.epoch&&r.report_id===state.latest_team_report);}
function deputyActivity(){
 const r=activeRound(),review=(state.deputy_reviews||[]).find(b=>b.epoch===state.deputy?.epoch&&b.report_id===state.latest_team_report);
 if(!state.deputy?.enabled)return 'Off';
 if(!state.review_runner||Date.now()-Date.parse(state.review_runner.last_seen)>90000)return 'Deputy offline';
 if(['reviewing','waiting','queued','failed'].includes(review?.status))return {reviewing:'Reviewing report',waiting:'Asking the team',queued:'Review queued',failed:'Review needs attention'}[review.status];
 if(r?.status==='blocked')return 'Work needs attention';
 if(r&&!['reported','cancelled'].includes(r.status)){
  if(!state.execution_runner||Date.now()-Date.parse(state.execution_runner.last_seen)>90000)return 'Worker service offline';
  return {research:'Coordinating approved work',writing:'Writer preparing report',checking:'Checking the new report'}[r.status]||'Waiting for progress';
 }
 if(review?.next_action==='continue')return 'Starting approved work';
 return review?.next_action==='keep_paused'?'Waiting for your decision':review?.next_action==='close'?'Covered work stopped':'Waiting for a report';
}
function agentActivity(a){
 if(a.dismissal)return {label:"Dismissed",style:"closed"};
 const task=(state.tasks||[]).find(t=>t.agent_id===a.id&&t.status==='running');if(task)return {label:Date.parse(task.lease_until)>Date.now()?'Working':'Connection lost',style:Date.parse(task.lease_until)>Date.now()?'working':'blocked'};
 if(a.id===state.orchestrator_id&&state.deputy?.enabled){const label=deputyActivity();return {label,style:/offline|attention|decision|stopped/i.test(label)?'paused':'working'};}
 const j=(state.execution_jobs||[]).findLast(j=>j.agent_id===a.id&&['running','queued','failed'].includes(j.status)&&j.round_id===activeRound()?.id);
 if(j?.status==='running'&&Date.parse(j.lease_until)>Date.now())return {label:j.kind==='check'?'Checking report':j.kind==='writer'?'Writing report':'Working',style:'working'};
 if(j?.status==='running')return {label:'Connection lost',style:'paused'};
 if(j?.status==='failed')return {label:'Needs attention',style:'paused'};
 if(j?.status==='queued')return {label:'Queued',style:'ready'};
 if(a.work_status?.base_status===a.status&&!(state.paused&&a.work_status.state==='working'))return {label:({working:(!a.last_seen||Date.now()-Date.parse(a.last_seen)>180000)?'Last reported: working':'Working',sleeping:'Sleeping',blocked:'Blocked',finished:'Finished'})[a.work_status.state],style:a.work_status.state};
 if(state.paused&&['working','ready'].includes(a.status))return {label:'Paused',style:'paused'};
 if(a.status==='working'&&(!a.last_seen||Date.now()-Date.parse(a.last_seen)>180000))return {label:'Last reported: working',style:'working'};
 return {label:statusText[a.status]||a.status,style:a.status};
}
const statusNote=a=>{const w=a.work_status?.base_status===a.status?a.work_status:null;return `<p class="agent-status-note">${w?esc(w.summary)+'<br>':''}${w?.waiting_for?esc(w.waiting_for)+'<br>':''}${a.last_seen?'Last check-in: '+esc(date(a.last_seen)):'No check-in yet'}</p>`;};
const badge=a=>{const activity=agentActivity(a);return `<span class="status ${esc(activity.style)}">${esc(activity.label)}</span>`;};
const date=t=>new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
function toast(t){$('#toast').textContent=t;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
function renderLatestView(){
 // Keep the page behind an open review still. Polling continues to update state
 // and permissions, but must not repaint underneath a scrolling slide iframe.
 if(!pendingView||$('#dialog').open||document.activeElement?.matches('[data-library-search],[data-research-filter]'))return;
 const view=pendingView;pendingView=null;
 if(view.signature===renderedSignature)return;
 const option=p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`;
 const options='<option value="">WuLab</option>'+view.projects.map(option).join('')+(view.archives.length?'<optgroup label="Archived projects">'+view.archives.map(option).join('')+'</optgroup>':'');
 if($('#workspace').innerHTML!==options)$('#workspace').innerHTML=options;
 $('#workspace').value=state.project.id;
 render();renderedSignature=view.signature;
}
async function refresh(){
 const requested=workspace,sequence=++refreshSequence;
 try{
  const r=await fetch(`/api/state?workspace=${encodeURIComponent(requested)}`);
  if(!r.ok)throw Error('Could not load this project. Refresh to try again.');
  const data=await r.json();if(workspace!==requested||sequence<appliedRefresh)return;
  appliedRefresh=sequence;
  state=data.state;workspace=state.project.id;csrf=data.csrf;libraryCatalog=data.library||{revision:0,items:[]};
  syncProjectActions();syncReviewChat();syncReportStatus();syncRecordChat();
  pendingView={projects:data.projects,archives:data.archives||[],signature:JSON.stringify([{...state,review_runner:undefined},data.projects,data.archives,libraryCatalog.revision])};
  renderLatestView();if($('#connection').textContent!=='Saved')$('#connection').textContent='Saved';
 }catch(e){if(workspace!==requested||sequence<appliedRefresh)return;if($('#connection').textContent!=='Offline')$('#connection').textContent='Offline';if(!state)$('#content').innerHTML=`<p class="loading-error">${esc(e.message)}</p>`;}
}
async function act(payload){if(!state.project.id||state.project.archived_at)throw Error('Choose an active project for new work.');const r=await fetch('/api/director',{method:'POST',headers:{'Content-Type':'application/json','X-WuLab-CSRF':csrf},body:JSON.stringify({workspace,...payload})});const body=await r.json();if(!r.ok)throw Error(body.error||'Could not save');await refresh();return body.result;}
function agentWorkBrief(a){
 const work=a.work_status?.base_status===a.status?a.work_status:null,tasks=(state.tasks||[]).filter(t=>t.agent_id===a.id);
 const task=tasks.find(t=>t.status==='running')||tasks.find(t=>t.status==='queued')||tasks.find(t=>t.id===work?.task_id);
 const text=String(task?.summary||work?.waiting_for||work?.summary||(['paused','closed'].includes(a.status)?'No active assignment':a.plan?.[0]?.task)||'No assigned task').trim();
 const words=text.split(/\s+/);return words.length>8?words.slice(0,8).join(' ').replace(/\s+(?:a|an|the|and|with|for|to|of|in|on)$/i,'')+'…':text;
}
function card(a){
 const role=String(a.role||'Agent').replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
 return `<article class="agent-card"><div class="agent-head">${avatar(a)}<div class="agent-identity"><div class="name">${esc(displayName(a.id))}</div><div class="specialty agent-role">${esc(role)}</div></div>${badge(a)}</div><p class="agent-work">${esc(agentWorkBrief(a))}</p><p class="agent-checkin">${a.last_seen?'Last check-in: '+esc(date(a.last_seen)):'No check-in yet'}</p><div class="agent-bottom"><button data-action="agent" data-id="${esc(a.id)}">View plan →</button></div></article>`;
}
function activity(){return state.events.slice(-8).reverse().map(e=>`<div class="event"><p><strong>${esc(displayName(e.actor))}</strong> ${esc(activityText(e.text))}</p><time>${date(e.at)}</time></div>`).join('')||'<p>No activity yet.</p>';}
function renderTimeline(){
 researchPage('Timeline','timeline');
 const all=timelineEntries(state,libraryCatalog.items),actorId=row=>row.agent_id||state.agents.find(a=>a.id===row.actor||a.name===row.actor)?.id||row.actor;
 const actors=[...new Set(all.map(actorId))],kinds=[...new Set(all.map(r=>r.kind))].sort();
 const entries=all.filter(r=>(researchFilters.timelineAgent==='all'||actorId(r)===researchFilters.timelineAgent)&&(researchFilters.timelineKind==='all'||r.kind===researchFilters.timelineKind)),shown=entries.slice(0,timelineLimit),days=new Map();
 for(const entry of shown){const day=new Date(entry.at).toLocaleDateString([],{year:'numeric',month:'long',day:'numeric'});if(!days.has(day))days.set(day,[]);days.get(day).push(entry);}
 $('#content').innerHTML=`<div class="record-toolbar">${filterSelect('Agent','timelineAgent',researchFilters.timelineAgent,[['all','All agents'],...actors.map(id=>[id,displayName(id)])])}${filterSelect('Activity','timelineKind',researchFilters.timelineKind,[['all','All activity'],...kinds.map(k=>[k,k.charAt(0).toUpperCase()+k.slice(1)])])}</div><div class="timeline">${[...days].map(([day,rows])=>`<section class="timeline-day"><h2>${esc(day)}</h2><ol>${rows.map(row=>{const actor=state.agents.find(a=>a.id===actorId(row));return `<li class="timeline-entry${row.kind==='obstacle'?' timeline-blocked':''}"><time datetime="${esc(row.at)}">${esc(new Date(row.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</time><div><div class="timeline-byline"><strong>${esc(displayName(actorId(row)))}</strong>${actor?`<small>${esc(actor.role||actor.specialty)}</small>`:''}<small class="timeline-kind">${row.kind==='obstacle'?'Blocked':esc(row.kind)}</small></div><p>${esc(activityText(row.description))}</p>${row.task_id?taskDocumentButton(row.task_id,'Read the full note'):''}${row.record_ref?recordButton(row.record_ref.type,row.record_ref.id,'Open '+(recordLabels[row.record_ref.type]||'record').toLowerCase()):''}${row.report_id?`<button class="text-button" data-action="history-report" data-id="${esc(row.report_id)}">Open report</button>`:''}${row.detail!==row.description||row.evidence?.length?`<details data-panel="timeline-${esc(row.id)}"${panelOpen('timeline-'+row.id)}><summary>Details</summary>${richText(activityText(row.detail))}${(row.evidence||[]).map(e=>`<p>${esc(e.note)} · ${warningSource(e.source)}</p>`).join('')}</details>`:''}</div></li>`;}).join('')}</ol></section>`).join('')||'<p class="empty">No matching activity.</p>'}${entries.length>shown.length?'<button class="button secondary" data-action="timeline-older">Older activity</button>':''}</div>`;
}
function warningSource(source){
 const value=String(source??'');
 try{const url=new URL(value);if(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password)return `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(value)}</a>`;}catch{}
 return `<code>${esc(value)}</code>`;
}
function warningCard(w){
 const resolved=w.status==='resolved',names=(w.agent_ids||[]).map(id=>state.agents.find(a=>a.id===id)).filter(Boolean).map(a=>displayName(a.id));
 const evidence=items=>`<ul class="warning-evidence">${items.map(e=>`<li>${esc(e.note)}<span>${warningSource(e.source)}</span></li>`).join('')}</ul>`;
 return `<details class="lab-warning${resolved?' resolved':''}" data-panel="warning-${esc(w.id)}"${panelOpen('warning-'+w.id)}><summary><span class="warning-heading"><span class="warning-label">${resolved?'Resolved':w.certainty==='possible'?'Possible issue':'Warning'}</span><strong>${esc(w.title)}</strong></span><span class="warning-symptom">${esc(w.symptom)}</span></summary><div class="warning-body">${names.length?`<p><strong>Affected:</strong> ${esc(names.join(', '))}</p>`:''}<p><strong>Effect:</strong> ${esc(w.impact)}</p><p><strong>Suggested response:</strong> ${esc(w.suggestion)}</p><div><strong>Evidence</strong>${evidence(w.evidence)}</div>${resolved?`<p><strong>Resolution:</strong> ${esc(w.resolution.note)}</p>${evidence(w.resolution.evidence)}`:''}<p class="warning-meta">${esc(displayName(w.reported_by))} · ${esc(date(w.updated_at))}</p></div></details>`;
}
function warningArea(){
 const open=(state.warnings||[]).filter(w=>w.status==='open'&&!['usage-calls','usage-tokens'].includes(w.key)).slice().sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
 if(!open.length)return '';
 return `<section class="lab-warnings" aria-label="Research warnings">${open.slice(0,3).map(warningCard).join('')}${open.length>3?`<details class="more-warnings" data-panel="more-warnings"${panelOpen('more-warnings')}><summary>${open.length-3} more warning${open.length-3===1?'':'s'}</summary>${open.slice(3).map(warningCard).join('')}</details>`:''}</section>`;
}
function warningHistory(){
 const resolved=(state.warnings||[]).filter(w=>w.status==='resolved'&&!['usage-calls','usage-tokens'].includes(w.key)).slice().sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
 return resolved.length?`<details class="quiet-details" data-panel="warning-history"${panelOpen('warning-history')}><summary>Earlier warnings</summary>${resolved.map(warningCard).join('')}</details>`:'';
}
function requestArea(){
 const pending=(state.requests||[]).filter(r=>r.status==='pending');
 const item=r=>`<article class="request-item"><button class="text-button" data-action="request" data-id="${esc(r.id)}">${esc(r.title)} →</button>${richText(r.question)}</article>`;
 return pending.length?`<section class="director-requests" aria-label="Requests for your decision"><h2>For your decision</h2>${pending.slice(0,3).map(item).join('')}${pending.length>3?`<details data-panel="more-requests"${panelOpen('more-requests')}><summary>${pending.length-3} more requests</summary>${pending.slice(3).map(item).join('')}</details>`:''}</section>`:'';
}
function requestHistory(){
 const done=(state.requests||[]).filter(r=>r.status!=='pending').slice().reverse();
 return done.length?`<details class="quiet-details" data-panel="request-history"${panelOpen('request-history')}><summary>Earlier requests</summary>${done.map(r=>`<p><button class="text-button" data-action="request" data-id="${esc(r.id)}">${esc(r.title)}</button></p>`).join('')}</details>`:'';
}
function showRequest(id){
 const r=(state.requests||[]).find(r=>r.id===id);if(!r)throw Error('This request is not in the current project.');
 selectedRequest={id:r.id,revision:r.revision};
 const choices=r.options.map(o=>`<li><strong>${esc(o.label)}</strong>${richText(o.detail)}</li>`).join('');
 const replies=r.responses.map(d=>`<div class="history-entry"><small>Request version ${d.request_revision} · ${esc(date(d.at))}</small><p>${esc(d.option?.label||({comment:'Comment',keep_pending:'Keep pending',close:'Request closed'}[d.decision]||d.decision))}${d.comment?'<br>'+esc(d.comment):''}</p></div>`).join('');
 const form=r.status==='pending'?`<form id="request-form"><div class="form-group"><label for="request-comment">Comments or answers (optional)</label><textarea id="request-comment" name="comment"></textarea></div><div class="form-group"><label for="request-choice">Response</label><select id="request-choice" name="choice"><option value="keep_pending">Keep pending</option><option value="comment">Send comment</option>${r.options.map((o,i)=>`<option value="option:${i}">${esc(o.label)}</option>`).join('')}<option value="close">Close this request</option></select></div><p class="form-note">The orchestrator will read your response and relay the allowed next step. Closing this request does not stop or restart an agent.</p><button class="button" type="submit">Send response</button><div class="form-error" role="alert"></div></form>`:`<p>${r.status==='superseded'?'Included in the combined team report.':r.status==='answered'?'Response saved.':'Request closed.'}</p>`;
 selectedRequest.options=r.options.map(o=>o.id);
 openDialog(r.title,`From the orchestrator · ${displayName(r.requester)}`,`<div class="request-layout"><section class="request-background"><h3>Background</h3>${richText(r.context)}<h3>Question</h3>${richText(r.question)}${choices?`<h3>Choices</h3><ul>${choices}</ul>`:''}${r.recommendation?`<p><strong>Recommendation:</strong> ${esc(r.recommendation)}</p>`:''}${r.evidence.length?`<details><summary>Evidence</summary><ul>${r.evidence.map(e=>`<li>${esc(e.note)}<br>${warningSource(e.source)}</li>`).join('')}</ul></details>`:''}${r.history.length>1?`<details><summary>Earlier versions</summary>${r.history.slice(0,-1).map(h=>`<div class="history-entry"><strong>Version ${h.revision}: ${esc(h.title)}</strong><p>${esc(h.context)}</p><p>${esc(h.question)}</p><ul>${h.options.map(o=>`<li>${esc(o.label)}: ${esc(o.detail)}</li>`).join('')}</ul>${h.recommendation?`<p>${esc(h.recommendation)}</p>`:''}</div>`).join('')}</details>`:''}${replies?`<details open><summary>Responses</summary>${replies}</details>`:''}</section><aside class="review-panel">${form}</aside></div>`);
}

function renderCats(){
 $('#page-title').textContent='Researchers';$('#topic-label').textContent='WuLab';document.title='Researchers · Wu Lab';
 $('#banner').replaceChildren();
 if($('#content').dataset.page==='cats')return;
 const link=s=>`<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.label)} <span aria-hidden="true">↗</span></a>`;
 $('#content').innerHTML=`<section class="cat-directory" aria-label="Researchers">${cats.map(c=>`<article class="cat-profile" id="cat-${c.id}"><img class="cat-portrait" src="${c.image}" alt="${c.name}" width="180" height="180" loading="lazy" style="object-position:${c.position||'50% 50%'}"><div class="cat-profile-text"><h2>${esc(c.name)}</h2><p class="cat-byline${c.resident?' resident':''}">${esc(c.byline)}</p><p class="cat-bio">${esc(c.bio)}</p>${c.source?`<div class="cat-links">${link(c.source)}${c.video?link({label:'Watch',url:c.video}):''}${c.extraSource?link(c.extraSource):''}</div>`:''}</div></article>`).join('')}</section>`;
 $('#content').dataset.page='cats';
}
const directionLabels={unexplored:'Unexplored',under_exploration:'Active',explored:'Explored',discarded:'Discarded'};
const mapState=()=>({...state.research_map,nodes:(state.research_map?.nodes||[]).filter(n=>!n.revision_of),revision:state.research_map?.revision||0});
const directionBadge=n=>`<span class="direction-status ${esc(n.status)}">${esc(directionLabels[n.status])}</span>`;
function directionChoices(nodes,prefix){return `<div class="direction-choices">${nodes.map(n=>`<label for="${prefix}-${esc(n.id)}"><span>${esc(n.title)}</span><select id="${prefix}-${esc(n.id)}" data-direction-id="${esc(n.id)}">${Object.entries(directionLabels).map(([value,label])=>`<option value="${value}"${n.status===value?' selected':''}>${label}</option>`).join('')}</select></label>`).join('')}</div>`;}
function renderMap(){
 const map={...mapState(),nodes:[...mapState().nodes,...records('method').map(r=>({...r,id:'method::'+r.id,parent_id:r.proposal_ids[0],status:r.status==='active'?'under_exploration':r.status,node_type:'method',report_refs:(r.report_ids||[]).map(report_id=>({report_id}))}))]},project=state.project;
 $('#page-title').textContent='Research map';$('#topic-label').textContent=project.topic||project.name;document.title='Research map · Wu Lab';$('#banner').innerHTML=archiveBanner();
 const signature=JSON.stringify([project.id,project.topic,project.name,map,state.reports.map(r=>[r.id,r.title])]);
 if($('#content').dataset.page==='map'&&mapViewSignature===signature)return;
 mapView?.destroy();mapView=null;mapViewSignature=signature;$('#content').dataset.page='map';

 $('#content').innerHTML=map.nodes.length?`<section class="map-shell"><div class="map-toolbar"><div class="map-legend" aria-label="Direction statuses">${Object.entries(directionLabels).map(([key,label])=>`<span class="legend-item ${key}"${key==='explored'?' title="Investigated, not necessarily solved"':''}><i aria-hidden="true"></i>${label}</span>`).join('')}</div>${state.project.archived_at?'':'<button class="button secondary" data-action="map-choices">Choose directions</button>'}</div><div id="research-tech-tree" class="tech-tree"></div></section>`:'<p class="empty">No directions recorded yet. The orchestrator adds ideas from the team’s brainstorms here.</p>';
 if(map.nodes.length)mapView=WuLabTree.mount($('#research-tech-tree'),{key:project.id,nodes:map.nodes,topic:project.topic||project.name,reports:state.reports,onGroup:showDirectionGroup,onNode:id=>id.startsWith('method::')?showResearchRecord('method',id.slice(8)):showResearchRecord('proposal',id),onOpen:ref=>{const r=state.reports.find(r=>r.id===ref.report_id);if(r)showReport(r.agent_id,r.id,ref.anchor);}});
}
function showDirectionGroup(group){
 openDialog(group.title,'Research map',`<div class="dialog-body direction-group-list">${group.members.map(n=>`<article><small>${n.node_type==='method'?'Method':'Proposal'}</small><h3>${recordButton(n.node_type==='method'?'method':'proposal',n.node_type==='method'?n.id.slice(8):n.id,n.title)}</h3><p>${esc(n.presentation?.question||n.summary)}</p></article>`).join('')}</div>`);
 const list=$('#dialog .direction-group-list');
 list.addEventListener('click',e=>{
  const link=e.target.closest('[data-action="open-record"]');if(!link)return;
  e.stopPropagation();
  const scrollTop=$('#dialog').scrollTop,listScrollTop=list.scrollTop,type=link.dataset.type,id=link.dataset.id;
  showResearchRecord(type,id);
  const back=document.createElement('button');back.type='button';back.className='text-button group-back';back.textContent='← Back to '+group.title;
  back.addEventListener('click',()=>{
   showDirectionGroup(group);
   const restored=$('#dialog .direction-group-list');
   Array.from(restored.querySelectorAll('[data-action="open-record"]')).find(b=>b.dataset.type===type&&b.dataset.id===id)?.focus({preventScroll:true});
   restored.scrollTop=listScrollTop;$('#dialog').scrollTop=scrollTop;
  });
  $('#dialog .dialog-head>div').prepend(back);$('#dialog').scrollTop=0;back.focus({preventScroll:true});
 });
}
function showDirection(id){showResearchRecord('proposal',id);}
function showMapChoices(){
 const map=mapState();selectedMapRevision=map.revision;
 openDialog('Choose directions','Research map',`<div class="dialog-body"><form id="map-form">${directionChoices(map.nodes,'map')}<p class="form-note">Choose at most one direction under exploration. This records the focus; approve its proposed work in the team report.</p><div class="form-group"><label for="map-comment">Comments (optional)</label><textarea id="map-comment" name="comment"></textarea></div><button class="button" type="submit">Save choices</button><div class="form-error" role="alert"></div></form></div>`);
}
function teamReportCard(r){
 const w=state.agents.find(a=>a.id===r.agent_id);
 return `<article class="agent-card team-report-card"><div class="agent-head">${avatar(w)}<div class="agent-identity"><div class="name">Team report · ${esc(reportLabel(state,r))}</div><div class="specialty">Prepared by ${esc(displayName(w.id))}</div></div>${badge(w)}</div><h3>${esc(r.title)}</h3><p class="card-summary">${esc(r.summary)}</p><div class="agent-bottom"><button data-action="report" data-id="${esc(w.id)}">Review team report →</button></div></article>`;
}
function render(){
 rememberPanels();syncProjectActions();
 if(currentPage!=='map'){mapView?.destroy();mapView=null;mapViewSignature=null;}
 document.querySelectorAll('.lab-nav [data-page]').forEach(a=>{const active=a.dataset.page===currentPage;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
 if(currentPage==='cats')return renderCats();
 if(!state)return;
 if(currentPage==='map')return renderMap();
 if(currentPage==='timeline')return renderTimeline();
 if(currentPage==='experiments')return renderExperiments();
 if(currentPage==='meetings')return renderMeetings();
 if(currentPage==='library'){if(!state.project.id)researchFilters.scope='shared';return renderLibrary();}
 if(!state.project.id){$('#content').dataset.page='research';$('#page-title').textContent='WuLab';$('#topic-label').textContent='';document.title='WuLab';$('#banner').replaceChildren();$('#content').innerHTML='<p class="empty">No active project. Tell the orchestrator what you want to study.</p>';return;}
 $('#content').dataset.page='research';
 const n=state.reports.filter(r=>reportLifecycle(state,r).status==='current').length,p=state.project,confirmed=p.topic_status==='confirmed';
 const title=confirmed||p.kind==='example'?p.topic:p.name;
 $('#page-title').textContent=title;
 $('#topic-label').textContent=state.workflow?`${state.workflow.stage} · ${({start:'Preparing assignments',prepare:'Preparing candidates',critique:'Discussing candidates',vote:'Voting',implement:'Running an experiment',assess:'Reviewing results'})[state.workflow.phase]||state.workflow.phase} · ${({awaiting_director:'Waiting for your decision',briefing:'Sharing your decision',running:'In progress',blocked:'Needs help',stopped:'Stopped',finished:'Finished'})[state.workflow.status]||state.workflow.status}`:p.kind==='example'?'Example topic':confirmed?'Research topic':'Topic not confirmed';
 document.title=`${n?'('+n+') ':''}${title} · Wu Lab`;
 $('#banner').innerHTML=(state.mode==='example'?'<div class="example-banner">Fictional example</div>':'')+(state.project.archived_at?archiveBanner():state.paused?'<div class="pause-banner">Project paused</div>':'')+(state.workflow?.status==='awaiting_director'?`<div class="pause-banner">Meeting ready for your decision. <button class="text-button" data-action="open-record" data-type="meeting" data-id="${esc(state.workflow.pending_meeting_id)}">Open meeting</button></div>`:'')+warningArea()+requestArea();
 const team=state.reports.find(r=>r.id===state.latest_team_report&&reportLifecycle(state,r).status==='current'),combined=!state.workflow&&(state.reporting_mode==='team'||!!state.latest_team_report),roster=state.agents.filter(a=>!a.dismissal),dismissed=state.agents.filter(a=>a.dismissal);
 $('#content').innerHTML=`${deputySummary()}${team?teamReportCard(team):combined?'<p class="empty current-report-empty">No current report. The writer will publish the next report when it is ready.</p>':''}${reportArchive()}${combined?`<details class="quiet-details" data-panel="team-status"${panelOpen('team-status')}><summary>Team status</summary>`:''}<div class="section-head"><p class="overview-count">${roster.length} agent${roster.length===1?'':'s'}</p>${usageCounters()}</div>${roster.length?`<div class="agents">${roster.map(card).join('')}</div>`:emptyTeam()}${combined?'</details>':''}${dismissed.length?`<details class="quiet-details" data-panel="past-researchers"${panelOpen('past-researchers')}><summary>Past researchers</summary>${dismissed.map(a=>`<p><button class="text-button" data-action="agent" data-id="${esc(a.id)}">${esc(displayName(a.id))} · ${esc(a.specialty)}</button> · ${esc(date(a.dismissal.at))}</p>`).join('')}</details>`:''}<details class="quiet-details" data-panel="direction"${panelOpen('direction')}><summary>Research direction</summary><p>${esc(state.direction)}</p></details><details class="quiet-details" data-panel="activity"${panelOpen('activity')}><summary>Recent activity</summary>${activity()}</details>${usageDetails()}${warningHistory()}${requestHistory()}`;
}
function archiveBanner(){return state?.project.archived_at?'<div class="pause-banner">Archived project · Read-only</div>':'';}
function emptyTeam(){return '<p class="empty">No researchers yet.</p>';}
function openDialog(title,subtitle,body){rememberPanels();$('#dialog-content').innerHTML=`<div class="dialog-head"><div><small>${esc(subtitle)}</small><h2 id="dialog-title">${esc(title)}</h2></div><button class="close-button" data-action="close" aria-label="Close dialog">×</button></div>${body}`;if(state.project.archived_at)$('#dialog-content').querySelectorAll('form input,form select,form textarea,form button[type=submit]').forEach(el=>el.disabled=true);if(!$('#dialog').open)$('#dialog').showModal();}
function history(a){return state.reports.filter(r=>r.agent_id===a.id).slice().reverse().map(r=>`<div class="history-entry"><button class="text-button" data-action="history-report" data-id="${esc(r.id)}">Version ${r.version}: ${esc(r.title)}</button>${state.decisions.filter(d=>d.report_id===r.id).map(d=>`<p><strong>${esc(decisionText[d.decision]||d.decision||'Direction')}</strong>${d.comment?'<br>'+esc(d.comment):''}</p>${Object.entries(d.answers||{}).map(([id,answer])=>`<p>${esc(r.questions.find(q=>q.id===id)?.text||id)}<br>${esc(answer)}</p>`).join('')}`).join('')}</div>`).join('')||'<p>No reports yet.</p>';}
function taskDocumentButton(id,label="Read reply document"){return `<button class="text-button" data-action="task-document" data-id="${esc(id)}">${esc(label)}</button>`;}
function showTaskDocument(id){const t=(state.tasks||[]).find(t=>t.id===id);if(!t?.result)return;openDialog(t.summary,displayName(t.agent_id),`<div class="dialog-body"><iframe title="Reply document" class="task-document" src="/task-documents/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}"></iframe></div>`);}
function taskUsage(r){if(['library_delivery','library_collect'].includes(r?.handler))return '<small>Saved by the service · no model call</small>';if(!r?.usage)return '';if(r.usage_scope==='unknown')return '<small>Task token use unavailable.</small>';return `<small>${r.usage_scope==='task'?'This task':'Saved session total (older record)'}: ${esc(r.usage.input_tokens||0)} input · ${esc(r.usage.output_tokens||0)} output tokens</small>`;}
function agentTasks(a){const rows=(state.tasks||[]).filter(t=>t.agent_id===a.id).slice(-8).reverse();return rows.length?`<section class="record-section"><h3>Tasks</h3>${rows.map(t=>`<details class="quiet-details"><summary>${esc(t.summary)} · ${esc(t.status.replaceAll('_',' '))}</summary>${richText(t.result?.document||t.result?.body?.length>3000?t.result.summary:t.result?.body||t.error||t.prompt)}${t.result?taskDocumentButton(t.id):''}${(t.result?.artifacts||[]).map(f=>`<p>${warningSource(f.path)}</p>`).join('')}${taskUsage(t.result)}</details>`).join('')}</section>`:'';}

function showAgent(id){const a=state.agents.find(a=>a.id===id);selectedAgent=id;openDialog(displayName(a.id),a.specialty,`<div class="dialog-body">${badge(a)}${a.dismissal?`<p>Dismissed ${esc(date(a.dismissal.at))}. ${esc(a.dismissal.reason)}</p>`:''}<h3>${esc(a.question)}</h3>${statusNote(a)}${agentTasks(a)}${a.status==='paused'?textBlock('Pause reason',state.events.slice().reverse().find(e=>(e.actor===a.name||e.agent_id===a.id)&&/paused affected work/i.test(e.text))?.text):''}<ul class="plan-list">${a.plan.map(s=>`<li>${esc(s.task)}</li>`).join('')}</ul>${a.latest_report?`<button class="button" data-action="history-report" data-id="${esc(a.latest_report)}">Open report</button>`:''}<details class="quiet-details" data-panel="history-${esc(a.id)}"${panelOpen('history-'+a.id)}><summary>Earlier reports and decisions</summary>${history(a)}</details></div>`);}
function nextSteps(a,r){
 const steps=r.next_steps||[];
 return `<section class="next-steps"><h3>${reportLifecycle(state,r).status==='archived'?'Previous proposals':'Next steps'}</h3>${steps.length?`<ol>${steps.map(step=>`<li><strong>${esc(step.task)}</strong>${step.why?`<p>${esc(step.why)}</p>`:''}${step.agent_id?`<small>${esc(displayName(step.agent_id))} · ${esc(mapState().nodes.find(n=>n.id===step.direction_id)?.title||'')}</small>`:''}</li>`).join('')}</ol>`:'<p>No next steps proposed.</p>'}</section>`;
}
function showReport(id,reportId,anchor){
 saveReviewDraft();
 let a=state.agents.find(a=>a.id===id);const r=reportId?state.reports.find(r=>r.id===reportId):reportFor(a);if(r?.report_type==='team')return showTeamReport(r,anchor);if(!r)return showAgent(id);selectedAgent=id;selectedReport=r.id;
 const latest=r.id===a.latest_report&&!a.team_report_id;
 const archived=reportLifecycle(state,r).status==='archived',canReview=latest&&!archived&&['awaiting_director','paused'].includes(a.status);
 const options=archived||a.dismissal?'<option value="comment">Save comment</option>':canReview?'<option value="keep_paused">Keep paused</option><option value="continue">Continue proposed steps</option><option value="revise_report">Revise report only</option><option value="close">Stop this work</option>':a.status==='closed'?'<option value="comment">Keep stopped</option><option value="revise_report">Revise report only</option>':'<option value="comment">Save comment</option>';
 const form=`<form id="review-form"><div class="form-group"><label for="review-comment">Comments or answers (optional)</label><textarea id="review-comment" name="comment" placeholder="Add a note if needed"></textarea></div><div class="form-group"><label for="review-decision">Next action</label><select id="review-decision" name="decision">${options}</select></div><button class="button" type="submit">Save decision</button><div class="form-error" role="alert"></div></form>`;
 openDialog(r.title,`${displayName(a.id)} · Version ${r.version}`,`<div class="report-layout"><div class="report-view">${reportBackButton()}<iframe class="slide-preview" title="${esc(r.title)} document" src="${reportURL(r.id)}${anchor?'#'+encodeURIComponent(anchor):''}"></iframe></div>${reviewSide(r,`<div class="review-agent">${avatar(a)}<strong>${esc(displayName(a.id))}</strong>${badge(a)}</div>${reportStatusNote(r)}${nextSteps(a,r)}${form}<details class="quiet-details" data-panel="history-${esc(a.id)}"${panelOpen('history-'+a.id)}><summary>Plan and history</summary><ul class="plan-list">${a.plan.map(s=>`<li>${esc(s.task)}</li>`).join('')}</ul>${history(a)}</details>` )}</div>`);finishReview(r,anchor);
}
function showTeamReport(r,anchor){
 saveReviewDraft();
 const w=state.agents.find(a=>a.id===r.agent_id),latest=r.id===state.latest_team_report;selectedAgent=w.id;selectedReport=r.id;selectedTeamMapRevision=mapState().revision;
 const canReview=latest&&reportLifecycle(state,r).status==='current';
 const options=canReview?'<option value="keep_paused">Keep paused</option><option value="continue">Continue selected direction</option><option value="revise_report">Revise report only</option><option value="close">Stop covered work</option>':'<option value="comment">Save comment</option>';
 const choices=canReview?directionChoices(mapState().nodes,'team'):'';
 const issued=state.decisions.slice().reverse().find(d=>d.report_id===r.id&&d.kind==='team_review'&&d.authority?.kind==='deputy');
 const form=`<form id="team-review-form">${issued?'<p class="form-note"><strong>Deputy decision:</strong> '+esc(decisionText[issued.decision]||issued.decision)+'. See Contributors and versions for the reason.</p>':''}${choices}<div class="form-group"><label for="review-comment">Comments or answers (optional)</label><textarea id="review-comment" name="comment" placeholder="Add a note if needed"></textarea></div><div class="form-group"><label for="review-decision">Next action</label><select id="review-decision" name="decision">${options}</select></div><button class="button" type="submit">Save decision</button><div class="form-error" role="alert"></div></form>`;
 const history=state.reports.filter(x=>x.report_type==='team'&&progressGroup(x)===progressGroup(r)).slice().reverse();
 openDialog(r.title,`Team report · ${reportLabel(state,r)}`,`<div class="report-layout"><div class="report-view">${reportBackButton()}<iframe class="slide-preview" title="${esc(r.title)} document" src="${reportURL(r.id)}${anchor?'#'+encodeURIComponent(anchor):''}"></iframe></div>${reviewSide(r,`<div class="review-agent">${avatar(w)}<strong>${esc(displayName(w.id))} · Writer</strong></div>${reportStatusNote(r)}${nextSteps(w,r)}${form}<details class="quiet-details"><summary>Contributors and versions</summary><p>${r.contributors.map(c=>esc(displayName(c.agent_id))).join(', ')}</p>${history.map(h=>`<p><button class="text-button" data-action="history-report" data-id="${esc(h.id)}">${esc(reportLabel(state,h))}: ${esc(h.title)}</button></p>`).join('')}${state.decisions.filter(d=>d.report_id===r.id&&d.kind==='team_review').map(d=>`<p>${d.authority?.kind==='deputy'?esc(d.actor)+' · ':''}${esc(decisionText[d.decision]||d.decision)}${d.comment?'<br>'+esc(d.comment):''}</p>`).join('')}</details>` )}</div>`);finishReview(r,anchor);
}
function chosenDirections(form){return Array.from(form.querySelectorAll('[data-direction-id]')).map(el=>({id:el.dataset.directionId,status:el.value}));}
document.addEventListener('click',async e=>{const b=e.target.closest('button');if(!b)return;const action=b.dataset.action;if(!action)return;try{if(action==='timeline-older'){timelineLimit+=60;renderTimeline();}else if(action==='work-retry'){await act({action:'work_retry',round_id:b.dataset.id});}else if(action==='deputy-retry'){await act({action:'deputy_retry'});}else if(action==='pause-project'){await act({action:'pause_lab'});}else if(action==='coord-retry'){await act({action:'coord_retry',batch_id:b.dataset.id});syncReviewChat();}else if(action==='chat-retry'){await act({action:'review_retry',question_id:b.dataset.id});syncReviewChat();}else if(action==='review-tab'){setReviewTab(b.dataset.tab);}else if(action==='report-back'){goBackReport();}else if(action==='chat-slide'){jumpReviewSlide(b.dataset.slide);}else if(action==='direction-node')showDirection(b.dataset.id);else if(action==='map-choices')showMapChoices();else if(action==='request')showRequest(b.dataset.id);else if(action==='close')$('#dialog').close();else if(action==='report')showReport(b.dataset.id);else if(action==='history-report'){navigateReport(b.dataset.id,b.dataset.anchor||'');}else if(action==='task-document')showTaskDocument(b.dataset.id);else if(action==='agent')showAgent(b.dataset.id);else if(action==='live'){rememberPanels();$('#content').replaceChildren();workspace='live';localStorage.setItem('wulab-hosted-workspace',workspace);$('#workspace').value=workspace;await refresh();}}catch(err){toast(err.message);}});
document.addEventListener('submit',async e=>{e.preventDefault();const form=e.target;if(form.id==='review-chat-form'){await sendReviewQuestion(form);return;}if(['map-form','team-review-form'].includes(form.id)){
 const data=Object.fromEntries(new FormData(form)),button=form.querySelector('button[type=submit]'),choices=chosenDirections(form);button.disabled=true;
 try{
  if(choices.filter(c=>c.status==='under_exploration').length>1)throw Error('Choose only one direction under exploration.');
  if(form.id==='map-form'){await act({action:'direction_choices',expected_revision:selectedMapRevision,choices,comment:data.comment});$('#dialog').close();renderMap();}
  else {const report_id=selectedReport;await act({action:'team_review',report_id,choices,...data});showTeamReport(state.reports.find(r=>r.id===report_id));}
  toast('Decision saved.');
 }catch(err){form.querySelector('.form-error').textContent=err.message;}finally{button.disabled=false;}return;
 }if(form.id==='request-form'){
 const data=Object.fromEntries(new FormData(form)),snapshot={...selectedRequest},button=form.querySelector('button[type=submit]');button.disabled=true;
 try{const isOption=data.choice.startsWith('option:');await act({action:'request_reply',request_id:snapshot.id,expected_revision:snapshot.revision,decision:isOption?'option':data.choice,option_id:isOption?snapshot.options[Number(data.choice.slice(7))]:undefined,comment:data.comment});showRequest(snapshot.id);toast('Response saved.');}
 catch(err){form.querySelector('.form-error').textContent=err.message;}finally{button.disabled=false;}return;
 }if(form.id!=='review-form')return;const data=Object.fromEntries(new FormData(form));const button=form.querySelector('button[type="submit"]');button.disabled=true;try{await act({action:data.decision==='comment'?'comment':'review',agent_id:selectedAgent,report_id:selectedReport,...data});showReport(selectedAgent,selectedReport);toast('Decision saved.');}catch(err){form.querySelector('.form-error').textContent=err.message;}finally{button.disabled=false;}});
$('#workspace').addEventListener('change',async e=>{saveReviewDraft();rememberPanels();$('#content').replaceChildren();researchFilters.timelineAgent='all';researchFilters.timelineKind='all';researchFilters.topic='all';timelineLimit=60;workspace=e.target.value;localStorage.setItem('wulab-hosted-workspace',workspace);state=null;pendingView=null;renderedSignature=null;selectedAgent=null;selectedReport=null;$('#dialog').close();$('#dialog-content').replaceChildren();await refresh();});
$('#dialog').addEventListener('click',e=>{if(e.target===$('#dialog'))$('#dialog').close();});
$('#dialog').addEventListener('close',()=>{saveReviewDraft(true);selectedReport=null;currentSlide=null;reportTrail=[];renderLatestView();});
window.addEventListener('hashchange',()=>{rememberPanels();currentPage=(['cats','map','timeline','experiments','meetings','library'].includes(location.hash.slice(1))?location.hash.slice(1):'research');if($('#dialog').open)$('#dialog').close();render();window.scrollTo(0,0);$('#page-title').setAttribute('tabindex','-1');$('#page-title').focus({preventScroll:true});});
if(currentPage==='cats')render();
refresh();setInterval(refresh,5000);

function reviewKey(reportId=selectedReport){return workspace+':'+reportId;}
function reportBackButton(){return reportTrail.length?'<button class="text-button report-back" data-action="report-back">← Back to previous report</button>':'';}
function reportArchive(){
 const reports=state.reports.filter(r=>reportLifecycle(state,r).status==='archived');if(!reports.length)return '';
 const groups=new Map();
 for(const r of reports){const key=r.report_type==='team'?progressGroup(r):'individual:'+r.agent_id;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const link=r=>`<button class="text-button" data-action="history-report" data-id="${esc(r.id)}">${esc(reportLabel(state,r))} · ${esc(r.title)}</button>`;
 return `<details class="quiet-details" data-panel="report-archive"${panelOpen('report-archive')}><summary>Report archive (${reports.length})</summary>${[...groups.values()].reverse().map(versions=>{const r=versions.at(-1);return `<div class="history-entry">${link(r)}<p class="form-note">${esc(date(r.created_at))} · ${esc(reportLifecycle(state,r).reason)}</p>${versions.length>1?`<details><summary>Earlier versions (${versions.length-1})</summary>${versions.slice(0,-1).reverse().map(r=>`<p>${link(r)}</p>`).join('')}</details>`:''}</div>`;}).join('')}</details>`;
}
function reportStatusNote(r){const status=reportLifecycle(state,r);return `<p class="form-note report-state-note"${status.status==='current'?' hidden':''}>${status.status==='archived'?'Archived · '+esc(status.reason)+' Proposed steps below are historical.':''}</p>`;}
function syncReportStatus(){
 if(!selectedReport||!$('#dialog').open)return;
 const r=state.reports.find(r=>r.id===selectedReport);if(!r)return;
 const status=reportLifecycle(state,r),archived=status.status==='archived',note=$('.report-state-note');
 if(note){note.hidden=!archived;note.textContent=archived?'Archived · '+status.reason+' Proposed steps below are historical.':'';}
 const heading=$('.next-steps h3');if(heading)heading.textContent=archived?'Previous proposals':'Next steps';
 if(archived){
  const choices=$('#review-decision');if(choices){for(const option of choices.options)option.disabled=option.value!=='comment';if(!Array.from(choices.options).some(o=>o.value==='comment'))choices.add(new Option('Save comment','comment'));choices.value='comment';}
  $('#review-decision-panel .direction-choices')?.setAttribute('hidden','');
 }
}

function saveReviewDraft(closing=false){
 if(!selectedReport||(!$('#dialog').open&&!closing))return;
 const form=$('#team-review-form')||$('#review-form');
 const frame=$('.slide-preview');let scroll=0;try{scroll=frame?.contentWindow?.scrollY||0;}catch{}
 reviewDrafts.set(reviewKey(),{comment:$('#review-comment')?.value||'',decision:$('#review-decision')?.value,choices:form?chosenDirections(form):[],scroll,tab:reviewTab,recipient:$('#chat-recipient')?.value});
 saveChatDraft();
}
function saveChatDraft(){const form=$('#review-chat-form');if(form&&selectedReport){const agent=$('#chat-recipient').value;chatDrafts.set(reviewKey()+':'+agent,$('#chat-body').value);form.dataset.recipient=agent;}}
function reviewSide(r,body){
 const people=[...new Set([r.agent_id,...(r.contributors||[]).map(c=>c.agent_id),...state.agents.filter(a=>a.id===state.orchestrator_id||a.role==='orchestrator').map(a=>a.id)])].map(id=>state.agents.find(a=>a.id===id)).filter(Boolean);
 return `<aside class="review-panel"><div class="review-tabs" role="tablist" aria-label="Review tools"><button type="button" role="tab" id="questions-tab" aria-controls="review-chat-panel" data-action="review-tab" data-tab="questions">Questions</button><button type="button" role="tab" id="decision-tab" aria-controls="review-decision-panel" data-action="review-tab" data-tab="decision">Decision</button></div><section id="review-chat-panel" role="tabpanel" aria-labelledby="questions-tab"><form id="review-chat-form"><label for="chat-recipient">Ask</label><select id="chat-recipient" name="agent_id">${people.map(a=>`<option value="${esc(a.id)}">${esc(displayName(a.id))}${a.role==='writer'?' · Writer':a.id===state.orchestrator_id||a.role==='orchestrator'?' · Orchestrator':''}${a.dismissal?' · Former assignment':''}</option>`).join('')}</select><p id="runner-status" class="chat-context" aria-live="polite"></p><div id="review-chat-log" class="review-chat-log" role="log" aria-live="polite" aria-relevant="additions"></div><p id="chat-context" class="chat-context"></p><label class="sr-only" for="chat-body">Your question</label><textarea id="chat-body" name="body" placeholder="Ask about this report…" maxlength="8000" required></textarea><button class="button" type="submit">Send question</button><div class="form-error" role="alert"></div></form></section><section id="review-decision-panel" role="tabpanel" aria-labelledby="decision-tab">${body}</section></aside>`;
}
function finishReview(r,anchor){
 currentSlide=anchor&&/^(slide-|section-)/.test(anchor)?anchor:null;
 const draft=reviewDrafts.get(reviewKey(r.id));reviewTab=draft?.tab||'questions';
 if(draft){if($('#review-comment'))$('#review-comment').value=draft.comment;if($('#review-decision')&&[...$('#review-decision').options].some(o=>o.value===draft.decision))$('#review-decision').value=draft.decision;for(const choice of draft.choices){const el=[...document.querySelectorAll('[data-direction-id]')].find(x=>x.dataset.directionId===choice.id);if(el)el.value=choice.status;}}
 const recipient=$('#chat-recipient');if(draft?.recipient&&[...recipient.options].some(o=>o.value===draft.recipient))recipient.value=draft.recipient;$('#review-chat-form').dataset.recipient=recipient.value;$('#chat-body').value=chatDrafts.get(reviewKey()+':'+recipient.value)||'';
 setReviewTab(reviewTab);syncReviewChat();
 const frame=$('.slide-preview');frame.addEventListener('load',()=>{if(!anchor&&draft?.scroll)frame.contentWindow.scrollTo(0,draft.scroll);},{once:true});
 recipient.addEventListener('change',()=>{const f=$('#review-chat-form');chatDrafts.set(reviewKey()+':'+f.dataset.recipient,$('#chat-body').value);f.dataset.recipient=recipient.value;$('#chat-body').value=chatDrafts.get(reviewKey()+':'+recipient.value)||'';chatPending=null;});
}
function setReviewTab(tab){reviewTab=tab;for(const t of ['questions','decision']){const button=$('#'+t+'-tab'),panel=$(t==='questions'?'#review-chat-panel':'#review-decision-panel');if(button){button.setAttribute('aria-selected',String(t===tab));button.tabIndex=t===tab?0:-1;}if(panel)panel.hidden=t!==tab;}}
function syncReviewChat(){
 const log=$('#review-chat-log');if(!log||!selectedReport||!state)return;
 const connected=state.review_runner&&Date.now()-Date.parse(state.review_runner.last_seen)<90000;
 const status=$('#runner-status');if(status)status.textContent=connected?'Automatic replies on.':state.review_runner?'Reply service offline · Questions stay saved.':'Automatic replies are not connected.';
 const questions=(state.review_questions||[]).filter(q=>q.report_id===selectedReport),sig=JSON.stringify([questions,connected,state.orchestrator_inbox,state.coordination_batches]);
 if(log.dataset.signature===sig)return;
 const nearEnd=log.scrollHeight-log.scrollTop-log.clientHeight<50;
 const empty=log.querySelector('.chat-empty');if(empty)empty.remove();
 if(!questions.length)log.innerHTML='<p class="chat-empty">Ask the writer or a contributor about this report.</p>';
 for(const q of questions){
  let item=document.getElementById('chat-'+q.id);
  if(!item){item=document.createElement('article');item.id='chat-'+q.id;item.className='chat-thread';item.innerHTML=`<div class="chat-message director-message"><small>${q.sender_kind==='deputy'?esc(displayName(q.sender_agent_id))+' · Deputy':'You'} → ${esc(displayName(q.agent_id))}${q.slide_id?` · <button class="text-button" data-action="chat-slide" data-slide="${esc(q.slide_id)}">${esc(anchorLabel(q.slide_id))}</button>`:''}</small>${richText(q.body)}</div><div class="chat-replies"></div><p class="chat-waiting"></p><p class="coord-waiting chat-context"></p>`;log.append(item);}
  const replies=item.querySelector('.chat-replies');
  for(const a of [...q.replies,...(q.coordination_replies||[])])if(!document.getElementById('chat-'+a.id)){const answer=document.createElement('div');answer.id='chat-'+a.id;answer.className='chat-message agent-message';answer.innerHTML=`<small>${esc(displayName(a.agent_id))}${a.batch_id?' · Orchestrator':''}</small>${richText(a.body)}${a.task_id?taskDocumentButton(a.task_id):''}${(a.references||[]).map(ref=>`<button class="text-button chat-reference" data-action="history-report" data-id="${esc(ref.report_id)}" data-anchor="${esc(ref.slide_id||'')}">${esc(ref.title)}${ref.slide_id?' · '+esc(anchorLabel(ref.slide_id)):''}</button>`).join('')}`;replies.append(answer);}
  const waiting=item.querySelector('.chat-waiting');
  let label='';
  if(!q.replies.length){
   const d=q.delivery,available=connected&&state.review_runner.agent_ids.includes(q.agent_id);
   label=d?.status==='cancelled'?'Discussion cancelled.':d?.status==='failed'?(d.error||'Reply failed.'):!available?'Waiting for reply service.':d?.status==='answering'&&Date.parse(d.lease_until)>Date.now()?displayName(q.agent_id)+' is answering…':'Queued for '+displayName(q.agent_id)+'.';
  }
  waiting.textContent=label;
  if(!q.replies.length&&q.delivery?.status==='failed'){const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.dataset.action='chat-retry';retry.dataset.id=q.id;retry.textContent=' Try again';waiting.append(retry);}
  const notes=(state.orchestrator_inbox||[]).filter(n=>n.question_id===q.id),flagged=notes.filter(n=>n.attention_kind!=='routine'&&!n.reviewed_at);
  const coordination=item.querySelector('.coord-waiting');
  if(flagged.length){
   const batches=flagged.map(n=>(state.coordination_batches||[]).find(b=>b.id===n.batch_id)).filter(Boolean),failed=batches.find(b=>b.delivery.status==='failed');
   coordination.textContent=failed?failed.delivery.error:!connected||!state.review_runner.orchestrator_id?'Waiting for orchestrator connection.':batches.some(b=>b.delivery.status==='answering')?'Orchestrator is reviewing.':'Orchestrator notified.';
   if(failed){const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.dataset.action='coord-retry';retry.dataset.id=failed.id;retry.textContent=' Try again';coordination.append(retry);}
  }else coordination.textContent=notes.length&&q.agent_id!==state.orchestrator_id&&!(q.coordination_replies||[]).length?(notes.every(n=>n.reviewed_at)?'Summary reviewed by orchestrator.':'Summary saved for orchestrator.') : '';

 }
 log.dataset.signature=sig;if(nearEnd)log.scrollTop=log.scrollHeight;
}
async function sendReviewQuestion(form){
 const button=form.querySelector('button[type=submit]'),body=$('#chat-body').value.trim(),agent_id=$('#chat-recipient').value,report_id=selectedReport,slide_id=currentSlide;
 if(!body)return;button.disabled=true;form.querySelector('.form-error').textContent='';
 const signature=JSON.stringify([workspace,report_id,agent_id,body,slide_id]);if(!chatPending||chatPending.signature!==signature)chatPending={signature,id:crypto.randomUUID()};
 try{await act({action:'review_question',report_id,agent_id,body,slide_id,client_id:chatPending.id});if(selectedReport===report_id&&$('#chat-body')?.value.trim()===body){$('#chat-body').value='';chatDrafts.delete(reviewKey(report_id)+':'+agent_id);}chatPending=null;syncReviewChat();}
 catch(e){if(form.isConnected)form.querySelector('.form-error').textContent=e.message;}
 finally{button.disabled=false;}
}
function navigateReport(id,anchor=''){
 const r=state.reports.find(x=>x.id===id);if(!r)return;
 saveReviewDraft();if(selectedReport&&$('#dialog').open&&selectedReport!==id)reportTrail.push({id:selectedReport});
 showReport(r.agent_id,id,anchor);
}
function goBackReport(){const last=reportTrail.pop();if(!last)return;const r=state.reports.find(x=>x.id===last.id);if(r)showReport(r.agent_id,r.id);}
function jumpReviewSlide(slide){const frame=$('.slide-preview');try{frame?.contentDocument?.getElementById(slide)?.scrollIntoView({block:'start'});}catch{}}
function anchorLabel(id){return ({'section-background':'Background','section-progress':'Progress','section-next-steps':'To-do items'})[id]||'Earlier section '+id.replace('slide-','');}
window.addEventListener('message',e=>{
 const frame=$('.slide-preview');if(e.origin!==location.origin||e.source!==frame?.contentWindow)return;
 if(e.data?.type==='wulab-section'&&/^(slide-[1-9][0-9]{0,3}|section-(background|progress|next-steps))$/.test(e.data.section_id)){currentSlide=e.data.section_id;const context=$('#chat-context');if(context)context.textContent='About: '+anchorLabel(currentSlide);}
 if(e.data?.type==='wulab-slide'&&/^slide-[1-9][0-9]{0,3}$/.test(e.data.slide_id)){currentSlide=e.data.slide_id;const context=$('#chat-context');if(context&&context.textContent!=='About slide '+currentSlide.slice(6))context.textContent='About slide '+currentSlide.slice(6);}
 if(e.data?.type==='wulab-report-link'&&typeof e.data.report_id==='string'){const anchor=typeof e.data.anchor==='string'?e.data.anchor:'';if(!anchor||/^(slide-[1-9][0-9]{0,3}|section-(?:background|progress|next-steps)|direction-[a-z0-9-]+|earlier-reports)$/.test(anchor))navigateReport(e.data.report_id,anchor);}
});
document.addEventListener('keydown',e=>{if(e.target.closest?.('.review-tabs')&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();setReviewTab(reviewTab==='questions'?'decision':'questions');$('#'+reviewTab+'-tab').focus();}});

function syncProjectActions(){
 const box=$('#project-actions');if(!box||!state)return;
 const canPause=!!state.project.id&&!state.project.archived_at&&!state.paused;
 const signature=String(canPause);if(box.dataset.signature===signature)return;
 box.dataset.signature=signature;
 box.innerHTML=canPause?'<button class="text-button" data-action="pause-project">Pause</button>':'';
}

function deputySummary(){
 const reviews=(state.deputy_reviews||[]),review=reviews.at(-1);if(!review)return '';
 const labels={continue:'Continue selected steps',revise_report:'Revise the report',keep_paused:'Keep paused',close:'Stop covered work'};
 return `${executionSummary()}<details class="quiet-details deputy-summary" data-panel="deputy-summary"${panelOpen('deputy-summary')}><summary>Deputy director${review.next_action?' · '+esc(labels[review.next_action]):''}</summary><p>${esc(review.summary||review.reason||'Review queued.')}</p>${review.summary&&review.reason?'<p>'+esc(review.reason)+'</p>':''}${review.next_action==='continue'?'<p>'+esc(state.paused?'Project paused.':activeRound()?deputyActivity()+'.':state.agents.some(a=>a.feedback?.authority?.review_id===review.id&&a.status==='working')?'Approved work has been claimed by a researcher.':'Approved tasks are queued for their owners.')+'</p>':''}${review.status==='failed'&&state.deputy?.enabled?'<button class="text-button" data-action="deputy-retry">Try again</button>':''}${reviews.slice().reverse().map(b=>`<details><summary>${esc(date(b.created_at))} · ${esc(b.status)}</summary>${b.history.map(h=>`<p><strong>${esc(labels[h.action]||'Team discussion')}</strong> · ${esc(h.summary)}</p><p>${esc(h.reason)}</p>${h.choices?.length?'<ul>'+h.choices.map(c=>'<li>'+esc(mapState().nodes.find(n=>n.id===c.id)?.title||c.id)+': '+esc(directionLabels[c.status])+'. '+esc(c.reason)+'</li>').join('')+'</ul>':''}`).join('')}<button class="text-button" data-action="history-report" data-id="${esc(b.report_id)}">Open report and discussion</button></details>`).join('')}</details>`;
}

function executionSummary(){
 const r=activeRound();if(!r||!state.deputy?.enabled||['reported','cancelled'].includes(r.status))return '';
 const jobs=(state.execution_jobs||[]).filter(j=>j.round_id===r.id),research=jobs.filter(j=>j.kind==='research'),done=research.filter(j=>j.status==='completed').length;
 const text=r.status==='blocked'?r.reason:r.status==='research'?`${done} of ${research.length} approved tasks finished.`:r.status==='writing'?`${displayName(r.writer_id)} is combining the findings into one report.`:'The team is checking the new report.';
 return `<section class="execution-status" aria-label="Automatic work"><p><strong>${esc(deputyActivity())}</strong> · ${esc(text)}</p>${r.status==='blocked'?`<button class="text-button" data-action="work-retry" data-id="${esc(r.id)}">Retry approved work</button>`:''}</section>`;
}

function usageTotals(){
 let input=0,output=0,unknown=0;
 for(const t of state.tasks||[]){if(!t.result||['library_collect','library_delivery'].includes(t.handler))continue;if(t.result.usage_scope!=='task'){unknown++;continue;}for(const key of ['input_tokens','output_tokens']){const n=t.result.usage?.[key];if(Number.isSafeInteger(n)&&n>=0){if(key==='input_tokens')input+=n;else output+=n;}}}
 return {input,output,unknown};
}
function usageCounters(){
 if(!state.task_policy)return '';
 const {input,output}=usageTotals();
 return `<div class="usage-counters" aria-label="Project usage"><span><strong>${(state.task_policy.used_calls||0).toLocaleString()}</strong> model calls</span><span title="Reported input plus output from finished tasks; cached input is counted once."><strong>${(input+output).toLocaleString()}</strong> reported tokens</span></div>`;
}
function usageDetails(){
 if(!state.task_policy)return '';
 const {input,output,unknown}=usageTotals();
 return `<details class="quiet-details" data-panel="usage"${panelOpen('usage')}><summary>Usage details</summary><p>${input.toLocaleString()} input tokens · ${output.toLocaleString()} output tokens · ${state.workflow?.checkpoint||0} checkpoints</p><p>Token totals update when tasks finish.${unknown?' Totals exclude '+unknown+' tasks with unknown usage.':''}${state.task_policy.usage_mode==='hard'?' This run has an explicitly set call limit.':''}</p></details>`;
}
