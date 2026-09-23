Feature: Charge and payment lifecycle
  Charges move through the payments service's own canonical state machine; a payment
  is only ever recorded on operator confirmation, and unconfirmed charges expire.

  Background:
    Given a parent account "Nowak" with an active enrollment "Class 3B Math"
    And an operator "PayU"

  @AC-13
  Scenario: A payment is recorded only on operator confirmation
    Given a charge of 15000 minor units in PENDING for "Nowak"
    When PayU confirms the capture
    Then a PAYMENT ledger entry of 15000 minor units is recorded
    And the charge is SETTLED

  @AC-12 @ASM-2
  Scenario Outline: A charge with no confirmation expires after 72 hours
    Given a charge of 15000 minor units in PENDING for "Nowak"
    And <elapsed> have passed with no operator confirmation
    When the expiry sweep runs
    Then the charge status is <status>
    And it is <recorded_as_paid> recorded as paid

    Examples:
      | elapsed  | status  | recorded_as_paid |
      | 71 hours | PENDING | not              |
      | 72 hours | EXPIRED | not              |
      | 96 hours | EXPIRED | not              |

  @AC-16
  Scenario: A declined charge enters dunning
    Given a charge of 15000 minor units in PENDING for "Nowak"
    When PayU declines the charge
    Then the charge status is DECLINED
    And the charge enters dunning

  @AC-16
  Scenario: An expired charge goes to reconciliation, not dunning
    Given a charge of 15000 minor units that reached EXPIRED after 72 hours
    Then the charge is routed to reconciliation
    And the charge does not enter dunning

  @AC-26
  Scenario: A pending charge can be cancelled
    Given a charge of 15000 minor units in PENDING for "Nowak"
    When the charge is cancelled
    Then the charge is cancelled without a reversing entry

  @AC-26
  Scenario: A settled charge is reversed only by refund or chargeback
    Given a charge of 15000 minor units that is SETTLED for "Nowak"
    When a reversal of the settled charge is attempted directly
    Then the payments service rejects the direct reversal
    And requires a refund or chargeback reversing entry instead
