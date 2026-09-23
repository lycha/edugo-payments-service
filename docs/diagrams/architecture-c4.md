# Architecture — C4 model (EduGo Payments Service)

**Status:** Draft · **Date:** 2026-09-21 · **Author:** Krzysztof Jackowski

C4 model derived from the specs, in three levels. Diagrams are Mermaid flowcharts (render on
GitHub); labels are kept short — see the ADRs for the detail.

**Related:** [PRD](../prd.md) · [ADR 0002 — deployment](../adr/0002-deployment-and-infrastructure.md) · [ADR 0003 — async backbone](../adr/0003-async-backbone.md) · [ADR 0004 — API auth](../adr/0004-api-auth.md)

Three facts the model encodes: the service is **standalone, service-to-service, private-by-default**
(one REST API); the **only public ingress** is the operator-webhook path; async is **Postgres +
CronJobs only**, status is **pull-based** (no bus, no outbox).

> **Legend:** in every diagram below, **blue marks the elements under description** — the service (Level 1), its containers (Level 2), and its components (Level 3).

---

## Level 1 — System Context

```mermaid
flowchart TB
    parent([Parent])
    admin([Admin / Back-office])
    platform[EduGo Platform]
    payments{{EduGo Payments Service}}
    idp[EduGo IdP]
    operator[Payment Operator<br/>PayU]
    acct[Accounting<br/>SALDEO → KSeF]

    parent --> platform
    admin --> platform
    platform -->|REST service-to-service + poll status| payments
    payments -->|validate user JWT| idp
    payments -->|charge / refund| operator
    operator -->|webhooks + settlements| payments
    payments -->|invoice handoff| acct

    classDef focus fill:#1168bd,stroke:#0b4884,color:#fff;
    class payments focus
```

Humans reach payments **only through** the EduGo Platform (service-to-service). The IdP that issues
the forwarded user JWT is assumed, not confirmed (ASM-4).

---

## Level 2 — Containers

Everything runs on **GKE (`europe-central2`)**, private VPC; data at rest stays in the EU.

```mermaid
flowchart TB
    platform[EduGo Platform]
    operator[Payment Operator]
    idp[EduGo IdP]

    subgraph pay[EduGo Payments Service · GKE]
        api["Payments API<br/>Fastify · ≥2 pods"]
        jobs["CronJobs<br/>billing · dunning · reconciliation"]
        relay["Inbox Relay<br/>CronJob"]
        db[("Payments DB<br/>Cloud SQL · dedicated schema")]
    end

    platform -->|REST + poll status| api
    operator -->|webhook: HMAC + IP allowlist| api
    api -->|charge / refund| operator
    api -->|validate JWT| idp
    api --> db
    jobs --> db
    jobs -->|merchant-initiated charges + settlements| operator
    relay --> db

    classDef focus fill:#1168bd,stroke:#0b4884,color:#fff;
    class api,jobs,relay,db focus
```

- **Payments API** — REST `/api/v1`, webhook ingest (fast ACK), status-polling endpoint.
- **Inbox Relay** — drains `operator_events`, applies each in one txn → exactly-once (INV-2/3).
- **CronJobs** — single-runner via advisory lock (INFRA-3).
- *(A pre-deploy Migration Job applies DDL and gates the rollout — ADR-0005; omitted above for clarity.)*

---

## Level 3 — Components (Payments API)

Hexagonal layering: the domain is framework/DB-free; adapters depend inward through ports.

```mermaid
flowchart LR
    ext[EduGo Platform<br/>/ Operator] --> http["HTTP Adapter<br/>Fastify + mapper"]
    http --> hub["PaymentHub<br/>domain facade"]
    hub --> model["Domain model + ports<br/>Money · ledger"]
    hub --> store["Storage Adapter<br/>Kysely DAO"]
    store --> db[("Payments DB")]

    classDef focus fill:#1168bd,stroke:#0b4884,color:#fff;
    class http,hub,model,store focus
```

Wired by the awilix composition root (`src/platform/container.ts`); each write goes through
`UnitOfWork.withTransaction` so the ledger append and balance update commit together.
