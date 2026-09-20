import type { Kysely } from 'kysely';
import type { DB } from '#generated/platform/db/schema';
import type { UnitOfWork } from '../../domain/port/UnitOfWork';
import type { PaymentRepository } from '../../domain/port/PaymentRepository';
import { PaymentDao } from './PaymentDao';

/**
 * Storage adapter implementing the UnitOfWork port. Opens one Kysely transaction
 * and hands the work a transaction-bound PaymentRepository (PaymentDao).
 */
export class PaymentRepositoryDB implements UnitOfWork {
  constructor(private readonly deps: { db: Kysely<DB> }) {}

  async withTransaction<T>(work: (repo: PaymentRepository) => Promise<T>): Promise<T> {
    return this.deps.db.transaction().execute((trx) => work(new PaymentDao(trx)));
  }
}
