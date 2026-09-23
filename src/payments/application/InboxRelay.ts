import { Money } from '#payments/ledger/domain/model/Money';
import {
  DuplicateIdempotencyKeyError,
  MalformedOperatorEventError,
  UnknownOperatorError,
  UnresolvableOperatorEventError,
} from '#payments/ledger/domain/Errors';
import type { UnitOfWork, RepositoryBundle } from '#payments/ledger/domain/port/UnitOfWork';
import type { PaymentOperatorRegistry } from '#payments/ledger/domain/port/PaymentOperator';
import type { OperatorEventRow } from '#payments/ledger/domain/model/OperatorEvent';
import { recordAndAllocate } from './recordPayment';

/** Minimal structured-logger seam (satisfied by Fastify's pino logger). */
export interface RelayLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** Retries before an inbox row is dead-lettered (ADR-0003 open item — placeholder). */
export const MAX_ATTEMPTS = 5;
/** The operator status that records money; other statuses are acknowledged no-ops in M1. */
const COMPLETED = 'COMPLETED';

/** Bounded exponential backoff from the current attempt count. */
function backoffFrom(attempts: number, now: Date): Date {
  const seconds = Math.min(2 ** attempts, 3600);
  return new Date(now.getTime() + seconds * 1000);
}

/** Permanent (non-retryable) failures: the event will never apply, so dead-letter it
 *  immediately rather than burning retries. A missing intent counts as permanent —
 *  intents are created before the operator redirect (tech-spec Decision 4/8). */
function isPermanent(
  err: unknown,
): err is UnresolvableOperatorEventError | MalformedOperatorEventError | UnknownOperatorError {
  return (
    err instanceof UnresolvableOperatorEventError ||
    err instanceof MalformedOperatorEventError ||
    err instanceof UnknownOperatorError
  );
}

interface Counts {
  processed: number;
  failed: number;
  dead: number;
}

/**
 * Transactional inbox relay (ADR-0003 §3). Drains due `operator_events` rows, one
 * per transaction, applying each exactly once. A SUCCESS (and a permanent/clean
 * failure) commits in the apply transaction; an EXCEPTION mid-apply rolls the apply
 * back and records the failure in a SEPARATE transaction so `attempts` still
 * advances toward DEAD (tech-spec Decision 3). CronJob wiring is out of scope.
 */
export class InboxRelay {
  private get logger(): RelayLogger {
    return this.deps.logger;
  }

  constructor(
    private readonly deps: {
      unitOfWork: UnitOfWork;
      paymentOperators: PaymentOperatorRegistry;
      logger: RelayLogger;
    },
  ) {}

  /** Process every currently-due row; returns per-outcome counts. */
  async runInboxRelayOnce(): Promise<Counts> {
    const counts: Counts = { processed: 0, failed: 0, dead: 0 };

    for (;;) {
      // `claimed` is captured so the catch can book the failure against the right
      // row after the apply transaction has rolled back.
      let claimed: OperatorEventRow | undefined;

      try {
        const outcome = await this.deps.unitOfWork.withTransaction(async (repos) => {
          const row = await repos.operatorEvents.claimDueOne(new Date());
          if (!row) return { kind: 'idle' as const };
          claimed = row;
          return this.applyOne(repos, row);
        });

        if (outcome.kind === 'idle') break;
        if (outcome.kind === 'processed') counts.processed += 1;
        else if (outcome.kind === 'dead') counts.dead += 1; // permanent failure, committed in-txn
      } catch (err) {
        // Exception mid-apply: the apply transaction rolled back (no partial write,
        // INV-3). Book the retry/DLQ state in a fresh transaction.
        if (!claimed) throw err; // the claim itself failed — surface it
        const outcome = await this.recordFailure(claimed, err);
        if (outcome === 'dead') counts.dead += 1;
        else counts.failed += 1;
      }
    }

    return counts;
  }

