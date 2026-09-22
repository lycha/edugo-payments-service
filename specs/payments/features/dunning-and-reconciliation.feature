Feature: Dunning, recovery, and reconciliation mismatches
  Failed charges follow a fixed Warsaw-business-day dunning schedule, recovery is
  immediate on payment, and reconciliation mismatches go to the back office, never
  to the parent.

  Background:
    Given a parent account "Nowak" in PLN
    And an operator "PayU"

  @AC-41 @AC-42 @ASM-3
  Scenario: A failed charge follows the dunning schedule and blocks at day 14
    Given a charge of 15000 minor units becomes FAILED on a Warsaw business day (Day 0)
    When dunning runs across the cycle
    Then one comms message is sent on Day 0, +3, +7, and +10
    And access is blocked at +14 with a block-notice message while the charge is still unpaid
    And the cycle sends at most 5 messages
    And the messages are sent over email and in-app

  @AC-42
  Scenario: Dunning comms hold outside the send-window
    Given a dunning step falls due at 21:30 Europe/Warsaw
    When the step fires
    Then the message is held until 09:00 Europe/Warsaw the next in-window time
    And no message is sent between 20:00 and 09:00 Europe/Warsaw

  @AC-42
  Scenario: Multiple failed charges for one parent are digested into one message
    Given three charges for "Nowak" fail on the same day
    When the dunning step fires
    Then a single message digests all three failed charges

  @AC-43
  Scenario: Any successful payment clears dunning and unblocks access
    Given "Nowak" is access-blocked under dunning
    When any payment succeeds for "Nowak"
    Then access is unblocked immediately
    And the dunning state is cleared

  @AC-44
  Scenario: A reconciliation mismatch goes to the back office, not the parent
    Given the daily three-way match finds a settled payment with no matching ledger entry
    When the mismatch is detected within 24 hours
    Then it is routed to the back-office queue with an ops alert
    And the parent is not notified
