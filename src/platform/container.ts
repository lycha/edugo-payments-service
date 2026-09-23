import { createContainer, asClass, asFunction, asValue, InjectionMode, type AwilixContainer } from 'awilix';
import type { Kysely } from 'kysely';
import type { DB } from '#generated/platform/db/schema';
import { PaymentRepositoryDB } from '../payments/ledger/adapter/storage/PaymentRepositoryDB';
import { PaymentHub } from '../payments/application/PaymentHub';
import { InboxRelay, type RelayLogger } from '../payments/application/InboxRelay';
import { MockPayUOperator } from '../payments/ledger/adapter/operator/MockPayUOperator';
import type { PaymentOperatorRegistry } from '../payments/ledger/domain/port/PaymentOperator';

export interface Cradle {
  db: Kysely<DB>;
  operatorWebhookSecret: string;
  logger: RelayLogger;
  unitOfWork: PaymentRepositoryDB;
  paymentHub: PaymentHub;
  mockPayUOperator: MockPayUOperator;
  paymentOperators: PaymentOperatorRegistry;
  inboxRelay: InboxRelay;
}

/** No-op structured logger; production passes the app's pino logger instead. */
const NO_OP_LOGGER: RelayLogger = { warn: () => {} };

export interface ContainerOptions {
  /** HMAC secret for operator webhooks (from the env loader in production). */
  operatorWebhookSecret?: string;
  /** Structured logger for background work (relay); defaults to a no-op in tests. */
  logger?: RelayLogger;
}

/** Composition root. PROXY injection resolves constructor deps by name. */
export function buildContainer(
  db: Kysely<DB>,
  opts: ContainerOptions = {},
): AwilixContainer<Cradle> {
  const container = createContainer<Cradle>({
    injectionMode: InjectionMode.PROXY,
    strict: true,
  });

  container.register({
    db: asValue(db),
    operatorWebhookSecret: asValue(opts.operatorWebhookSecret ?? 'dev-operator-webhook-secret'),
    logger: asValue(opts.logger ?? NO_OP_LOGGER),
    unitOfWork: asClass(PaymentRepositoryDB).singleton(),
    paymentHub: asClass(PaymentHub).singleton(),
    mockPayUOperator: asClass(MockPayUOperator).singleton(),
    // Registry keyed by operator name; the ingest handler and relay select by it.
    paymentOperators: asFunction(
      ({ mockPayUOperator }: Cradle): PaymentOperatorRegistry =>
        new Map([[mockPayUOperator.name, mockPayUOperator]]),
    ).singleton(),
    inboxRelay: asClass(InboxRelay).singleton(),
  });

  return container;
}
