# Payments — Specification

**Context:** payments · **Feature:** payments
**Status:** transcribed from `decisions.yaml` (workshop-captured 2026-09-21 + peer-review dispositions
+ follow-up decisions 2026-09-22)
**Sources (artefact tree):** `specs/payments/decisions.yaml`, `specs/payments/feature-inventory.yaml`,
`specs/payments/glossary.md`, `specs/payments/assumption-register.yaml`, `specs/payments/CONSTRAINTS.md`
**Artefact-tree ref:** `edugo-payments-service@01d2f7a` (in-repo artefact tree — no separate `*-specs` tree configured)

> Every acceptance criterion below traces to a resolved entry in `decisions.yaml` by ID (`ABS-*`, `Q-*`, `PR-*`, `INV-*`).
> Nothing here is authored that the decisions do not already contain. Two resolutions were **too vague to transcribe**
> and are returned under [Underspecified — returned](#underspecified--returned) rather than sharpened here.

---

## 1. Feature

The payments bounded context is the ledger of record for the EduGo portal. It bills parents for their children's
class/course enrollments, captures payments through a mocked external **operator** (PayU first), and maintains one
authoritative, materialized **parent balance** that is provably equal to the sum of that parent's append-only
**ledger entries** at all times. It owns idempotency and operator-event dedup, a canonical charge/payment state
machine, tax computed in gross with a net/tax/gross breakdown, maker/checker governance for every correction, a
dunning-and-recovery flow on the Europe/Warsaw business calendar, and daily three-way reconciliation against operator
settlement. Front-end concerns, live operator/accounting integration, and multi-jurisdiction rollout are out of scope
this iteration (see [Non-goals](#5-non-goals)).

---

## 2. Ubiquitous language

The terms below are used exactly as defined in [`glossary.md`](./glossary.md); this spec introduces no synonyms.
Load-bearing terms: **Parent account** (the single balance-bearing unit), **Child sub-account**, **Enrollment**,
**Ledger entry** / **Entry type** / **Sign convention**, **Money / minor units**, **Balance (materialized parent
balance)**, **Charge**, **Payment** (push/pull), **Allocation**, **Credit / wallet**, **Idempotency key**,
**Operator** / **Operator event**, **Charge/payment state machine**, **Refund / Partial refund**, **Chargeback**,
**Adjustment**, **Fee (operator fee)**, **Net / Tax / Gross** / **Tax treatment** / **Tax rate table**,
**Billing day** / **Billing run** / **Proration**, **Dunning** / **Access block** / **Recovery**,
**Settlement / Payout** / **Three-way match** / **Reconciliation mismatch** / **Settlement window**,
**Invoice**, **Role (RBAC)**, **Maker/checker (four-eyes)**, **Audit log / Correlation ID**, **Business timezone**,
**Arrears**, **Write-off**.

The system under specification is referred to as **the payments service**.

---

## 3. Acceptance criteria

EARS criteria, grouped by area. Each carries its ID and the source decision it transcribes. `[ASM-n]` marks a
criterion resting on an assumption; `[blocked-by …]` marks a criterion whose exact bound is still escalated.

### 3.1 Account & balance lifecycle

- **AC-1** (ABS-1) — When a parent is onboarded, the payments service shall create the parent account together with
  a balance row initialized to zero, before any charge is posted, so that every balance read returns a value and
  never null.
- **AC-2** (Q-1, OFF-1) — The payments service shall hold exactly one authoritative balance per parent account;
  child sub-accounts and enrollments shall carry no authoritative balance, and any per-child or per-class figure
  shall be derived from charge attribution, not stored as a sub-ledger.
- **AC-3** (ABS-6) — When a parent balance is read, the payments service shall return the materialized balance in
  O(1) without recomputing the sum over ledger history.
- **AC-4** (ABS-6) — Where a ledger or history read is requested, the payments service shall return results paginated.

### 3.2 Ledger integrity & money

- **AC-5** (ABS-5) — When a ledger entry is appended, the payments service shall, in the same database transaction,
  update the parent balance by an atomic increment of the entry's signed amount.
- **AC-6** (ABS-5) — If two writes target the same parent balance concurrently, then the payments service shall
  serialize them on that balance row's lock under READ COMMITTED isolation, so INV-1 holds after both commit.
- **AC-7** (PR-003) — The payments service shall store every monetary amount as integer minor units alongside an
  ISO-4217 currency code on the same row, never as a floating-point value.
- **AC-8** (PR-003) — If a money-moving operation specifies a currency other than PLN, then the payments service
  shall reject it (operational scope is PLN-only this iteration, enforced by validation, not schema).
- **AC-9** (PR-001) — The payments service shall never post a `FEE` entry to a customer/parent balance; operator
  fees shall be recorded only on the house/settlement ledger.
- **AC-10** (ABS-12, INV-4) — The payments service shall never update or delete a posted ledger entry; a correction
  shall be recorded only as a new reversing entry.

### 3.3 Charge & payment lifecycle · operator events

- **AC-11** (ABS-2) — The payments service shall track each charge/payment against its own canonical state machine
  `PENDING → REQUIRES_ACTION (SCA) → AUTHORIZED → SETTLED`, plus terminal states `DECLINED`, `EXPIRED`, `FAILED`,
  mapping operator outcomes onto these states rather than storing operator vocabulary.
- **AC-12** (ABS-2) `[ASM-2]` — When a charge in `PENDING` receives no operator confirmation within 72 hours, the
  payments service shall transition it to `EXPIRED` and never record it as paid.
- **AC-13** (INV-3) — The payments service shall record a `PAYMENT` ledger entry only upon a matching operator
  confirmation.
- **AC-14** (Q-2) `[ASM-1]` — If an inbound operator event fails HMAC signature verification, then the payments
  service shall reject it and record no ledger effect.
- **AC-15** (Q-2, PR-014, INV-2) `[ASM-1]` — When an operator event is received, the payments service shall dedupe
  it on a key derived from `(operator, operator_event_id)` and apply its effect at most once, tolerating
  out-of-order and redelivered events.
- **AC-16** (PR-012) — When a charge becomes `FAILED` or `DECLINED`, the payments service shall enter it into
  dunning; when a charge becomes `EXPIRED`, the payments service shall route it to reconciliation and shall not
  enter it into dunning.

### 3.4 Idempotency

- **AC-17** (PR-005) — If a payment, refund, partial refund, adjustment, or chargeback request arrives without an
  idempotency key, then the payments service shall reject it.
- **AC-18** (INV-2, DD-2) — When a money-moving request or operator event arrives whose idempotency key has already
  been applied, the payments service shall treat it as a no-op replay, moving money at most once and returning the
  original result.

### 3.5 Allocation & credit

- **AC-19** (INV-5, FR-9) — When a payment is allocated across open charges, the payments service shall apply it
  oldest-charge-first.
- **AC-20** (PR-008, INV-5) — While allocating a payment across charges, the payments service shall lock the target
  charge rows with `SELECT … FOR UPDATE` within the allocation transaction, so that no charge is double-paid under
  concurrent payments.
- **AC-21** (INV-5) — When an allocation exceeds the amount owed on the targeted charges, the payments service shall
  hold the over-allocated remainder as credit on the parent balance.
- **AC-22** (PR-004) — Where residual credit must be returned but no refundable original capture exists, the
  payments service shall return it via a manual disbursement / bank-transfer payout executed as an audited
  maker/checker back-office action.

### 3.6 Refunds, corrections & maker/checker

- **AC-23** (Q-4) — When a refund, manual adjustment/correction, or dunning override is requested, the payments
  service shall require approval by a checker who is a different user from the maker, and shall reject any attempt
  by the maker to approve their own request.
- **AC-24** (Q-4, NFR-8) — When a maker/checker action is approved, the payments service shall write both the maker
  and checker identities and a correlation id to the immutable audit log.
- **AC-25** (PR-006, INV-6) — If a refund would make the cumulative refunds against a payment exceed that payment's
  captured amount, then the payments service shall reject it.
- **AC-26** (ABS-12) — While a charge is in `PENDING` or `REQUIRES_ACTION`, the payments service shall allow it to
  be cancelled; once a charge is `SETTLED`, the payments service shall permit reversal only via a refund or
  chargeback reversing entry.
- **AC-27** (ABS-12) — Where a correction is applied in bulk, the payments service shall require senior approval and
  a completed mandatory dry-run, and shall log the outcome per entry.
- **AC-28** (Q-4, FU-3) — Where a refund's amount is at or below 100 PLN (10000 minor units), the payments service
  shall permit it without a separate checker; if a refund exceeds 100 PLN, then it shall require maker/checker per
  AC-23. *(Threshold set by Finance 2026-09-22; retunable.)*

### 3.7 Tax

- **AC-29** (PR-009, INV-7) — The payments service shall record on every taxable charge/invoice line a breakdown of
  `net_minor`, `tax_minor`, `gross_minor`, `tax_rate`, `tax_treatment`, and `tax_jurisdiction`, with
  `gross = net + tax`.
- **AC-30** (PR-009) — The payments service shall post the gross amount to the ledger and balance and carry net and
  tax as attributes of the charge; it shall not split a charge into separate net and tax ledger entries.
- **AC-31** (PR-009, FIN-1) — When computing tax for a document, the payments service shall round each line
  half-up to the minor unit and then sum the lines, and shall not compute tax on the rounded total.
- **AC-32** (PR-009) — When resolving the tax rate and treatment for a charge, the payments service shall look them
  up in the effective-dated tax rate table keyed by `(jurisdiction, category, date)`, defaulting Polish tuition to
  `EXEMPT` (0%).
- **AC-33** (PR-009) — Where a line's treatment is `EXEMPT` or `ZERO_RATED`, the payments service shall still render
  the line on the invoice with its legal reason code and a tax amount of zero, never omitting it.

### 3.8 Billing & time

- **AC-34** (Q-5, ABS-9) — The payments service shall determine each billing day in the `Europe/Warsaw` business
  timezone while storing all instants in UTC.
- **AC-35** (Q-5, ABS-9) — If a subscription's billing day (29, 30, or 31) exceeds the current month's length, then
  the payments service shall clamp the billing day to the last day of that month.
- **AC-36** (Q-5, ABS-9) — When a refund crosses a month boundary, the payments service shall record it as a new
  reversing entry dated at event time and shall never back-date it.
- **AC-37** (Q-5, ABS-9) — When grouping events for reconciliation, the payments service shall use the operator's
  settlement window as the day boundary, distinct from the business timezone.

### 3.9 Cancellation & retention

- **AC-38** (ABS-7) — When a subscription is cancelled, the payments service shall stop future billing and prorate
  the current charge, while retaining the account and its ledger (cancellation is not deletion).
- **AC-39** (ABS-7) — When an account with a residual balance is cancelled, the payments service shall refund
  residual credit to the parent and shall retain residual arrears, clearing arrears only via an audited `ADJUSTMENT`
  write-off.
- **AC-40** (ABS-7) `[blocked-by E-RETENTION-POLICY]` — When a GDPR erasure is requested, the payments service
  shall retain financial records for 5 years, redact the parent's billing PII, and soft-delete only; and if an open
  debt or dispute still needs the billing contact, then it shall block the erasure. *Exact retention-vs-erasure
  details for minors' data are escalated (DPO/Legal).*

### 3.10 Dunning & notifications

- **AC-41** (Q-6, ABS-8, FU-2) `[ASM-3]` — When a charge enters dunning, the payments service shall send
  retry/comms on Warsaw business days at Day 0, +3, +7, and +10, and at +14 apply an access block accompanied by a
  block-notice message if still unpaid.
- **AC-42** (Q-6, ABS-8, FU-1, FU-2) — When a dunning step fires, the payments service shall send exactly one
  message per step over email and in-app channels, digesting multiple failed charges for the same parent into that
  single message, sending only within the 09:00–20:00 Europe/Warsaw window (holding to the next in-window time
  otherwise), for a maximum of 5 messages per cycle (Day 0/+3/+7/+10 + the +14 block notice).
- **AC-43** (Q-6, ABS-8) — When any payment succeeds for an account under dunning, the payments service shall
  immediately unblock access and clear the dunning state.
- **AC-44** (Q-6, ABS-8) — When the three-way match finds a reconciliation mismatch, the payments service shall
  route it to the back-office queue with an ops alert (never notifying the parent), detecting the drift within 24
  hours.

### 3.11 Operator degraded mode

- **AC-45** (ABS-10) — If an operator call fails, then the payments service shall retry with bounded exponential
  backoff up to 5 attempts, then route the item to a dead-letter queue and onward to the back-office queue.
- **AC-46** (ABS-10) — Where an operator is unavailable, the payments service shall support manual operator
  failover for M1 (automatic cost-based routing is out of scope this iteration).
- **AC-47** (ABS-10) — While pull processing is degraded, the payments service shall continue to accept push
  payments.

### 3.12 RBAC & data minimisation

- **AC-48** (ABS-4) — The payments service shall enforce the RBAC matrix: a `Parent` may access only their own
  account; an `Admin`/back-office user may perform operations only under maker/checker; an `Accounting` user may
  read and hand off invoices but shall not mutate any balance; a `Student` shall have no payments access.
- **AC-49** (ABS-13) — The payments service shall store parent billing information as the only PII and shall
  reference students by internal ID only.
- **AC-50** (ABS-13) — When an invoice is generated, the payments service shall render the student name and
  classroom/course enrollment at generation time from the out-of-scope student system, and shall not store them in
  payments.

---

## 4. Invariants

Always-true properties, quantified over inputs, decidable — these feed property-based tests downstream. Restated
from `glossary.md` §Correctness invariants; each was DECIDED.

- **INV-1** — For every parent account at all times: `balance_minor == Σ amount_minor` over that account's ledger
  entries. *(ABS-1, ABS-5)*
- **INV-2** — Every operator event is applied at most once, regardless of delivery order or redelivery count.
  *(Q-2, PR-014)*
- **INV-3** — No `PAYMENT` ledger entry exists without a matching operator confirmation. *(ABS-2)*
- **INV-4** — Every posted ledger entry is immutable; the only correction is a new reversing entry. *(ABS-12)*
- **INV-5** — No charge is ever paid more than once; any over-allocation becomes credit. *(PR-008)*
- **INV-6** — For every payment, cumulative refunds against it never exceed its captured amount. *(PR-006)*
- **INV-7** — On every taxable line: `gross_minor == net_minor + tax_minor`. *(PR-009)*

---

## 5. Non-goals

Stated as what this iteration does **not** do. Each traces to a DEFERRED decision.

- **NG-1** (ABS-3) — No loading/spinner/skeleton behaviour — a UI concern; this is a backend service.
- **NG-2** (ABS-11) — No accessibility behaviour — a UI concern owned by the consuming portal.
- **NG-3** (Q-3) — No live SALDEO/KSeF accounting integration; the invoice→accounting handoff is a port whose
  implementation is mocked this exercise. SALDEO/KSeF remains the legal fiscal system of record.
- **NG-4** (OFF-2) — No teacher/instructor payouts; charge-level attribution is retained for a future payout feature.
- **NG-5** (PR-007) — Chargebacks do not re-open the underlying receivable and no chargeback fee is posted this
  iteration (edge case deferred).
- **NG-6** (PR-009) — No billing note (*nota*) document and no multi-jurisdiction/international tax rollout; the
  in-scope tax document is the Invoice, and operational tax scope is Poland only.
- **NG-7** (PR-010) — Minor-access-block legal-risk handling is not modelled this iteration.
- **NG-8** (Q-2) — No live operator integration; the operator is mocked, behind a port, this exercise.
- **NG-9** (ABS-6, INFRA-1) — No balance snapshotting and no read-replicas for M1.
- **NG-10** (ABS-10, FR-16) — No automatic cost-based operator routing; failover is manual for M1.

---

## 6. Open

Items still open after the 2026-09-22 follow-up decisions (E-REFUND-THRESHOLD was closed — see below). Nothing is
silently dropped; any criterion still awaiting detail is marked `[blocked-by …]` above.

| ID | From | What | Owner | Status | Blocks |
|---|---|---|---|---|---|
| **E-OPERATOR-CONTRACT** | Q-2 | Confirm PayU webhook guarantees, settlement format, refund/chargeback/mandate APIs | **CTO** (assigned 2026-09-22) | Open — confirm before live integration | Live integration behind AC-14/AC-15; rests on ASM-1 until confirmed. Mocked for M1. |
| **E-RETENTION-POLICY** | ABS-7 | Exact retention-vs-erasure policy for minors' data | DPO/Legal | **Deferred** 2026-09-22 (CTO) | Minor-specific detail of AC-40 only; the AC-40 high-level rule stands |
| **Q-3** | Q-3 | SALDEO/KSeF integration specifics | **CTO** (assigned 2026-09-22) | Deferred / mock-only | Real accounting integration (NG-3 holds meanwhile) |

**Closed 2026-09-22:** E-REFUND-THRESHOLD → refund auto-approve threshold set to **100 PLN** (Finance, FU-3);
AC-28 is now testable.

---

## 7. Assumptions in force

ASSUMED items this spec rests on, each with its revisit trigger (from `assumption-register.yaml`).

- **ASM-1** — Operator webhooks are at-least-once and HMAC-signed, with no operator-supplied idempotency key (we own
  dedup). *Underpins AC-14, AC-15.* Revisit when the real PayU contract is obtained / before first live integration.
- **ASM-2** — A charge with no operator confirmation expires after 72h (`PENDING → EXPIRED`). *Underpins AC-12.*
  Revisit when ops confirms/observes real operator confirmation latencies.
- **ASM-3** — Dunning intervals 0/+3/+7/+10 → access block +14. *Underpins AC-41, AC-42.* Only the **day-intervals**
  remain assumed/tunable; the send-window (09:00–20:00 Europe/Warsaw) and the 5-messages-per-cycle ceiling were made
  concrete 2026-09-22 (FU-1/FU-2). Revisit the intervals after M1 real collection data (arrears / collection-rate).
- **ASM-4** — EduGo operates a central IdP issuing OIDC/JWT tokens with `sub`, `role`, and `acr`/MFA claims plus a
  JWKS endpoint. *Underpins the RBAC/actor-identity basis of AC-23, AC-24, AC-48.* **Confirmed for this exercise**
  2026-09-22 (FU-7); still re-verify with the platform team before a production auth rollout (ADR-0004).

---

## 8. Underspecified — resolved 2026-09-22

Both returns from the first spec pass have since been decided (decisions.yaml `follow_up_decisions`); AC-42 now
carries their concrete bounds.

- **Dunning send-window (Q-6 / ABS-8 → FU-1).** ✅ Resolved: comms send only within **09:00–20:00 Europe/Warsaw**;
  outside it, sends hold to the next in-window time. Transcribed into AC-42.
- **Dunning fatigue ceiling (Q-6 / ASM-3 → FU-2).** ✅ Resolved: the ceiling **is** the one-message-per-step count —
  exactly 5 messages/cycle (Day 0/+3/+7/+10 + the +14 block notice), not an independent cap. Transcribed into
  AC-41/AC-42.

A smaller flag (still not blocking): the glossary's "severity by drift amount" for reconciliation mismatches (AC-44)
carries no threshold bands; AC-44 transcribes only the routing and ≤24h detection, which are decided and testable.
Left as-is pending real reconciliation data.

---

## 9. Traceability & housekeeping notes

- **Coverage:** every DECIDED absence (ABS-1,2,4,5,6,7,8,9,10,12,13), every ANSWERED question (Q-1,4,5,6), the
  ESCALATED-but-behaviourally-decided Q-2, and every FIXED review disposition (PR-001,003,004,005,006,008,009,012,014)
  produced ≥1 criterion. Every DEFERRED item (ABS-3,11; Q-3; PR-007,010; OFF-2) appears as a non-goal.
- **Glossary:** no vocabulary conflict was open; the 2026-09-22 follow-ups added concrete values (not term
  changes) to the **Refund** entry (100 PLN threshold, FU-3) and the **Dunning** entry (send-window + 5-message
  ceiling, FU-1/FU-2).
- **Follow-up decisions (2026-09-22):** FU-1/FU-2 closed the two underspecified returns (AC-41/AC-42); FU-3 closed
  E-REFUND-THRESHOLD (AC-28 now testable); FU-4 deferred the minor-specific detail of AC-40; FU-5/FU-6 assigned the
  CTO as owner of E-OPERATOR-CONTRACT and Q-3; FU-7 confirmed ASM-4 for this exercise.
- **PR-013** (decisions.yaml commit correction) is documentation housekeeping and produced no criterion, as intended.
- Gherkin scenarios exemplifying these criteria live in [`features/`](./features/), each tagged with the AC IDs it
  covers.
