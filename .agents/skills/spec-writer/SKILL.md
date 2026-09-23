---
name: spec-writer
description: Turn a resolved decisions.yaml into the specification — EARS acceptance criteria, Gherkin scenarios, invariants, and non-goals — with every criterion traceable back to the decision that produced it. Use after gap-interrogation has produced a decisions.yaml with no open blocking items, or when the user asks to write the spec, draft acceptance criteria, generate Gherkin, or turn decisions into requirements. Trigger on "write the spec", "generate the criteria", "turn these decisions into requirements", "draft the Gherkin". This skill transcribes decisions into specification form — it never invents requirements the decisions do not contain. Do NOT use it to make product decisions or to generate code.
allowed-tools: Read, Write, Glob, Grep
---

# Spec Writer

Phase 3 of prototype-to-spec. Turn resolved decisions into the specification that contracts, tests, and agents consume.

Every DECIDED absence already has an `AC` ID assigned. Every DEFERRED absence has a `NON-GOAL` ID. The gap interrogation did the deciding; this skill does the **transcribing** — into a form that is precise, traceable, and machine-checkable.

**The output is the review surface for the whole feature.** A Product Engineering Architect reads the spec, not the code. Optimise for a human reading it in one sitting and an agent implementing from it without guessing.

---

## The one rule

**Transcribe decisions. Never invent requirements.**

Every acceptance criterion traces to a `decisions.yaml` entry by ID. If writing the spec surfaces a requirement the decisions do not contain, that is not a gap for this skill to fill — it is a gap in the decisions, and it goes back to gap-interrogation.

When a DECIDED resolution is too vague to become a testable criterion — "handle errors gracefully" — do not sharpen it by choosing what graceful means. Flag it as `underspecified` and return it. Sharpening it here is deciding, and deciding here is the oracle inside the loop.

---

## Inputs

Read from the **artefact tree**:

- `features/<feature>/decisions.yaml` — the source. Nothing is authored that isn't here.
- `features/<feature>/feature-inventory.yaml` — for the data model behind invariants and for AC traceability back to screens.
- `contexts/<context>/glossary.md` — ubiquitous language. Every term in the spec uses the glossary's word, not a synonym.
- `assumption-register.yaml` — ASSUMED items become criteria too, tagged as resting on an assumption.

**Precondition:** `decisions.yaml` must have no open blocking items. Run `lint_decisions.py` first; if it errors, stop and report — a spec built on unresolved decisions is a spec built on sand.

---

## Process

### Step 0: Locate the artefact tree and validate inputs

Resolve the artefact-tree root (see `references/artefact-tree.md`). Record `HEAD`.

Run the linter against the feature:

```
python schemas/lint_decisions.py features/<feature> \
  --register assumption-register.yaml --schemas schemas/
```

**If it errors, stop.** Report the errors and do not write. The decisions are not ready.

### Step 1: Partition the decisions

Sort every resolved item by what it becomes:

| Source outcome | Becomes |
|---|---|
| DECIDED absence | An EARS acceptance criterion |
| DECIDED conflict (behavioural) | An EARS acceptance criterion |
| ASSUMED absence | An EARS criterion, tagged `assumption: ASM-n` |
| DEFERRED absence | A non-goal |
| SPLIT conflict | Two glossary entries + criteria for each concept |
| RECONCILED/RESOLVED vocabulary conflict | A glossary update (see Step 5) |
| ESCALATED (still open) | **Nothing yet** — the criterion it blocks is marked `blocked-by: <id>` |

Anything still ESCALATED means the spec is partial. Write what you can and list the holes explicitly.

### Step 2: Write EARS criteria

One criterion per DECIDED item, in the pattern that fits. Preserve the ID.

| Pattern | Shape |
|---|---|
| Ubiquitous | The `<system>` shall `<response>` |
| Event-driven | When `<trigger>`, the `<system>` shall `<response>` |
| State-driven | While `<state>`, the `<system>` shall `<response>` |
| Unwanted | If `<condition>`, then the `<system>` shall `<response>` |
| Optional | Where `<feature>`, the `<system>` shall `<response>` |
| Complex | Combinations, for genuinely conditional behaviour |

Rules:
- **Use the glossary term, always.** If the decision says "brief" and the glossary says "brief", the criterion says "brief" — never a synonym that crept in from the PRD.
- **One criterion, one behaviour.** If a decision resolved two behaviours, it produces two criteria sharing a parent ID (`AC-12a`, `AC-12b`).
- **Testable or it isn't done.** Every criterion must admit a pass/fail test. If it doesn't, it is `underspecified` — flag and return, do not sharpen.
- **Carry the decision's exact bounds.** "Flip to absolute after 7 days" stays 7 days. Do not round, generalise, or improve the number.

See `references/ears-patterns.md` for pattern selection and worked transcriptions.

### Step 3: Decision tables for conditional logic

