# Normalization / decomposition analysis — payments schema

**Status:** Analysis · **Date:** 2026-09-23 · **Author:** Krzysztof Jackowski
**Subject:** `specs/payments/contracts/schema.sql` (+ init migration base tables)

Runs the classic **BCNF decomposition algorithm** over every relation: derive the functional
dependencies (FDs) from the declared keys/uniques and the domain semantics, compute candidate keys,
and test each FD `X → A` for `X` being a superkey. A relation is decomposed only when a non-trivial FD
has a non-superkey determinant.

## Method

1. **FDs** come from three sources: each PK and UNIQUE gives `key → all attributes`; domain rules give
   the rest (e.g. tax lookups).
2. **Candidate keys (CK)** = the minimal superkeys. Every table has a surrogate `id` (or a natural PK);
   most also carry a natural UNIQUE, giving a second CK.
3. **BCNF test:** for every non-trivial FD `X → A`, `X` must be a superkey. A violation triggers the
   decomposition `R → (X ∪ X⁺)  and  (R − (X⁺ − X))`.
4. **3NF** is the weaker fallback (allow `X → A` when `A` is prime); noted only where it differs.

## Result per relation

Because every table is keyed on a surrogate `id` (or single-column natural PK) and the natural
UNIQUEs are themselves candidate keys, **every determinant below is a superkey** — so each relation is
already in **BCNF** (⇒ 3NF, 2NF, 1NF). The algorithm reaches a fixpoint immediately: **no relation is
decomposed.**

| Relation | Candidate keys | Notable non-trivial FDs | NF |
|---|---|---|---|
| accounts | `{id}`, `{external_ref}` | `id → *`, `external_ref → id` | BCNF |
| account_balances | `{account_id}` | `account_id → balance_minor, currency` | BCNF · *derived (D1)* |
| account_billing_contacts | `{account_id}` | `account_id → *` | BCNF |
| child_sub_accounts | `{id}`, `{account_id, student_id}` | both → `*` | BCNF |
| enrollments | `{id}` | `id → *` | BCNF |
| tax_rates | `{id}`, `{jurisdiction, category, valid_from}` | `(jurisdiction,category,valid_from) → rate, treatment, legal_reason, valid_to` | BCNF |
| subscriptions | `{id}` | `id → *` | BCNF |
| charges | `{id}`, `{idempotency_key}` | `id → *`, `idempotency_key → id` | BCNF · *snapshot (D2), derivable (D3)* |
| payment_methods | `{id}` | `id → *` | BCNF |
| payments | `{id}`, `{idempotency_key}` | `id → *`, `idempotency_key → id` | BCNF |
| payment_intents | `{id}`, `{idempotency_key}` | `id → *` | BCNF |
| operator_events | `{id}`, `{operator, operator_event_id}` | both → `*` | BCNF |
| payment_allocations | `{id}` | `id → *` | BCNF |
| ledger_entries | `{id}` | `id → *` (append-only) | BCNF |
| refunds | `{id}`, `{idempotency_key}` | `id → *` | BCNF |
| adjustment_batches | `{id}`, `{idempotency_key}` | `id → *` | BCNF |
| adjustments | `{id}`, `{idempotency_key}` | `id → *` | BCNF |
| adjustment_batch_entries | `{id}` | `id → *` | BCNF |
| disbursements | `{id}`, `{idempotency_key}` | `id → *` | BCNF |
| invoices | `{id}`, `{number}`, `{idempotency_key}` | each → `*` | BCNF |
| invoice_lines | `{id}` | `id → *` | BCNF · *snapshot (D2)* |
| dunning_state | `{account_id}` | `account_id → *` | BCNF |
| dunning_notifications | `{id}`, `{account_id, cycle_started_at, step, channel}` | both → `*` | BCNF |
| dunning_overrides | `{id}`, `{idempotency_key}` | `id → *` | BCNF |
| settlements | `{id}`, `{operator, settlement_window}` | both → `*` | BCNF |
| reconciliation_mismatches | `{id}` | `id → *` | BCNF |
| audit_log | `{id}` | `id → *` | BCNF |

## Worked decomposition — the tax example

The one place a textbook run *would* fire is if the tax data were flattened into a single wide
relation. Take the naive universal relation:

```
CHARGE_TAX(charge_id, account_id, net, tax, gross,
           tax_jurisdiction, tax_category, effective_from,   -- the rate's key
           rate, treatment, legal_reason)
```

FDs:
- `charge_id → everything`  (surrogate key)
- `(tax_jurisdiction, tax_category, effective_from) → rate, treatment, legal_reason`

The second FD's determinant is **not** a superkey of `CHARGE_TAX` → **BCNF violation**. The algorithm
decomposes on it:

- **R1 = TAX_RATES**(`jurisdiction, category, valid_from` → `rate, treatment, legal_reason, valid_to`)
- **R2 = CHARGES**(`charge_id, account_id, net, tax, gross, tax_jurisdiction, tax_category, effective_from`)

…which is **exactly the schema** (`tax_rates` + `charges` referencing a jurisdiction/category/date).
The schema is already the algorithm's output — this is why the per-relation run above is a fixpoint.

## The three intentional denormalizations

The schema deliberately keeps three redundancies that a purist decomposition would remove. Each is a
justified performance/correctness/audit trade-off, and each has a guard that keeps it consistent —
so they are **denormalizations, not normal-form violations** (no intra-relation FD is broken).

- **D1 — `account_balances.balance_minor` is a materialized aggregate** of
  `SUM(ledger_entries.amount_minor)`. Pure normalization would drop it and compute on read. Kept for
  O(1) balance reads (NFR-2); **guarded by INV-1** (updated in the same transaction as each entry) and
  now by the append-only ledger trigger (PR-S9), and independently checked by reconciliation.
- **D2 — tax snapshot on `charges` / `invoice_lines`** (`rate, treatment, legal_reason, jurisdiction`
  copied from `tax_rates`). This is intentional **temporal denormalization**: an issued charge/invoice
  must freeze the rate *as it was at issue time*, independent of later `tax_rates` edits. Removing it
  would make historical documents mutate when a rate changes — unacceptable for financial/audit
  records. The live `tax_rates` table remains the normalized source for *new* lookups.
- **D3 — derivable columns on `charges`** (`enrollment_id` is implied by `subscription_id`;
  `student_id` by the enrollment→child chain). Kept as a denormalized snapshot so an ad-hoc charge
  (no subscription) and an invoice line can name their subject directly without a 3-table join, and so
  the subject is frozen at charge time. Note this is *not* a strict transitive FD across all rows
  (`subscription_id` is nullable for ad-hoc/first charges), so it isn't a 3NF violation — just
  controlled redundancy.

*(Aside: the `gross = net + tax` columns are a stored computed value, guarded by a CHECK — the same
category of controlled redundancy, verified rather than normalized away.)*

## Verdict

**The schema is in BCNF; the decomposition algorithm produces no further split.** The three
denormalizations (D1–D3) are deliberate and individually guarded, not defects. No action required.

**Optional, non-blocking:** if you ever want to *prove* D2's snapshot lineage, add a nullable
`tax_rate_id` FK on `charges`/`invoice_lines` pointing at the exact `tax_rates` row used — it records
provenance without denormalizing the frozen values away. Not needed for M1.
