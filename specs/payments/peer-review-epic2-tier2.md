# Peer Review: Epic 2 (Tier 2) — Charge lifecycle & payment allocation

**Phase:** Architecture (tickets / task breakdown)
**Reviewed:** 2026-09-23
**Artifacts reviewed:** beans `edugo-payments-service-f4c4` (epic) + tasks `1t6l`, `d4bk`, `ncro`, `5sjm`
**Grounding:** glossary sign convention, INV-1/5/7, AC-19/AC-30/AC-11, FR-9, PR-008, the `charges`/`payment_allocations` schema, existing `PaymentDao`/`UnitOfWork`.

---

## Verdict: 🔄 REVISE → ✅ APPROVED (fixes applied)

Well-formed, spec-faithful backlog with the same good bones as Epic 1 (valid DAG, testable ACs, scope discipline, correct sign convention). One 🔴: the tickets were ambiguous about whether allocation moves the balance, and the epic's own Risk line ("allocate + *post ledger* + update balance") pointed at the wrong model — a direct INV-1 drift risk. Fixed (see Resolution).

---

## Deep Review Findings

### 🔴 Must Fix

**[PR-E2-1] Allocation must be ledger-neutral — the tickets implied it posts a ledger entry (INV-1 drift)**
- **Where:** epic `f4c4` Risk ("allocate + **post ledger** + update balance"); `ncro` ("… remainder stays as credit on the balance").
- **Issue:** the balance is already moved by the `CHARGE` entry (−gross, at creation) and the `PAYMENT` entry (+amount). Allocation is **pure bookkeeping** — it records which payment covers which charge (`payment_allocations`) and flips charge status; it must post no ledger entry and not touch the balance, or the payment is counted twice → `balance != SUM(ledger)` (INV-1 breaks).
- **Impact:** silent balance drift — the exact failure the service exists to prevent — and just ambiguous enough to be implemented either way.
- **Suggestion:** state that allocation writes `payment_allocations` + status only (no ledger entry); over-allocation "credit" is the positive balance the existing entries already produce (INV-5). Fix the epic Risk line.

### 🟡 Should Fix

- **[PR-E2-2]** Concurrent allocation needs `FOR UPDATE` on the open charges (PR-008); `findOpenChargesByAccount` is a plain select → two concurrent payments can over-allocate.
- **[PR-E2-3]** The partial-payment case (payment < oldest charge → partial row, stays `PENDING`, Σ < gross) is missing though AC-19/FR-9 requires it.
- **[PR-E2-4]** The `UnitOfWork` bundle refactor (`1t6l`) reshapes the same seam Tier-1's relay (`9uk0`) builds on, plus `PaymentHub` and existing tests — coordinate.
- **[PR-E2-5]** How the tax breakdown is derived isn't stated (request carries no tax fields); M1 = look up `tax_rates` effective today, default EXEMPT.
- **[PR-E2-6]** Allocation should assert `payment.currency == charge.currency` (app-enforced, PR-S3).

### 🟢 Looks Good

- Clean foundation → write path → allocation → tests chain.
- Sign convention nailed (CHARGE negative per AC-30 / glossary; stated in `d4bk`).
- INV-7 with the EXEMPT case tested; reliance on the DB CHECKs.
- Idempotent `createCharge`; reuse of `appendLedgerEntry`/`UnitOfWork`; carried-over "don't set `updated_at`" detail.
- INV-5 (over-allocation→credit, Σ ≤ gross) already covered; strong scope discipline.

---

## Resolution — applied to the beans (2026-09-23)

| Finding | Outcome |
|---|---|
| **PR-E2-1** allocation ledger-neutral | ✅ Fixed — `ncro` states allocation writes `payment_allocations` + status only (no ledger entry, no balance change); epic `f4c4` Risk line corrected; AC added that balance == SUM(ledger) is unchanged by allocation. |
| **PR-E2-2** concurrency lock | ✅ Fixed — `1t6l` adds `findOpenChargesByAccountForUpdate` (SELECT … FOR UPDATE) with an AC; `ncro` uses it (PR-008). |
| **PR-E2-3** partial-payment | ✅ Fixed — AC added to `ncro` and a matching assertion to `5sjm`. |
| **PR-E2-4** shared UnitOfWork refactor | ✅ Noted — cross-epic coordination flagged in `1t6l` + epic Dependencies. |
| **PR-E2-5** tax breakdown derivation | ✅ Noted — `d4bk` states the M1 resolution (look up `tax_rates`, default EXEMPT). |
| **PR-E2-6** same-currency | ✅ Noted — `ncro` asserts `payment.currency == charge.currency` (PR-S3). |

`beans check` passes. **Post-fix verdict: ✅ APPROVED** — receivable-side backlog is implementation-ready, with the UnitOfWork bundle built once and shared with Tier 1.
