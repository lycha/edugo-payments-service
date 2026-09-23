import { sql } from 'kysely';
import type { OperatorEventRepository } from '../../domain/port/OperatorEventRepository';
import type { OperatorEventRow, OperatorEventStatus } from '../../domain/model/OperatorEvent';
import type { Executor } from './PaymentDao';

/** Kysely DAO over the operator_events inbox, bound to one executor. Mirrors
 *  PaymentDao conventions (Executor; jsonb via JSON.stringify). */
export class OperatorEventDao implements OperatorEventRepository {
  constructor(private readonly db: Executor) {}

  async insertReceived(input: {
    operator: string;
    operatorEventId: string;
    eventType: string | null;
    payload: unknown;
    signatureVerified: boolean;
  }): Promise<{ id: string; duplicate: boolean }> {
    // ON CONFLICT DO NOTHING rather than catching 23505: a raised unique violation
    // aborts the *enclosing* transaction (the ingest handler wraps this in one), so
    // a follow-up SELECT would fail. DO NOTHING dedupes without aborting — a
    // redelivery returns no row, and we then read the original id in the same txn.
    const inserted = await this.db
      .insertInto('operator_events')
      .values({
        operator: input.operator,
        operator_event_id: input.operatorEventId,
        event_type: input.eventType,
        signature_verified: input.signatureVerified,
        // jsonb: pass a JSON text string; Postgres parses it into the object.
        payload: JSON.stringify(input.payload ?? null),
        status: 'PENDING',
      })
      .onConflict((oc) => oc.columns(['operator', 'operator_event_id']).doNothing())
      .returning('id')
      .executeTakeFirst();

    if (inserted) return { id: inserted.id, duplicate: false };

    const existing = await this.db
      .selectFrom('operator_events')
      .select('id')
      .where('operator', '=', input.operator)
      .where('operator_event_id', '=', input.operatorEventId)
      .executeTakeFirstOrThrow();
    return { id: existing.id, duplicate: true };
  }

  async claimDueOne(now: Date): Promise<OperatorEventRow | null> {
    const row = await this.db
      .selectFrom('operator_events')
      .select([
        'id',
        'operator',
        'operator_event_id',
        'event_type',
        'payload',
        'status',
        'attempts',
      ])
      .where('status', 'in', ['PENDING', 'FAILED'])
      .where((eb) =>
        eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', now)]),
      )
      .orderBy('received_at', 'asc')
      .limit(1)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();

    if (!row) return null;
    return {
      id: row.id,
      operator: row.operator,
      operatorEventId: row.operator_event_id,
      eventType: row.event_type,
      payload: row.payload,
      status: row.status as OperatorEventStatus,
      attempts: row.attempts,
    };
  }

  async markProcessed(id: string, paymentId: string | null): Promise<void> {
    await this.db
      .updateTable('operator_events')
      .set({ status: 'PROCESSED', payment_id: paymentId, processed_at: sql`now()`, last_error: null })
      .where('id', '=', id)
      .execute();
  }

  async markFailed(id: string, error: string, nextAttemptAt: Date): Promise<void> {
    await this.db
      .updateTable('operator_events')
      .set({
        status: 'FAILED',
        attempts: sql`attempts + 1`,
        next_attempt_at: nextAttemptAt,
        last_error: error,
      })
      .where('id', '=', id)
      .execute();
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.db
      .updateTable('operator_events')
      .set({ status: 'DEAD', attempts: sql`attempts + 1`, last_error: error })
      .where('id', '=', id)
      .execute();
  }
}
