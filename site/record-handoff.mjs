import {upsertRecord} from './records.mjs';
import {changeWarning} from './warnings.mjs';

export const recordDisplayVersion=4;
const handoffLabel=k=>String(k).replaceAll('_',' ').replace(/^./,c=>c.toUpperCase());
const handoffCell=v=>String(v===undefined?'':typeof v==='object'?JSON.stringify(v):v).replaceAll('|','\\|').replaceAll('\n',' ');
function handoffText(value){
 if(typeof value==='string')return value;
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value)){
  if(value.length&&value.every(row=>row&&typeof row==='object'&&!Array.isArray(row))){
   const keys=[...new Set(value.flatMap(Object.keys))];
   return '| '+keys.map(handoffLabel).map(handoffCell).join(' | ')+' |\n| '+keys.map(()=>'---').join(' | ')+' |\n'+value.map(row=>'| '+keys.map(k=>handoffCell(row[k])).join(' | ')+' |').join('\n');
  }
  return value.map(v=>'- '+handoffText(v)).join('\n');
 }
 return Object.entries(value).map(([k,v])=>'**'+handoffLabel(k)+'**\n\n'+handoffText(v)).join('\n\n');
}
function handoffEntries(value){
 if(value===undefined||value===null)return [];
 if(Array.isArray(value))return value;
 if(typeof value!=='object')throw Error('The saved dashboard details use an unreadable format.');
 if(Array.isArray(value.records))return value.records;
 if(value.type&&value.record)return [value];
 const groups=[['experiments','experiment'],['meetings','meeting'],['methods','method']];
 if(!groups.some(([key])=>Object.hasOwn(value,key)))throw Error('The saved dashboard details have no recognized record group.');
 return groups.flatMap(([key,type])=>{
  if(!Object.hasOwn(value,key))return [];
  if(!Array.isArray(value[key]))throw Error('The '+key+' group must be a list.');
  return value[key].map(record=>({type,record,expected_revision:record?.expected_revision??0}));
 });
}
function handoffRecord(entry,task){
 if(!entry||typeof entry!=='object')throw Error('A saved dashboard item is not a record.');
 const raw=entry.record||entry;
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('A saved dashboard item has no record fields.');
 if(raw.task_id&&raw.task_id!==task.id)throw Error('The record names a different task.');
 const record=structuredClone(raw);
 // Reuse the already saved result summary; this is display metadata, not new science.
 if(typeof record.summary!=='string'||!record.summary.trim()){
  const summary=task.result.summary;
  record.summary=typeof summary==='string'&&summary.trim()&&summary.length<=3000?summary:'Saved evidence for '+record.title+'. See the full task report.';
 }

 for(const field of ['setup','results','cost','settings','data','baseline','measures','budget','notes'])if(record[field]!==undefined&&typeof record[field]!=='string')record[field]=handoffText(record[field]);
 for(const field of ['interpretation','uncertainty'])if(record[field]===undefined&&typeof raw.results?.[field]==='string')record[field]=raw.results[field];
 for(const [single,multiple] of [['proposal_id','proposal_ids'],['method_id','method_ids'],['report_id','report_ids']])if(record[single]&&!record[multiple])record[multiple]=[record[single]];
 if(Array.isArray(raw.links))record.evidence=[...(record.evidence||[]),...raw.links.map(link=>({note:link.label||'Saved output',source:link.path||link.url||link.source}))];
 if(Array.isArray(record.evidence))record.evidence=record.evidence.map(e=>typeof e==='string'?{note:'Saved file: '+e,source:task.result.artifacts?.find(a=>a.path===e||a.path.endsWith('/'+e))?.path||e}:e);
 // A missing input stopped execution; it is not a failed scientific test.
 if((entry.type||raw.type)==='experiment'&&record.status==='blocked')record.status='stopped';
 for(const field of ['results','cost'])if(raw[field]===null)delete record[field];
 const table=raw.results?.table;
 if(!record.figures?.length&&Array.isArray(table)&&table.length&&table.every(row=>row&&typeof row==='object'&&!Array.isArray(row))){
  const keys=[...new Set(table.flatMap(Object.keys))];
  record.figures=[{type:'table',detail_only:true,title:'Recorded results',caption:'Original saved values. Column definitions and limits are in the full report.',columns:keys.map(handoffLabel),rows:table.map(row=>keys.map(k=>row[k]===undefined?'':typeof row[k]==='object'?JSON.stringify(row[k]):row[k]))}];
 }
 return {type:entry.type||raw.type,record,expected_revision:entry.expected_revision??0,agent_id:task.agent_id};
}

