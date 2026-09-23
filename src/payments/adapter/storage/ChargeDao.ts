import { sql } from 'kysely';
import type { Selectable } from 'kysely';
import type { Charges } from '#generated/platform/db/schema';
import type { ChargeRepository, TaxRateRow } from '../../domain/port/ChargeRepository';
import type { ChargeRecord } from '../../domain/model/Charge';
import type { ChargeStatus } from '../../domain/model/ChargeStatus';
import type { TaxBreakdown, TaxTreatment } from '../../domain/model/TaxBreakdown';
import { Money } from '../../domain/model/Money';
import { DuplicateIdempotencyKeyError } from '../../domain/Errors';
import type { Executor } from './PaymentDao';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

function toChargeRecord(row: Selectable<Charges>): ChargeRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    enrollmentId: row.enrollment_id,
    studentId: row.student_id,
    status: row.status as ChargeStatus,
    currency: row.currency,
    netMinor: BigInt(row.net_minor),
    taxMinor: BigInt(row.tax_minor),
    grossMinor: BigInt(row.gross_minor),
    taxRate: row.tax_rate,
    taxTreatment: row.tax_treatment as TaxTreatment,
    taxLegalReason: row.tax_legal_reason,
    taxJurisdiction: row.tax_jurisdiction,
    createdAt: row.created_at,
  };
}

/** Cursor over `(created_at, id)` for keyset pagination of an account's charges. */
function encodeCursor(row: ChargeRecord): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  return { createdAt: new Date(iso ?? ''), id: id ?? '' };
}
export { encodeCursor };

/** Kysely data-access object implementing the ChargeRepository port, bound to a
 *  single executor (connection or transaction). Conventions follow PaymentDao:
 *  Int8 ↔ bigint via string; Numeric ↔ string; never set updated_at (trigger). */
export class ChargeDao implements ChargeRepository {
  constructor(private readonly db: Executor) {}

  async accountExists(accountId: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('accounts')
      .select('id')
      .where('id', '=', accountId)
      .executeTakeFirst();
    return row !== undefined;
  }

  async findAccountByEnrollment(
    enrollmentId: string,
  ): Promise<{ accountId: string; studentId: string } | null> {
    const row = await this.db
      .selectFrom('enrollments')
      .innerJoin('child_sub_accounts', 'child_sub_accounts.id', 'enrollments.child_sub_account_id')
      .select(['child_sub_accounts.account_id as accountId', 'child_sub_accounts.student_id as studentId'])
      .where('enrollments.id', '=', enrollmentId)
      .executeTakeFirst();
    return row ? { accountId: row.accountId, studentId: row.studentId } : null;
  }

  async resolveTaxRate(input: {
    jurisdiction: string;
    category: string;
    on: Date;
  }): Promise<TaxRateRow | null> {
    const row = await this.db
      .selectFrom('tax_rates')
      .select(['rate', 'treatment', 'legal_reason'])
      .where('jurisdiction', '=', input.jurisdiction)
      .where('category', '=', input.category)
      .where('valid_from', '<=', input.on)
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>', input.on)]))
      .orderBy('valid_from', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row
      ? { rate: row.rate, treatment: row.treatment as TaxTreatment, legalReason: row.legal_reason }
      : null;
  }

  async findChargeByIdempotencyKey(key: string): Promise<ChargeRecord | null> {
    const row = await this.db
      .selectFrom('charges')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
    return row ? toChargeRecord(row) : null;
  }

  async findChargeById(chargeId: string): Promise<ChargeRecord | null> {
    const row = await this.db
      .selectFrom('charges')
      .selectAll()
      .where('id', '=', chargeId)
      .executeTakeFirst();
    return row ? toChargeRecord(row) : null;
  }

  async insertCharge(input: {
    accountId: string;
    enrollmentId: string;
    studentId: string | null;
    currency: string;
    tax: TaxBreakdown;
    idempotencyKey: string;
  }): Promise<{ id: string }> {
    try {
      const row = await this.db
        .insertInto('charges')
        .values({
          account_id: input.accountId,
          enrollment_id: input.enrollmentId,
          student_id: input.studentId,
          currency: input.currency,
          net_minor: input.tax.netMinor.toString(),
          tax_minor: input.tax.taxMinor.toString(),
          gross_minor: input.tax.grossMinor.toString(),
          tax_rate: input.tax.rate,
          tax_treatment: input.tax.treatment,
          tax_legal_reason: input.tax.legalReason,
          tax_jurisdiction: input.tax.jurisdiction,
          idempotency_key: input.idempotencyKey,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      return { id: row.id };
    } catch (err) {
      if (isUniqueViolation(err)) throw new DuplicateIdempotencyKeyError(input.idempotencyKey);
      throw err;
    }
  }

  async findOpenChargesByAccount(accountId: string): Promise<ChargeRecord[]> {
    const rows = await this.db
      .selectFrom('charges')
      .selectAll()
      .where('account_id', '=', accountId)
      .where('status', '=', 'PENDING')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    return rows.map(toChargeRecord);
  }

  async findOpenChargesByAccountForUpdate(accountId: string): Promise<ChargeRecord[]> {
    const rows = await this.db
      .selectFrom('charges')
      .selectAll()
      .where('account_id', '=', accountId)
      .where('status', '=', 'PENDING')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();
    return rows.map(toChargeRecord);
  }

  async listChargesByAccount(
    accountId: string,
    opts: { status?: ChargeStatus; limit: number; cursor?: string },
  ): Promise<ChargeRecord[]> {
    let qb = this.db.selectFrom('charges').selectAll().where('account_id', '=', accountId);
    if (opts.status) qb = qb.where('status', '=', opts.status);
    if (opts.cursor) {
      const { createdAt, id } = decodeCursor(opts.cursor);
      qb = qb.where((eb) =>
        eb.or([
          eb('created_at', '>', createdAt),
          eb.and([eb('created_at', '=', createdAt), eb('id', '>', id)]),
        ]),
      );
    }
    const rows = await qb
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .limit(opts.limit)
      .execute();
    return rows.map(toChargeRecord);
  }

  async updateStatus(chargeId: string, status: ChargeStatus): Promise<void> {
    await this.db.updateTable('charges').set({ status }).where('id', '=', chargeId).execute();
  }

  async insertAllocation(input: {
    paymentId: string;
    chargeId: string;
    amount: Money;
  }): Promise<void> {
    await this.db
      .insertInto('payment_allocations')
      .values({
        payment_id: input.paymentId,
        charge_id: input.chargeId,
        amount_minor: input.amount.amountMinor.toString(),
      })
      .execute();
  }

  async sumAllocationsForCharge(chargeId: string): Promise<bigint> {
    const row = await this.db
      .selectFrom('payment_allocations')
      .select((eb) => eb.fn.coalesce(eb.fn.sum('amount_minor'), sql<string>`0`).as('total'))
      .where('charge_id', '=', chargeId)
      .executeTakeFirst();
    return BigInt(row?.total ?? '0');
  }
}
