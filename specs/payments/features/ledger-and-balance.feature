Feature: Ledger integrity and the materialized balance
  The parent balance is always the sum of that parent's append-only ledger entries,
  maintained atomically and correctly under concurrency.

  Background:
    Given a parent account "Nowak" with a zero balance in PLN

  @AC-1
  Scenario: An onboarded parent has a zero balance before any charge
    When the parent "Nowak" is onboarded
    Then a balance row for "Nowak" exists with 0 minor units
    And a balance read returns 0, not null

  @AC-5
  Scenario: Appending an entry updates the balance in the same transaction
    When a CHARGE of 15000 minor units is posted to "Nowak"
    Then the ledger holds a CHARGE entry of -15000 minor units
    And the balance reads -15000 minor units

  @AC-6
  Scenario: Concurrent writes to one account keep the balance consistent
    Given a webhook-driven PAYMENT of 15000 minor units for "Nowak"
    And a manual ADJUSTMENT of -5000 minor units for "Nowak"
    When both commit at the same time
    Then they serialize on the "Nowak" balance row
    And the balance equals the sum of all "Nowak" ledger entries

  @AC-10
  Scenario: A posted entry is corrected by a reversing entry, never edited
    Given a posted ADJUSTMENT of -5000 minor units on "Nowak"
    When the correction is reversed
    Then a new reversing entry of 5000 minor units is appended
    And the original -5000 entry is unchanged

  @AC-9
  Scenario: An operator fee is never posted to the parent balance
    Given a settled payment of 15000 minor units on "Nowak" with an operator fee of 300 minor units
    When the fee is recorded
    Then a FEE entry of 300 minor units is on the house/settlement ledger
    And the "Nowak" balance does not include the fee

  @AC-8
  Scenario: A non-PLN money movement is rejected
    When a CHARGE of 15000 minor units in "EUR" is posted to "Nowak"
    Then the payments service rejects the request
