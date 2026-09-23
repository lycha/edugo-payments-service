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

async function seedEnrollment(): Promise<{ accountId: string; enrollmentId: string }> {
  const account = await db
    .insertInto('accounts')
    .values({ external_ref: randomUUID() })
    .returning('id')
    .executeTakeFirstOrThrow();
  const child = await db
    .insertInto('child_sub_accounts')
    .values({ account_id: account.id, student_id: `stu-${randomUUID().slice(0, 8)}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  const enrollment = await db
    .insertInto('enrollments')
    .values({ child_sub_account_id: child.id, course_ref: 'Class 3B Math' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { accountId: account.id, enrollmentId: enrollment.id };
}

async function makeCharge(enrollmentId: string, netMinor: bigint): Promise<string> {
  const hub = container.resolve('paymentHub');
  const { view } = await hub.createCharge({
    enrollmentId,
    netMinor,
    currency: 'PLN',
    idempotencyKey: randomUUID(),
  });
  return view.record.id;
}

async function pay(accountId: string, amountMinor: bigint): Promise<void> {
  const hub = container.resolve('paymentHub');
  await hub.recordPayment({
    accountId,
    amountMinor,
    currency: 'PLN',
    operatorReference: null,
    idempotencyKey: randomUUID(),
  });
}

async function statusOf(chargeId: string): Promise<string> {
  const row = await db.selectFrom('charges').select('status').where('id', '=', chargeId).executeTakeFirstOrThrow();
  return row.status;
}
async function allocatedTo(chargeId: string): Promise<bigint> {
  const rows = await db
    .selectFrom('payment_allocations')
    .select('amount_minor')
    .where('charge_id', '=', chargeId)
    .execute();
  return rows.reduce((acc, r) => acc + BigInt(r.amount_minor), 0n);
}
async function ledgerSum(accountId: string): Promise<{ sum: bigint; count: number }> {
  const rows = await db.selectFrom('ledger_entries').select('amount_minor').where('account_id', '=', accountId).execute();
  return { sum: rows.reduce((acc, r) => acc + BigInt(r.amount_minor), 0n), count: rows.length };
}
async function balanceOf(accountId: string): Promise<bigint> {
  const row = await db.selectFrom('account_balances').select('balance_minor').where('account_id', '=', accountId).executeTakeFirstOrThrow();
  return BigInt(row.balance_minor);
}

describe('payment allocation (oldest-first, ledger-neutral)', () => {
  it('allocates oldest-first and settles the covered charge (AC-19, AC-11)', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const oldest = await makeCharge(enrollmentId, 15_000n);
    await new Promise((r) => setTimeout(r, 10));
    const newer = await makeCharge(enrollmentId, 15_000n);

    await pay(accountId, 15_000n);

    expect(await statusOf(oldest)).toBe('SETTLED');
    expect(await statusOf(newer)).toBe('PENDING');
    expect(await allocatedTo(oldest)).toBe(15_000n);
    expect(await allocatedTo(newer)).toBe(0n);

    // INV-1: balance == Σ ledger (2 CHARGE + 1 PAYMENT = 3 entries; allocation added none).
    const { sum, count } = await ledgerSum(accountId);
    expect(count).toBe(3);
    expect(await balanceOf(accountId)).toBe(sum);
    expect(sum).toBe(-15_000n); // -15000 -15000 +15000
  });

  it('a partial payment leaves the charge PENDING with Σallocations < gross (FR-9)', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const charge = await makeCharge(enrollmentId, 15_000n);

    await pay(accountId, 10_000n);

    expect(await statusOf(charge)).toBe('PENDING');
    expect(await allocatedTo(charge)).toBe(10_000n);
    expect(await allocatedTo(charge)).toBeLessThan(15_000n);

    // Ledger-neutral: balance == Σ ledger still holds (INV-1).
    const { sum, count } = await ledgerSum(accountId);
    expect(count).toBe(2); // 1 CHARGE + 1 PAYMENT
    expect(await balanceOf(accountId)).toBe(sum);
    expect(sum).toBe(-5_000n);
  });

  it('over-allocation settles all charges and leaves the remainder as credit (INV-5)', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const c1 = await makeCharge(enrollmentId, 15_000n);
    await new Promise((r) => setTimeout(r, 10));
    const c2 = await makeCharge(enrollmentId, 15_000n);

    await pay(accountId, 35_000n);

    expect(await statusOf(c1)).toBe('SETTLED');
    expect(await statusOf(c2)).toBe('SETTLED');
    // No charge is allocated beyond its gross (INV-5).
    expect(await allocatedTo(c1)).toBe(15_000n);
    expect(await allocatedTo(c2)).toBe(15_000n);

    // Remainder is positive balance / credit; balance == Σ ledger (INV-1), allocation added no entry.
    const { sum, count } = await ledgerSum(accountId);
    expect(count).toBe(3);
    expect(await balanceOf(accountId)).toBe(sum);
    expect(sum).toBe(5_000n); // -15000 -15000 +35000
  });

  it('a payment with no open charges is fully retained as credit', async () => {
    const { accountId } = await seedEnrollment();
    await pay(accountId, 5_000n);
    expect(await balanceOf(accountId)).toBe(5_000n);
    const { sum } = await ledgerSum(accountId);
    expect(sum).toBe(5_000n);
  });
});
