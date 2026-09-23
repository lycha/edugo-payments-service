import type { Kysely } from 'kysely';
import type { DB } from '#generated/platform/db/schema';
import type { UnitOfWork, RepositoryBundle } from '../../domain/port/UnitOfWork';
import { PaymentDao } from './PaymentDao';
import { OperatorEventDao } from './OperatorEventDao';
import { ChargeDao } from '#payments/charges/adapter/storage/ChargeDao';

/**
 * Storage adapter implementing the UnitOfWork port. Opens one Kysely transaction
 * and hands the work a transaction-bound repository bundle — a PaymentDao and a
 * ChargeDao built on the *same* transaction — so payment, ledger, charge and
 * allocation writes commit atomically.
 */
export class PaymentRepositoryDB implements UnitOfWork {
  constructor(private readonly deps: { db: Kysely<DB> }) {}

  async withTransaction<T>(work: (repos: RepositoryBundle) => Promise<T>): Promise<T> {
    return this.deps.db.transaction().execute((trx) =>
      work({
        payments: new PaymentDao(trx),
        charges: new ChargeDao(trx),
        operatorEvents: new OperatorEventDao(trx),
      }),
    );
  }
}
