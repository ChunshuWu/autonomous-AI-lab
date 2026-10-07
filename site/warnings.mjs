import {Invalid} from './logic.mjs';

// Warnings are observations. They never change plans, reviews, or permissions.
function warningText(value,label,max){
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Invalid(`Provide ${label}, up to ${max} characters.`);
  return value.trim();
}
function warningEvidence(value){
  if(!Array.isArray(value)||!value.length||value.length>8)throw new Invalid('Include one to eight evidence records.');
  return value.map(item=>{
    if(!item||typeof item!=='object')throw new Invalid('Each evidence record needs a note and source.');
    const source=warningText(item.source,'an evidence source',1000);
    if(/^(?:javascript|data|vbscript):/i.test(source))throw new Invalid('Use an evidence URL, local path, or record ID.');
    return {note:warningText(item.note,'an evidence note',1200),source};
  });
}
export function changeWarning(state,p){
  if(!['raise','resolve'].includes(p.action))throw new Invalid('Warnings support raise and resolve only.');
  const key=warningText(p.key,'a stable warning key',120);
  if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(key))throw new Invalid('Use a stable warning key with lowercase letters, numbers, dots, underscores, or hyphens.');
  const reporter=warningText(p.reporter,'the reporting agent or orchestrator',120);
  const all=state.warnings||[],existing=all.find(w=>w.key===key),at=new Date().toISOString();
  if(p.action==='resolve'){
    if(!existing)throw new Invalid('Unknown warning.');
    const note=warningText(p.resolution,'what changed or why the warning was withdrawn',1600);
    const evidence=warningEvidence(p.evidence);
    if(existing.status==='resolved'&&existing.resolution.note===note&&JSON.stringify(existing.resolution.evidence)===JSON.stringify(evidence))return existing;
    if(existing.status==='resolved')throw new Invalid('This warning is already resolved. Raise it with current evidence if it recurs.');
    if(p.expected_revision!==existing.revision)throw new Invalid('Read the latest warning and pass its revision before resolving it.');
    existing.status='resolved';existing.updated_at=at;existing.revision++;
    existing.resolution={at,by:reporter,note,evidence};
    existing.history.push({action:'resolve',at,by:reporter,note,evidence});
    state.events.push({at,actor:reporter,text:`Resolved warning: ${existing.title}. ${note}`});
    return existing;
  }
  const agentIds=p.agent_ids??[];
  if(!Array.isArray(agentIds)||agentIds.some(id=>!state.agents.some(a=>a.id===id)))throw new Invalid('Use affected agent IDs from this project.');
  const certainty=p.certainty??'possible';
  if(!['observed','possible'].includes(certainty))throw new Invalid('Choose observed or possible.');
  const content={title:warningText(p.title,'a warning title',160),symptom:warningText(p.symptom,'the observed symptom',1600),impact:warningText(p.impact,'the effect on the work',1000),suggestion:warningText(p.suggestion,'a suggested response',1200),certainty,agent_ids:[...new Set(agentIds)].sort(),evidence:warningEvidence(p.evidence)};
  if(existing?.status==='open'&&Object.entries(content).every(([k,v])=>JSON.stringify(existing[k])===JSON.stringify(v)))return existing;
  if(existing?.status==='resolved'&&JSON.stringify(existing.evidence)===JSON.stringify(content.evidence))return existing;
  const action=existing?(existing.status==='resolved'?'reopen':'update'):'raise';
  const warning=existing||{id:'warning-'+crypto.randomUUID(),key,created_at:at,revision:0,history:[]};
  Object.assign(warning,content,{status:'open',reported_by:reporter,updated_at:at,revision:warning.revision+1,resolution:null});
  warning.history.push({action,at,by:reporter,...content});
  if(!existing){all.push(warning);state.warnings=all;}
  state.events.push({at,actor:reporter,text:`${action==='raise'?'Raised':action==='reopen'?'Reopened':'Updated'} warning: ${warning.title}`});
  return warning;
}
