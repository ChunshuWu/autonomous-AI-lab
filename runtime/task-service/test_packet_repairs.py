import json,tempfile,unittest,sys
from pathlib import Path
from dispatcher import Dispatcher,session_usage_delta,session_choice,decision_receipt
from test_dispatcher import FakeAPI

class Repairs(unittest.TestCase):
 def test_cumulative_usage_is_not_context(self):
  current={'input_tokens':150000,'cached_input_tokens':120000,'output_tokens':500}
  previous={'input_tokens':110000,'cached_input_tokens':90000,'output_tokens':300}
  self.assertEqual(session_usage_delta(current,previous),({'input_tokens':40000,'cached_input_tokens':30000,'output_tokens':200},'task'))
  saved={'thread_id':'same','model_hash':'a','usage_version':2,'session_usage':previous,'turns':2,'last_input_tokens':999999}
  self.assertEqual(session_choice(saved,'a'),('same',None))
  self.assertEqual(session_choice({**saved,'turns':6},'a'),(None,'turn_limit'))
  self.assertEqual(session_usage_delta(previous,current),({},'unknown'))
 def test_real_process_boundary_and_fresh_vote(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);skills=root/'skill/wulab-research';skills.mkdir(parents=True)
   for name in ['SKILL.md','research.md','communication.md','library.md','human-interface.md','scheduling.md']:(skills/name).write_text('Fixture instructions only.')
   fake=root/'fake-codex';fake.write_text('#!'+sys.executable+'\n'+'''import sys,json
prompt=json.JSONDecoder().raw_decode(sys.stdin.read())[0];task=prompt['CURRENT_TASK'];resume='resume' in sys.argv
thread=sys.argv[sys.argv.index('resume')+1] if resume else 'thread-'+task['task']['id']
if task['task']['kind']=='vote':
 assert task['decision_packet']['criteria']=='Fixture criteria'
 assert task['decision_packet']['candidates'][0]['body'].endswith('ESSENTIAL END')
 body=json.dumps({'choice':'a','reason':'The full fixture was provided.'});doc=None
else:body='Short answer.';doc='# Full reply\\n\\n'+'Detail. '*1100+'ESSENTIAL END'
answer={'outcome':'completed','summary':'Fixture reply','body':body,'document':doc,'requests':[]}
print(json.dumps({'type':'thread.started','thread_id':thread}))
print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':json.dumps(answer)}}))
print(json.dumps({'type':'turn.completed','usage':{'input_tokens':150000 if resume else 110000,'cached_input_tokens':120000 if resume else 90000,'output_tokens':500 if resume else 300}}))
''');fake.chmod(0o700)
   d=Dispatcher({'lab_root':td,'runner_id':'fixture','projects':[],'model':'gpt-6.1-sol','codex_bin':str(fake),'max_session_turns':2},FakeAPI(),root/'state')
   def packet(id,kind='question'):
    return {'task':{'id':id,'kind':kind,'input_refs':[]},'agent':{'id':'r1'}}
   def run(p):
    out=d.folder('fixture',p['task']['id']);out.mkdir(parents=True);return d.run_model(p,'fixture',out)
   first=run(packet('one','research'));second=run(packet('two','research'))
   self.assertEqual(first['session_id'],second['session_id']);self.assertEqual(second['usage']['input_tokens'],40000);self.assertEqual(second['usage']['output_tokens'],200)
   p=packet('three','vote');p['decision_packet']={'criteria':'Fixture criteria','candidates':[{'id':'a','task_id':'one','completion_id':'one:done','body':'candidate '*900+'ESSENTIAL END'}]}
   third=run(p);self.assertEqual(third['session_reset_reason'],'fresh_review');self.assertNotEqual(second['session_id'],third['session_id']);self.assertEqual(third['usage']['input_tokens'],110000);self.assertEqual(third['decision_receipt'][0]['completion_id'],'one:done')
   self.assertEqual(d.stats['model_calls'],3)
   with self.assertRaisesRegex(ValueError,'complete decision packet'):run(packet('bad','vote'))
   p=packet('too-big','vote');p['decision_packet']={'criteria':'Fixture criteria','candidates':[{'id':'a','task_id':'one','completion_id':'one:done','body':'x'*1300000+'ESSENTIAL END'}]}
   large=run(p);self.assertTrue(large['packet_size_warnings']);self.assertGreater(large['prompt_bytes'],1000000);self.assertEqual(large['body'],json.dumps({'choice':'a','reason':'The full fixture was provided.'}))
   self.assertEqual(d.stats['model_calls'],4)
   d.pool.shutdown()
 def test_document_survives_delivery_retry(self):
  with tempfile.TemporaryDirectory() as td:
   api=FakeAPI();d=Dispatcher({'lab_root':td,'runner_id':'fixture','projects':['p'],'codex_bin':'unused','model':'gpt-6.1-sol'},api,Path(td)/'state')
   text='# Full answer\n\n'+'Important details. '*450+'ESSENTIAL END'
   calls=[]
   def model(*_):calls.append(1);return {'outcome':'completed','summary':'Saved reply','body':'Short answer.','document':text,'requests':[]}
   d.run_model=model;packet={'task':{'id':'reply','kind':'question'},'claim':{'task_id':'reply','lease_id':'fixture','runner_id':'fixture'}}
   d.execute('p',packet);out=d.folder('p','reply');self.assertEqual((out/'reply.md').read_text(),text+'\n');self.assertFalse((out/'receipt.json').exists());d.tick();self.assertTrue((out/'receipt.json').exists());self.assertEqual(len(calls),1)
   result=json.loads((out/'delivery.json').read_text())['result'];self.assertEqual(result['document'],text);self.assertTrue(any(x['path'].endswith('reply.md') for x in result['artifacts']));d.pool.shutdown()
if __name__=='__main__':unittest.main()
