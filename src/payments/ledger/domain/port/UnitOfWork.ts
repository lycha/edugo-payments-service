import type { PaymentRepository } from './PaymentRepository';
import type { OperatorEventRepository } from './OperatorEventRepository';
import type { ChargeRepository } from '#payments/charges/domain/port/ChargeRepository';

/**
 * Transaction-bound repository bundle. All repos share the *same* database
 * transaction, so a charge (or an allocation), the inbox mark-processed, and the
 * ledger effect commit atomically. See the tech spec, Decision 1/3.
 */
export interface RepositoryBundle {
  payments: PaymentRepository;
  charges: ChargeRepository;
  operatorEvents: OperatorEventRepository;
}

/** Driven port: runs `work` inside a single database transaction. */
export interface UnitOfWork {
  withTransaction<T>(work: (repos: RepositoryBundle) => Promise<T>): Promise<T>;
}
