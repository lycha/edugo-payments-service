---
# edugo-payments-service-5sjm
title: Add charge/allocation invariant test suite (INV-1/5/7)
status: done
type: task
priority: high
tags:
    - tier2
created_at: 2026-09-23T12:05:13Z
updated_at: 2026-09-23T14:39:22Z
parent: edugo-payments-service-f4c4
blocked_by:
    - edugo-payments-service-d4bk
    - edugo-payments-service-ncro
---

## Context
Prove the receivable-side invariants end-to-end.

## What needs to be done
- Integration suite asserting charge + allocation invariants against real Postgres.

## Acceptance Criteria
- [x] Given create+pay flows, then account_balances == SUM(ledger_entries) throughout (INV-1).
- [x] Given any charge, then gross == net + tax (INV-7).
- [x] Given allocation, then oldest-first holds and over-allocation becomes credit (INV-5).
- [x] Given full coverage, then the charge is SETTLED (AC-11).

## Out of Scope
- Load/perf.

## Technical Notes
- Follow test/payments/record-payment.int.test.ts; seed own accounts/enrollments/keys.

## Dependencies
- Blocked by createCharge + allocation.

## Definition of Done
- [x] All assertions pass in pnpm test


## Added assertions (PR-E2-1/3)
- [x] Given a partial payment, then the charge stays PENDING with SUM(allocations) < gross AND balance == SUM(ledger_entries) still holds (allocation is ledger-neutral, INV-1).
