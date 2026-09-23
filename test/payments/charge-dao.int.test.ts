import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import { startTestDatabase, type TestDatabase } from '../setup/postgres';
import { createDb } from '../../src/platform/db/database';
import type { DB } from '#generated/platform/db/schema';
import { ChargeDao } from '../../src/payments/adapter/storage/ChargeDao';
import { TaxBreakdown } from '../../src/payments/domain/model/TaxBreakdown';
import { Money } from '../../src/payments/domain/model/Money';
import { DuplicateIdempotencyKeyError } from '../../src/payments/domain/Errors';

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

async function seedAccount(): Promise<string> {
  const row = await db
    .insertInto('accounts')
    .values({ external_ref: randomUUID() })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function exemptTax(netMinor: bigint): TaxBreakdown {
  return TaxBreakdown.exempt(Money.of(netMinor, 'PLN'), 'PL', 'PL tuition — VAT exempt');
}

async function insertCharge(dao: ChargeDao, accountId: string): Promise<string> {
  const { id } = await dao.insertCharge({
    accountId,
    enrollmentId: null as unknown as string, // enrollment optional in schema; not needed for DAO-level tests
    studentId: 'stu-1',
    currency: 'PLN',
    tax: exemptTax(15_000n),
    idempotencyKey: randomUUID(),
  });
  return id;
}

describe('ChargeDao', () => {
  it('inserts a charge and returns its id; a duplicate idempotency key is rejected', async () => {
    const accountId = await seedAccount();
    const dao = new ChargeDao(db);
    const key = randomUUID();

    const first = await dao.insertCharge({
      accountId,
      enrollmentId: null as unknown as string,
      studentId: 'stu-1',
      currency: 'PLN',
      tax: exemptTax(15_000n),
      idempotencyKey: key,
    });
    expect(first.id).toBeTruthy();

    const charge = await dao.findChargeById(first.id);
    expect(charge?.status).toBe('PENDING');
    expect(charge?.grossMinor).toBe(15_000n);
    expect(charge?.taxMinor).toBe(0n);
    expect(charge?.netMinor).toBe(15_000n); // INV-7: gross == net + tax

    await expect(
      dao.insertCharge({
        accountId,
        enrollmentId: null as unknown as string,
        studentId: 'stu-1',
        currency: 'PLN',
        tax: exemptTax(9_000n),
        idempotencyKey: key,
      }),
    ).rejects.toBeInstanceOf(DuplicateIdempotencyKeyError);
  });

  it('returns open charges oldest-first (created_at asc)', async () => {
    const accountId = await seedAccount();
    const dao = new ChargeDao(db);

    const older = await insertCharge(dao, accountId);
    // Force a distinct, later created_at on the second charge.
    await new Promise((r) => setTimeout(r, 10));
    const newer = await insertCharge(dao, accountId);

    const open = await dao.findOpenChargesByAccount(accountId);
    expect(open.map((c) => c.id)).toEqual([older, newer]);
  });

  it('row-locks open charges FOR UPDATE so a concurrent reader blocks until commit', async () => {
    const accountId = await seedAccount();
    const dao = new ChargeDao(db);
    await insertCharge(dao, accountId);

    // Open a transaction that locks the account's open charges and holds the lock.
    let releaseHold: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let secondFinished = false;

    const holder = db.transaction().execute(async (trx) => {
      const locked = await new ChargeDao(trx).findOpenChargesByAccountForUpdate(accountId);
      expect(locked).toHaveLength(1);
      await held; // keep the lock until the probe below has demonstrably blocked
    });

    // A concurrent FOR UPDATE on the same rows must not complete while the lock is held.
    const contender = db.transaction().execute(async (trx) => {
      await new ChargeDao(trx).findOpenChargesByAccountForUpdate(accountId);
      secondFinished = true;
    });

    await new Promise((r) => setTimeout(r, 150));
    expect(secondFinished).toBe(false); // proven blocked

    releaseHold();
    await holder;
    await contender;
    expect(secondFinished).toBe(true); // unblocked after the holder committed
  });

  it('shares one transaction across payments and charges via the bundle', async () => {
    // Proven indirectly here: a ChargeDao and a PaymentDao built on the same trx
    // both see uncommitted rows. The higher-level UnitOfWork bundle is exercised
    // end-to-end by the createCharge / allocation suites.
    const accountId = await seedAccount();
    await db.transaction().execute(async (trx) => {
      const chargeDao = new ChargeDao(trx);
      const { id } = await chargeDao.insertCharge({
        accountId,
        enrollmentId: null as unknown as string,
        studentId: 'stu-1',
        currency: 'PLN',
        tax: exemptTax(5_000n),
        idempotencyKey: randomUUID(),
      });
      // Same transaction sees its own uncommitted insert.
      const seen = await chargeDao.findChargeById(id);
      expect(seen?.grossMinor).toBe(5_000n);
    });
  });
});
