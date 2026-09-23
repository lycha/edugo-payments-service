import type { ParsedOperatorEvent } from '../model/OperatorEvent';

/**
 * Driven port for a payment operator (PayU, later Tpay/Stripe). One interface, N
 * adapters, selected by the `operator` on the event. Framework/DB-free: the adapter
 * verifies the HMAC and parses its payload into our vocabulary; resolving the parsed
 * event to an account is a DB step the relay performs (tech-spec Decision 4/5).
 */
export interface PaymentOperator {
  /** Registry key / `operator` value on inbound events (e.g. `payu`). */
  readonly name: string;

  /**
   * Constant-time HMAC check of the raw request body against the configured secret.
   * `rawBody` is the exact bytes received (as a string), never a re-serialized body.
   */
  verifySignature(rawBody: string, signature: string | undefined): boolean;

  /**
   * Parse the operator-specific payload into {@link ParsedOperatorEvent}. Throws
   * MalformedOperatorEventError for an uninterpretable payload (permanent failure).
   */
  parse(payload: unknown): ParsedOperatorEvent;
}

/** Registry of operator adapters keyed by {@link PaymentOperator.name}. */
export type PaymentOperatorRegistry = ReadonlyMap<string, PaymentOperator>;
