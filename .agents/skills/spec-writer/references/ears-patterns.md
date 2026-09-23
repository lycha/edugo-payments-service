# EARS Patterns

Easy Approach to Requirements Syntax. Five patterns plus a complex combination. The job is choosing the right one for each decision and transcribing without inventing.

---

## The patterns

**Ubiquitous** — always true, no trigger, no precondition.
> The `<system>` shall `<response>`.

*Use for:* invariant-like behaviour that isn't conditional. "The digest shall display entries in reverse chronological order."

**Event-driven** — a discrete trigger causes a response.
> When `<trigger>`, the `<system>` shall `<response>`.

*Use for:* anything that happens in reaction to something. The most common pattern. "When a teammate posts an update, the system shall add it to the current digest."

**State-driven** — behaviour that holds throughout a state.
> While `<state>`, the `<system>` shall `<response>`.

*Use for:* behaviour tied to a condition that persists. "While the digest is loading, the system shall display a skeleton placeholder."

**Unwanted behaviour** — handling something that shouldn't happen but might.
> If `<condition>`, then the `<system>` shall `<response>`.

*Use for:* error handling, failure, invalid input. These come straight from the `error-state`, `offline`, and `boundary` absences. "If a post submission fails after the optimistic update rendered, then the system shall restore the composed text and surface a retry."

**Optional feature** — behaviour present only when a feature is.
> Where `<feature>`, the `<system>` shall `<response>`.

*Use for:* behaviour gated on configuration or plan. "Where a workspace has retention policy enabled, the system shall expire digests after the configured window."

**Complex** — genuinely multi-conditional. Combine the keywords.
> When `<trigger>`, while `<state>`, the `<system>` shall `<response>`.

*Use sparingly.* If it takes three keywords to express, first ask whether it should be a decision table instead (§ Step 3 in SKILL). Nested EARS is where agents misparse.

---

## Choosing the pattern

Read the decision's `resolution` and ask, in order:

1. Is it handling something going wrong? → **Unwanted** (`If`)
2. Is there a discrete trigger? → **Event-driven** (`When`)
3. Does it hold throughout a state? → **State-driven** (`While`)
4. Is it gated on a feature or plan? → **Optional** (`Where`)
5. Always true, unconditional? → **Ubiquitous**
6. More than three conditions interacting? → **decision table**, not EARS

---

## Worked transcriptions

Each shows a `decisions.yaml` entry and the criterion it becomes. Note what is carried exactly and what is never added.

**DECIDED → event-driven**

```yaml
- absence: ABS-4
  outcome: DECIDED
  resolution: >
    Relative timestamps render in viewer local time. Flip to absolute
    after 7 days.
  becomes: AC-12
```

> **AC-12** (from ABS-4) — While a digest entry is under 7 days old, the system shall display its timestamp relative to the viewer's local time. When an entry reaches 7 days old, the system shall display an absolute timestamp.

Two behaviours in one decision → `AC-12a`/`AC-12b` if they need separating for testing. The "7 days" is carried verbatim. Nothing about *format* of the absolute timestamp is added — the decision didn't say, so the criterion doesn't either. If format matters, that's an `underspecified` return.

**DECIDED → unwanted**

```yaml
- absence: ABS-5
  outcome: DECIDED
  resolution: Concurrent edit — last-write-wins, no conflict surface.
  becomes: AC-15
```

> **AC-15** (from ABS-5) — If two users edit the same digest entry concurrently, then the system shall retain the later write and discard the earlier without surfacing a conflict.

**ASSUMED → tagged criterion**

```yaml
- absence: ABS-7
  outcome: ASSUMED
  resolution: Digest holds at most 200 entries before paginating.
  revisit_when: any digest exceeds 200 entries in production
  becomes: AC-18
```

> **AC-18** (from ABS-7, assumption ASM-3) — When a digest reaches 200 entries, the system shall paginate rather than extend the single view.

Tagged with the assumption ID so the spec reader knows this rests on a guess with a revisit trigger. Same EARS shape; different provenance marker.

**DECIDED but underspecified → RETURN, do not write**

```yaml
- absence: ABS-9
  outcome: DECIDED
  resolution: Handle large paste gracefully.
  becomes: AC-20
```

Not a criterion. "Gracefully" admits no test. Return ABS-9 to gap-interrogation:

> ABS-9 is marked DECIDED but "gracefully" is untestable. Needs a concrete bound: truncate at N characters? reject with a message? accept and scroll? This is a decision, not a transcription.

Do **not** rescue it by picking one. Picking is deciding.

---

## Anti-patterns

- **Synonym drift.** The decision says the glossary term; the criterion must too. If "brief" became canonical, no criterion says "wrap" or "post" or "update".
- **Silent precision.** "About a week" → do not write "7 days". Return it as underspecified.
- **Invented edge cases.** If the decisions don't mention what happens at zero entries, the spec doesn't either — it goes back as a missing absence, it does not get filled in here.
- **Compound criteria.** "The system shall X and also Y" is two criteria. Split them.
- **Untestable verbs.** "handle", "manage", "support", "gracefully", "appropriately" — each is a returned decision, not a criterion.
