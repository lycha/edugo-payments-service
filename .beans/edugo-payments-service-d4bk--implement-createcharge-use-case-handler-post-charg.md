---
# edugo-payments-service-d4bk
title: Implement createCharge use case + handler (post CHARGE ledger entry)
status: todo
type: task
priority: high
tags:
    - tier2
created_at: 2026-09-23T12:05:12Z
updated_at: 2026-09-23T12:20:18Z
parent: edugo-payments-service-f4c4
blocked_by:
    - edugo-payments-service-1t6l
---

## Context
A new order's first charge posts a CHARGE to the ledger (AC-29/30/32, INV-7).

## What needs to be done
- Implement createCharge use case + handler (POST /charges): build the tax breakdown (net/tax/gross, gross=net+tax), insert a PENDING charge, and post a CHARGE ledger entry for the GROSS as a negative (arrears) entry — all in one UnitOfWork txn. Idempotent via Idempotency-Key.
- Tax breakdown for M1 (PR-E2-5): the request carries only { enrollmentId, netMinor, currency }, so resolve the breakdown server-side by looking up tax_rates for (jurisdiction, category) effective today, DEFAULTING to EXEMPT (tax=0, gross=net, legal reason set). The full effective-dated engine is out of scope.

## Acceptance Criteria
- [ ] Given a valid request, when POSTed then a PENDING charge + a negative CHARGE ledger entry are written in one txn, balance == SUM(ledger) (INV-1/INV-7), 201 returned.
- [ ] Given a repeated Idempotency-Key, when POSTed then the original charge is returned with no second entry.
- [ ] Given EXEMPT treatment, when created then tax=0, gross=net (INV-7), legal reason present.

## Out of Scope
- Effective-dated rate lookup engine (default EXEMPT for M1); subscription-driven recurring charges.

## Technical Notes
- Sign convention: charge reduces balance (negative). Reuse appendLedgerEntry(entry_type=CHARGE). DB CHECK enforces tax_legal_reason for EXEMPT/ZERO_RATED.

## Dependencies
- Blocked by ChargeDao + UnitOfWork bundle.

## Definition of Done
- [ ] Integration test: create -> charge+entry+balance; replay; EXEMPT; pnpm typecheck + tests green
