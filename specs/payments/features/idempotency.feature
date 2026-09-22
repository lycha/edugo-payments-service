Feature: Idempotency on money-moving operations
  Every money-moving mutation and every operator event takes effect at most once,
  so retries, double-clicks, and redelivered webhooks never move money twice.

  Background:
    Given a parent account "Nowak" with a zero balance in PLN
    And an operator "PayU"

  @AC-17
  Scenario: A refund without an idempotency key is rejected
    Given a settled payment of 15000 minor units on the "Nowak" account
    When a refund of 15000 minor units is requested without an idempotency key
    Then the payments service rejects the request
    And no ledger entry is written

  @AC-18
  Scenario: Replaying a payment with an already-applied key is a no-op
    Given a payment of 15000 minor units was recorded with idempotency key "pay-2026-09-abc"
    When the same payment request with key "pay-2026-09-abc" is received again
    Then no second PAYMENT ledger entry is written
    And the original result is returned

  @AC-15 @AC-18 @ASM-1
  Scenario: A redelivered operator event is applied at most once
    Given operator event "evt-771" for a 15000 minor unit capture has been applied
    When PayU redelivers operator event "evt-771"
    Then the payments service deduplicates it on "(PayU, evt-771)"
    And the parent balance is unchanged

  @AC-14 @ASM-1
  Scenario: An operator event failing HMAC verification is rejected
    Given an inbound operator event with an invalid HMAC signature
    When the payments service receives it
    Then the event is rejected
    And no ledger effect is recorded
