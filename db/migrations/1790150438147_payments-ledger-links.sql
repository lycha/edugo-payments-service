-- Up Migration
-- Payments feature — LEDGER LINKS & append-only hardening (part 3 of 3).
-- Runs last: charges (part 1) already exist for the ledger_entries FK, and the
-- append-only guard is applied only after all inserts of the base data model are set up.
-- ledger_entries points only at the charge it realises; correction links live on the
-- correction rows (PR-S5), so ledger_entries is only ever INSERTed, never UPDATEd.

ALTER TABLE ledger_entries
  ADD COLUMN charge_id      uuid REFERENCES charges (id),
  ADD COLUMN correlation_id text;
CREATE INDEX ledger_entries_charge_id_idx ON ledger_entries (charge_id);

-- Bring pre-existing base currency columns in line with the shape check (PR-S8).
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_currency_len_chk CHECK (char_length(currency) = 3);
ALTER TABLE account_balances
  ADD CONSTRAINT account_balances_currency_len_chk CHECK (char_length(currency) = 3);

-- Append-only enforcement on the ledger (INV-4, PR-S9).
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Down Migration

DROP TRIGGER IF EXISTS ledger_entries_append_only ON ledger_entries;
ALTER TABLE account_balances DROP CONSTRAINT IF EXISTS account_balances_currency_len_chk;
ALTER TABLE ledger_entries DROP CONSTRAINT IF EXISTS ledger_entries_currency_len_chk;
ALTER TABLE ledger_entries
  DROP COLUMN IF EXISTS correlation_id,
  DROP COLUMN IF EXISTS charge_id;
