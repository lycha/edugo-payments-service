# Payments — Glossary (Ubiquitous Language)

**Context:** payments · **Status:** draft from gap-interrogation workshop 2026-09-21 (+ peer-review dispositions)
**Sources:** `docs/prd.md`, `specs/payments/feature-inventory.yaml`, `specs/payments/workshop-output.md`, `db/migrations/1758326400000_init_payments_ledger.sql`

The one authoritative vocabulary for design ↔ API ↔ schema. Every term used in the OpenAPI contract, the SQL schema, and the code should map to an entry here. `→ maps to:` names the concrete schema/code anchor where one exists; **(candidate)** marks a term whose schema does not yet exist (added by the workshop). "Avoid" lists rejected synonyms that cause drift.

---

## Core aggregate & identity

### Parent account
The single **balance-bearing unit** and the primary user of the system. A parent has exactly one authoritative balance; all charges, payments, credits, and corrections for that parent's children resolve against it. Modelled like a consumer bank profile: one parent profile owns N child sub-accounts.
→ maps to: `accounts`, `account_balances` (keyed by `account_id`). Avoid: "user account" (ambiguous with student), "customer".

### Child sub-account **(candidate)**
A sub-account under a parent account, one per child, used to attribute charges and enrollments. **Not** a balance-bearing unit — it carries no authoritative balance (per-child figures are *derived*, see **Derived balance**).
Avoid: "student account" (that lives in a separate, out-of-scope system).

### Enrollment (class / course enrollment) **(candidate)**
The link between a child and a classroom/course. Each enrollment is attached to a (sub-)account and is what a recurring subscription bills against. Appears as a line-item attribution on charges and invoices.

### Student
The child beneficiary — a **minor, GDPR-sensitive, non-payer**. In the payments context a student is referenced **by internal ID only**; no student PII is persisted here. Student name appears on invoices but is **rendered at invoice-generation time** from the (out-of-scope) student system, never stored in payments.
Avoid storing any student PII in this context.

---

## Money & the ledger

### Money / minor units
All monetary amounts are **integer minor units** of their associated currency (grosze for PLN) held as `bigint` — **never floats** (NFR-10). The **data layer is currency-generic**: every money-bearing row carries an ISO-4217 `currency` code alongside its minor-unit amount, so additional currencies can be added without a schema change. **Operational scope is PLN-only this iteration (A4)** — enforced by an allowed-currency validation, not by the schema. (PR-003)
→ maps to: `*_minor` columns, `currency`, and the `Money` value object in code.

### Ledger entry
An immutable, **append-only** record of a single financial event on an account. Corrections are **new reversing entries**, never updates or deletes (INV-4). The ledger is the single source of truth.
→ maps to: `ledger_entries` (`entry_type`, `amount_minor` signed, `currency`, `reference`, `payment_id`).

### Entry type
The kind of ledger entry. Enumerated set: `CHARGE`, `PAYMENT`, `REFUND`, `PARTIAL_REFUND`, `DISCOUNT`, `LATE_FEE`, `ADJUSTMENT`, `CREDIT`, `FEE`, `CHARGEBACK`.
→ maps to: `ledger_entries.entry_type` CHECK constraint.

### Sign convention
`balance = Σ ledger_entries` (INV-1). Signs match the migration (`amount_minor` is signed; "PAYMENT is positive (credits the balance)"):

| Entry type | Sign | Balance | Meaning |
|---|---|---|---|
| `PAYMENT` | **+** | ↑ | customer paid |
| `CREDIT` | **+** | ↑ | credit / overpayment in the customer's favour |
| `DISCOUNT` | **+** | ↑ | reduces amount owed |
| `CHARGE` | **−** | ↓ | tuition due; magnitude = amount owed (gross) |
| `LATE_FEE` | **−** | ↓ | additional amount owed |
| `REFUND` / `PARTIAL_REFUND` | **−** | ↓ | money returned to the customer (reverses a payment/credit) |
| `CHARGEBACK` | **−** | ↓ | forced reversal of a settled payment |
| `ADJUSTMENT` | **±** | either | audited manual correction, signed per case |
| `FEE` | — | — | operator processing fee — **house/settlement ledger only, never posted to a customer account** (it is not something a parent owes; posting it would corrupt the parent balance and INV-1) |

