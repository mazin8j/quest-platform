import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { account } from './identity';

/**
 * Profiles context tables — mirrors migration 0001_identity_profiles. Owned by
 * `modules/profiles`; the Identity context never writes them (it reacts to events instead).
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const profile = pgTable(
  'profile',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => account.id),
    username: text('username'),
    displayName: text('display_name'),
    bio: text('bio').notNull().default(''),
    avatarObjectKey: text('avatar_object_key'),
    language: text('language').notNull().default('en'),
    country: text('country'),
    timezone: text('timezone'),
    accountActive: boolean('account_active').notNull().default(false),
    onboardingCompletedAt: ts('onboarding_completed_at'),
    erasedAt: ts('erased_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('profile_username_uidx').on(t.username)],
);

export const interest = pgTable(
  'interest',
  {
    key: text('key').primaryKey(),
    label: text('label').notNull(),
    category: text('category').notNull(),
    sortOrder: integer('sort_order').notNull(),
    active: boolean('active').notNull().default(true),
  },
  (t) => [index('interest_active_sort_idx').on(t.category, t.sortOrder)],
);

export const accountInterest = pgTable(
  'account_interest',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    interestKey: text('interest_key')
      .notNull()
      .references(() => interest.key),
    selectedAt: ts('selected_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.interestKey] }),
    index('account_interest_interest_idx').on(t.interestKey),
  ],
);

export const privacySettings = pgTable('privacy_settings', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => account.id),
  profileVisibility: text('profile_visibility').notNull(),
  locationVisibility: text('location_visibility').notNull(),
  challengeInvitesFrom: text('challenge_invites_from').notNull(),
  discoverable: boolean('discoverable').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const accountBlock = pgTable(
  'account_block',
  {
    blockerAccountId: uuid('blocker_account_id')
      .notNull()
      .references(() => account.id),
    blockedAccountId: uuid('blocked_account_id')
      .notNull()
      .references(() => account.id),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerAccountId, t.blockedAccountId] }),
    index('account_block_blocked_idx').on(t.blockedAccountId),
  ],
);
