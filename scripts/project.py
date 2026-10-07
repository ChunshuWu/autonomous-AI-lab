"""Create a research team, then optionally authorize its saved workflow.

Uses the local authenticated API. Never alters or imports the screenshot demo.
"""
import argparse
import json
import os
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('id', help='A new lowercase project ID, such as sensor-study')
    p.add_argument('--topic', help='A short research area or question; required for creation')
    p.add_argument('--brief', type=Path, help='A text file explaining scope, available compute, data and the endpoint')
    p.add_argument('--researchers', type=int, choices=[2,3,4,5], default=3)
    p.add_argument('--start', action='store_true', help='Authorize research in this brief; workers can spend tokens')
    p.add_argument('--pause', action='store_true', help='Hold an existing project')
    p.add_argument('--resume', action='store_true', help='Resume a held project with its existing workflow')
    p.add_argument('--specialties', nargs='+', help='One short research perspective per researcher')
    a = p.parse_args()
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*',a.id) or len(a.id)>80:
        p.error('Use a short lowercase ID with letters, numbers and hyphens.')
    if sum([a.pause,a.resume,a.start])>1:p.error('Choose only one of --pause, --resume or --start.')
    if not a.pause and not a.resume and (not a.topic or not a.brief):p.error('Creation needs --topic and --brief.')
    if a.specialties and len(a.specialties)!=a.researchers:p.error('Provide one specialty per researcher.')
    credentials=ROOT/'.wulab/connection.json'
    config_file=ROOT/'.wulab/workers.json'
    if not credentials.exists() or not config_file.exists():p.error('Start the local server and run scripts/setup.py first.')
    conn=json.loads(credentials.read_text())
    def call(tool_name, **fields):
        body=dict(jsonrpc='2.0',id='setup',method='tools/call',params=dict(name=tool_name,arguments=dict(workspace=a.id,**fields)))
        req=urllib.request.Request(conn['url']+'/api/agent',json.dumps(body).encode(),headers={'Authorization':'Bearer '+conn['runner_token'],'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=30) as response: result=json.load(response)
        result=result.get('result',result)
        if result.get('isError') or 'error' in result:raise RuntimeError(str(result))
        return json.loads(result['content'][0]['text'])
    def director(action,**fields):return call('director_instruction',action=action,**fields)
    if a.pause or a.resume:
        director('pause_lab' if a.pause else 'resume_lab')
        print('Project paused.' if a.pause else 'Project resumed with its existing allowance.')
        return
    brief=a.brief.read_text().strip()
    if not brief or len(brief)>6000:p.error('Keep the brief between 1 and 6,000 characters; link longer background files.')
    folder=ROOT/'projects'/a.id/'workspace'
    # Never overwrite an existing workspace or silently repurpose an existing project.
    if folder.exists():p.error('That workspace already exists. Pick a new ID, or use --pause / --resume.')
    director('create_project',name=a.topic[:120],topic=a.topic)
    folder.mkdir(parents=True)
    (folder/'brief.md').write_text(brief+'\n')
    director('confirm_topic',topic=a.topic)
    specialties=a.specialties or ['Prior work and explanations','Methods and trade-offs','Evidence and fair comparisons'][:a.researchers]
    while len(specialties)<a.researchers:specialties.append(['Data quality','Mathematical structure'][len(specialties)-3])
    def add(role,name,specialty):
        return director('add_agent',name=name,role=role,specialty=specialty,question=a.topic,plan=['Read the project brief and carry out the assigned task.'])['id']
    coordinator=add('orchestrator','Orchestrator','Coordinate the team and handle obstacles')
    researchers=[add('researcher','Researcher '+str(i+1),s) for i,s in enumerate(specialties)]
    librarian=add('librarian','Librarian','Keep track of sources and saved files')
    engineer=add('engineer','Engineer','Implement and test the selected method')
    mathematician=add('mathematician','Mathematician','Check mathematical assumptions and arguments')
    director('assign_orchestrator',agent_id=coordinator)
    config=json.loads(config_file.read_text())
    if a.id not in config['projects']:config['projects'].append(a.id)
    temporary=config_file.with_suffix('.tmp')
    with temporary.open('w') as handle:
        os.chmod(temporary,0o600);json.dump(config,handle,indent=2);handle.write('\n')
    temporary.replace(config_file)
    if a.start:
        call('lab_tasks',action='configure',enabled=True,research_enabled=True,usage_mode='warn',max_model_calls=100,scope=brief,client_id='initial-authority')
        call('lab_workflow',action='configure',id=a.id,researcher_ids=researchers,librarian_id=librarian,engineer_id=engineer,mathematician_id=mathematician,
             max_rounds=1,max_cycles=3,max_checkpoints=40,waiting_minutes=5,resource_brief=brief)
        print('Workflow authorized. Start/restart npm run workers to load this project.')
    else:
        director('pause_lab')
        print('Created a paused team with no research allowance. Use the authenticated tools to authorize a workflow; see docs/setup.md.')

if __name__=='__main__':main()
