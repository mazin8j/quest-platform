---
name: quest-domain
description: Use when defining or reviewing QUEST domain behavior, terminology, entities, lifecycle, or product rules.
---

# quest-domain

## Use when

Use when defining or reviewing QUEST domain behavior, terminology, entities, lifecycle, or product rules.

## Inputs

The product behaviour under discussion; existing entities/lifecycle; `04_DOMAIN_ARCHITECTURE.md`.

## Workflow

1. Map the behaviour onto the lifecycle (discover → accept → start → perform → submit proof → verify → reward → share/challenge) and the owning context.
2. Check invariants: versioned quests after publication, participation keeps the accepted version, ledger-style rewards, append-only verification/safety decisions, safety/age/geo restrictions as first-class attributes.

## Guidance

## Domain invariant

QUEST is a participation network. Model the action lifecycle explicitly: discover, accept, start, perform, submit proof, verify, reward, share/challenge.

## Core entities

User, Profile, Quest, QuestVersion, QuestParticipation, QuestEvidence, QuestVerification, XPTransaction, Badge, Achievement, Crew, SocialRelationship, Comment, Reaction, Invitation, WorldQuest, ModerationCase.

## Rules

- Quest definitions are versioned after publication when edits could change completion requirements.
- Participation records preserve the Quest version accepted by the user.
- XP/rewards are ledger-style, idempotent transactions rather than mutable counters alone.
- Verification decisions are append-only/auditable with supersession where reconsidered.
- Safety status and geographic/age restrictions are first-class Quest attributes.

## Constraints

Do not move ownership across contexts without an ADR; terminology stays consistent with this skill.

## Done when / Exit criteria

Behaviour expressed as invariants, state transitions and owning context, ready for `data-modeling` / `api-contract`.