**Positive balance = customer in credit; negative = arrears; zero = settled.** (The receivable convention — positive = owed — was rejected because it contradicts the migration's committed sign.)

### Arrears
A **negative** parent balance — money the customer owes past its due point. What dunning acts on.

### Write-off
An audited `ADJUSTMENT` that clears uncollectable arrears (brings the owed portion of the balance to zero) rather than expecting payment. Requires maker/checker; never an in-place edit (INV-4).

### Balance (materialized parent balance)
The **authoritative** current balance of a parent account, maintained atomically in the same transaction as each ledger entry. Invariant: `balance == Σ ledger_entries` for the account (INV-1). Read path is **O(1)** (no recompute from history).
**Meaning of the sign:** a **positive** balance = the customer is **in credit**; a **negative** balance = **arrears** (owed); **zero** = settled. See **Sign convention**.
→ maps to: `account_balances.balance_minor`.

### Derived balance (per-student / per-class)
A per-child or per-class figure **computed** from charge/allocation attribution. **Not stored** and **not** an authoritative sub-ledger (workshop NEW-Q-B). There is no `parent == Σ(children)` transactional invariant.

### Credit / wallet
Positive balance held for a parent from overpayment or over-allocation (INV-5: over-allocation becomes credit). On account close, residual credit is **returned to the parent** — preferably via the **operator refund path** against an original capture, but when no refundable original exists (push overpayment, a manual `CREDIT`, or a payment past the operator's refund window) it is returned via a **manual disbursement / bank-transfer payout**: an audited, maker/checker'd back-office action. Un-disbursable credit follows the written finance policy (e.g. escheatment); it is never silently kept. (PR-004)
→ maps to: `CREDIT` entry type; net credit reflected in the parent balance.

### Allocation
Applying a payment across one or more open charges. Partial payments apply **oldest-first** (FR-9). Because allocation is a read-then-write across multiple charge rows, the target charges are **locked with `SELECT … FOR UPDATE`** within the allocation transaction: the single-row atomic balance increment protects INV-1 but not INV-5 *across* charges, so concurrent payments to the same account must serialize on the charges they touch to avoid double-allocation. (PR-008)

---

## Tax

### Tax (VAT)
Tax is modelled **inside payments** (not delegated to accounting). Every taxable charge / invoice line carries a full breakdown in minor units — **net**, **tax**, **gross** — plus **tax rate**, **tax treatment**, and **jurisdiction**. The parent sees net + tax + gross. Needed for international expansion (pairs with the currency-generic data layer, PR-003). (PR-009)
**INV-7:** `gross = net + tax` on every taxable line.
→ maps to: `net_minor`, `tax_minor`, `gross_minor`, `tax_rate`, `tax_treatment`, `tax_jurisdiction` on charge / invoice lines. **(candidate)**

### Net / Tax / Gross
**Net** = price before tax; **Tax** = computed tax amount; **Gross** = net + tax = what the customer owes and pays. The **ledger and balance operate in gross** (sign convention unchanged); net and tax ride along as attributes on the `CHARGE` for the invoice display and reporting — charges are **not** split into separate net + tax ledger entries.

### Tax treatment
One of `STANDARD` | `REDUCED` | `ZERO_RATED` | `EXEMPT`, each with a **legal reason code**. An `EXEMPT` / `ZERO_RATED` line still appears on the document (e.g. "VAT exempt — art. 43", tax = 0), never omitted. PL tuition defaults to **EXEMPT**.

### Tax rate table **(candidate)**
An **effective-dated** table keyed by `(jurisdiction, product/category, date)` that resolves the rate + treatment for a charge — rates change over time and differ by country. For this exercise a seed/config table; multi-jurisdiction-ready, international rollout deferred.

### Tax rounding
Tax is computed **per line, half-up to the minor unit**, then lines are summed for the document total (never computed on the rounded total). A correctness rule on par with the integer-minor-units rule. (CONSTRAINTS FIN-1)

---

## Charging & billing

### Subscription
A fixed monthly fee per active enrollment (A5), billed on the account's billing day. Prorated to actual usage on cancellation (FR-3).

### Charge
An amount owed, posted as a **negative (debit)** `CHARGE` ledger entry whose magnitude is the amount owed, carrying `student_id` + enrollment attribution. Monthly per active subscription (FR-1); mid-month enrollment produces a **prorated first charge** (FR-2); a new order triggers the first charge, the billing run generates subsequent ones (A7). A charge is never double-paid (INV-5). Carries the full **tax breakdown** (net/tax/gross + rate + treatment + jurisdiction, see **Tax**); the **gross** is what posts to the ledger.

### Billing day
The calendar date (in the **business timezone**, Europe/Warsaw) a subscription is charged. Shared across accounts except the first month (A6). If the billing day (29/30/31) exceeds the month length, it **clamps to the last day of the month**.

### Billing run
The scheduled job that generates recurring charges. Must be **single-runner-safe** across clustered pods (leader election / advisory lock) to avoid double-charging (NEW-DEBT-1).

### Proration
Adjusting a charge to actual usage — for mid-month enrollment (first charge) and for cancellation (current charge).

---

## Payments & operator integration

### Payment
Money received to settle charges. **Push** = parent-initiated via the operator's hosted page/redirect (FR-5). **Pull** = automatic charge of a stored method (FR-4). Recorded as a `PAYMENT` ledger entry only on operator confirmation (INV-3).
→ maps to: `payments`, `PAYMENT` entry type.

### Payment method / token / mandate
A stored means of payment. Card data is **tokenized at the operator** (PCI SAQ-A); we store only tokens/mandates (A11, DD-6). A mandate is the card-on-file authorization for recurring MIT charges.

### CIT / MIT / SCA
**CIT** (customer-initiated transaction) — the first payment, requires **SCA** (strong customer authentication, PSD2). **MIT** (merchant-initiated transaction) — subsequent recurring pull charges (FR-4, NFR-6).

### Idempotency key
A unique key making an operation exactly-once in effect (FR-6, INV-2). We **own** dedup/idempotency; a duplicate key is a **no-op**. **Every money-moving mutation carries one** — payment capture, refund, partial refund, adjustment, and chargeback application — not just payment capture; a retried request (network blip, double-click, queue redelivery) must never move money twice. Also covers inbound operator notifications. (PR-005)
→ maps to: `payments.idempotency_key` (unique) today; refund/adjustment tables **(candidate)** need their own idempotency-key column + unique index. Operator-event dedup key derived from `(operator, operator_event_id)`.

### Operator
An external payment provider behind an **abstraction (port)** so providers plug in cleanly (FR-16, DD-5). First operator: **PayU**; Stripe second. In this exercise the operator is **mocked**.
→ maps to: `payments.operator_reference`, `DAT-17`. **(port candidate)**

### Operator event (webhook notification)
An inbound notification from the operator. Assumed **at-least-once** and **HMAC-signed**, with **no operator-supplied idempotency key** (ASM-1). Handled: HMAC verify → enqueue → transactional worker; out-of-order tolerant; applied **at most once** (INV-2). **Any pod may handle any webhook** (stateless, DB-level dedup).

### Charge/payment state machine
Our **own** canonical states (not operator vocabulary): `PENDING → REQUIRES_ACTION (SCA) → AUTHORIZED → SETTLED`, plus `DECLINED`, `EXPIRED`, `FAILED`. A charge with no confirmation goes `PENDING → EXPIRED` after **72h** (ASM-2, ratified) and is never recorded as paid. **`FAILED`/`DECLINED`** (operator actively rejected the charge) enters **dunning** immediately; **`EXPIRED`** (no operator response within 72h) is a no-charge terminal owned by reconciliation, not dunning. (PR-012)
→ related: `payments.status`.

---

## Operations (corrections)

### Refund / Partial refund
Return of a settled payment, in full or part, as a **reversing** ledger entry (FR-10, INV-4). Requires **maker/checker** and an **idempotency key** (PR-005); auto-approve threshold is a Finance policy number (escalated). Bounded by INV-6 — cumulative refunds never exceed the captured amount.
→ maps to: `REFUND`, `PARTIAL_REFUND` entry types.

### Chargeback
An operator-initiated reversal of a **settled** payment (FR-11), posted as a reversing entry.
*Deferred (edge case, review PR-007):* re-opening the underlying receivable (returning the debt to unpaid / dunning) and posting a chargeback fee are **not** modelled this iteration.
→ maps to: `CHARGEBACK` entry type.

### Adjustment / manual correction
An audited manual ledger entry (FR-12). Always via a new entry (never in-place edit), always under **maker/checker**, always with an **idempotency key** (PR-005). Bulk corrections require senior approval + a mandatory dry-run.
→ maps to: `ADJUSTMENT` entry type.

### Discount / Late fee / Overpayment
`DISCOUNT` reduces owed amount; `LATE_FEE` is late-payment interest; overpayment becomes **credit** (see Credit / wallet). All are ledger entries (FR-12).
→ maps to: `DISCOUNT`, `LATE_FEE`, `CREDIT` entry types.

### Fee (operator fee)
Operator's transaction fee, recorded as a **separate** entry during reconciliation (DD-3), not netted silently into the payment. **House/settlement ledger only — never posted to a customer account** (see Sign convention).
→ maps to: `FEE` entry type.

---

## Dunning

### Dunning
The automated failed/overdue collection flow (FR-13, A8): retries + comms on a schedule (Day 0 / +3 / +7 / +10 final notice → **+14 access block**; intervals ASM-3, tunable). Comms are **email + in-app**, one message per step, digested across multiple failed charges, daytime Warsaw. Entered on `FAILED`/`DECLINED` (not `EXPIRED`).

### Access block
Suspension of service access when dunning exhausts without payment (`DUN-BLOCKED`).

### Recovery
On any successful payment, **immediate unblock**, dunning state cleared, charge → settled/recovered.

---

## Reconciliation

### Settlement / Payout
The operator's daily record of processed transactions (settlement) and the resulting bank transfer (payout). Ingested daily (FR-15, DD-3). In this exercise, **mocked**.
→ maps to: `DAT-16`. **(candidate)**

### Three-way match
Daily reconciliation comparing **ledger ↔ operator status ↔ payout** (FR-15). Drift must be detected **≤24h**.

### Reconciliation mismatch
Any divergence found by the three-way match (e.g. ledger payment absent from settlement; settled payment with no ledger entry; amount/fee difference; refund/chargeback out of sync; payout total ≠ Σ txns − fees). Routed to the **back-office queue + ops alert** (never the parent), severity by drift amount.

### Settlement window
The operator's day-boundary used to group events for reconciliation — **distinct** from the business timezone. Using it (not local midnight) avoids phantom boundary mismatches.

---

## Invoicing & accounting

### Invoice
A financial document produced **on demand** (A9, FR-14). Shows student name + classroom/course enrollment (name rendered at generation time) and the **net / tax / gross breakdown with tax treatment** (PR-009). Retained 5 years (NFR-7). This is the **in-scope** tax-bearing document.
→ maps to: `DAT-15`. **(candidate)**

### Billing note
A parent-facing document **distinct** from the invoice (PL: *nota* vs *faktura VAT*). **Out of scope this exercise** — the in-scope document that shows net/tax/gross is the **Invoice**. When built later it also carries the tax breakdown.

### Accounting handoff (SALDEO / KSeF)
Invoices are handed off to the accounting system **SALDEO**, which forwards to **KSeF** — never direct (A10, DD-7). SALDEO/KSeF remains the **legal fiscal system of record**; payments computes and hands over the net/tax/gross breakdown. Deferred + **mocked** this exercise (Q-3).

---

## Governance, audit & time

### Role (RBAC)
`Parent` (own account only), `Admin/back-office` (operations under maker/checker), `Accounting` (read + invoice handoff, no balance mutation). Student has no payments access. RBAC + MFA + segregation of duties (NFR-6).
→ maps to: `DAT-18`.

### Maker/checker (four-eyes)
Segregation-of-duties control: a **maker** initiates a sensitive action, a **different checker** approves before it executes; a user can never approve their own request. Applies to all refunds, adjustments/corrections, dunning overrides, and manual credit disbursements.

### Audit log / Correlation ID
Immutable log of every financial operation (NFR-8), recording maker + checker identities and an end-to-end **correlation ID** across services.
→ maps to: `DAT-19`. **(candidate)**

### Business timezone
`Europe/Warsaw` — governs all business day-boundaries (billing day, dunning). Instants stored as UTC (`timestamptz`); billing day is a calendar date so DST does not shift it.

---

## Correctness invariants (restated from PRD §11)
- **INV-1** `balance(parent) == Σ ledger_entries(parent)`.
- **INV-2** each operator event applied **at most once**.
- **INV-3** no payment recorded without a matching operator confirmation.
- **INV-4** ledger entries immutable; corrections are new reversing entries.
- **INV-5** a charge is never double-paid; over-allocation becomes credit.
- **INV-6** cumulative refunds against a payment never exceed its captured amount (no over-refund). *(added by review PR-006; not from PRD §11)*
- **INV-7** `gross = net + tax` on every taxable line. *(added by review PR-009; not from PRD §11)*
