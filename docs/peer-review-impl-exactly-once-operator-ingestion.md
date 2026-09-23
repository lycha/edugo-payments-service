# Peer Review: Implementation — Exactly-Once Operator Ingestion

**Phase:** Implementation
**Ticket / Branch:** Epic `edugo-payments-service-6siz` (tasks `abzp`, `fs5i`, `9uk0`, `csfz`) / `exactly-once-operator-ingestion`
**Reviewed:** 2026-09-23
**Artifacts reviewed:**
- New: `PaymentOperator.ts`, `OperatorEventRepository.ts`, `OperatorEvent.ts`, `OperatorEventDao.ts`, `MockPayUOperator.ts`, `OperatorEventApiImpl.ts`, `InboxRelay.ts`, `recordPayment.ts`
- Changed: `PaymentHub.ts`, `PaymentDao.ts`, `PaymentRepositoryDB.ts`, `PaymentRepository.ts`, `UnitOfWork.ts`, `Errors.ts`, `container.ts`, `server.ts`, `env.ts`, `main.ts`
- Tests: `operator-event-dao`, `operator-ingest`, `inbox-relay`, `exactly-once-invariants`, `test/setup/payu.ts`
- Grounding: `docs/tech-spec-exactly-once-operator-ingestion.md`, ADR-0003, the epic beans, `openapi/openapi.yaml`

**Gates:** `pnpm typecheck` clean · `pnpm test` **44 passed (10 files)** · `.generated/` and `.env` not committed.

---

## Verdict: ✅ APPROVED — all findings resolved (2026-09-23)

The implementation is faithful to the spec, preserves INV-1/2/3 (asserted end-to-end against real Postgres), keeps the domain framework/DB-free, and correctly implements the load-bearing detail the spec review flagged — apply + mark-processed in one transaction, failure bookkeeping in a *separate* one. No 🔴.

**Resolution:** all six 🟡 findings applied; `pnpm typecheck` clean, **47 tests pass** (+3):
- **PR-001** — the relay now marks the resolved `payment_intent` `CONFIRMED` and links `payment_id` in the apply txn, and dead-letters a *distinct* event that resolves to an already-`CONFIRMED` intent (intent-level idempotency + status visibility). Tested (intent CONFIRMED on success; second distinct event → DEAD, no double-credit).
- **PR-002** — `OPERATOR_WEBHOOK_SECRET` documented in `.env.example`.
- **PR-003** — `console.warn` replaced by an injectable `RelayLogger` seam (registered in the `Cradle`, no-op default; prod passes pino).
- **PR-004** — added tests for the non-`COMPLETED` no-op and the amount-mismatch (asserts confirmed amount lands on the ledger + logger warned).
- **PR-005** — `findAccountByPaymentIntent` now guards the UUID shape in JS and queries the typed PK (keeps the index).
- **PR-006** — the claim-ordering test starts from an empty inbox (explicit `deleteFrom`) instead of mutating statuses.

---

## Automated Checklist

### TDD Discipline
- [x] **Tests exist** — four integration suites map to the four tasks; 24 new tests.
- [-] **Tests came first** — single-session build; can't verify from history. Tests are behavior-focused (good proxy).
- [x] **Tests pass** — 44/44 against real Postgres (Testcontainers, Colima socket set per CLAUDE.md).
- [x] **Typecheck clean** — `tsc --noEmit` green (strict).
- [x] **Generated code fresh** — no contract/migration change; `.generated/` rebuilt and gitignored.

### Acceptance Criteria
- [x] **All criteria met** — `abzp` (verify/dedup/claim-ordering/resolution), `fs5i` (202/401/200 dedup), `9uk0` (apply-once/replay/unresolvable→DEAD/rollback), `csfz` (INV-1/2/3) all covered.
- [x] **Criteria have tests** — each AC maps to a named test.
- [ ] ⚠️ **Edge cases** — two implemented branches are untested: the amount-mismatch warn (Decision 4) and the non-`COMPLETED` no-op. (PR-004)

