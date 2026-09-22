# ERD — payments schema

**Status:** Draft · **Date:** 2026-09-23 · **Author:** Krzysztof Jackowski

Entity-relationship view of `specs/payments/contracts/schema.sql` (post-review). Attributes are
**trimmed to PK/FK + a few key columns** for legibility — the SQL is the source of truth.

**Related:** [schema.sql](../../specs/payments/contracts/schema.sql) · [schema review](../../specs/payments/contracts/peer-review-schema.md) · [C4 model](architecture-c4.md)

Conventions: `*_minor` columns are `bigint` integer minor units (never float); `PK`/`FK` marked;
base tables (`accounts`, `payments`, `ledger_entries`, `account_balances`) come from the init migration.

```mermaid
erDiagram
    accounts ||--|| account_balances : "has"
    accounts ||--o| account_billing_contacts : "PII (1:1)"
    accounts ||--o{ child_sub_accounts : "children"
    child_sub_accounts ||--o{ enrollments : "enrolls"
    enrollments ||--o{ subscriptions : "billed by"
    accounts ||--o{ charges : "owes"
    enrollments ||--o{ charges : "for"
    subscriptions ||--o{ charges : "generates"
    accounts ||--o{ payment_methods : "stores"
    accounts ||--o{ payments : "pays"
    payment_methods ||--o{ payments : "via"
    accounts ||--o{ payment_intents : "initiates"
    payments ||--o| payment_intents : "confirms"
    payments ||--o{ operator_events : "confirmed by"
    payments ||--o{ payment_allocations : "allocated"
    charges ||--o{ payment_allocations : "settled by"
    accounts ||--o{ ledger_entries : "ledger"
    payments ||--o{ ledger_entries : "posts"
    charges ||--o{ ledger_entries : "posts"
    payments ||--o{ refunds : "refunded"
    ledger_entries |o--o| refunds : "reversing entry"
    accounts ||--o{ adjustments : "adjusted"
    adjustment_batches ||--o{ adjustments : "batches"
    ledger_entries |o--o| adjustments : "applied entry"
    adjustment_batches ||--o{ adjustment_batch_entries : "previews"
    accounts ||--o{ adjustment_batch_entries : "targets"
    accounts ||--o{ disbursements : "paid out"
    ledger_entries |o--o| disbursements : "debit entry"
    accounts ||--o{ invoices : "invoiced"
    invoices ||--o{ invoice_lines : "lines"
    charges ||--o{ invoice_lines : "billed on"
    accounts ||--o| dunning_state : "dunning (1:1)"
    accounts ||--o{ dunning_notifications : "notified"
    accounts ||--o{ dunning_overrides : "overrides"
    accounts ||--o{ reconciliation_mismatches : "mismatch"
    payments ||--o{ reconciliation_mismatches : "flagged"

    accounts {
        uuid id PK
        text external_ref
        text currency
        text status
        timestamptz deleted_at
    }
    account_balances {
        uuid account_id PK,FK
        bigint balance_minor
        text currency
    }
    account_billing_contacts {
        uuid account_id PK,FK
        text name
        text email
        timestamptz redacted_at
    }
    child_sub_accounts {
        uuid id PK
        uuid account_id FK
        text student_id
    }
    enrollments {
        uuid id PK
        uuid child_sub_account_id FK
        text course_ref
        text status
    }
    subscriptions {
        uuid id PK
        uuid enrollment_id FK
        bigint monthly_fee_minor
        smallint billing_day
        text status
    }
    charges {
        uuid id PK
        uuid account_id FK
        uuid enrollment_id FK
        uuid subscription_id FK
        text status
        bigint net_minor
        bigint tax_minor
        bigint gross_minor
        text billing_period
        text idempotency_key
    }
    payment_methods {
        uuid id PK
        uuid account_id FK
        text operator
        text token
        text status
    }
    payments {
        uuid id PK
        uuid account_id FK
        uuid payment_method_id FK
        bigint amount_minor
        text direction
        text cit_mit
        timestamptz confirmed_at
        text idempotency_key
    }
    payment_intents {
        uuid id PK
        uuid account_id FK
        uuid payment_id FK
        bigint amount_minor
        text status
        text idempotency_key
    }
    operator_events {
        uuid id PK
        uuid payment_id FK
        text operator
        text operator_event_id
        text status
        integer attempts
        timestamptz next_attempt_at
    }
    payment_allocations {
        uuid id PK
        uuid payment_id FK
        uuid charge_id FK
        bigint amount_minor
    }
    ledger_entries {
        uuid id PK
        uuid account_id FK
        uuid payment_id FK
        uuid charge_id FK
        text entry_type
        bigint amount_minor
    }
    refunds {
        uuid id PK
        uuid payment_id FK
        uuid ledger_entry_id FK
        bigint amount_minor
        text status
        text maker_id
        text checker_id
    }
    adjustment_batches {
        uuid id PK
        boolean dry_run
        text status
        text senior_approver_id
    }
    adjustments {
        uuid id PK
        uuid account_id FK
        uuid batch_id FK
        uuid ledger_entry_id FK
        bigint amount_minor
        text status
    }
    adjustment_batch_entries {
        uuid id PK
        uuid batch_id FK
        uuid account_id FK
        bigint amount_minor
        text outcome
    }
    disbursements {
        uuid id PK
        uuid account_id FK
        uuid ledger_entry_id FK
        bigint amount_minor
        text bank_transfer_ref
        text status
    }
    invoices {
        uuid id PK
        uuid account_id FK
        text number
        bigint gross_minor
    }
    invoice_lines {
        uuid id PK
        uuid invoice_id FK
        uuid charge_id FK
        text student_id
        bigint gross_minor
        text tax_treatment
    }
    dunning_state {
        uuid account_id PK,FK
        text status
        boolean access_blocked
        text current_step
        timestamptz next_action_at
    }
    dunning_notifications {
        uuid id PK
        uuid account_id FK
        text step
        text channel
        timestamptz sent_at
    }
    dunning_overrides {
        uuid id PK
        uuid account_id FK
        text action
        text status
    }
    reconciliation_mismatches {
        uuid id PK
        uuid account_id FK
        uuid payment_id FK
        text kind
        text status
        bigint drift_minor
    }
    tax_rates {
        uuid id PK
        text jurisdiction
        text category
        numeric rate
        text treatment
        date valid_from
    }
    settlements {
        uuid id PK
        text operator
        text settlement_window
        bigint payout_total_minor
    }
    audit_log {
        uuid id PK
        text correlation_id
        text actor_id
        text action
        text entity_type
        uuid entity_id
    }
```

## Notes

- **Parent-account aggregate:** `accounts` is the single balance-bearing root (`account_balances`
  1:1); `child_sub_accounts` → `enrollments` → `subscriptions` are billing structure, not balances.
- **Ledger link direction (PR-S5):** `ledger_entries` points at the `charge` it realises; each
  correction (`refunds`/`adjustments`/`disbursements`) points at *its* reversing entry via
  `ledger_entry_id`. No bidirectional FK — and `ledger_entries` is append-only (INSERT-only, enforced).
- **Standalone tables:** `tax_rates` (effective-dated lookup), `settlements` (reconciliation ingest),
  and `audit_log` (its `entity_id` is a soft reference, deliberately not an FK) have no drawn edges.
- **Not shown:** every non-key column, CHECK constraints, indexes, and idempotency keys — see
  [schema.sql](../../specs/payments/contracts/schema.sql).
