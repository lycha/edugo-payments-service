---
# edugo-payments-service-abzp
title: Add operator provider abstraction + mock + operator_events DAO
status: todo
type: task
priority: high
tags:
    - tier1
created_at: 2026-09-23T12:04:03Z
updated_at: 2026-09-23T12:13:38Z
parent: edugo-payments-service-6siz
---

## Context
Both the webhook ingest and the relay need a storage seam (the inbox) and a provider seam (the operator). Foundation for the Epic.

## What needs to be done
- OperatorEventDao (adapter/storage) over operator_events: insertReceived (dedup-aware), claimDue (FOR UPDATE SKIP LOCKED, oldest-first), markProcessed/markFailed/markDead — executor-bound like PaymentDao.
- PaymentOperator driven port (domain/port): verifySignature(raw, headers) + normalise(event) -> { accountId, amountMinor, currency, operatorEventId, correlationRef }. normalise MUST RESOLVE THE TARGET ACCOUNT (PR-T1) — e.g. match the event's operatorReference against a pending charge / payment_intent; an unresolvable event is surfaced, never guessed. Implement MockPayUOperator (PayU-shaped payload; HMAC over a secret read from config — never hardcoded, Secret Manager later per ADR-0006).
- Map operator_events columns (jsonb payload, status enum, attempts/next_attempt_at/last_error) to/from domain types.

## Acceptance Criteria
- [ ] Given a signed payload, when verifySignature runs with the right secret then it passes; with a wrong signature then it fails.
- [ ] Given a duplicate (operator, operatorEventId), when insertReceived runs twice then the second is surfaced as duplicate (UNIQUE dedup, INV-2), not a 500.
- [ ] Given PENDING rows, when claimDue runs then it returns them oldest-first and skips locked rows.
- [ ] Given an event carrying a known operatorReference, when normalise runs then it resolves the correct accountId + correlationRef; an unresolvable event is surfaced (never credited to a wrong account, INV-3).

## Out of Scope
- Real PayU payload schema; live secret (ASM-1).

## Technical Notes
- Mirror PaymentDao (Executor = Kysely | Transaction; 23505 handling). Table + columns already in db/migrations (payments-core).
- HMAC secret comes from the Zod env/config loader, not source (PR-T3).
- Optional split (PR-T4): OperatorEventDao and the PaymentOperator abstraction may ship as two tasks if it helps parallelism; both remain prerequisites of ingest + relay.

## Resolved decisions (tech spec, 2026-09-23)
- `PaymentOperator` port stays **framework/DB-free**: `verifySignature(rawBody: string, signature) → boolean` (HMAC-SHA256 over raw body, constant-time) + `parse(payload) → { operatorReference, extOrderId, status, amountMinor, currency }`. Account **resolution is a relay/repo step** (`PaymentRepository.findAccountByPaymentIntent(extOrderId)`), keeping the port DB-free — a refinement of "normalise resolves the account".
- `parse` reads the amount as a **string → `BigInt`** (PayU `totalAmount` is a string in minor units); a non-string amount is malformed.
- `MockPayUOperator` payload is PayU-shaped: `{ order: { orderId, extOrderId, status, currencyCode, totalAmount } }`. Export a `signPayU(rawBody, secret)` helper so tests sign identically.
- `OperatorEventDao`: `insertReceived` (dedup-aware, 23505 → `{ duplicate: true }`), `claimDueOne` (`FOR UPDATE SKIP LOCKED`, oldest-first, LIMIT 1), `markProcessed/markFailed/markDead`. jsonb payload inserted via `JSON.stringify`.
- Secret from Zod env loader `OPERATOR_WEBHOOK_SECRET` (default only for dev/test).

## Definition of Done
- [ ] Reviewed; tests for verify + dedup + claim ordering + account resolution
- [ ] Registered in the awilix Cradle (container.ts); full-contract boot test still passes (PR-T5)
- [ ] pnpm typecheck green
