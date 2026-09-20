import { CurrencyMismatchError, InvalidMoneyError } from '../Errors';

/**
 * Money value object. Amounts are integer minor units (grosze) held as `bigint`
 * — never floats. Immutable; arithmetic returns new instances.
 */
export class Money {
  private constructor(
    readonly amountMinor: bigint,
    readonly currency: string,
  ) {}

  static of(amountMinor: bigint, currency: string): Money {
    if (typeof amountMinor !== 'bigint') {
      throw new InvalidMoneyError('amountMinor must be a bigint (minor units)');
    }
    const normalized = currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new InvalidMoneyError(`Invalid currency code: ${currency}`);
    }
    return new Money(amountMinor, normalized);
  }

  static zero(currency: string): Money {
    return Money.of(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  negate(): Money {
    return new Money(-this.amountMinor, this.currency);
  }

  isPositive(): boolean {
    return this.amountMinor > 0n;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}
