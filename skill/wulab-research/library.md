# Library model

**Goal:** Help agents locate and reuse sources, notes, data, and code without duplicate downloads, repeated baseline work, or lost findings.

**Mindset:** The library stores the team's knowledge and reusable tools. The librarian organizes and tracks them; the agents who study or build them own their analysis and checks. Prepare detailed reading packages and reusable methods only when needed.

## Who does what

- **Librarian:** Acquire or import paper files and register sources supplied by agents. Maintain categories, versions, locations, availability, contributors, and links to saved notes and checks. Track pending acquisitions to avoid duplicate work. Answer catalog and location questions using existing records; do not analyze papers, judge scientific relevance, write research summaries, or test methods.
- **Researchers:** Search for and acquire missing sources, read them, judge relevance, and write summaries, interpretations, and topic notes. Check each other's important scientific claims and send the librarian the resulting records.
- **Engineer:** Acquire and prepare needed code, environments, and interfaces. Test reusable methods and document their usage, resource needs, results, and limits. Send these records to the librarian.
- **Everyone:** Check the catalog before acquiring or rebuilding material. Report new sources, reading completed, saved work, and corrections. Keep personal notes linked to shared records.

## What the library keeps

| Material | Contents | Prepared by |
| --- | --- | --- |
| Source record | Paper/data/code identity, version, location, access limits, who acquired it, and who read which parts | Librarian, using information supplied by agents |
| Reading package | Original or accessible pointer; relevant text, figures, tables, and supplements; summary of the question, method, findings, assumptions, and limits | Researchers |
| Reusable method | Fixed code version, environment, inputs/outputs, usage example, resource needs, and saved test results | Engineer |
| Topic notes | Connections between works, uses of G, alternative names, successes, failures, and remaining questions | Researchers |

Authors link important statements to source sections, figures, or results. Separate author claims, WuLab interpretations, and actual checks. The librarian preserves this attribution and records unavailable or unread material; cataloging an item does not verify its claims.

## From a source to reusable material

1. **Find and register.** Agents check existing records, local files and pending acquisitions first. Researchers identify needed papers or data; the engineer finds needed code. The librarian obtains one shared copy where possible, retaining the source link and exact version. A link alone is marked as a missing local file, not a downloaded paper.
2. **Prepare for reading.** Researchers create reading packages and concise notes for material worth detailed use. They check extracted text, equations, figures, and tables against the original and record omissions. The librarian indexes these packages and links them to their sources.
3. **Prepare selected methods for reuse.** The researcher specifies the purpose; the engineer prepares and tests the method. Prefer the authors' code and add only the interface needed to run it. A script may suffice; a callable tool can help repeated use. Label reimplementations and algorithm changes separately. Papers without code remain useful reading. The librarian records the implementation's location, version, and the engineer's usage notes and checks.
4. **Reuse and update.** The librarian returns existing records and links to the relevant notes or method. The responsible researcher or engineer answers questions about meaning, suitability, or behavior. Authors supply new findings and corrections, including failed adaptations. The librarian keeps versions and attribution, updates the catalog, and notifies agents using affected material.

## Use in both research stages

**Proposal:** Researchers request existing material from the librarian, then assess the closest work, recent progress, contrary evidence, and available data or baselines. They search outside the library for missing sources and hand them over for registration. Keep peers' unshared proposals out of retrieval replies until independent preparation is complete.

**Research:** Researchers continue searching within and across fields for ways to use G. They judge which methods fit Z; the engineer reuses or adapts selected code. The librarian tracks the resulting sources, versions, notes, and implementations. Researchers refresh literature searches when needed; the catalog alone cannot establish that a gap remains open.

## Shared storage

Use the lab's existing paths or register equivalent locations:

- `library/index.md` and `library/papers/<id>/<version>/`: source records, reading packages, and notes.
- `library/fields/`: shared foundations and topic notes, linked to original sources.
- `baselines/`: catalog and fixed versions of reusable methods.
- `data/catalog/`: data locations, versions, meaning, and access conditions.
- `projects/<project>/workspace/`: project settings, adaptations, runs, and results.

Projects link to shared material and keep their outputs separate. Requests to the librarian name the source, topic, or material needed. Replies give matching records, locations, versions, availability, and links to attributed notes and checks. If material is missing, say so; pass analysis questions to the agent who owns the relevant work.

## Local papers and director downloads

Keep PDFs in the shared library, with their file hash, source, version and original location. Existing collections can stay under `library/collections/` with their folders intact; new files enter `library/inbox/`. Import files in bulk using ordinary code: reuse identical files, keep different versions separate, and index text by page. Preserve supplied analysis files and their attribution. Importing or extracting text does not count as reading or verifying a paper. Do not ask agents to read hundreds of papers merely to fill the library.

