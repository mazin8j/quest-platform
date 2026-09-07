import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { account } from './identity';

/**
 * Quest context tables — mirrors migration 0002_quest_core. The hand-authored SQL is the source of
 * truth (ADR-010); this file must nevertheless describe the same objects, because drizzle-kit
 * computes its next snapshot from *here*. A mirror that omits the indexes, foreign keys and CHECK
 * constraints would make the next `db:migrate:generate` emit DROP statements for them — including
 * `quest_published_requires_assessment`, the database half of the publication gate (audit P02-15).
 * `apps/api/test/integration/database.int.test.ts` compares the two against a live database.
 *
 * Owned by `modules/quests`; no other module writes these tables, and this module writes no other
 * context's tables (enforced by .dependency-cruiser.cjs).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const questCategory = pgTable('quest_category', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull().default(100),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const quest = pgTable(
  'quest',
  {
    id: uuid('id').primaryKey(),
    ownerAccountId: uuid('owner_account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'restrict' }),
    state: text('state').notNull(),
    visibility: text('visibility').notNull(),
    revision: integer('revision').notNull().default(1),

    title: text('title').notNull(),
    summary: text('summary').notNull(),
    instructions: text('instructions').notNull(),
    safetyNotes: text('safety_notes'),
    categoryKey: text('category_key')
      .notNull()
      .references(() => questCategory.key, { onDelete: 'restrict' }),
    difficulty: text('difficulty').notNull(),
    evidence: jsonb('evidence').notNull(),
    eligibility: jsonb('eligibility').notNull(),
    locationCountryCode: text('location_country_code'),
    locationLabel: text('location_label'),

    effortMinutes: integer('effort_minutes').notNull(),
    completionWindowHours: integer('completion_window_hours').notNull(),
    availableFrom: ts('available_from'),
    availableUntil: ts('available_until'),

    contentHash: text('content_hash').notNull(),
    publishedVersion: integer('published_version'),
    publishedContentHash: text('published_content_hash'),
    // `quest_published_assessment_fk` in the SQL. Declared there rather than here because the two
    // tables reference each other and drizzle cannot type a table-level circular foreign key; the
    // schema-parity test in test/integration/database.int.test.ts asserts it exists in the database.
    publishedAssessmentId: uuid('published_assessment_id'),
    publishedAt: ts('published_at'),
    publishedMinimumAgeBand: text('published_minimum_age_band'),

    archivedAt: ts('archived_at'),
    suspendedAt: ts('suspended_at'),
    suspendedBy: uuid('suspended_by').references(() => account.id, { onDelete: 'restrict' }),
    suspensionReason: text('suspension_reason'),
    erasedAt: ts('erased_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('quest_owner_idx').on(t.ownerAccountId, t.createdAt.desc()),
    index('quest_category_idx')
      .on(t.categoryKey)
      .where(sql`state = 'PUBLISHED'`),
    index('quest_discovery_idx')
      .on(t.state, t.visibility, t.createdAt.desc(), t.id.desc())
      .where(sql`state = 'PUBLISHED' AND visibility = 'PUBLIC'`),
    index('quest_suspended_by_idx')
      .on(t.suspendedBy)
      .where(sql`suspended_by IS NOT NULL`),
    check(
      'quest_state_check',
      sql`state IN ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED', 'SUSPENDED', 'ERASED')`,
    ),
    check('quest_visibility_check', sql`visibility IN ('PUBLIC', 'UNLISTED', 'PRIVATE')`),
    check('quest_difficulty_check', sql`difficulty IN ('EASY', 'MODERATE', 'HARD', 'EXPERT')`),
    check('quest_effort_check', sql`effort_minutes BETWEEN 5 AND 480`),
    check('quest_window_check', sql`completion_window_hours BETWEEN 1 AND 720`),
    check(
      'quest_availability_check',
      sql`available_from IS NULL OR available_until IS NULL OR available_until > available_from`,
    ),
    check(
      'quest_location_country_check',
      sql`location_country_code IS NULL OR location_country_code ~ '^[A-Z]{2}$'`,
    ),
    check(
      'quest_published_requires_assessment',
      sql`state <> 'PUBLISHED' OR (
      published_assessment_id IS NOT NULL
      AND published_content_hash IS NOT NULL
      AND published_version IS NOT NULL
      AND published_at IS NOT NULL
      AND published_minimum_age_band IS NOT NULL
      AND published_content_hash = content_hash
    )`,
    ),
    check('quest_erased_check', sql`state <> 'ERASED' OR erased_at IS NOT NULL`),
  ],
);

export const questSafetyAssessment = pgTable(
  'quest_safety_assessment',
  {
    id: uuid('id').primaryKey(),
    questId: uuid('quest_id')
      .notNull()
      .references(() => quest.id, { onDelete: 'restrict' }),
    contentHash: text('content_hash').notNull(),
    state: text('state').notNull(),
    signals: jsonb('signals').notNull().default([]),
    restrictions: jsonb('restrictions'),
    policyVersion: text('policy_version').notNull(),
    decidedBy: text('decided_by').notNull(),
    aiInvocationRef: text('ai_invocation_ref'),
    supersedesAssessmentId: uuid('supersedes_assessment_id').references(
      (): AnyPgColumn => questSafetyAssessment.id,
      { onDelete: 'restrict' },
    ),
    assessedAt: ts('assessed_at').notNull().defaultNow(),
    /** Commit-independent insertion order; "latest assessment" is answered by this, not by time. */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
  },
  (t) => [
    index('quest_assessment_latest_idx').on(t.questId, t.seq.desc()),
    index('quest_assessment_hash_idx').on(t.questId, t.contentHash),
    check(
      'quest_assessment_state_check',
      sql`state IN ('UNASSESSED', 'ALLOWED', 'ALLOWED_WITH_WARNING', 'RESTRICTED',
              'REVIEW_REQUIRED', 'REJECTED', 'ESCALATED')`,
    ),
    check('quest_assessment_decided_by_check', sql`decided_by IN ('RULES', 'AI', 'HUMAN')`),
  ],
);

