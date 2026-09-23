-- Up Migration
-- Payments feature — CORE transactional tables (part 1 of 3).
-- Promotes specs/payments/contracts/schema.sql onto the init ledger migration.
-- Layers: account aggregate, tax rates, subscriptions/charges, payment methods,
-- payments (evolve), payment intents, the operator-events inbox, allocations.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Shared trigger helpers (used here and by later migrations).
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Append-only guard: block UPDATE/DELETE on immutable tables (INV-4, NFR-8).
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

-- 1. Parent-account aggregate (Q-1, AC-2, AC-49).
ALTER TABLE accounts
  ADD COLUMN currency   text        NOT NULL DEFAULT 'PLN' CHECK (char_length(currency) = 3),
  ADD COLUMN status     text        NOT NULL DEFAULT 'ACTIVE'
                                    CHECK (status IN ('ACTIVE', 'CANCELLED', 'CLOSED')),
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE account_billing_contacts (
  account_id   uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
  name         text NOT NULL,
  email        text NOT NULL,
  tax_id       text,
  address_line text,
  postal_code  text,
  city         text,
  country_code text CHECK (country_code IS NULL OR char_length(country_code) = 2),
  redacted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE child_sub_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  student_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT child_sub_accounts_account_student_uniq UNIQUE (account_id, student_id)
);
CREATE INDEX child_sub_accounts_account_id_idx ON child_sub_accounts (account_id);

CREATE TABLE enrollments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_sub_account_id uuid NOT NULL REFERENCES child_sub_accounts (id) ON DELETE RESTRICT,
  course_ref          text NOT NULL,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrollments_child_sub_account_id_idx ON enrollments (child_sub_account_id);

-- 2. Effective-dated tax rates (PR-009, DAT-24).
CREATE TABLE tax_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction text NOT NULL,
  category     text NOT NULL,
  rate         numeric(6,4) NOT NULL CHECK (rate >= 0),
  treatment    text NOT NULL CHECK (treatment IN ('STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT')),
  legal_reason text,
  valid_from   date NOT NULL,
  valid_to     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rates_key_from_uniq UNIQUE (jurisdiction, category, valid_from),
  CONSTRAINT tax_rates_valid_range_chk CHECK (valid_to IS NULL OR valid_to > valid_from),
  CONSTRAINT tax_rates_legal_reason_chk
    CHECK (treatment NOT IN ('EXEMPT', 'ZERO_RATED') OR legal_reason IS NOT NULL)
);
CREATE INDEX tax_rates_lookup_idx ON tax_rates (jurisdiction, category, valid_from DESC);

-- 3. Subscriptions & charges (AC-11/19/35/38, PR-009, INV-5/7, INFRA-3).
CREATE TABLE subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id    uuid NOT NULL REFERENCES enrollments (id) ON DELETE RESTRICT,
  monthly_fee_minor bigint NOT NULL CHECK (monthly_fee_minor > 0),
  currency         text NOT NULL CHECK (char_length(currency) = 3),
  billing_day      smallint NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz
);
CREATE INDEX subscriptions_enrollment_id_idx ON subscriptions (enrollment_id);

CREATE TABLE charges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  enrollment_id  uuid REFERENCES enrollments (id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES subscriptions (id) ON DELETE RESTRICT,
  student_id     text,
  billing_period text,
  status         text NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','REQUIRES_ACTION','AUTHORIZED','SETTLED',
                                   'DECLINED','EXPIRED','FAILED')),
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  net_minor      bigint NOT NULL CHECK (net_minor >= 0),
  tax_minor      bigint NOT NULL CHECK (tax_minor >= 0),
  gross_minor    bigint NOT NULL CHECK (gross_minor > 0),
  tax_rate       numeric(6,4) NOT NULL,
  tax_treatment  text NOT NULL CHECK (tax_treatment IN ('STANDARD','REDUCED','ZERO_RATED','EXEMPT')),
  tax_legal_reason text,
  tax_jurisdiction text NOT NULL,
  idempotency_key text NOT NULL,
  expires_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charges_gross_chk CHECK (gross_minor = net_minor + tax_minor),
  CONSTRAINT charges_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT charges_tax_legal_reason_chk
    CHECK (tax_treatment NOT IN ('EXEMPT', 'ZERO_RATED') OR tax_legal_reason IS NOT NULL)
);
CREATE INDEX charges_account_status_idx ON charges (account_id, status);
CREATE INDEX charges_enrollment_id_idx ON charges (enrollment_id);
CREATE INDEX charges_subscription_id_idx ON charges (subscription_id);
CREATE INDEX charges_expiry_sweep_idx ON charges (expires_at)
  WHERE status IN ('PENDING', 'REQUIRES_ACTION');
