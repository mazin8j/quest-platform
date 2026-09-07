# Domain modules

Each bounded context (CLAUDE.md "Core Bounded Contexts") lives in one folder here and follows the
same internal layout. The rules are enforced by `.dependency-cruiser.cjs` (`pnpm deps:check`) and
explained in `docs/architecture/DEPENDENCY_RULES.md`.

```
modules/<context>/
  index.ts              ← the ONLY file other modules may import (public API: module class, ports, DTO schemas, events)
  <context>.module.ts   ← NestJS module wiring
  api/                  ← controllers (HTTP only: parse → call application service → map to DTO). No business logic.
  application/          ← use cases / application services; orchestrate domain + ports; own transactions
  domain/               ← entities, value objects, invariants, domain events definitions. Pure TypeScript.
  ports/                ← interfaces this module needs from the outside (repositories, other contexts, AI, storage)
  infrastructure/       ← adapters implementing the ports (Drizzle repositories, event publishers…)
```

Rules in one paragraph: controllers never touch persistence; application services never import
another module's `application/`, `domain/`, `infrastructure/` or `ports/` (only its `index.ts`);
a module owns its tables and is the only writer to them; cross-context reads go through the
other module's exported query port, cross-context reactions go through domain events; common/,
infrastructure/ and config/ never import from modules/.

Phase 00 ships two foundation modules — `system` (versioned info endpoint) and `trust-safety`
(fail-closed `SafetyDecisionPort`). Phase 01 adds `identity` (ACCOUNT + AUTHENTICATION aggregates,
registers the global `AuthGuard`) and `profiles` (PUBLIC PROFILE aggregate). Dependency direction is
`identity → profiles` through `profiles/index.ts` ports only (`PROFILE_PROVISIONER`, `PROFILE_QUERY`,
`BLOCK_QUERY`); `profiles` never imports `identity`. Later contexts consume `BLOCK_QUERY` for block
precedence and register a `DataExportContributor` + an `identity.account.deleted` handler when they
add account-linked tables.
