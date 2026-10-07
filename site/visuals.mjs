// Data-only figures. Text is escaped; reports cannot inject HTML or scripts.
export function renderVisual(v){
 if(!v)return '';
 const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let body='';
 if(v.type==='flow')body=`<div class="flow-figure">${(v.nodes||[]).map((n,i)=>`${i?'<span class="figure-arrow" aria-hidden="true">→</span>':''}<div class="figure-node"><strong>${e(n.label)}</strong><p>${e(n.detail)}</p></div>`).join('')}</div>`;
 if(v.type==='table'){
  const numeric=(v.columns||[]).map((_,i)=>v.rows?.some(r=>r[i]!==''&&r[i]!=null)&&v.rows.every(r=>r[i]===''||r[i]==null||typeof r[i]==='number'||/^[−+-]?[\d,.]+\s*%?$/.test(String(r[i]))));
  const cell=x=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('en-US',{maximumSignificantDigits:6}):x;
  body=`<div class="table-wrap" tabindex="0" role="region" aria-label="${e(v.title||'Result table')}"><table class="visual-table"><thead><tr>${(v.columns||[]).map((x,i)=>`<th scope="col"${numeric[i]?' class="number"':''}>${e(x)}</th>`).join('')}</tr></thead><tbody>${(v.rows||[]).map(row=>`<tr>${row.map((x,i)=>`<td${numeric[i]?' class="number"':''}${typeof x==='number'?` title="${e(x)}"`:''}>${e(cell(x))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
 }
 if(v.type==='bars'){
  const max=Number(v.max)||100;const series=[...new Set((v.rows||[]).map(r=>r.series||'default'))];
  body=`<p class="bar-unit">${e(v.unit||'')}</p><div class="bar-scale"><div class="bar-axis" aria-hidden="true"><span>0</span><span>${e(max)}</span></div></div><div class="bar-chart">${(v.rows||[]).map(row=>{const width=Math.max(0,Math.min(100,Number(row.value)/max*100));return `<div class="bar-row"><div class="bar-label">${e(row.label)}</div><div class="bar-track" aria-hidden="true"><div class="bar-fill series-${series.indexOf(row.series||'default')%3}" style="width:${width}%"></div></div><strong class="bar-value">${e(row.display??row.value)}</strong></div>`;}).join('')}</div>`;
 }
 if(v.type==='line'){
  const series=v.series||[],points=series.flatMap(s=>s.points),logx=v.x_scale==='log',logy=v.y_scale==='log';
  const tx=x=>logx?Math.log10(x):x,ty=y=>logy?Math.log10(y):y;
  let xmin=Math.min(...points.map(p=>tx(p.x))),xmax=Math.max(...points.map(p=>tx(p.x))),ymin=Math.min(...points.map(p=>ty(p.y))),ymax=Math.max(...points.map(p=>ty(p.y)));
  if(xmin===xmax){xmin-=.5;xmax+=.5;}if(ymin===ymax){ymin-=.5;ymax+=.5;}
  const x=p=>75+(tx(p.x)-xmin)/(xmax-xmin)*560,y=p=>285-(ty(p.y)-ymin)/(ymax-ymin)*250;
  const colors=['#287b58','#ad533f','#505eae','#967025'],fmt=n=>Number(n.toPrecision(3)).toString();
  const ticks=Array.from({length:5},(_,i)=>i/4);
  body=`<svg class="line-plot" viewBox="0 0 700 350" role="img" aria-label="${e(v.title)}"><title>${e(v.title)}</title><path d="M75 35V285H635" fill="none" stroke="#758777"/>${ticks.map(t=>`<path d="M75 ${285-t*250}H635" stroke="#e2e9df"/><text x="66" y="${290-t*250}" text-anchor="end">${e(fmt(logy?10**(ymin+t*(ymax-ymin)):ymin+t*(ymax-ymin)))}</text><text x="${75+t*560}" y="307" text-anchor="middle">${e(fmt(logx?10**(xmin+t*(xmax-xmin)):xmin+t*(xmax-xmin)))}</text>`).join('')}${series.map((row,i)=>`<polyline points="${[...row.points].sort((a,b)=>a.x-b.x).map(p=>x(p)+','+y(p)).join(' ')}" fill="none" stroke="${colors[i%colors.length]}" stroke-width="2.5"/>${row.points.map(p=>`<circle cx="${x(p)}" cy="${y(p)}" r="3" fill="${colors[i%colors.length]}"><title>${e(row.label)}: ${e(p.x)}, ${e(p.y)}</title></circle>`).join('')}`).join('')}<text x="350" y="337" text-anchor="middle">${e(v.x_label)}${logx?' (log scale)':''}</text><text transform="translate(16 160) rotate(-90)" text-anchor="middle">${e(v.y_label)}${logy?' (log scale)':''}</text></svg><div class="plot-legend">${series.map((row,i)=>`<span style="color:${colors[i%colors.length]}">● ${e(row.label)}</span>`).join('')}</div>`;
 }
 if(!body)return '';
 return `<figure class="report-figure" role="group" aria-label="${e(v.title||v.caption||'Figure')}">${v.title?`<h3 class="figure-title">${e(v.title)}</h3>`:''}${body}${v.caption?`<figcaption>${e(v.caption)}</figcaption>`:''}</figure>`;
}
