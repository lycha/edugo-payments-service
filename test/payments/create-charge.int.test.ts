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

async function seedEnrollment(): Promise<{ accountId: string; enrollmentId: string; studentId: string }> {
  const account = await db
    .insertInto('accounts')
    .values({ external_ref: randomUUID() })
    .returning('id')
    .executeTakeFirstOrThrow();
  const studentId = `stu-${randomUUID().slice(0, 8)}`;
  const child = await db
    .insertInto('child_sub_accounts')
    .values({ account_id: account.id, student_id: studentId })
    .returning('id')
    .executeTakeFirstOrThrow();
  const enrollment = await db
    .insertInto('enrollments')
    .values({ child_sub_account_id: child.id, course_ref: 'Class 3B Math' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { accountId: account.id, enrollmentId: enrollment.id, studentId };
}

async function ledgerFor(accountId: string) {
  return db.selectFrom('ledger_entries').selectAll().where('account_id', '=', accountId).execute();
}
async function balanceFor(accountId: string): Promise<bigint> {
  const row = await db
    .selectFrom('account_balances')
    .select('balance_minor')
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  return row ? BigInt(row.balance_minor) : 0n;
}

describe('PaymentHub.createCharge', () => {
  it('writes a PENDING charge + a negative CHARGE entry; balance == Σ ledger (INV-1/INV-7)', async () => {
    const { accountId, enrollmentId, studentId } = await seedEnrollment();
    const hub = container.resolve('paymentHub');

    const { view, replayed } = await hub.createCharge({
      enrollmentId,
      netMinor: 149_900n,
      currency: 'PLN',
      idempotencyKey: randomUUID(),
    });

    expect(replayed).toBe(false);
    expect(view.record.status).toBe('PENDING');
    expect(view.record.accountId).toBe(accountId);
    expect(view.record.studentId).toBe(studentId);
    // INV-7: gross == net + tax, EXEMPT (AC-33 legal reason present)
    expect(view.record.netMinor).toBe(149_900n);
    expect(view.record.taxMinor).toBe(0n);
    expect(view.record.grossMinor).toBe(149_900n);
    expect(view.record.taxTreatment).toBe('EXEMPT');
    expect(view.record.taxLegalReason).toBeTruthy();
    // Outstanding is the full gross, signed negative (arrears).
    expect(view.owedMinor).toBe(-149_900n);

    const entries = await ledgerFor(accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry_type).toBe('CHARGE');
    expect(BigInt(entries[0]!.amount_minor)).toBe(-149_900n);

    // INV-1: balance == Σ ledger entries.
    const sum = entries.reduce((acc, e) => acc + BigInt(e.amount_minor), 0n);
    expect(await balanceFor(accountId)).toBe(sum);
    expect(sum).toBe(-149_900n);
  });

  it('is idempotent: a repeated key returns the original charge with no second entry', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const hub = container.resolve('paymentHub');
    const cmd = { enrollmentId, netMinor: 15_000n, currency: 'PLN', idempotencyKey: randomUUID() };

    const first = await hub.createCharge(cmd);
    const second = await hub.createCharge(cmd);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.view.record.id).toBe(first.view.record.id);

    const entries = await ledgerFor(accountId);
    expect(entries).toHaveLength(1);
    const charges = await db.selectFrom('charges').select('id').where('account_id', '=', accountId).execute();
    expect(charges).toHaveLength(1);
  });

  it('getCharge returns the charge; listCharges pages it oldest-first', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const hub = container.resolve('paymentHub');

    const created = await hub.createCharge({
      enrollmentId,
      netMinor: 15_000n,
      currency: 'PLN',
      idempotencyKey: randomUUID(),
    });

    const fetched = await hub.getCharge(created.view.record.id);
    expect(fetched.record.id).toBe(created.view.record.id);
    expect(fetched.owedMinor).toBe(-15_000n);

    const page = await hub.listCharges(accountId, { limit: 50 });
    expect(page.items.map((v) => v.record.id)).toContain(created.view.record.id);
    expect(page.nextCursor).toBeNull();
  });

  it('is idempotent under concurrency: two identical creates yield one charge + one entry', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const hub = container.resolve('paymentHub');
    const cmd = { enrollmentId, netMinor: 15_000n, currency: 'PLN', idempotencyKey: randomUUID() };

    // Fire both at once: one wins the unique constraint, the other hits a 23505
    // that aborts its transaction and must resolve to the original as a replay.
    const [a, b] = await Promise.all([hub.createCharge(cmd), hub.createCharge(cmd)]);

    expect(a.view.record.id).toBe(b.view.record.id);
    expect([a.replayed, b.replayed].filter(Boolean)).toHaveLength(1); // exactly one replay

    const charges = await db.selectFrom('charges').select('id').where('account_id', '=', accountId).execute();
    expect(charges).toHaveLength(1);
    const entries = await ledgerFor(accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entry_type).toBe('CHARGE');
  });

  it('paginates oldest-first via keyset cursor without repeating or skipping rows', async () => {
    const { accountId, enrollmentId } = await seedEnrollment();
    const hub = container.resolve('paymentHub');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const { view } = await hub.createCharge({ enrollmentId, netMinor: 10_000n, currency: 'PLN', idempotencyKey: randomUUID() });
      ids.push(view.record.id);
      await new Promise((r) => setTimeout(r, 5)); // distinct created_at
    }

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await hub.listCharges(accountId, { limit: 1, cursor });
      seen.push(...page.items.map((v) => v.record.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    // Exactly the three charges, oldest-first, each once (proves the ms-precision keyset).
    expect(seen).toEqual(ids);
  });

  it('rejects a malformed pagination cursor (InvalidCursorError → 400)', async () => {
    const { accountId } = await seedEnrollment();
    await expect(
      container.resolve('paymentHub').listCharges(accountId, { limit: 10, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('rejects a charge against an unknown enrollment (→ EnrollmentNotFoundError / 404)', async () => {
    const hub = container.resolve('paymentHub');
    await expect(
      hub.createCharge({
        enrollmentId: randomUUID(),
        netMinor: 15_000n,
        currency: 'PLN',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'ENROLLMENT_NOT_FOUND' });
  });
});
