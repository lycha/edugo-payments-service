import { Money } from '#payments/ledger/domain/model/Money';
import { TaxBreakdown } from '#payments/charges/domain/model/TaxBreakdown';
import { encodeChargeCursor } from '#payments/charges/domain/model/ChargeCursor';
import {
  AccountNotFoundError,
  ChargeNotFoundError,
  DuplicateIdempotencyKeyError,
  EnrollmentNotFoundError,
} from '#payments/ledger/domain/Errors';
import type { UnitOfWork } from '#payments/ledger/domain/port/UnitOfWork';
import type { PaymentRepository } from '#payments/ledger/domain/port/PaymentRepository';
import type { ChargeRepository } from '#payments/charges/domain/port/ChargeRepository';
import type { ChargeRecord } from '#payments/charges/domain/model/Charge';
import type { ChargeStatus } from '#payments/charges/domain/model/ChargeStatus';
import { recordAndAllocate } from './recordPayment';

/** Default legal reason for VAT-exempt Polish tuition when no tax_rates row supplies one. */
const PL_TUITION_EXEMPT_REASON = 'PL tuition — VAT exempt (art. 43 ust. 1 pkt 26 ustawy o VAT)';

export interface CreateChargeCommand {
  enrollmentId: string;
  netMinor: bigint;
  currency: string;
  idempotencyKey: string;
}

/** A charge plus its live outstanding, signed per the ledger convention
 *  (`owedMinor = −(gross − Σ allocations)`; a SETTLED charge reads 0). */
export interface ChargeView {
  record: ChargeRecord;
  owedMinor: bigint;
}

export interface RecordPaymentCommand {
  accountId: string;
  amountMinor: bigint;
  currency: string;
  operatorReference: string | null;
  idempotencyKey: string;
}

export interface RecordPaymentResult {
  paymentId: string;
  accountId: string;
  balanceMinor: bigint;
  currency: string;
  replayed: boolean;
}

/**
 * Domain service (facade) for the payments context. Orchestrates use cases over
 * the domain ports; the incoming HTTP adapter calls into it.
 */
export class PaymentHub {
  constructor(private readonly deps: { unitOfWork: UnitOfWork }) {}

  /**
   * Records a payment: appends a PAYMENT ledger entry and updates the balance
   * atomically. Idempotent — a repeated key returns the original result without
   * posting a second entry (INV: balance == sum of entries).
   */
  async recordPayment(cmd: RecordPaymentCommand): Promise<RecordPaymentResult> {
    const amount = Money.of(cmd.amountMinor, cmd.currency);

    try {
      return await this.deps.unitOfWork.withTransaction(async (repos) => {
        if (!(await repos.payments.accountExists(cmd.accountId))) {
          throw new AccountNotFoundError(cmd.accountId);
        }

        // Shared record-and-allocate core (idempotent; ledger-neutral allocation,
        // INV-5/FR-9). The relay uses the same core so neither path double-records.
        const result = await recordAndAllocate(repos, {
          accountId: cmd.accountId,
          amount,
          operatorReference: cmd.operatorReference,
          idempotencyKey: cmd.idempotencyKey,
        });

        return {
          paymentId: result.paymentId,
          accountId: cmd.accountId,
          balanceMinor: result.balance.amountMinor,
          currency: result.balance.currency,
          replayed: result.replayed,
        };
      });
    } catch (err) {
      // A concurrent request won the unique constraint — the original was recorded
      // by that request. Return it as a replay from a fresh transaction.
      if (err instanceof DuplicateIdempotencyKeyError) {
        const replayed = await this.deps.unitOfWork.withTransaction((repos) =>
          this.tryReplay(repos.payments, cmd),
        );
        if (replayed) return replayed;
      }
      throw err;
    }
  }

