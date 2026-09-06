import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Identity context tables — mirrors migration 0001_identity_profiles (hand-authored SQL is the
 * source of truth; this file gives Drizzle the column types). Owned by `modules/identity`;
 * no other module writes these tables.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey(),
    email: text('email'),
    emailVerifiedAt: ts('email_verified_at'),
    emailTombstone: text('email_tombstone'),
    state: text('state').notNull(),
    dateOfBirth: date('date_of_birth', { mode: 'string' }).notNull(),
    lastLoginAt: ts('last_login_at'),
    deactivatedAt: ts('deactivated_at'),
    suspendedAt: ts('suspended_at'),
    suspendedBy: uuid('suspended_by'),
    suspensionReason: text('suspension_reason'),
    deletedAt: ts('deleted_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('account_state_idx').on(t.state)],
);

export const accountRole = pgTable(
  'account_role',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    role: text('role').notNull(),
    grantedBy: uuid('granted_by').references(() => account.id),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    revokedBy: uuid('revoked_by').references(() => account.id),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('account_role_account_idx').on(t.accountId)],
);

export const consentRecord = pgTable(
  'consent_record',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    consentType: text('consent_type').notNull(),
    documentVersion: text('document_version'),
    granted: boolean('granted').notNull(),
    source: text('source').notNull(),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
  },
  (t) => [index('consent_record_account_type_idx').on(t.accountId, t.consentType, t.recordedAt)],
);

export const accountDeletionRequest = pgTable(
  'account_deletion_request',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    status: text('status').notNull(),
    reason: text('reason'),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    scheduledFor: ts('scheduled_for').notNull(),
    cancelledAt: ts('cancelled_at'),
    completedAt: ts('completed_at'),
  },
  (t) => [index('account_deletion_request_account_idx').on(t.accountId)],
);

export const dataExportRequest = pgTable(
  'data_export_request',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    status: text('status').notNull(),
    requestedAt: ts('requested_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    completedAt: ts('completed_at'),
    expiresAt: ts('expires_at'),
    objectKey: text('object_key'),
    failureReason: text('failure_reason'),
  },
  (t) => [index('data_export_request_account_idx').on(t.accountId, t.requestedAt)],
);

export const accountCredential = pgTable('account_credential', {
  accountId: uuid('account_id')
    .primaryKey()
    .references(() => account.id),
  passwordHash: text('password_hash').notNull(),
  passwordChangedAt: ts('password_changed_at').notNull().defaultNow(),
  failedAttempts: integer('failed_attempts').notNull().default(0),
  lockedUntil: ts('locked_until'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const accountIdentity = pgTable(
  'account_identity',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    provider: text('provider').notNull(),
    providerSubject: text('provider_subject').notNull(),
    emailAtLink: text('email_at_link'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at'),
  },
  (t) => [
    uniqueIndex('account_identity_provider_subject_uidx').on(t.provider, t.providerSubject),
    index('account_identity_account_idx').on(t.accountId),
  ],
);

export const verificationCode = pgTable(
  'verification_code',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    purpose: text('purpose').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: ts('expires_at').notNull(),
    attempts: integer('attempts').notNull().default(0),
    consumedAt: ts('consumed_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('verification_code_live_idx').on(t.accountId, t.purpose, t.createdAt)],
);

export const device = pgTable(
  'device',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    installationId: text('installation_id').notNull(),
    platform: text('platform').notNull(),
    appVersion: text('app_version'),
    deviceName: text('device_name'),
    pushToken: text('push_token'),
    locale: text('locale'),
    timezone: text('timezone'),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('device_account_installation_uidx').on(t.accountId, t.installationId)],
);

export const authSession = pgTable(
  'auth_session',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => account.id),
    deviceId: uuid('device_id').references(() => device.id),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    previousRefreshTokenHash: text('previous_refresh_token_hash'),
    refreshGeneration: integer('refresh_generation').notNull().default(1),
    refreshExpiresAt: ts('refresh_expires_at').notNull(),
    absoluteExpiresAt: ts('absolute_expires_at').notNull(),
    clientPlatform: text('client_platform'),
    clientAppVersion: text('client_app_version'),
    clientDeviceName: text('client_device_name'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
  },
  (t) => [
    uniqueIndex('auth_session_refresh_token_hash_uidx').on(t.refreshTokenHash),
    index('auth_session_absolute_expires_idx').on(t.absoluteExpiresAt),
  ],
);

export const identityAuditLedger = pgTable(
  'identity_audit_ledger',
  {
    id: uuid('id').primaryKey(),
    accountId: uuid('account_id').references(() => account.id),
    actorId: uuid('actor_id').references(() => account.id),
    eventType: text('event_type').notNull(),
    sessionId: uuid('session_id'),
    metadata: jsonb('metadata').notNull().$type<Record<string, string | number | boolean>>(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
  },
  (t) => [index('identity_audit_ledger_type_time_idx').on(t.eventType, t.occurredAt)],
);
