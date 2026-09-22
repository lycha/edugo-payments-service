# Charge / payment state machine

**Status:** Draft · **Date:** 2026-09-21 · **Author:** Krzysztof Jackowski

EduGo's **own** canonical charge/payment lifecycle — not operator vocabulary; operator outcomes are
mapped onto these states. Source: `specs/payments/glossary.md` (state machine), `decisions.yaml`
(ABS-2, ABS-12), `feature-inventory.yaml` (TRN-1…8), ASM-2 (72h).

**Related:** [PRD](../prd.md) · [glossary](../../specs/payments/glossary.md)

```mermaid
stateDiagram-v2
    direction TB

    state "FAILED / DECLINED" as FAILDECL

    [*] --> PENDING: billing run (pull) / first-order charge

    PENDING --> REQUIRES_ACTION: Strong Customer Authentication required (first payment)
    PENDING --> AUTHORIZED: merchant-initiated auth OK (recurring, no auth step)
    REQUIRES_ACTION --> AUTHORIZED: customer authentication completed
    AUTHORIZED --> SETTLED: captured → PAYMENT ledger entry

    PENDING --> FAILDECL: operator declines / pull charge fails
    REQUIRES_ACTION --> FAILDECL: authentication failed / abandoned
    PENDING --> EXPIRED: no confirmation for 72h
    REQUIRES_ACTION --> EXPIRED: no confirmation for 72h
    PENDING --> CANCELLED: cancelled before settle
    REQUIRES_ACTION --> CANCELLED: cancelled before settle

    FAILDECL --> Dunning
    state Dunning {
        [*] --> COMMS: comms Day 0/+3/+7/+10
        COMMS --> BLOCKED: unpaid → access block (+14d)
    }
    Dunning --> SETTLED: payment received → recover + unblock

    SETTLED --> REFUNDED: refund (maker/checker, reversing entry)
    SETTLED --> CHARGEBACK: operator reversal (reversing entry)

    SETTLED --> [*]
    EXPIRED --> [*]
    CANCELLED --> [*]
    REFUNDED --> [*]
    CHARGEBACK --> [*]

    note right of EXPIRED
        No-charge terminal (INV-3):
        never recorded as paid.
        Owned by reconciliation,
        NOT dunning.
    end note
```

## Rules the diagram encodes

- **Two entry paths.** A **customer-initiated transaction** (CIT — the first payment) needs **Strong
  Customer Authentication** (SCA) → `REQUIRES_ACTION`; recurring **merchant-initiated transactions**
  (MIT) authorize without customer interaction (`PENDING → AUTHORIZED`).
- **`SETTLED` is the only paid state** — it writes the `PAYMENT` ledger entry (INV-3). Reversal after
  settlement is only via **`REFUNDED`** (maker/checker + idempotency key, PR-005) or **`CHARGEBACK`**;
  both are new reversing entries, never in-place edits (INV-4, ABS-12).
- **`EXPIRED` ≠ `FAILED/DECLINED`.** `EXPIRED` = no operator response within **72h** (ASM-2): a
  no-charge terminal handled by reconciliation. `FAILED/DECLINED` = operator actively rejected → enters
  **dunning** immediately.
- **Dunning is recoverable.** Any successful payment during comms or block → **immediate unblock**,
  dunning state cleared, charge recovered to `SETTLED`. Intervals are ASM-3 (tunable).
- **Cancellation** is only allowed while `PENDING` / `REQUIRES_ACTION`; once `SETTLED`, the only way
  back is refund/chargeback (ABS-12).

## Out of scope / open

- **Write-off** of an indefinitely-blocked account (a `BLOCKED` account that never pays) is a policy
  terminal not modelled for M1 — see glossary *Write-off*.
- The exact `FAILED` vs `DECLINED` split (technical failure vs operator rejection) is collapsed here;
  both behave identically (→ dunning). Split them if operator outcomes need distinct handling.
