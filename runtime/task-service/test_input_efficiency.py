import copy,hashlib,json,tempfile,unittest
from pathlib import Path
from dispatcher import Dispatcher,MODEL_FILES,RULES,atomic,prompt_packet,task_schema
from test_dispatcher import FakeAPI

class InputEfficiencyTests(unittest.TestCase):
 def setup_lab(self,root):
  skills=root/'skill/wulab-research';skills.mkdir(parents=True)
  for name in MODEL_FILES:(skills/name).write_text('Complete model '+name+'\nQuoted: "猫"\n')
  d=Dispatcher({'lab_root':str(root),'runner_id':'fixture','projects':[],'model':'gpt-6.1-sol','codex_bin':'unused','web_search':'live','worker_tools_note':'Use python3; python and rg are unavailable.'},FakeAPI(),root/'state')
  self.addCleanup(d.pool.shutdown)
  return d
 def packet(self,kind='vote'):
  return {'task':{'id':'t','kind':kind,'input_refs':[]},'agent':{'id':'r','role':'researcher'},'scope':'Original scope. '*300,'workflow_context':{'resource_brief':'Original scope. '*300},'decision_packet':{'criteria':'Choose the next useful check','candidates':[{'id':'p1','task_id':'candidate-1','completion_id':'version-2','body':'Full candidate body.','document':'Full necessary evidence.\nIncluding the end.'}]},'documents':[{'task_id':'review-1','text':'Full peer critique.\nIncluding the end.'}]}
 def test_only_identical_scope_is_referenced_and_original_stays_intact(self):
  packet=self.packet();original=copy.deepcopy(packet);packed=prompt_packet(packet)
  self.assertEqual(packet,original)
  self.assertIn('CURRENT_TASK.workflow_context.resource_brief',packed['scope'])
  self.assertEqual(packed['workflow_context']['resource_brief'],original['scope'])
  self.assertEqual({**packed,'scope':packed['workflow_context']['resource_brief']},original)
  packet['scope']+='Different constraint.'
  self.assertEqual(prompt_packet(packet),packet)
  packet['scope']='Short';packet['workflow_context']['resource_brief']='Short'
  self.assertEqual(prompt_packet(packet),packet)
 def test_fresh_prefix_and_full_decision_evidence(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);d=self.setup_lab(root);packet=self.packet();original=copy.deepcopy(packet)
   p=d.prepare(packet,'p',root/'out');data=json.loads(p['prompt'])
   self.assertEqual(list(data)[:2],['SHARED_INSTRUCTIONS','WORKER_TOOLS'])
   self.assertEqual(data['SHARED_INSTRUCTIONS'],p['models'])
   for key in ['decision_packet','documents','workflow_context']:
    self.assertEqual(data['CURRENT_TASK'][key],original[key])
   self.assertEqual(p['receipt'],[{'id':'p1','task_id':'candidate-1','completion_id':'version-2'}])
   packet['task']['id']='a different task';second=d.prepare(packet,'p',root/'out2')
   self.assertEqual(p['prompt'].split(',"CURRENT_TASK":')[0],second['prompt'].split(',"CURRENT_TASK":')[0])
   self.assertEqual(d.stats['model_calls'],0)
 def test_resumed_research_keeps_session_and_does_not_resend_models(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);d=self.setup_lab(root);packet=self.packet('research');models=d.instructions('p')[0]
   digest=hashlib.sha256((models+RULES+json.dumps(task_schema(packet))).encode()).hexdigest()
   path=root/'state/sessions'/(hashlib.sha256(b'p:r').hexdigest()+'.json')
   saved={'thread_id':'keep-this-thread','model_hash':digest,'usage_version':2,'session_usage':{'input_tokens':10},'turns':2,'summary':'Saved progress'}
   atomic(path,saved);p=d.prepare(packet,'p',root/'out');data=json.loads(p['prompt'])
   self.assertEqual(p['thread'],'keep-this-thread');self.assertIsNone(p['reset_reason'])
   self.assertNotIn('SHARED_INSTRUCTIONS',data);self.assertEqual(json.loads(path.read_text()),saved)
   self.assertEqual(p['digest'],digest);self.assertEqual(p['report']['input_optimization']['sent_bytes'],len(p['prompt'].encode()))
 def test_tools_note_matches_review_and_search_settings(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);d=self.setup_lab(root)
   def note(kind):return json.loads(d.prepare(self.packet(kind),'p',root/'out')['prompt'])['WORKER_TOOLS']
   self.assertIn('No shell or web tools',note('meeting'))
   research=note('research');self.assertIn('Shell network access is disabled',research);self.assertIn('Use the web tool',research);self.assertIn('python3',research)
   d.config['web_search']='disabled';research=note('research');self.assertIn('Web search is disabled',research);self.assertNotIn('Use the web tool',research)
 def test_shared_papers_are_read_only_and_review_tools_stay_disabled(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);d=self.setup_lab(root);d.config['local_paper_library']=True
   plan=d.prepare(self.packet('research'),'p',root/'out');paths=d.worker_read_paths(plan)
   self.assertIn(str(root/'library'),paths);self.assertIn(str(root/'runtime/library'),paths)
   command=d.command(root/'out',None,True,paths);table=next(x for x in command if x.startswith('permissions.wulab-task.filesystem='))
   self.assertIn(json.dumps(str(root/'library'))+'="read"',table);self.assertIn(json.dumps(str(root/'out'))+'="write"',table)
   review=d.prepare(self.packet('meeting'),'p',root/'out');self.assertNotIn(str(root/'library'),d.worker_read_paths(review));self.assertIn('features.shell_tool=false',d.command(root/'out',None,False,d.worker_read_paths(review)))

if __name__=='__main__':unittest.main()
