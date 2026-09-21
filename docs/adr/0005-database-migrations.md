# ADR 0005 — Database migrations under Kubernetes

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** Krzysztof Jackowski (EM), CTO
- **Relates to:** [ADR 0001](0001-backend-stack.md) (migration-first, node-pg-migrate), [ADR 0002](0002-deployment-and-infrastructure.md) (GKE, ≥2 pods, dedicated schema + role).

## Context

Schema is handwritten SQL under `db/migrations/` applied by `node-pg-migrate` (migration-first).
On GKE with ≥2 pods and rolling deploys against a **shared** primary Postgres, migrations must run
**exactly once**, **before** new code serves traffic, and **without downtime** — so app pods must not
each run migrations on startup (they would race), and a migration must not break the old code still
running mid-rollout.

## Decision

1. **Migrations run as a pre-deploy Kubernetes Job** (CD pre-upgrade hook / pipeline step), **not**
   from app pods on startup. The Job is a single pod; `node-pg-migrate`'s lock (its `pgmigrations`
   table) makes even accidental concurrent runs safe.
2. **The rollout is gated on the Job succeeding** — new ReplicaSet rolls out only after migrations
   commit. A failed migration **blocks** the deploy (fail-safe).
3. **Two DB roles (least privilege):** a **migration role** with DDL rights on the payments schema
   (used only by the Job) and the **runtime role** with DML-only (used by app pods) — refines
   ADR-0002 #7.
4. **Expand–contract (parallel change) for zero downtime:** each migration must be compatible with
   **both** the currently-running and the incoming code. Additive/backward-compatible changes ship
   with or before the code that needs them; destructive changes (drop column/table, tighten a
   constraint) happen in a **later** release, after no running code references them.
5. **Forward-only in production.** `down` migrations exist for local/dev and emergencies; production
   "rollback" is a new forward migration (matches the append-only ethos).

## Consequences

- **Positive:** zero-downtime deploys preserved; DDL privilege isolated from the runtime role; a bad
  migration can't half-apply across racing pods; failed migration stops the release rather than
  serving broken code.
- **Negative / trade-offs:** destructive schema changes span **two releases** (expand then contract) —
  more discipline, slower for breaking changes. Migrations must be **idempotent/re-runnable** in case
  a Job retries. The CD system must support an ordered pre-deploy gate.

## Open items

- Exact CD mechanism (Helm `pre-upgrade` hook vs Argo PreSync vs pipeline Job) — left to platform setup.
- Whether the migration role is a distinct Cloud SQL user or the same user with elevated grants.
