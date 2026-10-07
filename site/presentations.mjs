import {Invalid} from './logic.mjs';

export const presentationFields=['question','prior_work','gap','factor','support','outcome','conditions'];
export function presentation(value){
 if(value==null)return null;
 if(typeof value!=='object'||Array.isArray(value))throw new Invalid('Use a short research presentation.');
 const result={};
 for(const key of presentationFields){const text=value[key];if(typeof text!=='string'||!text.trim())throw new Invalid('Explain '+key+' with meaningful text.');result[key]=text.trim();}
 if(value.experiment&&typeof value.experiment==='object')result.experiment=Object.fromEntries(['data','method','setup','expected_outcome','learning'].map(k=>[k,typeof value.experiment[k]==='string'?value.experiment[k].trim():'Not specified yet.']));
 if(typeof value.rejection_check==='string'&&value.rejection_check.trim())result.rejection_check=value.rejection_check.trim();
 return result;
}
export function convergence(votes=[]){
 if(!votes.length)return 'No vote recorded.';
 const counts=new Map();for(const v of votes)counts.set(v.choice,(counts.get(v.choice)||0)+1);
 const best=Math.max(...counts.values()),none=counts.size===1&&counts.has('none_is_ready');
 return counts.size===1?(none?'Converged: all '+votes.length+' chose none is ready.':'Converged: all '+votes.length+' chose the same candidate.'):'Not converged: the leading choice received '+best+' of '+votes.length+' votes.';
}