  /** Apply one claimed row within the caller's transaction. Permanent failures mark
   *  the row DEAD here (nothing to roll back); transient failures throw to the caller
   *  so the apply rolls back and the failure is booked separately. */
  private async applyOne(
    repos: RepositoryBundle,
    row: OperatorEventRow,
  ): Promise<{ kind: 'processed' } | { kind: 'dead' }> {
    const operator = this.deps.paymentOperators.get(row.operator);
    if (!operator) {
      // Permanent: no adapter for this operator. Dead-letter in-txn.
      return this.deadInTx(repos, row, new UnknownOperatorError(row.operator));
    }

    let parsed;
    try {
      parsed = operator.parse(row.payload); // MalformedOperatorEventError → permanent
    } catch (err) {
      if (isPermanent(err)) return this.deadInTx(repos, row, err);
      throw err;
    }

    // Only a COMPLETED confirmation records money; other statuses are acknowledged
    // no-ops in M1 (Tier-2 state machine consumes them). No ledger effect.
    if (parsed.status !== COMPLETED) {
      await repos.operatorEvents.markProcessed(row.id, null);
      return { kind: 'processed' };
    }

    const intent = await repos.payments.findAccountByPaymentIntent(parsed.correlationRef);
    if (!intent) {
      // Permanent: cannot resolve the account — never guess (INV-3). Dead-letter in-txn.
      return this.deadInTx(
        repos,
        row,
        new UnresolvableOperatorEventError(`no payment_intent for extOrderId ${parsed.correlationRef}`),
      );
    }
    if (intent.status === 'CONFIRMED') {
      // Intent-level idempotency (defence-in-depth): a distinct event resolving to an
      // already-settled intent must not double-credit. Dead-letter for back-office.
      return this.deadInTx(
        repos,
        row,
        new UnresolvableOperatorEventError(`payment_intent ${parsed.correlationRef} already confirmed`),
      );
    }

    // Record the operator-confirmed amount (authoritative); flag a mismatch against
    // the intent (M1 floor: structured warn + would feed a metric — persisting a
    // reconciliation_mismatches row ships with the reconciliation epic, Decision 4).
    if (parsed.amountMinor !== intent.amountMinor || parsed.currency !== intent.currency) {
      this.logger.warn(
        {
          operator: row.operator,
          operatorEventId: row.operatorEventId,
          confirmedMinor: parsed.amountMinor.toString(),
          confirmedCurrency: parsed.currency,
          expectedMinor: intent.amountMinor.toString(),
          expectedCurrency: intent.currency,
        },
        'operator amount mismatch',
      );
    }

    const amount = Money.of(parsed.amountMinor, parsed.currency);
    // Operator-qualified idempotency key (tech-spec Decision 2): payu:${orderId}:COMPLETED.
    const idempotencyKey = `${row.operator}:${row.operatorEventId}`;

    const recorded = await recordAndAllocate(repos, {
      accountId: intent.accountId,
      amount,
      operatorReference: parsed.operatorReference,
      idempotencyKey,
    });

    // Settle the intent atomically with the ledger effect (status visibility +
    // intent-level idempotency for any later event).
    await repos.payments.confirmPaymentIntent(parsed.correlationRef, recorded.paymentId);
    await repos.operatorEvents.markProcessed(row.id, recorded.paymentId);
    return { kind: 'processed' };
  }

  /** Dead-letter a row inside the current transaction (permanent failure; no ledger
   *  write was attempted, so there is nothing to roll back). */
  private async deadInTx(
    repos: RepositoryBundle,
    row: OperatorEventRow,
    err: Error,
  ): Promise<{ kind: 'dead' }> {
    await repos.operatorEvents.markDead(row.id, err.message);
    return { kind: 'dead' };
  }

  /** Book a transient failure in a fresh transaction after the apply rolled back:
   *  retry with backoff, or DEAD once attempts are exhausted. A concurrent
   *  unique-violation means a sibling already recorded it — treat as processed. */
  private async recordFailure(row: OperatorEventRow, err: unknown): Promise<'failed' | 'dead'> {
    const message = err instanceof Error ? err.message : String(err);
    const nextAttempts = row.attempts + 1;
    const exhausted = nextAttempts >= MAX_ATTEMPTS;

    await this.deps.unitOfWork.withTransaction(async (repos) => {
      if (err instanceof DuplicateIdempotencyKeyError) {
        // The payment already exists (a sibling won); mark done, do not retry.
        await repos.operatorEvents.markProcessed(row.id, null);
        return;
      }
      if (exhausted) await repos.operatorEvents.markDead(row.id, message);
      else await repos.operatorEvents.markFailed(row.id, message, backoffFrom(row.attempts, new Date()));
    });

    if (err instanceof DuplicateIdempotencyKeyError) return 'failed'; // counted, but not a real failure
    return exhausted ? 'dead' : 'failed';
  }
}
