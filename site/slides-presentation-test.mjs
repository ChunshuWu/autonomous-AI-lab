import assert from 'node:assert/strict';
import {renderSlides} from './slides.mjs';

const owners=['owner-a','owner-b'];
const previous=owners.map(agent_id=>({id:'past',task:'Accepted task '+agent_id,status:'not_started',released:false,outcome:'Accepted outcome '+agent_id,evidence:[]}));
const next=owners.map(agent_id=>({id:'proposal',direction_id:'selected',task:'Accepted proposal '+agent_id,why:'Accepted reason '+agent_id,success:'Accepted success '+agent_id}));
const report={
  title:'Saved report',summary:'Saved summary',background:{problem:'Saved question',explanation:[{title:'Saved background',text:'Saved explanation'}]},
  report_type:'team',map_revision:2,direction_revision:4,
  contributors:owners.map((agent_id,i)=>({agent_id,name:'Old name '+i,snapshot:'Saved permission snapshot '+i,previous_steps:[previous[i]],next_steps:[next[i]]})),
  previous_steps:previous.map((s,i)=>({...s,id:owners[i]+'::'+s.id,agent_id:owners[i],display_task:'Old name '+i+': '+s.task})),
  next_steps:next.map((s,i)=>({...s,id:owners[i]+'::'+s.id,source_step_id:s.id,agent_id:owners[i]})),
  directions:[{id:'selected',title:'Selected direction',status:'under_exploration',summary:'Saved direction summary',reason:'Saved direction reason'}],
  findings:[{kind:'saved evidence',claim:'Saved finding',detail:'No result was invented.'}],
  questions:[{id:'decision',text:'Saved director question',recommendation:'Keep the saved limit.'}],
  presentation:{
    owner_display_names:{'owner-a':'Current A','owner-b':'Current B'},previous_steps_per_slide:1,next_steps_per_slide:1,
    // Deliberately shuffled, with the same step IDs for different owners.
    previous_step_slides:[...owners].reverse().map(agent_id=>({agent_id,id:'past',title:'Short title '+agent_id,text:'Short outcome '+agent_id,evidence:[{label:'Readable evidence '+agent_id,url:'https://example.org/'+agent_id}],status:'done',released:true})),
    next_step_slides:[...owners].reverse().map(agent_id=>({agent_id,id:'proposal',why:'Short reason '+agent_id,success:'Short success '+agent_id,direction_id:'unapproved'})),
    findings:[{claim:'Invented finding',detail:'Invented result'}]
  }
};
const pages=html=>[...html.matchAll(/<section class="slide"[^>]*>([\s\S]*?)<\/section>/g)].map(m=>m[1]);
const taskPages=html=>pages(html).filter(s=>s.includes('What happened to the last next steps')||s.includes('Proposed next steps'));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}

const original=structuredClone(report),before=JSON.stringify(report);
freeze(report);
const html=renderSlides(report,'');
assert.equal(JSON.stringify(report),before,'Rendering must not mutate accepted tasks, snapshots, IDs, map or permissions.');
assert.deepEqual(report,original);
assert.equal(taskPages(html).length,4,'Each previous task and proposal gets its saved one-task page.');
for(const agent_id of owners){
  const p=taskPages(html).find(s=>s.includes('Short title '+agent_id));
  assert(p.includes('Short outcome '+agent_id));
  assert(p.includes('Readable evidence '+agent_id));
  assert(p.includes('https://example.org/'+agent_id));
  assert(p.includes('not started · proposed, not released'),'Presentation cannot turn unrun work into a released completion.');
  assert(!p.includes('done'));
  const n=taskPages(html).find(s=>s.includes('Accepted proposal '+agent_id));
  assert(n.includes('Short reason '+agent_id));assert(n.includes('Short success '+agent_id));
  assert(n.includes(report.presentation.owner_display_names[agent_id]+' · Selected direction'));
  assert(n.includes('These steps are proposals. Research starts only after an explicit approval.'));
  assert(!n.includes('unapproved'),'Presentation cannot change the proposal direction.');
}
for(const text of ['Saved explanation','Saved direction summary','Saved direction reason','under exploration','Saved finding','No result was invented.','Saved director question','Keep the saved limit.'])assert(html.includes(text));
assert(!html.includes('Invented finding'));
assert(!html.includes('Old name'));
assert(!html.includes('Accepted outcome'));

// Already prepared, unnamespaced exports resolve the same owner/step pair.
const prepared=structuredClone(original);
prepared.previous_steps.forEach(s=>s.id='past');prepared.next_steps.forEach(s=>s.id='proposal');
assert.equal(renderSlides(prepared,''),html);

// Display-ready records are also subordinate to the accepted permission record.
const displayRecords=structuredClone(original);
displayRecords.previous_steps.forEach(s=>{s.status='done';s.released=true;});
displayRecords.next_steps.forEach(s=>s.direction_id='unapproved');
assert.equal(renderSlides(displayRecords,''),html);

// Missing or wrongly owned displays must not hide tasks or borrow another owner's text.
const partial=structuredClone(original);
partial.presentation.previous_step_slides=partial.presentation.previous_step_slides.filter(s=>s.agent_id===owners[0]);
partial.presentation.previous_step_slides.push({agent_id:'foreign-owner',id:'past',title:'Wrong owner',text:'Wrong outcome'});
const partialHTML=renderSlides(partial,'');
assert(partialHTML.includes('Accepted outcome owner-b'));assert(!partialHTML.includes('Wrong outcome'));
assert.equal(taskPages(partialHTML).length,4);

// Keep the existing two-per-page and contributor-name fallback for older reports.
const legacy=structuredClone(original);delete legacy.presentation;
const legacyHTML=renderSlides(legacy,'');
assert.equal(taskPages(legacyHTML).length,2);assert(legacyHTML.includes('Old name 0'));
assert(legacyHTML.includes('Accepted outcome owner-a'));assert(legacyHTML.includes('Accepted reason owner-b'));
legacy.previous_steps_per_slide=1;legacy.next_steps_per_slide=1;
assert.equal(taskPages(renderSlides(legacy,'')).length,4,'Top-level saved pagination also applies.');
for(const bad of [0,-1,1.5,'1',null]){
  legacy.previous_steps_per_slide=bad;legacy.next_steps_per_slide=bad;
  assert.equal(taskPages(renderSlides(legacy,'')).length,2,'Invalid pagination falls back safely.');
}

// Display text and evidence remain escaped even when they contain markup.
const escaped=structuredClone(original);
escaped.presentation.previous_step_slides[0].title='<script>bad()</script>';
escaped.presentation.previous_step_slides[0].evidence=[{label:'<img>',url:'https://example.org/"quoted'}];
const escapedHTML=renderSlides(escaped,'');
assert(!escapedHTML.includes('<script>bad()'));assert(escapedHTML.includes('&lt;script&gt;bad()&lt;/script&gt;'));
assert(escapedHTML.includes('&lt;img&gt;'));assert(escapedHTML.includes('&quot;quoted'));

console.log('PASS: owner/task display matching, accepted statuses/releases/directions and immutable scientific records, one-task pagination, retained findings/questions, legacy fallback and escaping.');
