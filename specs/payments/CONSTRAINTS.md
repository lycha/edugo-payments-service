# Payments — Constraints

Architecture constraints agreed in the gap-interrogation workshop (2026-09-21).
Source: `specs/payments/decisions.yaml` (CONSTRAINT-INFRA, NEW-DEBT-1).

- **INFRA-1 — No read-replicas / no balance snapshotting for M1.** Justified by predicted
  load (A2 single-digit TPS; A3 ≥30% YoY). The materialized balance gives O(1) reads, so no
  Σ-over-history recompute and no snapshot table are needed at this scale.
  **Not a waiver of HA:** NFR-4 (Cloud SQL HA + PITR, RPO≈0, RTO<1h) still applies — this
  constraint concerns read-scaling/snapshotting only, not high availability.
  Revisit if a single account's ledger-entry count grows pathological or balance-read p95 breaches SLO.

- **INFRA-2 — Stateless clustered pods; any pod handles any webhook.** The service runs as
  horizontally-scaled, stateless k8s pods. Cross-pod at-most-once effect (INV-2) relies on
  **DB-level dedup** — a unique `(operator, operator_event_id)` / idempotency key plus
  transactional apply. **No in-memory dedup, no pod affinity, no sticky sessions.**
  **Schema requirement (the anchor this constraint depends on):** a migration must create an
  `operator_events` table (or equivalent) with a `UNIQUE (operator, operator_event_id)` index —
  the existing schema has only `payments.idempotency_key` unique, which does not cover raw
  operator events. Without that index there is nothing enforcing cross-pod dedup.

- **INFRA-3 — Billing run is single-runner-safe.** The recurring billing run must not
  double-charge when multiple pods are running: guard it with leader election, a Postgres
  advisory lock, or dedupe on `(subscription, billing_period)`.

- **FIN-1 — Money & tax rounding.** All amounts are integer minor units, never floats (NFR-10).
  Tax is computed **per line, half-up to the minor unit**, then lines are summed for the document
  total — never computed on the rounded total. `gross = net + tax` (INV-7). (Ref: review PR-009.)
