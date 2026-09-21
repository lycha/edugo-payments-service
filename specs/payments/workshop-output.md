# Gap Interrogation Workshop — Payments

**Feature:** payments · **Date:** 2026-09-21
**Reviewing:** `specs/payments/feature-inventory.yaml` @ harvest commit `74d22fea62a7c95008501e9ccbe1468021b05f7c`
**Format:** live gap-interrogation workshop (residue feeds `gap-interrogation-capture` → `decisions.yaml`)

## Attendees / roles
- **CTO** — decision-maker (chair)
- **Product Manager, Payments** — facilitator, recommendations, scribe

## How this doc works
Each item records: the gap, the PM recommendation put to the room, the **DECISION** (what the CTO actually decided), rationale, and any owner / revisit trigger / debt. Items nobody resolves are left **OPEN** — not silently closed. Confidence is noted so capture can rate `explicit` / `inferred` / `ambiguous`.

## Agenda (dependency-ordered)
| Cluster | Items | Theme |
|---|---|---|
| A | Q-1, ABS-1, ABS-13 | Domain grain & core model (keystone — blocks others) |
| B | Q-2, ABS-2, ABS-10 | Operator integration, failure taxonomy, degraded mode |
| C | ABS-5, ABS-6 | Concurrency & scale / correctness of the balance |
| D | Q-5, ABS-9 | Time: billing day & reconciliation boundaries |
| E | Q-4, ABS-4, ABS-12 | Back-office governance: permissions, maker/checker, reversibility |
| F | Q-6, ABS-8 | Dunning cadence & notification model |
| G | ABS-7 | Lifecycle: cancellation, GDPR erasure vs 5y retention |
| H | Q-3 | Accounting handoff (SALDEO/KSeF) — external dependency |

**Closed at harvest (no discussion needed):** ABS-3 (loading — UI, N/A), ABS-11 (accessibility — UI, N/A).

---

## Decision log

_(populated as we go)_

### Cluster A — Domain grain & core model

**Q-1 — balance-bearing unit → DECIDED (confidence: explicit)**
- **Decision:** One **account per parent**. The **parent is the primary user** of the system. Model it like consumer banking: a primary parent profile with **N sub-accounts, one per child**. Each child is onboarded to classrooms; **each onboarding (enrollment) is linked to a (sub-)account**.
- **Authoritative invariant:** the **parent balance must always be correct** — this is the primary requirement (extends INV-1 to the parent aggregate).
- **Balance model (NEW-Q-B → DECIDED, explicit):** **one authoritative balance per parent.** Per-student/per-class figures are **derived** from charge/allocation attribution, not stored authoritative sub-ledgers. Single invariant to protect (INV-1 at parent level); no parent↔sub drift risk.
- **Attribution:** each `CHARGE` still carries `student_id` + `class/enrollment` for invoice line-items and future reporting — but this is attribution metadata on entries, **not** a stored balance rollup.
- **Rationale:** parents pay once and think in one balance (A1); overpayment→credit pools at payer level (INV-5); matches the existing `account_balances` keyed by account.
- **Debt created:** define the aggregate hierarchy (parent account → child sub-account → class enrollment) in schema, with the parent balance as the single materialized balance and per-student/per-class as computed views. Owner: PM + Eng (schema design).

**ABS-1 — first-run / zero-history → DECIDED (confidence: explicit)**
- **Decision:** **Eager** creation. Account + zero balance row are written at parent onboarding, before any charge, so balance reads never hit null and INV-1 holds from t=0.

**ABS-13 — minor data / PII → DECIDED (confidence: explicit)**
- **Decision:** In the payments context, the **only PII stored is the parent's billing information**. **Students are modelled by ID only**, referencing the parent account — no student PII persisted here. (Students have their own accounts elsewhere in the system; **that system is out of scope** for this exercise.)
- **On the invoice:** show **student name + classroom/course enrollment**. Implication (to confirm): the student name is **sourced at invoice-generation time** from the out-of-scope student system by ID, not stored in payments.

