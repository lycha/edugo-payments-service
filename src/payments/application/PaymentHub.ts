import { Money } from '#payments/ledger/domain/model/Money';
import { TaxBreakdown } from '#payments/charges/domain/model/TaxBreakdown';
import { encodeChargeCursor } from '#payments/charges/domain/model/ChargeCursor';
import {
  AccountNotFoundError,
  ChargeNotFoundError,
  CurrencyMismatchError,
  DuplicateIdempotencyKeyError,
  EnrollmentNotFoundError,
} from '#payments/ledger/domain/Errors';
import type { UnitOfWork } from '#payments/ledger/domain/port/UnitOfWork';
import type { PaymentRepository } from '#payments/ledger/domain/port/PaymentRepository';
import type { ChargeRepository } from '#payments/charges/domain/port/ChargeRepository';
import type { ChargeRecord } from '#payments/charges/domain/model/Charge';
import type { ChargeStatus } from '#payments/charges/domain/model/ChargeStatus';

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

    return this.deps.unitOfWork.withTransaction(async (repos) => {
      const repo = repos.payments;
      if (!(await repo.accountExists(cmd.accountId))) {
        throw new AccountNotFoundError(cmd.accountId);
      }

      const replay = await this.tryReplay(repo, cmd);
      if (replay) return replay;

      let payment: { id: string };
      try {
        payment = await repo.insertPayment({
          accountId: cmd.accountId,
          amount,
          operatorReference: cmd.operatorReference,
          idempotencyKey: cmd.idempotencyKey,
        });
      } catch (err) {
        // Concurrent request won the unique constraint — treat as replay.
        if (err instanceof DuplicateIdempotencyKeyError) {
          const replayed = await this.tryReplay(repo, cmd);
          if (replayed) return replayed;
        }
        throw err;
      }

      await repo.appendLedgerEntry({
        accountId: cmd.accountId,
        type: 'PAYMENT',
        amount,
        reference: payment.id,
        paymentId: payment.id,
      });

      const balance = await repo.incrementBalance(cmd.accountId, amount);

      // Ledger-neutral allocation (INV-5, FR-9): pay down open charges oldest-first
      // in the SAME transaction. This writes payment_allocations rows and flips
      // charge status only — it posts NO ledger entry and does not touch the
      // balance (that was already moved by the CHARGE(−) and PAYMENT(+) entries).
      await this.allocate(repos.charges, cmd.accountId, payment.id, amount);

      return {
        paymentId: payment.id,
        accountId: cmd.accountId,
        balanceMinor: balance.amountMinor,
        currency: balance.currency,
        replayed: false,
      };
    });
  }

  /**
   * Allocates a payment across the account's open charges oldest-first. The
   * charges are locked `FOR UPDATE` (AC-20, PR-008) so concurrent payments cannot
   * over-allocate. A fully-covered charge transitions PENDING → SETTLED (AC-11).
   * Any remainder is left as positive balance (credit, INV-5) — no entry is
   * posted. Ledger-neutral: does not modify the balance.
   */
  private async allocate(
    charges: ChargeRepository,
    accountId: string,
    paymentId: string,
    payment: Money,
  ): Promise<void> {
    const openCharges = await charges.findOpenChargesByAccountForUpdate(accountId);
    let remaining = payment.amountMinor;

    for (const charge of openCharges) {
      if (remaining <= 0n) break;
      // App-enforced currency match (PR-S3); cannot occur under PLN-only M1.
      if (charge.currency !== payment.currency) {
        throw new CurrencyMismatchError(payment.currency, charge.currency);
      }

      const settled = await charges.sumAllocationsForCharge(charge.id);
      const outstanding = charge.grossMinor - settled;
      if (outstanding <= 0n) continue; // defensive: already covered

      const applied = remaining < outstanding ? remaining : outstanding;
      await charges.insertAllocation({
        paymentId,
        chargeId: charge.id,
        amount: Money.of(applied, payment.currency),
      });
      if (applied >= outstanding) {
        await charges.updateStatus(charge.id, 'SETTLED');
      }
      remaining -= applied;
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

    return this.deps.unitOfWork.withTransaction(async (repos) => {
      const charges = repos.charges;

      const owner = await charges.findAccountByEnrollment(cmd.enrollmentId);
      if (!owner) throw new EnrollmentNotFoundError(cmd.enrollmentId);

      const existing = await charges.findChargeByIdempotencyKey(cmd.idempotencyKey);
      if (existing) return { view: await this.toView(charges, existing), replayed: true };

      const rate = await charges.resolveTaxRate({
        jurisdiction: 'PL',
        category: 'TUITION',
        on: new Date(),
      });
      const tax = TaxBreakdown.exempt(net, 'PL', rate?.legalReason ?? PL_TUITION_EXEMPT_REASON);

      let inserted: { id: string };
      try {
        inserted = await charges.insertCharge({
          accountId: owner.accountId,
          enrollmentId: cmd.enrollmentId,
          studentId: owner.studentId,
          currency: cmd.currency,
          tax,
          idempotencyKey: cmd.idempotencyKey,
        });
      } catch (err) {
        // Concurrent request won the unique constraint — treat as replay.
        if (err instanceof DuplicateIdempotencyKeyError) {
          const replayed = await charges.findChargeByIdempotencyKey(cmd.idempotencyKey);
          if (replayed) return { view: await this.toView(charges, replayed), replayed: true };
        }
        throw err;
      }

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
      const records = await charges.listChargesByAccount(accountId, opts);
      const items = await Promise.all(records.map((r) => this.toView(charges, r)));
      const last = records[records.length - 1];
      const nextCursor = records.length === opts.limit && last ? encodeChargeCursor(last) : null;
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
