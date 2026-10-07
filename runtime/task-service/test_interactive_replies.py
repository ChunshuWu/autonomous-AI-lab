import concurrent.futures, copy, hashlib, io, json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from dispatcher import Dispatcher, MODEL_FILES, atomic
from test_dispatcher import FakeAPI

class Queue(FakeAPI):
 def __init__(self):
  super().__init__();self.packets={};self.claims=[];self.failed=[]
 def add(self,name,reply=False,bad=False):
  self.packets[name]={'task':{'id':name,'kind':'question' if reply else 'research','interactive_reply':reply,'input_refs':[]},'agent':{'id':name,'role':'researcher'},'bad':bad}
 def call(self,w,action,**p):
  if action=='poll':return {'ready':[{'id':k,'interactive_reply':v['task']['interactive_reply']} for k,v in self.packets.items() if k not in self.claims and k not in self.failed]}
  if action=='preview':return {**self.packets[p['task_id']],'team':[v['agent'] for v in self.packets.values()]}
  if action=='claim':self.claims.append(p['task_id']);return self.packets[p['task_id']]
  if action=='preflight_fail':self.failed.append(p['task_id']);return {}
  return super().call(w,action,**p)
class Pool:
 def __init__(self):self.jobs={}
 def submit(self,fn,workspace,packet):
  future=concurrent.futures.Future();self.jobs[packet['task']['id']]=future;return future
 def set_team(self,*_):pass
 def shutdown(self,wait=True):pass

class ReplyTests(unittest.TestCase):
 def config(self,root):return {'lab_root':str(root),'runner_id':'fixture','projects':['p'],'model':'gpt-6.1-sol','codex_bin':'unused'}
 def test_replies_to_different_agents_run_with_all_ready_researchers(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);api=Queue();d=Dispatcher(self.config(root),api,root/'state');d.pool.shutdown();d.pool=Pool();d.prepare=lambda *_:{'report':{}}
   for i in range(1,9):api.add(f'r{i}')
   d.tick();self.assertEqual(api.claims,[f'r{i}' for i in range(1,9)])
   api.add('q1',reply=True);api.add('q2',reply=True);d.tick()
   self.assertEqual(api.claims[-2:],['q1','q2']);self.assertTrue(all(not job.done() for job in d.pool.jobs.values()))
   state=json.loads((root/'state/service-status.json').read_text());self.assertEqual(state['active'],10);self.assertEqual(state['active_replies'],2)
   d.tick();self.assertEqual(len(api.claims),10);self.assertEqual(d.stats['model_calls'],0)
 def test_bad_research_packet_does_not_block_a_ready_director_reply(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);api=Queue();d=Dispatcher(self.config(root),api,root/'state');d.pool.shutdown();d.pool=Pool()
   api.add('bad',bad=True);api.add('question',reply=True)
   def prepare(packet,*_):
    if packet.get('bad'):raise ValueError('Missing research evidence')
    return {'report':{}}
   d.prepare=prepare;d.tick();self.assertEqual(api.failed,['bad']);self.assertEqual(api.claims,['question'])
 def test_all_roles_start_together_without_waiting_for_a_worker_slot(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);api=Queue();d=Dispatcher(self.config(root),api,root/'state');d.pool.shutdown();d.pool=Pool();d.prepare=lambda *_:{'report':{}}
   roles=['researcher']*8+['engineer','mathematician','librarian','orchestrator']
   kinds={'researcher':'research','engineer':'engineering','mathematician':'mathematics','librarian':'library','orchestrator':'coordination'}
   for i,role in enumerate(roles):
    name=f'worker-{i}';api.add(name);api.packets[name]['agent']['role']=role;api.packets[name]['task']['kind']=kinds[role]
   d.tick();self.assertEqual(len(api.claims),len(roles));self.assertEqual(len(d.active),len(roles))
   api.add('question',reply=True);d.tick();self.assertEqual(api.claims[-1],'question')
   self.assertTrue(all(not job.done() for job in d.pool.jobs.values()))
   for job in d.pool.jobs.values():job.set_result(None)
   d.tick();self.assertEqual(len(d.active),0);self.assertFalse(d.active_lanes)
   self.assertEqual(d.stats['model_calls'],0)
 def test_failure_to_start_a_thread_is_reported_for_the_claimed_task(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);api=Queue();d=Dispatcher(self.config(root),api,root/'state');self.addCleanup(d.pool.shutdown);d.prepare=lambda *_:{'report':{}}
   api.add('r1');api.packets['r1']['claim']={'task_id':'r1','runner_id':'fixture','lease_id':'lease'}
   with patch.object(d.pool,'submit',side_effect=RuntimeError('No thread available')),patch.object(api,'call',wraps=api.call) as calls:
    d.tick()
   failures=[c for c in calls.call_args_list if c.args[1]=='fail']
   self.assertEqual(len(failures),1);self.assertEqual(failures[0].kwargs['task_id'],'r1');self.assertIn('Could not start',failures[0].kwargs['error']);self.assertFalse(d.active)
 def test_readonly_reply_cannot_overwrite_the_research_session(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);skills=root/'skill/wulab-research';skills.mkdir(parents=True)
   for name in MODEL_FILES:(skills/name).write_text('Saved research model.')
   d=Dispatcher(self.config(root),FakeAPI(),root/'state');self.addCleanup(d.pool.shutdown)
   session=root/'state/sessions'/(hashlib.sha256(b'p:r').hexdigest()+'.json')
   atomic(session,{'thread_id':'research-in-progress','summary':'Saved research summary','research_handoff':{'task_id':'old-research','text':'Saved evidence.'}});before=session.read_bytes()
   packet={'task':{'id':'q','kind':'question','interactive_reply':True,'input_refs':[]},'agent':{'id':'r','role':'researcher'},'claim':{'task_id':'q','runner_id':'fixture','lease_id':'lease'},'active_work':[{'task_id':'research-now','summary':'Still running'}]}
   answer={'outcome':'completed','summary':'Answered','body':'An operation is one circuit instruction.','requests':[],'document':None}
   events=[{'type':'thread.started','thread_id':'separate-reply'},{'type':'item.completed','item':{'type':'agent_message','text':json.dumps(answer)}},{'type':'turn.completed','usage':{'input_tokens':100,'output_tokens':20}}]
   class Process:
    def __init__(self):self.stdin=io.StringIO();self.stdout=io.StringIO(''.join(json.dumps(e)+'\n' for e in events));self.stderr=io.StringIO()
    def wait(self,timeout=None):return 0
    def poll(self):return 0
   out=root/'out';out.mkdir()
   with patch('dispatcher.subprocess.Popen',return_value=Process()):result=d.run_model(packet,'p',out)
   self.assertEqual(session.read_bytes(),before);self.assertEqual(result['session_id'],'separate-reply');self.assertEqual(result['session_mode'],'fresh_review')
   self.assertIn('separate read-only session',(out/'prompt.txt').read_text());self.assertIn('Every registered team member can work at the same time',(out/'prompt.txt').read_text())
   self.assertNotIn('resume',d.command(out,None,False,[]))
if __name__=='__main__':unittest.main()
