"""Create a screenshot-ready dashboard snapshot from the real toy results.

Meetings, identities, activity times and votes are authored examples, not agent logs.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
data = json.loads((HERE / 'results.json').read_text())
main = next(r for r in data['results'] if r['pattern'] == 'overload' and r['high_missing_probability'] == 0.9)
control = next(r for r in data['results'] if r['pattern'] == 'random' and r['high_missing_probability'] == 0.9)
improvement = main['mean_improvement_percent']
at = lambda minute: f'2026-01-15T10:{minute:02d}:00Z'
project_id = 'missing-measurements-demo'

def presentation(question, idea, support, outcome, prior=None, gap=None):
    return dict(question=question,
        prior_work=prior or 'A common shortcut fills a blank sensor reading with its usual value.',
        gap=gap or 'That hides the difference between a real ordinary reading and no reading at all.',
        factor=idea, support=support, outcome=outcome,
        conditions='A small synthetic dataset; three sensors; separate training and test rows.')

proposal_specs = [
    ('proposal-blank', 'Can blank readings warn us of overload?', 'under_exploration',
     'Tell the model which sensors went blank, as well as their filled-in readings.',
     'A sensor may stop reporting more often when its input is high. A blank reading can then be a clue.',
     'Lower prediction error on new rows, with a random-missingness check.'),
    ('proposal-history', 'Can recent readings fill short gaps?', 'unexplored',
     'Use earlier readings from the same sensor to estimate a short gap.',
     'Many physical signals change gradually. A recent reading may be better than the average.',
     'Better predictions during short gaps in a future time-series dataset.'),
    ('proposal-neighbors', 'Can sensors check one another?', 'unexplored',
     'Use sensors that measure related things to estimate a missing reading.',
     'Nearby sensors may share information, but our first toy dataset deliberately lacks that structure.',
     'Lower error when sensors share a signal; defer until we have suitable data.'),
    ('proposal-hardware', 'Would an extra sensor prevent gaps?', 'discarded',
     'Add a second sensor at the same location.',
     'A spare may keep measuring when the first sensor fails.',
     'Fewer missing readings; outside this data-only project.')
]
proposals = [dict(id=id, parent_id=None, title=title, summary=idea, status=status,
    presentation=presentation(title, idea, why, outcome), evidence=[], report_refs=[{'report_id':'report-first-result'}] if id=='proposal-blank' else [],
    created_at=at(5), updated_at=at(15)) for id,title,status,idea,why,outcome in proposal_specs]

method_specs = [
    ('method-flags','Mark each blank reading','active','Add one yes/no input per sensor: was this reading missing?',
     'This preserves the missing-reading clue while changing very little code.'),
    ('method-patterns','Use a model for each missing pattern','unexplored','Train a separate model for each combination of blank sensors.',
     'Each model can adapt to its pattern, but some patterns may have too little data.'),
    ('method-average','Fill gaps with ordinary values','explored','Replace each blank with the sensor’s average in the training data.',
     'This is a cheap comparison point. It does not preserve the missing-reading clue.'),
    ('method-similar','Borrow from similar complete readings','unexplored','Find similar rows whose sensors all worked and borrow their values.',
     'Similar cases may help, though this costs more and may erase the warning itself.')
]
methods = [dict(id=id,type='method',revision=1,title=title,summary=idea,status=status,owner_id='r'+str((i%3)+1),
    proposal_ids=['proposal-blank'],report_ids=['report-first-result'] if status in ['active','explored'] else [],
    created_at=at(18),updated_at=at(22),evidence=[],next_step='Check the result on real sensor data.' if status=='active' else '',
    presentation=presentation('How should we use the fact that a reading is missing?',idea,why,'Compare prediction error with the same data split.'))
    for i,(id,title,status,idea,why) in enumerate(method_specs)]

def bars(row, title):
    return dict(type='bars',title=title,max=2,unit='Prediction error (lower is better)',
        rows=[dict(label=label,value=round(row['mean_rmse'][key],3),display=f"{row['mean_rmse'][key]:.3f}",series=key)
            for key,label in [('fill_only','Fill gaps only'),('missing_flags','Fill gaps + mark blanks')]],
        caption='Average root mean squared error over five independent train/test splits. Synthetic data, arbitrary target units. Full per-seed results are included.')

experiments = [dict(id='experiment-main',type='experiment',revision=1,status='completed',title='Can a blank reading be useful information?',
    owner_id='engineer',summary=f'Marking blank readings reduced error by {improvement:.1f}% in the overload example.',
    purpose='When sensor A is under high load, it is more likely to stop reporting. Can we use that clue?',
    prediction='A model told which readings went blank should predict better than one given only filled-in numbers.',
    figures=[bars(main,'Blank readings carry a clue')],
    interpretation='In this toy world, a missing reading often means sensor A was high. A yes/no flag lets the model adjust its prediction.',
    uncertainty='The rule causing missing readings is deliberately simple and stays the same at test time. This is an illustration of a known method, not evidence of a new discovery or performance on real sensors.',
    next_step='Try real data and check what happens when the sensor’s failure pattern changes.',
    setup='4,000 training rows and 2,000 separate test rows per seed; five seeds. Means and model weights are fitted on training data only.',
    baseline='Linear prediction after filling each missing value with its training-set mean.',
    data='sample.csv contains the first split; run.py generates all five.',
    code_version='examples/missing-measurements/run.py',settings='The high-reading missing probability is 0.9; otherwise 0.1. The other sensors go blank independently with probability 0.12.',
    measures='Root mean squared prediction error. Extra cost: three binary inputs, seven rather than four fitted coefficients including the intercept.',
    budget='CPU only; no model calls or downloads.',cost='Thirty fits per method across all conditions.',
    results=json.dumps(main,indent=2),created_at=at(30),updated_at=at(35),
    proposal_ids=['proposal-blank'],method_ids=['method-flags','method-average'],library_ids=['lib-data','lib-baseline','lib-indicators'],report_ids=['report-first-result']),
    dict(id='experiment-control',type='experiment',revision=1,status='completed',title='What if readings disappear at random?',owner_id='engineer',
    summary='The flags gave no benefit when missing readings carried no clue about the target.',
    purpose='Keep the expected missing rate the same, but remove its link to high sensor readings.',
    figures=[bars(control,'The random-missingness check')],interpretation='The first result depends on an informative failure pattern. Adding inputs alone was not enough to improve predictions.',
    uncertainty='Five splits are useful for a demonstration, not a broad claim about all data.',next_step='Check whether real sensor failures contain a similar clue.',
    setup='Same fit, train/test sizes, and seeds. Missingness is independent of sensor values.',results=json.dumps(control,indent=2),
    created_at=at(36),updated_at=at(38),proposal_ids=['proposal-blank'],method_ids=['method-flags'],library_ids=['lib-data'],report_ids=['report-first-result']),
    dict(id='experiment-sweep',type='experiment',revision=1,status='completed',title='When does the clue become useful?',owner_id='engineer',
    summary='The benefit grew as high readings became more likely to disappear.',purpose='Vary the chance that a high sensor reading goes blank.',
    figures=[dict(type='line',title='Stronger missingness clue, larger benefit',x_label='Chance a high reading goes blank',y_label='Prediction error',
      series=[dict(label=label,points=[dict(x=r['high_missing_probability'],y=round(r['mean_rmse'][key],4)) for r in data['results'] if r['pattern']=='overload']) for key,label in [('fill_only','Fill gaps only'),('missing_flags','Mark blank readings')]],
      caption='Each point averages five held-out tests. Raw per-seed values are in results.json. These lines show averages, not uncertainty intervals.')],
    interpretation='As more high readings disappear, the filled values become less reliable. Marking blanks recovers part of the lost information.',uncertainty='Only three failure settings and one simple data-generating rule were tested.',
    setup='High-reading missing probabilities of 0.3, 0.6, and 0.9. Other settings are unchanged.',results=json.dumps(data,indent=2),
    created_at=at(39),updated_at=at(42),proposal_ids=['proposal-blank'],method_ids=['method-flags'],library_ids=['lib-data'],report_ids=['report-first-result'])]

for experiment in experiments:
    experiment['execution_outcome']='complete'
    experiment['scientific_outcome']='negative' if experiment['id']=='experiment-control' else 'positive'

for method in methods:
    method['presentation']['experiment']=dict(
        data='Synthetic readings from three sensors; 4,000 training rows and 2,000 new test rows per split.',
        method=method['summary'],
        setup='Use five independent splits. Fit all averages and model settings using only training rows. Compare with filling blanks using training averages.',
        expected_outcome='Lower error when blank readings signal overload; little or no gain when readings disappear at random.',
        learning='Whether keeping the missing-reading clue helps, and whether the extra complexity is worthwhile.')

def meeting(id,title,time,candidates,choice,reasons,method=False):
    return dict(id=id,type='meeting',revision=1,title=title,status='completed',owner_id='orchestrator',occurred_at=at(time),created_at=at(time),updated_at=at(time),
        summary='Converged: all three recommended the same candidate. The human approved it.',participant_ids=['r1','r2','r3','engineer','mathematician','orchestrator'],
        human_decision=dict(action='select',selected_id=choice,comment='Start with this small, clear test.',at=at(time)),
        proposal_ids=['proposal-blank'] if method else [c['id'] for c in candidates],method_ids=[c['id'] for c in candidates] if method else [],
        presentations=[{**{k:c[k] for k in ['id','title','presentation']},'agent_id':c.get('owner_id','r'+str(i+1))} for i,c in enumerate(candidates)],
        votes=[dict(agent_id=f'r{i+1}',choice=choice,reason=reason) for i,reason in enumerate(reasons)],
        notes='Scripted example of a completed meeting; these are not live agent votes.')
meetings=[meeting('meeting-question','Which question should we test first?',15,proposals[:3],'proposal-blank',[
    'A clear question with a cheap test and a useful random-missingness check.',
    'Existing work gives us a sound starting point; we can test the limitation without new data.',
    'We can isolate one change, so the first result should be easy to interpret.']),
    meeting('meeting-method','Choose the smallest useful change',22,[methods[0],methods[1],methods[3]],'method-flags',[
    'Three extra inputs are enough to test the shared idea.',
    'The same training split and predictor keep the comparison fair.',
    'This is easy to reproduce and has an obvious check: remove the missingness clue.'],True)]

report=dict(id='report-first-result',agent_id='orchestrator',agent_name='Leo',version=1,title='A blank reading can be a clue',
    summary=f'A known, simple method cut error by {improvement:.1f}% in one toy setting. The random-missingness check showed its limit.',created_at=at(46),
    previous_steps=[],next_steps=[dict(id='next-real',task='Find a real sensor dataset with recorded failures.',why='The toy test cannot tell us how common this pattern is.',success='We can trace why and when readings go missing.')],questions=[],sources=[],
    document=dict(background='Imagine a sensor that stops reporting when it gets too hot. Filling the blank with its average makes the input look ordinary. But the blank itself may be a warning.\n\nThis example uses a known idea: add a yes/no input saying which readings were missing. The data are generated locally. Team meetings and votes are scripted examples.',
        progress=f'We compared two simple predictors on separate test data. Both filled gaps using training-set averages. Only one received the extra missing-reading flags.\n\nWith overload-related failures, error fell from {main["mean_rmse"]["fill_only"]:.3f} to {main["mean_rmse"]["missing_flags"]:.3f}: **{improvement:.1f}% lower**. When readings disappeared at random, the flags gave no benefit.\n\nThis supports the mechanism in this toy example. It does not establish a new research contribution or a real-world improvement.',
        next_steps='Find real data that records sensor failures. Check whether the pattern changes over time, and test on a later period. Keep the average-filling baseline.\n\nRerun the example with `python3 examples/missing-measurements/run.py`. Inspect all per-seed values in `results.json`.'),
    figures=[{'section':'background','visual':dict(type='flow',title='Keep the clue',nodes=[dict(label='Sensor goes blank',detail='The cause may matter.'),dict(label='Fill + mark',detail='Use the average and a missing flag.'),dict(label='Predict',detail='Test on new rows.')],caption='The only added information is which sensor readings were missing.')}, {'section':'progress','visual':bars(main,'First result')}])

roles=[('r1','Alugalug','researcher','alugalug','Check what the evidence supports'),('r2','George Rufus','researcher','lonely','Find useful related work'),('r3','Chai Kichi','researcher','hahee','Check the comparison is fair'),('engineer','Johnson','engineer','johnson','Reproduce the three experiment results'),('librarian','Billy','librarian','billy','Keep sources and code easy to find'),('orchestrator','Leo','orchestrator','numnum','Coordinate the next approved test'),('mathematician','Serafino','mathematician','serafino','Check why the missing flag can help')]
agents=[dict(id=id,name=name,role=role,dashboard_cat_id=cat,specialty=job,question=job,plan=[dict(id=id+'-plan',task=job)],status='paused',last_seen=at(46),
    work_status=dict(base_status='paused',state='sleeping',summary=job,waiting_for=job,updated_at=at(46)),latest_report='report-first-result' if id=='orchestrator' else None) for id,name,role,cat,job in roles]
library=[dict(id='lib-indicators',kind='tool',title='Missing-value indicators',summary='Official documentation for the known idea used here: preserve which inputs were missing.',source='https://scikit-learn.org/stable/modules/impute.html#marking-imputed-values',availability='Public documentation',reading='Documentation used to describe the method; this demo uses its own small implementation.',topics=['Missing measurements'],checks='Known method; no novelty claim.'),
    dict(id='lib-paper',kind='paper',title='MICE: Multivariate Imputation by Chained Equations',summary='A reference for a different way to fill gaps. Included for comparison; not implemented in this example.',source='https://www.jstatsoft.org/article/view/v045i03',availability='Source link only',reading='Abstract only; full paper is not bundled.',version='van Buuren and Groothuis-Oudshoorn, 2011',topics=['Missing measurements'],checks='Not an experimental baseline in this demo.'),
    dict(id='lib-data',kind='dataset',title='Synthetic sensor readings',summary='Three sensor inputs and one target. Includes overload-linked and random missing readings.',path='examples/missing-measurements/sample.csv',availability='Available locally',reading='Generated by the included experiment.',topics=['Demo data'],checks='Independent train/test rows. Artificial data, not measurements from a real device.'),
    dict(id='lib-baseline',kind='baseline',title='Fill gaps, then fit a linear predictor',summary='A small reusable baseline. Fill each gap with its training-set mean, then fit the predictor.',path='examples/missing-measurements/run.py',availability='Available locally',reading='Full code included.',topics=['Missing measurements','Baselines'],checks='Same data and fit as the method under test; no test-set values used during fitting.'),
    dict(id='lib-results',kind='notes',title='Results for all five random seeds',summary='Every measured result, including the random-missingness check and the three failure settings.',path='examples/missing-measurements/results.json',availability='Available locally',reading='Full results included.',topics=['Demo data'],checks='Generated from run.py; values are not invented.')]
for item in library:item.update(project_ids=[project_id],acquired_by='librarian',read_by=[],revision=1)
event_specs=[(0,'Director','Started a small study of missing sensor readings.','activity',None),
    (3,'librarian','Added the missing-value guide and a paper for comparison.','library',None),
    (8,'r1','Proposed testing whether a blank reading can warn us of overload.','activity',None),
    (15,'orchestrator','The human approved the team’s recommended question for a first small test.','meeting',{'type':'meeting','id':'meeting-question'}),
    (22,'orchestrator','The human approved marking missing readings with yes/no inputs.','meeting',{'type':'meeting','id':'meeting-method'}),
    (26,'engineer','Stopped: the sample file used a different column name.','obstacle',None),
    (28,'orchestrator','Checked the file and corrected the input-column mapping. Work could continue.','recovery',None),
    (35,'engineer',f'The overload test finished: marking blanks reduced error by {improvement:.1f}%.','experiment',{'type':'experiment','id':'experiment-main'}),
    (38,'r3','The random-missingness check showed no benefit.','experiment',{'type':'experiment','id':'experiment-control'}),
    (42,'r2','The benefit grew when high readings were more likely to disappear.','experiment',{'type':'experiment','id':'experiment-sweep'}),
    (48,'orchestrator','The next useful step is to check a real dataset.','decision',None)]
state=dict(name='The missing-reading clue',mode='example',project=dict(id=project_id,name='The missing-reading clue',kind='example',topic='Can a blank sensor reading be a useful clue?',topic_status='confirmed',workspace='examples/missing-measurements'),
    paused=False,agents=agents,orchestrator_id='orchestrator',reports=[report],events=[dict(id='event-'+str(i),at=at(t),actor=actor,text=text,kind=kind,record_ref=ref) for i,(t,actor,text,kind,ref) in enumerate(event_specs)],
    decisions=[],notifications=[],discussions=[],library=library,direction='Test whether the fact that a sensor went blank improves predictions, then check when that clue stops helping.',direction_revision=1,
    research_map=dict(revision=1,nodes=proposals),research_records=dict(method=methods,experiment=experiments,meeting=meetings),tasks=[],warnings=[],requests=[],
    demo_summary=dict(title='From a question to a checked result',text=f'{improvement:.1f}% less prediction error in the overload example. No benefit when readings disappeared at random.',experiment_id='experiment-main',report_id=report['id']),
    record_questions=[dict(id='question-control',record_type='experiment',record_id='experiment-main',created_at=at(39),body='Does this mean extra inputs always improve predictions?',replies=[dict(id='reply-control',agent_id='r3',created_at=at(40),body='No. In the random-missingness check, the flags did not help. Here, they help only because a missing reading tells us something about the hidden sensor value.')])])
(HERE/'project.json').write_text(json.dumps(state,indent=2,ensure_ascii=False)+'\n')
(HERE/'report.md').write_text('# '+report['title']+'\n\n'+'\n\n'.join('## '+k.replace('_',' ').title()+'\n\n'+v for k,v in report['document'].items())+'\n')
print('Built the demo project from measured results; meetings and activity are scripted.')
