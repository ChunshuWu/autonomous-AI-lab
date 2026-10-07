# Human-interface model

**Goal:** Let the human director understand what the team is doing, inspect its evidence and decisions, and steer the work through the dashboard.

Provide five dashboard views with direct navigation: **Timeline, Experiments, Research map, Meetings, and Library**.

The dashboard shows saved project records. Every event, experiment, proposal, method, meeting, and library item has a stable ID and links to related records. Agents update these records as work changes; the dashboard uses them for both current status and history. Saving the evidence and updating the dashboard are one handoff under [scheduling.md](scheduling.md). Mark the handoff complete only after the files are saved and the dashboard confirms the matching record and version. If delivery fails, show it as pending and retry that update without repeating the experiment. A formatting failure is not a failed experiment. Show the complete saved result as a readable document while a chart or detailed view needs repair; warn without stopping valid research.

Keep projects separate. Show the project title, current stage, selected research question, next action, and any request needing the director's attention. Use the intuitive presentation style in [communication.md](communication.md#clear-writing-for-every-role): start with a situation or small example the director can picture, explain the idea before its technical name, and say why the question matters. Apply this to map titles, candidate descriptions and reports. Show short summaries first with details on opening an item.

## 1. Event log and timeline

Every agent records meaningful activity: starting or finishing work, a finding, a handoff, a meeting, a decision, an obstacle, or a pause/resume. Routine tool calls need no separate entries.

Show blocked events in red with a visible “Blocked” label. State who is blocked, why, and what help is needed in simple language. Add linked follow-up entries for the orchestrator’s diagnosis, attempted fix, and confirmed outcome; keep the original red event after recovery. Record an event once, not on every poll. A failed repair stays visible with its request for help.

Each entry contains the time, agent name and role, a short description of what changed, and links to the relevant records. Write one or two complete, simple sentences about what happened. Avoid internal checkpoint codes, unexplained terms and cut-off sentences; link the full note for technical detail. Show these entries in one project timeline, filterable by agent and activity. An event appears once even if it affects several views. Keep corrections as later updates rather than erasing history.

Show each agent's current task, working/sleeping/blocked/finished status, last update, and any reason for waiting or being blocked. The task service updates status from worker events; agents working outside it report their changes. The orchestrator checks that assignments and displayed states agree. For sleeping agents, show what they are waiting for and what will wake them. Expected sleep is not stale or failed work. Opening an agent shows its saved tasks, short answers, full reply documents, evidence links, and per-task token use (label older cumulative counts clearly); keep these details out of the main overview. Show stale working status as uncertain, not as evidence that work is still running.

Show project model-call and reported token totals as small, visible counters. Do not raise warnings merely because these totals are large. Count each task once and explain that tokens update when tasks finish. Elapsed-time warnings do not stop healthy work. Show the observed symptom and a useful next action when discussion repeats or work stalls. Distinguish a completed research task from a stopped or blocked run, and show its actual reason.

## 2. Experiment records

The engineer creates a record before each experiment and updates it during execution and after it ends. Link it to the related proposal, method, and meeting records. Include:

- **Purpose:** What are we testing, why, and what result do we expect?
- **Setup:** What changes, what is the baseline, and what data, settings, measures, and budget are used? Link the code and data versions needed to repeat it.
- **Progress and results:** Show planned/running/completed/failed/stopped status, actual results, errors, and cost. Label partial results clearly.
- **Execution and scientific outcome:** Separately record `execution_outcome` as complete, partial or blocked, and `scientific_outcome` as not_tested, inconclusive, positive or negative. Completion means the assigned experiment ran; a positive finding needs measured evidence and its limits. Do not infer scientific success from a delivered task or passing software checks. Leave older unclassified findings explicitly unclassified. Record `recovery_attempts` and `remaining_obstacle` when repair was needed.
- **Explanation:** Researchers state what the evidence supports, what remains uncertain, and the proposed next step.

Lead with the answer in simple language, followed by the visual that best explains it: bars for comparisons, curves for trends, or examples of what changed. Use a compact table when exact values or mixed facts are clearer. The engineer prepares the figures; researchers check their meaning. Explain each measure in everyday words, with units, the baseline, and whether higher or lower is better. Distinguish calculated probabilities from observed counts. Show uncertainty for the quantity it actually describes and add a short caption stating the finding and its limits. A flow chart can explain the setup but cannot replace result evidence. Never invent results.

Choose only columns that help answer the question; raw field names such as “expected failure” need a clear definition. Give text columns enough room, keep numbers aligned, use sensible precision, and let wide tables scroll without squeezing words into letters. Keep full data, technical checks, and exact values under details or linked files. Preserve negative results and fair comparisons; a better-looking chart must not imply a stronger conclusion.

Keep failed and negative experiments visible. Mathematical work can link arguments or diagrams without pretending it is an experiment.

## 3. Proposal and method map

Use a tree view: research topic → proposals → methods for each proposal. Research Stage methods belong under the proposal they address. Each method node represents a complete implementation option; its components, mathematical work and evaluation steps are linked tasks rather than competing method nodes. Show active and explored items individually. Group unexplored and discarded items separately within each branch and type: “Unexplored proposals” at the topic level and “Unexplored methods” under their proposal. Never merge methods from different proposals or mix proposals with methods. Opening a group lists its items and lets the director open each one. This changes only the view: preserve every item’s ID, parent, status, evidence and history.

