import {
  boolean,
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
 * Quest context tables — mirrors migration 0002_quest_core (hand-authored SQL is the source of
 * truth; this file gives Drizzle the column types). Owned by `modules/quests`; no other module
 * writes these tables, and this module writes no other context's tables.
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
      .references(() => account.id),
    state: text('state').notNull(),
    visibility: text('visibility').notNull(),
    revision: integer('revision').notNull().default(1),

    title: text('title').notNull(),
    summary: text('summary').notNull(),
    instructions: text('instructions').notNull(),
    safetyNotes: text('safety_notes'),
    categoryKey: text('category_key')
      .notNull()
      .references(() => questCategory.key),
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
    publishedAssessmentId: uuid('published_assessment_id'),
    publishedAt: ts('published_at'),
    publishedMinimumAgeBand: text('published_minimum_age_band'),

    archivedAt: ts('archived_at'),
    suspendedAt: ts('suspended_at'),
    suspendedBy: uuid('suspended_by').references(() => account.id),
    suspensionReason: text('suspension_reason'),
    erasedAt: ts('erased_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('quest_owner_idx').on(t.ownerAccountId, t.createdAt),
    index('quest_category_idx').on(t.categoryKey),
  ],
);

export const questSafetyAssessment = pgTable(
  'quest_safety_assessment',
  {
    id: uuid('id').primaryKey(),
    questId: uuid('quest_id')
      .notNull()
      .references(() => quest.id),
    contentHash: text('content_hash').notNull(),
    state: text('state').notNull(),
    signals: jsonb('signals').notNull(),
    restrictions: jsonb('restrictions'),
    policyVersion: text('policy_version').notNull(),
    decidedBy: text('decided_by').notNull(),
    aiInvocationRef: text('ai_invocation_ref'),
    supersedesAssessmentId: uuid('supersedes_assessment_id'),
    assessedAt: ts('assessed_at').notNull().defaultNow(),
  },
  (t) => [
    index('quest_assessment_latest_idx').on(t.questId, t.assessedAt, t.id),
    index('quest_assessment_hash_idx').on(t.questId, t.contentHash),
  ],
);

export const questVersion = pgTable(
  'quest_version',
  {
    id: uuid('id').primaryKey(),
    questId: uuid('quest_id')
      .notNull()
      .references(() => quest.id),
    version: integer('version').notNull(),
    contentHash: text('content_hash').notNull(),
    content: jsonb('content').notNull(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => questSafetyAssessment.id),
    publishedAt: ts('published_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('quest_version_uidx').on(t.questId, t.version)],
);

export const questParticipation = pgTable(
  'quest_participation',
  {
    id: uuid('id').primaryKey(),
    questId: uuid('quest_id')
      .notNull()
      .references(() => quest.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
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
    index('quest_participation_account_idx').on(t.accountId, t.acceptedAt),
    index('quest_participation_quest_idx').on(t.questId, t.state),
    index('quest_participation_expiry_idx').on(t.expiresAt),
  ],
);

export const questAuditLedger = pgTable(
  'quest_audit_ledger',
  {
    id: uuid('id').primaryKey(),
    questId: uuid('quest_id').references(() => quest.id),
    actorId: uuid('actor_id').references(() => account.id),
    eventType: text('event_type').notNull(),
    metadata: jsonb('metadata').notNull().$type<Record<string, string | number | boolean>>(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [index('quest_audit_quest_idx').on(t.questId, t.occurredAt)],
);
