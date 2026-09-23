Feature: Refunds and maker/checker governance
  Every refund, adjustment, and dunning override goes through four-eyes approval,
  is audited with both identities, and can never over-refund a payment.

  Background:
    Given a parent account "Nowak" in PLN
    And a settled PAYMENT "pay-1" of 15000 minor units on "Nowak"
    And back-office users "Ola" and "Marek"

  @AC-23
  Scenario: A refund needs a checker different from the maker
    When "Ola" initiates a refund of 15000 minor units against "pay-1"
    And "Marek" approves it
    Then the refund is executed as a -15000 reversing entry

  @AC-23
  Scenario: A maker cannot approve their own refund
    When "Ola" initiates a refund of 15000 minor units against "pay-1"
    And "Ola" attempts to approve it
    Then the payments service rejects the self-approval

  @AC-24
  Scenario: An approved correction records both identities and a correlation id
    When "Ola" initiates a refund of 15000 minor units against "pay-1"
    And "Marek" approves it
    Then the audit log records maker "Ola", checker "Marek", and a correlation id

  @AC-25 @AC-23
  Scenario: A refund exceeding the captured amount is rejected
    Given a refund of 15000 minor units against "pay-1" has already been executed
    When "Ola" initiates a further refund of 1 minor unit against "pay-1"
    And "Marek" approves it
    Then the payments service rejects it because cumulative refunds would exceed the captured amount

  @AC-28
  Scenario Outline: The 100 PLN threshold decides whether a refund needs a checker
    When "Ola" initiates a refund of <amount> minor units against "pay-1"
    Then the refund <approval>

    Examples:
      | amount | approval                          |
      | 9000   | is auto-approved without a checker |
      | 10000  | is auto-approved without a checker |
      | 10001  | requires a separate checker        |

  @AC-27
  Scenario: A bulk correction requires senior approval and a dry-run
    When a bulk correction across 40 accounts is prepared
    Then it requires senior approval and a completed dry-run before execution
    And each corrected entry is logged individually
