import type { OperatorEventRow } from '../model/OperatorEvent';

/**
 * Driven port for the transactional inbox (`operator_events`). Executor-bound like
 * the other repos; supplied inside a {@link UnitOfWork} transaction so the relay's
 * apply and mark-processed commit atomically (ADR-0003, tech-spec Decision 3).
 */
export interface OperatorEventRepository {
  /**
   * Insert a verified event, deduped on (operator, operatorEventId). A unique
   * violation is surfaced as `{ duplicate: true }` (INV-2 at the door), not thrown.
   */
  insertReceived(input: {
    operator: string;
    operatorEventId: string;
    eventType: string | null;
    payload: unknown;
    signatureVerified: boolean;
  }): Promise<{ id: string; duplicate: boolean }>;

  /**
   * Claim the oldest due row (`PENDING`, or `FAILED` past its backoff) with
   * `FOR UPDATE SKIP LOCKED` so concurrent relays never double-claim. Returns null
   * when nothing is due.
   */
  claimDueOne(now: Date): Promise<OperatorEventRow | null>;

  /** Mark a row applied, linking the resulting payment (audit trail). */
  markProcessed(id: string, paymentId: string | null): Promise<void>;

  /** Increment attempts, set FAILED + backoff + last_error (row is retried later). */
  markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void>;

  /** Increment attempts, set DEAD + last_error (dead-letter; back-office triage). */
  markDead(id: string, error: string): Promise<void>;
}
