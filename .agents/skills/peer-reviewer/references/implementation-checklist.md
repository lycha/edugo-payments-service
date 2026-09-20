# Implementation Review Checklist

This checklist is used by the peer reviewer when reviewing **implementation phase** outputs: production code, tests, and the branch for a specific change/ticket in the edugo-payments-service repo.

Run every criterion. Mark each as:
- `[x]` Pass
- `[ ] ⚠️` Fail (include brief explanation)
- `[-]` Not applicable

---

## TDD Discipline

- [ ] **Tests exist** — There are test files corresponding to the production code. Every public behavior has at least one test under `test/**/*.test.ts`.
- [ ] **Tests came first** — Verify through Git history or file timestamps that test files were created/modified before production code. If ambiguous, check that tests test behavior, not implementation (a strong signal of test-first).
- [ ] **Red-Green-Refactor** — The code shows signs of TDD discipline: focused tests, minimal production code, clean structure. No obvious "write everything then bolt on tests" patterns.
- [ ] **Tests pass** — Run `pnpm test`. All tests pass, zero failures. (Integration tests need Docker for Testcontainers; a silent skip is not a pass.)
- [ ] **Typecheck is clean** — Run `pnpm typecheck` (`tsc --noEmit`, strict). No errors. There is no separate linter, so this is the static gate.
- [ ] **Generated code is fresh** — If the OpenAPI spec or a migration changed, `pnpm codegen` was re-run so `.generated/` matches the contract and schema.

## Acceptance Criteria

- [ ] **All criteria met** — Every acceptance criterion from the ticket is satisfied by the implementation.
- [ ] **Criteria have tests** — Each acceptance criterion is covered by at least one test. Map criteria to test cases.
- [ ] **Edge cases** — Common edge cases are tested: invalid/empty inputs, boundary values, error conditions, and concurrent access where relevant (e.g. concurrent idempotency-key writes).

## Code Quality — TypeScript

- [ ] **Type safety** — No `any` where `unknown` + narrowing fits. Casts (`as`) are justified, especially on request bodies (validate at the boundary instead). `noUncheckedIndexedAccess` results are handled (index access may be `undefined`).
- [ ] **Immutability** — `readonly` / `const` preferred. Domain value objects (e.g. `Money`) are immutable and return new instances. Mutable state is justified.
- [ ] **Money handling** — Money is `bigint` minor units via the `Money` value object — never `number`/floats. `bigint`↔Postgres `bigint` conversions use `.toString()` / `BigInt(...)`.
- [ ] **Domain purity** — Domain code (`src/<context>/domain/`) imports no framework or DB types (`fastify`, `kysely`, `#generated/*`, awilix). Dependencies flow inward through ports.
- [ ] **No dead code** — No commented-out code, unused imports, unreachable branches, or TODO stubs left behind.

## Code Quality — Fastify / Kysely / awilix

- [ ] **Transaction boundaries** — Writes that must be atomic (ledger entry + balance update) run inside `UnitOfWork.withTransaction`. A DAO isn't used outside a transaction where atomicity is required.
- [ ] **Dependency injection** — Classes take a single `deps` object resolved by name via awilix; new wired classes are registered in the `Cradle` in `src/platform/container.ts`. No ad-hoc instantiation of dependencies inside the domain.
- [ ] **Configuration** — No hardcoded values that belong in the Zod env loader (`src/platform/config/env.ts`). New env vars are added to the schema and `.env.example`.
- [ ] **Input validation** — New request/response shapes are validated by the OpenAPI spec via `fastify-openapi-glue` (ajv); other external input uses Zod parsing at the boundary. Validation errors return 400 as `application/problem+json`.
- [ ] **Error handling** — Errors extend `DomainError` and are mapped to the right HTTP status in `src/platform/http/server.ts`'s error handler (`AccountNotFoundError` → 404, other `DomainError` → 422, validation → 400, else 500). No errors are silently swallowed.
- [ ] **Logging** — Key operations and error paths use Fastify's structured (pino) logging. No logging of secrets or PII (tokens, full payment identifiers).

## Architecture Compliance

