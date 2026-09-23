import { InvalidTaxBreakdownError } from '#payments/ledger/domain/Errors';
import type { Money } from '#payments/ledger/domain/model/Money';

export type TaxTreatment = 'STANDARD' | 'REDUCED' | 'ZERO_RATED' | 'EXEMPT';

/**
 * Per-line tax breakdown (AC-29). Immutable value object enforcing INV-7
 * (`gross == net + tax`) at construction. Money is `bigint` minor units; `rate`
 * is a decimal string (never a float).
 *
 * M1 is EXEMPT-only (see tech spec, Decision 5 / NG-A): every charge resolves to
 * `EXEMPT` (tax = 0, gross = net). Computing tax from a non-exempt rate — with
 * AC-31 half-up rounding — is deferred with the effective-dated engine and, when
 * built, belongs here as an additional factory, keeping the tax math in the
 * domain rather than the DAO.
 */
export class TaxBreakdown {
  private constructor(
    readonly currency: string,
    readonly netMinor: bigint,
    readonly taxMinor: bigint,
    readonly grossMinor: bigint,
    readonly rate: string,
    readonly treatment: TaxTreatment,
    readonly legalReason: string | null,
    readonly jurisdiction: string,
  ) {
    if (grossMinor !== netMinor + taxMinor) {
      throw new InvalidTaxBreakdownError(netMinor, taxMinor, grossMinor);
    }
    if ((treatment === 'EXEMPT' || treatment === 'ZERO_RATED') && !legalReason) {
      throw new InvalidTaxBreakdownError(netMinor, taxMinor, grossMinor);
    }
  }

  /** EXEMPT treatment: tax is zero, gross equals net (the only M1 outcome). */
  static exempt(net: Money, jurisdiction: string, legalReason: string): TaxBreakdown {
    return new TaxBreakdown(
      net.currency,
      net.amountMinor,
      0n,
      net.amountMinor,
      '0.0000',
      'EXEMPT',
      legalReason,
      jurisdiction,
    );
  }
}