// A director may have restored a pending display already. Confirm identical scientific
// content and task provenance before adopting that revision; never overwrite a collision.
const canonical=v=>v&&typeof v==='object'?JSON.stringify(v,(_,x)=>x&&!Array.isArray(x)&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x):v;
function sameSavedField(actual,raw){
 if(raw&&typeof raw==='object'){
  if(typeof actual==='string'){
   const json=actual.match(/^```json\s*([\s\S]*?)\s*```$/);
   if(json)try{return canonical(JSON.parse(json[1]))===canonical(raw);}catch{}
  }
  return actual===handoffText(raw);
 }
 return actual===raw;
}
function restoredRecord(state,task,entry,mapped){
 if(mapped.expected_revision!==0)return null;
 const old=state.research_records?.[mapped.type]?.find(r=>r.id===mapped.record.id);
 if(!old)return null;
 const source='/task-documents/'+encodeURIComponent(task.id)+'?workspace='+encodeURIComponent(state.project.id);
 if(old.owner_id!==task.agent_id||!old.evidence?.some(e=>e.source===source))return null;
 const raw=entry.record||entry;
 for(const field of ['purpose','setup','results','cost','interpretation','uncertainty','execution_outcome','scientific_outcome','recovery_attempts','remaining_obstacle','proposal_ids','method_ids','figures']){
  if(raw[field]===undefined||raw[field]===null)continue;
  if(Array.isArray(raw[field])&&['proposal_ids','method_ids','figures'].includes(field)){
   if(canonical(old[field])!==canonical(raw[field]))return null;
  }else if(!sameSavedField(old[field],raw[field]))return null;
 }
 if(mapped.type==='experiment'&&old.status!==mapped.record.status)return null;
 return old;
}

// Scientific output remains intact in task.result, even if its detailed display needs repair.
export function deliverTaskRecords(state,task){
 const delivered=[...(task.record_delivery?.records||[])],errors=[];let entries=[];
 try{entries=handoffEntries(task.result.records);}catch(e){errors.push({message:e.message});}
 for(const [index,entry] of entries.entries()){
  try{
   const mapped=handoffRecord(entry,task);if(delivered.some(r=>r.type===mapped.type&&r.id===mapped.record.id))continue;
   mapped.record.evidence=[...(mapped.record.evidence||[]),{note:'Original saved task result',source:'/task-documents/'+encodeURIComponent(task.id)+'?workspace='+encodeURIComponent(state.project.id)}];
   const record=restoredRecord(state,task,entry,mapped)||upsertRecord(state,mapped);
   delivered.push({type:record.type,id:record.id,revision:record.revision});
  }catch(e){errors.push({index,id:entry?.record?.id||entry?.id||null,message:e.message});}
 }
 task.record_delivery={status:errors.length?'display_pending':'delivered',records:delivered,errors,display_version:recordDisplayVersion};
 task.records_handled=true;task.records_delivered=!errors.length;
 if(errors.length)changeWarning(state,{action:'raise',key:'task-display-repair',reporter:'Task service',title:'Some result details need display repair',symptom:'The complete task output is saved, but '+errors.length+' dashboard item(s) could not be displayed.',impact:'Researchers can review the saved result and continue. The experiment will not be repeated for a display problem.',suggestion:'Read the saved output while its detailed display is repaired.',certainty:'observed',evidence:[{note:errors.map(e=>e.message).join(' ').slice(0,1100),source:'/task-documents/'+encodeURIComponent(task.id)+'?workspace='+encodeURIComponent(state.project.id)}]});
 if(!errors.length&&!state.tasks?.some(t=>t.record_delivery?.status==='display_pending')){
  const warning=state.warnings?.find(w=>w.key==='task-display-repair'&&w.status==='open');
  if(warning)changeWarning(state,{action:'resolve',key:warning.key,reporter:'Task service',expected_revision:warning.revision,resolution:'The saved details are now shown. No research work was repeated.',evidence:[{note:'Repaired display from the unchanged saved task result.',source:'tasks:'+state.project.id}]});
 }
 return task.record_delivery;
}
