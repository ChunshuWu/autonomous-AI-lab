import json,tempfile,unittest
from pathlib import Path
from dispatcher import Dispatcher,atomic,compact_review_body
class FakeAPI:
 def __init__(self):self.completed=0;self.polls=0;self.fail_delivery=True
 def call(self,workspace,action,**p):
  if action=='poll':self.polls+=1;return {'ready':[]}
  if action=='complete':
   if self.fail_delivery:self.fail_delivery=False;raise OSError('lost response')
   self.completed+=1;return {'delivered':True,'task_id':p['task_id'],'status':'completed'}
  return {'ok':True}
class Tests(unittest.TestCase):
 def test_long_meeting_reply_preserves_all_text_without_model(self):
  original={'outcome':'completed','summary':'Four useful concerns.','body':'Complete peer concern. '*200,'document':'Further evidence.','requests':[]}
  result=compact_review_body(original,'meeting')
  self.assertEqual(result['body'],original['summary']);self.assertEqual(result['document'],original['body']+'\n\n---\n\n'+original['document'])
  self.assertEqual(compact_review_body(result,'meeting'),result)
  self.assertEqual(original['document'],'Further evidence.')
 def test_vote_json_is_never_replaced_by_summary(self):
  original={'summary':'Vote','body':json.dumps({'choice':'p1','reason':'Evidence','response':'x'*3200}),'document':None}
  self.assertEqual(compact_review_body(original,'vote'),original)
 def test_long_reply_preserves_full_document(self):
  original={'summary':'Summary','body':'a'*30001,'document':None}
  self.assertEqual(compact_review_body(original,'meeting')['document'],original['body'])
 def test_idle_and_delivery_recovery(self):
  with tempfile.TemporaryDirectory() as root:
   api=FakeAPI();c={'lab_root':root,'runner_id':'test','projects':['check'],'model':'gpt-6.1-sol','codex_bin':'unused'};d=Dispatcher(c,api,Path(root)/'state')
   for i in range(3):d.tick()
   self.assertEqual(d.stats['model_calls'],0)
   packet={'task':{'id':'t1','kind':'question'},'claim':{'task_id':'t1','lease_id':'lease','runner_id':'test'}};calls=[]
   def model(*args):calls.append(1);return {'outcome':'completed','summary':'A saved answer','body':'The answer','requests':[],'usage':{}}
   d.run_model=model;d.execute('check',packet)
   out=d.folder('check','t1');self.assertTrue((out/'delivery.json').exists());self.assertFalse((out/'receipt.json').exists())
   d.tick();self.assertEqual(len(calls),1);self.assertTrue((out/'receipt.json').exists());d.tick();self.assertEqual(api.completed,1)
   d.pool.shutdown()
 def test_no_credentials_in_child_environment_contract(self):
  with tempfile.TemporaryDirectory() as root:
   d=Dispatcher({'lab_root':root,'runner_id':'test','projects':[],'codex_bin':'/x/codex','model':'gpt-6.1-sol'},FakeAPI(),root)
   cmd=d.command(Path(root),'thread-123',False,[])
   self.assertIn('resume',cmd);self.assertIn('thread-123',cmd);self.assertIn('features.shell_tool=false',cmd);self.assertIn('approval_policy="never"',cmd);d.pool.shutdown()
if __name__=='__main__':unittest.main()
