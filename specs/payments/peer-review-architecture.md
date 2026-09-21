# Peer Review: Payments specs (`specs/payments/`) — Re-review post gap-interrogation

**Phase:** Architecture
**Reviewed:** 2026-09-21 (re-review; supersedes the initial pass)
**Artifacts reviewed:** `feature-inventory.yaml` (reconciled), `workshop-output.md`, `glossary.md`, **`decisions.yaml`**, **`assumption-register.yaml`**, **`CONSTRAINTS.md`**
**Backdrop:** `docs/prd.md`, `docs/adr/0001-backend-stack.md`, `db/migrations/1758326400000_init_payments_ledger.sql`
**Branch:** `feature/payments-specs` @ `706aa32`

---

## Verdict: 🔄 REVISE

Substantial improvement since the first pass — the capture step closed the biggest consistency gap and the artefact set is now internally coherent and traceable. **One 🔴 remains** (the ledger sign convention is still undocumented), so this is not yet an approve. The remaining 🟡 backlog is unchanged financial-logic depth plus two new traceability nits introduced by the capture/commit.

---

## Change since the initial review

| Prior finding | Status now |
|---|---|
| **PR-002** inventory stale vs workshop | ✅ **RESOLVED** — `DAT-20` flipped to the decided parent-account model, `DAT-21` (child sub-account) + `DAT-22` (enrollment) added, `resolutions:` index stamps every Q/ABS. The two files now agree. |
| **PR-011** escalations lack owners/dates | 🟡 **Largely resolved** — `decisions.yaml` + `still_open` now record owners (Finance, DPO/Legal) and explicit "unassigned" for Q-2/Q-3. **Due dates still absent.** Also the NFR-4 concern folded in here is fixed: `CONSTRAINTS.md` INFRA-1 now carries the "HA/PITR still required — not a waiver" caveat. |
| **PR-001** ledger sign convention undocumented | 🔴 **Still open** — correctly **not** invented by capture (it was never a workshop decision). Confirmed absent from glossary + inventory. |
| PR-003 / PR-004..010 / PR-012 | 🟡 **Still open** — not in scope of the workshop; carried forward unchanged. |

**New 🟢:** the capture is disciplined — every entry carries `capture_confidence`, the one inferred item (72h) is marked and was explicitly ratified, `assumption-register.yaml` gives each ASM an observable `revisit_when`, and off-inventory findings (OFF-1/2, NEW-DEBT-1, CONSTRAINT-INFRA) are recorded as harvest feedback rather than smuggled into the inventory as if harvested. This is exactly right.

---

## Automated Checklist (delta from initial)

### Tech Spec — Data Model
- [ ] ⚠️ **Table definitions** — Still the core gap: new entities (child sub-account, enrollment, operator events, settlements, invoices, dunning state, refund/adjustment approvals) are named/`(candidate)` but have no columns/migration; **ledger sign convention still missing** (PR-001).
- [x] **Aggregate boundaries & invariants** — Strengthened; parent-authoritative balance now explicit in `DAT-20` and `decisions.yaml#Q-1`.
- [x] **Naming consistency** — Now consistent across inventory ↔ glossary ↔ decisions (DAT-20/21/22 ↔ Parent account / Child sub-account / Enrollment). Exception: `DAT-2` label (PR-003).

### Tech Spec — Open Questions
- [x] **Risk/decision capture** — Escalations now have an owner column and a `still_open` register. **Improved.**
- [ ] ⚠️ **Timelines** — Due dates still unset on all three escalations (PR-011 residue).

### Consistency Checks
- [x] **Inventory ↔ Workshop ↔ Decisions** — Now aligned (was the initial 🔴).
- [ ] ⚠️ **Traceability of references** — `decisions.yaml` source reference is inaccurate (PR-013).

Everything else is unchanged from the initial pass.

---

## Deep Review Findings

### 🔴 Must Fix

**[PR-001] Ledger sign convention still unspecified** *(carried, unresolved)*
- **Location:** `glossary.md` (Balance, Entry type); `feature-inventory.yaml` DAT-1/DAT-6.
- **Issue:** The specs still never state which entry types are credit(+)/debit(−) or what a positive balance means. The migration implies it (`PAYMENT` positive credits the balance ⇒ `CHARGE` negative ⇒ positive balance = credit), but `DAT-6` still calls a charge "amount owed" with no sign. The glossary's "Credit" entry says credit is positive, which *hints* at the convention but never states it as a rule for all entry types.
- **Impact:** Unchanged — for a balance-correctness system this is foundational; an implementer following the spec could invert the balance, silently breaking dunning ("overdue"), reconciliation, and credit/refund logic.
- **Why still here:** Correctly outside the workshop's scope — capture did not (and should not) invent it. It now needs an explicit decision.
- **Suggestion:** Add a one-paragraph "Sign convention" to the glossary + DAT-1: enumerate each entry type as +/−, and state "positive balance = customer in credit; negative = arrears," matching the migration. This is the single item blocking approval.

