# Peer Review: `specs/payments/contracts/schema.sql`

**Phase:** Implementation (schema design artefact — pre-migration)
**Reviewed:** 2026-09-22
**Artifacts reviewed:** `specs/payments/contracts/schema.sql` (498 lines), against `db/migrations/1758326400000_init_payments_ledger.sql`, `CLAUDE.md` invariants, ADR-0002/0003/0005, and the payments specs (glossary, CONSTRAINTS, inventory).
**Lens:** SQL/relational design best practice + coherence with the repo's invariants and ADRs.

---

## Verdict: 🔄 REVISE

A genuinely strong, well-traced schema — money-as-bigint, INV-7 balance checks, per-table idempotency keys, the single-runner billing guard, and maker/checker constraints are all done right. One 🔴 (the inbox table diverges from ADR-0003's specified retry/DLQ shape, so the async relay can't be built as designed); the rest are 🟡 hardening items to resolve before promoting to a live migration.

---

## Automated Checklist (Data Model section)

- [x] **Money columns are `bigint` minor units with a currency column** — consistent everywhere; `numeric(6,4)` used only for tax *ratio*, correctly (not money).
- [x] **Aggregate boundaries & invariants** — INV-7 (`gross = net + tax`) enforced via CHECK on charges/invoices/invoice_lines; INV-2 via `operator_events` dedup UNIQUE; INFRA-3 via the `(subscription_id, billing_period)` partial unique.
- [x] **Migration strategy** — handwritten SQL, promotion path to `db/migrations/` + `codegen:db` documented; down-migration reverses in correct dependency order.
- [ ] ⚠️ **Index strategy** — several FK columns are unindexed; time-driven sweeps lack supporting indexes (PR-S2, PR-S7).
- [ ] ⚠️ **Data integrity** — currency consistency across related money rows and conditional tax-reason NOT NULL are not enforced where they could be (PR-S3, PR-S4); bidirectional ledger FK can drift (PR-S5).
- [ ] ⚠️ **Async delivery guarantees** — `operator_events` omits the retry/backoff/DLQ columns ADR-0003 specifies (PR-S1).

---

## Deep Review Findings

### 🔴 Must Fix

**[PR-S1] `operator_events` diverges from ADR-0003's inbox contract — no retry/backoff/DLQ**
- **Location:** `schema.sql:190-204`.
- **Issue:** ADR-0003 §3 specifies the inbox row carries `status (PENDING/PROCESSED/FAILED/DEAD)`, `attempts`, `next_attempt_at`, `last_error`. This table instead has `status IN ('RECEIVED','APPLIED','DUPLICATE','REJECTED')` and **none** of `attempts` / `next_attempt_at` / `last_error`, and no `DEAD` terminal.
- **Impact:** the inbox-relay CronJob described in ADR-0003 (claim → apply-in-one-txn → retry with backoff → DLQ) cannot be implemented against this shape: there is nowhere to record attempt count, schedule the next retry, or capture the last error, and no `DEAD` state. The **DLQ-depth golden signal** (`count(status='DEAD')`, ADR-0003 open item, NFR-9) has nothing to count. This is an undiscussed deviation from an accepted ADR on the money-critical path.
- **Suggestion:** add `attempts int NOT NULL DEFAULT 0`, `next_attempt_at timestamptz`, `last_error text`, and extend the status set to include `PENDING`/`FAILED`/`DEAD` (reconcile the vocabulary with ADR-0003 — `RECEIVED`→`PENDING`, `APPLIED`→`PROCESSED`). Then add a partial index for the claim query (see PR-S7). If the intent is genuinely to drop backoff for M1, that's a decision that belongs in an ADR-0003 amendment, not a silent schema divergence.

---

### 🟡 Should Fix

**[PR-S2] Unindexed foreign-key columns**
- **Location:** `payments.payment_method_id` (`:167`), `payment_intents.payment_id` (`:182`), `operator_events.payment_id` (`:199`), `refunds.ledger_entry_id` (`:234`), `adjustments.ledger_entry_id` (`:269`), `disbursements.ledger_entry_id` (`:302`), `adjustment_batch_entries.account_id` (`:282`), `invoice_lines.charge_id` (`:334`), `reconciliation_mismatches.payment_id` (`:414`), `ledger_entries.refund_id`/`adjustment_id` (`:449-450`).
- **Issue:** Postgres does **not** auto-create indexes for FK columns. Every one of these is `ON DELETE RESTRICT` (or referenced in joins), so a parent delete/soft-close and reverse lookups do a sequential scan on the child.
- **Impact:** at 35k accounts with a growing `payments`/`ledger_entries`, "list refunds for this payment", "find the ledger entry for this refund", and RESTRICT checks degrade to full scans. Cheap to prevent now.
- **Suggestion:** add btree indexes on each. (Not every FK needs one, but these are all on tables that grow or are joined.)

