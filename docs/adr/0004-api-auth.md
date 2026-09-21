# ADR 0004 — API authentication & authorization

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** Krzysztof Jackowski (EM), CTO
- **Relates to:** [ADR 0002](0002-deployment-and-infrastructure.md) (private, S2S-only), PRD NFR-6 (RBAC + MFA + segregation of duties), NFR-8 (audit). **Depends on assumption [ASM-4]** (`specs/payments/assumption-register.yaml`).

## Context

The payments API is **private and service-to-service only** (ADR-0002 #1/#5) — it is **not** a BFF and
never faces a browser. Parents and admins reach it only *through* EduGo platform services.

GCP service-account (SA) tokens authenticate the *calling service*, but an SA token identifies a
**service, not a human**. Two committed requirements need the human identity:
- **Maker/checker** (NFR-6 segregation of duties) — a refund/adjustment must be requested and approved
  by **two different people**; a single SA identity makes that unenforceable and unauditable.
- **Audit attribution** (NFR-8, DAT-19) — the log must record *which admin* performed a financial op,
  not just "the platform."

So SA auth alone is sufficient for authentication and for system-initiated operations, but not for
authorizing/auditing human-actor operations.

## Decision

A **two-token model**, both required on user-initiated calls; payments is a resource server, never an IdP.

1. **Transport / caller auth — GCP service-account OIDC ID tokens** (GKE Workload Identity). Payments
   validates issuer + `aud` + an SA allowlist. This is the only way in; no static API keys.
2. **Actor auth — the calling service forwards the end user's OIDC/JWT** (issued by EduGo's IdP).
   Payments validates it against the IdP **JWKS** (signature, issuer, expiry, pinned alg, rotated keys)
   and authorizes on its `sub` + role + `acr`/MFA claims.
3. **The user JWT is required only on user-initiated / privileged operations** — reads of a parent's
   data, refunds, adjustments, dunning overrides. **System operations** (billing-run CronJob, inbox
   relay applying a webhook, order→first-charge) carry **no** user token and are attributed to a
   **system/service actor** in the audit log.
4. **Audience:** payments **accepts the platform-audience user token** — safe because it only ever
   arrives behind a validated, trusted SA (and on a private network). Token exchange to `aud=payments`
   (RFC 8693) is a later hardening option, not adopted now.
5. **Authorization rules** (enforced in payments, from the *validated* token — never a bare id header):
   - **Parent-scoping:** a parent subject may act only on its **own** account; account access derives
     from the JWT `sub`, giving defense-in-depth (not just trusting the caller).
   - **Role gates:** admin operations require the `Admin` role claim (DAT-18).
   - **Maker/checker:** request and approval are **separate calls** carrying **two different validated
     subjects**; each identity is captured from its own call and persisted (never carried/replayed).
   - **MFA:** checked via `acr`/`amr` on sensitive operations (asserted by the IdP).

**Rejected / deferred:** payments as a BFF or accepting end-user login (contradicts S2S-only); trusting
a plain `actor_id` header (not attestable → maker/checker becomes only as strong as the caller);
token exchange to `aud=payments` (deferred hardening).

## Consequences

- **Positive**
  - Stays pure S2S; maker/checker (NFR-6) and per-actor audit (NFR-8) are satisfied with real human identities.
  - Parent-scoping becomes enforceable **inside** payments — defense-in-depth for minors' financial data (GDPR).
  - No static secrets: SA identity via Workload Identity, user-token verification via IdP JWKS.
- **Negative / trade-offs**
  - **Depends on an EduGo IdP that we have not confirmed (ASM-4).** If none exists, the actor-identity
    source must be redesigned before auth is built.
  - Accepting **platform-audience** tokens is a mild confused-deputy exposure, mitigated by the SA gate +
    private network; hardening path is token exchange to `aud=payments`.
  - Every calling service must **forward the user token** on user-initiated calls — an integration
    contract for the EduGo platform.

## Open items

- Confirm the IdP and its claim set (`sub`, roles, `acr`/MFA) and JWKS endpoint — clears ASM-4.
- Decide the exact header for the forwarded user token and the role-claim mapping to `Parent/Admin/Accounting`.
- Adopt token exchange (`aud=payments`) if/when confused-deputy hardening is wanted.
