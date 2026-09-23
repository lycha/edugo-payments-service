import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB } from '#generated/platform/db/schema';
import { signPayU } from '../../src/payments/ledger/adapter/operator/MockPayUOperator';

/** Matches buildContainer's default operator secret used in tests. */
export const TEST_OPERATOR_SECRET = 'dev-operator-webhook-secret';

export async function seedAccount(db: Kysely<DB>): Promise<string> {
  const row = await db
    .insertInto('accounts')
    .values({ external_ref: randomUUID() })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Seed a payment_intent — the operator correlation anchor (PayU `extOrderId`). */
export async function seedPaymentIntent(
  db: Kysely<DB>,
  input: { accountId: string; amountMinor: bigint; currency?: string },
): Promise<string> {
  const row = await db
    .insertInto('payment_intents')
    .values({
      account_id: input.accountId,
      amount_minor: input.amountMinor.toString(),
      currency: input.currency ?? 'PLN',
      status: 'CREATED',
      operator: 'payu',
      idempotency_key: randomUUID(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

export interface PayUEventInput {
  extOrderId: string;
  amountMinor: bigint;
  orderId?: string;
  status?: string;
  currency?: string;
  operatorEventId?: string;
  secret?: string;
}

export interface BuiltPayUEvent {
  body: unknown;
  raw: string;
  signature: string;
  orderId: string;
  operatorEventId: string;
}

/** Build a PayU-shaped OperatorEvent body plus a valid HMAC over its exact bytes. */
export function buildPayUEvent(input: PayUEventInput): BuiltPayUEvent {
  const orderId = input.orderId ?? `PAYU-${randomUUID()}`;
  const status = input.status ?? 'COMPLETED';
  const operatorEventId = input.operatorEventId ?? `${orderId}:${status}`;
  const body = {
    operatorEventId,
    type: `ORDER_${status}`,
    payload: {
      order: {
        orderId,
        extOrderId: input.extOrderId,
        status,
        currencyCode: input.currency ?? 'PLN',
        totalAmount: String(input.amountMinor),
      },
    },
  };
  const raw = JSON.stringify(body);
  return {
    body,
    raw,
    signature: signPayU(raw, input.secret ?? TEST_OPERATOR_SECRET),
    orderId,
    operatorEventId,
  };
}
