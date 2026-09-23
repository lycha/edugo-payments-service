# Sequence — reconciliation

**Status:** Draft · **Date:** 2026-09-21 · **Author:** Krzysztof Jackowski

The **daily** safety net for the async collection path: ingest the operator's settlement, run a
**three-way match** (ledger ↔ operator status ↔ payout), post fees as their own ledger entries, and
route any divergence to the back-office queue. This is what catches a missed webhook or a drifting
balance before it becomes a financial-correctness incident.

**Related:** [ADR 0003 — async backbone](../adr/0003-async-backbone.md) · [pull auto-charge sequence](sequence-pull-auto-charge.md) · [PRD](../prd.md) (FR-15, DD-3, INV-1/3, §4 metrics)

```mermaid
sequenceDiagram
    autonumber
    participant RECON as Reconciliation<br/>(CronJob, daily)
    participant OP as Payment Operator<br/>(PayU)
    participant DB as Payments DB<br/>(ledger)
    participant BO as Back-office queue<br/>+ ops alert

    Note over RECON,DB: 1 — Ingest settlement (single-runner via advisory lock)
    RECON->>OP: fetch daily settlement (transactions, fees, payout total)
    OP-->>RECON: settlement report
    RECON->>DB: persist settlement rows (SETTLE-INGESTED)

    Note over RECON,BO: 2 — Three-way match: ledger ↔ operator status ↔ payout
    loop each settled transaction
        RECON->>DB: find matching PAYMENT ledger entry (amount, status)
        alt agrees on all three
            RECON->>DB: mark matched · post operator fee as a separate entry (DD-3)
        else divergence (see taxonomy below)
            RECON->>DB: mark mismatch
            RECON->>BO: enqueue exception + alert (severity by drift amount)
        end
    end

    Note over RECON,BO: 3 — Payout-level check
    RECON->>DB: assert payout total == Σ(settled txns) − fees
    opt payout does not balance
        RECON->>BO: enqueue payout mismatch + alert
    end

    Note over RECON,DB: 4 — Metrics
    RECON->>DB: record match rate & drift age (target 100%, ≤24h · NFR-9)
```

## Mismatch taxonomy

A mismatch is **any** divergence the three-way match finds. All seven route to the **back-office queue
+ ops alert** — **never** to the parent (glossary), severity scaled by the drift amount:

1. **Ledger payment absent from settlement** (or later declined/reversed) — the INV-3 guard.
2. **Operator settled with no ledger entry** — a missed / dead-lettered webhook.
3. **Amount mismatch** — partial capture, rounding.
4. **Fee mismatch** — operator fee ≠ expected (fees are separate entries, DD-3).
5. **Refund / chargeback out of sync** between us and the operator.
6. **Settlement-window / timing boundary** (mitigated by the operator-window decision).
7. **Payout total ≠ Σ(settled txns) − fees.**

## Why it's shaped this way

- **It closes the async loop.** The pull path is eventually consistent and a webhook can be lost or
  dead-lettered. Cases 1 and 2 are exactly that gap — reconciliation is the independent check that the
  ledger and the operator agree, so INV-3 ("no payment without a matching confirmation") is *verified*,
  not just intended.
- **Fees are their own ledger entries** (DD-3), never folded into the payment — gross, fee, and net stay
  separately auditable and feed the payout-total check (case 7).
- **Reconciliation flags; humans correct.** It never mutates a posted entry. A confirmed correction is a
  new **reversing** entry made through maker/checker (INV-4) from the back-office queue.
- **Parents never see a mismatch** — it's an internal ops concern; the queue + alert are the only outputs.
- **The SLO lives here** (PRD §4): target **100% match rate**, drift detected **within 24h**; match rate
  and drift age are golden signals for NFR-9.

## Not shown here

- **Resolving** a queued exception (the back-office correction workflow) — a separate maker/checker flow.
- **Multi-operator** settlement formats — each operator adapter normalizes to the same match; the
  three-way match itself is operator-agnostic.
