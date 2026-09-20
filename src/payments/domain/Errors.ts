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
