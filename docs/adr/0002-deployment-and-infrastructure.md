# ADR 0002 — Deployment & infrastructure topology

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** Krzysztof Jackowski (EM), CTO
- **Relates to:** [ADR 0001 — backend stack](0001-backend-stack.md); `specs/payments/CONSTRAINTS.md` (INFRA-1/2/3)

## Context

ADR-0001 fixed the language/framework stack. This ADR fixes the **runtime topology** — how the
payments service is packaged, deployed, networked, and connected to its database on GCP.

The PRD's DD-8 leaned *serverless-first* (Cloud Run + Pub/Sub + Cloud SQL). The gap-interrogation
workshop and its constraints (INFRA-2: stateless clustered pods, any pod handles any webhook)
assume a **multi-pod Kubernetes** model for explicit zero-downtime control. This ADR makes that
choice and, in doing so, **revises DD-8's compute tier from Cloud Run to GKE**.

## Decision

| # | Decision |
| --- | --- |
| 1 | **Standalone, self-contained bounded-context service.** Its only integration surface with the rest of EduGo is a **versioned REST API** (`/api/v1`). No other service reads or writes its data directly. |
| 2 | **Packaged as a Docker container** — a single image, 12-factor configuration via environment (Zod-validated env loader). |
| 3 | **Deployed on GCP GKE (Kubernetes)** with **≥ 2 replicas**, rolling deployments and readiness/liveness probes for **zero-downtime deploys**. Pods are **stateless** — any pod serves any request or webhook (INFRA-2). |
| 4 | **Container images stored in GCP Artifact Registry.** |
| 5 | **Private by default, with one narrow public exception for operator webhooks.** All EduGo-facing traffic is **private-VPC-only**. The **sole** public ingress is a **narrowly-scoped webhook path** for the payment operator's callbacks, protected by a **source-IP allowlist** (the operator's published ranges) + **HMAC signature verification** + **rate limiting**. No other endpoint is publicly reachable. |
| 6 | **Connects to Cloud SQL (PostgreSQL) over private IP**, in the same region/VPC (no public database endpoint). |
| 7 | **Dedicated schema in the primary PostgreSQL database, accessed via a dedicated least-privilege DB role/user** — logical isolation without a separate instance. |

## Consequences

- **Positive**
  - Clean bounded-context isolation: REST-only integration (no shared DB access) enforces the service boundary.
  - Zero-downtime deploys and the stateless multi-pod model the payments specs assume (INFRA-2).
  - Minimal attack surface — private-network-only, no public endpoint (supports NFR-6 security posture).
  - Cost efficiency: shares the primary Postgres instance while isolating via schema + role; image provenance via Artifact Registry.
- **Negative / trade-offs**
  - **Revises PRD §10 DD-8** (serverless Cloud Run) → **GKE**. More operational surface than Cloud Run, in exchange for explicit control over replicas and rollout. NFR-5's "autoscale for the predictable burst" is now delivered by an HPA rather than Cloud Run's request-based scaling.
  - **Shared Postgres instance** → potential noisy-neighbour / shared blast radius with other schemas. Mitigated by the dedicated least-privilege role and resource governance; revisit a dedicated instance if isolation or performance demands it.
  - The recurring **billing run must be single-runner-safe** across the ≥2 pods (leader election / advisory lock) — see `CONSTRAINTS.md` INFRA-3.
  - Other EduGo services must integrate **through the API**, never the database — a deliberate constraint that keeps the context boundary honest.
  - The operator webhook is the **one public attack surface**. It is defence-in-depth'd — source-IP allowlist + HMAC verification + rate limiting (NFR-6 anti-card-testing) — and any pod can serve it (INFRA-2). The **allowlist depends on the operator's published source-IP ranges**, a contract/maintenance dependency (see Q-2 / E-OPERATOR-CONTRACT); if the operator can't guarantee stable IPs, HMAC + rate limiting remain the primary controls and the allowlist is dropped or widened.

## Open items

- Ingress mechanism specifics (internal HTTP(S) LB vs mesh) and the private-network layout are left to the platform/infra setup.
- Confirm the operator's published **webhook source-IP ranges** for the public allowlist — part of Q-2 / E-OPERATOR-CONTRACT.
- Pub/Sub vs pg-boss for the async backbone remains open per ADR-0001; unaffected by this topology choice.
