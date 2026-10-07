"""Create local worker settings. This does not start agents or spend tokens."""
import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--model', required=True, help='A model ID available to your Codex account')
    p.add_argument('--codex', default=shutil.which('codex'), help='Path to a compatible Codex CLI')
    p.add_argument('--reasoning', default='medium', choices=['low','medium','high'])
    p.add_argument('--search', default='live', choices=['live','disabled'])
    a = p.parse_args()
    if not a.codex or not Path(a.codex).is_file():
        p.error('Install Codex CLI first or supply --codex /path/to/codex.')
    executable = str(Path(a.codex).absolute())
    check = subprocess.run([executable, 'exec', '--help'], capture_output=True, text=True, timeout=30)
    if check.returncode or any(x not in check.stdout for x in ['--ignore-user-config','--output-schema','--json']):
        p.error('This CLI lacks required worker options. See docs/setup.md. No settings were written.')
    folder = ROOT/'.wulab'
    folder.mkdir(mode=0o700, exist_ok=True)
    os.chmod(folder, 0o700)
    for directory in ['data/catalog','library/baselines','projects']:
        (ROOT/directory).mkdir(parents=True,exist_ok=True)
    for template in (ROOT/'config/lab').glob('*.md'):
        dest=ROOT/'lab'/template.name
        dest.parent.mkdir(exist_ok=True)
        if not dest.exists():shutil.copyfile(template,dest)
    if not (ROOT/'AGENTS.md').exists():shutil.copyfile(ROOT/'config/AGENTS.md.example',ROOT/'AGENTS.md')
    path = folder/'workers.json'
    if path.exists():
        p.error('Worker settings already exist. Edit .wulab/workers.json to preserve your project list.')
    config = dict(lab_root=str(ROOT),runner_id='local-lab',projects=[],model=a.model,
        reasoning_effort=a.reasoning,codex_bin=executable,web_search=a.search,
        poll_seconds=3,task_timeout_seconds=0,max_session_turns=6,
        max_evidence_bytes=1000000,max_instruction_bytes=1000000,max_prompt_bytes=1000000,
        local_paper_library=True,engineering_read_paths=[str(ROOT/'examples')],
        instruction_runs={},worker_tools_note='Shared papers are in library/. Use runtime/library/papers.py to search them. Save output in the assigned task directory.')
    with path.open('x') as handle:
        os.chmod(path, 0o600)
        json.dump(config, handle, indent=2)
        handle.write('\n')
    print('Created .wulab/workers.json. No workers started. Choose a project next; see docs/setup.md.')

if __name__=='__main__': main()
