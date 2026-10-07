"""Run the existing saved-task dispatcher against the local dashboard."""
import json
import os
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
config = root/'.wulab/workers.json'
connection = root/'.wulab/connection.json'
if not config.exists() or not connection.exists():
    sys.exit('Start the dashboard and run scripts/setup.py first. See docs/setup.md.')
settings = json.loads(config.read_text())
if Path(settings['lab_root']).resolve()!=root:
    sys.exit('The package moved. Update lab_root and the read paths in .wulab/workers.json before starting workers.')
if not settings.get('projects'):
    sys.exit('No projects selected. Create one with scripts/project.py before starting workers.')
print('Starting workers for: '+', '.join(settings['projects']), flush=True)
os.execv(sys.executable,[sys.executable,str(root/'runtime/task-service/dispatcher.py'),
    '--config',str(config),'--state',str(root/'.wulab/worker-state'),
    '--credentials',str(connection),'--local-test'])
