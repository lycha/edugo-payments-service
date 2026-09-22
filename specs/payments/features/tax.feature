Feature: Tax breakdown on charges and invoices
  Tax is computed inside payments in gross, with a per-line net/tax/gross breakdown,
  per-line half-up rounding, and every line shown on the invoice.

  Background:
    Given a parent account "Nowak" in PLN
    And the tax rate table resolves Polish tuition to EXEMPT at 0%

  @AC-29 @AC-30
  Scenario: A tuition charge carries a net/tax/gross breakdown and posts gross to the ledger
    When a tuition CHARGE for enrollment "Class 3B Math" is posted at net 15000 minor units
    Then the charge records net 15000, tax 0, gross 15000 minor units, treatment EXEMPT, jurisdiction PL
    And a single CHARGE entry of -15000 minor units (gross) is posted to the ledger
    And no separate net or tax ledger entry is created

  @AC-33
  Scenario: An exempt line still appears on the invoice with its legal reason
    Given a tuition line with treatment EXEMPT
    When the invoice is generated
    Then the exempt line appears with its legal reason code and a tax amount of 0

  @AC-31 @AC-29
  Scenario: Tax rounds per line, half-up, then sums
    Given a STANDARD-rated invoice with two lines each of net 1000 minor units at 23%
    When the invoice total is computed
    Then each line's tax rounds half-up to 230 minor units
    And the invoice tax total is 460 minor units
    And the total is not recomputed on the summed net