---

## Off-inventory findings (feedback to `prototype-harvest`)
The harvest was run against the PRD, which never mentions these — they surfaced in the room and should be added to the inventory / raised with the harvester:

- **OFF-1 — Sub-account hierarchy.** Parent → N child sub-accounts → class enrollments. The PRD/inventory modelled a flat "account" (DAT-20); the real model is a two-level aggregate. _New data entities implied: child sub-account, class enrollment._
- **OFF-2 — Teacher payments.** Surfaced as the original justification for per-student/per-class balances. **Ruled OUT of scope** for this exercise (see NEW-Q-A). Flagged as a known downstream feature that will consume charge-level attribution.

## New questions raised (not in inventory)
- **NEW-Q-A — Teacher payments scope → RESOLVED (explicit):** **out of scope** for this exercise. Charge-level attribution (`student_id` + enrollment) is retained so a future payout feature can consume it; no teacher-payout logic built now.
- **NEW-Q-B — Sub-balance consistency invariant → RESOLVED (explicit):** parent balance is the **single authoritative** balance; per-student/per-class are **derived**, not stored. No `parent == Σ(children)` transactional invariant needed.

---

## Exercise scope frame (stated in Cluster B, applies globally)
**This exercise validates the design at the concept level with a MOCKED operator.** We build the operator **abstraction (port)** and mock the provider's responses to prove the implementation is correct conceptually. No live PayU/Stripe integration, and no real settlement-file ingest, is built now. (Affects Q-2, FR-15 reconciliation, and Q-3.)

### Cluster B — Operator integration, failure taxonomy & degraded mode

**Q-2 — operator contract → DECIDED posture + ASSUMED + ESCALATED (confidence: explicit)**
- **Decision:** Design for the **worst case** — we **verify HMAC** and **own dedup + idempotency** ourselves (never rely on the operator supplying an idempotency key). Dedupe key derived from `(operator, operator_event_id)`. Build an **operator abstraction** so new providers plug in cleanly.
- **ASSUMED** (design assumptions until contract confirmed): webhooks at-least-once, HMAC-signed, no operator-supplied idempotency key. **revisit_when:** real PayU contract obtained / before first live integration.
- **ESCALATED:** confirm PayU's actual webhook guarantees, settlement format, refund/chargeback/mandate APIs. **owner: TBD (CTO to name at wrap-up) · due: TBD.**

**First operator → DECIDED (explicit):** **PayU** first (PLN, SCA/MIT); Stripe second per DD-5.

**ABS-2 — failure taxonomy → DECIDED (confidence: explicit for the approach)**
- **Decision:** define **our own canonical state machine** reflecting the business case, and map each operator outcome onto it — not leak operator vocabulary into the domain. Proposed states: `PENDING → REQUIRES_ACTION (SCA) → AUTHORIZED → SETTLED`, plus `DECLINED`, `EXPIRED`, `FAILED`. A charge that never receives confirmation goes `PENDING → EXPIRED` and is never recorded as paid (INV-3).
- **Open detail (confidence: inferred):** the confirmation-timeout value (PM proposed **72h**) was not explicitly ratified — carry 72h as a **default to confirm** with ops. → second-look item.

**ABS-10 — degraded mode / failover → DECIDED (confidence: explicit)**
- **Decision:** bounded **exponential backoff, max 5 retries → DLQ → back-office queue**; **manual** operator failover for M1 (automatic cost-based routing is a later feature). Push payments remain accepted while pull is degraded (caveat: operator hosted page may also be down).

### Cluster C — Concurrency & scale

**ABS-5 — concurrency & balance invariant → DECIDED (confidence: explicit)**
- **Decision:** ledger append + balance update in **one DB transaction**; balance update is an **atomic `UPDATE … SET balance = balance + delta`** on the parent balance row. Concurrent writes to the same account **serialize on that row lock**; **READ COMMITTED** (Postgres default) is sufficient. Double-submit/retry caught by the **unique idempotency key**, not locking. Contention is per-account only → month-start burst parallelizes across 35k accounts.

