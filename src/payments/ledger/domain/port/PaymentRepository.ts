import type { Money } from '../model/Money';
import type { LedgerEntryType } from '../model/LedgerEntryType';

/**
 * Driven port for payment persistence. Implemented by an adapter under
 * adapter/storage. Methods are executed within a single transaction supplied by
 * the {@link UnitOfWork}.
 */
export interface PaymentRepository {
  accountExists(accountId: string): Promise<boolean>;

  /**
   * Resolve a payment_intent (the operator correlation anchor) to its account,
   * expected amount, and status. Returns null when the intent id is unknown — the
   * relay then dead-letters the event rather than crediting a guessed account (INV-3).
   */
  findAccountByPaymentIntent(
    intentId: string,
  ): Promise<{ accountId: string; amountMinor: bigint; currency: string; status: string } | null>;

  /** Mark an intent CONFIRMED and link its payment, in the apply transaction. */
  confirmPaymentIntent(intentId: string, paymentId: string): Promise<void>;

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
