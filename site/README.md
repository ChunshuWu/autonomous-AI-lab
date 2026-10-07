# Dashboard source

The dashboard shows researchers, the research map, meetings, experiments, the library, the timeline, and researcher profiles. Documents and figures explain the work; historical slide formats remain readable.

From the repository root, run `npm run demo` for the read-only example or `npm start` for a persistent local lab. See [setup](../docs/setup.md) and [architecture](../docs/architecture.md).

`worker.mjs` exposes the API, `store.mjs` saves records, `workflow.mjs` handles stages and human decisions, and `tasks.mjs` prepares tasks. `records.mjs`, `directions.mjs`, and `blocker-recovery.mjs` handle evidence, the research map, and recovery. Browser code is in `frontend/`.

New meetings use one discussion and one researcher vote, with engineer and mathematician advice. The human chooses the next action. Everyone reads that decision and meeting conversations before approved work starts. Research candidates describe concrete experiments. Rejected ideas remain in future task context.

The Python service in `runtime/task-service/` connects agents to saved tasks. Questions can wake an agent in a read-only reply lane while the service is connected. A reply never authorizes further research. Saved files and confirmed dashboard delivery form one handoff.

The `/api/agent` endpoint accepts JSON-RPC `tools/list` and `tools/call`. Discover current schemas there. Credentials belong in `.wulab/`, outside Git. Never invent a human decision through the API.

Run `python3 site/build.py` to build generated modules, or `npm test` for source checks. Tests use fictional fixtures, separate from local project and library data. Hosting metadata, private seed files, and generated bundles are excluded from Git.