### Code Quality — TypeScript
- [x] **Type safety** — `unknown` + narrowing for payloads; `isPermanent` is a proper type guard; casts limited to request DTOs at the boundary.
- [x] **Immutability** — `Money` reused; readonly deps.
- [x] **Money handling** — `bigint` throughout; string→`BigInt` at the jsonb boundary, and a JS-number amount is rejected (`MockPayUOperator.parse`). Exactly the precision guard the spec required.
- [x] **Domain purity** — `domain/` grep for `fastify|kysely|#generated|awilix` is clean; the `PaymentOperator` port takes a `string` raw body (Buffer/crypto live in the adapter).
- [x] **No dead code** — `tryReplay` still used; no leftover stubs.

### Code Quality — Fastify / Kysely / awilix
- [x] **Transaction boundaries** — apply + mark-processed share one `withTransaction`; failure booking is a separate txn (correct, see 🟢).
- [x] **Dependency injection** — `operatorWebhookSecret`, `mockPayUOperator`, `paymentOperators`, `inboxRelay` registered in the `Cradle`; boot test still green.
- [ ] ⚠️ **Configuration** — `OPERATOR_WEBHOOK_SECRET` added to the Zod schema but **not** to `.env.example`. (PR-002)
- [x] **Input validation** — body/header validated by ajv from the contract; HMAC verified in the handler over the raw body.
- [x] **Error handling** — new errors extend `DomainError`; they're handled at their call site (relay/ingest) and fall back to the generic `DomainError → 422` mapping if they ever escape.
- [ ] ⚠️ **Logging** — the amount-mismatch path uses `console.warn`, not the structured pino logger. (PR-003)

### Architecture Compliance
- [x] **Spec / ADR alignment** — inbox + relay, `FOR UPDATE SKIP LOCKED`, single-txn apply, operator-qualified idempotency key, `extOrderId` correlation — all as specified.
- [x] **Contract-first** — `receiveOperatorEvent` wired by `operationId` over the existing contract; DTO from `.generated`.
- [x] **Migration-first** — no schema change; existing `operator_events` used as-is.
- [x] **Module boundaries** — ports in `domain/`, DAOs/adapters in `adapter/`, orchestration in `application/`.
- [x] **Naming consistency** — matches the contract and schema.
- [x] **Deviations documented** — the "normalise resolves account" → "relay resolves via repo" refinement is noted in the bean and code comments.

### Domain Invariants
- [x] **Balance invariant** — INV-1 asserted in `inbox-relay` and `exactly-once-invariants`.
- [x] **Append-only ledger** — only inserts; failure path rolls back rather than deleting.
- [x] **Idempotency** — replay returns the original (relay no-ops on a processed row; `recordAndAllocate` find-or-create); `202`/`200` at ingest; the shared key guard prevents double-record.

### Security
- [x] **Input validation** — ajv + HMAC.
- [x] **SQL safety** — Kysely builder / parameterized `sql`; the one raw fragment (`id::text = ${intentId}`) parameterizes the value.
- [x] **AuthN** — public HMAC route correctly allowlisted; HMAC constant-time compare with a length guard.
- [x] **No secrets in code** — secret from env; `.env`/`.generated` uncommitted.
- [x] **Safe defaults** — missing/failed signature → 401, no row; unresolvable → DEAD, no credit.

### Performance
- [ ] ⚠️ **Indexes match queries** — `findAccountByPaymentIntent` compares `id::text`, which cannot use the `payment_intents` PK index → sequential scan per event. Negligible at M1 volume, latent at scale. (PR-005)
- [x] **No queries in loops** — the relay's per-row loop is inherent to draining; allocation's per-charge queries are pre-existing and bounded.
- [x] **Bounded results** — `claimDueOne` is `LIMIT 1`; no unbounded `selectAll` on growth tables in new code.
- [x] **Resource management** — tests close app/db and stop the container in `afterAll`.

### Test Quality
- [x] **Behavior-focused / clear naming / AAA** — yes; scenarios read well.
- [x] **Appropriate types** — real Postgres integration; `bigint` compared as `bigint`.
- [~] **Independent** — mostly; `operator-event-dao` mutates global inbox state to isolate the claim-ordering test (necessary because `claimDueOne` is global). Contained, but a smell. (PR-006)
- [x] **Meaningful assertions / error paths** — 401/400/DEAD/rollback all asserted.

