-- 0002_quest_core
-- Phase 02 — Quest Core. Design: docs/data/QUEST_DATA_MODEL.md, ADR-013.
--
-- A Quest is a governed executable challenge, not a post. Three rules shape this schema:
--   1. Identity is immutable: quest.id (UUID v7) never changes and is the only key other rows use.
--   2. Publication is earned: a Quest is only visible while `state = 'PUBLISHED'`, and it can only
--      reach that state with an assessment whose content hash equals the hash being published
--      (enforced in code by canPublishWithAssessment, and by quest_published_requires_assessment).
--   3. Decisions are auditable: quest_safety_assessment is append-only (supersession, never
--      mutation) and quest_audit_ledger records who did what.
--
-- Ownership: quest.owner_account_id references account (id) — Quest never copies identity data,
-- never stores an email or a date of birth, and reads Identity/Profiles only through ports.
--
-- ON DELETE is RESTRICT everywhere: account deletion runs through the application erasure path
-- (Phase 01 deletion job → AccountErasureContributor) so every step is audited.
--
-- Rollback (reverse order; data loss is inherent — run only before any production traffic):
--   DROP TABLE quest_audit_ledger, quest_participation, quest_version, quest_safety_assessment,
--              quest, quest_category;

-- ============================================================================================
-- Reference data: the normalized category taxonomy (seeded below, extended by later migrations).
-- ============================================================================================

