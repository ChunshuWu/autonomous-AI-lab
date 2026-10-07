import {Invalid,reportFor} from './logic.mjs';
import {reportAnchorExists} from './documents.mjs';
const historyGroup=r=>r.progress_id||r.id;
export function earlierReports(s,r){
 // Limit to reports that already existed when this report was submitted.
 const at=s.reports.findIndex(x=>x.id===r.id),past=at<0?s.reports:s.reports.slice(0,at),byId=new Map(past.map(x=>[x.id,x]));
 const selected=new Map();
 const add=(key,ref={})=>{const old=byId.get(key);if(old&&!selected.has(key))selected.set(key,{report_id:old.id,title:old.title,created_at:old.created_at,version:old.version,progress_id:historyGroup(old),note:ref.note||'',anchor:ref.anchor||null});};
 const seen=new Set();
 for(const old of [...past].reverse())if(old.report_type==='team'&&historyGroup(old)!==historyGroup(r)&&!seen.has(historyGroup(old))){seen.add(historyGroup(old));add(old.id);}
 for(const ref of r.previous_reports||[])add(ref.report_id,ref);
 for(const c of r.contributors||[])if(c.report_id)add(c.report_id,{note:'Source report for this contribution'});
 if(r.revision_of)add(r.revision_of,{note:'Earlier version of this progress report'});
 return [...selected.values()];
}
export function validateEarlierReports(s,r){
 const refs=r.previous_reports||[];
 if(!Array.isArray(refs)||refs.length>100)throw new Invalid('Provide up to 100 earlier report links.');
 const seen=new Set();
 r.previous_reports=refs.map(ref=>{
  const old=reportFor(s,ref.report_id);if(seen.has(old.id))throw new Invalid('List each earlier report once.');seen.add(old.id);
  if(ref.note!==undefined&&(typeof ref.note!=='string'||ref.note.length>1000))throw new Invalid('Use a short note for each earlier report.');
  if(ref.anchor!==undefined&&ref.anchor!==null&&!/^(slide-[1-9][0-9]{0,3}|section-(?:background|progress|next-steps)|direction-[a-z0-9-]+|earlier-reports)$/.test(ref.anchor))throw new Invalid('Use a report section or direction anchor for an earlier report.');
  if(ref.anchor&&!reportAnchorExists({...old,earlier_reports:earlierReports(s,old)},ref.anchor))throw new Invalid('That earlier report section does not exist.');
  return {report_id:old.id,note:ref.note||'',anchor:ref.anchor||null};
 });
 if(r.revision_of){const old=reportFor(s,r.revision_of);if(old.id!==s.latest_team_report||old.report_type!=='team')throw new Invalid('Revise the current team report, or submit a new progress report.');}
}
export function reportLink(reportId,workspace,anchor){return '/documents/'+encodeURIComponent(reportId)+'?workspace='+encodeURIComponent(workspace)+(anchor?'#'+encodeURIComponent(anchor):'');}
