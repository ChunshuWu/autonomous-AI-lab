import tempfile, unittest, json, hashlib, copy
from pathlib import Path
from dispatcher import Dispatcher,MODEL_FILES,atomic,file_record
from test_dispatcher import FakeAPI
class EngineeringAccess(unittest.TestCase):
 def test_engineering_gets_only_configured_read_access(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);skills=root/'skill/wulab-research';skills.mkdir(parents=True)
   for name in MODEL_FILES:(skills/name).write_text('Research instructions.')
   paths=[str(root/'decoder-env'),str(root/'projects/p/workspace/coordination'),str(root/'datasets')]
   d=Dispatcher({'lab_root':str(root),'runner_id':'fixture','projects':[],'model':'gpt-6.1-sol','codex_bin':'unused','engineering_read_paths':paths},FakeAPI(),root/'state');self.addCleanup(d.pool.shutdown)
   for kind in ['engineering','research','question']:
    packet={'task':{'id':'t','kind':kind,'input_refs':[]},'agent':{'id':'a','role':'engineer' if kind=='engineering' else 'researcher'}}
    plan=d.prepare(packet,'p',root/'out');read=d.worker_read_paths(plan)
    self.assertIn(str(root/'data/catalog'),read)
    self.assertNotIn(str(root/'data'),read)
    self.assertEqual(all(p in read for p in paths),kind=='engineering')
    if kind=='engineering':
     command=d.command(root/'out',None,True,read);table=next(x for x in command if x.startswith('permissions.wulab-task.filesystem='))
     for p in paths:self.assertIn('"'+p+'"="read"',table)
     self.assertIn('"'+str(root/'out')+'"="write"',table)
 def test_completed_experiment_reuse_is_read_only_and_checked_before_call(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);skills=root/'skill/wulab-research';skills.mkdir(parents=True)
   for name in MODEL_FILES:(skills/name).write_text('Research instructions.')
   d=Dispatcher({'lab_root':str(root),'runner_id':'fixture','projects':[],'model':'gpt-6.1-sol','codex_bin':'unused'},FakeAPI(),root/'state');self.addCleanup(d.pool.shutdown)
   old=d.folder('p','old');old.mkdir(parents=True);code=old/'experiment.py';code.write_text('print("saved work")')
   records=[file_record(code)];source={'task_id':'old','completion_id':'old:result','artifacts':records}
   atomic(old/'delivery.json',{'task_id':'old','completion_id':'old:result','result':{'outcome':'completed','artifacts':records}})
   atomic(old/'receipt.json',{'task_id':'old','status':'completed','delivered':True})
   packet={'task':{'id':'new','kind':'engineering','input_refs':[]},'agent':{'id':'engineer'},'reusable_outputs':[source]}
   out=d.folder('p','new');plan=d.prepare(packet,'p',out);read=d.worker_read_paths(plan)
   self.assertIn(str(old),read);self.assertNotIn(str(old.parent),read);self.assertIn(str(old),plan['prompt'])
   command=d.command(out,None,True,read);table=next(x for x in command if x.startswith('permissions.wulab-task.filesystem='));self.assertIn('"'+str(old)+'"="read"',table);self.assertIn('"'+str(out)+'"="write"',table)
   research=copy.deepcopy(packet);research['task']['kind']='research';self.assertEqual(d.engineering_inputs(research,'p')[0]['path'],str(old))
   review=copy.deepcopy(packet);review['task']['kind']='meeting';plan=d.prepare(review,'p',out)
   self.assertTrue(plan['review']);self.assertTrue(plan['tools_enabled']);self.assertFalse(plan['allow_search']);self.assertIsNone(plan['thread']);self.assertIn('read-only',plan['prompt'])
   cmd=d.command(out,None,plan['tools_enabled'],d.worker_read_paths(plan),allow_search=plan['allow_search']);self.assertIn('features.shell_tool=true',cmd);self.assertIn('web_search="disabled"',cmd)
   review.pop('reusable_outputs');plan=d.prepare(review,'p',out);self.assertFalse(plan['tools_enabled']);self.assertNotIn(str(old),d.worker_read_paths(plan))
   with self.assertRaises(FileNotFoundError):d.prepare(packet,'other-project',out)
   bad=copy.deepcopy(packet);bad['reusable_outputs'][0]['completion_id']='wrong'
   with self.assertRaisesRegex(ValueError,'matching completed delivery'):d.prepare(bad,'p',out)
   atomic(old/'delivery.json',{'task_id':'old','completion_id':'old:result','result':{'outcome':'blocked','artifacts':records}})
   atomic(old/'receipt.json',{'task_id':'old','status':'failed','delivered':True})
   provisional=d.prepare(packet,'p',out)
   self.assertIn('provisional',provisional['reusable_work'][0]['scientific_status'])
   self.assertGreater(provisional['report']['input_optimization']['file_metadata_bytes_removed'],0)
   self.assertNotIn(records[0]['sha256'],provisional['prompt'])
   code.write_text('changed')
   with self.assertRaisesRegex(ValueError,'missing or changed'):d.prepare(packet,'p',out)
   self.assertEqual(d.stats['model_calls'],0)
if __name__=='__main__':unittest.main()
