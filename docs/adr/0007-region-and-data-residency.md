# ADR 0007 — Region & data residency

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** Krzysztof Jackowski (EM), CTO
- **Relates to:** [ADR 0002](0002-deployment-and-infrastructure.md) (GKE + Cloud SQL), PRD NFR-4 (DR), NFR-7 (GDPR/RODO, EU residency, minor beneficiaries).

## Context

EduGo is a Polish school; payers and minor beneficiaries are in Poland/EU. NFR-7 mandates GDPR/RODO
compliance with **EU data residency**; NFR-4 mandates regional HA + PITR (RPO≈0, RTO<1h). This ADR
pins the region and the residency boundary.

## Decision

1. **Primary region: `europe-central2` (Warsaw)** — EU residency + lowest latency to PL users. GKE
   cluster and Cloud SQL both in-region.
2. **All data at rest stays in the EU** — Cloud SQL (+ backups + PITR archives), Secret Manager,
   Artifact Registry repository, and logs/traces are region- or EU-pinned. Nothing leaves the EU.
3. **Cloud SQL HA is regional** — primary + standby across zones in `europe-central2`, automated
   backups + PITR, backups retained in-region (satisfies NFR-4).
4. **Fallback:** if a required component isn't available/GA in `europe-central2`, pin *that* component
   to another **EU** region (e.g. `europe-west1`) — still compliant. Confirm coverage for GKE,
   Cloud SQL, Secret Manager, and Artifact Registry before finalising.
5. **Single-region for M1.** Multi-region DR is out of scope; NFR-4 is met by in-region HA + PITR.
   Operator (PayU) and accounting (SALDEO/KSeF) are PL/EU; revisit residency if Stripe/international
   expansion introduces non-EU processing.

## Consequences

- **Positive:** GDPR/RODO residency satisfied for minors' data; low latency to the PL user base;
  simple single-region topology.
- **Negative / trade-offs:** `europe-central2` occasionally trails other regions on new-service
  availability → some components may pin to `europe-west1` (still EU). Single-region means a full
  regional outage exceeds RTO — accepted for M1; multi-region is a later decision.

## Open items

- Verify `europe-central2` GA coverage for every component used (else pin to another EU region).
- Log/trace data residency configuration (Cloud Logging/Monitoring region pinning).
- Revisit residency posture when international expansion (Stripe/non-EU) begins.
