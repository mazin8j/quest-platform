# ADR-006 — React Native + Expo for mobile

## Status

Accepted (2026-09-04, Phase 00)

## Context

QUEST is mobile-first and must ship iOS and Android with a small TypeScript team, share contracts with the API (`@quest/types`, `@quest/api-client`) and iterate quickly (OTA updates) while accessing camera, location, secure storage and push notifications.

## Decision

`apps/mobile` uses React Native with the Expo SDK (currently 57), TypeScript, expo-router (file-based navigation and deep links via the `quest://` scheme), expo-secure-store behind a `SecureStoragePort`, and a declared permissions architecture with purpose strings. Dependency versions are aligned to Expo's `bundledNativeModules` (checked in CI by Metro export). The workspace uses pnpm with `node-linker=hoisted` for Metro compatibility (ADR-009).

## Alternatives Considered

- **Native Swift/Kotlin** — rejected: two codebases, no shared contracts, slower iteration.
- **Flutter** — rejected: Dart splits the team's language and prevents sharing zod schemas.
- **Bare React Native without Expo** — rejected: loses managed builds, OTA updates, config plugins.
- **Web-first PWA** — rejected: camera/location/push and store presence are core to the product.

## Consequences

- Positive: one language across the stack; typed API client shared with web; managed native tooling.
- Negative: Expo SDK upgrades are periodic work; some native modules require config plugins or dev builds.
- Security: tokens only in secure storage; bundle is public — no secrets in `EXPO_PUBLIC_*`.

## Revisit Triggers

A required native capability unavailable in Expo's ecosystem, or sustained performance issues in core flows (camera/video/maps).
