import {Invalid, agentFor} from './logic.mjs';

const requestText=(value,label,max=12000)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Invalid(`Provide ${label}, up to ${max} characters.`);
  return value.trim();
};
const requestRecord=(s,id)=>{
  const r=(s.requests||[]).find(r=>r.id===id);
  if(!r)throw new Invalid('Unknown decision request in this project.');
  return r;
};

// Requests are agent proposals. Only the director reply route records a human response.
// Neither route releases, closes, or otherwise changes research permissions.
export function submitRequest(s,p){
  if(p.action!=='submit')throw new Invalid('The orchestrator can submit requests, not director responses.');
  const key=requestText(p.key,'a stable request key',100);
  if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(key))throw new Invalid('Use lowercase letters, numbers, dots, hyphens, or underscores in the request key.');
  const agentIds=p.agent_ids||[];
  if(!Array.isArray(agentIds)||new Set(agentIds).size!==agentIds.length)throw new Invalid('Use a list of distinct affected agent IDs.');
  agentIds.forEach(id=>agentFor(s,id));
  if(!Array.isArray(p.options)||p.options.length>6)throw new Invalid('Use zero to six clearly described choices.');
  const options=p.options.map(o=>({id:requestText(o.id,'choice ID',80),label:requestText(o.label,'choice label',160),detail:requestText(o.detail,'what this choice means',3000)}));
  if(new Set(options.map(o=>o.id)).size!==options.length)throw new Invalid('Use unique choice IDs.');
  const evidence=p.evidence||[];
  if(!Array.isArray(evidence)||evidence.length>12)throw new Invalid('Use up to twelve evidence references.');
  const content={title:requestText(p.title,'a request title',200),requester:requestText(p.requester,'the original requester',200),context:requestText(p.context,'enough background and any attempts'),question:requestText(p.question,'the exact question',3000),recommendation:p.recommendation?requestText(p.recommendation,'a recommendation',3000):'',agent_ids:[...agentIds],options,evidence:evidence.map(e=>({note:requestText(e.note,'evidence note',3000),source:requestText(e.source,'evidence location',2000)})),direction_revision:s.direction_revision};
  const prior=(s.requests||[]).find(r=>r.key===key);
  if(prior){
    const old=Object.fromEntries(Object.keys(content).map(k=>[k,prior[k]]));
    if(JSON.stringify(old)===JSON.stringify(content))return prior;
    if(p.expected_revision!==prior.revision)throw new Invalid('This request changed. Read the latest version before updating it.');
  }
  const at=new Date().toISOString();
  if(!prior)s.requests||=[];
  const r=prior||{id:'request-'+crypto.randomUUID(),key,created_at:at,revision:0,history:[],responses:[],submitted_by:'Orchestrator'};
  Object.assign(r,content,{revision:r.revision+1,status:'pending',updated_at:at});
  r.history.push({revision:r.revision,at,...structuredClone(content)});
  if(!prior)s.requests.push(r);
  s.events.push({at,actor:'Orchestrator',text:(prior?'Updated request: ':'Requested a decision: ')+r.title});
  return r;
}

export function replyToRequest(s,p){
  const r=requestRecord(s,p.request_id);
  if(p.expected_revision!==r.revision)throw new Invalid('This request changed. Reopen it before responding.');
  if(r.status!=='pending')throw new Invalid('This request already has an answer or is closed.');
  if(!['comment','keep_pending','option','close'].includes(p.decision))throw new Invalid('Choose how to respond to this request.');
  const comment=p.comment??'';
  if(typeof comment!=='string'||comment.length>12000)throw new Invalid('Comments must be text, up to 12000 characters.');
  const option=p.decision==='option'?r.options.find(o=>o.id===p.option_id):null;
  if(p.decision==='option'&&!option)throw new Invalid('Choose one of this request’s current options.');
  if(option&&r.direction_revision!==s.direction_revision)throw new Invalid('The research direction changed. Ask the orchestrator to update this request before choosing an option.');
  const response={id:'request-response-'+crypto.randomUUID(),kind:'request_reply',request_id:r.id,request_revision:r.revision,at:new Date().toISOString(),decision:p.decision,comment,option:option?structuredClone(option):null,direction_revision:s.direction_revision};
  r.responses.push(response);r.updated_at=response.at;
  if(option)r.status='answered';
  if(p.decision==='close')r.status='closed';
  s.decisions.push(structuredClone(response));
  s.events.push({at:response.at,actor:'Director',text:'Responded to request: '+r.title});
  return response;
}