Researchers search the local index first and read the relevant pages. Render original pages when equations, figures or extracted text need checking. The service must give workers read access to these files and tools; a catalog path without access is insufficient. Retrieve relevant passages instead of placing the whole collection in agent context.

If acquisition fails, the orchestrator sends one dashboard request with the paper title and version, download link, why it is needed, and exact destination under `library/inbox/`. Keep the request until the file is received and its identity checked; a “saved” reply alone does not prove availability. Import the received file, update its catalog location, and wake only the affected work. The director can supply a folder for bulk import or download individual requested papers.

From the lab root, use `python3 runtime/library/papers.py` (or its absolute path in your installation): `import FOLDER`, `search QUERY`, `show ID`, `read ID --pages 16-18`, and `render ID --page 17 --output FILE.png`. `fetch URL` runs in the network-enabled acquisition context, not a network-disabled worker shell. `request` prepares a saved request for the orchestrator to post with the existing dashboard request tool. The catalog keeps reading claims separate from file holdings.

## Reading handoff check

Each source-reading task supplies a source list alongside its proposal or notes: one record per cited paper/version, with its URL or shared catalog ID, title, actual reader, sections read, and access limits. Include sources that could not be opened, clearly marked unread. Proposal notes do not replace paper records. Reuse existing records and add the current project; register missing papers separately.

Use the current project-linked catalog records supplied with each task, including papers from earlier rounds. A round receipt lists that delivery only; its missing entry does not mean a paper is absent from the library. Check the catalog before requesting repeated registration or reading.

A revision may reuse earlier reading without adding papers. An empty source update means no catalog changes; save a receipt, preserve earlier records, and do not require new reading just to fill a list. This does not settle an unresolved scientific question or replace missing evidence.

The librarian saves and confirms these records. Before a meeting uses the reading, the orchestrator checks that every supplied source has a matching catalog record linked to this project and that reading limits were preserved. Include the actual records in meeting inputs, with their reading limits and delivery confirmation; a successful catalog receipt alone does not supply their contents. Missing metadata goes back to its author; failed access stays visible and does not count as reading. Use a script for these checks where practical.

## One delivery format

Researchers and engineers supply catalog fields and links; the librarian saves one JSON handoff using the same fields as the dashboard. No second version written as API commands is needed:

```json
{
  "schema_version": 1,
  "handoff_id": "project-reading-round-1",
  "items": [{
    "id": "paper-name-v1", "expected_revision": 0, "kind": "paper",
    "title": "Paper title", "summary": "Short description supplied by its reader",
    "source": "https://example.org/paper", "version": "v1",
    "project_ids": ["project-id"], "reading": "Sections actually read",
    "checks": "Not reproduced", "read_by": []
  }]
}
```

Use real values. `kind` is `paper`, `dataset`, `baseline`, `tool`, or `notes`. Each item needs a stable ID, title, summary, current project ID, and a source, path, or link. Optional catalog fields are `topics`, `path`, `availability`, `acquired_by`, `notes`, and `links` (each with `label` and `source`). `read_by` contains the actual readers’ agent IDs. Using a colleague’s summary does not count as reading the paper; say whose notes were used and keep the access limits. Carry another reader forward only when the same source/version has their saved reading record or a matching catalog entry. Preserve supplied reading limits, attribution, versions, and checks; do not invent missing analysis.

Check the catalog first: use `expected_revision: 0` for a new item, otherwise its saved revision. Reuse IDs for the same source/version; keep different versions and code adaptations distinct. Keep reading status and access comments out of the version identifier. An unpinned repository link is a pointer, not a reproducible code version. In controller-managed runs, researchers save `sources.json` as an object containing a `sources` list with the catalog fields above. The controller collects these files, checks their saved hashes, and uses `library_collect` to register the sources through the librarian before a meeting, without a model call. For an unambiguous prepared handoff, use the service’s `library_delivery` handler under the scheduling model; validation, copying and delivery need no model turn. Use the librarian model only to resolve missing metadata or conflicting identities and versions. Direct delivery is also available through `lab_library` with `action: "deliver"`, `workspace`, the librarian’s `agent_id`, and the saved JSON as `handoff`. The dashboard validates and saves all items together, returning their IDs and versions. Save that receipt beside the handoff and confirm it through `action: "receipt"` with `handoff_id` before completing delivery. The timeline uses the same catalog records.

After a lost response, retry the unchanged handoff with the same ID. For a correction or a version conflict, read the current records and save a new handoff ID. A receipt confirms catalog delivery, not file availability or scientific correctness; check local files separately.
