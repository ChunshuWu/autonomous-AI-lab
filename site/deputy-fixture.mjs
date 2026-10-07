// Fictional reports only. No live project IDs, data, questions or approvals.
import {Store} from './store.mjs';
import {adapter} from './tests.mjs';
import {seeds} from './fixtures/seeds.mjs';
export async function deputyFixture(db=adapter()){
 const store=new Store(db,seeds);await store.init();const workspace='deputy-test';
 const act=(action,p={},role='director')=>store.apply(workspace,{action,...p},role);
 await act('create_project',{name:'Fictional deputy test'});
 await act('confirm_topic',{topic:'Choose one saved-evidence reading question. Before any approval, ask the librarian whether the source check already settles Idea A. If it is open, the next step is a short reading outline only. No experiments.'});
 const agents=[];
 for(const [name,role,specialty] of [['Researcher','researcher','Source comparison'],['Librarian','librarian','Source records'],['Writer','writer','Clear reports'],['Coordinator','orchestrator','Coordination']])agents.push(await act('add_agent',{name,role,specialty,question:'Explain the saved reading question.',plan:['Read supplied notes']}));
 const [a,l,w,o]=agents;await act('assign_orchestrator',{agent_id:o.id});
 await act('upsert',{actor:'Coordinator',expected_revision:0,nodes:[{id:'idea-a',title:'Idea A: compare explanations',summary:'An open source comparison.'},{id:'idea-b',title:'Idea B: compare timing',summary:'A separate alternative.'}]},'mapper');
 const update=await act('research_update',{agent_id:a.id,update:{summary:'Two reading questions; the librarian holds the final source check.',evidence:[{note:'Saved teaching note',source:'notes/source.md'}],previous_steps:a.plan.map(p=>({...p,status:'not_started',outcome:'This is a fictional fixture; no research was run.'}))}},'worker');
 const r=structuredClone(seeds.example.reports[0]);
 for(const k of ['id','version','previous_report','revision_of','progress_id','progress_version'])delete r[k];
 r.title='Which small reading question comes next?';r.summary='A source check must be clarified before choosing the next reading outline.';r.kind='Fictional review';
 r.background={problem:'Choose a reading question.',known:'The librarian has the saved source check.',gap:'It is unclear whether Idea A is already covered.',terms:[],explanation:[{title:'Ask the librarian first',text:'The source check is saved in the librarian’s notes. Do not guess its conclusion.'}]};
 r.findings=[{kind:'proposal',claim:'Check what is still open',detail:'The next work would only be a reading outline.',evidence:[{label:'Teaching note',url:'notes/source.md'}]}];
 r.questions=[{id:'focus',text:'Does the saved source check leave Idea A open?',options:[],recommendation:'Ask the librarian before deciding.'}];r.map_revision=1;
 r.contributors=[{agent_id:a.id,update_id:update.id,report_id:null,previous_steps:update.previous_steps,next_steps:[{id:'read-a',direction_id:'idea-a',task:'Draft a short reading outline for Idea A',why:'Identify which sources to compare.',success:'A one-page reading outline, no experiment.'},{id:'read-b',direction_id:'idea-b',task:'Draft a short reading outline for Idea B',why:'Compare the timing assumptions.',success:'A one-page reading outline, no experiment.'}]}];
 r.directions=[{id:'idea-a',summary:'Compare explanations after clarifying the source check.',reason:'Could leave an open reading question.'},{id:'idea-b',summary:'Compare timing assumptions.',reason:'An alternative worth keeping.'}];
 const report=await act('report',{agent_id:w.id,report:r},'worker');await act('pause_lab');
 return {store,workspace,agents,report,state:(await store.read(workspace)).state};
}
