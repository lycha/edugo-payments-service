# ADR 0003 — Async backbone: transactional inbox + CronJob relays, pull-based status

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** Krzysztof Jackowski (EM), CTO
- **Relates to:** [ADR 0001](0001-backend-stack.md) (resolves its deferred "Pub/Sub vs pg-boss" open decision), [ADR 0002](0002-deployment-and-infrastructure.md). **Revises** PRD NFR-2 / NFR-3 latency.

## Context

ADR-0001 deferred the async/scheduling backbone (GCP Pub/Sub vs pg-boss). The service needs
three things: **periodic jobs** (billing run, dunning tick, reconciliation), **reliable webhook
ingestion** with exactly-once effect (DD-2, INV-2/INV-3), and a way to **tell the EduGo platform
about access-block/recovery** (FR-13).

Constraints driving the choice: a 3-person team, single-digit TPS (A2), *correctness over
throughput*, and an explicit preference to **avoid managed infrastructure that must be maintained**
(Pub/Sub) and **avoid hidden control flow** (Postgres `LISTEN/NOTIFY`). Instant balance
confirmation is **not** a product requirement — a payment does not need to reflect in the balance
within seconds.

## Decision

Postgres + Kubernetes only — no Pub/Sub, no pg-boss.

1. **Periodic tasks → K8s CronJob** (billing run, dunning tick, reconciliation). Single-runner via
   `concurrencyPolicy: Forbid` + a Postgres advisory lock (INFRA-3). ~1-minute granularity accepted.
2. **Webhook ingestion → an endpoint on the GKE service** (not a separate service). It **verifies
   the HMAC signature, inserts the raw event into an `inbox` table, and returns a fast `200` ACK** —
   no business processing in the request. The `inbox` table is the `operator_events` table
   (PR-014) with `UNIQUE (operator, operator_event_id)` — that uniqueness is the dedup and gives
   INV-2 (at-most-once).
3. **Inbox relay → a K8s CronJob (~1 min)** drains the inbox: claims rows with
   `SELECT … FOR UPDATE SKIP LOCKED`, skips already-processed keys, and **applies each event within
   one DB transaction** (mark row processed + write the ledger entry + update the balance
   atomically). Retries/backoff/DLQ are columns on the row: `status` (`PENDING/PROCESSED/FAILED/DEAD`),
   `attempts`, `next_attempt_at`, `last_error`. Because apply + mark-processed share one transaction,
   a crash re-processes safely; exactly-once effect holds (INV-2/INV-3).
4. **No outbox / no push to EduGo.** Payments is the **source of truth** for account/dunning/access
   status and exposes a **REST polling endpoint**; the EduGo platform polls it (at access-check/login
   or on a schedule) and updates its own access control. Integration stays **pull-based over REST**
   (ADR-0002 #1) — no event bus, no dual-write.

**Rejected:** `LISTEN/NOTIFY` (control flow hidden from the code, harder to maintain); an always-on
worker loop (unnecessary once seconds-latency is not required); pg-boss and Pub/Sub (avoid the
dependency / managed service at this scale — the inbox is the same idea, owned in our schema).

## Consequences

- **Positive**
  - Zero extra managed infrastructure; everything is Postgres + CronJobs, all control flow explicit in code.
  - Exactly-once effect via the inbox unique key + single-transaction apply (INV-2/INV-3); natural DLQ + replay.
  - The billing run's single-runner requirement (INFRA-3) is satisfied for free by a CronJob pod.
  - Pull-based status keeps the bounded-context boundary clean — no outbox relay, no dual-write.
- **Negative / trade-offs**
  - **Revises NFR-2 / NFR-3:** operator-confirmation→balance is now eventually consistent on the order
    of **~1–2 minutes** (the inbox-relay cadence), not seconds. Accepted — instant confirmation isn't
    needed; balance **reads** stay O(1)/fast (NFR-2 balance-read target unchanged).
  - **Access-block/recovery reaction is bounded by EduGo's poll interval**, not pushed. Acceptable for
    access gating; EduGo owns its poll cadence. Adds (cheap, bounded) read load on the status endpoint.
  - CronJob cadence (~1 min) is the floor for processing latency; if sub-minute is ever required,
    switch the inbox relay to an always-on worker (revisit — the inbox model doesn't change).
  - More hand-rolled code than adopting pg-boss (build-vs-buy), owned and maintained by us.

## Open items

- Define the **status polling endpoint** contract (per-account access/dunning status) in `openapi/openapi.yaml`.
- **Backoff schedule + max attempts** before an inbox row goes `DEAD`.
- **DLQ alerting threshold** — `DLQ depth = count(status = 'DEAD')` feeds NFR-9.
