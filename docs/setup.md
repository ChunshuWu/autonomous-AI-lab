# Start a real research project

The local dashboard and worker service are separate processes. The server saves records and queues tasks. The workers run those tasks and deliver their results. A dashboard alone does not start model calls.

## 1. Start the dashboard

Install Node.js 24+ and Python 3.10+. From the repository root, run:

```sh
npm start
```

Open http://127.0.0.1:8767. Keep this process running. On a remote machine, use VS Code port forwarding or an SSH tunnel.

This creates `.wulab/dashboard.sqlite`, a random local API token, and `.wulab/connection.json`. They are private local files, excluded from Git. The server binds only to loopback. It is a single-user local service, not a public hosting setup; public hosting needs its own authentication and access controls.

## 2. Configure workers

Use a Linux environment and a Codex CLI authenticated with your own account. The existing adapter was developed with CLI **0.160.0**. It relies on `exec`, structured output, session resume, web search, and named filesystem permissions. `setup.py` checks visible command options; this is not a full check of account access or sandbox behavior. Do not remove the sandbox to work around an incompatible CLI.

Choose a model ID that your account supports:

```sh
python3 scripts/setup.py --model YOUR_MODEL_ID
```

Add `--codex /path/to/codex` if it is not on PATH. The command writes `.wulab/workers.json` without starting agents. Edit that file to change the model, reasoning level, search setting, or allowed engineering input directories. The adapter uses CLI authentication, not a token pasted into this repository.

The default settings allow web search for research tasks and keep shell networking disabled. Literature search, shell access, and PDF extraction are separate capabilities. Source downloads run through a network-enabled acquisition process or the human director.

Optional PDF import and page reading:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r runtime/library/requirements.txt
python3 runtime/library/papers.py import /path/to/your/papers
python3 runtime/library/papers.py search "your topic"
```

Importing copies papers into the local library and keeps originals unchanged. It does not claim an agent has read them. This extension uses PyMuPDF; see its separate terms in [the notices](../THIRD_PARTY_NOTICES.md). Run workers from the same activated environment if they need PDF tools.

## 3. Write a brief and start a team

Copy `config/project-brief.example.md` to a local file and replace its example scope with your question, available resources, data locations, and desired endpoint. Keep the scope clear enough that agents can tell whether a test is affordable and permitted.

```sh
python3 scripts/project.py sensor-study \
  --topic "Reliable predictions when sensor readings are missing" \
  --brief config/project-brief.example.md \
  --researchers 3 --start
npm run workers
```

**`--start` authorizes the work in the brief.** Once workers are running, this may use paid model calls. Calls and tokens are counters by default, not spending caps. Without `--start`, creation makes a paused team without a research allowance; an orchestrator using the authenticated API can later configure it.

Every new team includes an orchestrator, librarian, engineer, mathematician, and the selected number of researchers. Meetings have one discussion and one researcher vote. In Meetings, you can ask each candidate’s author a question, select a candidate, reject all with feedback, or stop. The team receives your decision and meeting conversations before continuing.

Use `--specialties "Prior work" "Robust prediction" "Experiment design"` to choose the researchers’ perspectives. They still work on one selected question, with different methods for the same central idea. The dashboard names are presentation identities; agent IDs and records remain separate.

The service reads its configuration at startup. Restart `npm run workers` after adding projects or changing settings. Task results go under `projects/PROJECT_ID/workspace/dispatch/tasks/`; service state goes under `.wulab/worker-state/`.

## Pause, resume, and recover

Use Pause on the dashboard, or:

```sh
python3 scripts/project.py sensor-study --pause
python3 scripts/project.py sensor-study --resume
```

Resume restores the existing allowance; it does not create a workflow for an unconfigured team. To stop the local processes, use Ctrl+C in their terminals. Restart the server and workers from the same folder to continue saved work. Do not delete `.wulab` to fix a block: it holds the database and worker state.

If a record says blocked, inspect its saved reason and the red timeline entry. The orchestrator checks recoverable blocks; missing evidence, actual resource failures, and human holds can still need intervention. Do not hide such states by relabeling them complete.

Back up `.wulab`, `projects`, `library`, and your data together while services are stopped. After moving the package, update the absolute paths in `.wulab/workers.json` before resuming workers.

## Use the skill in a separate session

The portable skill is `skill/wulab-research/`. Copy that directory into your Codex skills directory without overwriting another installation. Start a new session and ask it to use `$wulab-research`. All five model documents are included beside `SKILL.md`.

An external orchestrator connects to `/api/agent` using the bearer token from `.wulab/connection.json`. The endpoint supports JSON-RPC `tools/list` and `tools/call`; it exposes project, workflow, task, record, library, and director tools. Use tools that match actual user instructions. Keep this token out of prompts, reports, and repositories. Dispatched researchers receive scoped task packets and do not need the API token.
