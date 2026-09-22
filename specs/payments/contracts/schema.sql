-- ============================================================================
-- Payments — DATABASE SCHEMA DESIGN (Phase 4 artefact, not yet a live migration)
--
-- Derived from specs/payments/spec.md (AC-1..AC-50, INV-1..INV-7),
-- specs/payments/contracts/openapi.yaml, specs/payments/glossary.md, and
-- specs/payments/CONSTRAINTS.md. Layers the full feature onto the existing
-- init migration (db/migrations/1758326400000_init_payments_ledger.sql), which
-- already created: accounts, payments, ledger_entries, account_balances.
--
-- Conventions (kept identical to the init migration):
--   * Money is INTEGER MINOR UNITS held as bigint — never float/numeric (NFR-10).
--     Signed on ledger entries/adjustments; positive elsewhere.
--   * currency is an ISO-4217 code per money-bearing row (currency-generic, PR-003);
--     PLN-only is operational scope, enforced in the app (AC-8), shape-checked here.
--   * Enums are text + CHECK (matches ledger_entries.entry_type), not native ENUM.
--   * uuid PKs via gen_random_uuid() (pgcrypto); timestamptz stored in UTC.
--   * Financial rows are RETAINED: FKs are ON DELETE RESTRICT, closure is soft-delete
--     (deleted_at) + PII redaction (AC-40) — the ledger is append-only (INV-4).
--   * Every money-moving mutation table carries its own idempotency_key UNIQUE (PR-005/AC-17).
--
-- Promotion: split into node-pg-migrate migrations under db/migrations/, run
-- `pnpm db:migrate`, then `pnpm codegen:db` to regenerate the Kysely types.
-- ============================================================================

-- Up Migration

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. Parent-account aggregate: accounts (evolve) + billing PII + children + enrollments
--    Q-1 (one balance-bearing parent), AC-2, AC-49 (parent PII only; students by ID).
-- ----------------------------------------------------------------------------

-- accounts already exists (id, external_ref, created_at). Evolve it.
ALTER TABLE accounts
  ADD COLUMN currency   text        NOT NULL DEFAULT 'PLN' CHECK (char_length(currency) = 3),
  ADD COLUMN status     text        NOT NULL DEFAULT 'ACTIVE'
                                    CHECK (status IN ('ACTIVE', 'CANCELLED', 'CLOSED')),
  ADD COLUMN deleted_at timestamptz,                                  -- soft-delete only (AC-40)
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- The only PII in payments is the parent's billing contact (AC-49). Kept 1:1 with
-- accounts so a GDPR erasure redacts a single row (AC-40) without touching the ledger.
CREATE TABLE account_billing_contacts (
  account_id   uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
  name         text NOT NULL,
  email        text NOT NULL,
  tax_id       text,
  address_line text,
  postal_code  text,
  city         text,
  country_code text CHECK (country_code IS NULL OR char_length(country_code) = 2),
  redacted_at  timestamptz,                                           -- set on GDPR erasure (AC-40)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- One sub-account per child under a parent; NOT balance-bearing (AC-2). Student by ID only (AC-49).
CREATE TABLE child_sub_accounts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  student_id text NOT NULL,                                           -- external student system ID; no PII
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT child_sub_accounts_account_student_uniq UNIQUE (account_id, student_id)
);
CREATE INDEX child_sub_accounts_account_id_idx ON child_sub_accounts (account_id);

-- Enrollment links a child to a classroom/course; what a subscription bills against (AC-2, DAT-22).
CREATE TABLE enrollments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_sub_account_id uuid NOT NULL REFERENCES child_sub_accounts (id) ON DELETE RESTRICT,
  course_ref          text NOT NULL,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ENDED')),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrollments_child_sub_account_id_idx ON enrollments (child_sub_account_id);

-- ----------------------------------------------------------------------------
-- 2. Tax rate table — effective-dated (PR-009, DAT-24). PL tuition defaults to EXEMPT.
-- ----------------------------------------------------------------------------
CREATE TABLE tax_rates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  jurisdiction text NOT NULL,                                         -- e.g. 'PL'
  category     text NOT NULL,                                         -- e.g. 'TUITION'
  rate         numeric(6,4) NOT NULL CHECK (rate >= 0),               -- ratio, e.g. 0.2300; exact, not money
  treatment    text NOT NULL CHECK (treatment IN ('STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT')),
  legal_reason text,                                                  -- required for EXEMPT/ZERO_RATED (AC-33)
  valid_from   date NOT NULL,
  valid_to     date,                                                  -- NULL = open-ended
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tax_rates_key_from_uniq UNIQUE (jurisdiction, category, valid_from),
  CONSTRAINT tax_rates_valid_range_chk CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX tax_rates_lookup_idx ON tax_rates (jurisdiction, category, valid_from DESC);

