# Architecture Review Checklist

This checklist is used by the peer reviewer when reviewing **architecture phase** outputs: tech spec, implementation plan, and tickets for the edugo-payments-service.

Run every criterion. Mark each as:
- `[x]` Pass
- `[ ] ⚠️` Fail (include brief explanation)
- `[-]` Not applicable

---

## Tech Spec — Completeness

- [ ] **PRD coverage** — Every requirement from the PRD (`docs/prd.md`) is addressed in the spec. No silent omissions.
- [ ] **Context & goals** — The "why" is clearly stated. Someone unfamiliar with the feature can understand the motivation.
- [ ] **Architecture approach** — The chosen approach is explained with rationale, consistent with the five principles (API-first, migration-first, persistence-from-migrations, DI, DDD) and the ADRs in `docs/adr/`. Alternatives and trade-offs are documented.
- [ ] **Bounded-context placement** — It's clear which bounded context (`src/<context>/`) this feature lives in, and the boundary is justified. New cross-context dependencies are called out.

## Tech Spec — API Design

- [ ] **Contract-first** — New/changed endpoints are (or will be) defined in `openapi/openapi.yaml` with method, path, request schema, response schema, and error codes, and bound by `operationId`.
- [ ] **Error handling** — Error responses are defined as `application/problem+json` with meaningful status codes and messages, mappable to `DomainError` subclasses — not just "500 Internal Server Error".
- [ ] **Consistency** — Path naming, casing, versioning (`/api/v1`), and patterns are consistent with the existing endpoints.
- [ ] **Idempotency** — Write operations that could be retried (payments, refunds) have an idempotency strategy documented (e.g. `Idempotency-Key` + unique constraint, replay semantics).
- [ ] **Validation rules** — Input validation requirements are specified (required fields, formats, business-rule validation) and expressible via the OpenAPI schema / Zod.

## Tech Spec — Data Model

- [ ] **Table definitions** — All tables are defined with columns, types, and relationships. Money columns are `bigint` minor units with a currency column.
- [ ] **Aggregate boundaries & invariants** — DDD aggregate roots and their invariants are identified (e.g. the balance == Σ ledger-entries invariant and the append-only ledger rule).
- [ ] **Migration strategy** — Schema changes are described as handwritten SQL migrations under `db/migrations/` (node-pg-migrate), with the `kysely-codegen` regeneration step noted. No ORM/schema-first tooling introduced.
- [ ] **Index strategy** — Indexes are specified for columns used in WHERE/JOIN/ORDER BY, especially on large tables (payments, ledger entries).
- [ ] **Data integrity** — Constraints (unique, foreign key, not null, check) are defined; cascade behavior is specified. Idempotency keys are unique.

## Tech Spec — Integration Points

- [ ] **External services** — All external dependencies (payment operators, GCP services) are listed with their failure modes.
- [ ] **Async flows** — Asynchronous operations (billing run, dunning, webhook processing, reconciliation) document ordering and delivery guarantees. The queue/scheduling choice aligns with ADR-0001's open decision (pg-boss vs Pub/Sub) or updates it.
- [ ] **Failure handling** — Retries, timeouts, and fallback strategies are defined for each integration; a transactional outbox is used where cross-boundary consistency matters.
- [ ] **Eventual consistency** — Where used, the consistency model and reconciliation approach are documented.

## Tech Spec — Non-Functional Requirements

- [ ] **Quantified targets** — NFRs use numbers, not vague language. "p99 < 200ms at the month-start burst" not "should be fast". Peak load (35k paying parents, month-start collection burst) is accounted for.
- [ ] **Security** — Authentication/authorization requirements are specified. Input-validation approach documented. Secrets sourced from the environment.
- [ ] **Observability** — How the feature is traced/logged is considered (OpenTelemetry is opt-in via OTLP endpoint; structured pino logs).

## Tech Spec — Open Questions

- [ ] **No blocking unknowns** — Any open questions are marked non-blocking or have a resolution plan with a timeline.
- [ ] **Risk assessment** — Technical risks are identified with mitigation strategies.

---

## Implementation Plan — Structure

- [ ] **Task ordering** — Tasks are ordered by dependency. No task depends on an unfinished later task. Codegen/migration prerequisites are sequenced correctly.
- [ ] **Valid DAG** — The dependency graph has no cycles.
- [ ] **Critical path identified** — The longest dependency chain is marked.
- [ ] **Granularity** — Each task is small enough for a single TDD session (roughly ≤ 1 day). Tasks larger than "M" should be questioned.

## Implementation Plan — Task Quality

- [ ] **Acceptance criteria** — Every task has specific, testable acceptance criteria (e.g. "returns 201 + balance on first record; 200 + original result on replay; 404 for unknown account").
- [ ] **Context sufficiency** — Each task has enough context to work without clarifying questions; technical notes reference the relevant spec/ADR sections.
- [ ] **Files identified** — Each task names the files likely created or modified (domain/port/adapter, migration, openapi spec, tests).
- [ ] **Size estimates** — Every task has a size (S/M/L), skewing toward S and M. Too many L's suggests insufficient decomposition.

---

## Tickets — Completeness

- [ ] **Tickets match plan** — There is a 1:1 mapping between implementation-plan tasks and tickets.
- [ ] **Dependencies linked** — Blocking relationships between tickets are captured.
- [ ] **Acceptance criteria present** — Every ticket includes acceptance criteria from the implementation plan.
- [ ] **Technical notes present** — Key implementation hints and relevant patterns (ports/adapters to touch, invariants to preserve) are included.
- [ ] **Sizing set** — Points/size reflect the estimate from the implementation plan.

---

## Consistency Checks (Cross-Artifact)

- [ ] **Spec ↔ Plan alignment** — Every section of the tech spec is covered by at least one task in the implementation plan.
- [ ] **Plan ↔ Tickets alignment** — Every task in the plan has a corresponding ticket with matching acceptance criteria.
- [ ] **Spec ↔ Contract/Schema** — Entities and endpoints in the spec match what the OpenAPI contract and SQL migrations will express.
- [ ] **Naming consistency** — Table/column names, endpoint paths, and domain terms are consistent across all artifacts and follow the ubiquitous language.
