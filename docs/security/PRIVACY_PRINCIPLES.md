# QUEST privacy principles and requirements

QUEST processes social and **location** data. Precise location and identity-linked evidence are
classified **RESTRICTED** (see `docs/architecture/05_DATA_ARCHITECTURE.md`).

## Principles (binding on every phase)

1. **Purpose limitation** — each data element is collected for a named purpose recorded in the
   phase's privacy classification; reuse for a new purpose requires review and, where required, consent.
2. **Data minimisation** — collect the least precise data that serves the purpose (country → city
   → precise only when a quest requires verification); analytics use pseudonymous ids and
   primitives only (`@quest/analytics` schema forbids nested PII).
3. **Consent** — analytics and personalisation consent flags travel with analytics events; sinks
   drop events without consent (implemented). Marketing, location and camera permissions are
   requested in-context with purpose strings (`apps/mobile/src/lib/permissions.ts`).
4. **Transparency & control** — users can see and change privacy settings (profile visibility,
   location sharing precision, who can challenge/follow them) — Phase 01/03.
5. **Location precision** — stored precisely only for verification, retained ≤ 30 days then
   coarsened/deleted; never exposed precisely to other users; nearby features use coarse
   positions/geohash cells; minors default to coarse-only.
6. **Location visibility** — user-controlled: hidden / city / neighbourhood; quest locations are
   creator-provided, not participant-derived.
7. **Blocked users** — block precedence: blocked users cannot see, contact, challenge or appear to
   each other (Phase 03 semantics), including via events and recommendations.
8. **Minors** — age gate at onboarding (DOB handled for age-band derivation, Phase 01); elevated
   defaults (private profile, coarse location, no adult contact, restricted content per safety
   `RESTRICTED.minimumAge`).
9. **Retention** — per-class retention schedules; logs 14/30 days; unattached uploads 3 days;
   safety/audit records retained longer under legal basis.
10. **User rights** — data export (machine-readable, per context) and account deletion (cascade via
    `identity.account.deleted` handlers, object storage cleanup, event/analytics pseudonym severing)
    designed in Phase 01 before launch; requests fulfilled within statutory windows.
11. **Security of processing** — see `SECURITY_ARCHITECTURE.md`.
12. **Cross-border** — initial region UAE (ADR-008); residency assumptions documented with revisit
    triggers; no transfer of RESTRICTED data to AI providers without minimisation and review.

## What Phase 01 enforces in code

- Identity keys are immutable UUIDs; email/username are attributes; the DOB is never returned by
  any endpoint or event — only the derived age band.
- Age-band privacy policy (`AGE_BAND_PRIVACY_POLICY`) seeds defaults and rejects disallowed
  changes for minors server-side; precise location is not a representable visibility.
- Consent ledger (append-only, versioned, sourced); optional consents default to false.
- Block precedence on every profile read; `BlockQueryPort` for later contexts.
- Right of access/portability (`DataExportService`, one bundle per account, sections per context)
  and right to erasure (`AccountDeletionJob` cascade + `identity.account.deleted`).
- Per-column classification and retention: `IDENTITY_PRIVACY_CLASSIFICATION.md`.

## What Phase 00 already enforces in code

- Analytics events reject nested objects and precise coordinates; consent-gated sink.
- Domain events carry `dataClassification`; `RESTRICTED` never travels by rule.
- Safety inputs accept country code only.
- Logs redact credentials; readiness/health never expose hosts or secrets.
- Permission architecture excludes always-on location and contacts by design.
