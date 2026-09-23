/** Inbox row status (mirrors the operator_events.status CHECK). M1 uses a subset:
 *  PENDING → PROCESSED, or FAILED → DEAD. DUPLICATE/REJECTED are reserved. */
export type OperatorEventStatus =
  | 'PENDING'
  | 'PROCESSED'
  | 'FAILED'
  | 'DEAD'
  | 'DUPLICATE'
  | 'REJECTED';

/** A claimed inbox row handed to the relay for one apply attempt. `payload` is the
 *  operator-specific object stored at ingest (interpreted by the operator adapter). */
export interface OperatorEventRow {
  id: string;
  operator: string;
  operatorEventId: string;
  eventType: string | null;
  payload: unknown;
  status: OperatorEventStatus;
  attempts: number;
}

/** The operator-specific payload parsed into our vocabulary. The target account is
 *  NOT resolved here (that is a DB step the relay performs via the correlation ref);
 *  parsing stays framework/DB-free. See tech-spec Decision 4/5. */
export interface ParsedOperatorEvent {
  /** The operator's own reference for the payment (PayU `orderId`) — stored as
   *  `payments.operator_reference`. */
  operatorReference: string;
  /** Our correlation anchor echoed back by the operator (PayU `extOrderId`), used
   *  to resolve the payment_intent / account. */
  correlationRef: string;
  /** Operator status mapped to our vocabulary; only `COMPLETED` records money. */
  status: string;
  /** Minor units — parsed from a string, never a JS number (precision, tech-spec §7). */
  amountMinor: bigint;
  currency: string;
}