**Checklist Summary:** 34/40 passed, 6 flagged, 0 blocking.

---

## Deep Review Findings

### 🔴 Must Fix

_No must-fix findings._

### 🟡 Should Fix

**[PR-001] The `payment_intent` is never consumed/confirmed on apply**
- **Location:** `InboxRelay.applyOne` (`src/payments/application/InboxRelay.ts:119-150`)
- **Issue:** The relay resolves the intent (read-only) and records the payment, but never transitions `payment_intents.status` to `CONFIRMED` nor sets `payment_intents.payment_id`. Exactly-once is guarded per *event* (`payu:${orderId}:COMPLETED`), not per intent.
- **Impact:** Two things. (1) *Idempotency at the intent level is not enforced:* two distinct operator events (different `orderId`) that both resolve to the same `extOrderId` would each record a payment — a double-credit. Non-exploitable under M1's one-order-per-intent flow, but nothing in the code prevents it. (2) The push-payment sequence expects the intent → `CONFIRMED` transition for status visibility; leaving it `CREATED` means an intent-level status poll never reflects the confirmation.
- **Suggestion:** In the apply transaction, after `recordAndAllocate`, update the intent: `status = 'CONFIRMED'`, `payment_id = recorded.paymentId`. Optionally reject a second event whose intent is already `CONFIRMED` (dead-letter it) for defense-in-depth. Cheap, and closes both gaps in the same txn.

**[PR-002] `OPERATOR_WEBHOOK_SECRET` not added to `.env.example`**
- **Location:** `src/platform/config/env.ts:8` (added) vs `.env.example` (not added)
- **Issue:** The new env var is in the Zod schema (with a dev default) but undocumented in `.env.example`.
- **Impact:** A new engineer won't know the var exists or that it must be set in production; the dev default silently masks a missing prod secret. The repo convention (and the checklist) is to document new env vars there.
- **Suggestion:** Add a commented line to `.env.example`, e.g. `# HMAC secret for operator webhooks (Secret Manager in prod, ADR-0006)\n# OPERATOR_WEBHOOK_SECRET=...`.

**[PR-003] Amount-mismatch uses `console.warn` instead of the pino logger**
- **Location:** `src/payments/application/InboxRelay.ts:133`
- **Issue:** The mismatch signal bypasses Fastify's structured logging (it's a raw `console.warn`), so it won't carry request/trace context and won't be captured consistently.
- **Impact:** Observability of a money-relevant anomaly (Decision 4) is weaker than the rest of the service. It also can't feed the NFR-9 metrics the spec describes.
- **Suggestion:** Inject a pino logger (or the app logger) into `InboxRelay` deps and `logger.warn({ operator, operatorEventId, confirmed, expected }, 'operator amount mismatch')`. Emit a metric counter alongside.

**[PR-004] Two implemented branches have no test**
- **Location:** `InboxRelay.applyOne` — amount-mismatch warn (`:132`) and non-`COMPLETED` no-op (`:114`)
- **Issue:** Decision 4's mismatch detection and the "only `COMPLETED` records money" rule are implemented but uncovered.
- **Impact:** A future refactor could drop the mismatch check or start recording on non-terminal statuses (a real correctness risk — recording on `PENDING`/`WAITING` would violate INV-3) with green tests.
- **Suggestion:** Add two cases to `inbox-relay`: a `PENDING`/`WAITING_FOR_CONFIRMATION` event → row PROCESSED, **no** ledger entry; and a `COMPLETED` whose amount differs from the intent → payment recorded at the confirmed amount (assert the warn/metric once logging lands).

