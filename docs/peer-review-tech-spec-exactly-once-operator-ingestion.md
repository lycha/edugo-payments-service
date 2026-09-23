# Peer Review: Tech Spec — Exactly-Once Operator Ingestion

**Phase:** Architecture
**Ticket / Branch:** Epic `edugo-payments-service-6siz` / `exactly-once-operator-ingestion`
**Reviewed:** 2026-09-23
**Artifacts reviewed:**
- `docs/tech-spec-exactly-once-operator-ingestion.md` (under review)
- Cross-checked against: `docs/adr/0003-async-backbone.md`, `openapi/openapi.yaml` (operator-events + initiatePushPayment), `db/migrations/1790150435617_payments-core.sql`, `src/payments/application/PaymentHub.ts`, `src/payments/ledger/adapter/storage/PaymentDao.ts`, `src/payments/ledger/domain/port/UnitOfWork.ts`, `src/platform/http/security.ts`, `specs/payments/spec.md`, the epic + task beans (`6siz`, `abzp`, `fs5i`, `9uk0`, `csfz`)

---

## Verdict: 🔄 REVISE → ✅ RESOLVED (2026-09-23)

A strong, well-grounded spec that correctly reads the ADR and the existing code — but it draws the **failure-path transaction boundary incorrectly** (`markFailed` cannot commit inside the apply transaction that rolls back), which, if implemented as written, breaks the retry/DLQ guarantee it promises. One 🔴, small and well-scoped.

**Resolution:** all five findings were applied to `docs/tech-spec-exactly-once-operator-ingestion.md`:
- **PR-001** — Decision 3 now specifies the exception-path failure bookkeeping runs in a **separate** transaction (with a code sketch mirroring `PaymentHub.recordPayment`), Decision 8 and the apply sequence diagram were corrected (the `markFailed`/`markDead` step moved outside the apply-txn `rect`), and the risk table + crash-safety bullet updated.
- **PR-002** — Decision 4 adds the amount policy: record the operator-confirmed amount, flag a mismatch (M1 = `warn` log + metric; `reconciliation_mismatches` row deferred to that epic).
- **PR-003** — Decision 5 + Security NFR now require string → `BigInt` across the jsonb boundary; a bare-JSON-number amount is treated as malformed.
- **PR-004** — API section maps unknown-operator to the contract's declared `400` (no invented `404`).
- **PR-005** — Decision 6 reworded from "by construction" to an enforced `"manual:"`-prefix convention.

Open questions #1 (correlation anchor, still gating `abzp`), #2 (202/200), #3 (backoff numbers), #4 (audit rows) remain open as intended.

---

## Automated Checklist

### Tech Spec — Completeness

- [x] **PRD coverage** — Scopes to the ingestion slice of FR-5/DD-2; correctly defers FR-16 routing. Non-goals are explicit and match the epic bean.
- [x] **Context & goals** — Motivation (at-least-once delivery → exactly-once effect) is clear; six goals map to INV-1/2/3.
- [x] **Architecture approach** — Faithful to ADR-0003 (inbox + CronJob relay, no bus). Eight numbered decisions with rationale and rejected alternatives.
- [x] **Bounded-context placement** — Places the inbox in the `ledger/` kernel with a new operator port; module tree is concrete and hexagonal (domain has no framework/DB deps).

### Tech Spec — API Design

- [x] **Contract-first** — Uses the existing `receiveOperatorEvent` contract as source of truth; flags where the bean diverges from it.
- [x] **Error handling** — HMAC failure → 401 problem+json from the handler (public route, not a `DomainError`); reasoning for not routing it through `setErrorHandler` is sound.
- [ ] ⚠️ **Consistency** — The API section lists a `404` for unknown operator, but the `receiveOperatorEvent` contract declares no `404` (it declares `400`). Align to the declared `400`, or add the response to the contract first. (PR-004)
- [x] **Idempotency** — Two-key model is precise and *improves* on the bean (operator-qualified `payments.idempotency_key`). Replay semantics documented.
- [x] **Validation rules** — Body validated by ajv from the contract; secret via the Zod env loader.

### Tech Spec — Data Model

- [x] **Table definitions** — Reuses existing tables; money stays `bigint` minor units; documents which columns each path writes.
- [x] **Aggregate boundaries & invariants** — INV-1/2/3 stated and tied to the single-transaction apply; append-only ledger preserved (PAYMENT is a new positive entry).
- [x] **Migration strategy** — Correctly "no new migration"; acknowledges the correlation open question *may* require one.
- [x] **Index strategy** — Notes the existing `operator_events_claim_idx (status, next_attempt_at)` backs the claim, and `_payment_id_idx` the back-reference.
- [x] **Data integrity** — Dedup UNIQUE and `payments.idempotency_key` UNIQUE both explained as the correctness guards.

### Tech Spec — Integration Points

