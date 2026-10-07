import sys,json,tempfile,unittest
from pathlib import Path
sys.dont_write_bytecode=True
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import test_workflow_dispatcher as fixtures
from dispatcher import file_record
class EmptySources(unittest.TestCase):
 setup_dispatcher=fixtures.WorkflowTests.setup_dispatcher
 source_packet=fixtures.WorkflowTests.source_packet
 def test_empty_and_mixed_source_lists(self):
  for mixed in [False,True]:
   with self.subTest(mixed=mixed),tempfile.TemporaryDirectory() as td:
    root=Path(td);p,source,path=self.source_packet(root)
    path.write_text(json.dumps({'sources':[]}));p['source_inputs'][0].update(file_record(path))
    if mixed:
     other=path.with_name('peer.json');other.write_text(json.dumps({'sources':[source]}));p['source_inputs'].append({'task_id':'other','agent_id':'r2',**file_record(other)});p['task']['input_refs'].append(str(other))
    d,api=self.setup_dispatcher(root);d.run_model=lambda *_:self.fail('An empty source update must not call a model')
    d.execute('p',p);out=d.folder('p','collect');h=json.loads((out/'library.json').read_text())
    self.assertEqual(len(h['items']),int(mixed));self.assertTrue((out/'receipt.json').exists());self.assertEqual(d.stats['model_calls'],0)
    self.assertEqual(json.loads(path.read_text()),{'sources':[]})
if __name__=='__main__':unittest.main()
