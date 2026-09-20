---
name: agile-task-writer
description: Write well-structured agile work items following best practices — Epics, Tasks/Sub-tasks, Bugs, and Spikes. Use this skill whenever the user asks to write, draft, create, or improve any agile ticket, work item, issue, backlog item, or task. Trigger even for casual phrasing like "write me a ticket for...", "add a task for...", "create a bug for...", "write up a spike on...", "help me describe this feature", or "turn this into a Jira ticket". Also trigger when the user shares a rough idea and wants it structured for a sprint.
---

# Agile Task Writer

Write clear, actionable, sprint-ready agile work items following best practices. Covers Epics, Tasks/Sub-tasks, Bugs, and Spikes.
 
---

## Guiding Principles

- **Clarity over completeness** — A ticket should be understandable without asking the author
- **Actionable** — Anyone on the team should be able to pick it up cold
- **Right-sized** — Epics decompose into tasks; tasks fit in a sprint; sub-tasks fit in a day or two
- **Definition of Done is explicit** — Every item has clear completion criteria
- **No ambiguity in bugs** — Actual vs. expected behavior must be unambiguous

---

## Item Types & When to Use Each

| Type | Use When |
|------|----------|
| **Epic** | Large feature or initiative spanning multiple sprints; groups related tasks |
| **Task** | A discrete, deliverable piece of work completable in one sprint |
| **Sub-task** | A step within a Task; helps track parallel or sequential work |
| **Bug** | Something is broken — actual behavior deviates from expected |
| **Spike** | Unknown/uncertain — research needed before estimation is possible |
 
---

## Process

### Step 1: Identify the Item Type

Determine the correct type from context. If unclear, ask:
> "Is this something broken (Bug), something to research (Spike), a large initiative (Epic), or a concrete piece of work (Task)?"

### Step 2: Gather Missing Context

Ask only for what's truly missing. Common gaps:
- **Who** is affected (user role / system)
- **What** is the expected outcome or business value
- **What** is the current broken behavior (for Bugs)
- **What** is the uncertainty being resolved (for Spikes)
- **What** are the constraints (tech stack, deadlines, dependencies)

### Step 3: Write the Item

Use the appropriate template below.

### Step 4: Validate

Before presenting, verify:
- [ ] Title is specific and action-oriented (verb + object)
- [ ] Acceptance criteria / DoD are testable (pass/fail, not vague)
- [ ] Scope is explicit — what's IN and what's OUT
- [ ] Dependencies and risks are noted if known
- [ ] Size feels right for the type (decompose if needed)

---

## Templates

### Epic

```markdown
# Epic: [Outcome-oriented title — what the user/business gains]
 
## Goal
[1–2 sentences: what problem does this solve and for whom?]
 
## Background / Context
[Why now? What's driving this initiative?]
 
## Success Metrics
- [ ] [Measurable outcome 1]
- [ ] [Measurable outcome 2]
 
## Scope
 
### In Scope
- [Feature/capability 1]
- [Feature/capability 2]
 
### Out of Scope
- [Explicit exclusion 1]
 
## Child Stories / Tasks
- [ ] [Task title 1]
- [ ] [Task title 2]
- [ ] [Spike: investigate X if uncertainty exists]
 
## Dependencies
- [Team / system / decision this depends on]
 
## Risks
- [Risk] — Mitigation: [approach]
 
## Definition of Done
- [ ] All child tasks completed and accepted
- [ ] [Business-level acceptance criterion]
```
 
---

### Task / Sub-task

```markdown
# Task: [Verb + Object — e.g., "Implement rate limiting on /api/search endpoint"]
 
## Context
[1–2 sentences: why is this task needed? Link to Epic if applicable.]
 
## What needs to be done
[Clear description of the work. Be specific enough that someone unfamiliar can start.]
 
## Acceptance Criteria
- [ ] Given [context], when [action], then [expected result]
- [ ] Given [context], when [action], then [expected result]
- [ ] [Non-functional criterion if relevant — performance, security, accessibility]
 
## Out of Scope
- [What this task explicitly does NOT include]
 
## Technical Notes / Hints
- [Implementation approach, relevant docs, gotchas — optional but valuable]
 
## Dependencies
- [Blocked by / depends on]
 
## Definition of Done
- [ ] Code reviewed and approved
- [ ] Tests written and passing
- [ ] Deployed to [environment]
- [ ] [Any other team-specific DoD items]
```
 
---

### Bug

```markdown
# Bug: [What is broken — e.g., "Login button unresponsive on Safari 17 mobile"]
 
## Severity
[Critical / High / Medium / Low]
> Critical = data loss or security issue; High = core flow broken; Medium = degraded UX; Low = cosmetic
 
## Environment
- **OS / Browser / Device:** [e.g., iOS 17, Safari 17, iPhone 14]
- **App version / branch:** [e.g., v2.3.1 / main]
- **User role / account type:** [e.g., free tier, admin]
 
## Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]
 
## Actual Behavior
[What happens — be precise. Include error messages verbatim if applicable.]
 
## Expected Behavior
[What should happen instead.]
 
## Impact
[Who is affected and how many? Any workaround available?]
 
## Attachments
- [ ] Screenshot / video
- [ ] Logs / error traces
- [ ] Link to Sentry / monitoring event
 
## Definition of Done
- [ ] Root cause identified
- [ ] Fix implemented and peer-reviewed
- [ ] Regression test added
- [ ] Verified in [environment]
- [ ] Affected users notified if needed
```
 
---

### Spike / Research Ticket

```markdown
# Spike: [Question to answer — e.g., "Evaluate feasibility of streaming LLM responses via WebSocket"]
 
## Context & Motivation
[What decision or task is blocked until this research is done? Why can't we estimate without it?]
 
## Questions to Answer
1. [Specific question 1]
2. [Specific question 2]
3. [Specific question 3]
 
## Scope & Timebox
- **Max time:** [e.g., 2 days / 1 sprint]
- **Owner:** [Who is running the spike]
 
## Approach / Methods
- [How will you research this? Proof of concept? Reading docs? Benchmarking?]
 
## Out of Scope
- [What this spike is NOT expected to produce]
 
## Definition of Done
- [ ] All questions above answered (or explicitly marked as "unanswerable — why")
- [ ] Recommendation documented with rationale
- [ ] Follow-up tasks/stories created based on findings
- [ ] Results shared with team (demo / write-up / ADR)
 
## Expected Output
[What artifact will this spike produce? e.g., ADR, benchmark results, proof-of-concept repo, recommendation doc]
```
 
---

## Tips for Best Results

- **Title always starts with a verb** — "Implement", "Fix", "Investigate", "Add", "Migrate", "Remove"
- **Acceptance criteria use Given/When/Then** — keeps them testable and unambiguous
- **Spikes always have a timebox** — without one they expand indefinitely
- **Bugs always have Actual vs. Expected** — this is the single biggest clarity win
- **Epics always list explicit Out of Scope** — prevents scope creep
- **Sub-tasks inherit context** from parent Task — don't repeat it, link it
