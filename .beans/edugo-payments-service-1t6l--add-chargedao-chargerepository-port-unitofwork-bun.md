---
# edugo-payments-service-1t6l
title: Add ChargeDao + ChargeRepository port + UnitOfWork bundle
status: done
type: task
priority: high
tags:
    - tier2
created_at: 2026-09-23T12:05:12Z
updated_at: 2026-09-23T14:39:22Z
parent: edugo-payments-service-f4c4
---

## Context
Storage + transaction seam for charges, so charge writes join the same atomic unit as ledger/balance.

## What needs to be done
- ChargeDao (adapter/storage) + ChargeRepository port: insertCharge, findChargeById, findOpenChargesByAccount (oldest-first), findOpenChargesByAccountForUpdate (SELECT ... FOR UPDATE, oldest-first — for allocation, PR-008/PR-E2-2), updateStatus. Money-mapped like PaymentDao (Int8<->bigint; Numeric tax_rate<->string; do NOT set updated_at — the trigger handles it).
- Extend UnitOfWork to hand a repo bundle { payments, charges } bound to one trx (update PaymentHub call sites). NOTE (PR-E2-4): this reshapes the same UnitOfWork the Tier-1 relay (9uk0) builds on and touches the existing record-payment/server-boot tests — do the bundle ONCE, first, and have both epics consume it.
- ChargeStatus domain union (mirror LedgerEntryType).

## Acceptance Criteria
- [x] Given a NewCharge, when insertCharge runs then a row is written and { id } returned; duplicate idempotency key -> DuplicateIdempotencyKeyError (23505).
- [x] Given open charges, when findOpenChargesByAccount runs then they are returned oldest-first (created_at asc).
- [x] Given a running txn, when findOpenChargesByAccountForUpdate runs then the open charges are row-locked (FOR UPDATE) so a parallel payment cannot over-allocate (PR-008).
- [x] Given withTransaction, when it runs then payments and charges repos share the same transaction.

## Out of Scope
- Tax-rate resolution; state transitions beyond a status setter.

## Technical Notes
- charges table + set_updated_at trigger already in db/migrations (payments-core). Follow PaymentDao.

## Definition of Done
- [x] Reviewed; tests for insert/dedup/ordering/locking; registered in Cradle; pnpm typecheck green
