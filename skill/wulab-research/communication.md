# Communication model

Use independent preparation, peer discussion, and bounded voting to choose a shared direction. All research agents assigned to the project participate in meetings in both stages. The orchestrator coordinates; the engineer and mathematician attend as advisers. After human approval, the engineer implements the selected experiment and the mathematician handles any assigned mathematical work.

## Shared meeting process

Each selection has **one round** in both stages. There is no automatic revision, response round, repeat vote or tie-break by the orchestrator.

1. **Prepare independently.** Researchers receive the same goal and constraints. Each saves its own complete proposal or experiment design before reading peers' candidates. First read the project’s rejected candidates and the human reasons, including older meetings. Do not repeat them under new wording or with cosmetic changes. Use the feedback to guide further reading. Explain the nearest rejected idea, what is substantively different, and how the new evidence or design addresses the rejection. If the evidence supports reopening an old idea, label that request honestly for the human to decide; respect any instruction not to revisit it.
2. **Share and discuss once.** Read every candidate in round-table order. Researchers give brief, specific advice from their own viewpoints. The engineer joins to check data, runnable steps, comparisons and cost. The mathematician joins to check assumptions, arguments and what the experiment can establish. Both are advisers and receive the full candidates; they do not wait for an implementation handoff to learn the work. Reviewers check for repeats of rejected work and whether the claimed differences address the human feedback.
3. **Vote once.** After the discussion, each researcher independently chooses the most useful next small investment, or **none is ready**, with one or two short sentences explaining why. Supply the full unchanged candidates and all meeting advice to every voter. Reveal votes together. Unknown benefit alone is not a reason to reject a useful affordable test. Keep genuine scientific, data and resource concerns visible. These votes advise the human; they do not approve work.
4. **Wait for the human director.** Save the meeting and votes on the dashboard. The director can ask each researcher about its own candidate and choose any candidate, request another task or meeting, or stop. A tie or a none-is-ready result also waits for the director. The orchestrator records and carries out the human decision; it does not choose on the director's behalf.
5. **Share the decision and conversations.** Before new work starts, every researcher, the engineer, mathematician and orchestrator receive the saved decision and all human–agent questions and answers from the meeting. Confirm that each has received and read this handoff. Include late answers before releasing the next task. A question or answer alone never approves work.

If more reading or another candidate is needed, explain the missing evidence and suggest a focused next step to the human. A new meeting starts only after the human requests it; it is not another round of the old selection. Preserve earlier candidates, discussions and votes.

Keep each spoken-style contribution to about 80–120 words when that is enough to explain it clearly: the main point, its reason, and the suggested change. In peer review, give one useful concern and change per peer; briefly say when there is no new concern. Skip repeated background, checklists and reading receipts. Add detail only when a disagreement, uncertainty, calculation or requested explanation could change the decision; keep it in a linked document. Do not force equal speaking lengths or block delivery for exceeding this writing target. Keep complete proposals and decision evidence available to peers. A short reply is enough for a simple question. Read the full document when the decision depends on it. The orchestrator saves the candidates, vote counts, reasons and unresolved concerns, then records the human decision and its assignments. Preserve alternatives for later consideration. A vote recommends what to pursue; it does not establish scientific truth or grant new work permission. Record infeasibility or missing evidence even when a candidate wins.

## Clear writing for every role

This applies whenever an agent writes: titles, assignments, status updates, timeline entries, summaries, presentations, questions, replies, vote reasons, library notes and documents. Write for a non-expert director and peers from other specialties, without assuming knowledge of the field. Lead with what you did or plan to do, what you learned or still do not know, and what happens next. Use short, complete sentences instead of packed lists of technical terms. For example, say “check whether the order of earlier runs matters” instead of “isolate chronology value.” Keep plans, completed work and uncertain findings clearly distinct. Start with a concrete situation the reader can picture: what happens, what current methods miss, and what we want to find out. Use a small example to explain an abstract idea; introduce its technical name only after its meaning is clear. Use everyday verbs and familiar quantities. Explain unfamiliar terms, acronyms and symbols before using them; a shorter technical synonym is not an explanation. Keep examples vivid but scientifically faithful, and label imagined examples or intuition as such.

Replace the mindset’s letters with actual concepts and descriptive headings. Explain the proposed change, why it might help, what we will measure, and what remains uncertain. Scope claims to the methods and evidence actually checked; do not turn a limitation of one approach into a claim about the whole field. Put equations and implementation detail after the intuitive explanation. Before sharing, check that a non-expert can explain the problem, the proposed steps and what would improve. For example, describe an extra ideal correction using error-free measurements before calling it “perfect recovery”; explain what this extra step changes in the comparison. A few extra clear sentences are welcome.