CREATE TABLE quest_category (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- ============================================================================================
-- QUEST aggregate root
-- ============================================================================================

CREATE TABLE quest (
  id                       uuid PRIMARY KEY,
  -- Authoritative ownership. Server-derived from the authenticated principal, never client input.
  owner_account_id         uuid NOT NULL REFERENCES account (id) ON DELETE RESTRICT,
  state                    text NOT NULL,
  visibility               text NOT NULL,
  -- Monotonic counter over every edit; used for optimistic concurrency (expectedRevision).
  revision                 integer NOT NULL DEFAULT 1,

  -- Safety-relevant content. The hash below is taken over exactly these fields (canonicalQuestContent).
  title                    text NOT NULL,
  summary                  text NOT NULL,
  instructions             text NOT NULL,
  safety_notes             text,
  category_key             text NOT NULL REFERENCES quest_category (key) ON DELETE RESTRICT,
  difficulty               text NOT NULL,
  evidence                 jsonb NOT NULL,
  eligibility              jsonb NOT NULL,
  -- Coarse location only: country code + label. No coordinates are stored in Phase 02.
  location_country_code    text,
  location_label           text,

  -- Duration semantics, deliberately three separate concepts (effort / attempt window / availability).
  effort_minutes           integer NOT NULL,
  completion_window_hours  integer NOT NULL,
  available_from           timestamptz,
  available_until          timestamptz,

  -- Integrity: what the current content hashes to, and what was actually published.
  content_hash             text NOT NULL,
  published_version        integer,
  published_content_hash   text,
  published_assessment_id  uuid,
  published_at             timestamptz,
  -- Denormalised from the published assessment so eligibility filtering never re-reads it.
  published_minimum_age_band text,

  archived_at              timestamptz,
  suspended_at             timestamptz,
  suspended_by             uuid REFERENCES account (id) ON DELETE RESTRICT,
  suspension_reason        text,
  erased_at                timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quest_state_check CHECK (
    state IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED', 'SUSPENDED', 'ERASED')
  ),
  CONSTRAINT quest_visibility_check CHECK (visibility IN ('PUBLIC', 'UNLISTED', 'PRIVATE')),
  CONSTRAINT quest_difficulty_check CHECK (difficulty IN ('EASY', 'MODERATE', 'HARD', 'EXPERT')),
  CONSTRAINT quest_effort_check CHECK (effort_minutes BETWEEN 5 AND 480),
  CONSTRAINT quest_window_check CHECK (completion_window_hours BETWEEN 1 AND 720),
  CONSTRAINT quest_availability_check CHECK (
    available_from IS NULL OR available_until IS NULL OR available_until > available_from
  ),
  CONSTRAINT quest_location_country_check CHECK (
    location_country_code IS NULL OR location_country_code ~ '^[A-Z]{2}$'
  ),
  -- The database refuses a published Quest that is missing any part of its publication proof, so
  -- no code path (or manual UPDATE) can produce a public Quest without an assessment and a hash.
  CONSTRAINT quest_published_requires_assessment CHECK (
    state <> 'PUBLISHED' OR (
      published_assessment_id IS NOT NULL
      AND published_content_hash IS NOT NULL
      AND published_version IS NOT NULL
      AND published_at IS NOT NULL
      AND published_minimum_age_band IS NOT NULL
      AND published_content_hash = content_hash
    )
  ),
  CONSTRAINT quest_erased_check CHECK (state <> 'ERASED' OR erased_at IS NOT NULL)
);
--> statement-breakpoint

-- Discovery: newest published Quests, filtered by category/difficulty, keyset-paged by (created_at, id).
CREATE INDEX quest_discovery_idx
  ON quest (state, visibility, created_at DESC, id DESC)
  WHERE state = 'PUBLISHED' AND visibility = 'PUBLIC';
--> statement-breakpoint
-- "My quests" and the owner erasure path.
CREATE INDEX quest_owner_idx ON quest (owner_account_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX quest_category_idx ON quest (category_key) WHERE state = 'PUBLISHED';
--> statement-breakpoint
CREATE INDEX quest_suspended_by_idx ON quest (suspended_by) WHERE suspended_by IS NOT NULL;
--> statement-breakpoint

-- ============================================================================================
-- Append-only safety assessments (Trust & Safety contract, docs/security/QUEST_SAFETY_BASELINE.md)
-- ============================================================================================

CREATE TABLE quest_safety_assessment (
  id                       uuid PRIMARY KEY,
  quest_id                 uuid NOT NULL REFERENCES quest (id) ON DELETE RESTRICT,
  -- The exact content this decision was made about. A later edit changes the hash, which makes
  -- the decision stale by definition — this is the whole mechanism, so it is NOT NULL.
  content_hash             text NOT NULL,
  state                    text NOT NULL,
  signals                  jsonb NOT NULL DEFAULT '[]'::jsonb,
  restrictions             jsonb,
  policy_version           text NOT NULL,
  decided_by               text NOT NULL,
  ai_invocation_ref        text,
  supersedes_assessment_id uuid REFERENCES quest_safety_assessment (id) ON DELETE RESTRICT,
  assessed_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quest_assessment_state_check CHECK (
    state IN ('UNASSESSED', 'ALLOWED', 'ALLOWED_WITH_WARNING', 'RESTRICTED',
              'REVIEW_REQUIRED', 'REJECTED', 'ESCALATED')
  ),
  CONSTRAINT quest_assessment_decided_by_check CHECK (decided_by IN ('RULES', 'AI', 'HUMAN'))
);
--> statement-breakpoint

-- Latest assessment for a Quest (and for a specific content hash) — the publish gate's read.
CREATE INDEX quest_assessment_latest_idx
  ON quest_safety_assessment (quest_id, assessed_at DESC, id DESC);
--> statement-breakpoint
CREATE INDEX quest_assessment_hash_idx ON quest_safety_assessment (quest_id, content_hash);
--> statement-breakpoint

ALTER TABLE quest
  ADD CONSTRAINT quest_published_assessment_fk
  FOREIGN KEY (published_assessment_id) REFERENCES quest_safety_assessment (id) ON DELETE RESTRICT;
--> statement-breakpoint

-- ============================================================================================
-- Immutable published versions. A participation is bound to the version it accepted, so later
-- edits by the owner can never change the terms someone already agreed to.
-- ============================================================================================

CREATE TABLE quest_version (
  id             uuid PRIMARY KEY,
  quest_id       uuid NOT NULL REFERENCES quest (id) ON DELETE RESTRICT,
  version        integer NOT NULL,
  content_hash   text NOT NULL,
  -- Full snapshot of the content and terms as published (title, instructions, evidence, duration).
  content        jsonb NOT NULL,
  assessment_id  uuid NOT NULL REFERENCES quest_safety_assessment (id) ON DELETE RESTRICT,
  published_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quest_version_positive_check CHECK (version >= 1)
);
--> statement-breakpoint

CREATE UNIQUE INDEX quest_version_uidx ON quest_version (quest_id, version);
--> statement-breakpoint

-- ============================================================================================
-- Participation
-- ============================================================================================

CREATE TABLE quest_participation (
  id                       uuid PRIMARY KEY,
  quest_id                 uuid NOT NULL REFERENCES quest (id) ON DELETE RESTRICT,
  account_id               uuid NOT NULL REFERENCES account (id) ON DELETE RESTRICT,
  -- Frozen at acceptance: the participant's terms never change under them.
  quest_version            integer NOT NULL,
  state                    text NOT NULL,
  accepted_at              timestamptz NOT NULL DEFAULT now(),
  started_at               timestamptz,
  expires_at               timestamptz,
  completion_requested_at  timestamptz,
  completion_note          text,
  cancelled_at             timestamptz,
  cancelled_reason         text,
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT quest_participation_state_check CHECK (
    state IN ('ACCEPTED', 'STARTED', 'COMPLETION_REQUESTED', 'CANCELLED', 'EXPIRED')
  ),
  CONSTRAINT quest_participation_started_check CHECK (
    (state = 'ACCEPTED') OR started_at IS NOT NULL OR state IN ('CANCELLED', 'EXPIRED')
  )
);
--> statement-breakpoint

-- One active attempt per (quest, account): accepting twice is a conflict, not a second row.
CREATE UNIQUE INDEX quest_participation_active_uidx
  ON quest_participation (quest_id, account_id)
  WHERE state IN ('ACCEPTED', 'STARTED');
--> statement-breakpoint
CREATE INDEX quest_participation_account_idx ON quest_participation (account_id, accepted_at DESC);
--> statement-breakpoint
CREATE INDEX quest_participation_quest_idx ON quest_participation (quest_id, state);
--> statement-breakpoint
-- The expiry sweep reads exactly this.
CREATE INDEX quest_participation_expiry_idx
  ON quest_participation (expires_at)
  WHERE state = 'STARTED';
--> statement-breakpoint

-- ============================================================================================
-- Audit ledger: who did what to a Quest. Ids and enums only — never Quest text.
-- ============================================================================================

CREATE TABLE quest_audit_ledger (
  id          uuid PRIMARY KEY,
  quest_id    uuid REFERENCES quest (id) ON DELETE RESTRICT,
  actor_id    uuid REFERENCES account (id) ON DELETE RESTRICT,
  event_type  text NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX quest_audit_quest_idx ON quest_audit_ledger (quest_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX quest_audit_type_time_idx ON quest_audit_ledger (event_type, occurred_at DESC);
--> statement-breakpoint

-- updated_at maintenance (trigger function created in 0000_platform_extensions).
CREATE TRIGGER quest_set_updated_at
  BEFORE UPDATE ON quest
  FOR EACH ROW EXECUTE FUNCTION quest_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER quest_participation_set_updated_at
  BEFORE UPDATE ON quest_participation
  FOR EACH ROW EXECUTE FUNCTION quest_set_updated_at();
--> statement-breakpoint

-- ============================================================================================
-- Reference data: initial category taxonomy (idempotent).
-- ============================================================================================
INSERT INTO quest_category (key, label, sort_order) VALUES
  ('fitness',     'Fitness & movement',      10),
  ('outdoors',    'Outdoors & nature',       20),
  ('learning',    'Learning & study',        30),
  ('creativity',  'Creativity & making',     40),
  ('community',   'Community & helping',     50),
  ('environment', 'Environment & cleanup',   60),
  ('kindness',    'Kindness & connection',   70),
  ('culture',     'Culture & heritage',      80),
  ('food',        'Food & cooking',          90),
  ('mindfulness', 'Mindfulness & wellbeing', 100),
  ('skills',      'Practical skills',        110),
  ('exploration', 'Exploration & discovery', 120)
ON CONFLICT (key) DO NOTHING;
