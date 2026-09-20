/**
 * Ledger entry types. The ledger is append-only and the account balance is the
 * signed sum of its entries. Sign convention: PAYMENT/CREDIT are positive,
 * CHARGE/FEE/CHARGEBACK are negative (enforced by callers per entry type).
 */
export type LedgerEntryType =
  | 'CHARGE'
  | 'PAYMENT'
  | 'REFUND'
  | 'PARTIAL_REFUND'
  | 'DISCOUNT'
  | 'LATE_FEE'
  | 'ADJUSTMENT'
  | 'CREDIT'
  | 'FEE'
  | 'CHARGEBACK';
