---
name: product-brief-writer
description: 'Write one-page product briefs to get buy-in before investing in full specs. Use when: write product brief, product brief, pitch idea.'
---

# Product Brief Writer

Write one-page product briefs to get buy-in before investing in full specs.

## When to Use This Skill
- PMs pitching new ideas to leadership
- Getting approval before investing in discovery
- Aligning stakeholders before writing a full PRD
- Requesting resources for a new initiative

## The Problem

A full PRD is overkill for getting initial buy-in. You don't need 10 pages of specs to get a "yes, let's explore this." You need a one-page pitch that answers: What's the problem? Why now? What's the ask?

## What You'll Need

**Critical inputs (ask if not provided):**
- What problem are you trying to solve?
- Who has this problem?
- What evidence do you have that it's worth solving?

**Nice-to-have inputs:**
- Rough solution direction
- Similar initiatives or competitors
- Rough sizing (effort, impact)
- Your specific ask (headcount, time, budget)

## Process

### Step 1: Check Your Context
First, read the user's context files:
- `context/personas.md` — Who has this problem? What's their pain?
- `context/product.md` — Is this a known issue? Any existing evidence?
- `context/company.md` — Does this align with strategic priorities?
- `context/competitors.md` — Do competitors solve this? Is it table stakes?
- Research files — Any feedback, interviews, or data to cite?

**Tell the user what you found.** For example:
> "I found relevant context for this brief:
> - Your Jordan persona spends '5+ hours/week on manual status updates'
> - 'Reporting is too basic' is listed as a top user complaint in product.md
> - Competitors Teamwork and Monday have this feature (from competitors.md)
>
> I'll use this as evidence in the brief."

### Step 2: Gather Problem Details
If the PM hasn't provided enough context, ask:
> "To write a compelling brief, I need:
> 1. What problem are you proposing to solve?
> 2. Who experiences this? (I found [X] in personas.md — is that the target?)
> 3. What are you asking for? (e.g., 2 sprints of discovery, approval to build)
>
> I can also pull evidence from your context files if relevant."

**Do NOT write a brief for a problem you don't understand. Get clarity first.**

### Step 3: Define the Problem
State the problem clearly:
- Who has this problem? (from personas.md)
- What is the problem? (in their words)
- How big is it? (quantify if possible)
- What's the evidence? (from context files or provided)

### Step 4: Explain Why Now
Why should we solve this now vs later?
- Strategic alignment (from company.md)
- Market pressure (from competitors.md)
- Customer urgency (from personas.md, feedback)
- Opportunity cost of waiting

### Step 5: Propose a Solution Direction
High-level approach, not detailed specs:
- What's the general direction?
- What are we NOT doing? (scope boundaries)
- What's the MVP look like?

### Step 6: Estimate Impact and Effort
Rough sizing to enable prioritization:
- **Impact:** Who benefits, how much, measurable outcome
- **Effort:** T-shirt size (S/M/L/XL), rough sprint count
- **Confidence:** How confident are you in these estimates?

**Don't make up metrics.** Use baselines from product.md or mark as `[PLACEHOLDER]`.

### Step 7: State Your Ask
Be explicit about what you want:
- Time (e.g., "2 sprints for discovery")
- People (e.g., "1 designer, 2 engineers")
- Decision (e.g., "approval to proceed to PRD")

### Step 8: Acknowledge Risks and Open Questions
Show you've thought it through.

## Output Template

```markdown
# Product Brief: [Feature/Initiative Name]

**Author:** [Your name]
**Date:** [Date]
**Status:** Proposed | Approved | In Discovery | Rejected

## Context
*What I found in your files:*
- **Persona pain:** [From personas.md]
- **Known issue:** [From product.md]
- **Strategic fit:** [From company.md]
- **Competitive landscape:** [From competitors.md]

---

## Problem

### Who has this problem?
[Specific user persona from personas.md]

### What is the problem?
[Problem statement — use language from personas.md]

### Evidence

| Source | Evidence |
|--------|----------|
| Personas | [Pain point from personas.md] |
| Product feedback | [From product.md known issues] |
| Competitive | [From competitors.md — do they have this?] |
| Research | [From research files if available] |

### Impact of not solving
[What happens if we don't do this?]

---

## Why Now

- **Strategic fit:** [From company.md priorities]
- **Competitive pressure:** [From competitors.md]
- **Customer urgency:** [From personas.md or feedback]
- **Opportunity cost:** [What we lose by waiting]

---

## Proposed Solution

### Direction
[High-level approach in 2-3 sentences]

### What this IS
- [Included capability 1]
- [Included capability 2]

### What this is NOT
- [Explicitly out of scope 1]
- [Explicitly out of scope 2]

### MVP Concept
[What's the smallest thing we could ship that solves the core problem?]

---

## Impact & Effort

### Expected Impact

| Metric | Current | Target | Confidence |
|--------|---------|--------|------------|
| [Primary metric] | [From product.md or PLACEHOLDER] | [Target] | High/Med/Low |

### Who Benefits
- **Primary:** [Persona from personas.md] — [How they benefit]
- **Secondary:** [Other stakeholder] — [How they benefit]

### Effort Estimate

| Phase | Effort | Who |
|-------|--------|-----|
| Discovery | [X weeks] | PM + Designer |
| Build | [X sprints] | [X] engineers |

**T-shirt size:** S / M / L / XL
**Confidence:** Low (need discovery) / Medium / High

---

## The Ask

**What I'm requesting:**
- [ ] [Specific ask — e.g., "2 sprints of discovery time"]
- [ ] [Specific ask — e.g., "Approval to proceed to PRD"]

**Decision needed by:** [Date]
**Decision maker:** [Name]

---

## Risks & Open Questions

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk 1] | L/M/H | L/M/H | [How we'd handle it] |

### Open Questions

- [ ] [Question 1] — Will answer in discovery
- [ ] [Question 2] — Need input from [stakeholder]

---

## Next Steps (if approved)

1. [First action] — Owner: [Name], By: [Date]
2. [Second action] — Owner: [Name], By: [Date]

---

## Assumptions to Validate
- ⚠️ [Assumption needing verification]

## Suggested Updates to Context Files
- [ ] Add this initiative to `product.md` roadmap if approved
```

## Framework Reference

**One-Pager Best Practices:**
- Problem before solution (earn the right to propose)
- Evidence over assertions (data > opinions)
- Clear ask (don't make them guess what you want)
- Risks acknowledged (shows maturity, builds trust)

## Tips for Best Results

1. **Use your context files** — I'll pull evidence from personas, product, competitors
2. **Lead with evidence** — "14 customers asked for this" beats "users want this"
3. **Be specific about the ask** — "Approve 2 sprints" not "let us work on this"
4. **Scope ruthlessly** — The more focused, the easier to approve
5. **One page means one page** — If it's longer, you're not ready to pitch