## Use in each stage

Follow [research.md](research.md) for the stage definitions, scientific criteria, and when to reconsider the question. Use the shared meeting process above:

- **Proposal Stage:** Compare independently prepared proposals and select one research question for the next bounded investment. State the uncertainty that step should resolve; do not require the final method or its benefit to be established.
- **Research Stage:** Give every researcher the same short brief stating the selected idea, measured outcome and test conditions in actual words. Each independently designs a concrete experiment using that idea: name the data, method steps, setup, expected outcomes and what each outcome would tell us; do not divide a single method into competing role-based pieces. Start each candidate with the shared goal and its specific implementation choice. Peers check that differences are implementation choices, not different goals or isolated components. Each researcher keeps responsibility for its own complete candidate until the vote. If drafts overlap, acknowledge it and look for useful alternative implementations; do not create cosmetic differences or merge everyone into one method before selection. Agree on a common comparison before voting, and collect useful component suggestions as tasks within the chosen method. Give implementation to the engineer and mathematical questions to the mathematician. Researchers, the engineer and mathematician meet again to assess results. The human chooses the next action.

## Reconsidering the question

Any agent can raise a concern about the research question and share supporting evidence. Researchers assess it independently, then discuss and vote on whether to stay in Research or return to Proposal. Use one discussion and one researcher vote; “none is ready” means the evidence does not support either choice. The human decides whether to stay, return, gather specific evidence or stop. Keep affected work paused until that decision and the shared handoff are complete.

Use the scientific criteria in [research.md](research.md). Staying in Research requires a worthwhile, unanswered question and a feasible next step. Pause affected work immediately when a real constraint prevents it; voting cannot remove that constraint or make an answered question unresolved.

## Engineer handoff

The engineer and mathematician review the complete experiment designs in the meeting before voting. After the human chooses, give them the selected design, meeting advice, human conversations and decision. The engineer must not have to guess missing data, steps or comparisons; ask a focused question before dependent work.

The engineer implements and checks the method, runs the agreed tests, and returns code/settings, results, errors, and costs for the researchers' meeting. It owns a functioning experiment: diagnose implementation failures, attempt concrete repairs within the allowance, and check whether the affected test actually works before escalating. Reuse saved code and results. Keep an exact record of attempted repairs, their outcomes and any remaining missing input. Complete independently valid assigned tests when a prerequisite blocks only another part. Successful software checks alone do not complete an unperformed scientific comparison. A measured negative or inconclusive finding is a valid experiment result; never search for favorable seeds or change the comparison to force success. It asks researchers about ambiguities or scientific changes rather than silently changing the question or evaluation.

## Mathematical work

Researchers give the mathematician a clear question, its research purpose, the relevant method, and known assumptions. The mathematician owns the arguments, proofs, counterexamples, and limits. It reports in simple language when a result is ready, an obstacle appears, or the mathematics calls for changing the method. State the assumptions, conclusion, supporting argument, and unresolved issues.

During this work, researchers act as observers and voters: ask questions, assess the implications, and vote on the next research action. They do not divide up the derivation. Voting cannot establish that a proof is correct. Important claims need suitable checks, such as qualified peer examination or formal verification where practical; unchecked claims remain provisional.

## Responsibilities

- **Researchers:** Define the method and tests, interpret evidence, check each other's reasoning, and own scientific conclusions. During mathematical work, act as observers and voters.
- **Mathematician:** Own mathematical arguments and their checks; explain results, assumptions, and limits to the researchers.
- **Engineer:** Own implementation, technical checks, and execution of agreed tests. Return enough records to reproduce the results and report failures honestly.
- **Librarian:** Locate cataloged sources, notes, and methods under [library.md](library.md). Return records and links; leave analysis to the responsible researcher or engineer. Do not share peers' unshared candidates during independent preparation.
- **Orchestrator:** Coordinate meetings, wait for and record the human choice, share the conversations and assignments, and keep work within the agreed question, scope, and resources.

Agents send direct, focused questions to the relevant specialist through the saved request process in [scheduling.md](scheduling.md). A paused or sleeping researcher can answer a requested question or join a meeting without resuming its research.

Computational testing is shared: researchers decide what would make a fair and useful test; the engineer carries it out; researchers decide what the result supports.
