---
# edugo-payments-service-ncro
title: Implement payment allocation oldest-first + PENDING->SETTLED
status: todo
type: task
priority: high
tags:
    - tier2
created_at: 2026-09-23T12:05:12Z
updated_at: 2026-09-23T12:20:18Z
parent: edugo-payments-service-f4c4
blocked_by:
    - edugo-payments-service-1t6l
    - edugo-payments-service-d4bk
---

## Context
Payments must pay down what is owed oldest-first and settle charges when covered (AC-19, AC-11, INV-5, FR-9).

## What needs to be done
- On a payment, allocate its amount across the account's open charges oldest-first.
- ALLOCATION IS LEDGER-NEUTRAL (PR-E2-1): it writes payment_allocations rows and flips charge status ONLY — it posts NO ledger entry and does NOT modify the balance. The balance is already moved by the CHARGE (-) and PAYMENT (+) entries; over-allocation "becoming credit" is simply the positive balance those entries produce (INV-5), not a new entry.
- Lock the open charges with findOpenChargesByAccountForUpdate (FOR UPDATE, PR-008) so concurrent payments cannot over-allocate. Assert payment.currency == charge.currency (app-enforced, PR-S3).
- When a charge is fully covered, transition PENDING -> SETTLED. All within the payment's one txn.

## Acceptance Criteria
- [ ] Given open charges [oldest, newer] and a payment covering the oldest, when allocated then the oldest is SETTLED and the newer remains open.
- [ ] Given a payment smaller than the oldest open charge, when allocated then a partial payment_allocations row is written, the charge stays PENDING, and SUM(allocations) < gross (FR-9/AC-19).
- [ ] Given a payment exceeding all open charges, when allocated then all are SETTLED and the remainder stays as positive balance/credit (INV-5).
- [ ] Given allocation, then SUM(payment_allocations) for a charge never exceeds its gross, and balance == SUM(ledger) is unchanged by allocation (ledger-neutral, INV-1).

## Out of Scope
- Refunds/chargebacks reversing allocations; partial-refund re-opening.

## Technical Notes
- Use findOpenChargesByAccountForUpdate (oldest-first, FOR UPDATE) + updateStatus; write allocations via a small DAO method; run inside the payment's UnitOfWork txn. Do NOT post a ledger entry here.

## Dependencies
- Blocked by ChargeDao/bundle + createCharge.

## Definition of Done
- [ ] Integration tests: oldest-first, partial, over-allocation->credit, settle transition, INV-1 unchanged by allocation; pnpm typecheck + tests green
