---
name: prototype-harvest
description: Extract a structured specification inventory from an HTML prototype or design handoff — screens, states, interactions, data fields, transitions, and critically what is MISSING. Use this skill whenever the user hands over a prototype, mockup, design handoff, or HTML/Figma export and wants to turn it into specs, requirements, acceptance criteria, or tickets. Trigger on phrasing like "here's the prototype", "designs are ready", "Parker sent the handoff", "break this design down", "what do we need to build this", or when a design artifact appears alongside user stories. Do NOT use this skill to generate components or code from designs — this skill produces a specification inventory, never implementation.
---

# Prototype Harvest

Turn a design handoff into a machine-readable specification inventory that a human can review in ten minutes, and that feeds requirements writing, contract definition, and agent handoff.

A prototype is two things at once: **an under-extracted specification** (it already encodes screens, states, data shape, and transitions that teams routinely throw away and re-derive) and **a dangerous illusion of completeness** (it shows the happy path for one role at one moment, and says nothing about conflict, permissions, failure, or staleness).

This skill exploits the first and defends against the second.

---

## Guiding Principles

- **Extract, never infer** — Every entry traces to something observable in the source. Anything you worked out goes in `questions`, not the inventory.
- **Absence is the most valuable output** — What the prototype does not show is what an agent will hallucinate. The `absences` section is the point of the exercise.
- **Filler is flagged, not implemented** — Lorem ipsum, three hardcoded users, placeholder counts. Mark them, so nobody ships them.
- **Vocabulary drift surfaces immediately** — Every label maps to a glossary term or is marked `UNMAPPED`.
- **The inventory is the review surface** — A human reviews this file, not the prototype. Optimise for reading.
- **This skill produces no code** — Not components, not JSX, not CSS. Output is YAML.

---

## Process

### Step 1: Locate and pin the source

Identify the prototype files. Then **pin the revision**:

```bash
git -C <design-repo> rev-parse HEAD
```

Record the commit SHA in `meta.source.commit`. A spec derived from an unpinned prototype will silently drift when the designer pushes again. If the source is not in git, say so explicitly and record a file hash instead.

If the source is Figma rather than HTML, prefer the Figma node tree over rendered markup — component names, variants, and auto-layout carry semantics that divs do not.

### Step 2: Check for a glossary

Look for `glossary.md` in the bounded context. If none exists, proceed but flag it: every `data.glossary_term` will come back `UNMAPPED`, and vocabulary drift between design, API, and schema is one of the most expensive defects to fix late.

### Step 3: Extract the inventory

Walk the prototype systematically and populate each section of the schema in `reference/inventory-schema.yaml`:

| Section | What to capture |
|---|---|
| `screens` | Every distinct view |
| `states` | Every distinct state of each view present in the source |
| `interactions` | Every control, its label, apparent action, destination |
| `data` | Every field displayed or edited — candidate entity attributes |
| `transitions` | The state machine the prototype implies |
| `filler` | Placeholder content that must not be implemented |

Mark every entry `confidence: observed` or `confidence: implied`. Observed means it is literally in the markup. Implied means you reasoned about it — and implied entries are review targets, not facts.

### Step 4: Run the absence checklist

Work through `reference/absence-checklist.md` in full. Do not skip categories because they seem irrelevant — the ones that seem irrelevant are the ones that produce production incidents.

Every gap becomes an `absences` entry with a category and a severity. Every gap you cannot even frame becomes a `questions` entry.

**This step is not optional and not abbreviated.** An inventory with a thin `absences` section is a failed harvest, not a clean prototype.

### Step 5: Validate

Before presenting, verify:

- [ ] `meta.source.commit` is a real SHA, not a placeholder
- [ ] Every `screens` entry has at least one `states` entry
- [ ] Every `interactions` entry has an `evidence` field pointing to a selector, node, or file:line
- [ ] Every `data` entry has a `glossary_term` or is explicitly `UNMAPPED`
- [ ] Every `absences` category from the checklist is either populated or explicitly marked `none-found` with a reason
- [ ] No entry contains invented business rules — if it looks like a rule, it belongs in `questions`
- [ ] `filler` is populated (a prototype with zero placeholder content is suspicious — look again)

### Step 6: Report

Write `feature-inventory.yaml`, then summarise in chat:

- Counts per section
- **The three highest-severity absences**, stated plainly
- Any `UNMAPPED` vocabulary
- What the next phase (gap interrogation) needs a human to decide

Lead with the absences. The extracted inventory is the cheap half; the gaps are what the human is being asked to look at.

---

## Output

A single file, `feature-inventory.yaml`, conforming to `reference/inventory-schema.yaml`.

Default location: alongside the spec for the feature, e.g. `specs/<feature>/feature-inventory.yaml`.

---

## What this skill does NOT do

- Generate components, markup, or styles
- Write acceptance criteria (that is the spec-writing phase, downstream)
- Answer the questions it raises — it raises them for a human
- Judge the design
- Guess at business rules the prototype does not show

If asked to do any of these, produce the inventory first and say what is missing before proceeding.

---

## Tips for Best Results

- **Empty states are the richest source of absence** — a prototype that shows a populated list and nothing else is hiding the zero case, the one-item case, and the ten-thousand-item case.
- **Every disabled control is a rule you do not have** — if a button is greyed out, the condition that greys it is a business rule the prototype does not state.
- **Every count, badge, and timestamp is a data question** — "3 unread" implies a read model; "2 hours ago" implies a timezone decision.
- **Two prototypes for the same feature mean a transition you cannot see** — ask what happens between them.
- **Roles are almost never drawn** — prototypes are made for the most privileged user. Assume permissions are entirely unspecified until proven otherwise.
- **For async or collaborative products, add the returning-user question by default** — what does someone see coming back after twelve hours, and what is marked as changed? Prototypes show a moment; async products live in the gaps between moments.
