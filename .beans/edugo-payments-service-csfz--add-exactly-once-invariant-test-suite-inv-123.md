---
# edugo-payments-service-csfz
title: Add exactly-once invariant test suite (INV-1/2/3)
status: todo
type: task
priority: high
tags:
    - tier1
created_at: 2026-09-23T12:04:04Z
updated_at: 2026-09-23T12:13:38Z
parent: edugo-payments-service-6siz
blocked_by:
    - edugo-payments-service-fs5i
    - edugo-payments-service-9uk0
---

## Context
For a correctness system the invariant tests are the deliverable.

## What needs to be done
- Integration suite (real Postgres via Testcontainers) exercising ingest -> relay end-to-end and asserting the invariants.

## Acceptance Criteria
- [ ] Given a confirmation delivered twice, when ingested + relayed then exactly one PAYMENT entry (INV-2).
- [ ] Given any applied event, then account_balances == SUM(ledger_entries) (INV-1).
- [ ] Given a charge with no confirmation, then no PAYMENT is recorded (INV-3).
- [ ] Given a redelivered/duplicate event (same operator, event_id), when ingested + relayed then the outcome is unchanged — exactly one entry (dedup). (PR-T2: genuine out-of-order across distinct event types is deferred to the Tier-2 charge state machine.)

## Out of Scope
- Load/perf testing.
- Out-of-order handling of distinct event types (Tier 2 state machine).

## Technical Notes
- Follow test/payments/record-payment.int.test.ts style; each test seeds its own account/keys.

## Dependencies
- Blocked by webhook ingest + relay.

## Resolved decisions (tech spec, 2026-09-23)
- End-to-end suite drives ingest (HTTP inject or handler) → `runInboxRelayOnce` against real Postgres, seeding a `payment_intent` per test so `extOrderId` resolves.
- INV-2: same `(orderId, COMPLETED)` delivered twice → one PENDING row (ingest dedup) and exactly one PAYMENT (apply dedup). INV-1: balance == Σ ledger after apply. INV-3: an event whose `extOrderId` resolves no intent → no PAYMENT, row → DEAD.
- Follows `test/payments/record-payment.int.test.ts` style (own account/keys per test).

## Definition of Done
- [ ] All four assertions pass; suite runs in pnpm test
