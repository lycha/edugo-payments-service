# Implementation Plan — EduGo Payments Service

**Related:** [PRD](prd.md) · [ADR 0001 — backend stack](adr/0001-backend-stack.md)

## Approach
Walking-skeleton, vertical-slice first. Each slice is delivered end-to-end (OpenAPI
contract → SQL migration → generated types → domain port → adapter → `PaymentHub` →
integration test against real Postgres) inside the `payments` bounded context. Build for
**correctness first** (scale is single-digit TPS; the risk is duplicate/lost payments and
balance drift, not throughput).

Conventions per slice:
1. Extend `openapi/openapi.yaml`; run `pnpm codegen:openapi`.
2. Add a SQL migration under `db/migrations/`; run `pnpm db:migrate` + `pnpm codegen:db`.
3. Define/extend a domain `port`, implement in `adapter/storage`, expose via `PaymentHub`.
4. Wire the incoming adapter (`PaymentApiImpl` + `PaymentMapper`) and register in the DI container.
5. Cover with a Testcontainers integration test asserting the relevant invariants.

## Status
- ✅ Scaffold: Node 22 + TS strict, Fastify v5, Kysely + `kysely-codegen`, `node-pg-migrate`,
  Awilix, Zod, OpenTelemetry (opt-in), Vitest + Testcontainers. Two codegen pipelines wired;
  `.generated/` gitignored via `#generated/*`.
- ✅ Slice: **record a payment** — `POST /payments`, append-only ledger + materialized
  balance in one transaction, idempotent via `Idempotency-Key`. INV-1 and idempotent replay
  covered by tests. Typecheck + tests green.

## Milestone M1 — Core correctness (MVP)
Goal: money can enter the system correctly and the balance is always provable.
1. **Charges & accounts model** — migrations + ports for `subscriptions`, `charges`;
   read model for account statement (`GET /accounts/{id}/ledger`, `/balance`).
2. **Push payment against a charge** — extend record-payment to allocate a payment across
   open charges (FR-9, oldest-first); over-allocation → `CREDIT` (INV-5).
3. **Idempotent webhook intake** (DD-2) — `POST /webhooks/{operator}`: HMAC verify → persist
   to `webhook_events` (unique key) → enqueue → worker applies in one transaction; out-of-order
   tolerant payment state machine (`PENDING→AUTHORIZED→PAID/FAILED`). Start with **pg-boss**
   (Postgres-native queue + outbox) unless we adopt Pub/Sub.
4. **Reconciliation v1** (DD-3) — daily job ingests a settlement report, three-way match into
   `reconciliation_runs`/`_items`, fees as separate `FEE` entries, mismatches → alert/queue.
5. **Operations: refunds** (full/partial) + chargebacks as reversing entries (INV-4).

**Exit criteria:** duplicate/late webhook is a no-op; reconciliation proves `ledger == payout`;
refund/chargeback reflected correctly; all invariants covered by integration tests.

## Milestone M2 — Recurring (pull) + lifecycle
1. **Payment methods / mandates** — `payment_methods` (tokens/CoF); SCA **CIT** on first
   payment, **MIT** flag on recurring (FR-4, NFR-6).
2. **Billing run** — monthly job generates charges per active subscription on the billing day;
   first-month proration; mid-month enrollment proration (FR-1/2), cancellation adjustment (FR-3).
3. **Pull auto-charge** — charge stored method for open charges; retry policy.
4. **Dunning** — automated communication schedule → access block; recovery on payment (FR-13).
5. **Operations: discounts, late-payment interest, overpayments (wallet), manual corrections** (audited).
6. **Invoices on demand** + accounting handoff (SALDEO → KSeF) (FR-14, A9/A10).

## Milestone M3 — Multi-operator + hardening
1. **Operator abstraction** `PaymentProvider` + concrete PayU/Tpay; **Stripe** as second.
2. **Cost-based routing** (`ProviderRouter`) — PLN via PayU/Tpay, foreign via Stripe (DD-5).
3. **Observability hardening** — SLOs + golden signals (success rate, latency, reconciliation
   drift, DLQ depth), alerting, tracing (NFR-9).
4. **Security/compliance** — RBAC + MFA + segregation of duties for back-office; KMS for
   tokens/secrets; EU data residency; retention vs erasure policy (NFR-6/7).

## Cross-cutting
- **Idempotency** everywhere: client keys on user actions, operator event IDs on webhooks,
  unique constraints make retries no-ops.
- **Money** as integer grosze (`Money` VO), never floats.
- **Transactions**: ledger entry + balance update (+ outbox row) in one Kysely transaction.
- **Audit**: append-only ledger + correlation IDs across API → operator → posting.

## Testing strategy
- Integration-first: repositories, migrations, and hubs tested against real Postgres
  (Testcontainers). Assert invariants (INV-1..5), idempotency, and reconciliation matching.
- Contract: requests/responses validated against `openapi.yaml` at runtime (Fastify ajv).
- Unit: pure domain (`Money`, allocation, proration, state machine).

## Open decisions (from ADR 0001)
1. **Async/scheduling backbone:** pg-boss (Postgres-native, M1) vs GCP Pub/Sub (fan-out/scale).
2. **DI depth:** Awilix-only vs `@fastify/awilix` (request-scoped) when per-request context is needed.
