/* A view of saved research directions. Moving around never changes research state. */
globalThis.WuLabTree=(()=>{
 'use strict';
 const labels={unexplored:'Unexplored',under_exploration:'Active',explored:'Explored',discarded:'Discarded'};
 const marks={unexplored:'○',under_exploration:'◉',explored:'✓',discarded:'×'};
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const clamp=(n,min,max)=>Math.min(max,Math.max(min,n));
 const W=260,H=116,GAP_X=100,GAP_Y=32,PAD=50;
 const savedViews=new Map();

 function groupNodes(nodes){
  const all=new Map(nodes.map(n=>[n.id,n])),visible=nodes.filter(n=>['under_exploration','explored'].includes(n.status)),groups=new Map(),displayId=new Map(visible.map(n=>[n.id,n.id]));
  for(const node of nodes){
   if(!['unexplored','discarded'].includes(node.status))continue;
   const type=node.node_type==='method'?'method':'proposal',parent=all.has(node.parent_id)?node.parent_id:null;
   const id='group::'+node.status+'::'+type+'::'+encodeURIComponent(parent||'');
   if(!groups.has(id))groups.set(id,{id,parent_id:parent,title:labels[node.status]+' '+type+'s',status:node.status,node_type:'group',member_type:type,members:[]});
   groups.get(id).members.push(node);displayId.set(node.id,id);
  }
  const result=visible.map(n=>({...n,parent_id:displayId.get(n.parent_id)||null}));
  for(const group of groups.values()){
   const owner=all.get(group.parent_id),count=group.members.length;
   result.push({...group,parent_id:displayId.get(group.parent_id)||null,summary:count+' '+group.member_type+(count===1?'':'s')+(owner?' under “'+owner.title+'”':' for this research topic')+'.'});
  }
  return result;
 }

 // Each subtree owns its own vertical space. Parents sit halfway between
 // their first and last child, so branches cannot overlap at the same depth.
 function layout(nodes){
  const root={id:null,title:'Research topic',children:[],depth:0},byId=new Map();
  for(const node of nodes)byId.set(node.id,{...node,children:[]});
  for(const node of byId.values())(byId.get(node.parent_id)||root).children.push(node);
  let row=0;const placed=[],seen=new Set();
  function visit(node,depth){
   if(seen.has(node.id))return;seen.add(node.id);node.depth=depth;placed.push(node);
   for(const child of node.children)visit(child,depth+1);
   node.y=node.children.length?(node.children[0].y+node.children.at(-1).y)/2:PAD+(row++)*(H+GAP_Y);
   node.x=PAD+depth*(W+GAP_X);node.width=W;node.height=H;
  }
  visit(root,0);
  const links=placed.flatMap(p=>p.children.map(c=>({from:p.id,to:c.id,status:c.status,path:`M ${p.x+W} ${p.y+H/2} C ${p.x+W+GAP_X/2} ${p.y+H/2}, ${c.x-GAP_X/2} ${c.y+H/2}, ${c.x} ${c.y+H/2}`})));
  return {nodes:placed,links,width:Math.max(...placed.map(n=>n.x))+W+PAD,height:Math.max(...placed.map(n=>n.y))+H+PAD};
 }

 function mount(host,options){
  const {key,topic,reports=[],onOpen,onNode,onGroup}=options,nodes=groupNodes(options.nodes),graph=layout(nodes),byId=new Map(nodes.map(n=>[n.id,n]));
  const initial=savedViews.get(key);
  let view=initial?{...initial}:{x:0,y:0,scale:1},fitted=!!initial,expanded=false,active=null,pinned=false,closeTimer,drag=null,suppressClick=false;
  const abort=new AbortController(),signal=abort.signal,pointers=new Map();let pinch=null;
  const listen=(el,type,fn,extra={})=>el.addEventListener(type,fn,{signal,...extra});
  host.innerHTML=`<div class="tech-viewport" tabindex="0" role="region" aria-label="Research direction tree. Drag or scroll to move. Use the zoom buttons to see more detail.">
   <div class="tech-world" style="width:${graph.width}px;height:${graph.height}px">
    <svg class="tech-links" width="${graph.width}" height="${graph.height}" aria-hidden="true">${graph.links.map(l=>`<path class="tech-link ${escape(l.status)}" data-child="${escape(l.to)}" d="${l.path}"/>`).join('')}</svg>
    ${graph.nodes.map(n=>n.id===null?`<div class="tech-root" style="left:${n.x}px;top:${n.y}px;width:${W}px;height:${H}px"><span>Research topic</span><strong>${escape(topic)}</strong></div>`:`<button class="tech-node ${escape(n.status)}" style="left:${n.x}px;top:${n.y}px;width:${W}px;height:${H}px" data-node="${escape(n.id)}" aria-label="${escape(n.title)}. ${labels[n.status]}. Show details" aria-controls="tree-details" aria-expanded="false"><span class="tech-node-status"><span aria-hidden="true">${marks[n.status]}</span>${n.node_type==='group'?n.members.length+' '+n.member_type+(n.members.length===1?'':'s'):labels[n.status]+' · '+(n.node_type==='method'?'Method':'Proposal')}</span><strong>${escape(n.title)}</strong></button>`).join('')}
   </div>
  </div>
  <div class="tech-tools" role="group" aria-label="Map controls"><button data-map-control="out" aria-label="Zoom out">−</button><output class="tech-zoom" aria-label="Zoom level">100%</output><button data-map-control="in" aria-label="Zoom in">+</button><button data-map-control="fit">Fit</button><button data-map-control="expand" aria-label="Expand map" title="Expand map"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button></div>
  <p class="tech-hint">Drag to move · Hover for details</p>
  <section id="tree-details" class="tech-details" aria-label="Direction details" hidden></section>`;
  const viewport=host.querySelector('.tech-viewport'),world=host.querySelector('.tech-world'),details=host.querySelector('.tech-details'),zoom=host.querySelector('.tech-zoom');
  const nodeElement=id=>Array.from(host.querySelectorAll('[data-node]')).find(el=>el.dataset.node===id);
  function minimumScale(){return Math.min(.2,viewport.clientWidth/graph.width,(viewport.clientHeight-65)/graph.height);}
  function apply(){
   world.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;
   viewport.style.backgroundPosition=`${view.x}px ${view.y}px`;
   zoom.textContent=Math.round(view.scale*100)+'%';savedViews.set(key,{...view});
   host.querySelector('[data-map-control="out"]').disabled=view.scale<=minimumScale()+.0001;
   host.querySelector('[data-map-control="in"]').disabled=view.scale>=1.8;
   if(active)positionDetails();
  }
  function fit(first=false){
   const {width,height}=viewport.getBoundingClientRect();if(!width||!height)return;
   view.scale=Math.min(width/graph.width,(height-65)/graph.height,1);
   view.x=(width-graph.width*view.scale)/2;view.y=(height-graph.height*view.scale)/2+16;
   if(first&&width<550){view.scale=.75;view.x=20-PAD*view.scale;view.y=height/2-(graph.nodes[0].y+H/2)*view.scale;}
   fitted=true;hide(true);apply();
  }
  function zoomAt(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2){
   const scale=clamp(view.scale*factor,minimumScale(),1.8),ratio=scale/view.scale;
   view={scale,x:x-(x-view.x)*ratio,y:y-(y-view.y)*ratio};apply();
  }
  function highlight(id){
   const path=new Set();let current=byId.get(id);
   while(current&&!path.has(current.id)){path.add(current.id);current=byId.get(current.parent_id);}
   host.querySelectorAll('[data-child]').forEach(el=>el.classList.toggle('highlight',path.has(el.dataset.child)));
   host.querySelectorAll('[data-node]').forEach(el=>{el.classList.toggle('selected',el.dataset.node===id);el.setAttribute('aria-expanded',String(el.dataset.node===id));});
  }
  function positionDetails(){
   if(!active||details.hidden)return;const node=nodeElement(active);if(!node)return;
   const r=node.getBoundingClientRect(),margin=12,width=Math.min(370,innerWidth-margin*2);
   details.style.width=width+'px';details.style.maxHeight=Math.min(550,innerHeight-margin*2)+'px';
   const height=details.getBoundingClientRect().height;
   let x=r.right+10;if(x+width>innerWidth-margin)x=r.left-width-10;
   details.style.left=clamp(x,margin,Math.max(margin,innerWidth-width-margin))+'px';
   details.style.top=clamp(r.top,margin,Math.max(margin,innerHeight-height-margin))+'px';
  }
  function source(e){
   let link='';try{const u=new URL(e.source);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)link=`<a href="${escape(u.href)}" target="_blank" rel="noopener noreferrer">${escape(e.source)}</a>`;}catch{}
   return `<li>${escape(e.note)}<small>${link||escape(e.source)}</small></li>`;
  }
  function show(id,pin=false){
   clearTimeout(closeTimer);if(pinned&&active!==id&&!pin)return;
   const n=byId.get(id);if(!n)return;
   if(active===id){pinned=pinned||pin;return;}
   active=id;pinned=pin;highlight(id);
   const refs=(n.report_refs||[]).filter(ref=>reports.some(r=>r.id===ref.report_id));
   const reportButton=(ref,i)=>`<button class="tech-report ${i===0?'primary':''}" data-tree-report="${i}">${i===0?'Open report':'Earlier report'}<small>${escape(reports.find(r=>r.id===ref.report_id)?.title)}</small></button>`;
   details.innerHTML=`<div class="tech-detail-heading"><span class="direction-status ${escape(n.status)}">${labels[n.status]}</span><button class="tech-detail-close" aria-label="Close direction details">×</button></div><h2>${escape(n.title)}</h2><div class="markdown-body">${globalThis.WuLabMarkdown?WuLabMarkdown.renderMarkdown(n.presentation?.question||n.summary):escape(n.presentation?.question||n.summary)}</div>${n.node_type==='group'?'<button class="tech-report primary" data-tree-group="'+escape(n.id)+'">Browse ideas</button>':''}`;
   details._refs=refs;details.hidden=false;positionDetails();
  }
  function hide(force=false){if(pinned&&!force)return;clearTimeout(closeTimer);active=null;pinned=false;details.hidden=true;highlight(null);}
  function scheduleHide(){clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!details.matches(':hover')&&!details.contains(document.activeElement)&&!nodeElement(active)?.matches(':focus-visible'))hide();},180);}
  function toggleExpanded(){
   expanded=!expanded;host.closest('.map-shell').classList.toggle('map-expanded',expanded);
   document.body.classList.toggle('map-is-expanded',expanded);
   const b=host.querySelector('[data-map-control="expand"]');b.setAttribute('aria-label',expanded?'Exit expanded map':'Expand map');b.title=expanded?'Exit expanded map':'Expand map';
   hide(true);fit();
  }
  listen(host,'click',e=>{
   if(suppressClick){suppressClick=false;return;}
   const b=e.target.closest('[data-map-control]');
   if(b){const action=b.dataset.mapControl;if(action==='fit')fit();else if(action==='expand')toggleExpanded();else zoomAt(action==='in'?1.2:1/1.2);return;}
   if(e.target.closest('.tech-detail-close')){const node=nodeElement(active);hide(true);node?.focus({preventScroll:true});hide(true);return;}
   const group=e.target.closest('[data-tree-group]');if(group){const n=byId.get(group.dataset.treeGroup);hide(true);onGroup?.(n);return;}
   const report=e.target.closest('[data-tree-report]');
   if(report){const ref=details._refs[Number(report.dataset.treeReport)];hide(true);onOpen(ref);return;}
   const node=e.target.closest('[data-node]');if(node){const n=byId.get(node.dataset.node);if(n?.node_type==='group'&&onGroup){hide(true);onGroup(n);}else if(onNode){hide(true);onNode(node.dataset.node);}else show(node.dataset.node,true);}
  });
  listen(host,'pointerover',e=>{const n=e.target.closest('[data-node]');if(n&&e.pointerType!=='touch'&&!drag)show(n.dataset.node);if(details.contains(e.target))clearTimeout(closeTimer);});
  listen(host,'pointerout',e=>{if(e.target.closest('[data-node]')||details.contains(e.target))scheduleHide();});
  listen(host,'focusin',e=>{const n=e.target.closest('[data-node]');if(n)show(n.dataset.node);if(details.contains(e.target))clearTimeout(closeTimer);});
  listen(host,'focusout',scheduleHide);
  listen(details,'toggle',positionDetails,{capture:true});
  listen(viewport,'wheel',e=>{
   e.preventDefault();hide(true);
   const unit=e.deltaMode===1?16:e.deltaMode===2?viewport.clientHeight:1;
   if(e.ctrlKey||e.metaKey){const r=viewport.getBoundingClientRect();zoomAt(Math.exp(-e.deltaY*unit*.008),e.clientX-r.left,e.clientY-r.top);}
   else{view.x-=(e.shiftKey&&!e.deltaX?e.deltaY:e.deltaX)*unit;view.y-=(e.shiftKey&&!e.deltaX?0:e.deltaY)*unit;apply();}
  },{passive:false});
  listen(viewport,'pointerdown',e=>{
   if(e.button!==0)return;suppressClick=false;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,moved:false};
   if(pointers.size===2){const [a,b]=[...pointers.values()];pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),view:{...view},x:(a.x+b.x)/2,y:(a.y+b.y)/2};}
  });
  listen(window,'pointermove',e=>{
   if(!drag||!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
   if(pinch&&pointers.size===2){
    const [a,b]=[...pointers.values()],r=viewport.getBoundingClientRect(),scale=clamp(pinch.view.scale*Math.hypot(a.x-b.x,a.y-b.y)/Math.max(1,pinch.distance),minimumScale(),1.8),ratio=scale/pinch.view.scale;
    view={scale,x:(a.x+b.x)/2-r.left-(pinch.x-r.left-pinch.view.x)*ratio,y:(a.y+b.y)/2-r.top-(pinch.y-r.top-pinch.view.y)*ratio};drag.moved=true;
   }else{const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)<5&&!drag.moved)return;drag.moved=true;view.x=drag.vx+dx;view.y=drag.vy+dy;}
   suppressClick=true;viewport.classList.add('dragging');hide(true);apply();
  });
  const release=e=>{
   if(!pointers.has(e.pointerId))return;const moved=drag?.moved;pointers.delete(e.pointerId);pinch=null;drag=null;
   if(pointers.size){const a=[...pointers.values()][0];drag={x:a.x,y:a.y,vx:view.x,vy:view.y,moved:true};}
   else viewport.classList.remove('dragging');
   if(!moved&&e.target.closest('.tech-viewport')&&!e.target.closest('[data-node]'))hide(true);
  };
  listen(window,'pointerup',release);listen(window,'pointercancel',release);
  listen(viewport,'keydown',e=>{
   if(e.target!==viewport)return;
   if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','0','Home'].includes(e.key))e.preventDefault();
   if(e.key==='+'||e.key==='=')zoomAt(1.2);else if(e.key==='-')zoomAt(1/1.2);else if(e.key==='0'||e.key==='Home')fit();
   else if(e.key.startsWith('Arrow')){view.x+=e.key==='ArrowLeft'?60:e.key==='ArrowRight'?-60:0;view.y+=e.key==='ArrowUp'?60:e.key==='ArrowDown'?-60:0;hide(true);apply();}
  });
  listen(document,'keydown',e=>{if(e.key==='Escape'&&!document.querySelector('dialog[open]')){if(active){hide(true);viewport.focus({preventScroll:true});}else if(expanded)toggleExpanded();}});
  listen(window,'scroll',positionDetails,{capture:true,passive:true});
  const observer=new ResizeObserver(()=>{if(!fitted)fit(true);else apply();});observer.observe(viewport);
  if(fitted)apply();else fit(true);
  return {destroy(){abort.abort();observer.disconnect();clearTimeout(closeTimer);document.body.classList.remove('map-is-expanded');},fit};
 }
 return {layout,mount,groupNodes};
})();
