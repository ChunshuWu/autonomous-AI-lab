import threading, unittest
from unittest.mock import patch
from dispatcher import TeamWorkers

class ParallelWorkerTests(unittest.TestCase):
 def packet(self,agent,reply=False):return {'agent':{'id':agent},'task':{'interactive_reply':reply}}
 def test_entire_registered_team_and_their_replies_start_together(self):
  workers=TeamWorkers();release=threading.Event();changed=threading.Condition();started=[]
  agents=[{'id':str(i)} for i in range(8)];workers.set_team('p',agents)
  def job(workspace,packet):
   with changed:started.append(packet);changed.notify_all()
   release.wait();return packet
  packets=[self.packet(a['id'],reply) for a in agents for reply in [False,True]]
  try:
   futures=[workers.submit(job,'p',p) for p in packets]
   with changed:self.assertTrue(changed.wait_for(lambda:len(started)==16,timeout=5))
   self.assertTrue(all(not future.done() for future in futures))
   self.assertEqual(len(workers.pools),16)
   with self.assertRaisesRegex(RuntimeError,'already has a worker'):workers.submit(job,'p',packets[0])
   with self.assertRaisesRegex(RuntimeError,'registered project team'):workers.submit(job,'p',self.packet('unknown'))
  finally:release.set();workers.shutdown()
  self.assertEqual([future.result() for future in futures],packets);self.assertFalse(workers.busy)
  with self.assertRaisesRegex(RuntimeError,'shutting down'):workers.submit(job,'p',packets[0])
 def test_roster_changes_remove_old_pools_and_allow_new_members(self):
  workers=TeamWorkers();workers.set_team('p',[{'id':'old'}])
  try:
   workers.submit(lambda *_:None,'p',self.packet('old')).result(timeout=5)
   workers.set_team('p',[{'id':'new'}])
   self.assertFalse(workers.pools)
   with self.assertRaisesRegex(RuntimeError,'registered project team'):workers.submit(lambda *_:None,'p',self.packet('old'))
   self.assertEqual(workers.submit(lambda *_:'new result','p',self.packet('new')).result(timeout=5),'new result')
  finally:workers.shutdown()
 def test_worker_failure_does_not_stop_other_workers(self):
  workers=TeamWorkers();workers.set_team('p',[{'id':'failed'},{'id':'good'}])
  def fail(*_):raise ValueError('Worker failed')
  try:
   failed=workers.submit(fail,'p',self.packet('failed'));succeeded=workers.submit(lambda *_:'saved result','p',self.packet('good'))
   with self.assertRaisesRegex(ValueError,'Worker failed'):failed.result(timeout=5)
   self.assertEqual(succeeded.result(timeout=5),'saved result')
  finally:workers.shutdown()
 def test_failed_thread_start_cannot_leave_a_hidden_task_to_run_later(self):
  workers=TeamWorkers();workers.set_team('p',[{'id':'r'}]);ran=[]
  try:
   with patch('threading.Thread.start',side_effect=RuntimeError('No threads available')):
    with self.assertRaisesRegex(RuntimeError,'No threads available'):workers.submit(lambda *_:ran.append('old'),'p',self.packet('r'))
   self.assertFalse(workers.pools);self.assertFalse(workers.busy)
   workers.submit(lambda *_:ran.append('new'),'p',self.packet('r')).result(timeout=5)
   self.assertEqual(ran,['new'])
  finally:workers.shutdown()

if __name__=='__main__':unittest.main()
