import type { Money } from '#payments/ledger/domain/model/Money';
import type { ChargeStatus } from '../model/ChargeStatus';
import type { TaxBreakdown, TaxTreatment } from '../model/TaxBreakdown';
import type { ChargeRecord } from '../model/Charge';

/** A tax-rate row resolved from the effective-dated `tax_rates` table (AC-32). */
export interface TaxRateRow {
  rate: string;
  treatment: TaxTreatment;
  legalReason: string | null;
}

/**
 * Driven port for charge & allocation persistence. Implemented by an adapter
 * under adapter/storage and executed within the {@link UnitOfWork} transaction
 * alongside the {@link PaymentRepository}.
 */
export interface ChargeRepository {
  /** Resolves the owning account (and student) from an enrollment, or null. */
  findAccountByEnrollment(
    enrollmentId: string,
  ): Promise<{ accountId: string; studentId: string } | null>;

  /**
   * Looks up the effective-dated tax rate for `(jurisdiction, category)` on the
   * given day (AC-32), or null when none matches. The tax *math* lives in the
   * domain ({@link TaxBreakdown}); this is only the lookup.
   */
  resolveTaxRate(input: {
    jurisdiction: string;
    category: string;
    on: Date;
  }): Promise<TaxRateRow | null>;

  findChargeByIdempotencyKey(key: string): Promise<ChargeRecord | null>;

  findChargeById(chargeId: string): Promise<ChargeRecord | null>;

  /** Inserts a PENDING charge. Duplicate idempotency key → DuplicateIdempotencyKeyError. */
  insertCharge(input: {
    accountId: string;
    enrollmentId: string;
    studentId: string | null;
    currency: string;
    tax: TaxBreakdown;
    idempotencyKey: string;
  }): Promise<{ id: string }>;

  /** Open (PENDING) charges for an account, oldest-first (created_at asc). */
  findOpenChargesByAccount(accountId: string): Promise<ChargeRecord[]>;

  /**
   * Open (PENDING) charges for an account, oldest-first, row-locked
   * `SELECT … FOR UPDATE` so concurrent payments cannot over-allocate (AC-20,
   * PR-008). Must run inside a transaction.
   */
  findOpenChargesByAccountForUpdate(accountId: string): Promise<ChargeRecord[]>;

  /**
   * A page of an account's charges, oldest-first, optionally filtered by status,
   * each paired with the amount already allocated to it — so the caller derives
   * outstanding without a per-charge query (no N+1). Returns up to `limit` rows.
   */
  listChargesByAccount(
    accountId: string,
    opts: { status?: ChargeStatus; limit: number; cursor?: string },
  ): Promise<Array<{ record: ChargeRecord; allocatedMinor: bigint }>>;

  updateStatus(chargeId: string, status: ChargeStatus): Promise<void>;

  /** Writes a payment→charge allocation (link only; posts no ledger entry). */
  insertAllocation(input: { paymentId: string; chargeId: string; amount: Money }): Promise<void>;

  /** Σ of allocations already applied to a charge (its settled-so-far amount). */
  sumAllocationsForCharge(chargeId: string): Promise<bigint>;

  /** True when the account exists (charges resolve the account via enrollment). */
  accountExists(accountId: string): Promise<boolean>;
}
