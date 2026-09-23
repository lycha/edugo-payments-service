import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Kysely } from 'kysely';
import { startTestDatabase, type TestDatabase } from '../setup/postgres';
import { createDb } from '../../src/platform/db/database';
import { buildContainer } from '../../src/platform/container';
import { OperatorEventDao } from '../../src/payments/ledger/adapter/storage/OperatorEventDao';
import { seedAccount, seedPaymentIntent, buildPayUEvent } from '../setup/payu';
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

/** Enqueue a PENDING inbox row exactly as the ingest handler would (inner payload). */
async function enqueue(evt: ReturnType<typeof buildPayUEvent>): Promise<void> {
  await new OperatorEventDao(db).insertReceived({
    operator: 'payu',
    operatorEventId: evt.operatorEventId,
    eventType: 'ORDER_COMPLETED',
    payload: (evt.body as { payload: unknown }).payload,
    signatureVerified: true,
  });
}

async function ledgerFor(accountId: string) {
  return db.selectFrom('ledger_entries').selectAll().where('account_id', '=', accountId).execute();
}

async function eventRow(operatorEventId: string) {
  return db
    .selectFrom('operator_events')
    .selectAll()
    .where('operator_event_id', '=', operatorEventId)
    .executeTakeFirstOrThrow();
}

