import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { startTestDatabase, type TestDatabase } from '../setup/postgres';
import { createDb } from '../../src/platform/db/database';
import { buildContainer } from '../../src/platform/container';
import type { DB } from '#generated/platform/db/schema';

// Receivable-side invariant suite (task 5sjm): proves INV-1/5/7 and AC-11 end-to-end
// across create+pay flows against real Postgres. Invariants are re-checked after
// EVERY money-moving step, not just at the end.

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
  const account = await db.insertInto('accounts').values({ external_ref: randomUUID() }).returning('id').executeTakeFirstOrThrow();
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

async function createCharge(enrollmentId: string, netMinor: bigint): Promise<string> {
  const { view } = await container.resolve('paymentHub').createCharge({
    enrollmentId,
    netMinor,
    currency: 'PLN',
    idempotencyKey: randomUUID(),
  });
  return view.record.id;
}
async function recordPayment(accountId: string, amountMinor: bigint): Promise<void> {
  await container.resolve('paymentHub').recordPayment({
    accountId,
    amountMinor,
    currency: 'PLN',
    operatorReference: null,
    idempotencyKey: randomUUID(),
  });
}

/** Re-asserts every receivable-side invariant for an account. */
async function assertInvariants(accountId: string): Promise<void> {
  // INV-1: balance == Σ ledger entries.
  const entries = await db.selectFrom('ledger_entries').select('amount_minor').where('account_id', '=', accountId).execute();
  const ledgerSum = entries.reduce((a, e) => a + BigInt(e.amount_minor), 0n);
  const balRow = await db.selectFrom('account_balances').select('balance_minor').where('account_id', '=', accountId).executeTakeFirst();
  const balance = balRow ? BigInt(balRow.balance_minor) : 0n;
  expect(balance).toBe(ledgerSum);

  const charges = await db
    .selectFrom('charges')
    .select(['id', 'net_minor', 'tax_minor', 'gross_minor'])
    .where('account_id', '=', accountId)
    .execute();
  for (const c of charges) {
    // INV-7: gross == net + tax on every charge.
    expect(BigInt(c.gross_minor)).toBe(BigInt(c.net_minor) + BigInt(c.tax_minor));
    // INV-5: no charge is allocated beyond its gross (never double-paid).
    const allocs = await db.selectFrom('payment_allocations').select('amount_minor').where('charge_id', '=', c.id).execute();
    const allocated = allocs.reduce((a, r) => a + BigInt(r.amount_minor), 0n);
    expect(allocated <= BigInt(c.gross_minor)).toBe(true);
  }
}

async function statusOf(chargeId: string): Promise<string> {
  const r = await db.selectFrom('charges').select('status').where('id', '=', chargeId).executeTakeFirstOrThrow();
  return r.status;
}

describe('receivable-side invariants (INV-1/5/7, AC-11)', () => {
  it('holds INV-1/5/7 after every step of a mixed create+partial+over-pay flow', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();

    const a = await createCharge(enrollmentId, 15_000n); // oldest
    await assertInvariants(accountId);
    await new Promise((r) => setTimeout(r, 10));
    const b = await createCharge(enrollmentId, 25_000n); // newer
    await assertInvariants(accountId);

    // Cover A exactly (oldest-first).
    await recordPayment(accountId, 15_000n);
    await assertInvariants(accountId);
    expect(await statusOf(a)).toBe('SETTLED'); // AC-11
    expect(await statusOf(b)).toBe('PENDING');

    // Partial payment on B — stays PENDING, ledger-neutral (INV-1 still holds via assertInvariants).
    await recordPayment(accountId, 10_000n);
    await assertInvariants(accountId);
    expect(await statusOf(b)).toBe('PENDING');

    // Over-pay: covers B's remaining 15_000 and leaves 5_000 credit.
    await recordPayment(accountId, 20_000n);
    await assertInvariants(accountId);
    expect(await statusOf(b)).toBe('SETTLED'); // AC-11 full coverage

    // INV-5: over-allocation became credit — final balance is positive.
    const balRow = await db.selectFrom('account_balances').select('balance_minor').where('account_id', '=', accountId).executeTakeFirstOrThrow();
    expect(BigInt(balRow.balance_minor)).toBe(5_000n); // -15000 -25000 +45000
  });

  it('allocates oldest-first across many charges and settles a prefix (INV-5/AC-19)', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const ids: string[] = [];
    for (const net of [10_000n, 10_000n, 10_000n]) {
      ids.push(await createCharge(enrollmentId, net));
      await new Promise((r) => setTimeout(r, 8)); // distinct created_at → deterministic order
    }
    await assertInvariants(accountId);

    // Pay enough for the first two only.
    await recordPayment(accountId, 20_000n);
    await assertInvariants(accountId);

    expect(await statusOf(ids[0]!)).toBe('SETTLED');
    expect(await statusOf(ids[1]!)).toBe('SETTLED');
    expect(await statusOf(ids[2]!)).toBe('PENDING'); // untouched — oldest-first stopped here
  });

  it('keeps INV-7 (gross == net + tax) on an EXEMPT charge with a legal reason (AC-33)', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const id = await createCharge(enrollmentId, 149_900n);
    const c = await db
      .selectFrom('charges')
      .select(['net_minor', 'tax_minor', 'gross_minor', 'tax_treatment', 'tax_legal_reason'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    expect(c.tax_treatment).toBe('EXEMPT');
    expect(c.tax_legal_reason).toBeTruthy();
    expect(BigInt(c.tax_minor)).toBe(0n);
    expect(BigInt(c.gross_minor)).toBe(BigInt(c.net_minor) + BigInt(c.tax_minor));
    await assertInvariants(accountId);
  });
});
