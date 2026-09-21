# PRD — EduGo Payments Module

**Status:** Draft for review  ·  **Author:** Krzysztof Jackowski (EM candidate)  ·  **Date:** 2026-09-20

**Related:** [ADR 0001 — backend stack](adr/0001-backend-stack.md) · [ADR 0002 — deployment & infrastructure](adr/0002-deployment-and-infrastructure.md) · [ADR 0003 — async backbone](adr/0003-async-backbone.md) · [ADR 0004 — API auth](adr/0004-api-auth.md) · [Implementation plan](implementation-plan.md)

## 1. Summary

A payments module for the EduGo portal (\~50k active users → **\~35k paying parents**) to
collect **recurring monthly tuition** through an **external payment operator**. Today
collection is **push-only** (each parent initiates every payment); the goal is to move
the majority to **pull** (automatic scheduled charging) while keeping push for arrears
and ad-hoc payments. Hard requirement: **each account's balance is always provably
consistent with its full operation history**. Design centers on an **append-only
ledger** as the single source of truth, **idempotent** operator integration, and
**daily reconciliation** against operator settlements.

## 2. Background &amp; Problem

- EduGo: fast-growing online school; parents pay recurring monthly fees for children's
courses (GCP + TypeScript, 3-person eng team, security-first, GDPR for minors).
- **Current state:** push-only payments → more late payments/churn, manual effort, no
automatic collection at month start.
- **Problem:** reliable recurring collection during the month-start concentration, with
financial correctness (no double charge, no lost payment, auditable balance) and full
lifecycle support (refunds, adjustments, arrears, invoices, reconciliation).

## 3. Goals / Non-Goals

**Goals**

- G1 — Shift the majority of collections to automatic **pull**; keep **push** as fallback / for arrears.
- G2 — Guarantee **balance == sum of ledger history** at all times (immutable, auditable).
- G3 — Handle month-start concentration reliably: **exactly-once**, no data loss.
- G4 — Full operations: refunds (incl. partial), discounts, late-payment interest, manual corrections, overpayments, arrears.
- G5 — **On-demand invoices**; feed accounting (SALDEO) → KSeF.
- G6 — Extensible to **multiple operators** (cost-based routing; Stripe for foreign markets).

**Non-Goals (this iteration)**

- Institutional / B2B payers (noted for the real product).
- Multi-currency (PLN only for now).
- Direct KSeF integration (handled via the accounting system).
- Full fraud/AML platform (basic protections only).

## 4. Success Metrics

- % of collections via pull (target: majority).
- Collection rate by day-N of month; reduction in arrears.
- Reconciliation match rate (target **100%**, drift detected **≤24h**).
- **Zero** financial-correctness incidents (double charge / lost payment / balance drift).
- Payment success rate; failed-charge recovery rate via dunning.

## 5. Users / Personas

- **Parent (payer, adult)** — pays for 1+ children, views balance/history, downloads invoices on demand.
- **Student (beneficiary, minor)** — GDPR-sensitive, not a payer.
- **Admin / back-office** — refunds, corrections, reconciliation exceptions, dunning oversight.
- **Accounting** — invoices, settlement, SALDEO/KSeF.
- *(Institution — out of scope this iteration.)*

## 6. Scope

**In scope:** billing/charges; push + pull payments; operator integration
(webhooks/idempotency); ledger &amp; derived balance; operations (refunds/partial, discounts,
late fees, adjustments, overpayments, arrears, chargebacks); dunning (comms → block);
on-demand invoices; reconciliation; accounting handoff; multi-operator routing (design +
one concrete operator + Stripe as second). **Out of scope:** see Non-Goals.

## 7. Assumptions (confirmed with EduGo)


| #   | Assumption                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | \~35k paying parents (≈1.4–1.5 children/parent; 50k = students + tutors).                                                                                             |
| A2  | Payments **normally distributed** around the billing day → **peak ≈ single-digit TPS** (\~2–5/s; low tens with growth). Optimize for **correctness, not throughput**. |
| A3  | Growth **≥30% YoY** (transactions).                                                                                                                                   |
| A4  | **PLN only** (this exercise).                                                                                                                                         |
| A5  | **Fixed monthly fee** per subscription, **prorated to actual usage on cancellation**.                                                                                 |
| A6  | **Same billing day** for all except the **first month** (prorated / pay before first class by enrollment date). New:existing = **5–20%/month**.                       |
| A7  | **New order triggers the first charge**; a recurring billing run generates subsequent charges.                                                                        |
| A8  | **Dunning = automated communication → access block.**                                                                                                                 |
| A9  | **Invoices on demand.**                                                                                                                                               |
| A10 | Accounting via **SALDEO**; **KSeF via accounting**, not direct.                                                                                                       |
| A11 | Card data **tokenized at operator** → **PCI SAQ-A**; store tokens/mandates only.                                                                                      |
| A12 | Stack: **TypeScript + GCP** (GKE/Kubernetes, Cloud SQL Postgres, Pub/Sub); team of 3.                                                                                      |


## 8. Functional Requirements

**Billing &amp; charges** 

-  FR-1 monthly charge per active subscription on the billing day 
-  FR-2 mid-month enrollment → prorated first charge 
- FR-3 cancellation adjusts current charge to actual usage.

**Payments (push + pull)** 

