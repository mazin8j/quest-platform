# QUEST Backlog

## P0 — MVP
- Identity and profile
- Interests and onboarding
- Quest create/publish/discover
- Accept/start/complete Quest
- Photo/video proof
- Safety classification
- XP, levels, badges
- Quest Passport
- Friends/follows
- Comments/reactions/shares
- Challenge friends
- Nearby quests
- World Quest v1
- Notifications
- Admin moderation
- AI Quest Generator
- Basic personalization

## P1 — Growth
- Crews
- Quest chains
- Mystery Quest
- City/country competitions
- Creator Quest tools
- Referral attribution
- Advanced recommendation/ranking
- Enhanced proof verification

## P2 — Monetization
- Sponsored Quests
- Brand campaigns
- Creator monetization
- Quest+ subscription
- Corporate Quest
- Tourism/destination Quest packages

## Technical Debt & Audit Findings (Phase Gate Audit 2026-09-04)
Source: `docs/governance/PHASE_GATE_AUDIT_2026-09-04.md`. P0/P1 items (D-01..D-10) are tracked as blockers in `PROGRESS.md`.

### P2 — should fix (during Phase 00)
- D-11 Add explicit "Inputs" and "Quality gates" sections to every agent in `.claude/agents/`
- D-12 Add explicit exit criteria to phase skills 03, 04, 05, 07–16; add "Use when / Done when" to reusable skills
- D-13 Reconcile `CLAUDE.md` Repository Shape with the actual layout (`docs/governance`, `docs/roadmap` exist; `infrastructure/docker` in bootstrap script)
- D-14 Make `CLAUDE.md` quality-gate section reference `docs/governance/QUALITY_GATES.md` (single source of truth)
- D-15 Record the `me-central-1` region / data-residency decision in ADR-008

### P3 — improvement
- D-16 Replace Windows-only `scripts/bootstrap-directories.ps1` with a committed skeleton; delete script
- D-17 Extend `.env.example` with S3 key placeholders, session/JWT secret placeholder, AI model config variable (in the phase that needs each)
- D-18 Add `*.tsbuildinfo`, `.turbo/`, `build/`, IDE folders to `.gitignore` once tooling is chosen
- D-19 Decide whether agent `model:` pins are intentional or should be removed to match README "keep model selection configurable"
- D-20 Write a developer setup guide (Node version, package manager, Docker prerequisites)
