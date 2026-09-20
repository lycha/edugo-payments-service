---
name: gap-interrogation-capture
description: Turn the raw output of a real gap-interrogation workshop — transcript, meeting notes, whiteboard photo, Miro board, or bullet points — into a structured decisions.yaml, and update every downstream document that depends on it. Use when the user has already held the session and has notes or a recording to process, or says things like "here's the transcript", "we ran the workshop", "process my notes", "capture what we decided", or shares a recording alongside a feature inventory. Reconciles what was discussed against what was harvested, in both directions. This skill records what was said — it never decides what was not.
allowed-tools: Read, Write, Glob, Grep, AskUserQuestion
---

# Gap Interrogation — Capture

Phase 2 of prototype-to-spec, after a real session.

Humans hold the workshop; this turns its residue into structured artefacts and propagates them. Transcripts are messy, ambiguous, and full of half-finished thoughts. The entire difficulty is telling a **decision** apart from a **proposal that nobody responded to**.

**Output contract:** `decisions.yaml` with `mode: workshop-captured`, identical in structure to `gap-interrogation-solo`. Downstream spec writing does not care which produced it.

---

## The one rule

**Record what was decided. Never decide what was not.**

A transcript contains proposals, options, thinking-aloud, and decisions, interleaved and rarely marked. Promoting a proposal to a decision is the failure mode of this skill, and it is silent — the artefact looks complete and is wrong.

When the evidence is ambiguous, mark it `capture_confidence: ambiguous` and **ask**. Never resolve ambiguity by picking the reading that produces a tidier document.

---

## Inputs

| Artefact | Notes |
|---|---|
| Transcript | Otter, Granola, Zoom, Meet — speaker labels help but are not required |
| Meeting notes | Bullets, prose, anything |
| Whiteboard photo | Read the image directly |
| Miro board | Via the Miro connector if available |
| Voice memo transcript | Expect heavy ambiguity; confirm more |

Plus, always: `<artefact-tree>/features/<feature>/feature-inventory.yaml` — the absence and conflict IDs are the checklist the session was working against.

If the inventory is missing, stop and say so. Without it there is nothing to reconcile against and the output is just reformatted notes.

---

## Process

### Step 0: Locate the artefact tree

All specification artefacts live in a **separate git tree** from the code. Resolve its root before doing anything else — env `AEOS_ARTEFACT_TREE`, then project config, then a sibling `*-specs` directory, then **ask**. Never fall back to the working directory, and never write specification artefacts into the code repo.

Record artefact-tree `HEAD` now; you will need it to detect concurrent writes before committing. See `references/artefact-tree.md`.

### Step 1: Load both sides

Read `feature-inventory.yaml` (conflicts and absences with their IDs) and the session artefact. Read `assumption-register.yaml` from the artefact tree if present.

### Step 2: Extract candidate outcomes

Walk the artefact and pull every passage that looks like a resolution. For each, capture the **verbatim supporting text** — you will need it for the confidence judgement and the user will need it to confirm.

### Step 3: Map to inventory IDs

Match each candidate to a `Q-n`, `CON-n` or `ABS-n`.

**Questions resolve differently.** A question is an unknown about the sources, not a product decision, and answering one often reclassifies it. Map question outcomes to `ANSWERED`, `RECLASSIFIED`, `ESCALATED`, or `DROPPED`. A RECLASSIFIED question must produce a new `CON-n` or `ABS-n` — if the session answered a question and then discussed the thing it became, capture both, linked.

**Attempt research for unanswered questions.** Any `researchable: true` question the session never reached can often be settled by reading the code. Do that and record `answered_by: research` rather than reporting it as still open. Matching is by topic, not by anyone having said the ID aloud — real sessions never do.

**Unmatched in both directions, and both matter:**

- **Inventory item never discussed** → still open. Do not silently drop it. These are the gaps the session ran out of time for, and they are exactly what an agent will hallucinate into.
- **Decision about something not in the inventory** → **the harvest missed something.** Record it as a new finding and report it as feedback to `prototype-harvest`. This is how the harvester improves.

The second is the more valuable output. A session that only ever discussed harvested items means either a very good harvest or a session that never went off-script — and it is usually the second.

### Step 4: Classify and rate confidence

Assign each mapped item an outcome — `RESOLVED`/`RECONCILED`/`SPLIT`/`ESCALATED` for conflicts, `DECIDED`/`DEFERRED`/`ASSUMED`/`ESCALATED` for absences — and a confidence:

