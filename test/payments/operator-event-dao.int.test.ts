import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { startTestDatabase, type TestDatabase } from '../setup/postgres';
import { createDb } from '../../src/platform/db/database';
import { OperatorEventDao } from '../../src/payments/ledger/adapter/storage/OperatorEventDao';
import { PaymentDao } from '../../src/payments/ledger/adapter/storage/PaymentDao';
import { MockPayUOperator } from '../../src/payments/ledger/adapter/operator/MockPayUOperator';
import { seedAccount, seedPaymentIntent, buildPayUEvent, TEST_OPERATOR_SECRET } from '../setup/payu';
import type { DB } from '#generated/platform/db/schema';

let testDb: TestDatabase;
let db: Kysely<DB>;

beforeAll(async () => {
  testDb = await startTestDatabase();
  db = createDb(testDb.connectionString);
});

afterAll(async () => {
  await db?.destroy();
  await testDb?.container.stop();
});

describe('MockPayUOperator (abzp)', () => {
  const operator = new MockPayUOperator({ operatorWebhookSecret: TEST_OPERATOR_SECRET });

  it('verifies a signature made with the right secret and rejects a wrong one', () => {
    const { raw, signature } = buildPayUEvent({ extOrderId: randomUUID(), amountMinor: 15_000n });
    expect(operator.verifySignature(raw, signature)).toBe(true);
    expect(operator.verifySignature(raw, 'deadbeef')).toBe(false);
    expect(operator.verifySignature(raw, undefined)).toBe(false);
    // A body tampered after signing must fail.
    expect(operator.verifySignature(raw + ' ', signature)).toBe(false);
  });

  it('parses amount as string → bigint and resolves the operator fields', () => {
    const { body } = buildPayUEvent({ extOrderId: 'intent-123', amountMinor: 15_000n, orderId: 'ORD-1' });
    const parsed = operator.parse((body as { payload: unknown }).payload);
    expect(parsed).toEqual({
      operatorReference: 'ORD-1',
      correlationRef: 'intent-123',
      status: 'COMPLETED',
      amountMinor: 15_000n,
      currency: 'PLN',
    });
  });

  it('rejects a payload whose amount is a JS number (precision guard)', () => {
    expect(() => operator.parse({ order: { orderId: 'x', extOrderId: 'y', status: 'COMPLETED', currencyCode: 'PLN', totalAmount: 15000 } })).toThrow();
  });
});

describe('OperatorEventDao (abzp)', () => {
  it('dedupes on (operator, operatorEventId): second insert is surfaced as duplicate', async () => {
    const dao = new OperatorEventDao(db);
    const eventId = `ORD-${randomUUID()}:COMPLETED`;
    const first = await dao.insertReceived({
      operator: 'payu',
      operatorEventId: eventId,
      eventType: 'ORDER_COMPLETED',
      payload: { order: { orderId: 'x' } },
      signatureVerified: true,
    });
    const second = await dao.insertReceived({
      operator: 'payu',
      operatorEventId: eventId,
      eventType: 'ORDER_COMPLETED',
      payload: { order: { orderId: 'x' } },
      signatureVerified: true,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);

    const rows = await db
      .selectFrom('operator_events')
      .select('id')
      .where('operator_event_id', '=', eventId)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('claimDueOne returns rows oldest-first and skips a row already locked in another txn', async () => {
    const dao = new OperatorEventDao(db);
    // claimDueOne is global (oldest-first across the whole inbox), so this test needs a
    // known global state. Start from an empty inbox — nothing else references
    // operator_events rows, and no later test in this file depends on them.
    await db.deleteFrom('operator_events').execute();

    const tag = `CLAIM-${randomUUID()}`;
    const older = await dao.insertReceived({ operator: tag, operatorEventId: 'a', eventType: null, payload: {}, signatureVerified: true });
    await new Promise((r) => setTimeout(r, 10));
    const younger = await dao.insertReceived({ operator: tag, operatorEventId: 'b', eventType: null, payload: {}, signatureVerified: true });

    // Hold the oldest row locked inside an open transaction, then a concurrent claim
    // (SKIP LOCKED) must skip it and return the younger row — never block or double-claim.
    await db.transaction().execute(async (trx) => {
      const claimedInTx = await new OperatorEventDao(trx).claimDueOne(new Date());
      expect(claimedInTx?.id).toBe(older.id); // oldest-first

      const concurrent = await new OperatorEventDao(db).claimDueOne(new Date());
      expect(concurrent?.id).toBe(younger.id); // skipped the locked older row
    });
  });
});

describe('PaymentDao.findAccountByPaymentIntent (abzp — account resolution)', () => {
  it('resolves a known extOrderId to its account + amount, and returns null for an unknown one', async () => {
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 15_000n });
    const dao = new PaymentDao(db);

    const resolved = await dao.findAccountByPaymentIntent(intentId);
    expect(resolved).toEqual({ accountId, amountMinor: 15_000n, currency: 'PLN', status: 'CREATED' });

    // Unknown, and a non-UUID string, both resolve to null (never a uuid-parse error).
    expect(await dao.findAccountByPaymentIntent(randomUUID())).toBeNull();
    expect(await dao.findAccountByPaymentIntent('not-a-uuid')).toBeNull();
  });
});
