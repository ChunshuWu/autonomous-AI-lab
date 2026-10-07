import {renderMarkdown} from './markdown.mjs';
import {renderVisual} from './visuals.mjs';
import {renderSlides} from './slides.mjs';
const docEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const docSections=[['background','Background description and summary'],['progress','Progress report'],['next_steps','To-do items']];
const documentURL=(id,workspace,anchor='')=>'/documents/'+encodeURIComponent(id)+'?workspace='+encodeURIComponent(workspace)+(anchor?'#'+encodeURIComponent(anchor):'');
const safeDocURL=u=>/^(https?:\/\/|\/(?!\/)|#)/i.test(u)&&!/[\s<>"\\]/.test(u);
export const renderDocumentMarkdown=renderMarkdown;
function docSources(items){return (items||[]).length?'<ul class="sources">'+items.map(e=>{const u=typeof e==='string'?e:e.url||e.source||'',label=typeof e==='string'?e:e.label||e.note||u;return '<li>'+(safeDocURL(u)?`<a href="${docEscape(u)}" target="_blank" rel="noopener noreferrer">${docEscape(label)}</a>`:docEscape(label)+(u&&u!==label?' <code>'+docEscape(u)+'</code>':''))+'</li>';}).join('')+'</ul>':'';}
function documentFigures(r,section){return (r.figures||[]).filter(f=>f.section===section).map(f=>(f.visual?renderVisual(f.visual):`<figure><h3>${docEscape(f.title)}</h3><img class="report-image" src="${docEscape(f.image.url)}" alt="${docEscape(f.image.alt)}" loading="lazy"><figcaption>${docEscape(f.caption)}</figcaption></figure>`)+docSources(f.evidence)).join('');}
function documentRecords(r,section){
 if(section==='progress')return `${r.previous_steps?.length?'<details class="records"><summary>Previous-step record</summary>'+r.previous_steps.map(p=>`<article><h3>${docEscape(p.display_task||p.task)}</h3><p><strong>${docEscape(p.status.replaceAll('_',' '))}${p.released===false?' · proposed, not released':''}</strong> — ${docEscape(p.outcome)}</p>${docSources(p.evidence)}</article>`).join('')+'</details>':''}${(r.directions||[]).map(d=>`<article id="direction-${docEscape(d.id)}"><h3>${docEscape(d.title)}</h3><p>${docEscape(d.summary)}</p><p>${docEscape(d.reason)}</p></article>`).join('')}`;
 if(section==='next_steps')return `${r.next_steps?.length?'<details class="records"><summary>Exact proposed tasks</summary><ol>'+r.next_steps.map(p=>`<li><strong>${docEscape(p.task)}</strong><p>${docEscape(p.why)}</p><p>We will learn: ${docEscape(p.success)}</p></li>`).join('')+'</ol></details>':''}${(r.questions||[]).map(q=>`<p><strong>Question:</strong> ${docEscape(q.text)}</p>`).join('')}${docSources(r.sources)}${documentHistory(r)}`;
 return '';
}
function documentHistory(r){const refs=r.earlier_reports||r.previous_reports||[];return refs.length?`<div id="earlier-reports"><h3>Earlier reports</h3><ul>${refs.map(ref=>`<li><a class="earlier-report-link" data-report-id="${docEscape(ref.report_id)}" data-anchor="${docEscape(ref.anchor||'')}" href="${docEscape(documentURL(ref.report_id,r.workspace_id||'',ref.anchor))}">${docEscape(ref.title||'Earlier report')}</a>${ref.note?' — '+docEscape(ref.note):''}</li>`).join('')}</ul></div>`:'';}
export function renderDocument(r){
 let body;
 if(r.document){body=docSections.map(([key,title])=>`<section id="section-${key.replace('_','-')}"><h2>${title}</h2>${renderDocumentMarkdown(r.document[key])}${documentFigures(r,key)}${documentRecords(r,key)}</section>`).join('');}
 else{
  // Reading view for saved slides. Keep their original IDs and content intact.
  const legacy=renderSlides(r,'');body=[...legacy.matchAll(/<section class="slide" id="(slide-\d+)">([\s\S]*?)<\/section>/g)].map(([,id,content])=>`<section id="${id}">${content.replace(/<div class="eyebrow">[\s\S]*?<\/div>/,'').replace(/<footer>[\s\S]*?<\/footer>/,'')}</section>`).join('');
  body=body.replace(/href="\/slides\//g,'href="/documents/');
 }
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${docEscape(r.title)} · Wu Lab</title><style>${documentStyle}</style><link rel="stylesheet" href="/markdown.css"><link rel="stylesheet" href="/figures.css"><link rel="stylesheet" href="/vendor/katex/katex.min.css"><script defer src="/vendor/katex/katex.min.js"></script><script defer src="/math.js"></script></head><body><nav class="toolbar"><button onclick="window.print()">Print / Save as PDF</button><a href="/documents/${encodeURIComponent(r.id)}.md?workspace=${encodeURIComponent(r.workspace_id||'')}">Markdown</a>${!r.document?`<a href="/slides/${encodeURIComponent(r.id)}?workspace=${encodeURIComponent(r.workspace_id||'')}" target="_blank" rel="noopener">Original slides</a>`:''}</nav><main class="markdown-body"><header><p class="meta">${docEscape(r.report_label||'Research report')}</p><h1>${docEscape(r.title)}</h1><p class="summary">${docEscape(r.summary)}</p></header>${r.report_lifecycle?.status==='archived'?`<p class="archive-note">Archived · ${docEscape(r.report_lifecycle.reason)}</p>`:''}${body}</main><script>
const send=data=>{if(parent!==window)parent.postMessage(data,location.origin)};
let scheduled=false;function locate(){scheduled=false;const sections=[...document.querySelectorAll('main > section')];let selected=sections[0];for(const section of sections){if(section.getBoundingClientRect().top<=innerHeight*.35)selected=section;}if(selected)send({type:'wulab-section',section_id:selected.id});}
addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(locate)}},{passive:true});addEventListener('load',locate);
document.addEventListener('click',e=>{const a=e.target.closest('.earlier-report-link');if(a&&parent!==window&&!e.ctrlKey&&!e.metaKey&&!e.shiftKey){e.preventDefault();send({type:'wulab-report-link',report_id:a.dataset.reportId,anchor:a.dataset.anchor});}});
</script></body></html>`;
}
function figureText(f){
 const v=f.visual;if(!v)return '### '+f.title+'\n\n!['+f.image.alt+']('+f.image.url+')\n\n'+f.caption;
 let data='';
 if(v.type==='flow')data=v.nodes.map(n=>n.label+': '+n.detail).join(' → ');
 if(v.type==='bars')data=v.rows.map(p=>'- '+p.label+': '+p.value+' '+v.unit).join('\n');
 if(v.type==='table')data='| '+v.columns.join(' | ')+' |\n| '+v.columns.map(()=> '---').join(' | ')+' |\n'+v.rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
 if(v.type==='line')data='| Series | '+v.x_label+' | '+v.y_label+' |\n| --- | --- | --- |\n'+v.series.flatMap(row=>row.points.map(p=>'| '+row.label+' | '+p.x+' | '+p.y+' |')).join('\n');
 return '### '+v.title+'\n\n'+data+'\n\n'+v.caption;
}
export function documentText(r){
 const sourceText=items=>(items||[]).map(e=>'- '+(typeof e==='string'?e:(e.label||e.note||'Source')+': '+(e.url||e.source||''))).join('\n');
 const prior=(r.previous_steps||[]).map(p=>'- '+(p.display_task||p.task)+' — '+p.status+': '+p.outcome).join('\n');
 const directions=(r.directions||[]).map(d=>'### '+d.title+'\n\n'+d.summary+'\n\n'+d.reason).join('\n\n');
 const next=(r.next_steps||[]).map(p=>'- '+p.task+'\n  Why: '+p.why+'\n  We will learn: '+p.success).join('\n');
 const earlier=(r.earlier_reports||r.previous_reports||[]).map(ref=>'- ['+(ref.title||'Earlier report')+']('+documentURL(ref.report_id,r.workspace_id||'',ref.anchor)+')').join('\n');
 let body;
 if(r.document)body=docSections.map(([key,title])=>'## '+title+'\n\n'+r.document[key]+'\n\n'+(r.figures||[]).filter(f=>f.section===key).map(f=>figureText(f)+'\n\n'+sourceText(f.evidence)).join('\n\n')+(key==='progress'?'\n\n'+prior+'\n\n'+directions:key==='next_steps'?'\n\n'+next+'\n\n'+(r.questions||[]).map(q=>q.text).join('\n'):'' )).join('\n\n');
 else body=['## Background description and summary',r.background?.problem,r.background?.known,r.background?.gap,...(r.background?.terms||[]).map(t=>t.term+': '+t.meaning),...(r.background?.explanation||[]).flatMap(x=>['### '+x.title,x.text,x.visual?figureText({visual:x.visual}):'',sourceText(x.evidence)]),'## Progress report',prior,...(r.findings||[]).flatMap(f=>['### '+f.claim,f.detail,f.visual?figureText({visual:f.visual}):'',sourceText(f.evidence)]),directions,'## To-do items',next,...(r.questions||[]).map(q=>q.text)].filter(Boolean).join('\n\n');
 return '# '+r.title+'\n\n'+r.summary+'\n\n'+body+'\n\n'+sourceText(r.sources)+(earlier?'\n\n### Earlier reports\n\n'+earlier:'')+'\n';
}
export function reportAnchorExists(r,anchor){return (r.document?renderDocument(r):renderSlides(r,'')).includes('id="'+anchor+'"');}
const documentStyle=`:root{font-family:system-ui,sans-serif;color:#253c38;background:#fffdf7;font-size:16px;line-height:1.65}*{box-sizing:border-box}body{margin:0;overscroll-behavior:contain}.toolbar{display:flex;gap:16px;align-items:center;padding:12px 24px;border-bottom:1px solid #dfe7df;background:#f8faf6}.toolbar a,.toolbar button{font:inherit;font-size:13px;color:#285b4b}.toolbar button{background:white;border:1px solid #b9cdc2;border-radius:6px;padding:5px 10px;cursor:pointer}main{max-width:880px;margin:auto;padding:32px 40px 70px}h1{font-size:28px;line-height:1.3;margin:0 0 18px}h2{font-size:23px;line-height:1.35;margin:30px 0 14px}h3{font-size:18px;margin:22px 0 8px}p{margin:10px 0 16px}a{color:#246951;overflow-wrap:anywhere}section{scroll-margin-top:20px;margin-bottom:32px}.summary{font-size:18px}.meta{color:#6f8375;font-size:13px}.archive-note{background:#fff1c8;padding:10px 14px;border-radius:6px;font-size:14px}.records{border:1px solid #dce4dc;border-radius:8px;padding:10px 14px;margin:18px 0}summary{cursor:pointer;color:#496c57}pre{white-space:pre-wrap;background:#f0f3ee;padding:16px;border-radius:6px}code{overflow-wrap:anywhere;font-size:.9em}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #dce4dc;padding:8px;text-align:left}.table-scroll{overflow:auto}li{margin:7px 0}ul,ol{padding-left:24px}.sources{font-size:14px}.two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.flow-figure,.bar-figure,.table-figure{margin:20px 0}.flow-node,.flow-step,.figure-node{border:1px solid #dce4dc;border-radius:6px;padding:10px;margin:8px 0}.report-image{max-width:100%;height:auto}.line-plot{width:100%;height:auto;font-size:12px}.plot-legend{display:flex;flex-wrap:wrap;gap:18px}.flow-figure{display:flex;align-items:center;flex-wrap:wrap;gap:10px}.figure-node{flex:1;min-width:130px}.bar-row{display:grid;grid-template-columns:140px 1fr 70px;gap:12px;align-items:center;margin:12px 0}.bar-axis{display:flex;justify-content:space-between}.bar-fill.series-1{background:#b56a51}.bar-fill.series-2{background:#6876aa}.bar-track{background:#e6eee7;height:20px}.bar-fill{background:#468967;height:20px}.muted,.label,.badge{color:#607363;font-size:14px}.callout{border-left:3px solid #58906b;padding-left:16px}@media(max-width:600px){main{padding:24px 20px}.two{grid-template-columns:1fr}.toolbar{flex-wrap:wrap;gap:12px}h1{font-size:25px}}@media print{.toolbar{display:none}main{max-width:none;padding:0}details>*{display:block!important}section{break-inside:auto}h2,h3{break-after:avoid}a{color:inherit}}`;

export function taskDocumentText(task){
 const text=task.result.document||task.result.body;
 if(task.record_delivery?.status!=='display_pending')return text;
 const raw=JSON.stringify(task.result.records,null,2).replaceAll('`','\\u0060');
 return text+'\n\n## Saved details awaiting display repair\n\nThe original values are preserved below.\n\n```json\n'+raw+'\n```\n';
}
export function renderTaskDocument(task,author,workspace){
 const download='/task-documents/'+encodeURIComponent(task.id)+'?workspace='+encodeURIComponent(workspace)+'&format=markdown';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${docEscape(task.summary)} · Wu Lab</title><style>${documentStyle}</style><link rel="stylesheet" href="/markdown.css"><link rel="stylesheet" href="/figures.css"><link rel="stylesheet" href="/vendor/katex/katex.min.css"><script defer src="/vendor/katex/katex.min.js"></script><script defer src="/math.js"></script></head><body><nav class="toolbar"><a href="${docEscape(download)}">Download Markdown</a></nav><main class="markdown-body"><header><p class="meta">${docEscape(author)} · ${docEscape(task.finished_at||'')}</p><h1>${docEscape(task.summary)}</h1></header>${renderDocumentMarkdown(taskDocumentText(task))}</main></body></html>`;
}
