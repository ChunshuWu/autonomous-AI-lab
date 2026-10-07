"""Check a clean copy, local API permissions, project setup, and restart persistence.

No model calls. Requires permission to bind a loopback port.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

source=Path(__file__).resolve().parents[1]
node=sys.argv[1] if len(sys.argv)>1 else shutil.which('node')
if not node:sys.exit('Node.js 24 is required.')

with tempfile.TemporaryDirectory(prefix='wulab-test-') as tmp:
    root=Path(tmp)/'a clean checkout'
    subprocess.run([sys.executable,str(source/'scripts/export_source.py'),str(root)],check=True)
    subprocess.run([sys.executable,'site/build.py'],cwd=root,check=True)
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    def request(path,body=None,headers=None):
        req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers or {})
        try:
            with urllib.request.urlopen(req,timeout=10) as response:return response.status,json.load(response)
        except urllib.error.HTTPError as e:return e.code,json.load(e)
    def start(demo=False):
        server=subprocess.Popen([node,'scripts/serve.mjs','--port',str(port)]+(['--demo'] if demo else []),cwd=root,stdout=subprocess.DEVNULL)
        for _ in range(100):
            if server.poll() is not None:raise RuntimeError('Server exited before becoming ready')
            try:
                if request('/health')[0]==200:return server
            except OSError:pass
            time.sleep(.05)
        server.terminate();server.wait();raise RuntimeError('Server did not become ready')
    server=start()
    try:
        assert request('/api/state')[1]['projects']==[]
        assert request('/api/state',headers={'Origin':'https://outside.invalid'})[0]==403
        assert request('/api/state',headers={'Host':'attacker.invalid'})[0]==403
        assert request('/api/agent',{'jsonrpc':'2.0','id':1,'method':'tools/list'})[0]==403
        assert request('/api/director',{'action':'pause_lab'})[0]==403
        fake=Path(tmp)/'fake-codex'
        fake.write_text('#!/bin/sh\necho "--ignore-user-config --output-schema --json"\n')
        fake.chmod(0o755)
        subprocess.run([sys.executable,'scripts/setup.py','--model','offline-fixture','--codex',str(fake)],cwd=root,check=True)
        brief=Path(tmp)/'brief.txt';brief.write_text('Use synthetic data only. Test setup and stop before any model call. CPU only.')
        subprocess.run([sys.executable,'scripts/project.py','test-study','--topic','A synthetic setup check','--brief',str(brief),'--start'],cwd=root,check=True)
        status,payload=request('/api/state?workspace=test-study')
        assert status==200 and len(payload['state']['agents'])==7
        assert payload['state']['workflow']['status']=='running'
        assert payload['state']['workflow']['configuration']['max_rounds']==1
        assert payload['state']['workflow']['meeting_policy']=='human'
        assert any(a['role']=='mathematician' for a in payload['state']['agents'])
        assert payload['state']['task_policy']['usage_mode']=='warn'
        connection=json.loads((root/'.wulab/connection.json').read_text())
        auth={'Authorization':'Bearer '+connection['runner_token'],'Content-Type':'application/json'}
        status,rpc=request('/api/agent',{'jsonrpc':'2.0','id':1,'method':'tools/list'},auth)
        assert status==200 and any(t['name']=='lab_workflow' for t in rpc['result']['tools'])
        status,queue=request('/api/task-runner',{'workspace':'test-study','action':'poll','runner_id':'check'},auth)
        assert status==200 and queue['result']['ready']
        subprocess.run([sys.executable,'scripts/project.py','test-study','--pause'],cwd=root,check=True)
        assert request('/api/state?workspace=test-study')[1]['state']['paused']
        original_token=connection['runner_token']
    finally:server.terminate();server.wait(timeout=10)
    server=start()
    try:
        state=request('/api/state?workspace=test-study')[1]['state']
        assert state['paused'] and len(state['agents'])==7
        assert json.loads((root/'.wulab/connection.json').read_text())['runner_token']==original_token
    finally:server.terminate();server.wait(timeout=10)
    server=start(demo=True)
    try:
        state=request('/api/state')[1]['state']
        assert state['project']['id']=='missing-measurements-demo'
        assert request('/api/director',{'action':'pause_lab'})[0]==403
        assert request('/api/task-runner',{'action':'poll'})[0]==403
    finally:server.terminate();server.wait(timeout=10)
print('PASS: clean path with spaces, empty lab, setup, authorized workflow, queue, pause, restart, token persistence, and isolated read-only demo.')