export const questVersion = pgTable(
  'quest_version',
  {
    id: uuid('id').primaryKey(),
    questId: uuid('quest_id')
      .notNull()
      .references(() => quest.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    contentHash: text('content_hash').notNull(),
    content: jsonb('content').notNull(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => questSafetyAssessment.id, { onDelete: 'restrict' }),
    publishedAt: ts('published_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('quest_version_uidx').on(t.questId, t.version),
    check('quest_version_positive_check', sql`version >= 1`),
  ],
);

export const questParticipation = pgTable(
  'quest_participation',
  {
    id: uuid('id').primaryKey(),
    questId: uuid('quest_id')
      .notNull()
      .references(() => quest.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id, { onDelete: 'restrict' }),
    questVersion: integer('quest_version').notNull(),
    state: text('state').notNull(),
    acceptedAt: ts('accepted_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    expiresAt: ts('expires_at'),
    completionRequestedAt: ts('completion_requested_at'),
    completionNote: text('completion_note'),
    cancelledAt: ts('cancelled_at'),
    cancelledReason: text('cancelled_reason'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // The one-active-attempt-per-(quest, account) invariant. Partial and unique: losing it would
    // turn a duplicate accept from a 409 into a second live attempt.
    uniqueIndex('quest_participation_active_uidx')
      .on(t.questId, t.accountId)
      .where(sql`state IN ('ACCEPTED', 'STARTED')`),
    index('quest_participation_account_idx').on(t.accountId, t.acceptedAt.desc()),
    index('quest_participation_quest_idx').on(t.questId, t.state),
    index('quest_participation_expiry_idx')
      .on(t.expiresAt)
      .where(sql`state = 'STARTED'`),
    check(
      'quest_participation_state_check',
      sql`state IN ('ACCEPTED', 'STARTED', 'COMPLETION_REQUESTED', 'CANCELLED', 'EXPIRED')`,
    ),
    check(
      'quest_participation_started_check',
      sql`(state = 'ACCEPTED') OR started_at IS NOT NULL OR state IN ('CANCELLED', 'EXPIRED')`,
    ),
  ],
);

export const questAuditLedger = pgTable(
  'quest_audit_ledger',
  {
    id: uuid('id').primaryKey(),
    questId: uuid('quest_id').references(() => quest.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id').references(() => account.id, { onDelete: 'restrict' }),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default({})
      .$type<Record<string, string | number | boolean>>(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('quest_audit_quest_idx').on(t.questId, t.occurredAt.desc()),
    index('quest_audit_type_time_idx').on(t.eventType, t.occurredAt.desc()),
  ],
);