**[PR-005] `findAccountByPaymentIntent` defeats the PK index**
- **Location:** `src/payments/ledger/adapter/storage/PaymentDao.ts:39-44`
- **Issue:** `where(sql\`id::text = ${intentId}\`)` casts the PK to text so a non-UUID correlation ref returns null instead of erroring — but the cast prevents the `payment_intents_pkey` index from being used (seq scan per event).
- **Impact:** Negligible now (single-digit TPS, small table), latent as intents grow. It also couples a correctness concern (bad input) to a performance regression.
- **Suggestion:** Guard the UUID shape in JS and query by the typed PK: if `intentId` doesn't match a UUID regex, return null; else `.where('id', '=', intentId)`. Keeps the index and the null-on-unknown behavior.

**[PR-006] `operator-event-dao` test mutates global inbox state**
- **Location:** `test/payments/operator-event-dao.int.test.ts` (claim-ordering test)
- **Issue:** It runs `UPDATE operator_events SET status='PROCESSED' WHERE status IN ('PENDING','FAILED')` to isolate ordering, because `claimDueOne` is global.
- **Impact:** Correct today (later describe blocks don't touch the inbox), but fragile — adding an inbox-dependent test after it could break subtly.
- **Suggestion:** Fine as-is with a comment (already present), or seed rows under a unique `operator` tag and assert relative ordering without the global reset. Low priority.

### 🟢 Looks Good

- **The failure-transaction split is implemented exactly right.** `applyOne` marks permanent failures DEAD in-txn (nothing to roll back) and throws transient ones so the apply rolls back and `recordFailure` books the retry in a *separate* transaction. This is precisely the PR-001 fix from the spec review, and it's the crux of the whole epic — `attempts` advances even though the apply rolled back.
- **Money precision at the boundary.** Amount parsed string→`BigInt` with a JS-number payload explicitly rejected as malformed — the "money is bigint" invariant is enforced where it's actually at risk (the jsonb boundary), and it's tested.
- **`ON CONFLICT DO NOTHING` for dedup.** Choosing this over catching `23505` is the right call and shows real Postgres depth: a raised unique violation aborts the enclosing ingest transaction, so the follow-up SELECT would fail. (Good that the author found this via a failing test and fixed the root cause rather than the symptom.)
- **Clean shared core.** Extracting `recordAndAllocate`/`allocateOldestFirst` gives one money-writing path for both the manual `recordPayment` and the relay, so neither can double-record — and the existing allocation/record tests still pass unchanged, proving the refactor was behavior-preserving.
- **Domain purity held** while adding an operator seam: the port takes a `string` raw body and returns a parsed value object; HMAC/`crypto`/`Buffer` stay in the adapter. Registry-by-name keeps the domain from ever branching on operator.
- **Invariant coverage is genuinely end-to-end** (HTTP ingest → relay), not just unit-level, including the negative INV-3 cases (no confirmation → nothing; unresolvable → DEAD, no payment).

---

## Consistency Check

- **Code ↔ spec/beans:** Aligned, including the documented refinement (resolution as a relay/repo step rather than inside the port). The one spec expectation not yet realized is the intent transition (PR-001), which the spec implies via the push-payment sequence.
- **Naming:** `operator_event_id = "${orderId}:${status}"`, `payments.idempotency_key = "payu:${orderId}:COMPLETED"`, `operator_reference = orderId` — all consistent with Decision 2.
- **Contract:** `202`/`200`/`401`/`400` match `receiveOperatorEvent`; no invented `404`.

---

## Summary

Solid, well-tested implementation that lands the epic's correctness core and gets the hard part — the failure-path transaction boundary — right. No blockers. The highest-value follow-up is PR-001 (transition the `payment_intent` on apply) for intent-level idempotency and status visibility; PR-002/003/004 are quick hygiene/coverage items. Recommend approving and addressing PR-001 before this feeds the status-polling endpoint work.

**Priority order:** PR-001 (intent transition) → PR-004 (test the two branches) → PR-002 (.env.example) → PR-003 (structured logging) → PR-005 (PK index) → PR-006 (test isolation).

---

## ⏸️ Awaiting Human Sign-Off

Review complete. Please confirm how to proceed:
- **Approve** — accept the verdict and proceed
- **Override** — proceed despite findings
- **Send back** — author addresses findings
- **Add feedback** — you have additional input