Each individual node has a short title naming the research question or core method in everyday words, with status shown separately. Hover and detail pages explain the question and method for a non-expert: a concrete situation, what goes wrong, the proposed steps, and what would improve. Explain terms before using them; keep formulas and exact settings in the full document. For Research methods, state both the shared idea and this researcher’s particular way of using it. Keep reviewer names, suggestions, responses and revision bookkeeping out of that explanation. Link the complete proposal and relevant results for deeper reading. Do not present an untested benefit as a finding. Researchers supply the question; the orchestrator keeps the map in step with the saved proposal.
| Status | Meaning |
| --- | --- |
| Unexplored | Saved as a candidate; the team has not taken it forward. |
| Active | The human-approved proposal or current selected method. |
| Explored | Investigation ended and its findings are recorded, whether positive or negative. |
| Discarded | The human rejected it or explicitly chose not to pursue it; record why. |

Keep one selected proposal as the shared direction. Independent candidate preparation remains visible through agent activities and meetings. Active describes the selected focus; work on it may be paused. Losing a vote does not automatically discard an idea, and a failed experiment does not automatically discard its method. Choosing “Reject all and prepare new candidates” marks every proposal or method in that selection meeting as Discarded, with the human feedback and meeting link preserved. Rejecting methods keeps their shared proposal active. Candidates from other meetings keep their status.

The orchestrator updates node status after a recorded decision under [communication.md](communication.md), preserving who decided, why, and when. Reopening an idea keeps its earlier evidence and history. A map label alone does not authorize or start work.

## 4. Meeting summaries

Save a record after every meeting. The orchestrator records chaired meetings; participants name one recorder for other meetings. Keep the full candidates, meeting advice, votes, unresolved concerns and human-approved assignments in the saved evidence.

The meeting page shows:

- **Summary:** Converged or not converged, with the vote count. Omit the general meeting purpose.
- **Proposals or methods:** A short explanation of each candidate using the research mindset: what existing work does, the remaining question, the idea or factor under **Idea**, **Why it may help**, and **Outcome to test**, and the test conditions. Fill these with actual concepts; explain terms and label intuition or uncertainty honestly. Do not show a reviewer-by-reviewer account of suggestions and responses.
- **Votes:** Each researcher’s choice and brief reason, revealed together. Link choices to the corresponding candidate explanation.

Researchers provide a `presentation` alongside each complete candidate: `question`, `prior_work`, `gap`, `factor`, `support`, `outcome`, and `conditions`, each in one or two simple sentences. Here factor is G, support is H, and outcome is Y. For a Research method, factor explains both the shared idea and this researcher’s specific way of using it; the current fields must not hide the implementation choice. The orchestrator saves the final presentations with that meeting so later revisions do not rewrite past meetings. These display summaries never replace the complete evidence supplied to voters. For Research candidates, also show **Data, Method, Setup, Expected result, and What it could tell us**, using the concrete experiment design in the research model. Save these as `presentation.experiment` with `data`, `method`, `setup`, `expected_outcome` and `learning`. Unknown details stay visibly unknown.

Each candidate has a question box addressed to its researcher, alongside the general orchestrator question box. Replies can arrive while research waits. Show who is answering and preserve the full conversation with the meeting. After the vote, show **Waiting for your decision** and controls to choose a candidate, request further work or stop. Instructions may be empty. The vote does not change the active direction or start an experiment. After confirmation, show the saved decision and the team handoff; all researchers, the engineer, mathematician and orchestrator must receive the decision and conversations before the approved work starts. Keep meeting advice under details so the main page stays concise.

Use the meeting and voting rules in [communication.md](communication.md). Independently prepared candidates remain private until sharing. A selection means the next small investigation is worthwhile; it does not establish that the idea works.
## 5. Library view

The Library view uses the shared catalog defined in [library.md](library.md). The librarian maintains categories, locations, versions, and links, including summaries and checks supplied by their authors. The dashboard displays these same records.

Browse by research field or topic, and filter by material type: papers and reading packages, datasets, baselines and reusable tools, or topic notes. Allow switching between the shared library and material used by the current project without duplicating files.

Show each item's title, a short summary, and availability. Opening it shows source and file links, version, who acquired or read it, relevant checks and limits, and links to projects, methods, or experiments using it. Keep unavailable, unread, and unchecked material clearly marked; having a file does not mean it has been read or verified.

Library additions and important corrections link to their items from the timeline. The orchestrator routes catalog and location questions to the librarian, and questions about meaning or results to the agent responsible for that work.

For a missing paper, show one director request with the title, version, download link, reason it is needed, and exact local destination. After a file is supplied, confirm its identity and saved location before clearing the request. Keep downloaded, text-indexed and scientifically read as separate states; bulk imports do not mark papers read or used by every project.

## Dashboard interaction

The orchestrator coordinates the approved work without a deputy-mode switch. After each selection meeting, the human chooses the next action. The director can inspect progress, ask questions, change direction, and pause work.

Selecting a timeline entry, map node, experiment, meeting, or library item opens its linked details in the dashboard. Render Markdown as formatted content, including headings, lists, tables, links and equations; keep raw Markdown available as a download. Keep related evidence one click away and preserve earlier records as new work arrives.

Attach the director's questions and comments to the item being reviewed. The orchestrator routes them to the right agent and records replies and resulting decisions. Show pending questions and decisions clearly. Asking a question does not resume paused work. When a decision control is available, comments may be empty; save the selected action and update the affected tasks and records.

Keep stable map entries when the human asks for further work on an existing candidate. Show its current question and keep earlier drafts under Versions; meeting records retain the exact versions presented and voted on. A changed question needs an explicit replacement decision.
