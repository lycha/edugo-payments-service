import { Money } from './model/Money';
import { AccountNotFoundError, DuplicateIdempotencyKeyError } from './Errors';
import type { UnitOfWork } from './port/UnitOfWork';
import type { PaymentRepository } from './port/PaymentRepository';

export interface RecordPaymentCommand {
  accountId: string;
  amountMinor: bigint;
  currency: string;
  operatorReference: string | null;
  idempotencyKey: string;
}

export interface RecordPaymentResult {
  paymentId: string;
  accountId: string;
  balanceMinor: bigint;
  currency: string;
  replayed: boolean;
}

/**
 * Domain service (facade) for the payments context. Orchestrates use cases over
 * the domain ports; the incoming HTTP adapter calls into it.
 */
export class PaymentHub {
  constructor(private readonly deps: { unitOfWork: UnitOfWork }) {}

  /**
   * Records a payment: appends a PAYMENT ledger entry and updates the balance
   * atomically. Idempotent — a repeated key returns the original result without
   * posting a second entry (INV: balance == sum of entries).
   */
  async recordPayment(cmd: RecordPaymentCommand): Promise<RecordPaymentResult> {
    const amount = Money.of(cmd.amountMinor, cmd.currency);

    return this.deps.unitOfWork.withTransaction(async (repo) => {
      if (!(await repo.accountExists(cmd.accountId))) {
        throw new AccountNotFoundError(cmd.accountId);
      }

      const replay = await this.tryReplay(repo, cmd);
      if (replay) return replay;

      let payment: { id: string };
      try {
        payment = await repo.insertPayment({
          accountId: cmd.accountId,
          amount,
          operatorReference: cmd.operatorReference,
          idempotencyKey: cmd.idempotencyKey,
        });
      } catch (err) {
        // Concurrent request won the unique constraint — treat as replay.
        if (err instanceof DuplicateIdempotencyKeyError) {
          const replayed = await this.tryReplay(repo, cmd);
          if (replayed) return replayed;
        }
        throw err;
      }

      await repo.appendLedgerEntry({
        accountId: cmd.accountId,
        type: 'PAYMENT',
        amount,
        reference: payment.id,
        paymentId: payment.id,
      });

      const balance = await repo.incrementBalance(cmd.accountId, amount);

      return {
        paymentId: payment.id,
        accountId: cmd.accountId,
        balanceMinor: balance.amountMinor,
        currency: balance.currency,
        replayed: false,
      };
    });
  }

  private async tryReplay(
    repo: PaymentRepository,
    cmd: RecordPaymentCommand,
  ): Promise<RecordPaymentResult | null> {
    const existing = await repo.findPaymentByIdempotencyKey(cmd.idempotencyKey);
    if (!existing) return null;
    const balance = (await repo.getBalance(existing.accountId)) ?? Money.zero(cmd.currency);
    return {
      paymentId: existing.id,
      accountId: existing.accountId,
      balanceMinor: balance.amountMinor,
      currency: balance.currency,
      replayed: true,
    };
  }
}
