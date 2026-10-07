import io,json,tempfile,unittest,urllib.error
from pathlib import Path
from unittest.mock import patch
from dispatcher import API,Dispatcher,DeliveryRejected,atomic
class Tests(unittest.TestCase):
 def test_server_reason_is_preserved(self):
  with tempfile.TemporaryDirectory() as root:
   p=Path(root)/'connection.json';p.write_text(json.dumps({'url':'https://example.test','runner_token':'fake'}))
   e=urllib.error.HTTPError('https://example.test',400,'Bad request',{},io.BytesIO(b'{"error":"A useful validation reason"}'))
   with patch('dispatcher.urllib.request.urlopen',side_effect=e):
    with self.assertRaisesRegex(DeliveryRejected,'A useful validation reason'):API(p).call('test','complete')
 def test_rejection_is_reported_and_not_retried_forever(self):
  with tempfile.TemporaryDirectory() as root:
   calls=[]
   class Fake:
    def call(self,ws,action,**args):
     calls.append((action,args))
     if action=='complete':raise DeliveryRejected(400,'Task service HTTP 400: Invalid vote candidate')
     if action=='poll':return {'ready':[]}
     return {'ok':True}
   d=Dispatcher({'lab_root':root,'runner_id':'test','projects':['test'],'model':'gpt-6.1-sol'},Fake(),Path(root)/'state')
   packet={'task':{'id':'t1','kind':'vote'},'claim':{'task_id':'t1','runner_id':'test','lease_id':'original'}}
   d.run_model=lambda *args:{'outcome':'completed','summary':'Saved output','body':'Invalid test content','requests':[]}
   d.execute('test',packet);out=d.folder('test','t1')
   self.assertTrue((out/'result.json').exists());self.assertTrue((out/'delivery.json').exists())
   self.assertTrue(json.loads((out/'delivery-error.json').read_text())['permanent'])
   self.assertTrue(any(a=='fail' and 'Invalid vote candidate' in p['error'] for a,p in calls))
   d.tick();d.tick();self.assertEqual(sum(a=='complete' for a,p in calls),1);d.pool.shutdown()
if __name__=='__main__':unittest.main()
