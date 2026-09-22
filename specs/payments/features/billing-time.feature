Feature: Billing day and time boundaries
  Billing days are computed on the Europe/Warsaw business calendar with month-end
  clamping, refunds are never back-dated, and reconciliation uses the operator window.

  Background:
    Given the business timezone is Europe/Warsaw
    And a parent account "Nowak" with a subscription billing day of 31

  @AC-35
  Scenario Outline: Billing day clamps to month-end for short months
    Given the billing month is <month>
    When the billing run resolves the billing date
    Then the billing date is <billing_date>

    Examples:
      | month         | billing_date |
      | 2026-01 (Jan) | 2026-01-31   |
      | 2026-02 (Feb) | 2026-02-28   |
      | 2026-04 (Apr) | 2026-04-30   |

  @AC-34
  Scenario: Billing day is a Warsaw calendar date while instants store in UTC
    When a charge is billed on the billing day
    Then the billing day is a Europe/Warsaw calendar date
    And the entry's timestamp is stored in UTC

  @AC-36
  Scenario: A refund crossing a month boundary is dated at event time, not back-dated
    Given a payment settled on 2026-07-28
    When it is refunded on 2026-08-02
    Then a reversing entry is dated 2026-08-02
    And it is not back-dated into July

  @AC-37
  Scenario: Reconciliation groups events by the operator settlement window
    Given operator settlement window boundaries differ from Warsaw midnight
    When events are grouped for the daily three-way match
    Then they are grouped by the operator settlement window, not the business timezone
