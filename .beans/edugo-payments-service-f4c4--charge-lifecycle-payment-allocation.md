---
# edugo-payments-service-f4c4
title: Charge lifecycle & payment allocation
status: done
type: epic
priority: high
tags:
    - tier2
created_at: 2026-09-23T12:05:12Z
updated_at: 2026-09-23T14:39:22Z
---

## Goal
Model the charge lifecycle on the ledger and allocate payments oldest-first, so a parent's balance reflects what they owe (INV-5, INV-7) — the receivable side of the correctness core.

## Background / Context
Charges, allocations, and the charge state machine are specified (spec/schema/migrations) but unimplemented. This layers the receivable side onto the existing ledger/balance machinery.

## Success Metrics
- [x] Creating a charge posts a CHARGE ledger entry (gross, negative) with balance == SUM(ledger) (INV-1/INV-7)
- [x] A payment allocates to open charges oldest-first; over-allocation becomes credit (INV-5)
- [x] A fully-covered charge transitions PENDING -> SETTLED (AC-11/AC-19)

## Scope
### In Scope
- ChargeDao + ChargeRepository port; UnitOfWork bundle (payments + charges) for atomic writes
- createCharge use case + handler: tax breakdown (net/tax/gross), post CHARGE entry, PENDING
- Payment allocation oldest-first + PENDING -> SETTLED transition (allocation is LEDGER-NEUTRAL — see Risks)
- Charge/allocation invariant tests
### Out of Scope
- Effective-dated tax-rate resolution engine (inject/look up a rate; full engine later)
- Refunds/adjustments, dunning, reconciliation (designed, later)
- Full charge state machine (only the settle path here)

## Dependencies
- Shares the ledger/balance machinery; can proceed alongside Tier 1 (not hard-blocked). NOTE: the UnitOfWork bundle (task 1t6l) is a shared seam with the Tier-1 relay — coordinate (PR-E2-4).

## Risks
- Allocation double-counting -> balance drift — Mitigation (PR-E2-1): allocation is LEDGER-NEUTRAL (writes payment_allocations + charge status only, posts NO ledger entry). The balance is moved solely by the CHARGE (-) and PAYMENT (+) entries; assert INV-1/INV-5 in tests.
- Concurrent allocation over-allocates — Mitigation: lock open charges FOR UPDATE (PR-008).

## Definition of Done
- [x] All child tasks completed and accepted
- [x] pnpm typecheck + pnpm test green; INV-1/5/7 asserted
