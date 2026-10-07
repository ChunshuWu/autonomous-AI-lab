"""Check publishable source and demo; never inspect private lab files."""
import json
import re
from pathlib import Path
from export_source import source_files

root=Path(__file__).resolve().parents[1]
files=source_files();assert files
for p in files:
    rel=p.relative_to(root)
    assert not p.is_symlink(), 'Source symlink: '+str(rel)
    assert p.stat().st_size<20*1024*1024, 'Large source file: '+str(rel)
    assert rel.parts[0] not in {'projects','library','data','lab','.wulab','releases','app'}, 'Private/local folder: '+str(rel)
    assert str(rel) not in {'site/seed.json','site/library-seed.json','site/generated.mjs','site/index.mjs'}, 'Local/generated data: '+str(rel)
    if p.suffix not in {'.py','.mjs','.js','.md','.json','.html','.yml','.yaml'}:continue
    if p.name=='check_package.py' or 'vendor' in rel.parts:continue
    text=p.read_text()
    assert not re.search(r'/home/[^\s/]+/|/Users/[^\s/]+/',text), 'Personal path: '+str(rel)
    assert not re.search(r'(?:sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{20,}',text), 'Potential credential: '+str(rel)
    assert 'PRIVATE KEY-----' not in text, 'Potential key: '+str(rel)
for filename in ['research.md','communication.md','library.md','human-interface.md','scheduling.md']:
    assert (root/'skill/wulab-research'/filename).is_file()
example=root/'examples/missing-measurements'
data=json.loads((example/'results.json').read_text())
assert len(data['results'])==6 and all(len(row['runs'])==5 for row in data['results'])
main=next(r for r in data['results'] if r['pattern']=='overload' and r['high_missing_probability']==0.9)
control=next(r for r in data['results'] if r['pattern']=='random' and r['high_missing_probability']==0.9)
assert main['mean_improvement_percent']>10 and abs(control['mean_improvement_percent'])<3
state=json.loads((example/'project.json').read_text())
assert state['project']['kind']=='example' and not state['tasks']
assert len(state['agents'])==7
assert all(r['status']=='completed' for r in state['research_records']['experiment'])
proposal_ids={p['id'] for p in state['research_map']['nodes']}
for method in state['research_records']['method']:
    assert set(method['proposal_ids'])<=proposal_ids
    assert all(method['presentation']['experiment'].get(k) for k in ['data','method','setup','expected_outcome','learning'])
for meeting in state['research_records']['meeting']:
    candidates={p['id'] for p in meeting['presentations']}
    assert all(v['choice'] in candidates for v in meeting['votes'])
    assert {'engineer','mathematician'}<=set(meeting['participant_ids'])
    assert meeting['human_decision']['selected_id'] in candidates
print(f'PASS: {len(files)} publishable files; private folders excluded; paths, measured demo, and human decisions checked.')