- [ ] **Spec / ADR alignment** — The implementation matches the tech spec and the decisions in `docs/adr/`. API contracts, table structures, and integration patterns match.
- [ ] **Contract-first** — API changes were made in `openapi/openapi.yaml` first and wired by `operationId`; DTO types come from `.generated/...openapi.ts`, not hand-written.
- [ ] **Migration-first** — Schema changes are handwritten SQL under `db/migrations/`; the Kysely schema is regenerated, not hand-edited.
- [ ] **Module boundaries** — Code lives in the correct context/layer. No dependency violations (domain importing from adapter/platform, or one bounded context reaching into another).
- [ ] **Naming consistency** — Endpoint paths, table/column names, and field names match the spec and migration. No silent renames.
- [ ] **Deviations documented** — Any intentional deviation from the spec is documented (comment or a new ADR).

## Domain Invariants (payments)

- [ ] **Balance invariant** — `account_balances.balance_minor == SUM(ledger_entries.amount_minor)` per account, and it's maintained in the same transaction as the entry. Tests assert it (INV-1).
- [ ] **Append-only ledger** — `ledger_entries` are only inserted; corrections are new reversing entries, never `UPDATE`/`DELETE` of existing rows.
- [ ] **Idempotency** — Write operations keyed by `Idempotency-Key` return the original result on replay (no second entry, HTTP 200), and a concurrent unique-violation (Postgres `23505` → `DuplicateIdempotencyKeyError`) is handled as a replay, not a 500.

## Security

- [ ] **Input validation** — All external input is validated (OpenAPI/ajv or Zod) before processing.
- [ ] **SQL safety** — Queries go through Kysely's builder / parameterized `sql` — no string-concatenated SQL. Raw `sql` fragments interpolate values, not identifiers from user input.
- [ ] **AuthN/AuthZ** — Endpoints requiring auth are protected; authorization checks guard sensitive operations (note current auth posture per the spec).
- [ ] **No secrets in code** — No credentials, keys, or tokens in source; all come from the environment. `.env` and `.generated/` are not committed.
- [ ] **Safe defaults** — Deny-by-default for access control; fail-closed for security checks.

## Performance

- [ ] **No queries in loops** — No repeated per-row queries where a single set-based query or join would do. Watch for `await` inside `for`/`map` over rows.
- [ ] **Indexes match queries** — New queries filter/sort on indexed columns; new tables or access patterns add the needed indexes in the migration (e.g. `account_id`, `idempotency_key`).
- [ ] **Bounded results** — No unbounded `selectAll()` on tables that grow (payments, ledger entries) without pagination/limits.
- [ ] **Resource management** — DB connections and the Kysely instance are closed on shutdown; no leaked transactions or open handles in tests.

## Test Quality

- [ ] **Behavior-focused** — Tests verify behavior and outcomes, not internals. Refactoring production code shouldn't break them.
- [ ] **Clear naming** — Test names describe the scenario and expected behavior.
- [ ] **Arrange-Act-Assert** — Setup, execution, and verification are distinct.
- [ ] **Appropriate test types** — Integration tests against real Postgres (Testcontainers) for repository/transaction/migration behavior; lighter unit tests for pure domain logic (e.g. `Money`). No over-reliance on mocks of the DB.
- [ ] **Independent** — Tests don't depend on each other or on execution order; each seeds its own account and idempotency keys.
- [ ] **No test pollution** — Tests clean up (or use fresh data); the Testcontainer is started once per suite and torn down in `afterAll`. No leftover state between tests.
- [ ] **Meaningful assertions** — Every test has assertions that check the right thing (not just "no exception thrown"). `bigint` values are compared as `bigint`.
- [ ] **Error-path coverage** — Unhappy paths are tested: invalid input (400), unknown account (404), domain rule violation (422), idempotent replay, concurrent conflict.

## Git Hygiene

- [ ] **Branch/ticket link** — The branch clearly maps to the change/ticket it implements (follow the team's branch convention if one is defined).
- [ ] **Focused changes** — The branch only contains changes for this change/ticket. No unrelated refactors or drive-by fixes.
- [ ] **No generated or local files** — Build outputs, IDE files, `.env`, and the `.generated/` tree are not committed (covered by `.gitignore`).