Where a decision has more than three interacting conditions, EARS becomes unreadable and agents misparse the nesting. Emit a decision table instead (`decisions/<name>.md` as a markdown table, or DMN if the project uses it). Reference the AC IDs it implements.

### Step 4: Write Gherkin scenarios

Not for every criterion — for the flows worth exemplifying. Each scenario is tagged with the AC IDs it covers, so coverage is mechanical.

- One `.feature` per coherent flow
- `@AC-12 @AC-13` tags above each scenario
- Concrete example values, drawn from the inventory's real data shape — never `foo`/`bar`
- Cover the unwanted-behaviour criteria explicitly; happy-path-only Gherkin is how error handling rots

See `references/gherkin-style.md`.

### Step 5: Invariants

The thing EARS and Gherkin both miss. An invariant is what must always hold regardless of path — and for async products these are usually about ordering and convergence.

Derive invariants from:
- SPLIT conflicts that revealed distinct concepts with distinct rules
- Data relationships in the inventory ("a digest's entry count equals its visible entries")
- Any DECIDED item phrased as "always" or "never"

Write each as a checkable statement with an `INV` ID. These feed property-based test generation downstream, so phrase them as properties, not prose: quantified over inputs, decidable.

### Step 6: Apply vocabulary resolutions

For every RESOLVED/RECONCILED/SPLIT vocabulary conflict, update `contexts/<context>/glossary.md`:
- RESOLVED/RECONCILED → the canonical term, with retired terms listed as "not: X, Y"
- SPLIT → two entries, each defining one concept and naming the other as distinct

**Show the glossary diff and confirm before writing.** The glossary is project-wide; a wrong edit propagates further than a wrong criterion.

### Step 7: Assemble spec.md

Structure, in order:
1. **Feature** — one paragraph, what and why, from the decisions
2. **Ubiquitous language** — the terms this spec uses, linked to the glossary
3. **Acceptance criteria** — EARS, grouped by area, each with its ID and source decision
4. **Invariants** — the always-true statements
5. **Non-goals** — DEFERRED items, stated as what this does not do
6. **Open** — ESCALATED items still blocking, with owners and what they block
7. **Assumptions in force** — ASSUMED items the spec rests on, with revisit triggers

### Step 8: Write, validate, commit

Write `features/<feature>/spec.md` and `features/<feature>/features/*.feature`.

Validate:
- [ ] Every DECIDED decision produced exactly one criterion (or a parent with children)
- [ ] Every criterion's ID matches its source decision's `becomes`
- [ ] Every criterion uses glossary terms, no synonyms
- [ ] Every criterion is testable, or flagged `underspecified` and returned
- [ ] Every DEFERRED item appears as a non-goal
- [ ] Every ASSUMED-derived criterion is tagged with its `ASM` ID
- [ ] Every ESCALATED item appears under Open, nothing silently dropped
- [ ] Every Gherkin scenario tags at least one AC
- [ ] No criterion introduces a requirement absent from decisions.yaml
- [ ] Numeric bounds match the decision exactly

Commit to the artefact tree:

```
spec(<feature>): 18 acceptance criteria, 4 invariants, 3 non-goals

Decisions: <artefact-tree sha>
Refs: AC-1..AC-18, INV-1..INV-4
```

If artefact-tree `HEAD` moved since Step 0, re-read and merge. Commit; never push.

### Step 9: Report

- Criteria written, grouped by area
- Invariants derived
- Anything returned as `underspecified` — the decisions that need re-interrogation
- Open escalations still blocking parts of the spec
- Assumptions the spec rests on
- Glossary changes applied

Lead with `underspecified` returns. A spec that quietly invented answers to vague decisions is the dangerous artefact — it looks complete and encodes guesses as requirements.

---

## What this skill does NOT do

- Make product decisions, or resolve anything left open
- Sharpen a vague DECIDED resolution by choosing what it means
- Invent requirements, edge cases, or criteria not traceable to a decision
- Generate code, contracts, or schemas (Phase 4, downstream)
- Write tests (derived from criteria later, by generation)

---

## Tips for Best Results

- **The ID is the spine.** `ABS-5 → AC-12 → INV-2 → @AC-12 in the .feature → test`. If a criterion has no traceable source ID, it should not exist.
- **A criterion you can't write a failing test for is not a criterion.** It is a returned decision. Resist the urge to make it testable by inventing the missing detail.
- **Numeric drift is the silent failure.** "About a week" is not "7 days". Carry the decision's exact figure; if the decision was vague about it, the decision is underspecified.
- **Invariants are where the real correctness lives.** EARS covers what happens on triggers; invariants cover what must never stop being true. For an async product they are the most valuable output — spend time here.
- **If you're transcribing a lot and returning nothing, look harder.** Real decision sets almost always contain one or two resolutions too vague to be criteria. Finding zero usually means you sharpened them silently.
