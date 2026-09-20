import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { startTestDatabase, type TestDatabase } from '../setup/postgres';
import { createDb } from '../../src/platform/db/database';
import { buildContainer } from '../../src/platform/container';
import type { DB } from '#generated/platform/db/schema';

let testDb: TestDatabase;
let db: Kysely<DB>;
let container: ReturnType<typeof buildContainer>;

beforeAll(async () => {
  testDb = await startTestDatabase();
  db = createDb(testDb.connectionString);
  container = buildContainer(db);
});

afterAll(async () => {
  await db?.destroy();
  await testDb?.container.stop();
});

async function seedAccount(): Promise<string> {
  const row = await db
    .insertInto('accounts')
    .values({ external_ref: randomUUID() })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

describe('PaymentHub.recordPayment', () => {
  it('records a payment, appends one PAYMENT entry, and updates the balance', async () => {
    const accountId = await seedAccount();
    const hub = container.resolve('paymentHub');
    const key = randomUUID();

    const first = await hub.recordPayment({
      accountId,
      amountMinor: 12_000n,
      currency: 'PLN',
      operatorReference: 'op-1',
      idempotencyKey: key,
    });

    expect(first.replayed).toBe(false);
    expect(first.balanceMinor).toBe(12_000n);

    const entries = await db
      .selectFrom('ledger_entries')
      .selectAll()
      .where('account_id', '=', accountId)
      .execute();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry_type).toBe('PAYMENT');

    // INV-1: balance == sum of ledger entries.
    const sum = entries.reduce((acc, e) => acc + BigInt(e.amount_minor), 0n);
    expect(sum).toBe(12_000n);
  });

  it('is idempotent: replaying the same key posts no second entry', async () => {
    const accountId = await seedAccount();
    const hub = container.resolve('paymentHub');
    const key = randomUUID();
    const cmd = {
      accountId,
      amountMinor: 5_000n,
      currency: 'PLN',
      operatorReference: 'op-2',
      idempotencyKey: key,
    };

    const first = await hub.recordPayment(cmd);
    const second = await hub.recordPayment(cmd);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.balanceMinor).toBe(5_000n);

    const count = await db
      .selectFrom('ledger_entries')
      .select('id')
      .where('account_id', '=', accountId)
      .execute();
    expect(count).toHaveLength(1);
  });
});