- FR-4 pull auto-charge stored method (first payment SCA/CIT, subsequent MIT) 
- FR-5 push parent-initiated (hosted page/redirect) 
- FR-6 idempotent handling of user actions and operator notifications (exactly-once effect).

**Ledger &amp; balance** 

- FR-7 append-only ledger, corrections via reversing entries only 
- FR-8 materialized balance updated atomically, `balance == Σ entries` 
- FR-9 payment allocation across multiple charges, partial payments oldest-first.

**Operations** 

- FR-10 refunds (full/partial) 
- FR-11 chargebacks reverse a settled payment 
- FR-12 discounts, late-payment interest, overpayments (credit/wallet), arrears, audited manual corrections.

**Dunning** 

- FR-13 failed/overdue → automated comms → access block; recovery on payment.

**Invoicing** 

- FR-14 on-demand invoice; hand off to accounting (SALDEO → KSeF).

**Reconciliation** 

- FR-15 daily settlement ingest, three-way match (ledger ↔ operator status ↔ payout), fees as separate entries, mismatches → back-office queue + alert.

**Multi-operator** 

- FR-16 operator abstraction + cost-based routing (PayU/Tpay + Stripe).

## 9. Non-Functional Requirements

- NFR-1 **Availability 99.9%/month**; no planned maintenance during first \~5 business days.
- NFR-2 **Latency:** initiate p95&lt;400ms/p99&lt;800ms; operator-confirmation→balance eventually consistent **p95&lt;2 min** (inbox-relay cadence; see ADR-0003 — relaxed from the original 2s); balance read p95&lt;100ms.
- NFR-3 **Consistency:** strong within an account at ledger-transaction level; eventual (**~1–2 min**, inbox-relay cadence; see ADR-0003) from operator confirmation to balance, with exactly-once.
- NFR-4 **Durability/DR:** RPO≈0 for committed financial data (Cloud SQL HA + PITR); RTO&lt;1h.
- NFR-5 **Scalability:** ≥30% YoY headroom; autoscale for the predictable burst (GKE Horizontal Pod Autoscaler; see ADR-0002).
- NFR-6 **Security:** PCI SAQ-A (tokenization at operator); SCA/PSD2 (CIT first, MIT recurring); secrets/tokens in GCP KMS; RBAC + MFA + segregation of duties; rate limiting / anti card-testing. **Auth mechanism:** S2S GCP service-account tokens + forwarded user JWT (attested actor) — see ADR-0004.
- NFR-7 **Compliance/Privacy:** GDPR/RODO (minor beneficiaries; data minimization; EU data residency); financial-document retention (5y) reconciled with erasure; DPA with operator.
- NFR-8 **Auditability:** immutable audit log of all financial ops; end-to-end correlation IDs.
- NFR-9 **Observability:** SLOs + golden signals (success rate, latency, reconciliation drift, DLQ depth), alerting, distributed tracing.
- NFR-10 **Money as integer minor units (grosze)**; never floats.

## 10. Key Design Decisions (see ADR 0001)

- DD-1 Append-only ledger as single source of truth; balance derived (materialized).
- DD-2 Idempotent, queue-buffered operator integration (HMAC verify → enqueue → transactional worker; unique key → duplicate no-op; out-of-order tolerant state machine).
- DD-3 Daily reconciliation against settlements; fees as separate entries.
- DD-4 Hybrid push→pull on a unified charge/ledger model.
- DD-5 Operator abstraction + cost-based routing (PayU/Tpay + Stripe).
- DD-6 PCI SAQ-A via operator tokenization; SCA CIT/MIT model.
- DD-7 KSeF via accounting (SALDEO); invoices on demand.
- DD-8 GCP-native (GKE + Pub/Sub + Cloud SQL); deployed as a private, containerised, multi-pod service — deployment topology per ADR-0002. *(Revised from the original serverless/Cloud Run intent.)*

## 11. Correctness Invariants (must always hold)

- INV-1 `balance(account) == Σ ledger_entries(account)`.
- INV-2 Each operator event applied **at most once** (exactly-once effect).
- INV-3 No payment recorded without a matching operator confirmation (mismatch surfaced by reconciliation).
- INV-4 Ledger entries **immutable**; corrections are new **reversing** entries.
- INV-5 A charge is never double-paid; over-allocation becomes **credit**.

## 12. Risks &amp; Mitigations


| Risk                           | Mitigation                                                    |
| ------------------------------ | ------------------------------------------------------------- |
| Operator downtime during burst | Queue + retry/backoff; change-freeze; dual-operator fallback. |
| Duplicate / late webhooks      | Idempotency keys + unique constraints + state machine.        |
| Balance drift                  | Daily reconciliation + invariants + audited corrections only. |
| Failed pull charges spike      | Dunning + retries + push fallback.                            |
| SCA/MIT misflagging            | Correct CIT/MIT tagging; monitor decline rates.               |
| GDPR vs retention conflict     | Retain financial docs per law; minimize/segregate PII.        |


## 13. Open Questions / Dependencies

- Operator selection &amp; contract: webhook guarantees (at-least-once? signed? idempotency keys?), settlement format, refund/chargeback APIs, mandate/CoF support.
- SALDEO / KSeF integration specifics.
- Billing-day edge cases (mid-month cancellations, refunds crossing months).

