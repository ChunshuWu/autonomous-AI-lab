import {changeWarning} from './warnings.mjs';

// New runs count calls and tokens without limits; older explicit hard allowances remain.
export const advisoryUsage=s=>s.task_policy?.usage_mode==='warn';
export const remainingCalls=s=>advisoryUsage(s)?Infinity:s.task_policy.max_model_calls-s.task_policy.used_calls;
export const checkpointCeiling=s=>advisoryUsage(s)?Infinity:s.workflow.configuration.max_checkpoints;
export function usageSummary(s){
 const totals={model_calls:s.task_policy?.used_calls||0,checkpoints:s.workflow?.checkpoint||0,input_tokens:0,cached_input_tokens:0,output_tokens:0,unknown_tasks:0};
 for(const t of s.tasks||[]){
  if(!t.result||['library_collect','library_delivery'].includes(t.handler))continue;
  if(t.result.usage_scope!=='task'){totals.unknown_tasks++;continue;}
  for(const k of ['input_tokens','cached_input_tokens','output_tokens'])if(Number.isSafeInteger(t.result.usage?.[k])&&t.result.usage[k]>=0)totals[k]+=t.result.usage[k];
 }
 totals.total_tokens=totals.input_tokens+totals.output_tokens; // Cached input is already part of input.
 return totals;
}
export function usageWarnings(s){
 for(const w of s.warnings||[])if(['usage-calls','usage-tokens'].includes(w.key)&&w.status==='open'){
  changeWarning(s,{action:'resolve',key:w.key,reporter:'Workflow controller',expected_revision:w.revision,resolution:'Model calls and token use are shown as counters.',evidence:[{note:'The director requested counters without usage warnings.',source:'tasks:'+s.project.id}]});
 }
 if(!advisoryUsage(s))return;
 const u=usageSummary(s),checks=[['checkpoints',u.checkpoints,s.workflow?.configuration.max_checkpoints||12,'coordination checkpoints']];
 s.usage_warning_levels||={};
 for(const [key,value,threshold,label] of checks){
  const level=Math.floor(value/threshold);if(!level||level<=(s.usage_warning_levels[key]||0))continue;
  s.usage_warning_levels[key]=level;
  changeWarning(s,{action:'raise',key:'usage-'+key,reporter:'Workflow controller',title:'Usage warning: '+label,symptom:value.toLocaleString('en-US')+' '+label+' recorded; warning threshold '+threshold.toLocaleString('en-US')+'.',impact:'Work continues. Usage does not stop the run.',suggestion:'Check whether the next task adds useful evidence. Stop repeated work with no useful progress.',certainty:'observed',evidence:[{note:key==='tokens'?'Per-task input plus output; cached input is included once. Tasks with unknown usage are excluded.':'Saved project usage counters.',source:'tasks:'+s.project.id}]});
 }
}
