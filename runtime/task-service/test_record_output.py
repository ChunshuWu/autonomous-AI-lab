import json,tempfile,unittest
from pathlib import Path
from dispatcher import Dispatcher
class Tests(unittest.TestCase):
 def test_display_formats_never_repeat_model_work(self):
  cases=[{'schema_version':1,'experiments':[{'id':'x'}]},[{'type':'experiment'}]*9,'{broken-json']
  for records in cases:
   with self.subTest(records=type(records).__name__),tempfile.TemporaryDirectory() as root:
    captured=[]
    class Fake:
     def call(self,ws,action,**args):
      if action=='complete':captured.append(args);return {'delivered':True,'task_id':args['task_id'],'status':'completed'}
      return {'ok':True}
    d=Dispatcher({'lab_root':root,'runner_id':'test','projects':[],'model':'gpt-6.1-sol'},Fake(),Path(root)/'state')
    packet={'task':{'id':'t1','kind':'engineering'},'claim':{'task_id':'t1','runner_id':'test','lease_id':'lease'}}
    def model(packet,ws,out):
     (out/'records.json').write_text(records if isinstance(records,str) else json.dumps(records))
     return {'outcome':'completed','summary':'Saved result','body':'Full saved result','requests':[]}
    d.run_model=model;d.execute('p',packet)
    self.assertEqual(len(captured),1);self.assertEqual(captured[0]['result']['records'],records);self.assertTrue((d.folder('p','t1')/'receipt.json').exists());d.pool.shutdown()
if __name__=='__main__':unittest.main()
