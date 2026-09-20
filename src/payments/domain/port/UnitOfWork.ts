import type { PaymentRepository } from './PaymentRepository';

/** Driven port: runs `work` inside a single database transaction. */
export interface UnitOfWork {
  withTransaction<T>(work: (repo: PaymentRepository) => Promise<T>): Promise<T>;
}