  /**
   * Creates a new-order charge: resolves the tax breakdown, inserts a PENDING
   * charge, and posts a CHARGE ledger entry for the GROSS as a negative (arrears)
   * amount — all in one transaction, preserving INV-1/INV-7. Idempotent via the
   * idempotency key (a replay returns the original charge, no second entry).
   *
   * M1 is EXEMPT-only (tech spec, Decision 5): the tax table is read to prove the
   * wiring and to source a legal reason, but every charge resolves to EXEMPT
   * (tax = 0, gross = net). Non-exempt computation is deferred with the engine.
   */
  async createCharge(cmd: CreateChargeCommand): Promise<{ view: ChargeView; replayed: boolean }> {
    const net = Money.of(cmd.netMinor, cmd.currency);

    try {
      return await this.deps.unitOfWork.withTransaction(async (repos) => {
        const charges = repos.charges;

        const owner = await charges.findAccountByEnrollment(cmd.enrollmentId);
        if (!owner) throw new EnrollmentNotFoundError(cmd.enrollmentId);

        const existing = await charges.findChargeByIdempotencyKey(cmd.idempotencyKey);
        if (existing) return { view: await this.toView(charges, existing), replayed: true };

        // M1 is EXEMPT-only: the lookup proves the wiring and sources a legal
        // reason, but `rate`/`treatment` are intentionally NOT applied — every
        // charge resolves to EXEMPT until the effective-dated engine lands (NG-A).
        const rate = await charges.resolveTaxRate({
          jurisdiction: 'PL',
          category: 'TUITION',
          on: new Date(),
        });
        const tax = TaxBreakdown.exempt(net, 'PL', rate?.legalReason ?? PL_TUITION_EXEMPT_REASON);

        // May throw DuplicateIdempotencyKeyError; not caught here (a 23505 aborts the
        // transaction). Handled below from a fresh transaction after rollback.
        const inserted = await charges.insertCharge({
          accountId: owner.accountId,
          enrollmentId: cmd.enrollmentId,
          studentId: owner.studentId,
          currency: cmd.currency,
          tax,
          idempotencyKey: cmd.idempotencyKey,
        });

        // Post the CHARGE for the GROSS as a negative (arrears) entry, and move the
        // balance — atomically with the charge insert (AC-30, sign convention).
        const grossArrears = Money.of(tax.grossMinor, cmd.currency).negate();
        await repos.payments.appendLedgerEntry({
          accountId: owner.accountId,
          type: 'CHARGE',
          amount: grossArrears,
          reference: inserted.id,
          paymentId: null,
        });
        await repos.payments.incrementBalance(owner.accountId, grossArrears);

        const record = await charges.findChargeById(inserted.id);
        if (!record) throw new ChargeNotFoundError(inserted.id); // unreachable — just inserted
        return { view: await this.toView(charges, record), replayed: false };
      });
    } catch (err) {
      // A concurrent request won the unique constraint — return the original charge
      // it created, read from a fresh transaction.
      if (err instanceof DuplicateIdempotencyKeyError) {
        return await this.deps.unitOfWork.withTransaction(async ({ charges }) => {
          const existing = await charges.findChargeByIdempotencyKey(cmd.idempotencyKey);
          if (existing) return { view: await this.toView(charges, existing), replayed: true };
          throw err; // winner not visible — should not happen
        });
      }
      throw err;
    }
  }

  /** Returns a charge and its live outstanding, or throws ChargeNotFoundError. */
  async getCharge(chargeId: string): Promise<ChargeView> {
    return this.deps.unitOfWork.withTransaction(async ({ charges }) => {
      const record = await charges.findChargeById(chargeId);
      if (!record) throw new ChargeNotFoundError(chargeId);
      return this.toView(charges, record);
    });
  }

  /** A page of an account's charges (oldest-first), each with its outstanding. */
  async listCharges(
    accountId: string,
    opts: { status?: ChargeStatus; limit: number; cursor?: string },
  ): Promise<{ items: ChargeView[]; nextCursor: string | null }> {
    return this.deps.unitOfWork.withTransaction(async ({ charges }) => {
      if (!(await charges.accountExists(accountId))) throw new AccountNotFoundError(accountId);
      // Fetch one extra row so we only emit a cursor when a further page truly
      // exists (no trailing empty page). Each row carries its allocated total, so
      // outstanding is derived without a per-item query (no N+1).
      const rows = await charges.listChargesByAccount(accountId, { ...opts, limit: opts.limit + 1 });
      const hasMore = rows.length > opts.limit;
      const page = hasMore ? rows.slice(0, opts.limit) : rows;
      const items: ChargeView[] = page.map(({ record, allocatedMinor }) => ({
        record,
        owedMinor: -(record.grossMinor - allocatedMinor),
      }));
      const lastRecord = page[page.length - 1]?.record;
      const nextCursor = hasMore && lastRecord ? encodeChargeCursor(lastRecord) : null;
      return { items, nextCursor };
    });
  }

  /** Computes the live outstanding (owed) for a charge, signed per the ledger. */
  private async toView(charges: ChargeRepository, record: ChargeRecord): Promise<ChargeView> {
    const settled = await charges.sumAllocationsForCharge(record.id);
    const outstanding = record.grossMinor - settled; // ≥ 0 (INV-5)
    return { record, owedMinor: -outstanding };
  }

  private async tryReplay(
    repo: PaymentRepository,
    cmd: RecordPaymentCommand,
  ): Promise<RecordPaymentResult | null> {
    const existing = await repo.findPaymentByIdempotencyKey(cmd.idempotencyKey);
    if (!existing) return null;
    const balance = (await repo.getBalance(existing.accountId)) ?? Money.zero(cmd.currency);
    return {
      paymentId: existing.id,
      accountId: existing.accountId,
      balanceMinor: balance.amountMinor,
      currency: balance.currency,
      replayed: true,
    };
  }
}
