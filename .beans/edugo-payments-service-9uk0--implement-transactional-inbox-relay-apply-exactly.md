---
# edugo-payments-service-9uk0
title: Implement transactional inbox relay (apply exactly-once + retry/DLQ)
status: todo
type: task
priority: high
tags:
    - tier1
created_at: 2026-09-23T12:04:03Z
updated_at: 2026-09-23T12:13:38Z
parent: edugo-payments-service-6siz
blocked_by:
    - edugo-payments-service-abzp
---

## Context
The relay is where money is actually recorded — exactly once — from queued events (ADR-0003 §3).

## What needs to be done
- Inbox relay function: claim due rows (FOR UPDATE SKIP LOCKED); for each, in ONE transaction: (1) resolve the target account/payment from the normalised event (PR-T1); (2) find-or-create the payments row keyed on operator_event_id (idempotency_key = operator_event_id; UNIQUE guards double-create); (3) append the PAYMENT ledger entry; (4) update balance; (5) mark the row PROCESSED and set operator_events.payment_id. Skip already-processed keys.
- Relationship to recordPayment (PR-T1): the operator webhook is the AUTHORITATIVE source of settled payments; state explicitly whether the existing recordPayment API path is retained as a manual/back-office path or superseded. Both share the payments.idempotency_key UNIQUE guard so neither can double-record.
- On failure: attempts++, next_attempt_at (backoff — schedule is an ADR-0003 open item), last_error; exhausted -> DEAD (DLQ). No PAYMENT without a matching, resolvable confirmation (INV-3).
- Expose as a callable (runInboxRelayOnce) for tests; CronJob wiring out of scope.

## Acceptance Criteria
- [ ] Given one PENDING confirmation, when the relay runs then exactly one PAYMENT entry + balance update in one txn; row -> PROCESSED (INV-1).
- [ ] Given an already-PROCESSED event, when the relay runs again then no second entry (INV-2).
- [ ] Given an event that cannot be resolved to an account, when the relay runs then no PAYMENT is written and the row goes FAILED -> DEAD; no wrong-account credit (INV-3).
- [ ] Given an apply that fails, when the relay runs then attempts++/next_attempt_at set and no partial write (atomic rollback).

## Out of Scope
- CronJob schedule / concurrencyPolicy (ops); alert thresholds; backoff numbers (ADR-0003 open item).

## Technical Notes
- Reuse PaymentDao.appendLedgerEntry + incrementBalance inside the same UnitOfWork trx; entry_type PAYMENT (positive credit).

## Dependencies
- Blocked by the operator abstraction + operator_events DAO.

## Resolved decisions (tech spec, 2026-09-23)
- `InboxRelay.runInboxRelayOnce()` loops: per iteration one `UnitOfWork` txn claims one due row (`claimDueOne`), selects the operator by `row.operator`, `parse`s the payload; if `status !== COMPLETED` → `markProcessed` (ack, no ledger effect); else resolve account via `findAccountByPaymentIntent(extOrderId)`.
- Record path reuses a shared **`recordAndAllocate(repos, ...)`** core (extracted from `PaymentHub.recordPayment`) so payment + PAYMENT entry + balance + oldest-first allocation are idempotent (find-or-create on `payments.idempotency_key`).
- **Failure transactions:** clean unresolvable / unknown-operator / parse error → mark DEAD in the *same* txn (nothing to roll back); an exception mid-apply → apply txn rolls back, failure recorded in a **separate** txn (mirrors `recordPayment`'s post-rollback `DuplicateIdempotencyKeyError` handling). Transient exceptions retry (`attempts++`, backoff) up to MAX(=5) then DEAD.
- `recordPayment` (POST /payments) is retained as the manual/back-office path; both share `payments.idempotency_key`.
- Returns `{ processed, failed, dead }` for tests/observability. CronJob wiring out of scope.

## Definition of Done
- [ ] Integration tests: apply-once, replay no-op, unresolvable -> DEAD, failure rollback; pnpm typecheck + tests green
