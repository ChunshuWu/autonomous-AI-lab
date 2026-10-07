import json,tempfile,unittest,hashlib
from pathlib import Path
from dispatcher import Dispatcher,MODEL_FILES,task_schema,validate_workflow_plan,file_record
class API:
 def __init__(self,items=None):self.items=items or [];self.calls=[]
 def call(self,workspace,action,**args):
  self.calls.append((action,args))
  if action=='library_catalog':return {'items':self.items,'revision':3}
  if action=='library_deliver':return {'status':'delivered','items':args['handoff']['items']}
  if action=='complete':return {'delivered':True}
  return {}
class WorkflowTests(unittest.TestCase):
 def test_candidates_explain_difference_from_saved_rejections(self):
  for kind in ['proposal','research']:
   with self.subTest(kind=kind):
    packet={'task':{'kind':kind},'rejected_candidates':[{'id':'old-candidate'}]}
    schema=task_schema(packet)['properties']['presentation']
    self.assertIn('rejection_check',schema['required'])
    fresh=task_schema({'task':{'kind':kind},'rejected_candidates':[]})['properties']['presentation']
    self.assertNotIn('rejection_check',fresh['required'])

 def test_research_candidate_requires_a_concrete_experiment(self):
  schema=task_schema({'task':{'kind':'research'}})['properties']['presentation']
  self.assertIn('experiment',schema['required'])
  self.assertEqual(schema['properties']['experiment']['required'],['data','method','setup','expected_outcome','learning'])
  proposal=task_schema({'task':{'kind':'proposal'}})['properties']['presentation']
  self.assertNotIn('experiment',proposal['required'])

 def test_stopping_kind_preserves_missing_input_vs_endpoint(self):
  schema=task_schema({'task':{'kind':'coordination'}})['properties']['workflow_plan']
  self.assertIn('stop_kind',schema['required'])
  self.assertEqual(schema['properties']['stop_kind']['enum'],['endpoint','dependency','no_next_step',None])
  plan={'action':'stop','next_phase':'finished','summary':'Missing inputs','assignments':[],'tie_choice':None,'stop_reason':'Circuit source unavailable','stop_kind':'dependency'}
  validate_workflow_plan({'requests':[],'workflow_plan':plan})
  for change in [{'stop_kind':'success'},{'stop_kind':None},{'action':'advance'}]:
   with self.subTest(change=change),self.assertRaises(ValueError):validate_workflow_plan({'requests':[],'workflow_plan':{**plan,**change}})
  # A saved old result may still be delivered unchanged after a service upgrade.
  del plan['stop_kind'];validate_workflow_plan({'requests':[],'workflow_plan':plan})
 def test_coordination_schema_uses_only_current_allowed_phases(self):
  packet={'task':{'kind':'coordination'},'workflow_context':{'allowed_next_phases':['critique','finished']}}
  schema=task_schema(packet)
  self.assertEqual(schema['properties']['workflow_plan']['properties']['next_phase']['enum'],['critique','finished'])
  schema['properties']['workflow_plan']['properties']['next_phase']['enum'].append('vote')
  self.assertEqual(task_schema(packet)['properties']['workflow_plan']['properties']['next_phase']['enum'],['critique','finished'])
  self.assertIn('vote',task_schema({'task':{'kind':'coordination'}})['properties']['workflow_plan']['properties']['next_phase']['enum'])
 def test_coordination_schema_rejects_invalid_phase_constraints(self):
  for phases in [[],['skip-review'],'vote']:
   with self.subTest(phases=phases),self.assertRaisesRegex(ValueError,'Invalid supplied workflow phases'):
    task_schema({'task':{'kind':'coordination'},'workflow_context':{'allowed_next_phases':phases}})
 def setup_dispatcher(self,root,items=None):
  api=API(items);d=Dispatcher({'lab_root':str(root),'runner_id':'fixture','projects':[],'model':'fixture','codex_bin':'unused'},api,root/'state');self.addCleanup(d.pool.shutdown);return d,api
 def source_packet(self,root):
  ws=root/'projects/p/workspace';ws.mkdir(parents=True);path=ws/'sources.json'
  source=dict(id='paper',title='A paper',source='https://example.org/paper',summary='Researcher summary',version='v1',reading='Full text',availability='Open',checks='Checked')
  path.write_text(json.dumps({'sources':[source]}));record=file_record(path)
  return {'task':{'id':'collect','kind':'library','handler':'library_collect','input_refs':[str(path)]},'agent':{'id':'lib','role':'librarian'},'claim':{'task_id':'collect','lease_id':'lease'},'source_inputs':[{'task_id':'research','agent_id':'r1',**record}]},source,path
 def test_review_sources_complete_verified_and_no_peer_requests(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,_,path=self.source_packet(root);d,_=self.setup_dispatcher(root)
   packet['task']['kind']='meeting';packet['workflow_context']={'phase':'critique'}
   self.assertEqual(task_schema(packet)['properties']['requests']['maxItems'],0)
   notes=d.notes(packet);self.assertFalse(notes[0]['truncated']);self.assertEqual(json.loads(notes[0]['text']),json.loads(path.read_text()))
   path.write_text(path.read_text()+' ')
   with self.assertRaisesRegex(ValueError,'hash changed'):d.notes(packet)
 def test_complete_saved_report_survives_artifact_envelope(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);out=root/'projects/p/workspace/task';out.mkdir(parents=True)
   report=out/'report.md';report.write_text('Complete report '*1000+'ESSENTIAL FINAL EVIDENCE')
   manifest=out/'artifact_manifest.json';manifest.write_text(json.dumps({'files':[file_record(report)]}))
   packet={'task':{'id':'review','kind':'meeting','input_refs':[str(manifest)]},'reusable_outputs':[{'task_id':'owner','artifacts':[file_record(manifest)]}]}
   d,_=self.setup_dispatcher(root);notes=d.notes(packet)
   self.assertEqual(notes[0]['path'],str(report));self.assertTrue(notes[0]['text'].endswith('ESSENTIAL FINAL EVIDENCE'));self.assertFalse(notes[0]['truncated'])
   manifest.write_text(json.dumps([file_record(report)]));packet['reusable_outputs'][0]['artifacts']=[file_record(manifest)]
   self.assertEqual(d.notes(packet)[0]['text'],report.read_text())
   report.write_text(report.read_text()+'changed')
   with self.assertRaisesRegex(ValueError,'report hash changed'):d.notes(packet)
 def test_report_is_registered_before_twenty_file_envelope_fills(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);d,api=self.setup_dispatcher(root)
   packet={'task':{'id':'owner','kind':'engineering','input_refs':[]},'agent':{'id':'engineer'},'claim':{'task_id':'owner','lease_id':'lease'}}
   def run_model(packet,workspace,out):
    for i in range(30):(out/('data-'+str(i)+'.json')).write_text('{}')
    (out/'report.md').write_text('The complete experiment report')
    return {'outcome':'completed','summary':'Fixture','body':'Short answer','document':None,'requests':[]}
   d.run_model=run_model;d.execute('p',packet)
   payload=json.loads((d.folder('p','owner')/'delivery.json').read_text())
   paths=[Path(r['path']).name for r in payload['result']['artifacts']]
   self.assertIn('report.md',paths);self.assertEqual(len(paths),20)
 def test_saved_report_manifest_cannot_read_an_unrelated_file(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);out=root/'projects/p/workspace/task';out.mkdir(parents=True)
   report=root/'report.md';report.write_text('Unrelated file')
   manifest=out/'artifact_manifest.json';manifest.write_text(json.dumps({'files':[file_record(report)]}))
   packet={'task':{'id':'review','kind':'meeting','input_refs':[str(manifest)]},'reusable_outputs':[{'task_id':'owner','artifacts':[file_record(manifest)]}]}
   d,_=self.setup_dispatcher(root)
   with self.assertRaisesRegex(ValueError,'completed task folder'):d.notes(packet)
   packet['reusable_outputs']=[]
   with self.assertRaisesRegex(ValueError,'completed artifact hash'):d.notes(packet)
 def test_final_own_candidate_replaces_stale_draft_in_vote(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);d,_=self.setup_dispatcher(root);skills=root/'skill/wulab-research';skills.mkdir(parents=True)
   for name in MODEL_FILES:(skills/name).write_text('Fixture instruction')
   sessions=root/'state/sessions';sessions.mkdir();key=hashlib.sha256(b'p:r1').hexdigest();(sessions/(key+'.json')).write_text(json.dumps({'summary':'Previous draft','research_handoff':{'task_id':'old','text':'OLD DRAFT'}}))
   candidate={'id':'a','task_id':'revised','agent_id':'r1','completion_id':'revised:done','body':'Current summary','document':'COMPLETE CURRENT CANDIDATE'}
   packet={'task':{'id':'ballot','kind':'vote','input_refs':[]},'agent':{'id':'r1'},'decision_packet':{'criteria':'Fixture','candidates':[candidate]}}
   data=json.JSONDecoder().raw_decode(d.prepare(packet,'p',root/'out')['prompt'])[0];self.assertIsNone(data['research_handoff']);self.assertEqual(data['CURRENT_TASK']['decision_packet']['candidates'][0]['document'],candidate['document'])
   candidate['agent_id']='r2';data=json.JSONDecoder().raw_decode(d.prepare(packet,'p',root/'out')['prompt'])[0];self.assertIsNotNone(data['research_handoff'])
 def test_large_inputs_are_advisory_for_every_model_task(self):
  for kind in ['proposal','research','experiment','question','meeting','vote','coordination','library']:
   with self.subTest(kind=kind),tempfile.TemporaryDirectory() as td:
    root=Path(td);d,_=self.setup_dispatcher(root);skills=root/'skill/wulab-research';skills.mkdir(parents=True)
    for name in MODEL_FILES:(skills/name).write_text('Instructions '*18000)
    doc={'task_id':'candidate','text':'Complete evidence '*80000+'ESSENTIAL END'}
    packet={'task':{'id':'work','kind':kind,'input_refs':[]},'agent':{'id':'r1'},'documents':[doc]}
    if kind=='vote':packet['decision_packet']={'criteria':'Fixture','candidates':[{'id':'a','task_id':'candidate','completion_id':'done','body':'Complete candidate','document':doc['text']}] }
    p=d.prepare(packet,'p',root/'out');self.assertEqual(len(p['report']['size_warnings']),3)
    data=json.JSONDecoder().raw_decode(p['prompt'])[0];self.assertEqual(data['CURRENT_TASK']['documents'],[doc]);self.assertIn('ESSENTIAL END',p['prompt']);self.assertEqual(d.stats['model_calls'],0)
 def test_verified_peer_reading_is_order_independent_and_not_self_credit(self):
  for reverse in [False,True]:
   with self.subTest(reverse=reverse),tempfile.TemporaryDirectory() as td:
    root=Path(td);packet,source,path=self.source_packet(root);source.update(read_by=['r1'],reading='r1 read section 2');path.write_text(json.dumps({'sources':[source]}));packet['source_inputs'][0].update(file_record(path))
    peer=path.with_name('peer.json');peer.write_text(json.dumps({'sources':[{**source,'reading':'r2 used r1 summary only; no primary reading'}]}))
    packet['source_inputs'].append({'task_id':'peer-task','agent_id':'r2',**file_record(peer)});packet['task']['input_refs'].append(str(peer))
    if reverse:packet['task']['input_refs'].reverse()
    d,api=self.setup_dispatcher(root);_,h=d.collected_library(packet,'p',root/'projects/p/workspace/out');row=h['items'][0];self.assertEqual(row['read_by'],['r1']);self.assertIn('summary only',row['reading']);self.assertIn('r2',row['notes']);self.assertEqual(d.stats['model_calls'],0);self.assertFalse(any(a=='library_deliver' for a,_ in api.calls))
 def test_peer_reading_requires_matching_independent_evidence(self):
  for case in ['unconfirmed','circular','version','url','catalog','catalog-mismatch','catalog-unread','tampered']:
   with self.subTest(case=case),tempfile.TemporaryDirectory() as td:
    root=Path(td);packet,source,path=self.source_packet(root);source.update(read_by=['r2'],reading='r1 used r2 notes');path.write_text(json.dumps({'sources':[source]}));packet['source_inputs'][0].update(file_record(path));items=[]
    if case.startswith('catalog'):
     items=[{**source,'kind':'paper','revision':1,'project_ids':['previous']}]
     if case=='catalog-mismatch':items[0]['version']='different'
     if case=='catalog-unread':items[0]['read_by']=[]
    if case in ['circular','version','url','tampered']:
     other={**source,'read_by':['r1'] if case=='circular' else ['r2']}
     if case=='version':other['version']='different'
     if case=='url':other['source']='https://example.org/other'
     peer=path.with_name('peer.json');peer.write_text(json.dumps({'sources':[other]}));packet['source_inputs'].append({'task_id':'peer-task','agent_id':'r2',**file_record(peer)});packet['task']['input_refs'].append(str(peer))
     if case=='tampered':peer.write_text(peer.read_text()+' ')
    d,api=self.setup_dispatcher(root,items)
    if case=='catalog':
     _,h=d.collected_library(packet,'p',root/'projects/p/workspace/out');self.assertEqual(h['items'][0]['read_by'],['r2'])
    else:
     with self.assertRaises(ValueError):d.collected_library(packet,'p',root/'projects/p/workspace/out')
    self.assertFalse(any(a=='library_deliver' for a,_ in api.calls));self.assertEqual(d.stats['model_calls'],0)
 def test_reading_status_is_not_a_publication_version(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,source,path=self.source_packet(root);source['version']='PRA 113, 022450 (2026); author-hosted journal PDF';path.write_text(json.dumps({'sources':[source]}));packet['source_inputs'][0].update(file_record(path))
   old={**source,'version':source['version']+', search identity only','kind':'paper','revision':1,'read_by':[],'project_ids':['old'],'reading':'Search excerpts only'}
   d,_=self.setup_dispatcher(root,[old]);_,h=d.collected_library(packet,'p',d.folder('p','collect'));self.assertEqual(h['items'][0]['version'],source['version']);self.assertIn('Search excerpts only',h['items'][0]['reading'])
 def test_same_unpinned_pointer_does_not_claim_a_code_version(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,source,path=self.source_packet(root);source.update(kind='baseline',version='unpinned landing page checked 2026-10-05');path.write_text(json.dumps({'sources':[source]}));packet['source_inputs'][0].update(file_record(path))
   old={**source,'version':'unpinned repository page checked 2026-10-05','revision':1,'read_by':[],'project_ids':['old']};d,_=self.setup_dispatcher(root,[old]);_,h=d.collected_library(packet,'p',d.folder('p','collect'));self.assertEqual(h['items'][0]['version'],'unpinned; checked 2026-10-05');self.assertIn(source['version'],h['items'][0]['notes'])
   old['version']='unpinned repository page checked 2026-10-04';d.api.items=[old]
   with self.assertRaisesRegex(ValueError,'Conflicting'):d.collected_library(packet,'p',d.folder('p','other'))
 def test_collect_no_model_and_catalog_reuse(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,source,path=self.source_packet(root);old={**source,'kind':'paper','revision':9,'project_ids':['old'],'read_by':['r0'],'acquired_by':'r0','summary':'Original summary'}
   d,api=self.setup_dispatcher(root,[old]);d.run_model=lambda *_:self.fail('Model called');d.execute('p',packet)
   out=d.folder('p','collect');h=json.loads((out/'library.json').read_text());row=h['items'][0]
   self.assertEqual(row['expected_revision'],9);self.assertEqual(row['read_by'],['r0','r1']);self.assertEqual(row['project_ids'],['old','p']);self.assertEqual(row['acquired_by'],'r0');self.assertIn(source['summary'],row['summary']);self.assertEqual(h['handoff_id'],'collect');self.assertEqual(d.stats['model_calls'],0);self.assertTrue((out/'receipt.json').exists())
   self.assertEqual([x[0] for x in api.calls],['library_catalog','library_deliver','complete'])
 def test_collect_conflicts_and_artifact_integrity(self):
  for change in ['source','version']:
   with self.subTest(change=change),tempfile.TemporaryDirectory() as td:
    root=Path(td);packet,source,path=self.source_packet(root);old={**source,change:'conflict','revision':1};d,_=self.setup_dispatcher(root,[old])
    with self.assertRaisesRegex(ValueError,'Conflicting'):d.collected_library(packet,'p',d.folder('p','collect'))
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,source,path=self.source_packet(root);d,_=self.setup_dispatcher(root);path.write_text(path.read_text()+' ')
   with self.assertRaisesRegex(ValueError,'hash changed'):d.collected_library(packet,'p',d.folder('p','collect'))
 def test_same_pinned_arxiv_version_accepts_html_abstract_pdf_links(self):
  for link in ['https://arxiv.org/abs/2605.09142v1','https://arxiv.org/pdf/2605.09142v1.pdf']:
   with self.subTest(link=link),tempfile.TemporaryDirectory() as td:
    root=Path(td);packet,source,path=self.source_packet(root);source.update(source=link,version='v1');path.write_text(json.dumps({'sources':[source]}));packet['source_inputs'][0].update(file_record(path))
    old={**source,'source':'https://arxiv.org/html/2605.09142v1','kind':'paper','revision':1,'project_ids':['old']};d,_=self.setup_dispatcher(root,[old]);_,handoff=d.collected_library(packet,'p',d.folder('p','collect'));self.assertEqual(handoff['items'][0]['source'],old['source'])
    d.api.items=[{**old,'source':'https://arxiv.org/html/2605.09142v2','version':'v2'}]
    with self.assertRaisesRegex(ValueError,'Conflicting'):d.collected_library(packet,'p',d.folder('p','other'))
 def test_real_catalog_metadata_is_filtered_from_handoff(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,source,_=self.source_packet(root)
   old={**source,'kind':'paper','revision':12,'project_ids':['old'],'read_by':['r0'],'acquired_by':'r0','created_at':'2026-10-01T00:00:00Z','updated_at':'2026-10-05T00:00:00Z','updated_by':'lib','history':[{'revision':11,'summary':'Earlier record'}],'notes':'Preserved notes','links':[{'label':'Primary source','source':source['source']}],'topics':['Quantum error correction']}
   d,_=self.setup_dispatcher(root,[old]);raw,h=d.collected_library(packet,'p',d.folder('p','collect'));row=h['items'][0]
   self.assertEqual(row['expected_revision'],12)
   for field in ['revision','created_at','updated_at','updated_by','history']:self.assertNotIn(field,row)
   self.assertIn('Preserved notes',row['notes']);self.assertEqual(row['links'],old['links']);self.assertEqual(row['topics'],old['topics'])
   self.assertEqual(json.loads(raw),h)
 def test_missing_source_provenance_fails_before_delivery(self):
  for provenance in [None,[], 'absent']:
   with self.subTest(provenance=provenance),tempfile.TemporaryDirectory() as td:
    root=Path(td);packet,_,_=self.source_packet(root)
    if provenance=='absent':packet.pop('source_inputs')
    else:packet['source_inputs']=provenance
    d,api=self.setup_dispatcher(root);d.run_model=lambda *_:self.fail('Model called')
    with self.assertRaisesRegex(ValueError,'provenance'):d.prepare(packet,'p',d.folder('p','collect'))
    self.assertFalse(any(action=='library_deliver' for action,_ in api.calls));self.assertEqual(d.stats['model_calls'],0)
 def test_library_lost_response_retries_same_handoff_without_model(self):
  for lost_action in ['library_deliver','complete']:
   with self.subTest(lost_action=lost_action),tempfile.TemporaryDirectory() as td:
    root=Path(td);packet,source,_=self.source_packet(root);d,api=self.setup_dispatcher(root)
    d.run_model=lambda *_:self.fail('Model called');original=api.call;lost=[False];sent=[]
    def call(workspace,action,**args):
     if action==lost_action:sent.append(json.loads(json.dumps(args)))
     answer=original(workspace,action,**args)
     if action==lost_action and not lost[0]:
      lost[0]=True
      if action=='library_deliver':api.items=[{**source,'kind':'paper','revision':1,'project_ids':['p'],'read_by':['r1']}]
      raise OSError('Response lost after commit')
     return answer
    api.call=call;d.execute('p',packet);out=d.folder('p','collect');initial=(out/'library.json').read_bytes()
    self.assertFalse((out/'receipt.json').exists())
    if lost_action=='library_deliver':d.execute('p',packet)
    else:d.deliver('p',out)
    self.assertTrue((out/'receipt.json').exists());self.assertEqual((out/'library.json').read_bytes(),initial)
    self.assertEqual(len(sent),2);self.assertEqual(sent[0],sent[1]);self.assertEqual(d.stats['model_calls'],0)
    self.assertEqual(sum(action=='library_catalog' for action,_ in api.calls),1)
 def test_coordination_schema_fresh_no_tools_full_context(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);d,_=self.setup_dispatcher(root);skills=root/'skill/wulab-research';skills.mkdir(parents=True)
   for name in MODEL_FILES:(skills/name).write_text('Fixture instruction')
   packet={'task':{'id':'coordinate','kind':'coordination','input_refs':[]},'agent':{'id':'orchestrator'},'workflow_context':{'phase':'prepare','evidence':'COMPLETE'}}
   out=d.folder('p','coordinate');plan=d.prepare(packet,'p',out)
   self.assertTrue(plan['review']);self.assertIsNone(plan['thread']);self.assertEqual(plan['reset_reason'],'fresh_review');self.assertIn('COMPLETE',plan['prompt'])
   cmd=d.command(out,None,not plan['review'],[])
   for tool in ['shell_tool','code_mode','code_mode_host','view_image']:self.assertIn('features.'+tool+'=false',cmd)
   self.assertIn('workflow_plan',task_schema(packet)['required']);self.assertEqual(task_schema(packet)['properties']['requests']['maxItems'],0)
   result={'requests':[],'workflow_plan':{'action':'advance','next_phase':'critique','summary':'Next','assignments':[{'agent_id':'r1','prompt':'Review','summary':'Review'}],'tie_choice':None,'stop_reason':None}}
   validate_workflow_plan(result);result['workflow_plan']['assignments'][0]['prompt']='x'*7001
   with self.assertRaises(ValueError):validate_workflow_plan(result)
 def test_collect_preserves_tool_category_and_unread_state(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,source,path=self.source_packet(root);source.update(kind='tool',read_by=[],reading='Unread: access failed');path.write_text(json.dumps({'sources':[source]}));packet['source_inputs'][0].update(file_record(path));d,_=self.setup_dispatcher(root);_,h=d.collected_library(packet,'p',d.folder('p','collect'));self.assertEqual(h['items'][0]['kind'],'tool');self.assertEqual(h['items'][0]['read_by'],[])
 def test_collect_preserves_extra_envelope_metadata(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,source,path=self.source_packet(root);meta={'original_searches':6,'followup_searches':0,'followup_papers':1};path.write_text(json.dumps({'sources':[source],'reading_budget':meta}));packet['source_inputs'][0].update(file_record(path));d,_=self.setup_dispatcher(root);_,h=d.collected_library(packet,'p',d.folder('p','collect'));self.assertIn('reading_budget',h['items'][0]['notes']);self.assertIn('followup_searches',h['items'][0]['notes'])
 def test_pinned_version_keeps_qualifications_without_false_conflict(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);packet,source,path=self.source_packet(root);source.update(source='https://arxiv.org/abs/2602.03336v1',version='v1');path.write_text(json.dumps({'sources':[source]}));packet['source_inputs'][0].update(file_record(path));old={**source,'version':'v1 (search pointer only; primary identity unchecked)','kind':'paper','revision':1,'read_by':[],'project_ids':['old']};d,_=self.setup_dispatcher(root,[old]);_,h=d.collected_library(packet,'p',d.folder('p','collect'));self.assertEqual(h['items'][0]['version'],'v1');self.assertEqual(h['items'][0]['expected_revision'],1)
if __name__=='__main__':unittest.main()
