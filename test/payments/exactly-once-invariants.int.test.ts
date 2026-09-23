import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '../setup/postgres';
import { createDb } from '../../src/platform/db/database';
import { buildContainer } from '../../src/platform/container';
import { buildServer } from '../../src/platform/http/server';
import { seedAccount, seedPaymentIntent, buildPayUEvent, type BuiltPayUEvent } from '../setup/payu';
import type { DB } from '#generated/platform/db/schema';

// End-to-end exactly-once invariants (csfz): ingest over HTTP → relay, asserting
// INV-1 (balance == Σ ledger), INV-2 (apply at most once), INV-3 (no unmatched PAYMENT).

let testDb: TestDatabase;
let db: Kysely<DB>;
let app: FastifyInstance;
let container: ReturnType<typeof buildContainer>;

beforeAll(async () => {
  testDb = await startTestDatabase();
  db = createDb(testDb.connectionString);
  container = buildContainer(db);
  app = await buildServer(container);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await db?.destroy();
  await testDb?.container.stop();
});

function ingest(evt: BuiltPayUEvent) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/operator-events/payu',
    headers: { 'content-type': 'application/json', 'x-signature': evt.signature },
    payload: evt.raw,
  });
}

function relay() {
  return container.resolve('inboxRelay').runInboxRelayOnce();
}

async function ledgerFor(accountId: string) {
  return db.selectFrom('ledger_entries').selectAll().where('account_id', '=', accountId).execute();
}

async function assertBalanceEqualsLedger(accountId: string): Promise<bigint> {
  const entries = await ledgerFor(accountId);
  const sum = entries.reduce((acc, e) => acc + BigInt(e.amount_minor), 0n);
  const balance = await db
    .selectFrom('account_balances')
    .select('balance_minor')
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  // INV-1: balance == Σ ledger entries (0 with no balance row yet).
  expect(BigInt(balance?.balance_minor ?? '0')).toBe(sum);
  return sum;
}

describe('Exactly-once operator ingestion — invariants (csfz)', () => {
  it('INV-2: a confirmation delivered twice yields exactly one PAYMENT entry', async () => {
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 15_000n });
    const evt = buildPayUEvent({ extOrderId: intentId, amountMinor: 15_000n });

    const first = await ingest(evt);
    const second = await ingest(evt); // redelivery
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200); // ingest dedup

    await relay();
    await relay(); // apply again — must be a no-op

    const payments = await ledgerFor(accountId);
    expect(payments.filter((e) => e.entry_type === 'PAYMENT')).toHaveLength(1);
  });

  it('INV-1: the balance equals the sum of ledger entries after applying', async () => {
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 20_000n });
    await ingest(buildPayUEvent({ extOrderId: intentId, amountMinor: 20_000n }));

    await relay();

    const sum = await assertBalanceEqualsLedger(accountId);
    expect(sum).toBe(20_000n);
  });

  it('INV-3: an unconfirmed charge is never recorded as paid', async () => {
    // Seed an account + intent but deliver NO operator event.
    const accountId = await seedAccount(db);
    await seedPaymentIntent(db, { accountId, amountMinor: 30_000n });

    await relay();

    expect(await ledgerFor(accountId)).toHaveLength(0);
    await assertBalanceEqualsLedger(accountId); // 0 == 0
  });

  it('INV-3: an event that resolves to no account writes no PAYMENT and dead-letters', async () => {
    const evt = buildPayUEvent({ extOrderId: `orphan-${randomUUID()}`, amountMinor: 30_000n });
    expect((await ingest(evt)).statusCode).toBe(202); // verified + queued

    await relay();

    const row = await db
      .selectFrom('operator_events')
      .selectAll()
      .where('operator_event_id', '=', evt.operatorEventId)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('DEAD');
    expect(row.payment_id).toBeNull();

    const payment = await db
      .selectFrom('payments')
      .select('id')
      .where('idempotency_key', '=', `payu:${evt.orderId}:COMPLETED`)
      .executeTakeFirst();
    expect(payment).toBeUndefined();
  });
});
