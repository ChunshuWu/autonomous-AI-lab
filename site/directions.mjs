import {Invalid, agentFor, reportFor} from './logic.mjs';
import {presentation} from './presentations.mjs';
const mapText=(v,label,max=12000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Invalid('Provide '+label+'.');return v.trim();};
export const directionMap=s=>s.research_map||{revision:0,nodes:[],history:[]};
export const directionNode=(s,id)=>{const n=directionMap(s).nodes.find(n=>n.id===id);if(!n)throw new Invalid('Unknown research direction in this project.');return n;};
const mapStates=['unexplored','under_exploration','explored','discarded'];
function mapCheck(nodes){
 if(nodes.filter(n=>n.status==='under_exploration').length>1)throw new Invalid('Choose only one direction under exploration.');
 const byId=new Map(nodes.map(n=>[n.id,n]));
 for(const n of nodes){const seen=new Set([n.id]);let parent=n.parent_id;while(parent){if(!byId.has(parent))throw new Invalid('A parent direction must belong to this project.');if(seen.has(parent))throw new Invalid('A direction cannot be its own ancestor.');seen.add(parent);parent=byId.get(parent).parent_id;}}
}
const mapRevision=(s,p)=>{const m=directionMap(s);if(p.expected_revision!==m.revision)throw new Invalid('The research map changed. Refresh before saving.');return m;};
function saveMap(s,nodes,actor,note){
 const old=directionMap(s);mapCheck(nodes);
 s.research_map={revision:old.revision+1,nodes,history:[...old.history,{revision:old.revision,at:new Date().toISOString(),actor,note,nodes:structuredClone(old.nodes)}]};
 s.events.push({at:new Date().toISOString(),actor,text:note});return s.research_map;
}
export function upsertDirections(s,p){
 const m=mapRevision(s,p),actor=mapText(p.actor,'the recorder',120),nodes=structuredClone(m.nodes);
 if(!Array.isArray(p.nodes)||!p.nodes.length||p.nodes.length>100)throw new Invalid('Provide one to 100 directions.');
 if(new Set(p.nodes.map(n=>n.id)).size!==p.nodes.length)throw new Invalid('Direction IDs must be unique.');
 for(const input of p.nodes){
  if(typeof input.id!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.id)||input.id.length>80)throw new Invalid('Use stable lowercase direction IDs.');
  if(input.status!==undefined)throw new Invalid('Only a director decision changes a direction’s status.');
  const old=nodes.find(n=>n.id===input.id),refs=input.report_refs??old?.report_refs??[];
  if(!Array.isArray(refs))throw new Invalid('Report references must be a list.');
  for(const ref of refs){reportFor(s,ref.report_id);if(ref.anchor&&!/^(slide-[1-9][0-9]*|section-(?:background|progress|next-steps)|direction-[a-z0-9-]+)$/.test(ref.anchor))throw new Invalid('Use a report section or direction anchor.');}
  const evidence=input.evidence??old?.evidence??[];if(!Array.isArray(evidence))throw new Invalid('Evidence must be a list.');
  for(const e of evidence){mapText(e.note,'an evidence note');mapText(e.source,'an evidence source');}
  const n={...old,id:input.id,parent_id:Object.hasOwn(input,'parent_id')?input.parent_id:(old?.parent_id??null),title:mapText(input.title,'a short direction title',160),summary:mapText(input.summary,'a direction summary'),status:old?.status||'unexplored',report_refs:refs,evidence,updated_at:new Date().toISOString()};
  if(Object.hasOwn(input,'presentation'))n.presentation=presentation(input.presentation);
  if(old)Object.assign(old,n);else nodes.push(n);
 }
 return saveMap(s,nodes,actor,'Updated the research map.');
}
export function decideDirections(s,p,{record=true,actor='Director'}={}){
 const m=mapRevision(s,p),nodes=structuredClone(m.nodes);
 if(!Array.isArray(p.choices)||!p.choices.length)throw new Invalid('Record at least one direction choice.');
 if(new Set(p.choices.map(c=>c.id)).size!==p.choices.length)throw new Invalid('Choose each direction once.');
 for(const choice of p.choices){const n=nodes.find(n=>n.id===choice.id);if(!n||n.revision_of||!mapStates.includes(choice.status))throw new Invalid('Choose a valid direction and status.');if(choice.status==='under_exploration'&&!n.report_refs?.length){const meeting=(s.research_records?.meeting||[]).find(m=>m.status==='completed'&&m.proposal_ids?.includes(n.id)&&m.decision?.trim()&&m.votes_revealed&&(m.selected_proposal_id===n.id||m.votes?.length&&m.votes.every(v=>v.choice===n.id)));if(!meeting)throw new Invalid('Link a saved selection meeting and proposal before marking the direction active.');}
 if(choice.status==='explored'&&!n.report_refs?.length&&!n.evidence?.length&&!(s.research_records?.experiment||[]).some(e=>e.proposal_ids?.includes(n.id)&&['completed','failed','stopped'].includes(e.status)))throw new Invalid('Link the findings before marking a direction explored.');n.status=choice.status;}
 mapCheck(nodes);
 const selected=nodes.find(n=>n.status==='under_exploration')?.id||null,prior=m.nodes.find(n=>n.status==='under_exploration')?.id||null;
 const changed=nodes.some(n=>m.nodes.find(x=>x.id===n.id).status!==n.status);
 if(changed){
  s.direction_revision++;
  // Changing the selected question invalidates old task permission, including
  // legacy tasks which have not yet been associated with a direction.
  for(const a of s.agents)if(a.status!=='closed'&&a.role!=='writer'&&(a.research_direction!==selected||selected!==prior))Object.assign(a,{status:'paused',feedback:null});
 }
 const result=changed?saveMap(s,nodes,actor,'Recorded research direction choices.'):m;
 if(record){const comment=p.comment??'';if(typeof comment!=='string'||comment.length>12000)throw new Invalid('Comments must be text, up to 12000 characters.');s.decisions.push({id:'map-decision-'+crypto.randomUUID(),kind:'direction_choice',at:new Date().toISOString(),map_revision:result.revision,choices:structuredClone(p.choices),comment});}
 return result;
}
export function attachDirectionReport(s,directionIds,report){
 const m=directionMap(s);
 for(const key of directionIds){const n=directionNode(s,key);n.report_refs=[{report_id:report.id,anchor:'direction-'+key},...(n.report_refs||[])];}
 // Report pointers do not change the scientific map revision reviewed by the director.
 if(m.nodes.length)s.research_map=m;
}