-- ----------------------------------------------------------------------------
-- 3. Subscriptions & charges (AC-11, AC-19, AC-35, AC-38, PR-009, INV-5, INV-7, INFRA-3)
-- ----------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id    uuid NOT NULL REFERENCES enrollments (id) ON DELETE RESTRICT,
  monthly_fee_minor bigint NOT NULL CHECK (monthly_fee_minor > 0),
  currency         text NOT NULL CHECK (char_length(currency) = 3),
  billing_day      smallint NOT NULL CHECK (billing_day BETWEEN 1 AND 31),  -- 29-31 clamps in app (AC-35)
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  cancelled_at     timestamptz
);
CREATE INDEX subscriptions_enrollment_id_idx ON subscriptions (enrollment_id);

-- A charge is an amount owed with its full tax breakdown; gross posts to the ledger (PR-009).
CREATE TABLE charges (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  enrollment_id  uuid REFERENCES enrollments (id) ON DELETE RESTRICT,
  subscription_id uuid REFERENCES subscriptions (id) ON DELETE RESTRICT,
  student_id     text,
  billing_period text,                                               -- e.g. '2026-09'; NULL for ad-hoc/first charge
  status         text NOT NULL DEFAULT 'PENDING'
                 CHECK (status IN ('PENDING','REQUIRES_ACTION','AUTHORIZED','SETTLED',
                                   'DECLINED','EXPIRED','FAILED')),   -- state machine (AC-11)
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  net_minor      bigint NOT NULL CHECK (net_minor >= 0),
  tax_minor      bigint NOT NULL CHECK (tax_minor >= 0),
  gross_minor    bigint NOT NULL CHECK (gross_minor > 0),
  tax_rate       numeric(6,4) NOT NULL,
  tax_treatment  text NOT NULL CHECK (tax_treatment IN ('STANDARD','REDUCED','ZERO_RATED','EXEMPT')),
  tax_legal_reason text,
  tax_jurisdiction text NOT NULL,
  idempotency_key text NOT NULL,                                     -- PR-005 / AC-17 (new-order first charge)
  expires_at     timestamptz,                                        -- PENDING -> EXPIRED after 72h (AC-12/ASM-2)
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charges_gross_chk CHECK (gross_minor = net_minor + tax_minor),          -- INV-7
  CONSTRAINT charges_idempotency_key_uniq UNIQUE (idempotency_key)
);
CREATE INDEX charges_account_status_idx ON charges (account_id, status);            -- open-charge allocation (AC-19)
CREATE INDEX charges_enrollment_id_idx ON charges (enrollment_id);
-- Single-runner-safe recurring billing: one charge per (subscription, period) (INFRA-3, NEW-DEBT-1).
CREATE UNIQUE INDEX charges_subscription_period_uniq
  ON charges (subscription_id, billing_period)
  WHERE subscription_id IS NOT NULL AND billing_period IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. Payment methods, payments (evolve), payment intents, operator events
--    (DAT-7/8/9, AC-13/14/15/47, INV-2/INV-3, INFRA-2)
-- ----------------------------------------------------------------------------
-- Tokenised means of payment; PCI SAQ-A — store tokens/mandates only, never PAN (DAT-7).
CREATE TABLE payment_methods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  operator         text NOT NULL,
  token            text NOT NULL,
  mandate_reference text,                                            -- card-on-file for recurring MIT
  method_type      text,                                             -- e.g. 'CARD'
  status           text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED','REVOKED')),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_methods_account_id_idx ON payment_methods (account_id);

-- payments already exists (id, account_id, amount_minor>0, currency, operator_reference,
-- idempotency_key UNIQUE, status, created_at). Evolve with push/pull + operator + confirmation.
ALTER TABLE payments
  ADD COLUMN direction         text CHECK (direction IN ('PUSH','PULL')),          -- DAT-9
  ADD COLUMN operator          text,
  ADD COLUMN payment_method_id uuid REFERENCES payment_methods (id),
  ADD COLUMN cit_mit           text CHECK (cit_mit IN ('CIT','MIT')),              -- DAT-8
  ADD COLUMN confirmed_at      timestamptz;                                        -- INV-3 (operator confirmation)

