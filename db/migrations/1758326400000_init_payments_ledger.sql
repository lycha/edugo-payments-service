-- Up Migration

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE accounts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_ref text UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES accounts (id),
  amount_minor       bigint NOT NULL CHECK (amount_minor > 0),
  currency           text NOT NULL,
  operator_reference text,
  idempotency_key    text NOT NULL,
  status             text NOT NULL DEFAULT 'RECORDED',
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_idempotency_key_uniq UNIQUE (idempotency_key)
);
CREATE INDEX payments_account_id_idx ON payments (account_id);

-- Append-only. Corrections are new reversing entries, never updates/deletes.
CREATE TABLE ledger_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts (id),
  entry_type   text NOT NULL CHECK (entry_type IN (
                 'CHARGE', 'PAYMENT', 'REFUND', 'PARTIAL_REFUND', 'DISCOUNT',
                 'LATE_FEE', 'ADJUSTMENT', 'CREDIT', 'FEE', 'CHARGEBACK')),
  amount_minor bigint NOT NULL, -- signed; PAYMENT is positive (credits the balance)
  currency     text NOT NULL,
  reference    text,
  payment_id   uuid REFERENCES payments (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_account_id_idx ON ledger_entries (account_id, created_at);

-- Materialized balance. INVARIANT: balance_minor == SUM(ledger_entries.amount_minor)
-- for the account, maintained in the same transaction as each entry.
CREATE TABLE account_balances (
  account_id    uuid PRIMARY KEY REFERENCES accounts (id),
  balance_minor bigint NOT NULL DEFAULT 0,
  currency      text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE IF EXISTS account_balances;
DROP TABLE IF EXISTS ledger_entries;
DROP TABLE IF EXISTS payments;
DROP TABLE IF EXISTS accounts;
