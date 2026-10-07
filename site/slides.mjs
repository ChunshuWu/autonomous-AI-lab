import {renderVisual} from './visuals.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const links=items=>`<div class="sources">${(items||[]).map(x=>{const url=typeof x==='string'?x:x.url||'',label=typeof x==='string'?x:x.label||'Source';return /^https?:\/\//i.test(url)?`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`:url&&url!==label?`<details class="source-path"><summary>${esc(label)}</summary><code>${esc(url)}</code></details>`:`<span>${esc(label)}</span>`;}).join(' · ')}</div>`;
const slideReportLink=(key,workspace,anchor)=>'/slides/'+encodeURIComponent(key)+'?workspace='+encodeURIComponent(workspace)+(anchor?'#'+encodeURIComponent(anchor):'');
const groups=(items,n=2)=>Array.from({length:Math.ceil(items.length/n)},(_,i)=>items.slice(i*n,i*n+n));
const taskKey=(owner,id)=>JSON.stringify([owner||'',id]);
function displayTasks(report,field){
  const previous=field==='previous_steps',presentation=report.presentation||{};
  const displays=new Map((presentation[previous?'previous_step_slides':'next_step_slides']||[]).map(s=>[taskKey(s.agent_id,s.id),s]));
  const accepted=new Map((report.contributors||[]).flatMap(c=>(c[field]||[]).map(s=>[taskKey(c.agent_id,s.id),s])));
  return (report[field]||[]).map(step=>{
    // Team submission namespaces IDs. Presentation still uses the owner's original ID.
    const prefix=step.agent_id+'::',id=step.source_step_id||step.id;
    const raw=taskKey(step.agent_id,id),key=accepted.has(raw)||displays.has(raw)?raw:
      taskKey(step.agent_id,id?.startsWith(prefix)?id.slice(prefix.length):id);
    const shown=displays.get(key)||{},original=accepted.get(key)||step;
    const owner=presentation.owner_display_names?.[step.agent_id]??step.owner_name??report.contributors?.find(c=>c.agent_id===step.agent_id)?.name??'';
    // Only display text is replaced. Status, release state and direction stay authoritative.
    return previous?{...step,owner_name:owner,status:original.status,released:original.released,
      display_task:shown.title??step.display_task??step.task,outcome:shown.text??step.outcome,evidence:shown.evidence??step.evidence}:
      {...step,owner_name:owner,direction_id:original.direction_id??step.direction_id,
        task:shown.title??step.task,why:shown.why??step.why,success:shown.success??step.success};
  });
}
const tasksPerSlide=(report,field)=>{
  const n=report.presentation?.[field]??report[field];
  return Number.isInteger(n)&&n>0?n:2;
};
export function renderSlides(r,style){
  const pages=[],page=(section,title,body,anchor)=>pages.push({section,title,body,anchor}),bg=r.background;
  const previous=displayTasks(r,'previous_steps'),next=displayTasks(r,'next_steps');
  page('Background description and summary',r.title,`<p class="lead">${esc(r.summary)}</p><div class="callout"><span class="label">The question</span><p>${esc(bg.problem)}</p></div><p class="muted">${esc(String(r.agent_name||'').replace(/^Test\s*[·:-]\s*/i,''))} · ${esc(r.created_at)}${r.report_label?' · '+esc(r.report_label):''}</p>`);
  if(bg.explanation?.length){
    for(const x of bg.explanation)page('Background description and summary',x.title,`<p>${esc(x.text)}</p>${renderVisual(x.visual)}${links(x.evidence)}`);
  }else{
  page('Background description and summary','What we know, and what is missing',`<div class="two"><div><span class="label">What earlier work tells us</span><p>${esc(bg.known)}</p></div><div><span class="label">The gap</span><p>${esc(bg.gap)}</p></div></div>${links(bg.sources)}`);
  for(const terms of groups(bg.terms||[],3))page('Background description and summary','A few useful terms',terms.map(t=>`<div class="term"><strong>${esc(t.term)}</strong><p>${esc(t.meaning)}</p></div>`).join(''));
  }
  if(!previous.length)page('Progress report','The starting point','<p>This is the first report. No earlier next steps have been agreed.</p>');
  for(const tasks of groups(previous,tasksPerSlide(r,'previous_steps_per_slide')))page('Progress report','What happened to the last next steps',tasks.map(s=>`<article><span class="badge">${esc(s.status.replaceAll('_',' '))}${s.released===false?' · proposed, not released':''}</span><h3>${esc(s.display_task||s.task)}</h3><p>${esc(s.outcome)}</p>${links(s.evidence)}</article>`).join(''));
  for(const d of r.directions||[])page('Progress report',d.title,`<span class="badge">${esc(d.status.replaceAll('_',' '))}</span><p class="lead">${esc(d.summary)}</p><p>${esc(d.reason)}</p>${renderVisual(d.visual)}${links(d.evidence)}`,'direction-'+d.id);
  for(const f of r.findings||[])page('Progress report',f.claim,`<span class="badge">${esc(f.kind)}</span><p class="${f.visual?'':'lead'}">${esc(f.detail)}</p>${renderVisual(f.visual)}${links(f.evidence)}`);
  for(const tasks of groups(next,tasksPerSlide(r,'next_steps_per_slide')))page('To-do items',r.report_type==='team'?'Proposed next steps':'What I propose to do next',tasks.map(s=>`<article>${s.agent_id?`<span class="badge">${esc(s.owner_name)} · ${esc(r.directions?.find(d=>d.id===s.direction_id)?.title||'')}</span>`:''}<h3>${esc(s.task)}</h3><p>${esc(s.why)}</p><p class="muted"><strong>We will learn:</strong> ${esc(s.success)}</p></article>`).join('')+'<p class="wait">These steps are proposals. Research starts only after an explicit approval.</p>');
  for(const q of r.questions||[])page('To-do items','A question for the director',`<p class="lead">${esc(q.text)}</p>${(q.options||[]).map(o=>`<p class="option">${esc(o)}</p>`).join('')}<p><strong>My suggestion:</strong> ${esc(q.recommendation||'Please give your view.')}</p><p class="wait">Research stays paused until the next steps are approved.</p>`);
  if(r.closed)page('To-do items','Research stopped',`<p class="lead">The director stopped this test. No further research is planned.</p><p>${esc(r.revision_note||'These slides explain the work already completed.')}</p>`);
  else if(!r.questions?.length)page('To-do items','Ready for review',r.next_steps?.length?'<p class="lead">Please review the findings and proposed next steps.</p><p>Research stays paused until the next steps are approved. Comments and questions do not start work.</p>':'<p class="lead">Please review the findings.</p><p>No next steps are proposed in this report. Research stays paused.</p>');
  const earlier=r.earlier_reports||r.previous_reports||[];
  for(const [i,items] of groups(earlier,5).entries())page('To-do items','Earlier reports',`<p class="muted">Open an earlier deck. Use Back to return to this report.</p><ol class="report-links">${items.map(x=>`<li><a class="earlier-report-link" href="${esc(slideReportLink(x.report_id,r.workspace_id||'',x.anchor))}" data-report-id="${esc(x.report_id)}" data-anchor="${esc(x.anchor||'')}">${esc(x.title||'Earlier report')}</a>${x.created_at?`<small>${esc(x.created_at.slice(0,10))}${x.note?' · '+esc(x.note):''}</small>`:x.note?`<small>${esc(x.note)}</small>`:''}</li>`).join('')}</ol>`,i===0?'earlier-reports':undefined);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(r.title)} · Wu Lab</title><style>${style}</style></head><body><nav class="toolbar"><button onclick="window.print()">Print / Save as PDF</button><button onclick="document.documentElement.requestFullscreen?.()">Full screen</button><p>← → Slides</p>${earlier.length?'<a class="history-jump" href="#earlier-reports">Earlier reports</a>':''}</nav>${r.report_lifecycle?.status==='archived'?'<p class="example">Archived report · '+esc(r.report_lifecycle.reason)+'</p>':''}${r.example?'<div class="example">EXAMPLE REPORT · No research result is being claimed.</div>':''}${pages.map((s,i)=>`<section class="slide" id="slide-${i+1}"><div class="eyebrow">WU LAB <span> / ${esc(s.section)}</span></div><h2${s.anchor?` id="${esc(s.anchor)}"`:""}>${esc(s.title)}</h2>${s.body}<footer><span>${r.example?'EXAMPLE · no research performed · ':''}${esc(r.project_name||'Research update')}</span><span>${i+1} / ${pages.length}</span></footer></section>`).join('')}<script>let current=0;const slides=[...document.querySelectorAll('.slide')];
const sendParent=data=>{if(window.parent!==window)window.parent.postMessage(data,location.origin);};
let scheduled=false;function locateSlide(){scheduled=false;let best=0,area=-1;slides.forEach((el,i)=>{const b=el.getBoundingClientRect(),visible=Math.max(0,Math.min(b.bottom,innerHeight)-Math.max(b.top,0));if(visible>area){area=visible;best=i;}});current=best;sendParent({type:'wulab-slide',slide_id:slides[best]?.id});}
addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(locateSlide);}},{passive:true});addEventListener('load',locateSlide);
document.addEventListener('click',e=>{const a=e.target.closest('.earlier-report-link');if(a&&parent!==window&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();sendParent({type:'wulab-report-link',report_id:a.dataset.reportId,anchor:a.dataset.anchor});}});
document.addEventListener('keydown',e=>{if(['ArrowRight','ArrowDown','PageDown','ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();current=Math.max(0,Math.min(slides.length-1,current+(['ArrowRight','ArrowDown','PageDown'].includes(e.key)?1:-1)));slides[current].scrollIntoView({behavior:'smooth',block:'start'});}});</script></body></html>`;
}
