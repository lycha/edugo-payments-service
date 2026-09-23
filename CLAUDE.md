# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Payments module for the EduGo portal: TypeScript, Fastify, Kysely, Postgres. Stack rationale
lives in `docs/adr/0001-backend-stack.md`; product scope in `docs/prd.md`. Package manager is
**pnpm** (Node 22+, ESM-only — `"type": "module"`).

## Commands

```bash
pnpm install
pnpm codegen          # regenerate BOTH generated trees (see below) — required after a fresh clone
pnpm dev              # API with reload (tsx watch) on http://localhost:3000/api/v1
pnpm typecheck        # tsc --noEmit — there is no separate linter; this is the static gate
pnpm test             # vitest run (needs Docker — see Testing)
pnpm test:watch
pnpm db:migrate       # apply SQL migrations up;  :down reverts one;  :create <name> scaffolds a SQL migration
```

Run a single test: `pnpm vitest run test/payments/record-payment.int.test.ts` (or `-t '<name>'` to filter by title).

## Two codegen pipelines (critical to understand before editing)

The entire `.generated/` tree is **gitignored and machine-generated** — never hand-edit it; a fresh
clone will not typecheck or test until `pnpm codegen` has run. It has two independent sources:

- `pnpm codegen:openapi` — `openapi/openapi.yaml` → `.generated/payments/adapter/http/incoming/openapi.ts` (DTO types).
- `pnpm codegen:db` — introspects the **live migrated Postgres** on `$DATABASE_URL` via `kysely-codegen` → `.generated/platform/db/schema.ts`. This means `codegen:db` requires a running DB that has had `pnpm db:migrate` applied; regenerate it after any migration change.

Generated code is imported through the `#generated/*` subpath (configured in `package.json` imports,
`tsconfig.json` paths, and `vitest.config.ts` alias — keep all three in sync if that path changes).

The contract and the SQL migrations are the sources of truth: to change the API, edit
`openapi/openapi.yaml` (routes are bound by `operationId`); to change the schema, add a migration
under `db/migrations/`. Then re-run codegen.

## Architecture

Hexagonal / DDD. `src/payments/` is the **payments service** (one bounded context / shared ledger),
organized into **side-by-side sub-domains**, each with the same `domain/` + `adapter/` tree. A single
application orchestrator coordinates them over one transaction. Sub-domains import each other through the
`#payments/*` subpath alias (kept in sync across `package.json` `imports`, `tsconfig.json` `paths`, and
`vitest.config.ts` alias — same rule as `#generated/*`), so cross-context imports are depth-independent.

- `src/payments/ledger/` — the **shared kernel**: framework-free core owning money, the ledger, the balance,
  and payment recording. `domain/model/` (`Money`, `LedgerEntryType`), `domain/port/` (`PaymentRepository`,
  `UnitOfWork` + `RepositoryBundle`), `domain/Errors.ts` (the whole `DomainError` hierarchy), and
  `adapter/` (`PaymentDao`; `PaymentRepositoryDB` implements `UnitOfWork`; `PaymentApiImpl`/`PaymentMapper`
  for `recordPayment`). The domain depends on **no** framework or DB type.
- `src/payments/charges/` — the **charges** sub-domain: `domain/model/` (`Charge`, `ChargeStatus`,
  `TaxBreakdown`, `ChargeCursor`), `domain/port/` (`ChargeRepository`), and `adapter/` (`ChargeDao`;
  `ChargeApiImpl`/`ChargeMapper` for `createCharge`/`getCharge`/`listCharges`). Depends on the ledger kernel.
- `src/payments/application/` — `PaymentHub`, the **single orchestrator**. It injects the ledger + charges
  ports (via the `UnitOfWork` bundle) and wraps each use case in one transaction. New sub-domains (dunning,
  invoices, reconciliation…) get their own `charges/`-shaped tree when their epics start.
- `src/platform/` — non-domain bootstrap only: `config/env.ts` (Zod-validated env), `db/database.ts`,
  `http/server.ts`, `observability/telemetry.ts`, and `container.ts` (Awilix composition root).

**Dependency injection:** Awilix in PROXY mode resolves constructor deps by name. Every class takes a
single `deps` object (e.g. `constructor(private readonly deps: { unitOfWork: UnitOfWork })`); the
`Cradle` interface in `container.ts` is the registry. Adding a wired class means registering it there.

**Request flow**: e.g. `POST /api/v1/charges` → `fastify-openapi-glue` matches `operationId: createCharge`
→ `ChargeApiImpl.createCharge` → `ChargeMapper` → `PaymentHub.createCharge` → `UnitOfWork.withTransaction`
opens **one Kysely transaction** and hands the callback a transaction-bound **repository bundle
`{ payments, charges }`** (`PaymentDao` + `ChargeDao` on the same trx). Inside that transaction the charge
is inserted and the `CHARGE` ledger entry + balance update happen together. `recordPayment` follows the
same shape via `PaymentApiImpl`.

**Domain rules to preserve:**
- **Money is integer minor units held as `bigint`** — never floats. Postgres `bigint` columns round-trip
  as strings, so DAO code converts with `.toString()` / `BigInt(...)`.
- **Ledger is append-only** (`ledger_entries`); corrections are new reversing entries, never updates/deletes.
- **Invariant:** `account_balances.balance_minor == SUM(ledger_entries.amount_minor)` per account, maintained
  in the same transaction. Tests assert this (INV-1).
- **Idempotency:** `Idempotency-Key` header → unique `payments.idempotency_key`. A replay returns the original
  result (HTTP 200) with no second entry; a fresh record returns 201. `PaymentHub` also treats a concurrent
  unique-violation (`23505` → `DuplicateIdempotencyKeyError`) as a replay.

**Error mapping** is centralized in `src/platform/http/server.ts` `setErrorHandler`: `AccountNotFoundError`
/ `EnrollmentNotFoundError` / `ChargeNotFoundError` → 404, other `DomainError` → 422, ajv validation errors
→ 400, else 500 — all as `application/problem+json`. New domain errors surface correctly only if mapped
there. **The handler is registered _before_ `app.register(openapiGlue, …)`** — glue mounts routes in a
child encapsulation context that snapshots the parent error handler at creation, so a handler set afterward
is not inherited and routes fall back to Fastify's default 500.

## Testing

Tests are **integration tests against real Postgres via Testcontainers** — Docker (or a compatible
runtime) must be running. `test/setup/postgres.ts` starts a throwaway `postgres:16-alpine`, applies the
migrations to it, and returns a connection string; this is separate from your dev DB. Timeouts are 120s
and the pool is `forks` (see `vitest.config.ts`). Test files: `test/**/*.test.ts`.

**Colima users:** Testcontainers needs the socket pointed explicitly (see README) —
`export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"` and
`export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE="/var/run/docker.sock"`.

## Notes

- Observability is opt-in: telemetry starts only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.
- Project-pinned agent skills live in `.agents/skills/` and are tracked by `skills-lock.json`
  (notably `domain-driven-design`, `postgresql-table-design`, `zod`, `ponytail`).
