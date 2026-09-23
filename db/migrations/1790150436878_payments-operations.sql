-- Up Migration
-- Payments feature — OPERATIONS (part 2 of 3): corrections under maker/checker,
-- invoicing, dunning, reconciliation, audit log. Depends on payments-core.
-- Correction rows link to their reversing ledger entry via ledger_entry_id (PR-S5);
-- ledger_entries itself is evolved in part 3.

-- 5. Corrections: refunds, adjustments (+ batches), disbursements.
CREATE TABLE refunds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id     uuid NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING_APPROVAL'
                 CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED')),
  auto_approved  boolean NOT NULL DEFAULT false,
  maker_id       text NOT NULL,
  checker_id     text,
  correlation_id text,
  idempotency_key text NOT NULL,
  ledger_entry_id uuid REFERENCES ledger_entries (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CONSTRAINT refunds_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT refunds_no_self_approval_chk CHECK (checker_id IS NULL OR checker_id <> maker_id)
);
CREATE INDEX refunds_payment_id_idx ON refunds (payment_id);

CREATE TABLE adjustment_batches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dry_run           boolean NOT NULL,
  status            text NOT NULL DEFAULT 'DRY_RUN'
                    CHECK (status IN ('DRY_RUN','PENDING_SENIOR_APPROVAL','APPROVED','EXECUTED','REJECTED')),
  reason            text NOT NULL,
  senior_approver_id text,
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  CONSTRAINT adjustment_batches_idempotency_key_uniq UNIQUE (idempotency_key)
);

CREATE TABLE adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  amount_minor   bigint NOT NULL,
  currency       text NOT NULL CHECK (char_length(currency) = 3),
  reason         text NOT NULL,
  status         text NOT NULL DEFAULT 'PENDING_APPROVAL'
                 CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','EXECUTED')),
  maker_id       text NOT NULL,
  checker_id     text,
  correlation_id text,
  idempotency_key text NOT NULL,
  batch_id       uuid REFERENCES adjustment_batches (id),
  ledger_entry_id uuid REFERENCES ledger_entries (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CONSTRAINT adjustments_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT adjustments_no_self_approval_chk CHECK (checker_id IS NULL OR checker_id <> maker_id)
);
CREATE INDEX adjustments_account_id_idx ON adjustments (account_id);
CREATE INDEX adjustments_batch_id_idx ON adjustments (batch_id);

CREATE TABLE adjustment_batch_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id     uuid NOT NULL REFERENCES adjustment_batches (id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts (id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL,
  outcome      text NOT NULL CHECK (outcome IN ('WOULD_APPLY','APPLIED','REJECTED')),
  detail       text
);
CREATE INDEX adjustment_batch_entries_batch_id_idx ON adjustment_batch_entries (batch_id);
CREATE INDEX adjustment_batch_entries_account_id_idx ON adjustment_batch_entries (account_id);

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
  idempotency_key text NOT NULL,
  ledger_entry_id uuid REFERENCES ledger_entries (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  CONSTRAINT disbursements_idempotency_key_uniq UNIQUE (idempotency_key),
  CONSTRAINT disbursements_no_self_approval_chk CHECK (checker_id IS NULL OR checker_id <> maker_id)
);
CREATE INDEX disbursements_account_id_idx ON disbursements (account_id);

-- 6. Invoicing (AC-29/33/50, NFR-7).
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
  student_id     text,
  enrollment_ref text,
  net_minor      bigint NOT NULL CHECK (net_minor >= 0),
  tax_minor      bigint NOT NULL CHECK (tax_minor >= 0),
  gross_minor    bigint NOT NULL CHECK (gross_minor >= 0),
  tax_rate       numeric(6,4) NOT NULL,
  tax_treatment  text NOT NULL CHECK (tax_treatment IN ('STANDARD','REDUCED','ZERO_RATED','EXEMPT')),
  tax_legal_reason text,
  tax_jurisdiction text NOT NULL,
  CONSTRAINT invoice_lines_total_chk CHECK (gross_minor = net_minor + tax_minor),
  CONSTRAINT invoice_lines_tax_legal_reason_chk
    CHECK (tax_treatment NOT IN ('EXEMPT', 'ZERO_RATED') OR tax_legal_reason IS NOT NULL)
);
CREATE INDEX invoice_lines_invoice_id_idx ON invoice_lines (invoice_id);
CREATE INDEX invoice_lines_charge_id_idx ON invoice_lines (charge_id);

-- 7. Dunning (AC-16/41/42/43).
CREATE TABLE dunning_state (
  account_id       uuid PRIMARY KEY REFERENCES accounts (id) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'NONE' CHECK (status IN ('NONE','IN_DUNNING','BLOCKED')),
  access_blocked   boolean NOT NULL DEFAULT false,
  current_step     text CHECK (current_step IN ('DAY_0','DAY_3','DAY_7','DAY_10','DAY_14_BLOCK')),
  messages_sent_this_cycle smallint NOT NULL DEFAULT 0
                   CHECK (messages_sent_this_cycle BETWEEN 0 AND 5),
  cycle_started_at timestamptz,
  next_action_at   timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dunning_state_next_action_idx ON dunning_state (next_action_at);
CREATE TRIGGER dunning_state_set_updated_at BEFORE UPDATE ON dunning_state
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

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

-- 8. Reconciliation (AC-37/44).
CREATE TABLE settlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator           text NOT NULL,
  settlement_window  text NOT NULL,
  payout_total_minor bigint,
  currency           text CHECK (currency IS NULL OR char_length(currency) = 3),
  raw                jsonb,
  ingested_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT settlements_operator_window_uniq UNIQUE (operator, settlement_window)
);

CREATE TABLE reconciliation_mismatches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL,
  status            text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  severity          text CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  account_id        uuid REFERENCES accounts (id),
  payment_id        uuid REFERENCES payments (id),
  drift_minor       bigint,
  settlement_window text,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolution_note   text
);
CREATE INDEX reconciliation_mismatches_status_idx ON reconciliation_mismatches (status);
CREATE INDEX reconciliation_mismatches_account_id_idx ON reconciliation_mismatches (account_id);
CREATE INDEX reconciliation_mismatches_payment_id_idx ON reconciliation_mismatches (payment_id);

-- 9. Audit log (NFR-8, AC-24) — append-only.
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
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Down Migration

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS reconciliation_mismatches;
DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS dunning_overrides;
DROP TABLE IF EXISTS dunning_notifications;
DROP TRIGGER IF EXISTS dunning_state_set_updated_at ON dunning_state;
DROP TABLE IF EXISTS dunning_state;
DROP TABLE IF EXISTS invoice_lines;
DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS disbursements;
DROP TABLE IF EXISTS adjustment_batch_entries;
DROP TABLE IF EXISTS adjustments;
DROP TABLE IF EXISTS adjustment_batches;
DROP TABLE IF EXISTS refunds;
