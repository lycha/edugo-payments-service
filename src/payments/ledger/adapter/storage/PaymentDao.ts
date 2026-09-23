import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '#generated/platform/db/schema';
import type { PaymentRepository } from '../../domain/port/PaymentRepository';
import type { LedgerEntryType } from '../../domain/model/LedgerEntryType';
import { Money } from '../../domain/model/Money';
import { DuplicateIdempotencyKeyError } from '../../domain/Errors';

export type Executor = Kysely<DB> | Transaction<DB>;

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

/** Kysely data-access object implementing the PaymentRepository port, bound to
 *  a single executor (connection or transaction). */
export class PaymentDao implements PaymentRepository {
  constructor(private readonly db: Executor) {}

  async accountExists(accountId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('accounts')
      .select('id')
      .where('id', '=', accountId)
      .executeTakeFirst();
    return row !== undefined;
  }

  async findPaymentByIdempotencyKey(key: string): Promise<{ id: string; accountId: string } | null> {
    const row = await this.db
      .selectFrom('payments')
      .select(['id', 'account_id'])
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    return row ? { id: row.id, accountId: row.account_id } : null;
  }

  async insertPayment(input: {
    accountId: string;
    amount: Money;
    operatorReference: string | null;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    try {
      const row = await this.db
        .insertInto('payments')
        .values({
          account_id: input.accountId,
          amount_minor: input.amount.amountMinor.toString(),
          currency: input.amount.currency,
          operator_reference: input.operatorReference,
          idempotency_key: input.idempotencyKey,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { id: row.id };
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateIdempotencyKeyError(input.idempotencyKey);
      throw err;
    }
  }

  async appendLedgerEntry(entry: {
    accountId: string;
    type: LedgerEntryType;
    amount: Money;
    reference: string | null;
    paymentId: string | null;
  }): Promise<void> {
    await this.db
      .insertInto('ledger_entries')
      .values({
        account_id: entry.accountId,
        entry_type: entry.type,
        amount_minor: entry.amount.amountMinor.toString(),
        currency: entry.amount.currency,
        reference: entry.reference,
        payment_id: entry.paymentId,
      })
      .execute();
  }

  async getBalance(accountId: string): Promise<Money | null> {
    const row = await this.db
      .selectFrom('account_balances')
      .select(['balance_minor', 'currency'])
      .where('account_id', '=', accountId)
      .executeTakeFirst();
    return row ? Money.of(BigInt(row.balance_minor), row.currency) : null;
  }

  async incrementBalance(accountId: string, delta: Money): Promise<Money> {
    const amount = delta.amountMinor.toString();
    const row = await this.db
      .insertInto('account_balances')
      .values({ account_id: accountId, balance_minor: amount, currency: delta.currency })
      .onConflict((oc) =>
        oc.column('account_id').doUpdateSet({
          balance_minor: sql`${sql.ref('account_balances.balance_minor')} + ${amount}::bigint`,
          updated_at: sql`now()`,
        }),
      )
      .returning(['balance_minor', 'currency'])
      .executeTakeFirstOrThrow();
    return Money.of(BigInt(row.balance_minor), row.currency);
  }
}
