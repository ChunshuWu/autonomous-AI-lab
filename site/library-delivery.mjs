import {Invalid} from './logic.mjs';
import {normalizeLibraryItem} from './records.mjs';

// A delivery is the saved file's JSON, unchanged. One catalog write stores all
// items and the receipt, so a lost response can be retried without duplicates.
export const stableJSON=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export async function prepareLibraryDelivery(catalog,p,actor,workspace,projectIds){
  const h=p.handoff;
  if(!h||h.schema_version!==1||!Array.isArray(h.items)||h.items.length>50)throw new Invalid('Use library handoff schema_version 1 with 0–50 items.');
  if(typeof h.handoff_id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(h.handoff_id))throw new Invalid('Provide a stable handoff_id.');
  if(Object.keys(h).some(k=>!['schema_version','handoff_id','items'].includes(k)))throw new Invalid('Unknown library handoff field.');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(stableJSON({workspace,actor,handoff:h})));
  const fingerprint=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  const previous=(catalog.deliveries||[]).find(d=>d.workspace===workspace&&d.handoff_id===h.handoff_id);
  if(previous){
    if(previous.fingerprint!==fingerprint)throw new Invalid('This handoff_id already has different content. Save a new handoff ID for a correction.');
    return {receipt:previous.receipt,replayed:true};
  }
  const seen=new Set(),updated=[],items=[...catalog.items];
  const fields=['id','expected_revision','kind','title','summary','source','path','version','availability','reading','checks','notes','acquired_by','topics','project_ids','read_by','links'];
  for(const row of h.items){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!fields.includes(k)))throw new Invalid('Use the library item fields; unknown fields would lose information.');
    if(seen.has(row.id))throw new Invalid('Include each library item only once per handoff.');seen.add(row.id);
    const {expected_revision,...input}=row,old=items.find(x=>x.id===input.id);
    if(!Number.isInteger(expected_revision)||expected_revision<0||expected_revision!==(old?.revision||0))throw new Invalid('Library item '+String(input.id)+' changed. Reload its saved version before preparing a new handoff.');
    if(!input.project_ids?.includes(workspace))throw new Invalid('Include the current project in each item’s project_ids.');
    const item=normalizeLibraryItem(input,old,actor,projectIds),index=items.findIndex(x=>x.id===item.id);
    if(index<0)items.push(item);else items[index]=item;
    updated.push({id:item.id,revision:item.revision});
  }
  const receipt={handoff_id:h.handoff_id,workspace,agent_id:actor,status:'delivered',catalog_revision:catalog.revision+1,items:updated,delivered_at:new Date().toISOString()};
  return {catalog:{...catalog,revision:catalog.revision+1,items,deliveries:[...(catalog.deliveries||[]),{workspace,handoff_id:h.handoff_id,fingerprint,receipt}]},receipt,replayed:false};
}

// Current catalog facts, including papers registered in earlier rounds.
export function registeredLibraryContext(catalog,workspace){
 const fields=['id','revision','kind','title','summary','source','path','version','project_ids','read_by','reading','availability','checks','links'];
 const items=catalog.items.filter(r=>r.project_ids?.includes(workspace)).map(r=>Object.fromEntries(fields.filter(k=>Object.hasOwn(r,k)).map(k=>[k,structuredClone(r[k])])));
 const covered=new Set(),receipts=[];
 for(const d of [...(catalog.deliveries||[])].reverse()){
  if(d.workspace!==workspace)continue;
  const used=d.receipt.items.filter(r=>items.some(x=>x.id===r.id)&&!covered.has(r.id));
  if(!used.length)continue;used.forEach(r=>covered.add(r.id));receipts.push({...d.receipt,items:used});
 }
 return {workspace,catalog_revision:catalog.revision,items,receipts,versions:items.map(r=>({id:r.id,revision:r.revision})).sort((a,b)=>a.id.localeCompare(b.id)),note:'Current project-linked catalog records. A round receipt lists only that delivery, not all papers used by the project. Earlier registered sources remain valid. Preserve the actual readers and reading/access limits; registration is not proof of scientific readiness. Full history and older notes remain in the shared library.'};
}
