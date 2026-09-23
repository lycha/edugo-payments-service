---
# edugo-payments-service-6siz
title: Exactly-once operator ingestion (webhook → inbox → relay)
status: todo
type: epic
priority: high
created_at: 2026-09-23T12:02:48Z
updated_at: 2026-09-23T12:14:03Z
---

## Goal
Record money exactly once from payment-operator confirmations with a provably consistent balance — the correctness core of the service (PRD hard requirement; INV-2/INV-3).

## Background / Context
ADR-0003 chose a transactional inbox + CronJob relay (Postgres + K8s, no bus). The operator_events table and its UNIQUE (operator, operator_event_id) dedup already exist in the migrations; the runtime path (ingest -> inbox -> apply) is unimplemented (handlers are 501 stubs).

## Success Metrics
- [ ] A redelivered/duplicate operator event yields exactly one PAYMENT ledger entry (INV-2)
- [ ] account_balances == SUM(ledger_entries) after every applied event (INV-1)
- [ ] A charge with no operator confirmation is never recorded as paid (INV-3)

## Scope
### In Scope
- Webhook ingest: HMAC verify -> insert operator_events -> fast 200 ACK
- Transactional inbox relay: resolve account -> find/create payment -> apply in one DB transaction
- operator_events DAO + a mock operator provider (PayU-shaped) behind an abstraction
- Exactly-once / invariant integration tests
### Out of Scope
- CronJob scheduling / K8s deployment (relay is invocable + tested; wiring is ops)
- Real PayU integration + live HMAC secret (mock provider; ASM-1)
- Multi-operator routing (FR-16 — designed, later)
- Webhook rate limiting / IP-allowlist (ADR-0002 §5, NFR-6) — ingress/infra concern, not app code (PR-T3)

## Dependencies
- Builds on the existing Money value object, PaymentDao, and UnitOfWork transaction machinery.

## Risks
- Duplicate/crash mid-apply — Mitigation: apply + mark-processed in ONE txn; UNIQUE(operator,event_id) dedup.
- Event cannot be mapped to an account — Mitigation: normalise resolves account or the row goes DEAD; never a wrong-account credit (INV-3, PR-T1).

## Resolved decisions (tech spec, 2026-09-23)
See `docs/tech-spec-exactly-once-operator-ingestion.md` + peer review.
- Account correlation uses PayU's echoed `extOrderId` (= our `payment_intent` id) — **no migration**. Store PayU `orderId` in `payments.operator_reference`.
- PayU has no per-delivery event id → dedup on `(orderId, status)`; `operator_event_id = "${orderId}:${status}"`; payment `idempotency_key = "payu:${orderId}:COMPLETED"` (operator-qualified). Only `COMPLETED` records money.
- Failure bookkeeping runs in a **separate** transaction from the (rolled-back) apply; unresolvable/parse/unknown-operator → DEAD (permanent), transient throw → retry-then-DEAD.
- Money crosses the jsonb boundary as string → `BigInt` (never a JS number).
- Ingest ACK follows the contract: `202` accepted / `200` duplicate. Unknown operator → `400`.
- `recordPayment` retained as the manual/back-office path (reserved `"manual:"` key prefix); operator confirmations flow only through the relay.

## Definition of Done
- [ ] All child tasks completed and accepted
- [ ] pnpm typecheck + pnpm test green; invariant tests included
- [ ] INV-1/INV-2/INV-3 asserted by integration tests against real Postgres
