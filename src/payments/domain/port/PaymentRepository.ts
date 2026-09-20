import type { Money } from '../model/Money';
import type { LedgerEntryType } from '../model/LedgerEntryType';

/**
 * Driven port for payment persistence. Implemented by an adapter under
 * adapter/storage. Methods are executed within a single transaction supplied by
 * the {@link UnitOfWork}.
 */
export interface PaymentRepository {
  accountExists(accountId: string): Promise<boolean>;

  findPaymentByIdempotencyKey(key: string): Promise<{ id: string; accountId: string } | null>;

  insertPayment(input: {
    accountId: string;
    amount: Money;
    operatorReference: string | null;
    idempotencyKey: string;
  }): Promise<{ id: string }>;

  appendLedgerEntry(entry: {
    accountId: string;
    type: LedgerEntryType;
    amount: Money;
    reference: string | null;
    paymentId: string | null;
  }): Promise<void>;

  getBalance(accountId: string): Promise<Money | null>;

  /** Applies a signed delta and returns the new balance. */
  incrementBalance(accountId: string, delta: Money): Promise<Money>;
}