**[PR-S3] Currency consistency not enforced across related money rows**
- **Location:** `payment_allocations` (`:207-213`), `refunds` (`:221-240`), `adjustments` (`:256-274`).
- **Issue:** the schema is deliberately currency-generic (PR-003), but nothing stops a `payment_allocations` row from linking a payment in one currency to a charge in another, or a refund/adjustment whose `currency` differs from its payment/account. Allocations don't even carry a currency to check.
- **Impact:** with the currency-generic design, this is a latent data-integrity hole (mixed-currency allocation → a balance that violates INV-1's single-currency assumption). PLN-only operational scope hides it today, but the DB is the last line of defence.
- **Suggestion:** either (a) enforce via composite FKs / a trigger that the allocation, refund, and adjustment currency equals the referenced payment/charge/account currency, or (b) if this stays app-enforced for M1, add a one-line comment stating the DB intentionally does not guard cross-currency and that it's gated by PLN-only (AC-8) — so the omission is a decision, not an oversight.

**[PR-S4] Conditional tax-reason NOT NULL isn't enforced despite the stated rule**
- **Location:** `tax_rates.legal_reason` (`:87`), `charges.tax_legal_reason` (`:129`), `invoice_lines.tax_legal_reason` (`:343`).
- **Issue:** all three comments say `legal_reason` is "required for EXEMPT/ZERO_RATED (AC-33)", but the columns are plain nullable with no conditional CHECK.
- **Impact:** an EXEMPT PL-tuition invoice line can be persisted with no legal basis, which AC-33 requires for the invoice to be valid — a compliance gap the DB could trivially prevent.
- **Suggestion:** `CHECK (tax_treatment NOT IN ('EXEMPT','ZERO_RATED') OR tax_legal_reason IS NOT NULL)` on each (and the equivalent on `tax_rates.treatment`).

**[PR-S5] Redundant bidirectional FK between `ledger_entries` and refunds/adjustments**
- **Location:** `ledger_entries.refund_id`/`adjustment_id` (`:449-450`) vs `refunds.ledger_entry_id` (`:234`), `adjustments.ledger_entry_id` (`:269`).
- **Issue:** the link is stored on both sides (entry → source and source → entry). This is the reason for the circular FK the comment calls out, and the two pointers can disagree (a refund pointing at entry A while entry A's `refund_id` points elsewhere/null).
- **Impact:** a consistency footgun with no single source of truth for "which ledger entry realised this refund."
- **Suggestion:** pick one direction. Given the ledger is the authoritative append-only record, I'd keep `ledger_entries.{refund,adjustment,charge}_id` (the entry names its cause) and drop `refunds.ledger_entry_id` / `adjustments.ledger_entry_id` — which also removes the circular dependency and simplifies the down-migration.

**[PR-S6] `updated_at` columns won't self-update**
- **Location:** `accounts`, `account_billing_contacts`, `subscriptions`, `charges`, `payment_intents`, `dunning_state`, … (all `updated_at timestamptz NOT NULL DEFAULT now()`).
- **Issue:** the `DEFAULT now()` only fires on INSERT; without a trigger or disciplined app writes, `updated_at` silently freezes at creation time.
- **Impact:** misleading audit/ops data ("last changed" that never changes).
- **Suggestion:** add a shared `set_updated_at()` BEFORE UPDATE trigger, or document that the DAO layer is responsible for setting it on every UPDATE.

**[PR-S7] No indexes for the time-driven sweeps**
- **Location:** `charges.expires_at` (`:132`), `dunning_state.next_action_at` (`:360`), and the `operator_events` relay claim (`:204`).
- **Issue:** the 72h-expiry job (`WHERE status IN ('PENDING','REQUIRES_ACTION') AND expires_at < now()`), the dunning tick (`WHERE next_action_at < now()`), and the inbox relay (`WHERE status=… ORDER BY received_at … FOR UPDATE SKIP LOCKED`) have no supporting index; `charges_account_status_idx` is `(account_id, status)` — useless for a global time sweep.
- **Impact:** each CronJob tick full-scans a growing table.
- **Suggestion:** partial indexes, e.g. `CREATE INDEX ON charges (expires_at) WHERE status IN ('PENDING','REQUIRES_ACTION')`, `CREATE INDEX ON dunning_state (next_action_at)`, and `CREATE INDEX ON operator_events (status, received_at)` (folds into the PR-S1 rework).

**[PR-S8] Base-table constraints not brought in line with the new tables**
- **Location:** `payments.currency` / `payments.status` (init migration; not amended by the `ALTER` at `:164`), `ledger_entries.currency`, `account_balances.currency`.
- **Issue:** the new tables consistently `CHECK (char_length(currency) = 3)` and enumerate statuses via CHECK; the pre-existing `payments`/`ledger_entries`/`account_balances` currency columns have no shape check, and `payments.status` is free text (no CHECK) even though a payment state set now exists.
- **Impact:** inconsistent validation — a malformed currency or bogus payment status can land in exactly the oldest, most-referenced tables.
- **Suggestion:** add the `char_length(currency)=3` CHECK to the three base columns and a `payments.status` CHECK (via `ALTER TABLE … ADD CONSTRAINT`), so the invariant is uniform.

**[PR-S9] "Append-only" / "immutable" are comments, not constraints**
- **Location:** `ledger_entries` (append-only per `CLAUDE.md`), `audit_log` (`:427`, "immutable").
- **Issue:** nothing at the DB level prevents UPDATE/DELETE; ADR-0005's runtime role has full DML (which includes UPDATE/DELETE), so the append-only invariant rests entirely on app discipline.
- **Impact:** the single most important financial invariant (immutable ledger, INV-4) has no defence-in-depth; one errant `UPDATE ledger_entries` corrupts the audit trail irrecoverably.
- **Suggestion:** consider a `BEFORE UPDATE OR DELETE` trigger that raises on these two tables, or narrow the runtime role's grants to INSERT/SELECT on them. Worth an explicit decision since it's a headline invariant.

---

### 🟢 Looks Good

- **Money discipline is exemplary** — `bigint` minor units throughout, signed only where a ledger/adjustment needs it, and `numeric(6,4)` reserved for the tax *ratio* with a clear "exact, not money" comment. This is the trap most payment schemas fall into and it's handled correctly (NFR-10).
- **Invariants encoded as constraints, not hopes** — `gross = net + tax` CHECK on charges/invoices/invoice_lines (INV-7); `operator_events` `UNIQUE(operator, operator_event_id)` giving at-most-once (INV-2); and especially the **partial unique `charges_subscription_period_uniq`** — a clean, correct guard against the month-start double-charge under pod clustering (INFRA-3 / NEW-DEBT-1).
- **Maker/checker enforced in SQL** — `CHECK (checker_id <> maker_id)` on refunds/adjustments/disbursements/overrides is exactly the segregation-of-duties control NFR-6 asks for, at the right layer.
- **Idempotency everywhere it matters** — a UNIQUE idempotency key on every money-moving mutation table (charges, payment_intents, refunds, adjustments, batches, disbursements, invoices, overrides). Consistent and correct (PR-005/AC-17).
- **GDPR by construction** — 1:1 `account_billing_contacts` so an erasure redacts a single row without touching the ledger; students by ID only; student name deliberately *not* persisted on `invoice_lines` (AC-49/AC-50). Thoughtful.
- **Down-migration** reverses in correct dependency order, and the circular ledger FK is correctly deferred to the end — the author clearly reasoned about ordering.
- **Traceability** — nearly every table/column cites its AC/INV/PR/DAT origin; this makes the schema reviewable against the spec in a way most aren't.

---

## Consistency Check

- **Schema ↔ invariants (`CLAUDE.md`):** money/bigint ✓, ledger append-only ✓ *(by convention only — PR-S9)*, balance == Σ entries supported by the existing `account_balances` design ✓.
- **Schema ↔ ADRs:** ADR-0002 (dedicated schema/role) ✓; ADR-0005 (migration-first, forward-only-with-dev-down) ✓; **ADR-0003 (inbox retry/DLQ) ✗ — PR-S1.**
- **Schema ↔ specs:** state machine (`charges.status`), tax model (net/tax/gross + treatment), dunning steps/window, reconciliation mismatch queue all match the glossary/decisions. Naming follows the ubiquitous language.
- **Not executed:** I reviewed statically and did not apply this to a database. Recommend the equivalent of the mermaid-render gate — promote to `db/migrations/` and run `pnpm db:migrate` against a throwaway Postgres (Testcontainers/Docker) — before merge, to catch ordering/syntax issues the eye misses.

---

## Summary

High-quality schema that encodes the hard invariants as real constraints — well above the usual bar. The one blocker is coherence, not correctness: `operator_events` doesn't match the inbox contract ADR-0003 committed to, so fix the retry/DLQ columns (or amend the ADR) before this becomes a migration. Then the 🟡 hardening pass in priority order: FK indexes and sweep indexes (PR-S2/S7 — pure performance debt), currency + tax-reason integrity (PR-S3/S4 — correctness the DB should own), the bidirectional-FK cleanup (PR-S5), and the append-only/`updated_at` decisions (PR-S9/S6). None of the 🟡s require rethinking the design.

---

## Resolution — fixes applied & validated (2026-09-23)

All findings were applied to `schema.sql` and the result was validated by applying the init migration
+ the reworked schema to a throwaway `postgres:16-alpine` (Docker) via `psql`, asserting each new
guard fires, and confirming the down-migration reverses cleanly.

| Finding | Outcome |
|---|---|
| **PR-S1** operator_events retry/DLQ | ✅ Fixed — added `attempts`, `next_attempt_at`, `last_error`; status set now `PENDING/PROCESSED/FAILED/DEAD/DUPLICATE/REJECTED` (reconciled with ADR-0003); `(status, next_attempt_at)` claim index doubles as the DLQ-depth index. |
| **PR-S2** FK indexes | ✅ Fixed — added indexes on `charges.subscription_id`, `payments.payment_method_id`, `payment_intents.payment_id`, `operator_events.payment_id`, `adjustment_batch_entries.account_id`, `invoice_lines.charge_id`, `reconciliation_mismatches.payment_id`. (Source→ledger FKs left unindexed by design — `ledger_entries` is never deleted, PR-S9.) |
| **PR-S3** currency consistency | ⚠️ Documented, not enforced — cross-currency equality stays app-gated (PLN-only, AC-8) for M1; composite-FK hardening deferred to multi-currency. Now an explicit, commented decision. |
| **PR-S4** tax legal_reason CHECK | ✅ Fixed — conditional CHECK on `tax_rates`, `charges`, `invoice_lines`. Verified: EXEMPT without reason rejected; with reason accepted. |
| **PR-S5** bidirectional ledger FK | ✅ Fixed — single-direction: correction rows keep `ledger_entry_id`; dropped `ledger_entries.refund_id`/`adjustment_id`. Removes the cycle and keeps `ledger_entries` INSERT-only (prerequisite for PR-S9). |
| **PR-S6** updated_at | ✅ Fixed — shared `set_updated_at()` BEFORE UPDATE trigger on the six tables with `updated_at`. Verified it bumps. |
| **PR-S7** sweep indexes | ✅ Fixed — partial index on `charges(expires_at) WHERE status IN (…)`, `dunning_state(next_action_at)`, and the `operator_events` claim index. |
| **PR-S8** base-table checks | ✅ Fixed (currency) — `char_length=3` CHECK added to `payments`/`ledger_entries`/`account_balances`. `payments.status` CHECK **deferred**: the payment-status vocabulary isn't defined in the schema, so enumerating it here would be guesswork. |
| **PR-S9** append-only enforcement | ✅ Fixed — `forbid_mutation()` BEFORE UPDATE OR DELETE trigger on `ledger_entries` and `audit_log`. Verified both UPDATE and DELETE raise. |

**Validation performed:** `psql` apply of `init.up` → `schema.up` (27 tables, no errors); behavioural
assertions above; `schema.down` → `init.down` reverses to **0 residual tables**. Two carry-overs remain
as noted decisions, not defects: PR-S3 (app-gated for M1) and the `payments.status` half of PR-S8
(needs the status vocabulary defined first).

**Post-fix verdict: ✅ APPROVED** (the two carry-overs are documented decisions, not blockers).

---

## ⏸️ Awaiting Human Sign-Off

Review complete. Please confirm how to proceed:
- **Approve** — accept the verdict; I'll apply fixes (starting with PR-S1) on request
- **Override** — proceed despite findings
- **Send back** — author addresses findings
- **Add feedback** — you have additional input
