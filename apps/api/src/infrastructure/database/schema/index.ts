/**
 * Drizzle schema root: one file per bounded context, re-exported here. Hand-authored SQL under
 * apps/api/drizzle is the source of truth (ADR-010); these definitions give the query builder its
 * column types and must stay in sync with the migrations (verified by the integration suite).
 */
export * from './identity';
export * from './profiles';