-- Parent-initiated push via hosted page (AC-47, FR-5). Recorded as a payment on confirmation.
CREATE TABLE payment_intents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  operator       text,
  status         text NOT NULL DEFAULT 'CREATED'
                 CHECK (status IN ('CREATED','REDIRECTED','CONFIRMED','EXPIRED')),
  redirect_url   text,
  idempotency_key text NOT NULL,                                     -- AC-17
  payment_id     uuid REFERENCES payments (id),                     -- set on confirmation
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_intents_idempotency_key_uniq UNIQUE (idempotency_key)
);
CREATE INDEX payment_intents_account_id_idx ON payment_intents (account_id);

-- Inbound operator webhooks. Cross-pod at-most-once relies on this UNIQUE (INFRA-2, INV-2).
CREATE TABLE operator_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator          text NOT NULL,
  operator_event_id text NOT NULL,
  event_type        text,
  signature_verified boolean NOT NULL DEFAULT false,                 -- AC-14 (HMAC)
  payload           jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'RECEIVED'
                    CHECK (status IN ('RECEIVED','APPLIED','DUPLICATE','REJECTED')),
  payment_id        uuid REFERENCES payments (id),                  -- resulting payment, if any
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  CONSTRAINT operator_events_dedup_uniq UNIQUE (operator, operator_event_id)  -- INFRA-2 / AC-15 / INV-2
);
CREATE INDEX operator_events_status_idx ON operator_events (status);

-- Applying a payment across charges, oldest-first (AC-19); charges locked FOR UPDATE in-app (PR-008).
CREATE TABLE payment_allocations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  charge_id    uuid NOT NULL REFERENCES charges (id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_allocations_charge_id_idx ON payment_allocations (charge_id);  -- Σ allocations per charge (INV-5)
CREATE INDEX payment_allocations_payment_id_idx ON payment_allocations (payment_id);

-- ----------------------------------------------------------------------------
-- 5. Corrections under maker/checker: refunds, adjustments (+ batches), disbursements
--    (AC-10, AC-22, AC-23, AC-24, AC-25, AC-27, AC-28, PR-005, PR-006/INV-6)
-- ----------------------------------------------------------------------------
CREATE TABLE refunds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING_APPROVAL'
                 CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED')),
  auto_approved  boolean NOT NULL DEFAULT false,                     -- <= 100 PLN (AC-28 / FU-3)
  maker_id       text NOT NULL,
  checker_id     text,
  correlation_id text,
  idempotency_key text NOT NULL,                                     -- PR-005
  ledger_entry_id uuid REFERENCES ledger_entries (id),              -- reversing entry on execution (INV-4)
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CONSTRAINT refunds_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT refunds_no_self_approval_chk CHECK (checker_id IS NULL OR checker_id <> maker_id)  -- AC-23
  -- INV-6 (cumulative refunds <= captured amount) is enforced in-app within the payment lock.
);
CREATE INDEX refunds_payment_id_idx ON refunds (payment_id);

CREATE TABLE adjustment_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dry_run           boolean NOT NULL,
  status            text NOT NULL DEFAULT 'DRY_RUN'
                    CHECK (status IN ('DRY_RUN','PENDING_SENIOR_APPROVAL','APPROVED','EXECUTED','REJECTED')),
  reason            text NOT NULL,
  senior_approver_id text,                                           -- AC-27 senior approval
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  CONSTRAINT adjustment_batches_idempotency_key_uniq UNIQUE (idempotency_key)
);

CREATE TABLE adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  amount_minor   bigint NOT NULL,                                    -- signed (ADJUSTMENT is ±)
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING_APPROVAL'
                 CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED')),
  maker_id       text NOT NULL,
  checker_id     text,
  correlation_id text,
  idempotency_key text NOT NULL,                                     -- PR-005
  batch_id       uuid REFERENCES adjustment_batches (id),
  ledger_entry_id uuid REFERENCES ledger_entries (id),              -- applied entry (AC-10)
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CONSTRAINT adjustments_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT adjustments_no_self_approval_chk CHECK (checker_id IS NULL OR checker_id <> maker_id)  -- AC-23
);
CREATE INDEX adjustments_account_id_idx ON adjustments (account_id);
CREATE INDEX adjustments_batch_id_idx ON adjustments (batch_id);

