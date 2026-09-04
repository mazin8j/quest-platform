---
name: quest-domain
description: Use when defining or reviewing QUEST domain behavior, terminology, entities, lifecycle, or product rules.
---

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
