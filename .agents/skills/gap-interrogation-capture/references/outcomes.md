# Outcome Semantics

What each outcome *means* and when to choose it. The machine-checkable structure lives in `<artefact-tree>/schemas/decisions.schema.json` — this file is judgment, that file is shape.

---

## Round 0 — questions

A question is an unknown about the **sources**, not a product decision. Most resolve in seconds.

| Outcome | Choose when | Requires |
|---|---|---|
| **ANSWERED** | Someone knew, or research settled it | `answer`, `answered_by` |
| **RECLASSIFIED** | It was a conflict or absence all along | `reclassified_as`, `becomes` |
| **ESCALATED** | Nobody present knows | `owner`, `due` |
| **DROPPED** | Based on a misreading of the sources | `reason` |

**Research first.** `researchable: true` questions are usually answered by Grep, not judgment. Finding a fact is not deciding.

**The 30-second rule.** Anything slower is not a question — it is an absence or conflict wearing a question's clothes. Reclassify rather than debate.

**RECLASSIFIED is not terminal.** The new `CON-n` or `ABS-n` must be resolved in the same session. An orphaned reclassification looks handled and isn't.

**DROPPED feeds the harvester.** A question asked because of a misreading means the extraction prompt needs work. The reason is that feedback.

---

## Round 1 — conflicts

Somebody already decided, twice, incompatibly. Downstream artefacts fork here.

| Outcome | Choose when | Requires |
|---|---|---|
| **RESOLVED** | One source wins | `debt_created` |
| **RECONCILED** | None was right; new canonical answer | `debt_created` |
| **SPLIT** | Both right — two concepts, one name | `split_into` (≥2) |
| **ESCALATED** | Needs someone not present | `owner`, `due` |

**`debt_created` is mandatory on RESOLVED and RECONCILED.** The decision is free; the rename, migration, or document rewrite it implies is not. An unowned entry means it silently doesn't happen and the conflict returns next feature.

**SPLIT is worth slowing down for.** When positions describe things that behave differently, ask directly: *are these actually two concepts?* Discovering a conflated concept at spec time is worth more than the rest of the round.

**Do not re-open what precedence settled.** If `default_resolution` is systematically wrong, fix `source-precedence.yaml` at project level afterwards — never item by item in the room.

---

## Round 2 — absences

Nobody decided. The agent will invent it.

| Outcome | Choose when | Requires | Becomes |
|---|---|---|---|
| **DECIDED** | The behaviour is known | one-sentence `resolution` | An acceptance criterion |
| **DEFERRED** | Explicitly out of scope | — | A written non-goal |
| **ASSUMED** | Guessing, and we know it | `rationale`, `revisit_when`, `risk` | An assumption-register entry |
| **ESCALATED** | Needs someone not present | `owner`, `due` | A dated blocker |

**Expect several ASSUMED per story.** The goal is not deciding everything — it is making every guess visible. A story with zero assumptions usually means guesses were rubber-stamped as decisions. Say so when you see it.

**"We'll figure it out during implementation" is ASSUMED, not DEFERRED.** Deferred means explicitly out of scope. This is a guess with no trigger attached.

**`decided_by: agent` forces ASSUMED.** When a human declines to decide and asks the system to pick, that is never `DECIDED`. A decision made by the thing that will implement it is the oracle inside the loop — the schema enforces this, but understand why.

---

## What makes a `revisit_when` observable

The trigger has to be something a person or a system can actually detect.

| Bad | Why | Better |
|---|---|---|
| "If users are unhappy" | Nobody is watching for this | "Any support ticket mentioning lost edits" |
| "If it becomes a problem" | Circular | "p95 digest render exceeds 2s" |
| "Later" | Not a trigger | "Before the first customer with >50 seats" |
| "TBD" | Not a trigger | *(schema rejects this)* |

Good triggers name a ticket, a metric, a threshold, a log line, or a specific upcoming event.

---

## Capture confidence

`workshop-captured` only. A transcript interleaves proposals and decisions and marks neither.

| Level | Means | Action |
|---|---|---|
| `explicit` | Stated, uncontradicted | Record |
| `inferred` | Clear from context, never said in one piece | Record, flag in report |
| `ambiguous` | Could be a decision or a floated option | **Ask before recording** |

**Proposal signals:** conditional framing ("we could", "one option is"), no response from anyone, contradicted later and never reconciled, trailing off mid-thought.

**Decision signals:** flat indicative statement, acknowledged by another participant, referred back to later as settled, an action recorded from it.

Attribution matters: a facilitator restating an option is not a founder choosing it. And the end of a session is the least reliable part — people compress, agree fast, stop challenging. Rate late items `inferred` more readily.
