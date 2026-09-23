# Peer Review: Tech Spec — Charge Lifecycle & Payment Allocation

**Phase:** Architecture
**Artifact:** `docs/tech-spec-charge-lifecycle-payment-allocation.md` (epic `edugo-payments-service-f4c4`)
**Reviewed:** 2026-09-23
**Artifacts cross-checked:** `specs/payments/spec.md`, `docs/prd.md`, `openapi/openapi.yaml`, `db/migrations/1790150435617_payments-core.sql`, `db/migrations/1758326400000_init_payments_ledger.sql`, `src/payments/**`, `docs/adr/0001` & `0003`, epic/child beans `f4c4/1t6l/d4bk/ncro/5sjm`

---

## Verdict: ✅ APPROVED

The architecture is sound and spec-compliant: the ledger-neutral allocation decision, the negative-gross `CHARGE` sign convention, the `FOR UPDATE` oldest-first locking, and the single-transaction `{ payments, charges }` bundle are all correct and correctly justified. No 🔴 blockers. The 🟡 findings below are refinements to lock down before implementation begins — chiefly one factual inaccuracy (index support for `listCharges`) and three under-specifications (non-EXEMPT tax rounding, tax-resolver layering, allocation's eventual home).

---

## Automated Checklist

### Tech Spec — Completeness
- [x] **PRD coverage** — FR-7/8/9 (append-only ledger, atomic materialized balance, oldest-first allocation) and INV-1/5/7 are all addressed; FR-1/2/3 (billing run), FR-10/11/12 (refunds/chargebacks/corrections), FR-13/15 (dunning/reconciliation) are correctly deferred as non-goals with traceability.
- [x] **Context & goals** — Motivation ("balance only ever trends positive; the receivable side is missing") is crisp and correct.
- [x] **Architecture approach** — Five decisions each carry alternatives, rationale, trade-offs, reversibility; consistent with hexagonal/DDD and the five principles.
- [x] **Bounded-context placement** — Stays inside `src/payments/`; no new cross-context dependency.

### Tech Spec — API Design
- [x] **Contract-first** — All four operations already exist in `openapi.yaml` bound by `operationId`; spec correctly states it implements handlers with **no contract change**. Verified `createCharge`, `getCharge`, `listCharges`, `recordPayment` and the `Charge`/`TaxBreakdown`/`Page` schemas exist.
- [x] **Error handling** — Maps to `DomainError` → `application/problem+json`; correctly flags that `EnrollmentNotFoundError` must be added to `server.ts` to get 404 (otherwise it defaults to 422/500). Good catch.
- [x] **Consistency** — `/api/v1` conventions, cursor pagination envelope, and idempotency semantics mirror the existing `recordPayment` slice.
- [x] **Idempotency** — `Idempotency-Key` → `charges.idempotency_key` UNIQUE, `23505` → `DuplicateIdempotencyKeyError` → replay, mirroring `recordPayment`. Verified the `IdempotencyKey` param is `required: true` in the contract and the column is `NOT NULL UNIQUE`.
- [x] **Validation rules** — Delegated to ajv/OpenAPI (`additionalProperties:false`, `netMinor ≥ 1`, `currency` enum) — not hand-rolled. Correct.

### Tech Spec — Data Model
- [x] **Table definitions** — Accurately reflects the live DDL; money is `bigint` minor units + currency; documents the `.toString()`/`BigInt()` round-trip and the "never set `updated_at`" trigger rule.
- [x] **Aggregate boundaries & invariants** — INV-1/5/7 identified; the append-only ledger and the ledger-neutral allocation boundary are explicit.
- [x] **Migration strategy** — Correctly identifies this epic as **code-only** (tables already migrated). No ORM/schema-first tooling introduced.
- [ ] ⚠️ **Index strategy** — The spec claims `listCharges`/oldest-first is "a keyset page over `charges_account_status_idx`" and "index-friendly." The live index is `(account_id, status)` — it does **not** cover the `ORDER BY created_at, id` seek. See PR-002.
- [x] **Data integrity** — `charges_gross_chk` (INV-7), `charges_tax_legal_reason_chk`, and the UNIQUE idempotency key are all correctly leaned on. (INV-5 has no DB backstop — see PR-004, a defensible observation given the frozen schema.)

### Tech Spec — Integration Points
- [x] **External services** — Correctly notes none (self-contained; operator integration is a separate epic).
- [ ] ⚠️ **Async flows** — The spec keeps `PAYMENT` posting synchronous (NG-E) but does not reconcile this with ADR-0003 / NFR-2/3, where the `PAYMENT` entry is posted by the inbox-relay on operator confirmation (~1–2 min eventual). Allocation is being attached to a path that will move. See PR-001.
- [x] **Failure handling** — Transaction rollback + idempotent retry is the right model for a single-DB synchronous flow.
- [-] **Eventual consistency** — N/A to this epic's synchronous flow (but see PR-001 for the seam).

### Tech Spec — Non-Functional Requirements
- [x] **Quantified targets** — Reasonably argues correctness-over-throughput at single-digit TPS; per-account lock contention scope is called out. Acceptable given the PRD's burst is a billing-run (M2) concern, not this write path.
- [x] **Security** — AuthN/Z correctly scoped out (ASM-4, AC-48 later); PII posture (opaque `student_id`, AC-49) preserved; `bigint` end-to-end with the single guarded `Number()` cast noted.
- [x] **Observability** — OTEL opt-in respected; suggested counters are sensible and non-mandatory.

### Tech Spec — Open Questions
- [x] **No blocking unknowns** — Q1/Q2 resolved (TUITION category; read endpoints in scope); Q3 (multi-currency) correctly deferred and non-blocking.
- [x] **Risk assessment** — R1–R6 identify the real hazards (double-count, over-allocate, shared seam, `updated_at` fight, wrong sign, partial-payment outstanding) with mitigations.

**Checklist Summary:** 21/23 passed, 2 failed, 1 N/A (0 blocking).

---

## Deep Review Findings

### 🔴 Must Fix

_No must-fix findings._ The approach is correct and safe to build on.

---

### 🟡 Should Fix

**[PR-001] Allocation is attached to the synchronous `recordPayment`, but the target architecture posts `PAYMENT` on operator confirmation**
- **Location:** §1 NG-E, §2 Decision 3, §4 "record a payment with allocation"
- **Issue:** The spec (correctly, per the existing slice) puts the ledger-neutral allocation loop inside `PaymentHub.recordPayment`, which posts the `PAYMENT` entry synchronously. But INV-3/AC-13 require a `PAYMENT` only on operator confirmation, and ADR-0003 / NFR-2/3 place that posting in the **inbox-relay worker** (~1–2 min eventual), not in the synchronous `POST /payments`. When the operator-confirmation epic lands, the `PAYMENT` entry — and therefore the allocation that must be atomic with it — will move to the relay apply path.
- **Impact:** If this isn't stated as an explicit seam, the allocation logic risks being written in a way that's awkward to relocate, or a future change posts the `PAYMENT` in the relay while allocation stays in `recordPayment`, splitting an atomic unit across two transactions and breaking INV-5's "same-transaction" guarantee.
- **Suggestion:** Add one sentence to NG-E (or Decision 3): "Allocation is a step that runs **in the same transaction as the `PAYMENT` entry**; when `PAYMENT` posting moves to the inbox-relay apply path (operator-confirmation epic), allocation moves with it. It is deliberately factored as a `PaymentHub` method that operates on the transaction's repo bundle, not as HTTP-handler logic, so it travels." This is disclosure + a design constraint, not a redesign.

**[PR-002] `listCharges`/oldest-first ordering is not backed by the cited index**
- **Location:** §3 Endpoint 4 ("a keyset page over `charges_account_status_idx`… index-friendly") and §5 (`findOpenChargesByAccountForUpdate` ordering)
- **Issue:** The live index is `charges_account_status_idx (account_id, status)`. It supports the `WHERE account_id = ? [AND status = ?]` filter, but the `ORDER BY created_at ASC, id` (keyset seek / oldest-first) is **not** covered — Postgres will filter via the index then sort the result set. The claim "keyset page over `charges_account_status_idx`… index-friendly" overstates what the index provides.
- **Impact:** Functionally correct and fine at single-digit-TPS / small open-charge counts, but the spec asserts an index property that doesn't exist. An engineer trusting it might not notice the sort, and a reviewer of the later PR could flag a "missing index" with no guidance.
- **Suggestion:** Correct the wording: the filter is index-served, the ordering is an in-memory sort of the (small) filtered set — acceptable for M1. If you want the ordering index-served, note a **future** migration adding `(account_id, status, created_at, id)` — but that's out of scope here (frozen schema), so simply stop claiming index-friendliness for the sort.

**[PR-003] Tax breakdown for a *found* non-EXEMPT rate is under-specified (rounding, AC-31)**
- **Location:** §2 Decision 5, §3 Endpoint 1
- **Issue:** The resolver looks up `tax_rates (PL, TUITION, today)` and defaults to EXEMPT when unmatched. But if a row **is** found with `treatment = STANDARD/REDUCED` (someone seeds one), the spec doesn't say how `tax_minor`/`gross_minor` are computed. AC-31 requires half-up rounding to the minor unit per line.
- **Impact:** INV-7 (`gross = net + tax`) is DB-enforced so it can't be *violated*, but the tax *amount* could be computed inconsistently (truncation vs half-up) the moment a non-exempt rate exists, and the behavior would be silently implementation-defined.
- **Suggestion:** State one of: (a) "M1 produces EXEMPT for every charge regardless of any `tax_rates` row; non-exempt computation is deferred with the effective-dated engine (NG-A)" — simplest and matches scope; or (b) if a found rate is honored, specify `tax_minor = roundHalfUp(net_minor * rate)` and `gross = net + tax` (AC-31), and put that math in the `TaxBreakdown` domain VO. (a) is the ponytail-simplest and consistent with "default EXEMPT for M1."

**[PR-004] INV-5 has no database backstop (observation, not a blocker)**
- **Location:** §5 `payment_allocations`, §7 correctness invariants
- **Issue:** INV-7 is enforced by a CHECK (`charges_gross_chk`); INV-1 by the same-transaction increment; but INV-5 ("Σ allocations per charge ≤ gross") is enforced **only** by application logic (the `FOR UPDATE` lock + the outstanding computation) and the `5sjm` test suite. There's no `UNIQUE`/exclusion constraint or trigger preventing an over-allocation row if the app logic regresses.
- **Impact:** Defense-in-depth gap. The `FOR UPDATE` design is the correct primary guard and is sufficient for M1; this is about resilience to future bugs, and the schema is frozen for this epic so it can't be fixed here anyway.
- **Suggestion:** Note it explicitly as an accepted risk in §10 (alongside R2), and leave a forward-pointer: a future migration could add a per-charge allocation-sum guard (trigger or generated `settled_minor` column + CHECK). No action this epic.

**[PR-005] Tax-*lookup* vs tax-*math* layering aside is loose**
- **Location:** §2 module placement note and §6 ("register a tax resolver only if extracted… otherwise a private method of `ChargeDao`/`PaymentHub`")
- **Issue:** The "or `PaymentHub`" phrasing risks putting a DB query (the `tax_rates` lookup) in the framework/DB-free domain layer, which violates the hexagonal boundary. The spec elsewhere gets this right (`resolveTax` as a `ChargeRepository` port method; `TaxBreakdown` as a domain VO), so this is just an inconsistent aside.
- **Impact:** If read literally, an engineer could issue a Kysely query from `PaymentHub`, breaking the "domain imports no DB/framework types" principle.
- **Suggestion:** Make the split explicit: the **rate lookup** is an adapter concern (`ChargeRepository.resolveTaxRate` / `ChargeDao`); the **breakdown math** (net→tax→gross, treatment, legal reason) is domain (`TaxBreakdown` VO). `PaymentHub` orchestrates: `repos.charges.resolveTaxRate(...)` → `TaxBreakdown.from(net, rate)`. Drop "or `PaymentHub`" as a home for the lookup.

**[PR-006] Currency-mismatch-throws will fail an entire payment (fine for M1, note the future semantics)**
- **Location:** §2 Decision 4 / §6 failure table (`CurrencyMismatchError` → 422), Q3
- **Issue:** Allocation asserts `payment.currency == charge.currency` and throws. In PLN-only M1 this can't fire (good). But the chosen semantics — *throw and roll back the whole payment* if any open charge has a different currency — is the wrong behavior for a future multi-currency world, where you'd **skip** non-matching charges and allocate only within-currency.
- **Impact:** None for M1; a latent design decision that Q3 defers. Worth pinning so the future engineer doesn't inherit "fail the payment" as if it were intended end-state.
- **Suggestion:** In Q3, add: "M1 asserts equality and throws (cannot occur under PLN-only). Multi-currency should instead **filter** open charges to the payment's currency and allocate within it — a change to the allocation query, not the invariant." One line; keeps the deferral honest.

---

### 🟢 Looks Good

- **The ledger-neutral allocation decision (Decision 3) is exactly right and exceptionally well-argued.** Correctly identifies that "over-allocation becomes credit" is *emergent* from the CHARGE(−)/PAYMENT(+) entries, not a new `CREDIT` entry, and pins it with a test assertion (INV-1 unchanged by allocation). This is the single easiest thing to get wrong in this epic and the spec nails it — including calling out the naive mental model as the risk (R1).
- **`amountOwedMinor` as live outstanding is consistent with the contract.** I checked: the `Charge` schema describes it as "Remaining owed on this charge (gross), signed per the ledger convention," and the `ChargePending` example shows `-149900` (full gross when no allocations). The spec's `−(gross − Σ allocations)` interpretation (SETTLED reads 0) matches "Remaining owed" precisely. Good alignment.
- **Correctly identified the epic as code-only.** Recognizing that `charges`/`payment_allocations`/`tax_rates` are already migrated and the operations already exist in the contract — and therefore that migration-first/contract-first are already satisfied — avoids a whole class of wasted work and is the right read of the repo state.
- **The `EnrollmentNotFoundError` → `server.ts` mapping catch.** Easy to miss that an unmapped `DomainError` silently becomes a 422; flagging the `server.ts` edit up front is the kind of detail that saves a review cycle.
- **Shared-seam coordination (Decision 1 / R3 / Phase 1).** Treating the `UnitOfWork` bundle reshape as "do it once, first, both epics consume it" (PR-E2-4) correctly manages the cross-epic hazard with the Tier-1 relay.
- **`FOR UPDATE` oldest-first lock ordering.** Locking in `created_at ASC` order is not just for allocation order — it also gives a stable lock order that avoids deadlocks between two same-account payments. The spec notes this; nice.

---

## Consistency Check

- **Spec ↔ Contract/Schema:** Verified directly. Endpoints, `operationId`s, request/response schemas, the `Idempotency-Key` required flag, `Limit`/`Cursor` params, and the `charges`/`payment_allocations`/`tax_rates` DDL (CHECKs, indexes, trigger-owned `updated_at`) all match the spec's descriptions. One inaccuracy: the index-support claim (PR-002).
- **Spec ↔ decisions/AC:** AC-11/19/20/21/29/30/32/33 and INV-1/5/7 are correctly cited and used. PR-008 (`FOR UPDATE`) traced to `decisions.yaml`. NG-A..E each trace to a deferred decision.
- **Spec ↔ child tasks:** The four phases map 1:1 to `1t6l/d4bk/ncro/5sjm` with matching acceptance gates; blocked-by ordering is respected. The read endpoints were correctly folded into Phase 2 per the update.
- **Naming consistency:** Ubiquitous language (Charge, Allocation, Credit, Arrears, Outstanding, Tax breakdown) matches `glossary.md`/`spec.md`. `ChargeStatus` union matches the DB CHECK and the OpenAPI enum.

---

## Summary

This is a strong, implementable architecture spec that correctly identifies the load-bearing decision (ledger-neutral allocation) and gets the hexagonal boundaries, sign convention, locking, and transaction seam right — all verified against the live contract and migrations. Nothing blocks approval. Before the first PR, tighten five things: state that allocation must travel with the `PAYMENT`-posting path when it moves to the relay (PR-001), stop claiming index support for the `listCharges` sort (PR-002), pin the M1 tax path as EXEMPT-only or specify half-up rounding (PR-003), fix the tax-resolver layering aside (PR-005), and add the two forward-pointers (INV-5 DB backstop PR-004, multi-currency skip-not-throw PR-006). All are wording/scoping refinements, not redesigns.

---

## ✅ Resolution (2026-09-23)

Human chose **Send back**; all six 🟡 findings were addressed in
`docs/tech-spec-charge-lifecycle-payment-allocation.md`:

- **PR-001** — NG-E now carries a "Design constraint": allocation runs in the same transaction as
  the `PAYMENT` entry and is factored as a `PaymentHub` method (not handler logic), so it travels to
  the inbox-relay apply path when `PAYMENT` posting moves there.
- **PR-002** — Endpoint 4 "Pagination & index reality" now states the filter is index-served and the
  `created_at, id` ordering is an in-memory sort at M1 scale; the index-friendliness claim for the
  sort is removed, with a future-index forward-pointer.
- **PR-003** — Decision 5 now pins M1 as **EXEMPT-only for every charge**; found-rate computation +
  AC-31 half-up rounding are deferred (NG-A) and located in the `TaxBreakdown` domain VO.
- **PR-004** — Added risk **R7**: INV-5 has no DB backstop; accepted for M1 (FOR UPDATE is the
  primary guard, schema frozen) with a defense-in-depth forward-pointer.
- **PR-005** — Tax **lookup** (`ChargeDao.resolveTaxRate`, adapter) vs **math** (`TaxBreakdown` VO,
  domain) split is now explicit in §2 and §6; "or `PaymentHub`" removed. Sequence diagram + port
  method list updated (`resolveTaxRate`).
- **PR-006** — Q3 now records M1 assert-and-throw as a safety check and the future multi-currency
  end-state as **filter-not-throw**.

Verdict stands at ✅ **APPROVED**; the spec is ready for implementation (Phase 1 — the `UnitOfWork`
bundle seam, task `1t6l`).
