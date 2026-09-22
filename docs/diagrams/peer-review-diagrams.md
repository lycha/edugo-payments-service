# Peer Review: Mermaid architecture & flow diagrams

**Phase:** Architecture (documentation artifacts)
**Reviewed:** 2026-09-22
**Artifacts reviewed:** `docs/diagrams/{architecture-c4, payment-state-machine, sequence-pull-auto-charge, sequence-push-payment, sequence-reconciliation, dual-operator-routing}.md`
**Lens:** readability · industry good practice · coherence with the specs (`specs/payments/`) and ADRs (`docs/adr/`)

---

## Verdict: 🔄 REVISE

The diagram set is genuinely strong — faithful to the specs, well-narrated, and appropriately simplified — but the relocation into `docs/diagrams/` has broken **every** cross-link to the PRD, ADRs, and glossary, which defeats the "coherence with specs/ADRs" purpose until fixed. One 🔴 (mechanical, quick), the rest 🟡/🟢.

---

## Automated Checklist

The standard architecture checklist targets tech-spec / implementation-plan / ticket artifacts. These are **explanatory diagrams**, so most items are N/A; the applicable ones are mapped below.

### Applicable items

- [x] **Architecture approach consistent with the ADRs** — the diagrams faithfully render ADR-0002 (private, ≥2 pods, one webhook ingress), ADR-0003 (inbox + CronJob relay, pull-based status), ADR-0004 (S2S + forwarded JWT, not a BFF).
- [x] **Bounded-context placement** — C4 L2/L3 correctly show one context with the hexagonal split (domain / adapters / platform).
- [x] **Async flows document ordering & delivery guarantees** — inbox dedup (at-most-once), single-transaction apply (exactly-once effect), relay cadence all shown/annotated.
- [x] **External services + failure modes** — operator, IdP, accounting present; failover + reconciliation cover operator failure.
- [x] **Idempotency strategy** — `Idempotency-Key` on initiate and `UNIQUE(operator, event_id)` inbox dedup depicted.
- [ ] ⚠️ **Naming / cross-artifact consistency** — the state machine defines `AUTHORIZED` / `REQUIRES_ACTION`, but the sequences jump `PENDING → SETTLED`, skipping them (see PR-D2).
- [ ] ⚠️ **No blocking unknowns / links resolve** — all links to `prd.md`, `adr/*`, and the glossary are broken post-move (see PR-D1).
- [-] **API contract / data model / migrations / task DAG / tickets / sizing** — N/A; these are diagrams, not specs or plans.

**Checklist Summary:** 5 applicable passed, 2 failed, remainder N/A.

---

## Deep Review Findings

### 🔴 Must Fix

**[PR-D1] Relocation to `docs/diagrams/` broke every spec/ADR/glossary link**
- **Location:** all six files' `**Related:**` headers and inline links; e.g. `architecture-c4.md:8`, `payment-state-machine.md:9`, `sequence-pull-auto-charge.md:10`.
- **Issue:** the links were authored relative to `docs/`. After the move one directory deeper, they resolve wrong:
  - `[PRD](prd.md)` → now needs `../prd.md`
  - `[ADR 0002](adr/0002-…​)` → now needs `../adr/0002-…​`
  - `[glossary](../specs/payments/glossary.md)` → now needs `../../specs/payments/glossary.md` (currently resolves to the non-existent `docs/specs/…`)
  - Sibling links between diagrams (e.g. `[state machine](payment-state-machine.md)`) are **fine** — they moved together.
- **Impact:** the entire point of these docs is traceability to the specs/ADRs. On GitHub every one of those links 404s, so a reviewer can't hop from a diagram to its authority — the coherence the diagrams claim is unverifiable in-place. Also note the move is **not committed** (`git status`: 6 deletions under `docs/`, untracked `docs/diagrams/`), so this will land as a broken-link commit.
- **Suggestion:** bulk-fix the prefixes (`prd.md`→`../prd.md`, `adr/`→`../adr/`, `../specs/`→`../../specs/`), then `git add -A docs/` so the rename + link fix commit together. Verify with a quick relative-path check before pushing.

