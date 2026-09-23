import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentOperator } from '../../domain/port/PaymentOperator';
import type { ParsedOperatorEvent } from '../../domain/model/OperatorEvent';
import { MalformedOperatorEventError } from '../../domain/Errors';

/** HMAC-SHA256 of the raw body under `secret`, hex. Shared by the adapter and by
 *  test fixtures so both sign identically (the real PayU format is an open item —
 *  tech-spec §10 #1; this stands in for it in M1, ASM-1). */
export function signPayU(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

/** M1 mock of a PayU-shaped operator: verifies an HMAC over the raw body and parses
 *  a `{ order: {...} }` payload. No live PayU call or real secret (ASM-1). */
export class MockPayUOperator implements PaymentOperator {
  readonly name = 'payu';

  constructor(private readonly deps: { operatorWebhookSecret: string }) {}

  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = signPayU(rawBody, this.deps.operatorWebhookSecret);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    // Length check first: timingSafeEqual throws on unequal lengths.
    return a.length === b.length && timingSafeEqual(a, b);
  }

  parse(payload: unknown): ParsedOperatorEvent {
    const order = (payload as { order?: Record<string, unknown> } | null)?.order;
    if (!order || typeof order !== 'object') {
      throw new MalformedOperatorEventError('missing order object');
    }
    const orderId = order.orderId;
    const extOrderId = order.extOrderId;
    const status = order.status;
    const currency = order.currencyCode;
    const totalAmount = order.totalAmount;

    if (typeof orderId !== 'string' || typeof status !== 'string' || typeof currency !== 'string') {
      throw new MalformedOperatorEventError('orderId, status and currencyCode must be strings');
    }
    if (typeof extOrderId !== 'string') {
      throw new MalformedOperatorEventError('extOrderId (correlation ref) must be a string');
    }
    // Money crosses the JSON boundary as a string → BigInt, never a JS number
    // (precision, tech-spec §7). PayU sends totalAmount as a minor-unit string.
    if (typeof totalAmount !== 'string' || !/^\d+$/.test(totalAmount)) {
      throw new MalformedOperatorEventError('totalAmount must be a non-negative integer string');
    }

    return {
      operatorReference: orderId,
      correlationRef: extOrderId,
      status,
      amountMinor: BigInt(totalAmount),
      currency,
    };
  }
}