**ABS-6 — boundary & scale → DECIDED (confidence: explicit)**
- **Decision:** materialized balance ⇒ **O(1) balance reads** (no Σ-over-history recompute on hot path; NFR-2 trivially met). **Paginate** ledger/history reads. **No snapshotting for M1.** **revisit_when:** a single account's ledger-entry count grows pathological, or balance-read p95 breaches SLO.

**CONSTRAINT (from CTO) → CONSTRAINTS.md candidate (confidence: explicit)**
- Predicted load (A2 single-digit TPS, A3 ≥30% YoY) means **no DB read-replicas and no balance snapshotting** are required for M1.
- Service runs as **clustered, stateless pods in k8s**: **any pod must be able to handle any webhook.** Cross-pod at-most-once effect relies on **DB-level dedup (unique `(operator, operator_event_id)` / idempotency key) + transactional apply** — **no in-memory dedup, no pod affinity, no sticky sessions.**

**Derived finding / debt (NEW):**
- **NEW-DEBT-1 — billing run under pod clustering.** The recurring billing run (TRN-1) must be **single-runner-safe** across N pods to avoid double-charging (leader election / Postgres advisory lock / dedupe on `(subscription, billing_period)`). Not in the inventory. Owner: Eng. → carry into CONSTRAINTS + a tracker task.

### Cluster D — Time: billing day & reconciliation boundaries
**Resolves Q-5 (ANSWERED) and ABS-9 (DECIDED). Confidence: explicit on all four.**

- **Business timezone = `Europe/Warsaw`; storage = UTC (`timestamptz`).** All business day-boundaries (billing day, dunning schedule) computed in Warsaw; instants stored UTC. Billing day is a **calendar date**, so DST is handled by the tz database with no wall-clock drift.
- **Reconciliation day-boundary = PayU's settlement window**, deliberately **distinct** from the business TZ. Three-way match groups events the way the operator groups payouts; using local midnight would create phantom boundary mismatches.
- **Month-length:** billing day of 29/30/31 in a shorter month **clamps to the last day of the month**.
- **Refunds crossing months:** a refund is a **new reversing entry dated at event time** (INV-4), referencing the original charge for attribution — **never back-dated**, original month's entries never rewritten.
- **debt_created:** two distinct date-boundary calculators (business=Warsaw, reconciliation=operator settlement); month-end clamp in the billing scheduler. Owner: Eng.

### Cluster E — Back-office governance
_Terminology note (CTO asked): **maker/checker** = four-eyes / two-person rule. A maker initiates a sensitive action; a different checker approves it before it executes; the same user can never be both. Provides fraud/error control + a who-requested/who-approved audit trail (NFR-8)._

**ABS-4 — permission matrix → DECIDED (confidence: explicit)**
- **Parent:** view/manage *own* account, balance, history, invoices, payment method; initiate push; no cross-parent visibility.
- **Admin/back-office:** refunds, manual adjustments/corrections, reconciliation-mismatch resolution, dunning override/unblock — **all under maker/checker.**
- **Accounting:** read financial data, trigger invoice→SALDEO handoff, view settlements/reconciliation; **no balance mutation.**
- **Student:** no payments access (out of scope).

**Q-4 — maker/checker workflow → DECIDED mechanism + ESCALATED threshold (confidence: explicit)**
- **Decision:** all manual **adjustments/corrections** require maker/checker regardless of amount; all **refunds** require maker/checker; **dunning overrides** require maker/checker. A user can **never approve their own request**. Each approved action → immutable audit log with **both** identities + correlation id (NFR-8).
- **ESCALATED:** the refund **auto-approve amount threshold** (mechanism decided now, the PLN number later). **owner: Finance · due: TBD.** revisit trigger: finance sets policy number.

**ABS-12 — reversibility → DECIDED (confidence: explicit)**
- Charge cancellable while `PENDING`/`REQUIRES_ACTION`; once `SETTLED`, reversal only via **refund/chargeback** (reversing entry, INV-4).
- **No in-place undo/edit** on posted ledger entries — corrections are new reversing entries, themselves maker/checker'd.
- **Bulk corrections** require **senior/elevated approval + mandatory dry-run preview**, logged per entry.

