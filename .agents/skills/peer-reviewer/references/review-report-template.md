# Review Report Template

Use this template for all peer review reports. Copy this structure and fill in the sections.

---

```markdown
# Peer Review: [Title]

**Phase:** Architecture | Implementation
**Ticket / Branch:** [ticket-id or branch] (implementation reviews only)
**Reviewed:** [date]
**Artifacts reviewed:** [list of files/documents reviewed]

---

## Verdict: ✅ APPROVED | 🔄 REVISE | ❌ REJECTED

[One sentence summary justifying the verdict.]

---

## Automated Checklist

[Copy the relevant checklist from architecture-checklist.md or implementation-checklist.md.
Run each item and mark pass/fail/N/A.]

### [Section Name]

- [x] **Criterion** — [pass: no comment needed, or brief positive note]
- [ ] ⚠️ **Criterion** — [fail: what is missing or wrong]
- [-] **Criterion** — [not applicable: brief reason why]

### [Next Section]
...

**Checklist Summary:** X/Y passed, Z failed, W not applicable

---

## Deep Review Findings

### 🔴 Must Fix

> These block approval. Each must be resolved before proceeding.

**[PR-001] [Short title]**
- **Location:** [file:line or document section]
- **Issue:** [What is wrong]
- **Impact:** [Why this matters — the consequence if not fixed]
- **Suggestion:** [How to fix it, with code example if helpful]

**[PR-002] [Short title]**
...

_No must-fix findings._ (if none)

---

### 🟡 Should Fix

> Strongly recommended but don't block approval.

**[PR-003] [Short title]**
- **Location:** [file:line or document section]
- **Issue:** [What could be improved]
- **Impact:** [Why this matters]
- **Suggestion:** [Recommended approach]

_No should-fix findings._ (if none)

---

### 🟢 Looks Good

> Positive observations worth calling out.

- [What was done well and why it's good]
- [Another positive observation]

---

## Consistency Check

[For architecture: do the tech spec, implementation plan, and Jira tickets align?]
[For implementation: does the code match the tech spec and Jira ticket?]

- **Spec ↔ Implementation alignment:** [assessment]
- **Naming consistency:** [assessment]
- **Event catalog alignment:** [assessment, if applicable]

---

## Summary

[2-3 sentences. What's the overall quality? What's the most important thing to address?
If approved, any suggestions for the next phase? If revised, what's the priority order for fixes?]

---

## ⏸️ Awaiting Human Sign-Off

Review complete. Please confirm how to proceed:
- **Approve** — proceed to next phase
- **Override** — proceed despite findings
- **Send back** — author addresses findings
- **Add feedback** — you have additional input
```

---

## Guidance for Using This Template

### Finding IDs

Use sequential IDs within the review: PR-001, PR-002, etc. This makes it easy to reference specific findings in follow-up discussion.

### Code Examples in Findings

When suggesting code changes, show both the current code and the suggested fix:

```markdown
**[PR-004] Unchecked account lookup in payment recording**
- **Location:** `src/payments/domain/PaymentHub.ts:41`
- **Issue:** `getBalance` can return `null` for an account with no balance row, but the result is used without a fallback
- **Impact:** a `TypeError` at runtime on the first payment for an account whose balance row doesn't exist yet
- **Suggestion:**
  ```ts
  // Current
  const balance = await repo.getBalance(existing.accountId);
  return { balanceMinor: balance.amountMinor, /* ... */ };

  // Suggested
  const balance = (await repo.getBalance(existing.accountId)) ?? Money.zero(cmd.currency);
  return { balanceMinor: balance.amountMinor, /* ... */ };
  ```
```

### Linking Findings to Checklist Items

If a finding corresponds to a checklist failure, reference the checklist item:

```markdown
**[PR-005] Per-row balance query in the reconciliation loop** (see checklist: Performance → No queries in loops)
```

### Verdict Decision Guide

- **✅ APPROVED** — Zero 🔴 findings. Any number of 🟡. This is the happy path.
- **🔄 REVISE** — One or more 🔴 findings, but the approach is sound. The author can fix these without rethinking the design. Most common outcome for first-pass reviews.
- **❌ REJECTED** — The approach itself has fundamental problems. Examples: wrong architectural pattern chosen, spec misunderstands the requirements, implementation ignores the spec entirely. This is rare and should be accompanied by a clear explanation of what needs to change at a high level.