-- Per-entry preview/outcome of a bulk correction, logged individually (AC-27).
CREATE TABLE adjustment_batch_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid NOT NULL REFERENCES adjustment_batches (id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  outcome      text NOT NULL CHECK (outcome IN ('WOULD_APPLY','APPLIED','REJECTED')),
  detail       text
);
CREATE INDEX adjustment_batch_entries_batch_id_idx ON adjustment_batch_entries (batch_id);

-- Manual bank-transfer payout of residual credit with no refundable capture (AC-22).
CREATE TABLE disbursements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        text NOT NULL CHECK (char_length(currency) = 3),
  bank_transfer_ref text NOT NULL,
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING_APPROVAL'
                  CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED')),
  maker_id        text NOT NULL,
  checker_id      text,
  idempotency_key text NOT NULL,                                     -- AC-17
  ledger_entry_id uuid REFERENCES ledger_entries (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  CONSTRAINT disbursements_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT disbursements_no_self_approval_chk CHECK (checker_id IS NULL OR checker_id <> maker_id)
);
CREATE INDEX disbursements_account_id_idx ON disbursements (account_id);

-- ----------------------------------------------------------------------------
-- 6. Invoicing (AC-29, AC-33, AC-50, NFR-7). Student NAME is rendered at generation
--    time and deliberately NOT stored here (AC-50) — only the student ID / enrollment ref.
-- ----------------------------------------------------------------------------
CREATE TABLE invoices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  number         text NOT NULL,
  issued_at      timestamptz NOT NULL DEFAULT now(),
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  net_minor      bigint NOT NULL CHECK (net_minor >= 0),
  tax_minor      bigint NOT NULL CHECK (tax_minor >= 0),
  gross_minor    bigint NOT NULL CHECK (gross_minor >= 0),
  idempotency_key text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_number_uniq UNIQUE (number),
  CONSTRAINT invoices_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT invoices_total_chk CHECK (gross_minor = net_minor + tax_minor)
);
CREATE INDEX invoices_account_id_idx ON invoices (account_id);

CREATE TABLE invoice_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     uuid NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  charge_id      uuid REFERENCES charges (id) ON DELETE RESTRICT,
  description    text NOT NULL,
  student_id     text,                                              -- ID only (AC-50); name NOT persisted
  enrollment_ref text,
  net_minor      bigint NOT NULL CHECK (net_minor >= 0),
  tax_minor      bigint NOT NULL CHECK (tax_minor >= 0),
  gross_minor    bigint NOT NULL CHECK (gross_minor >= 0),
  tax_rate       numeric(6,4) NOT NULL,
  tax_treatment  text NOT NULL CHECK (tax_treatment IN ('STANDARD','REDUCED','ZERO_RATED','EXEMPT')),
  tax_legal_reason text,                                            -- shown for EXEMPT/ZERO_RATED (AC-33)
  tax_jurisdiction text NOT NULL,
  CONSTRAINT invoice_lines_total_chk CHECK (gross_minor = net_minor + tax_minor)  -- INV-7
);
CREATE INDEX invoice_lines_invoice_id_idx ON invoice_lines (invoice_id);

-- ----------------------------------------------------------------------------
-- 7. Dunning (AC-16, AC-41, AC-42/FU-1/FU-2, AC-43) + overrides (AC-23)
-- ----------------------------------------------------------------------------
CREATE TABLE dunning_state (
  account_id       uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'NONE' CHECK (status IN ('NONE','IN_DUNNING','BLOCKED')),
  access_blocked   boolean NOT NULL DEFAULT false,
  current_step     text CHECK (current_step IN ('DAY_0','DAY_3','DAY_7','DAY_10','DAY_14_BLOCK')),
  messages_sent_this_cycle smallint NOT NULL DEFAULT 0
                   CHECK (messages_sent_this_cycle BETWEEN 0 AND 5),  -- max 5/cycle (AC-42 / FU-2)
  cycle_started_at timestamptz,
  next_action_at   timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One message per step per channel, sent within the 09:00-20:00 window (AC-42 / FU-1).
CREATE TABLE dunning_notifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  cycle_started_at timestamptz NOT NULL,
  step             text NOT NULL CHECK (step IN ('DAY_0','DAY_3','DAY_7','DAY_10','DAY_14_BLOCK')),
  channel          text NOT NULL CHECK (channel IN ('EMAIL','IN_APP')),
  scheduled_for    timestamptz NOT NULL,
  sent_at          timestamptz,
  CONSTRAINT dunning_notifications_one_per_step_uniq UNIQUE (account_id, cycle_started_at, step, channel)
);
CREATE INDEX dunning_notifications_account_id_idx ON dunning_notifications (account_id);