### Cluster F — Dunning & notifications
**Resolves Q-6 (ANSWERED) and ABS-8 (DECIDED). Confidence: explicit; day-intervals ASSUMED.**

- **Dunning schedule (Europe/Warsaw business days):** Day **0** notify+retry · **+3** reminder+retry · **+7** reminder+retry · **+10** final notice · **+14 access block**.
- **Recovery:** any successful payment → **immediate unblock**, dunning state cleared, charge → settled/recovered.
- **Channels:** email (primary) + in-app portal for M1; SMS later.
- **Batching/fatigue:** one message **per dunning step** (not per retry); daytime Warsaw hours; **digest multiple failed charges into one message**; ceiling ≈ 5 msgs/cycle.
- **Reconciliation mismatch:** → **back-office queue + ops alert (not the parent)**, detect **≤24h**, severity scaled by drift amount.
- **ASSUMED:** the specific day-intervals (0/+3/+7/+10/+14) and fatigue ceiling. **revisit_when:** after M1 real collection data (arrears/collection-rate metrics, Section 4) is available.

_Terminology note (CTO asked): **when a reconciliation mismatch happens** — any divergence across ledger ↔ operator status ↔ payout. Taxonomy (feeds FR-15 spec + ABS-2):_
1. _Ledger payment absent from operator settlement (or later declined/reversed) — INV-3 guard._
2. _Operator settled a payment with no ledger entry (missed/DLQ'd webhook)._
3. _Amount mismatch (partial capture, rounding)._
4. _Fee mismatch (operator fee ≠ expected; fees are separate entries, DD-3)._
5. _Refund/chargeback out of sync between us and operator._
6. _Settlement-window/timing boundary (mitigated by Cluster-D operator-window decision)._
7. _Payout total ≠ Σ(settled txns) − fees._

### Cluster G — Lifecycle: cancellation, erasure vs retention
**Resolves ABS-7 (DECIDED) + ESCALATED policy detail. Confidence: explicit.**

- **Cancellation:** stops future billing, **prorates current charge to actual usage** (FR-3); account + ledger **persist** — cancellation is a status change, not deletion.
- **Residual credit at close:** **refunded** to the parent via the operator refund path (we never silently keep it).
- **Residual arrears at close:** **debt survives** cancellation; collection continues; write-off only via **audited adjustment** (maker/checker, Cluster E).
- **GDPR erasure vs 5y retention:** financial records **retained 5 years** — erasure **redacts/pseudonymizes parent billing PII** but never deletes financial records; **soft-delete only**; account close = status flag. Students already ID-only ⇒ no student PII to erase. Erasure **blocked while an open debt or active dispute** legally requires the billing contact.
- **ESCALATED:** exact retention-vs-erasure policy details. **owner: DPO/Legal · due: TBD.** (Mechanism decided now; policy specifics pending.)

### Cluster H — Accounting handoff (SALDEO/KSeF)
**Resolves Q-3 (DEFERRED). Confidence: explicit.**
- **Decision:** for this concept exercise, **defer real SALDEO/KSeF integration** and **mock the accounting handoff** — model an "invoice generated → handoff to accounting" **port** and stub SALDEO's response (same approach as PayU). Invoices on demand; KSeF via accounting, never direct (A10, DD-7).
- Concrete SALDEO API/format/timing to be handled in a later feature. **owner: none assigned (CTO: no owner).**

---

## Session wrap-up

### Outcome summary
| Item | Outcome | Confidence |
|---|---|---|
| Q-1 grain | DECIDED — parent account, bank-style sub-accounts per child | explicit |
| NEW-Q-A teacher payments | RESOLVED — out of scope (attribution retained) | explicit |
| NEW-Q-B sub-balances | RESOLVED — single authoritative parent balance, sub derived | explicit |
| ABS-1 first-run | DECIDED — eager balance creation | explicit |
| ABS-13 minor PII | DECIDED — parent billing PII only, students ID-only, invoice name rendered at gen-time | explicit |
| Q-2 operator contract | DECIDED posture + ASSUMED + ESCALATED | explicit |
| first operator | DECIDED — PayU | explicit |
| ABS-2 failure taxonomy | DECIDED — own state machine (72h timeout = inferred, confirm) | explicit / inferred |
| ABS-10 degraded mode | DECIDED — 5 retries→DLQ, manual failover M1 | explicit |
| ABS-5 concurrency | DECIDED — per-account row-lock, atomic increment, READ COMMITTED | explicit |
| ABS-6 scale | DECIDED — materialized O(1) reads, paginate, no snapshot M1 | explicit |
| Q-5 / ABS-9 time | ANSWERED/DECIDED — Warsaw business TZ + operator settlement window; month-end clamp; no back-dated refunds | explicit |
| Q-4 maker/checker | DECIDED mechanism + ESCALATED threshold | explicit |
| ABS-4 permissions | DECIDED — Parent/Admin/Accounting matrix | explicit |
| ABS-12 reversibility | DECIDED — no undo, reversing entries, bulk needs senior+dry-run | explicit |
| Q-6 / ABS-8 dunning | ANSWERED/DECIDED — 0/+3/+7/+10→block+14 (ASSUMED intervals) | explicit / assumed |
| ABS-7 lifecycle | DECIDED — retain financial 5y, redact PII, soft-delete; credit refunded, arrears survive | explicit |
| Q-3 accounting | DEFERRED — mock handoff | explicit |

**Closed at harvest:** ABS-3 (loading, UI N/A), ABS-11 (accessibility, UI N/A).
**Inventory coverage:** all 6 questions + all 11 live absences reached. No item left un-discussed.

### Assumptions (need revisit triggers — for assumption-register)
- **ASM-1** operator webhooks at-least-once / HMAC-signed / no operator idempotency key. revisit: real PayU contract.
- **ASM-2** 72h confirmation timeout → EXPIRED. revisit: confirm with ops (**inferred, second-look**).
- **ASM-3** dunning intervals 0/+3/+7/+10/+14 & fatigue ceiling ~5. revisit: after M1 collection data.

### Escalations register
| Ref | What | Owner | Due |
|---|---|---|---|
| Q-2 | Confirm PayU webhook/settlement/refund/mandate contract | **TBD (needs owner)** | TBD |
| Q-4 | Refund auto-approve amount threshold | Finance | TBD |
| ABS-7 | Retention-vs-erasure policy details | DPO/Legal | TBD |

### Off-inventory findings → feedback to `prototype-harvest`
- **OFF-1** parent→child sub-account→enrollment hierarchy (inventory had flat account, DAT-20).
- **OFF-2** teacher payments (not in PRD) — ruled out of scope this exercise.

### Debt / new constraints → CONSTRAINTS.md + tracker
- **CON candidate** no DB replicas / no snapshotting for M1; stateless clustered pods, any pod handles any webhook; cross-pod at-most-once via DB-level dedup only (no in-memory dedup / affinity).
- **NEW-DEBT-1** billing run must be single-runner-safe across pods (leader election / advisory lock).

### Next step
Feed this doc to **`gap-interrogation-capture`** → `decisions.yaml` (`mode: workshop-captured`), then update `feature-inventory.yaml` (mark resolved), `assumption-register.yaml` (ASM-1..3), and start a `glossary.md` for the payments context (every DAT term is currently UNMAPPED).

### Two loose ends — RESOLVED at end of session
1. **Q-2 escalation owner** — CTO confirmed: **left unassigned (TBD)** for now; to be named before any live PayU integration work. (Acceptable while the exercise is mock-only.)
2. **72h confirmation timeout (ASM-2)** — CTO **ratified 72h** → now **explicit** (no longer inferred). `PENDING → EXPIRED` after 72h with no operator confirmation.