describe('InboxRelay.runInboxRelayOnce (9uk0)', () => {
  it('applies a COMPLETED confirmation exactly once: one PAYMENT + balance, row PROCESSED, intent CONFIRMED (INV-1)', async () => {
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 15_000n });
    const evt = buildPayUEvent({ extOrderId: intentId, amountMinor: 15_000n });
    await enqueue(evt);

    const counts = await container.resolve('inboxRelay').runInboxRelayOnce();
    expect(counts.processed).toBeGreaterThanOrEqual(1);

    const entries = await ledgerFor(accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry_type).toBe('PAYMENT');
    expect(BigInt(entries[0]!.amount_minor)).toBe(15_000n);

    const balance = await db.selectFrom('account_balances').select('balance_minor').where('account_id', '=', accountId).executeTakeFirstOrThrow();
    // INV-1: balance == Σ ledger entries.
    const sum = entries.reduce((acc, e) => acc + BigInt(e.amount_minor), 0n);
    expect(BigInt(balance.balance_minor)).toBe(sum);
    expect(sum).toBe(15_000n);

    const row = await eventRow(evt.operatorEventId);
    expect(row.status).toBe('PROCESSED');
    expect(row.payment_id).not.toBeNull();

    // Payment carries the operator reference and the operator-qualified idempotency key.
    const payment = await db.selectFrom('payments').selectAll().where('id', '=', row.payment_id!).executeTakeFirstOrThrow();
    expect(payment.operator_reference).toBe(evt.orderId);
    expect(payment.idempotency_key).toBe(`payu:${evt.orderId}:COMPLETED`);

    // The intent is settled atomically: CONFIRMED and linked to the payment.
    const intent = await db.selectFrom('payment_intents').select(['status', 'payment_id']).where('id', '=', intentId).executeTakeFirstOrThrow();
    expect(intent.status).toBe('CONFIRMED');
    expect(intent.payment_id).toBe(row.payment_id);
  });

  it('a non-COMPLETED status is acknowledged (PROCESSED) with no ledger effect', async () => {
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 15_000n });
    const evt = buildPayUEvent({ extOrderId: intentId, amountMinor: 15_000n, status: 'PENDING' });
    await enqueue(evt);

    await container.resolve('inboxRelay').runInboxRelayOnce();

    expect(await ledgerFor(accountId)).toHaveLength(0); // no money recorded (INV-3)
    const row = await eventRow(evt.operatorEventId);
    expect(row.status).toBe('PROCESSED');
    expect(row.payment_id).toBeNull();
    // The intent stays open (not confirmed by a non-terminal event).
    const intent = await db.selectFrom('payment_intents').select('status').where('id', '=', intentId).executeTakeFirstOrThrow();
    expect(intent.status).toBe('CREATED');
  });

  it('records the operator-confirmed amount and warns when it differs from the intent (Decision 4)', async () => {
    const logger = { warn: vi.fn() };
    const spied = buildContainer(db, { logger });
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 15_000n }); // expected 15000
    const evt = buildPayUEvent({ extOrderId: intentId, amountMinor: 14_000n }); // operator confirms 14000
    await enqueue(evt);

    await spied.resolve('inboxRelay').runInboxRelayOnce();

    // The authoritative (operator) amount is what lands on the ledger.
    const entries = await ledgerFor(accountId);
    expect(entries).toHaveLength(1);
    expect(BigInt(entries[0]!.amount_minor)).toBe(14_000n);
    // And the mismatch was surfaced through the structured logger.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0]?.[1]).toBe('operator amount mismatch');
  });

  it('a distinct event resolving to an already-CONFIRMED intent is dead-lettered (no double-credit)', async () => {
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 15_000n });

    // First event settles the intent.
    const first = buildPayUEvent({ extOrderId: intentId, amountMinor: 15_000n });
    await enqueue(first);
    await container.resolve('inboxRelay').runInboxRelayOnce();
    expect(await ledgerFor(accountId)).toHaveLength(1);

    // A second, DISTINCT event (different orderId) for the same intent must not credit again.
    const second = buildPayUEvent({ extOrderId: intentId, amountMinor: 15_000n });
    await enqueue(second);
    await container.resolve('inboxRelay').runInboxRelayOnce();

    expect(await ledgerFor(accountId)).toHaveLength(1); // still one PAYMENT
    const row = await eventRow(second.operatorEventId);
    expect(row.status).toBe('DEAD');
    expect(row.last_error).toContain('already confirmed');
  });

  it('a second relay run over an already-processed event records no second entry (INV-2)', async () => {
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 12_000n });
    const evt = buildPayUEvent({ extOrderId: intentId, amountMinor: 12_000n });
    await enqueue(evt);

    await container.resolve('inboxRelay').runInboxRelayOnce();
    await container.resolve('inboxRelay').runInboxRelayOnce(); // replay

    expect(await ledgerFor(accountId)).toHaveLength(1);
  });

  it('an unresolvable event (no matching intent) writes no PAYMENT and goes DEAD (INV-3)', async () => {
    const evt = buildPayUEvent({ extOrderId: `no-such-intent-${randomUUID()}`, amountMinor: 9_000n });
    await enqueue(evt);

    await container.resolve('inboxRelay').runInboxRelayOnce();

    const row = await eventRow(evt.operatorEventId);
    expect(row.status).toBe('DEAD');
    expect(row.payment_id).toBeNull();
    expect(row.last_error).toContain('Unresolvable');
    // No payment was recorded for this event's key.
    const payment = await db.selectFrom('payments').select('id').where('idempotency_key', '=', `payu:${evt.orderId}:COMPLETED`).executeTakeFirst();
    expect(payment).toBeUndefined();
  });

  it('a mid-apply failure rolls back atomically and books a retry (FAILED, attempts++)', async () => {
    const accountId = await seedAccount(db);
    const intentId = await seedPaymentIntent(db, { accountId, amountMinor: 15_000n });
    // A PENDING charge in a DIFFERENT currency makes allocation throw CurrencyMismatchError
    // (a transient DomainError) *after* the payment insert — exercising atomic rollback.
    await db
      .insertInto('charges')
      .values({
        account_id: accountId,
        status: 'PENDING',
        currency: 'EUR',
        net_minor: '10000',
        tax_minor: '0',
        gross_minor: '10000',
        tax_rate: '0',
        tax_treatment: 'STANDARD',
        tax_jurisdiction: 'PL',
        idempotency_key: randomUUID(),
      })
      .execute();

    const evt = buildPayUEvent({ extOrderId: intentId, amountMinor: 15_000n, currency: 'PLN' });
    await enqueue(evt);

    await container.resolve('inboxRelay').runInboxRelayOnce();

    // Nothing was written: no payment, no ledger entry, no balance row.
    expect(await ledgerFor(accountId)).toHaveLength(0);
    const payment = await db.selectFrom('payments').select('id').where('idempotency_key', '=', `payu:${evt.orderId}:COMPLETED`).executeTakeFirst();
    expect(payment).toBeUndefined();

    const row = await eventRow(evt.operatorEventId);
    expect(row.status).toBe('FAILED');
    expect(row.attempts).toBe(1);
    expect(row.next_attempt_at).not.toBeNull();
    expect(row.last_error).toContain('Currency mismatch');
  });
});