- [x] **External services** — Operator webhook (mocked), EduGo (pull-based, unchanged), CronJob execution seam.
- [x] **Async flows** — Ordering/delivery guarantees documented; aligns with ADR-0003 (supersedes the ADR-0001 open decision).
- [ ] ⚠️ **Failure handling** — Retries/backoff/DLQ are described, but the **transaction boundary for the failure bookkeeping is wrong** (see PR-001). Also no stated policy for a confirmed-amount vs. expected-amount mismatch (PR-002).
- [x] **Eventual consistency** — ~1–2 min relay cadence documented; consistent with NFR-2/NFR-3 (`p95 < 2 min`).

### Tech Spec — Non-Functional Requirements

- [x] **Quantified targets** — Latency bound to the relay cadence; ties to the revised NFR-2/3. Backoff/threshold placeholders honestly flagged as ADR-0003 open items.
- [ ] ⚠️ **Security** — HMAC/constant-time/resolved-account all covered. One gap: no guard against **JSON-number money precision loss** when extracting the amount from `payload` jsonb (PR-003).
- [x] **Observability** — Inbox depth by status, relay counts, DLQ alert tied to NFR-9, per-row tracing under opt-in OTEL.

### Tech Spec — Open Questions

- [x] **No blocking unknowns** — Five open questions, each with a proposal and a resolution point (the correlation anchor is correctly gated to block `abzp`).
- [x] **Risk assessment** — Risk table maps each risk to a concrete mitigation.

**Checklist Summary:** 18/22 passed, 4 failed, 0 N/A

---

## Deep Review Findings

### 🔴 Must Fix

**[PR-001] Failure bookkeeping cannot share the apply transaction that rolls back**
- **Location:** §2 Decision 3 & 8; §4 "Apply — one row, one transaction" sequence diagram (the `markFailed` step drawn inside the single-transaction `rect` on the rollback branch)
- **Issue:** The spec puts the entire apply *and* the `markFailed(attempts++, next_attempt_at, last_error)` inside one `UnitOfWork.withTransaction`, and simultaneously requires "rollback of any partial write" on failure. These are mutually exclusive for the **exception** case: if `insertPayment` succeeds but `appendLedgerEntry`/`incrementBalance` throws, Postgres aborts the whole transaction — so the `markFailed` write in that same transaction is rolled back with it. The attempt counter never advances.
- **Impact:** A transiently-failing row is retried forever with `attempts` stuck at its old value and **never reaches `DEAD`** — the DLQ guarantee (AC-45, G3, Decision 8) silently does not hold, and the relay can hot-loop on a poison row. This is exactly the class of bug the inbox exists to prevent.
- **Suggestion:** Split the two failure sub-cases, mirroring the existing `DuplicateIdempotencyKeyError` handling in `PaymentHub.recordPayment` (catch *after* the transaction has rolled back, then act in a fresh transaction):
  ```
  try {
    await uow.withTransaction(async (repos) => {
      const row = await repos.operatorEvents.claimDueOne(now);
      if (!row) return;                       // nothing due
      const norm = await repos.??.normalise(row.payload);   // may signal unresolvable
      // ... insertPayment / appendLedgerEntry / incrementBalance / allocate ...
      await repos.operatorEvents.markProcessed(row.id, paymentId);
    });
  } catch (err) {
    // The apply txn already rolled back — record the failure in a SEPARATE txn.
    await uow.withTransaction((repos) =>
      repos.operatorEvents.markFailed(rowId, String(err), nextAttemptAt(attempts)));
    // exhausted → markDead in that same fresh txn
  }
  ```
  - The **unresolvable-but-clean** case (normalise resolves nothing, no ledger write attempted) *can* commit `markFailed` in the same transaction, because there is no partial write to roll back. Call this out explicitly so the two paths aren't conflated.
  - Redraw the sequence diagram: the `markFailed`/`markDead` step belongs to a **second** transaction, outside the `rect`, on the exception branch.
  - Note the claim lock is released by the rollback; that's fine (`SKIP LOCKED` + the `payments` unique guard keep re-claim idempotent), but the `attempts`/`next_attempt_at` update must persist independently or a re-claim resets nothing.

### 🟡 Should Fix

**[PR-002] No stated policy for confirmed-amount vs. expected-amount mismatch**
- **Location:** §2 Decision 4; §3 `NormalisedEvent`
- **Issue:** `normalise` resolves an account and returns `amountMinor`, but the spec never says whether the confirmed amount is validated against the correlated intent/charge amount, or simply recorded as-is.
- **Impact:** Without a stated decision, an implementer guesses. Recording the operator's amount verbatim is defensible (they moved that money), but a silent mismatch (partial capture, wrong-amount confirmation) is a reconciliation problem that should at least be logged, and possibly dead-lettered.
- **Suggestion:** Add a one-line decision: record the operator-confirmed amount as authoritative for the `PAYMENT` entry, but emit a metric/log (or a reconciliation-mismatch row, which the schema already has) when it differs from the correlated intent/charge — deferring the *handling* to the reconciliation epic if that's the intent.

