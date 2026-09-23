/**
 * Canonical charge/payment state machine (AC-11). Operator outcomes are mapped
 * onto these states; operator vocabulary is never stored. This epic exercises
 * only the `PENDING → SETTLED` settle path; the other states are declared here so
 * the union matches the DB CHECK and the OpenAPI enum, but their transitions are
 * out of scope (see the tech spec, NG-B).
 */
export type ChargeStatus =
  | 'PENDING'
  | 'REQUIRES_ACTION'
  | 'AUTHORIZED'
  | 'SETTLED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'FAILED';
