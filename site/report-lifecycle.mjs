// Shared by the dashboard and server. This view never changes work permission
// or removes a report that an approved task, question or tree node references.
export const progressGroup=r=>r.progress_id||r.id;
export function reportLabel(s,r){
 if(r.report_type!=='team')return 'Individual report · Version '+r.version;
 const groups=[...new Set(s.reports.filter(x=>x.report_type==='team').map(progressGroup))];
 return 'Round '+(groups.indexOf(progressGroup(r))+1)+' · Version '+(r.progress_version||1);
}
export function reportLifecycle(s,r){
 const archived=reason=>({status:'archived',reason});
 if(s.project?.archived_at)return archived('This project is archived.');
 const a=s.agents.find(a=>a.id===r.agent_id),team=r.report_type==='team';
 if(team?r.id!==s.latest_team_report:r.id!==a?.latest_report)return archived('Replaced by a later report.');
 if(!team&&(s.reporting_mode==='team'||s.agents.some(a=>a.role==='writer')))return archived('Replaced by combined team reporting.');
 if(!a||a.dismissal||a.status==='closed'||r.closed)return archived('This assignment has ended.');
 const decision=[...s.decisions].reverse().find(d=>d.report_id===r.id&&['continue','revise_report','keep_paused','close'].includes(d.decision));
 if(decision?.decision==='continue')return archived('Reviewed; the next steps were issued.');
 if(decision?.decision==='close')return archived('This work was stopped.');
 if(decision?.decision==='revise_report')return archived('A corrected version was requested.');
 if(!team&&r.direction_revision!==undefined&&r.direction_revision!==s.direction_revision)return archived('The research direction has changed.');
 if(team){
  if(r.map_revision!==(s.research_map?.revision||0)||r.direction_revision!==s.direction_revision)return archived('The research direction or map has changed.');
  if(r.contributors.some(c=>{
   const owner=s.agents.find(a=>a.id===c.agent_id);
   return !owner||c.snapshot!==JSON.stringify([owner.latest_update||null,owner.latest_report||null,owner.plan,owner.prior_proposals||[],owner.status==='closed']);
  }))return archived('New findings or plans need a new report.');
 }
 if(['preparing_report','revising_report','awaiting_writer'].includes(a.status))return archived('The next report is being prepared.');
 return {status:'current',reason:'Awaiting review.'};
}
export function reportCatalog(s){
 const entries=s.reports.map(r=>({report_id:r.id,progress_id:progressGroup(r),label:reportLabel(s,r),...reportLifecycle(s,r)}));
 return {current_ids:entries.filter(e=>e.status==='current').map(e=>e.report_id),entries};
}
export const withReportCatalog=s=>({...s,report_catalog:reportCatalog(s)});
