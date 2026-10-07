# Screenshots

The prepared PNGs in `docs/screenshots/` come from the running example. Good starting choices:

1. `map.png`: one selected question, methods beneath it, and ideas saved for later.
2. `research.png`: the team’s roles, status, and plans.
3. `experiment-detail.png`: an understandable comparison with a chart.
4. `votes.png`: concise choices and different reasons.
5. `library.png`: papers, data, baselines, tools, and notes.
6. `timeline.png`: progress and a visible recovery event.

`report.png`, `meetings.png`, `meeting-detail.png`, `experiments.png`, and `cats.png` are also included. Label shared screenshots as an example; the experiment is measured on synthetic data and the team activity is scripted.

To take your own, run `npm run demo` and use the sidebar. Click an experiment to open its chart, or a meeting to see the proposals and votes. The research map supports drag, zoom, hover, and clickable nodes.

Optional automated capture:

```sh
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install playwright
python3 -m playwright install chromium
python3 scripts/screenshots.py
```

Keep the demo running in another terminal. Use `--url http://127.0.0.1:PORT` if you changed its port. The script checks the seven views, charts, meeting votes, report, and narrow screens while taking screenshots.