### 🟡 Should Fix

**[PR-013] `decisions.yaml` source reference is inaccurate** *(new — introduced by capture/commit)*
- **Location:** `decisions.yaml` `meta.source_artefact.commit`.
- **Issue:** It cites `ff53db3` ("HEAD at capture; workshop-output.md is uncommitted") — but `workshop-output.md` first exists in `706aa32`. The reference triple therefore points at a commit that does **not** contain the source file.
- **Impact:** `references/artefact-tree.md` requires reference triples to resolve; a downstream reader (or divergence check) resolving `ff53db3:specs/payments/workshop-output.md` gets nothing. Traceability silently broken.
- **Suggestion:** Update `source_artefact.commit` to `706aa32` (the commit that actually contains the workshop notes). Optionally note the inventory content reviewed is also `706aa32`, while `74d22fe` remains the *harvest-origin* commit.

**[PR-014] Cross-pod dedup constraint has no schema to enforce it** *(new — from CONSTRAINTS.md)*
- **Location:** `CONSTRAINTS.md` INFRA-2; `glossary.md` (Operator event, `(candidate)`).
- **Issue:** INFRA-2 states cross-pod at-most-once (INV-2) "relies on DB-level dedup — a unique `(operator, operator_event_id)`." No such table/unique index exists (the migration only has `payments.idempotency_key` unique). The guarantee currently rests on an object that isn't specified anywhere as a required migration.
- **Impact:** The constraint reads as satisfied but nothing enforces it; an implementer could build in-memory dedup (explicitly forbidden by the same constraint) and the spec wouldn't catch it.
- **Suggestion:** Add an explicit data-model requirement: an `operator_events` (or equivalent) table with a `UNIQUE (operator, operator_event_id)` index, applied in a migration — the concrete anchor INFRA-2 depends on.

**[PR-003] `DAT-2` label "grosze or cents" contradicts PLN-only** *(carried)* — unchanged; drop "or cents".

**[PR-004] Residual-credit disbursement assumes a refundable original** *(carried)* — `decisions.yaml#ABS-7` records "credit refunded via operator refund path" without resolving the no-refundable-source case; still needs a payout/manual-disbursement path.

**[PR-005] Refund/adjustment idempotency not specified** *(carried)* — still only payments/operator events carry idempotency keys.

**[PR-006] No over-refund guard** *(carried)* — "Σ refunds ≤ captured amount" still unstated.

**[PR-007] Chargeback doesn't re-open the receivable** *(carried)* — `decisions.yaml#ABS-12` models the reversing entry but not the fee + returned debt + dunning re-eligibility.

**[PR-008] Allocation concurrency not covered by the single-row increment** *(carried)* — `decisions.yaml#ABS-5` protects INV-1 via the atomic balance increment but not INV-5 across multiple charge rows; needs `SELECT … FOR UPDATE` on target charges.

**[PR-009] VAT/tax boundary on invoices undefined** *(carried)* — ownership (payments vs SALDEO/KSeF) still unstated.

**[PR-010] Blocking a minor's education is an unregistered legal risk** *(carried)* — not added to any risk register; escalate to Legal.

**[PR-012] "Arrears" and "write-off" used but undefined; EXPIRED-vs-FAILED dunning entry** *(carried)* — confirmed no glossary entries for Arrears/Write-off though `decisions.yaml`/`CONSTRAINTS.md` use them.

---

### 🟢 Looks Good
- **Capture discipline** — `capture_confidence` on every entry; the one inferred item ratified; nothing ambiguous recorded; off-inventory findings routed as harvest feedback, not silently inventoried.
- **PR-002 fix** — inventory ↔ workshop ↔ decisions are now consistent; the `resolutions:` index is a clean, low-risk way to mark closure while keeping `decisions.yaml` authoritative.
- **INFRA-1 HA caveat** — pre-empting the "no replicas ≠ no HA" misread (NFR-4) is exactly the kind of precision this system needs.
- **Assumption register** — every ASM has an observable `revisit_when`; ASM-3 (dunning intervals) correctly tied to real M1 data rather than pretending it's optimized.
- Prior 🟢 all still stand (two date-boundaries, own state machine, minor-data minimization, mismatch taxonomy, glossary mappings).

---

