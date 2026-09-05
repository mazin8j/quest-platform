-- 0000_platform_extensions
-- Phase 00 platform baseline (ADR-002): enable the extensions every later migration may rely on.
-- No business tables are created here.
--
-- Rollback: this migration is additive and safe to leave in place. To revert explicitly:
--   DROP EXTENSION IF EXISTS vector; DROP EXTENSION IF EXISTS postgis;
-- (only valid while no table uses geography/vector columns).

CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
-- pgcrypto is not required on PostgreSQL >= 13 (gen_random_uuid() is built in); kept out deliberately.
-- Common trigger function for `updated_at` audit columns; Phase 01+ tables attach it.
CREATE OR REPLACE FUNCTION quest_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