CREATE TABLE dunning_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  action         text NOT NULL CHECK (action IN ('UNBLOCK','PAUSE','RESUME')),
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING_APPROVAL'
                 CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED')),
  maker_id       text NOT NULL,
  checker_id     text,
  idempotency_key text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CONSTRAINT dunning_overrides_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT dunning_overrides_no_self_approval_chk CHECK (checker_id IS NULL OR checker_id <> maker_id)
);
CREATE INDEX dunning_overrides_account_id_idx ON dunning_overrides (account_id);

-- ----------------------------------------------------------------------------
-- 8. Reconciliation (AC-37, AC-44) — settlement ingest (mocked M1) + mismatch queue
-- ----------------------------------------------------------------------------
CREATE TABLE settlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator           text NOT NULL,
  settlement_window  text NOT NULL,                                  -- operator day-boundary (AC-37)
  payout_total_minor bigint,
  currency           text CHECK (currency IS NULL OR char_length(currency) = 3),
  raw                jsonb,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlements_operator_window_uniq UNIQUE (operator, settlement_window)
);

CREATE TABLE reconciliation_mismatches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL,                                   -- LEDGER_WITHOUT_SETTLEMENT, AMOUNT_DIFF, ...
  status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  severity          text CHECK (severity IN ('LOW','MEDIUM','HIGH')),  -- thresholds pending real data
  account_id        uuid REFERENCES accounts (id),
  payment_id        uuid REFERENCES payments (id),
  drift_minor       bigint,
  settlement_window text,
  detected_at       timestamptz NOT NULL DEFAULT now(),              -- within 24h (AC-44)
  resolved_at       timestamptz,
  resolution_note   text
);
CREATE INDEX reconciliation_mismatches_status_idx ON reconciliation_mismatches (status);
CREATE INDEX reconciliation_mismatches_account_id_idx ON reconciliation_mismatches (account_id);

-- ----------------------------------------------------------------------------
-- 9. Audit log (NFR-8, AC-24) — immutable; records maker+checker+correlation id.
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text,
  actor_id       text,
  actor_role     text CHECK (actor_role IS NULL OR actor_role IN ('PARENT','ADMIN','ACCOUNTING')),
  action         text NOT NULL,
  entity_type    text NOT NULL,
  entity_id      uuid,
  maker_id       text,
  checker_id     text,
  payload        jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_correlation_id_idx ON audit_log (correlation_id);

-- ----------------------------------------------------------------------------
-- 10. Evolve ledger_entries with typed source links + correlation (kept append-only).
--     Deferred to the end so charges/refunds/adjustments already exist (circular FK).
-- ----------------------------------------------------------------------------
ALTER TABLE ledger_entries
  ADD COLUMN charge_id      uuid REFERENCES charges (id),
  ADD COLUMN refund_id      uuid REFERENCES refunds (id),
  ADD COLUMN adjustment_id  uuid REFERENCES adjustments (id),
  ADD COLUMN correlation_id text;
CREATE INDEX ledger_entries_charge_id_idx ON ledger_entries (charge_id);

-- Down Migration

ALTER TABLE ledger_entries
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS adjustment_id,
  DROP COLUMN IF EXISTS refund_id,
  DROP COLUMN IF EXISTS charge_id;

DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS reconciliation_mismatches;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS dunning_overrides;
DROP TABLE IF EXISTS dunning_notifications;
DROP TABLE IF EXISTS dunning_state;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS disbursements;
DROP TABLE IF EXISTS adjustment_batch_entries;
DROP TABLE IF EXISTS adjustments;
DROP TABLE IF EXISTS adjustment_batches;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS payment_allocations;
DROP TABLE IF EXISTS operator_events;
DROP TABLE IF EXISTS payment_intents;

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
