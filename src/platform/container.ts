import { createContainer, asClass, asValue, InjectionMode, type AwilixContainer } from 'awilix';
import type { Kysely } from 'kysely';
import type { DB } from '#generated/platform/db/schema';
import { PaymentRepositoryDB } from '../payments/ledger/adapter/storage/PaymentRepositoryDB';
import { PaymentHub } from '../payments/application/PaymentHub';

export interface Cradle {
  db: Kysely<DB>;
  unitOfWork: PaymentRepositoryDB;
  paymentHub: PaymentHub;
}

/** Composition root. PROXY injection resolves constructor deps by name. */
export function buildContainer(db: Kysely<DB>): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    db: asValue(db),
    unitOfWork: asClass(PaymentRepositoryDB).singleton(),
    paymentHub: asClass(PaymentHub).singleton(),
  });

  return container;
}
