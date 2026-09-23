# Peer Review: Epic 1 (Tier 1) — Exactly-once operator ingestion

**Phase:** Architecture (tickets / task breakdown)
**Reviewed:** 2026-09-23
**Artifacts reviewed:** beans `edugo-payments-service-6siz` (epic) + tasks `abzp`, `fs5i`, `9uk0`, `csfz`
**Grounding:** ADR-0003 (inbox + relay), `db/migrations/…payments-core` (`operator_events`, `payments`), existing `PaymentDao`/`UnitOfWork`/`recordPayment`, INV-1/2/3.

---

## Verdict: 🔄 REVISE → ✅ APPROVED (fixes applied)

The decomposition is genuinely good — valid DAG, foundation-first, testable Given/When/Then criteria, explicit scope, invariants mapped to assertions. One design gap ran through the epic: no task said how an operator event resolves to *which account/payment* it confirms. Fixed (see Resolution).

---

## Deep Review Findings

### 🔴 Must Fix

**[PR-T1] No task specifies how an operator event resolves to an account / the payment it confirms**
- **Where:** `abzp` (`normalise`) and `9uk0` (relay apply).
- **Issue:** `9uk0` said "append the PAYMENT ledger entry + update balance + link `payment_id`" — but nothing stated which account gets credited or which payment/charge the event confirms. `operator_events.payload` is opaque `jsonb`; `operator_events.payment_id` is an FK to `payments` (whose `idempotency_key` is `NOT NULL UNIQUE`), so the relay must create/find a payment row. Two unknowns a developer couldn't resolve: (1) correlation — how a raw event maps to an EduGo account (INV-3's "matching confirmation"); (2) the payment row's idempotency key and the relationship to the existing `recordPayment` path that already writes `PAYMENT` entries.
- **Impact:** `9uk0` was not implementable as written; the relay couldn't credit the right balance or satisfy INV-3.
- **Suggestion:** add the correlation contract to `abzp` (`normalise` → `{ accountId, amountMinor, currency, operatorEventId, correlationRef }`) and to `9uk0` (find/create the payment keyed on `operator_event_id`; state the `recordPayment` relationship).

### 🟡 Should Fix

- **[PR-T2]** `csfz`'s "out-of-order → unchanged" over-scopes Tier 1: dedup gives *redelivery* tolerance, not *reordering* of distinct event types (Tier-2 state machine). Narrow it.
- **[PR-T3]** HMAC secret provenance (via config loader, not source) and webhook rate limiting (ADR-0002 §5 / NFR-6) unaddressed.
- **[PR-T4]** `abzp` bundles three concerns (DAO + operator port + normalise); optional split.
- **[PR-T5]** No DoD item for awilix `Cradle` wiring + boot test.

### 🟢 Looks Good

- Foundation → write paths → tests, cycle-free DAG mirroring ADR-0003's ingest/relay split.
- The "no business logic in the webhook; apply in the relay" separation is faithful to ADR-0003.
- Invariants INV-1/2/3 named *and* turned into concrete assertions; "tests are the deliverable" framing is right.
- Reuses `Money`/`PaymentDao`/`UnitOfWork` and the proven `23505`→dedup pattern; strong scope discipline; mock provider keeps ASM-1 honest.

---

## Resolution — applied to the beans (2026-09-23)

| Finding | Outcome |
|---|---|
| **PR-T1** correlation/payment gap | ✅ Fixed — `abzp` `normalise` now returns `{ accountId, amountMinor, currency, operatorEventId, correlationRef }` and resolves the account (or surfaces it); `9uk0` find-or-creates the `payments` row keyed on `operator_event_id`, with an AC for unresolvable → `DEAD` (INV-3). One decision left for implementation (documented in `9uk0`): whether `recordPayment` is retained as a manual path or superseded. |
| **PR-T2** out-of-order over-scope | ✅ Fixed — `csfz` AC narrowed to redelivery/duplicate; out-of-order deferred to Tier 2. |
| **PR-T3** secret + rate limiting | ✅ Noted — HMAC secret via config (in `abzp`); rate limiting / IP-allowlist added as epic Out of Scope. |
| **PR-T4** `abzp` sizing | ✅ Noted — optional DAO/provider split recorded in `abzp`. |
| **PR-T5** DI wiring | ✅ Noted — "registered in Cradle; boot test passes" added to `abzp` DoD. |

`beans check` passes. **Post-fix verdict: ✅ APPROVED** — ready to implement, with the `recordPayment`-relationship decision at implementation time.
