# ADR 0006 — Secrets management

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** Krzysztof Jackowski (EM), CTO
- **Relates to:** [ADR 0002](0002-deployment-and-infrastructure.md) (12-factor env, GKE), [ADR 0004](0004-api-auth.md) (SA identity), PRD NFR-6 (secrets/tokens in GCP KMS).

## Context

The service needs: Cloud SQL credentials (runtime + migration roles, ADR-0005), the payment operator
(PayU) API key + **webhook HMAC secret** (ADR-0002 #5 / ADR-0003 #2), and IdP config (issuer/JWKS —
mostly public). Config that is not sensitive (ports, `SERVICE_NAME`, OTLP endpoint) stays plain env.
NFR-6 requires secrets in managed KMS, not source or images.

## Decision

1. **GCP Secret Manager** is the store; **no secret in the container image, git, or plain env**
   (`.env` is local-dev only, already gitignored).
2. **Access via Workload Identity** — pods/Jobs run as a GCP service account granted read on *specific*
   secrets (least privilege); no static credential files. Secrets are mounted/fetched at startup (CSI
   Secret Store driver or SDK), enabling rotation without image rebuilds.
3. **Cloud SQL auth prefers IAM database authentication** (short-lived tokens via the Cloud SQL
   connector + Workload Identity, no stored password). If password auth is required instead, the
   password lives in Secret Manager, never in env/image.
4. **Operator API key + HMAC secret** live in Secret Manager and are **rotatable**; the webhook
   verifier reads the current secret so rotation needs no redeploy.
5. **Encryption at rest** via Secret Manager (Google-managed keys by default; CMEK available if a
   compliance driver appears — note we are PCI **SAQ-A**, so no card data is stored here anyway).

## Consequences

- **Positive:** no static secrets anywhere; per-workload least-privilege access; rotation without
  redeploy; satisfies NFR-6 with a managed service rather than hand-rolled KMS calls.
- **Negative / trade-offs:** Secret Manager/IAM-DB-auth add a **startup dependency** (a Secret Manager
  or connector outage delays pod readiness) and a small amount of infra/IAM wiring. IAM DB auth needs
  the Cloud SQL connector sidecar/library.

## Open items

- IAM DB auth vs password-in-Secret-Manager — confirm Cloud SQL/connector setup.
- CSI Secret Store driver vs SDK-fetch-at-startup.
- Google-managed keys vs CMEK; secret rotation cadence.
