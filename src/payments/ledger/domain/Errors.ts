/** Base for errors that represent a broken domain rule (vs. an infra failure). */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AccountNotFoundError extends DomainError {
  readonly code = 'ACCOUNT_NOT_FOUND';
  constructor(accountId: string) {
    super(`Account ${accountId} not found`);
  }
}

export class CurrencyMismatchError extends DomainError {
  readonly code = 'CURRENCY_MISMATCH';
  constructor(a: string, b: string) {
    super(`Currency mismatch: ${a} vs ${b}`);
  }
}

export class InvalidMoneyError extends DomainError {
  readonly code = 'INVALID_MONEY';
}

/** Raised when the idempotency key is already taken (unique-constraint race). */
export class DuplicateIdempotencyKeyError extends DomainError {
  readonly code = 'DUPLICATE_IDEMPOTENCY_KEY';
  constructor(public readonly key: string) {
    super(`Idempotency key already used: ${key}`);
  }
}

/** Raised when a charge references an enrollment that does not exist (→ 404). */
export class EnrollmentNotFoundError extends DomainError {
  readonly code = 'ENROLLMENT_NOT_FOUND';
  constructor(enrollmentId: string) {
    super(`Enrollment ${enrollmentId} not found`);
  }
}

/** Raised when a charge is looked up by an id that does not exist (→ 404). */
export class ChargeNotFoundError extends DomainError {
  readonly code = 'CHARGE_NOT_FOUND';
  constructor(chargeId: string) {
    super(`Charge ${chargeId} not found`);
  }
}

/** Raised when a pagination cursor is malformed (→ 400, bad request). */
export class InvalidCursorError extends DomainError {
  readonly code = 'INVALID_CURSOR';
  constructor() {
    super('Invalid pagination cursor');
  }
}

/** Raised when a tax breakdown would violate INV-7 (`gross == net + tax`) or omit
 *  a required legal reason for an EXEMPT/ZERO_RATED line (AC-33). */
export class InvalidTaxBreakdownError extends DomainError {
  readonly code = 'INVALID_TAX_BREAKDOWN';
  constructor(net: bigint, tax: bigint, gross: bigint) {
    super(`Invalid tax breakdown: gross ${gross} != net ${net} + tax ${tax}, or missing legal reason`);
  }
}
