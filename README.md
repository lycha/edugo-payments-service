# edugo-payments-service

Payments module for the EduGo portal. TypeScript, Fastify, Kysely, Postgres on GCP.

Architecture and stack rationale: [`docs/adr/0001-backend-stack.md`](docs/adr/0001-backend-stack.md).
Product scope: see the PRD.

## Principles

1. **API-first** — `openapi/openapi.yaml` is the source of truth; DTO types are generated from it and routes are wired by `operationId`.
2. **Migration-first** — schema lives in handwritten SQL under `db/migrations/`.
3. **Persistence generated from migrations** — `kysely-codegen` introspects the migrated DB into `.generated/`.
4. **Dependency Injection** — Awilix composition root in `src/platform/container.ts`.
5. **DDD / hexagonal, per bounded context** — each context (e.g. `src/payments/`) holds `adapter/` (`http/incoming`, `storage`) and `domain/` (`model`, `port`, `Errors`, `<Context>Hub`). Ports and adapters live inside the context; technical bootstrap lives in `src/platform/`.

## Layout

```
src/
  payments/                    # bounded context
    adapter/
      http/incoming/           PaymentApiImpl.ts, PaymentMapper.ts
      storage/                 PaymentDao.ts, PaymentRepositoryDB.ts
    domain/
      model/                   Money.ts, LedgerEntryType.ts
      port/                    PaymentRepository.ts, UnitOfWork.ts
      Errors.ts
      PaymentHub.ts
  platform/                    # non-domain bootstrap: db, http server, DI, config, telemetry
  main.ts
.generated/                    # gitignored; mirrors module structure, imported via #generated/*
```

## Two codegen pipelines

```
openapi/openapi.yaml  --openapi-typescript-->  .generated/payments/adapter/http/incoming/openapi.ts
db/migrations/*.sql    --(applied)--> Postgres --kysely-codegen--> .generated/platform/db/schema.ts
```

The whole `.generated/` tree is **gitignored** and imported via the `#generated/*` subpath.
Run `pnpm codegen` after install and whenever the contract or a migration changes
(`codegen:db` needs a migrated database on `DATABASE_URL`).

## Prerequisites

- Node 22 LTS, pnpm, and a Docker-compatible runtime (for local Postgres and Testcontainers).
- **Colima users:** Testcontainers needs the socket pointed explicitly:
  ```bash
  export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
  export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE="/var/run/docker.sock"
  ```

## Quickstart

```bash
pnpm install
cp .env.example .env

# start a local Postgres
docker run -d --name edugo-pg -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=edugo_payments postgres:16-alpine

pnpm db:migrate          # apply SQL migrations
pnpm codegen             # regenerate OpenAPI + DB types
pnpm dev                 # start the API (http://localhost:3000/api/v1)
```

Record a payment:

```bash
curl -X POST http://localhost:3000/api/v1/payments \
  -H 'content-type: application/json' \
  -H 'Idempotency-Key: 11111111-2222-3333-4444-555555555555' \
  -d '{"accountId":"<uuid>","amountMinor":12000,"currency":"PLN"}'
```

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Run the API with reload (tsx) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest + Testcontainers (needs Docker) |
| `pnpm codegen` | Regenerate OpenAPI and DB types |
| `pnpm db:migrate` / `:down` / `:create` | Manage SQL migrations |

## Vertical slice included

`POST /payments` (`recordPayment`) → `PaymentApiImpl` → `PaymentMapper` → `PaymentHub.recordPayment`
→ `UnitOfWork` (`PaymentRepositoryDB` opens a Kysely transaction) → `PaymentDao` appends a
`PAYMENT` ledger entry and updates the materialized balance atomically. Idempotent via
`Idempotency-Key`. Covered by an integration test against real Postgres.
