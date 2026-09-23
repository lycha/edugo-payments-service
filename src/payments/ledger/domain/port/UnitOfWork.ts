import type { PaymentRepository } from './PaymentRepository';
import type { ChargeRepository } from '#payments/charges/domain/port/ChargeRepository';

/**
 * Transaction-bound repository bundle. Both repos share the *same* database
 * transaction, so a charge (or an allocation) and its ledger effect commit
 * atomically. See the tech spec, Decision 1.
 */
export interface RepositoryBundle {
  payments: PaymentRepository;
  charges: ChargeRepository;
}

/** Driven port: runs `work` inside a single database transaction. */
export interface UnitOfWork {
  withTransaction<T>(work: (repos: RepositoryBundle) => Promise<T>): Promise<T>;
}