---

### 🟡 Should Fix

**[PR-D2] State machine ↔ sequences disagree on intermediate states**
- **Location:** `payment-state-machine.md:19-22` vs `sequence-pull-auto-charge.md:45` and `sequence-push-payment.md:41`.
- **Issue:** the state machine models `PENDING → REQUIRES_ACTION → AUTHORIZED → SETTLED`, but both sequences go straight to `SETTLED`. The push sequence is *specifically* the SCA path yet never shows `REQUIRES_ACTION`; neither shows the authorize-then-capture split (`AUTHORIZED → SETTLED`).
- **Impact:** a reader reconciling the two artifacts sees a contradiction — are `AUTHORIZED`/`REQUIRES_ACTION` real states or not? Card auth vs capture are frequently distinct operator events, so this isn't cosmetic.
- **Suggestion:** either show `AUTHORIZED → SETTLED` (and `REQUIRES_ACTION` in the push flow) as the operator confirmation arrives, or add one line to each sequence noting "auto-capture collapses AUTHORIZED→SETTLED into a single confirmation event" so the collapse is deliberate, not an omission.

**[PR-D3] Push sequence overloads one arrow and drops the relay's tick**
- **Location:** `sequence-push-payment.md:38` and `:41`.
- **Issue:** `API->>DB: verify signature → INSERT operator_events (dedup) → 200 ACK` packs three actions onto one API→DB arrow — but the `200 ACK` goes back to the **operator**, not the DB. The pull diagram models this correctly with a separate `API-->>OP: 200 ACK` (`sequence-pull-auto-charge.md:36`). Also, `RELAY` appears and writes to the DB with no "claim rows / ~1 min tick" step, unlike the pull diagram (`:39`).
- **Impact:** inconsistency between the two sequences for the *same* webhook→inbox→relay path they claim to share; the misdirected ACK is a small correctness misread.
- **Suggestion:** mirror the pull diagram: split the ACK into `API-->>OP: 200 ACK`, and give `RELAY` its claim/tick line (or add a note "same claim/apply as the pull path").

**[PR-D4] Failover trigger `5xx` contradicts the stated idempotency rule**
- **Location:** `dual-operator-routing.md:69-71` (diagram) vs `:85-88` (prose).
- **Issue:** the diagram fails over on `connection refused / 5xx`, but the prose (correctly) says never fail over on an ambiguous outcome because the primary may have charged — a `5xx` is exactly that ambiguous case, no safer than a timeout.
- **Impact:** the diagram undercuts the doc's own (sound) double-charge-safety argument; an implementer following the picture would fail over on 5xx and risk a double charge.
- **Suggestion:** narrow the diagram's failover trigger to genuinely definitive signals (connection refused / DNS / explicit "operator unavailable"), and keep `5xx`/timeout on the `PENDING` + reconcile path, matching the prose.

**[PR-D5] "Focus" highlight means something different in each diagram, with no legend**
- **Location:** the `classDef focus` blocks — `architecture-c4.md:37/72/95`, `dual-operator-routing.md:38`.
- **Issue:** blue = the whole system (C4 L1), = all internal containers (L2), = internal components (L3), = just the router (dual-operator). No legend explains it.
- **Impact:** minor, but a reader can't tell what the color encodes, and its meaning shifts between diagrams.
- **Suggestion:** add a one-line caption under each ("blue = the payments service / its internals / the routing decision under discussion"), or drop the highlight where it isn't earning its keep.

---

### 🟢 Looks Good