## Consistency Check
- **Inventory ↔ Workshop ↔ Decisions:** ✅ consistent (was the top 🔴 last pass).
- **Specs ↔ Migration:** one contradiction remains (sign convention, PR-001); INFRA-2 references a not-yet-existing unique constraint (PR-014).
- **Reference triples:** ⚠️ `decisions.yaml` source commit inaccurate (PR-013).
- **Naming:** consistent except `DAT-2` (PR-003).

---

## Summary
The gap-interrogation and its propagation did their job: the specification is now internally consistent, every decision is traceable to workshop evidence with a confidence rating, and assumptions/constraints are captured with revisit triggers. **One blocker stands between this and approval — documenting the ledger sign convention (PR-001)** — and it's a five-minute fix that needs a human decision, not more analysis. After that, priority order for the 🟡 backlog: fix the two traceability nits (PR-013, PR-014), then the financial-logic depth (PR-008 allocation locking, PR-005/006 refund idempotency + over-refund, PR-004 credit disbursement, PR-007 chargeback), then escalate PR-009/PR-010 rather than solving them here.

---

## Fixes applied (2026-09-21, post-review)

| Finding | Status | What changed |
|---|---|---|
| **PR-001** ledger sign convention | ✅ **fixed** | Added a **Sign convention** table to `glossary.md` (positive = credit, negative = arrears; sign per entry type; `FEE` = house/settlement ledger, not the customer balance) + updated `Balance`; annotated `DAT-1` and clarified `DAT-6` (CHARGE is a negative/debit entry). |
| **PR-012** arrears/write-off; EXPIRED vs FAILED | ✅ **fixed** (defs) | Added `Arrears` and `Write-off` glossary entries. (EXPIRED-vs-FAILED dunning-entry wording still worth a line — minor.) |
| **PR-013** inaccurate source ref | ✅ **fixed** | `decisions.yaml` `source_artefact.commit` → `706aa32` (the commit that contains `workshop-output.md`). |
| **PR-014** dedup constraint had no schema | ✅ **fixed** | `CONSTRAINTS.md` INFRA-2 now requires a migration adding `operator_events` with `UNIQUE (operator, operator_event_id)`. |

**Design call made inside PR-001 (flagged for veto):** `FEE` entries are house/settlement-ledger only, never posted to a customer account — a parent doesn't owe the operator's processing fee.

**Updated verdict: ✅ APPROVED** — the sole 🔴 is resolved. Remaining items are all non-blocking 🟡: PR-003 (grosze/cents label), PR-004 (credit disbursement path), PR-005/006 (refund idempotency + over-refund guard), PR-007 (chargeback re-opens receivable), PR-008 (allocation locking), PR-009 (VAT boundary), PR-010 (minor-access-block legal risk), plus due dates on the three escalations. Recommend these move into the implementation plan / follow-up tickets rather than blocking spec-writing.

---

## Review dispositions — round 2 (CTO, 2026-09-21)

| Finding | Disposition | Action |
|---|---|---|
| PR-003 currency label | ✅ **fixed** | Data layer made currency-generic (ISO-4217 + minor units); PLN-only kept as operational scope enforced by validation, not schema. |
| PR-004 credit disbursement | ✅ **fixed** | Added manual/bank-transfer payout path (audited, maker/checker) for credit with no refundable original. |
| PR-005 refund idempotency | ✅ **fixed** | Idempotency key required on every money-moving mutation; refund/adjustment tables need their own key + unique index. |
| PR-006 over-refund guard | ✅ **fixed** | Added **INV-6** (Σ refunds ≤ captured amount). |
| PR-007 chargeback re-opens receivable | ⏸️ **deferred** | Edge case; not modelled this iteration. |
| PR-008 allocation locking | ✅ **fixed** | `SELECT … FOR UPDATE` on target charges within the allocation txn. |
| PR-009 VAT boundary | ✅ **fixed** | Tax modelled **inside payments**: net/tax/gross + rate + treatment + jurisdiction per line; **INV-7** (gross = net + tax); ledger in gross; per-line half-up rounding (**FIN-1**); effective-dated rate table; PL tuition EXEMPT default; invoice in scope, billing note deferred. |
| PR-010 minor access-block risk | ⏸️ **deferred** | Out of scope for this exercise. |
| PR-012 arrears/write-off | ✅ **fixed** | Glossary entries added; EXPIRED vs FAILED clarified. |

**Net remaining open: none.** Every finding is fixed or explicitly deferred (PR-007 chargeback, PR-010 minor access-block). Deferred items should be logged as follow-up tickets so they aren't lost.

---

## ⏸️ Awaiting Human Sign-Off
- **Approve** — accept verdict, proceed
- **Override** — proceed despite findings
- **Send back** — author addresses findings
- **Add feedback** — you have additional input
