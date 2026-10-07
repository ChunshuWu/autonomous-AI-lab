# Research model

Work in two stages: **Proposal** chooses a worthwhile, feasible question; **Research** develops and tests ways to use the proposed idea. Use simple language and link central claims to their sources or results.

Use literature, externally obtained data, mathematics, code, and simulation. WuLab does not operate physical experiments or devices. Work within the agreed scope and resources. For team work, use [communication.md](communication.md) to select proposals and methods, assign implementation, and review results together. Use [library.md](library.md) to find and reuse sources, methods, and saved knowledge in both stages.

## 1. Proposal Stage

**Goal:** Choose a significant, narrow, unresolved question that deserves the next small investment of research effort, with obtainable data and a credible path to affordable study.

**Mindset:**

> In field A, a set of approaches, including B, C, D, and others, has made progress on related problems. However, question E′ remains insufficiently addressed. Existing work F covers part of it, while G remains underexplored. H suggests that G could materially affect Y. We therefore ask whether and how G can improve or explain Y under conditions Z.

1. **Understand the relevant progress.** Read the closest work, including recent results and necessary foundations. Identify which problems were addressed, how, and under what conditions. A paper's suggested future work is a lead to check, not automatically a good research gap.
2. **Identify the remaining question.** State what is insufficiently addressed and why resolving it would matter. Check whether other work already answers it, including work that addresses it partly or under different conditions. Distinguish demonstrated limitations from untested possibilities.
3. **Identify a promising factor G.** Explain how G might affect a meaningful outcome Y under conditions Z. Support the motivation with H: a result, argument, observation, analogy from another field, or clearly labeled intuition. An intuition can justify investigation; it does not establish that G works. Check whether G has already been studied in this setting.
4. **Check feasibility.** Estimate the computing resources and cost needed for a credible study, using similar work as a guide. Identify suitable data already available or a checked route to acquire them. Separate known constraints from uncertainty that a small check can resolve. Estimate the full study cost honestly, but require affordable, useful progress at the next step, not measured full-study runtime, a finished implementation, or proof that G helps. Name that step, its budget, what it would tell us, and when to stop. A known lack of necessary data, unaffordable minimum study, or evidence that the question is already answered remains a reason to narrow or change the proposal.

G can be information, a mechanism, an assumption, or a method component. Y can be performance or a precise scientific conclusion; Z specifies the setting and assumptions. Do not force a causal story where only an exploratory question is justified.

**Output:** One concise proposal using the mindset above.

Use as many approaches as needed; omit F if none was found and state the search limits. Replace the letters with actual concepts. Use descriptive headings such as “Research question”, “Proposed idea” and “What we will measure”, not “G/Y/Z”. Begin with a plain-language explanation for a non-expert who may not know the field; define unfamiliar terms and use a small example when helpful. Put necessary technical detail after that explanation. Briefly answer these questions:

- Which papers or methods are most relevant, and what do they leave unanswered?
- What data and computing resources do we need? Can we get the data and afford the work?
- What results would be enough to answer our research question, even if G does not help?
- What is still uncertain about data access or computing cost? Could it make the proposal unrealistic?

Select a proposal when the question matters, the closest work leaves it open, and a bounded next step can usefully reduce uncertainty within the allowance. If a feasibility check is needed to make that choice, the engineer can do it during Proposal under the scheduling model. Enter Research when the human director approves the question and next investment after the meeting. Selection does not establish that G works or commit the lab to the full study. Reuse an established question and plan when they still meet these conditions.

## 2. Research Stage

**Goal:** Find a way to use G that meets the agreed goal for Y under Z, with acceptable cost.

