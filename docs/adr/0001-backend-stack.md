# ADR 0001 — Backend stack for the payments service

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** Krzysztof Jackowski (EM), Tech Lead

## Context

We are building the EduGo payments module (recurring tuition, ~35k paying parents,
month-start collection burst, balance must always be consistent with operation
history). The team is 3 engineers on GCP; the only hard language requirement is
TypeScript. Four architecture principles drive the choice:

1. **API-first** — a handwritten OpenAPI file is the contract; types/routes are generated from it.
2. **Migration-first** — the schema is defined by handwritten SQL migrations.
3. **Persistence generated from migrations** — DB types/DAOs derive from the live schema (SOLID).
4. **Dependency Injection** and **5. Domain-Driven Design** as the architectural spine.

These principles rule out the two common defaults: NestJS (code-first Swagger,
framework coupling) and Prisma/TypeORM (schema/code-first, ORM-coupled entities
that fight migration-first and DDD).

## Decision

| Concern | Choice |
| --- | --- |
| Runtime | Node 22 LTS, TypeScript (strict), pnpm |
| HTTP | Fastify v5 (thin edge; bundles pino) |
| API-first | `openapi-typescript` (DTO types) + `fastify-openapi-glue` (routes by operationId) + Fastify ajv (validation from the spec) |
| Migrations | `node-pg-migrate` (raw SQL up/down) |
| Persistence | `kysely` (type-safe SQL) + `kysely-codegen` (types introspected from the migrated DB) |
| DI | `awilix` (no decorators → domain stays framework-free) |
| Validation | `zod` (parse at boundaries) |
| Observability | OpenTelemetry (opt-in via OTLP endpoint) |
| Config | Zod-validated env loader |
| Testing | Vitest + Testcontainers (real Postgres for repo/migration tests) |

Architecture is hexagonal/DDD, organized **per bounded context**. Each context
(e.g. `src/payments/`) owns its `adapter/` (`http/incoming`, `storage`) and `domain/`
(`model`, `port`, `Errors`, `<Context>Hub`) — ports and adapters live inside the
context, there is no `shared` domain package. Non-domain technical bootstrap (DB pool,
HTTP server, DI container, config, telemetry) lives in `src/platform/`. Generated code
lives in a gitignored `.generated/` tree that mirrors the module structure and is
imported via the `#generated/*` subpath. Awilix composes at the edge; the ledger entry
+ balance update are written in one Kysely transaction (invariant: `balance == Σ ledger_entries`).

## Consequences

- **Positive:** each principle is satisfied without fighting a tool; the domain has
  zero framework dependencies; two codegen pipelines (spec→types, migrations→types)
  keep contract and schema authoritative; tests exercise real SQL.
- **Negative / trade-offs:**
  - No Spring-grade contract-first server generator exists in TS; `fastify-openapi-glue`
    + `openapi-typescript` is the pragmatic best and needs the two codegen steps wired into CI.
  - No ORM Unit of Work out of the box — we hand-write repositories and a `UnitOfWork`
    port (acceptable, and cleaner for DDD).
  - Bare-Node ESM build is deferred; dev/test run via tsx/vitest. A bundler
    (esbuild/tsup) is added when we need a production build artifact.
  - Generated code lives in a **gitignored** `.generated/` tree, so a fresh clone must
    run `pnpm codegen` before typecheck/tests (`codegen:db` needs a migrated database).

## Open decisions (deferred, revisit before M2)

1. **Async / scheduling backbone: GCP Pub/Sub vs pg-boss.** — **RESOLVED by [ADR-0003](0003-async-backbone.md): neither** — a Postgres transactional inbox + K8s CronJob relays.
   - *Pub/Sub* — matches the PRD and GCP-native scaling; needs a transactional
     outbox and more infra.
   - *pg-boss* — Postgres-native queue with cron + outbox semantics; zero extra
     infra, ideal for a 3-person team at current (single-digit TPS) scale.
   - *Leaning:* pg-boss for M1 (billing run, dunning, webhook processing, reconciliation),
     revisit Pub/Sub if cross-service fan-out or throughput demands it.

2. **DI/composition depth: Awilix alone vs `@fastify/awilix` (request-scoped).**
   - Manual Awilix composition (current) is enough while use cases own their
     transactions. Adopt `@fastify/awilix` if we need request-scoped dependencies
     (per-request correlation, request-scoped UoW).

## Alternatives considered

- **NestJS** — great DI/structure/ecosystem, but code-first Swagger and framework
  coupling work against principles 1 and 5.
- **Prisma** — schema-first + generated ORM client; contradicts principles 2 and 3.
- **TypeORM** — decorator entities are code-first and ORM-coupled.
- **MikroORM** — the one ORM worth revisiting (Data Mapper + Unit of Work), but still
  entity-first rather than generated-from-migrations.
