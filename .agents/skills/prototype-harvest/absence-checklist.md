# Absence Checklist

Work through every category. Do not skip one because it seems irrelevant — the categories that seem irrelevant are the ones that produce production incidents.

Each category produces either `absences` entries or an explicit `none-found` with a reason. Silence is not an acceptable output.

**Severity:** mark `blocking` when an agent cannot implement without someone making a decision. Most absences are blocking. That is the expected result, not a sign you were too harsh.

---

## 1. Empty state

- What does this look like with zero items?
- Is there a first-run state distinct from a became-empty state?
- Is there a call to action, and what does it do?

## 2. Error state

- What happens when the load fails?
- What happens when the write fails — is the optimistic update rolled back?
- Is the error recoverable in place, or does the user lose input?
- Are errors per-field, per-form, or global?

## 3. Loading state

- Skeleton, spinner, or nothing?
- Is there a partial-load state where some data arrived?
- What is the timeout, and what is shown after it?

## 4. Permission and role

Prototypes are drawn for the most privileged user. Assume nothing is specified.

- Who can see this screen? Who can see each field?
- Which interactions are hidden versus visible-but-disabled for lesser roles?
- What does a user without access see — a 404, a 403, or a degraded view?
- Can permissions change while the view is open?

## 5. Concurrency

- Two users act on the same object simultaneously — last-write-wins, merge, or conflict surface?
- Is the action idempotent? Double-click on submit.
- What happens to a form open against an object someone else just deleted?
- Is there a locking or presence model, or none?

## 6. Boundary and scale

- One item. Ten thousand items. Is there pagination, virtualisation, or a cap?
- A 4,000-character string in a field designed for eight words.
- Zero-width and RTL text. Emoji in names.
- The longest realistic value, not the prettiest one.

## 7. Lifecycle

- What happens to this when its parent is archived or deleted?
- Is deletion soft or hard? Is there a restore path?
- What happens to references from elsewhere in the product?

## 8. Notification and side-effects

- Who gets told when this happens?
- Is it batched, immediate, or digested?
- Can it be muted, and at what granularity?
- What is the fatigue ceiling — how many of these can fire before it is spam?

## 9. Time

Critical for anything async or distributed.

- Whose timezone governs display? Whose governs the day boundary?
- Is ordering wall-clock or causal?
- When does a relative timestamp flip to absolute?
- What does someone see returning after twelve hours — what is marked as changed, and what is silently different?
- Is there state that was true when written and is not now, and is that visible?

## 10. Offline and degraded network

- Is the action queued or rejected?
- What happens to work in progress when the connection drops?
- Is there a stale-data indicator?

## 11. Accessibility

- Keyboard path through every interaction
- Focus order and focus trapping in modals
- What screen readers announce for state changes
- Whether colour alone carries meaning anywhere

## 12. Undo and reversibility

- Is this action reversible? For how long?
- Is there a confirmation, and is confirmation the right pattern versus undo?
- What is the blast radius of the destructive version of this action?

---

## Framing an absence well

**Weak:** "Error states not designed."

**Strong:** "No state shown for a failed post submission. Undefined: whether the composed body is preserved, whether retry is automatic or manual, and whether a partial write to the digest is possible. Blocking — an agent will invent all three."

The difference is that the strong version tells the human exactly what decision they owe, and tells the reader what goes wrong if nobody makes it.
