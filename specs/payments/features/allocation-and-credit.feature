Feature: Payment allocation and credit
  Payments settle open charges oldest-first, no charge is double-paid, and any
  overpayment is held as credit on the parent balance.

  Background:
    Given a parent account "Nowak" in PLN
    And an open CHARGE "chg-jul" of 15000 minor units dated 2026-07-01
    And an open CHARGE "chg-aug" of 15000 minor units dated 2026-08-01

  @AC-19
  Scenario: A partial payment is allocated oldest-first
    When a payment of 15000 minor units is allocated for "Nowak"
    Then "chg-jul" is fully settled
    And "chg-aug" remains open

  @AC-20 @AC-21
  Scenario: Concurrent payments do not double-pay and overpayment becomes credit
    When two payments of 15000 minor units each are allocated for "Nowak" at the same time
    Then the target charges are locked FOR UPDATE during allocation
    And "chg-jul" and "chg-aug" are each paid exactly once
    And no charge is paid twice

  @AC-21
  Scenario: Overpayment beyond open charges becomes credit
    When a payment of 35000 minor units is allocated for "Nowak"
    Then "chg-jul" and "chg-aug" are settled
    And the remaining 5000 minor units are held as credit on the "Nowak" balance

  @AC-22
  Scenario: Residual credit with no refundable capture is paid out manually
    Given "Nowak" holds 5000 minor units of credit from a push overpayment with no refundable original capture
    When the residual credit is returned on account close
    Then it is returned via a manual disbursement payout
    And the payout is recorded as an audited maker/checker action
