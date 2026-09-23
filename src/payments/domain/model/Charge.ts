import type { ChargeStatus } from './ChargeStatus';
import type { TaxTreatment } from './TaxBreakdown';

/**
 * Domain-facing representation of a persisted charge. Money is `bigint` minor
 * units; `taxRate` is kept as a decimal string (Postgres `numeric`) to avoid
 * float drift, mirroring the `bigint`-as-string convention for money.
 */
export interface ChargeRecord {
  id: string;
  accountId: string;
  enrollmentId: string | null;
  studentId: string | null;
  status: ChargeStatus;
  currency: string;
  netMinor: bigint;
  taxMinor: bigint;
  grossMinor: bigint;
  taxRate: string;
  taxTreatment: TaxTreatment;
  taxLegalReason: string | null;
  taxJurisdiction: string;
  createdAt: Date;
}
