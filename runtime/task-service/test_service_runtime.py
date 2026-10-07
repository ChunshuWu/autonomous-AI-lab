import copy,json,tempfile,unittest,hashlib,io,os,subprocess
from unittest.mock import patch
from dispatcher import API
from pathlib import Path
from dispatcher import Dispatcher,MODEL_FILES,atomic,worker_environment
from test_dispatcher import FakeAPI

class LibraryAPI(FakeAPI):
 def __init__(self):super().__init__();self.deliveries={}
 def call(self,w,action,**p):
  if action=='library_deliver':
   h=p['handoff'];key=h['handoff_id'];prior=self.deliveries.get(key)
   if prior:assert prior['handoff']==h
   else:self.deliveries[key]={'handoff':copy.deepcopy(h),'receipt':{'handoff_id':key,'status':'delivered','items':[{'id':x['id'],'revision':1} for x in h['items']]}}
   return self.deliveries[key]['receipt']
  return super().call(w,action,**p)

class RuntimeTests(unittest.TestCase):
 def test_bundled_search_tool_works_in_worker_login_shell_without_secrets(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);tool=root/'rg';tool.write_text('#!/bin/sh\nprintf "bundled search tool\\n"\n');tool.chmod(0o755)
   with patch.dict(os.environ,{'HOME':td,'PATH':'/usr/bin:/bin','PRIVATE_RUNNER_TOKEN':'must-not-leak'},clear=True):env=worker_environment(root/'codex')
   result=subprocess.run(['/bin/bash','-lc','rg --version'],env=env,text=True,capture_output=True)
   self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(result.stdout.strip(),'bundled search tool');self.assertNotIn('PRIVATE_RUNNER_TOKEN',env);self.assertIn('/usr/bin',env['PATH'].split(os.pathsep))
 def setup_lab(self,root):
  skills=root/'skill/wulab-research';skills.mkdir(parents=True)
  for name in MODEL_FILES:(skills/name).write_text('Original shared research model.')
  return {'lab_root':str(root),'runner_id':'fixture','projects':['p'],'model':'gpt-6.1-sol','codex_bin':'unused'},skills
 def packet(self,kind='meeting'):
  return {'task':{'id':'q','kind':kind,'input_refs':[]},'agent':{'id':'r','role':'researcher'}}
 def test_lost_heartbeat_retries_once_without_repeating_other_actions(self):
  with tempfile.TemporaryDirectory() as td:
   credentials=Path(td)/'connection.json';credentials.write_text(json.dumps({'url':'https://fixture.invalid','runner_token':'fixture'}));api=API(credentials)
   with patch('dispatcher.urllib.request.urlopen',side_effect=[TimeoutError('temporary'),io.BytesIO(b'{"ok":true,"result":{"ok":true}}')]) as send:
    self.assertEqual(api.call('p','renew',task_id='task',lease_id='lease'),{'ok':True});self.assertEqual(send.call_count,2);self.assertIs(send.call_args_list[0].args[0],send.call_args_list[1].args[0])
   for action,count in [('renew',2),('claim',1),('complete',1)]:
    with self.subTest(action=action),patch('dispatcher.urllib.request.urlopen',side_effect=TimeoutError('still unavailable')) as send:
     with self.assertRaises(TimeoutError):api.call('p',action,task_id='task')
     self.assertEqual(send.call_count,count)
 def test_pinned_models_survive_edits_and_restart(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);c,skills=self.setup_lab(root);d=Dispatcher(c,FakeAPI(),root/'state');first=d.instructions('p');(skills/'research.md').write_text('New version for a later run.')
   self.assertEqual(first[0],d.instructions('p')[0]);d.pool.shutdown();again=Dispatcher(c,FakeAPI(),root/'state');self.assertEqual(first[0],again.instructions('p')[0]);again.pool.shutdown()
   later=Dispatcher({**c,'instruction_runs':{'p':'next'}},FakeAPI(),root/'state');self.assertNotEqual(first[1],later.instructions('p')[1]);later.pool.shutdown()
 def test_review_has_complete_saved_handoff_but_no_browser_session(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);c,_=self.setup_lab(root);d=Dispatcher(c,FakeAPI(),root/'state');packet=self.packet();key=hashlib.sha256(b'p:r').hexdigest();handoff={'task_id':'reading-1','summary':'My specialty summary','text':'Complete saved scientific notes.'}
   atomic(root/'state/sessions'/(key+'.json'),{'thread_id':'long-browser-session','summary':'Reading done','research_handoff':handoff})
   plan=d.prepare(packet,'p',root/'out');data=json.JSONDecoder().raw_decode(plan['prompt'])[0];self.assertIsNone(plan['thread']);self.assertEqual(data['research_handoff'],handoff);self.assertEqual(plan['reset_reason'],'fresh_review')
   packet['documents']=[{'task_id':'reading-1','text':handoff['text']}];data=json.JSONDecoder().raw_decode(d.prepare(packet,'p',root/'out')['prompt'])[0];self.assertIsNone(data['research_handoff']);d.pool.shutdown()
 def test_missing_evidence_rejects_before_claim_or_model(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);c,_=self.setup_lab(root);packet=self.packet();packet['task']['kind']='question';packet['task']['input_refs']=[str(root/'missing-evidence.md')]
   class Queue(FakeAPI):
    def __init__(self):super().__init__();self.failed=[];self.claims=[]
    def call(self,w,a,**p):
     if a=='poll':return {'ready':[{'id':'q'}]}
     if a=='preview':return packet
     if a=='preflight_fail':self.failed.append(p);return {}
     if a=='claim':self.claims.append(p);raise AssertionError('Must not claim missing evidence')
     return super().call(w,a,**p)
   api=Queue();d=Dispatcher(c,api,root/'state');d.tick();self.assertEqual(d.stats['model_calls'],0);self.assertFalse(api.claims);self.assertEqual(len(api.failed),1);d.pool.shutdown()
 def test_coordination_packet_size_warns_without_losing_evidence(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);c,_=self.setup_lab(root);d=Dispatcher(c,FakeAPI(),root/'state');packet=self.packet('coordination');packet['workflow_context']={'completed':[{'text':'evidence '*130000}]}
   plan=d.prepare(packet,'p',root/'out');self.assertTrue(plan['report']['size_warnings']);data=json.JSONDecoder().raw_decode(plan['prompt'])[0];self.assertEqual(data['CURRENT_TASK']['workflow_context'],packet['workflow_context']);self.assertEqual(d.stats['model_calls'],0);d.pool.shutdown()
 def test_one_mb_warning_boundary_counts_bytes_without_blocking(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);c,_=self.setup_lab(root);d=Dispatcher(c,FakeAPI(),root/'state');self.addCleanup(d.pool.shutdown)
   packet=self.packet('research');packet['documents']=[{'text':'x'*92000}]
   plan=d.prepare(packet,'p',root/'out');self.assertFalse(plan['report']['size_warnings']);self.assertTrue(all(v==1000000 for v in plan['report']['limits_bytes'].values()))
   text='x'*(1000000-plan['report']['sizes_bytes']['fresh_prompt']+92000);packet['documents'][0]['text']=text
   plan=d.prepare(packet,'p',root/'out');self.assertEqual(plan['report']['sizes_bytes']['fresh_prompt'],1000000);self.assertFalse(plan['report']['size_warnings'])
   packet['documents'][0]['text']+='猫';plan=d.prepare(packet,'p',root/'out');self.assertEqual(plan['report']['sizes_bytes']['fresh_prompt'],1000003);self.assertEqual(len(plan['report']['size_warnings']),1)
   data=json.JSONDecoder().raw_decode(plan['prompt'])[0];self.assertEqual(data['CURRENT_TASK']['documents'],packet['documents']);self.assertEqual(d.stats['model_calls'],0)
 def test_review_file_is_complete_or_rejected(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);c,_=self.setup_lab(root);d=Dispatcher(c,FakeAPI(),root/'state');p=root/'projects/p/workspace/findings.md';p.parent.mkdir(parents=True);p.write_text('Evidence '*1000+'Last sentence.')
   packet=self.packet();packet['task']['input_refs']=[str(p)];plan=d.prepare(packet,'p',root/'out');self.assertEqual(plan['notes'][0]['text'],p.read_text());self.assertFalse(plan['notes'][0]['truncated'])
   p.unlink();self.assertRaisesRegex(ValueError,'Review input is missing',d.prepare,packet,'p',root/'out');d.pool.shutdown()
 def test_script_library_delivery_and_retry_use_zero_models(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);c,_=self.setup_lab(root);api=LibraryAPI();d=Dispatcher(c,api,root/'state');path=root/'projects/p/workspace/librarian/handoff.json';path.parent.mkdir(parents=True)
   h={'schema_version':1,'handoff_id':'sources','items':[{'id':'paper','expected_revision':0,'kind':'paper','title':'Saved source','summary':'Authored by its reader','source':'https://example.org/paper','version':'v1','project_ids':['p'],'read_by':['r'],'reading':'Abstract only','availability':'Partial','checks':'Not reproduced'}]};path.write_text(json.dumps(h))
   packet={'task':{'id':'catalog','kind':'library','handler':'library_delivery','input_refs':[str(path)]},'agent':{'id':'lib','role':'librarian'},'claim':{'task_id':'catalog','runner_id':'fixture','lease_id':'lease'}}
   d.run_model=lambda *_:self.fail('Bookkeeping must not call a model');d.execute('p',packet);out=d.folder('p','catalog');self.assertFalse((out/'receipt.json').exists());d.tick();self.assertTrue((out/'receipt.json').exists());self.assertEqual(len(api.deliveries),1);self.assertEqual(d.stats['model_calls'],0)
   self.assertEqual(json.loads((out/'library.json').read_text()),h);self.assertEqual(json.loads((out/'result.json').read_text())['usage']['input_tokens'],0)
   bad=copy.deepcopy(packet);bad['task']['input_refs']=[str(root/'outside.json')];(root/'outside.json').write_text(json.dumps(h));self.assertRaisesRegex(ValueError,'inside this project',d.prepared_library,bad,'p');d.pool.shutdown()
if __name__=='__main__':unittest.main()