CREATE UNIQUE INDEX charges_subscription_period_uniq
  ON charges (subscription_id, billing_period)
  WHERE subscription_id IS NOT NULL AND billing_period IS NOT NULL;

-- 4. Payment methods, payments (evolve), payment intents, operator events, allocations.
CREATE TABLE payment_methods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  operator         text NOT NULL,
  token            text NOT NULL,
  mandate_reference text,
  method_type      text,
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_methods_account_id_idx ON payment_methods (account_id);

ALTER TABLE payments
  ADD COLUMN direction         text CHECK (direction IN ('PUSH','PULL')),
  ADD COLUMN operator          text,
  ADD COLUMN payment_method_id uuid REFERENCES payment_methods (id),
  ADD COLUMN cit_mit           text CHECK (cit_mit IN ('CIT','MIT')),
  ADD COLUMN confirmed_at      timestamptz;
ALTER TABLE payments
  ADD CONSTRAINT payments_currency_len_chk CHECK (char_length(currency) = 3);
CREATE INDEX payments_payment_method_id_idx ON payments (payment_method_id);

CREATE TABLE payment_intents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  operator       text,
  status         text NOT NULL DEFAULT 'CREATED'
                 CHECK (status IN ('CREATED','REDIRECTED','CONFIRMED','EXPIRED')),
  redirect_url   text,
  idempotency_key text NOT NULL,
  payment_id     uuid REFERENCES payments (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_intents_idempotency_key_uniq UNIQUE (idempotency_key)
);
CREATE INDEX payment_intents_account_id_idx ON payment_intents (account_id);
CREATE INDEX payment_intents_payment_id_idx ON payment_intents (payment_id);

-- Transactional inbox (ADR-0003): dedup UNIQUE + retry/backoff/DLQ columns.
CREATE TABLE operator_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator          text NOT NULL,
  operator_event_id text NOT NULL,
  event_type        text,
  signature_verified boolean NOT NULL DEFAULT false,
  payload           jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','PROCESSED','FAILED','DEAD','DUPLICATE','REJECTED')),
  attempts          integer NOT NULL DEFAULT 0,
  next_attempt_at   timestamptz,
  last_error        text,
  payment_id        uuid REFERENCES payments (id),
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  CONSTRAINT operator_events_dedup_uniq UNIQUE (operator, operator_event_id)
);
CREATE INDEX operator_events_claim_idx ON operator_events (status, next_attempt_at);
CREATE INDEX operator_events_payment_id_idx ON operator_events (payment_id);

CREATE TABLE payment_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  charge_id    uuid NOT NULL REFERENCES charges (id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_allocations_charge_id_idx ON payment_allocations (charge_id);
CREATE INDEX payment_allocations_payment_id_idx ON payment_allocations (payment_id);

-- updated_at maintenance (PR-S6).
CREATE TRIGGER accounts_set_updated_at BEFORE UPDATE ON accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER account_billing_contacts_set_updated_at BEFORE UPDATE ON account_billing_contacts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER subscriptions_set_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER charges_set_updated_at BEFORE UPDATE ON charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payment_intents_set_updated_at BEFORE UPDATE ON payment_intents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Down Migration

DROP TRIGGER IF EXISTS payment_intents_set_updated_at ON payment_intents;
DROP TRIGGER IF EXISTS charges_set_updated_at ON charges;
DROP TRIGGER IF EXISTS subscriptions_set_updated_at ON subscriptions;
DROP TRIGGER IF EXISTS account_billing_contacts_set_updated_at ON account_billing_contacts;
DROP TRIGGER IF EXISTS accounts_set_updated_at ON accounts;

DROP TABLE IF EXISTS payment_allocations;
DROP TABLE IF EXISTS operator_events;
DROP TABLE IF EXISTS payment_intents;

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_currency_len_chk;
ALTER TABLE payments
  DROP COLUMN IF EXISTS confirmed_at,
  DROP COLUMN IF EXISTS cit_mit,
  DROP COLUMN IF EXISTS payment_method_id,
  DROP COLUMN IF EXISTS operator,
  DROP COLUMN IF EXISTS direction;

DROP TABLE IF EXISTS payment_methods;
DROP TABLE IF EXISTS charges;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS tax_rates;
DROP TABLE IF EXISTS enrollments;
DROP TABLE IF EXISTS child_sub_accounts;
DROP TABLE IF EXISTS account_billing_contacts;

ALTER TABLE accounts
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS currency;

DROP FUNCTION IF EXISTS forbid_mutation();
DROP FUNCTION IF EXISTS set_updated_at();
