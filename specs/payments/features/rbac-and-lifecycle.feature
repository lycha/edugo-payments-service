Feature: RBAC, data minimisation, and account lifecycle
  Access follows the role matrix, only parent billing PII is stored, and cancellation
  preserves the ledger while returning credit and retaining arrears.

  Background:
    Given a parent account "Nowak" with child "Zofia" enrolled in "Class 3B Math"

  @AC-48
  Scenario Outline: The RBAC matrix governs who may do what
    When a <role> attempts to <action>
    Then the payments service <result> it

    Examples:
      | role       | action                              | result  |
      | Parent     | view another parent's account       | denies  |
      | Accounting | mutate a balance                    | denies  |
      | Accounting | read and hand off an invoice        | allows  |
      | Student    | access any payments operation       | denies  |
      | Admin      | post a correction without a checker | denies  |

  @AC-49 @AC-50
  Scenario: Student data is referenced by ID and rendered on the invoice at generation time
    When an invoice is generated for "Nowak"
    Then the student is referenced by internal ID in stored records
    And the student name "Zofia" and enrollment "Class 3B Math" are rendered at generation time
    And no student PII is stored in payments

  @AC-38
  Scenario: Cancelling a subscription prorates the current charge and keeps the ledger
    Given "Nowak" has an active subscription billed at 15000 minor units per month
    When the subscription is cancelled mid-cycle
    Then future billing stops
    And the current charge is prorated to actual usage
    And the account and its ledger are retained, not deleted

  @AC-39
  Scenario: Residual credit is refunded and residual arrears survive cancellation
    Given "Nowak" has residual credit of 5000 minor units at cancellation
    Then the residual credit is refunded to the parent
    And any residual arrears survive cancellation, clearable only via an audited ADJUSTMENT write-off

  @AC-40 @ASM-4
  Scenario: GDPR erasure is blocked while an open debt needs the billing contact
    Given "Nowak" has an open unpaid debt in dispute
    When a GDPR erasure is requested for "Nowak"
    Then the erasure is blocked while the debt needs the billing contact
    And financial records are retained for 5 years with billing PII redacted and soft-deleted only