**[PR-003] Money precision when extracting the amount from `payload` (jsonb)**
- **Location:** §3 `NormalisedEvent` (`amountMinor: bigint`); §7 Security
- **Issue:** The spec correctly types `amountMinor` as `bigint`, but the source is `operator_events.payload` (jsonb) — a `JSON.parse` turns a numeric field into a JS `number` (float64), which loses integer precision above 2^53 and silently corrupts large minor-unit amounts. The "money is `bigint`" invariant lives or dies at this boundary.
- **Impact:** A subtle, hard-to-test money-corruption path that only bites at large amounts — precisely where it's most damaging.
- **Suggestion:** State the rule in the adapter contract: the operator adapter must read the amount from the payload as a **string** (or integer-safe field) and convert via `BigInt(...)`, never through a JS-number intermediate. Worth a sentence in Decision 5 and the mock's obligations.

**[PR-004] `404` for unknown operator isn't in the contract**
- **Location:** §3 API Design (responses list)
- **Issue:** The spec lists `404`/`400` for an unknown `{operator}`, but `receiveOperatorEvent` in `openapi.yaml` declares only `200/202/400/401`. Per API-first, the contract is the source of truth.
- **Impact:** Minor, but it's the kind of spec↔contract drift this repo treats as a real issue.
- **Suggestion:** Map unknown-operator to the declared `400` (a malformed request path), or, if a distinct `404` is wanted, say "add `404` to the contract first" explicitly.

**[PR-005] "Never collide by construction" overstates the idempotency-key guarantee**
- **Location:** §2 Decision 6
- **Issue:** The manual `recordPayment` key namespace and `"${operator}:${eventId}"` are claimed to "never collide by construction." That only holds if manual keys are guaranteed never to take the literal `operator:eventId` shape — which nothing currently enforces.
- **Impact:** Low, but a false "by construction" can mask a real (if unlikely) collision.
- **Suggestion:** Soften to a convention ("manual keys use a distinct prefix, e.g. `manual:`"), and note it's an enforced convention rather than a structural impossibility.

### 🟢 Looks Good

- **The two-key correctness refinement (Decision 2).** Catching that `operator_event_id` is unique only *per operator* and therefore the `payments.idempotency_key` must be operator-qualified is a genuine improvement over the bean's `idempotency_key = operator_event_id`. This is exactly the kind of cross-checking a spec should do.
- **Resolve-or-dead-letter framing of INV-3 (Decision 4).** Making `normalise` responsible for *resolving* the account (never copying it from an untrusted payload) is the right place to enforce "no wrong-account credit," and it's stated crisply.
- **Reusing the record-and-allocate core (Decision 7).** Extracting the shared primitive rather than duplicating the ledger write keeps a single money-writing path and preserves the allocation invariants for free — the right call, and it names the one `PaymentHub` change precisely.
- **Honest surfacing of the correlation gap and the 202/200 discrepancy.** Both are real, both would have bitten an implementer, and both are gated to a resolution point rather than hand-waved.
- **Grounded in the actual code.** The spec references the real `PaymentDao` methods, the `UnitOfWork`/`RepositoryBundle` seam, the existing `security.ts` allowlist, and the real index names — not an idealized architecture.

---

## Consistency Check

- **Spec ↔ ADR-0003:** Aligned — inbox + CronJob relay, `FOR UPDATE SKIP LOCKED`, single-transaction apply, pull-based downstream. The spec correctly treats backoff/threshold as ADR open items.
- **Spec ↔ Contract:** Aligned except PR-004 (`404`) and the already-flagged 202/200 divergence (spec defers to the contract — correct).
- **Spec ↔ Schema:** Aligned — no invented columns; the one *possible* new column (`payment_intents.operator_reference`) is correctly parked in an open question, not assumed.
- **Spec ↔ Beans (tasks):** 1:1 with `abzp`/`fs5i`/`9uk0`/`csfz`, and the phased rollout matches the `blocked_by` graph. The spec answers the beans' explicit questions (PR-T1 recordPayment relationship; idempotency-key form).
- **Naming consistency:** Ubiquitous language (inbox, relay, normalise, DLQ, INV-1/2/3) is consistent with the ADR and spec.

---

## Summary

This is a high-quality spec: faithful to ADR-0003, grounded in the real code, and it materially improves on the source tickets (the operator-qualified idempotency key, the resolve-or-dead-letter rule). The single blocker is a transaction-boundary error on the failure path — `markFailed` is drawn inside the apply transaction that must roll back, which would defeat the retry/DLQ guarantee the spec is built to provide. That fix is small and has a working precedent in `PaymentHub.recordPayment`'s post-rollback handling. Address PR-001 (and ideally PR-002/PR-003, both money-correctness adjacent), and this is ready to proceed to implementation.

**Priority order:** PR-001 (🔴, transaction boundary) → PR-003 (money precision) → PR-002 (amount-mismatch policy) → PR-004/PR-005 (contract/wording tidy-ups).

---

## ⏸️ Awaiting Human Sign-Off

Review complete. Please confirm how to proceed:
- **Approve** — accept the verdict and proceed
- **Override** — proceed despite findings (reviewer disagrees)
- **Send back** — author addresses findings
- **Add feedback** — you have additional input