- **Correctness invariants are front-and-centre and accurate.** INV-1 (`balance == Σ ledger`), INV-2/3 (at-most-once inbox key + exactly-once single-transaction apply), and INV-4 (reversing entries only) are depicted *and* cited — the highlighted "one DB transaction" rect is the right thing to draw attention to.
- **The push diagram's "redirect return is NOT proof of payment" callout** is precisely the hard-won lesson a payments engineer needs; making it a first-class note (not buried in prose) is excellent.
- **Dual-operator reasoning is sophisticated and correct** — mandate/token affinity overriding cost, operator recorded on the charge for inbound correlation, and failover-only-on-definitive-failure are exactly the non-obvious constraints; the honest A4 "PLN-only, Stripe designed-but-later" scope note prevents over-claiming.
- **Reconciliation matches the workshop verbatim** — all seven mismatch cases, "flags but never mutates," "parents never see a mismatch," and the SLO tie-in (100% / ≤24h → NFR-9) are faithful to `workshop-output.md` and FR-15/DD-3.
- **Consistent, reviewable doc shape** — every file follows intro → diagram → "why it's shaped this way" → "not shown here." The "not shown" sections are especially good: they pre-empt the "but what about X?" questions and point to the right sibling doc.
- **Readability of the simplification is good** — short node labels, phase notes with numbered stages, `autonumber`, and detail pushed to prose. The earlier switch away from Mermaid's cramped native C4 renderer to flowcharts was the right call for this audience.
- **Mermaid syntax validates by inspection** — matched `alt/opt/loop/rect` … `end` blocks, valid `stateDiagram-v2` composite state + alias, quoted labels where parens/`≥`/`·` appear. All six should render on GitHub. *(Note: not machine-validated — see Summary.)*

---

## Consistency Check

- **Diagrams ↔ ADRs:** strong. ADR-0002/0003/0004 are rendered accurately; ADR-0006 (per-operator secrets) and ADR-0007 (region) are referenced in prose where relevant.
- **Diagrams ↔ specs:** strong on content (glossary state names, TRN transitions, mismatch taxonomy, invariants) — but see PR-D2 for the one internal contradiction, and PR-D1 for the now-broken link paths that are *supposed* to carry this traceability.
- **Diagram ↔ diagram:** the shared webhook→inbox→relay path is drawn inconsistently between pull and push (PR-D3); everything else lines up.
- **Naming:** ubiquitous language is honoured (own state names, `operator_events`, INV/DD/FR references). Good.

---

## Summary

High-quality, spec-faithful diagram set that will genuinely help a new engineer — the narration and the "why/not-shown" discipline are above the bar. The only blocker is mechanical: the move into `docs/diagrams/` broke all upward links (PR-D1), and it isn't committed yet, so fix the paths and stage the rename together. After that, the priority order is PR-D2 (state-machine/sequence coherence — the one substantive contradiction), then PR-D3/PR-D4 (small correctness/consistency fixes), then PR-D5 (cosmetic). Consider wiring `mermaid-cli` (or a lightweight CI check) so diagram syntax is validated automatically rather than by eye.

---

## Render validation (mermaid-cli)

Ran `mmdc` (mermaid-cli 11.17.0) over all six files as a rendering gate — this **supersedes** the
by-inspection caveat above.

- **Result: 6/6 files render (all 8 charts).**
- **One real bug the eye-review missed:** the PR-D4 failover note used a semicolon
  (`…(may double-charge); reconcile`). In a Mermaid `sequenceDiagram` `;` is a statement separator, so
  the note split mid-line and the whole chart **failed to parse** — it would have rendered as an error
  block on GitHub. Fixed (`;` → `,`); re-render clean.
- **Lesson:** avoid `;` inside sequence-diagram note/label text (it's fine only in `classDef`/`style`
  statements). Worth wiring `mmdc` into CI so this is caught automatically, not by luck.

---

## ⏸️ Awaiting Human Sign-Off

Review complete. Please confirm how to proceed:
- **Approve** — accept the verdict; I'll apply the fixes (starting with PR-D1) on request
- **Override** — proceed despite findings
- **Send back** — treat as-is for the author to address
- **Add feedback** — you have additional input