| Confidence | Means | Action |
|---|---|---|
| `explicit` | Someone stated the decision and nobody contradicted it | Record |
| `inferred` | Clear from context, never stated in one piece | Record, flag in report |
| `ambiguous` | Could be a decision or a floated option | **Ask before recording** |

**Signals of a proposal rather than a decision:**
- Conditional framing — "we could", "one option is", "what if we"
- No response from anyone else
- Contradicted later and never reconciled
- Trailing off, or a topic change mid-thought

**Signals of a genuine decision:**
- Stated flatly, in the present or future indicative
- Acknowledged by another participant
- Referred back to later as settled
- Someone recorded an action from it

Attribution matters too: a facilitator restating an option is not the same as a founder choosing it.

### Step 5: Fill required fields

Real sessions skip these constantly. Ask rather than invent:

| Outcome | Missing field | Ask |
|---|---|---|
| ASSUMED | `revisit_when` | "What would tell you this assumption was wrong?" |
| ESCALATED | `owner`, `due` | "Who owns this, and by when?" |
| RESOLVED | `debt_created` | "What does this decision oblige someone to change?" |
| DECIDED | one-sentence statement | Offer a draft from the transcript, ask to confirm |

Batch these into a single round of questions rather than interrupting per item.

### Step 6: Write

Write `<artefact-tree>/features/<feature>/decisions.yaml` per `<artefact-tree>/schemas/decisions.schema.json`, validating before commit, with `meta.mode: workshop-captured`, `meta.source_artefact`, and `capture_confidence` on every entry.

### Step 7: Propagate

Update the documents that depend on these decisions:

| Document | Update |
|---|---|
| `<artefact-tree>/assumption-register.yaml` | Append every ASSUMED entry |
| `feature-inventory.yaml` | Mark resolved items; add findings the session surfaced |
| `contexts/<context>/glossary.md` | Apply vocabulary resolutions from RESOLVED/RECONCILED/SPLIT conflicts |
| `contexts/<context>/CONSTRAINTS.md` | Add any architecture constraint the session agreed |
| Task tracker | One task per `debt_created` entry, with its owner — **outside** the artefact tree |

All artefact-tree edits land in a **single commit** so the specification moves atomically:

```
decide(<feature>): 3 conflicts resolved, 18 absences closed (workshop)

Inventory: <artefact-tree sha>
Source: notes/2026-07-29-session.md
Refs: CON-9, ABS-4, ABS-5
```

If artefact-tree `HEAD` moved since Step 0, re-read the affected files and merge — never overwrite a concurrent write. Commit; never push.

For glossary and constraints changes, **show the diff and confirm before writing.** These are project-wide and a misread transcript propagates further than a wrong `decisions.yaml`.

### Step 8: Validate and report

- [ ] `meta.mode: workshop-captured` and `source_artefact` recorded
- [ ] Every question has an outcome
- [ ] Every RECLASSIFIED question's new CON/ABS is present and resolved
- [ ] Every entry has `capture_confidence`
- [ ] No `ambiguous` entry was recorded without confirmation
- [ ] Every ASSUMED has an observable `revisit_when`
- [ ] Every ESCALATED has an owner and date
- [ ] Every RESOLVED/RECONCILED has `debt_created` with owners
- [ ] Unmatched inventory items are listed as still open
- [ ] Off-inventory decisions are reported as harvest feedback

**Report, in this order:**

1. **Inventory items the session never reached** — still open, and the most likely source of downstream surprise
2. **Decisions made about things not harvested** — feedback for `prototype-harvest`
3. Everything recorded as `inferred` — worth a second pair of eyes
4. Conflicts resolved and debt created, with owners
5. Documents updated
6. Stories now ready for spec writing

Lead with what is still open. A capture that reports only what was decided reads as complete and is the more dangerous artefact.

---

## What this skill does NOT do

- Decide anything the session did not
- Resolve ambiguity by choosing the tidier reading
- Write acceptance criteria
- Invent `revisit_when` triggers, owners, or dates
- Silently drop inventory items the session never reached

---

## Tips for Best Results

- **Speaker labels change the reading.** The advocate floating an option and the adversary conceding one are different events. Where labels exist, use them.
- **The end of a session is the least reliable part.** People compress, agree quickly, and stop challenging. Rate late decisions `inferred` more readily.
- **"We'll figure it out during implementation" is ASSUMED, not DEFERRED.** Deferred means explicitly out of scope; this is a guess with no trigger attached.
- **A session with zero off-inventory decisions is worth questioning.** Either the harvest was excellent or nobody went off-script.
- **Photographs of whiteboards lose ordering.** Ask which cluster was resolved first if the sequence matters to the reading.
