---
# edugo-payments-service-fs5i
title: Implement operator webhook ingest (HMAC verify, dedup, fast ACK)
status: todo
type: task
priority: high
tags:
    - tier1
created_at: 2026-09-23T12:04:03Z
updated_at: 2026-09-23T12:04:03Z
parent: edugo-payments-service-6siz
blocked_by:
    - edugo-payments-service-abzp
---

## Context
Inbound operator webhooks must be verified and durably queued with a fast ACK — no business logic in the request (ADR-0003 §2).

## What needs to be done
- Implement `receiveOperatorEvent` (POST /operator-events/{operator}, public/HMAC route): verify HMAC via PaymentOperator, INSERT into operator_events (dedup), return 200 immediately.
- Invalid signature → reject with no ledger effect (AC-14); duplicate → 200 no-op (AC-15/INV-2).

## Acceptance Criteria
- [ ] Given a validly-signed event, when POSTed then a PENDING row is inserted and 200 returned with no ledger write.
- [ ] Given an invalid signature, when POSTed then it is rejected and nothing is inserted (AC-14).
- [ ] Given a redelivered event, when POSTed twice then only one row exists and both return 200 (INV-2).

## Out of Scope
- Applying the event to the ledger (the relay, separate task).

## Technical Notes
- Route already in the public allowlist (security.ts), HMAC not bearer. Wire the handler via PaymentApiImpl/glue by operationId.

## Dependencies
- Blocked by the operator abstraction + operator_events DAO.

## Definition of Done
- [ ] Integration test: valid→200+row; invalid→rejected; duplicate→one row; pnpm typecheck + tests green
