Feature: Operator degraded mode
  When an operator fails or is unavailable, work retries with bounded backoff then
  dead-letters, failover is manual for M1, and push payments keep flowing.

  Background:
    Given a parent account "Nowak" in PLN
    And an operator "PayU"

  @AC-45
  Scenario: A failing operator call retries then dead-letters
    Given a pull charge of 15000 minor units for "Nowak"
    When the PayU call fails on every attempt
    Then it is retried with bounded exponential backoff up to 5 attempts
    And it is then routed to the dead-letter queue and the back-office queue

  @AC-46
  Scenario: Operator failover is manual for M1
    Given PayU is unavailable
    When an operator switch is required
    Then a back-office user performs a manual operator failover

  @AC-47
  Scenario: Push payments are accepted while pull is degraded
    Given pull processing is degraded
    When "Nowak" initiates a push payment of 15000 minor units
    Then the payments service accepts the push payment