**Shared focus:** Everyone works on the selected G, the same primary outcome Y and agreed comparison conditions Z. Each researcher independently develops its own complete method to use G, explains its steps and meaningful implementation choices, as a concrete experiment design. The researchers discuss once and vote; the human director chooses the next step before the engineer implements an approved design. Do not combine everyone into one method before this vote. A decoder component, mathematical argument or test plan is a task within a method, not a competing method by itself. Clarify an ambiguous outcome or setting together before comparing methods. Control tests may remove G or vary conditions to check the explanation and limits; label them separately. Changing the central question requires the reconsideration process below.

**Experiment design:** Each candidate must clearly answer:

- **Data:** Which dataset and version, which samples, and how will they be obtained or generated?
- **Method:** What are the ordered steps for using the shared idea? What changes from the baseline?
- **Setup:** Which baseline, data split or time order, controls, settings, measures, repetitions and uncertainty checks will make the comparison fair? What resources are needed?
- **Expected outcome:** What do we predict, and what would a useful negative or inconclusive result look like? Predictions are not findings.
- **What we learn:** What would each outcome tell us about the question, and what would it leave unresolved?

Use simple language first, then the exact settings needed to run the test. Say when an input or setting is unknown and how it can be resolved. Do not replace a design with a broad idea or invent missing details. The engineer and mathematician help check the design in the meeting.

**Mindset:**

> G is a promising starting point; there may be several ways to use it. Understand how it could help, identify what limits existing methods, and develop practical options. Implement a simple promising option, test it, and use the results to refine it or try another. For an option that works, check that its benefit comes from G and establish its limits and cost.

1. **Set up the investigation.** Use the agreed question and success criteria to prepare the data, baseline, and evaluation procedure, or the mathematical setup for theoretical work. Check that the setup can reliably answer the question.
2. **Understand how G could help.** Identify the biggest scientific unknown about how G affects Y under Z. Compare possible explanations and choose a first small analysis, derivation, or test that could distinguish them. Use what it tells us to guide how we use G.
3. **Learn from related work and develop options.** Throughout Research, seek relevant work in the same field and other fields. Look for how others use G, or a similar idea under another name, to improve Y or a comparable outcome. Check what worked, what failed, and whether the assumptions, data needs, and costs fit Z. Use these lessons to develop or adapt ways to use G, explaining why each promising option might help. If existing work already answers our question under the same conditions, acknowledge the evidence and ask the team to reconsider the question through [communication.md](communication.md#reconsidering-the-question). If the answer is only partial or the conditions differ, state what remains unresolved before deciding whether the current proposal needs to change.
4. **Implement the selected option.** Researchers recommend a promising option through the meeting process; the human director chooses it, applying Occam's Razor: prefer the simplest option likely to meet the goal. They explain the intended change and agree on comparison settings, measures, budget, and stopping point. The engineer builds and checks the implementation; one mathematician develops mathematical arguments when needed. Researchers specify the mathematical question, observe progress, ask questions, and vote on the next research action.
5. **Test the benefit and its explanation.** Researchers design fair comparisons against relevant methods, including removing, replacing, or varying G where appropriate. The engineer runs the agreed tests and returns the results and costs. Researchers assess whether the gain comes from G or unrelated changes in information, tuning, or computation. A better score alone does not establish the explanation. Explanation is optional if the benefit is statistically sound; state when its cause remains uncertain.
6. **Refine, try another option, or conclude.** Use results to identify what limits the current option and choose the next change or alternative within the agreed budget. Verify promising findings with fresh evidence or an independent argument as appropriate. Determine where the method works, where it fails, and its cost.

Keep a short record for each round: **option and prediction → implementation/test → evidence → interpretation → next step**. Preserve failed attempts and uncertainty.

**Output:** A tested way to use G, with evidence that it meets the agreed criteria, an explanation when supported, limits, and costs. If none of the tested options works, report what was tried, what was learned, and what remains unresolved. Failure of one implementation does not establish that G cannot help.

Propose returning to Proposal if the central question loses its value or feasibility, or a different question is needed. Researchers discuss and vote; the human director decides through [communication.md](communication.md#reconsidering-the-question). Trying a different way to use G for the same agreed question stays within Research.
