import { Money } from '#payments/ledger/domain/model/Money';
import { CurrencyMismatchError } from '#payments/ledger/domain/Errors';
import type { RepositoryBundle } from '#payments/ledger/domain/port/UnitOfWork';
import type { ChargeRepository } from '#payments/charges/domain/port/ChargeRepository';

export interface RecordPaymentInput {
  accountId: string;
  amount: Money;
  operatorReference: string | null;
  idempotencyKey: string;
}

export interface RecordedPayment {
  paymentId: string;
  balance: Money;
  replayed: boolean;
}

/**
 * The shared record-and-allocate core, run inside an already-open transaction.
 * Idempotent on `payments.idempotency_key`: a repeated key returns the original
 * payment with no second entry. Both `PaymentHub.recordPayment` (manual/back-office
 * path) and the inbox relay (authoritative operator confirmations) call this, so
 * neither can double-record (tech-spec Decision 6/7). Appends a positive PAYMENT
 * ledger entry, moves the balance, then allocates oldest-first — all on `repos`.
 */
export async function recordAndAllocate(
  repos: RepositoryBundle,
  input: RecordPaymentInput,
): Promise<RecordedPayment> {
  const existing = await repos.payments.findPaymentByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    const balance =
      (await repos.payments.getBalance(existing.accountId)) ?? Money.zero(input.amount.currency);
    return { paymentId: existing.id, balance, replayed: true };
  }

  // May throw DuplicateIdempotencyKeyError on a concurrent unique-violation; not
  // caught here — a 23505 aborts the transaction, so the caller retries as a replay
  // from a fresh transaction (see PaymentHub / InboxRelay).
  const payment = await repos.payments.insertPayment({
    accountId: input.accountId,
    amount: input.amount,
    operatorReference: input.operatorReference,
    idempotencyKey: input.idempotencyKey,
  });

  await repos.payments.appendLedgerEntry({
    accountId: input.accountId,
    type: 'PAYMENT',
    amount: input.amount,
    reference: payment.id,
    paymentId: payment.id,
  });

  const balance = await repos.payments.incrementBalance(input.accountId, input.amount);

  await allocateOldestFirst(repos.charges, input.accountId, payment.id, input.amount);

  return { paymentId: payment.id, balance, replayed: false };
}

/**
 * Allocates a payment across the account's open charges oldest-first. The charges
 * are locked `FOR UPDATE` (AC-20, PR-008) so concurrent payments cannot
 * over-allocate. A fully-covered charge transitions PENDING → SETTLED (AC-11). Any
 * remainder is left as positive balance (credit, INV-5) — no entry is posted.
 * Ledger-neutral: does not modify the balance.
 */
export async function allocateOldestFirst(
  charges: ChargeRepository,
  accountId: string,
  paymentId: string,
  payment: Money,
): Promise<void> {
  const openCharges = await charges.findOpenChargesByAccountForUpdate(accountId);
  let remaining = payment.amountMinor;

  for (const charge of openCharges) {
    if (remaining <= 0n) break;
    // App-enforced currency match (PR-S3); cannot occur under PLN-only M1.
    if (charge.currency !== payment.currency) {
      throw new CurrencyMismatchError(payment.currency, charge.currency);
    }

    const settled = await charges.sumAllocationsForCharge(charge.id);
    const outstanding = charge.grossMinor - settled;
    if (outstanding <= 0n) continue; // defensive: already covered

    const applied = remaining < outstanding ? remaining : outstanding;
    await charges.insertAllocation({
      paymentId,
      chargeId: charge.id,
      amount: Money.of(applied, payment.currency),
    });
    if (applied >= outstanding) {
      await charges.updateStatus(charge.id, 'SETTLED');
    }
    remaining -= applied;
  }
}
