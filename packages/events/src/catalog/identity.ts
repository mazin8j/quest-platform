import { z } from 'zod';

import { defineEvent } from '../envelope';

/**
 * Identity context events (Phase 01). Payloads carry identifiers and facts only — never email,
 * names, date of birth, tokens or push tokens. Consumers must be idempotent on `eventId`.
 *
 * Aggregate: `account`. Source: `api.identity`.
 */
const AGGREGATE = 'account';

const accountPayload = z.object({ accountId: z.uuid() });

export const AccountRegistered = defineEvent({
  eventType: 'identity.account.registered',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({
    method: z.enum(['PASSWORD', 'APPLE', 'GOOGLE', 'FAKE']),
    /** Coarse band only; the DOB never leaves the Identity context. */
    ageBand: z.enum(['TEEN_13_15', 'TEEN_16_17', 'ADULT']),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    language: z.string().nullable(),
  }),
});

export const AccountEmailVerified = defineEvent({
  eventType: 'identity.account.email-verified',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload,
});

export const AccountDeactivated = defineEvent({
  eventType: 'identity.account.deactivated',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload,
});

export const AccountReactivated = defineEvent({
  eventType: 'identity.account.reactivated',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload,
});

export const AccountSuspended = defineEvent({
  eventType: 'identity.account.suspended',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({ byStaffAccountId: z.uuid() }),
});

export const AccountReinstated = defineEvent({
  eventType: 'identity.account.reinstated',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({ byStaffAccountId: z.uuid() }),
});

export const AccountDeletionRequested = defineEvent({
  eventType: 'identity.account.deletion-requested',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({
    deletionRequestId: z.uuid(),
    scheduledFor: z.iso.datetime(),
  }),
});

export const AccountDeletionCancelled = defineEvent({
  eventType: 'identity.account.deletion-cancelled',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({ deletionRequestId: z.uuid() }),
});

/**
 * Terminal fact. Every bounded context subscribes and erases or anonymises the account's data
 * (docs/data/IDENTITY_DATA_MODEL.md "Deletion cascade"). Handlers must be idempotent: the event
 * may be redelivered and the account row is already anonymised when it fires.
 */
export const AccountDeleted = defineEvent({
  eventType: 'identity.account.deleted',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({
    deletionRequestId: z.uuid(),
    deletedAt: z.iso.datetime(),
  }),
});

export const AccountRoleGranted = defineEvent({
  eventType: 'identity.account.role-granted',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({ role: z.string(), byStaffAccountId: z.uuid() }),
});

export const AccountRoleRevoked = defineEvent({
  eventType: 'identity.account.role-revoked',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({ role: z.string(), byStaffAccountId: z.uuid() }),
});

/** Sessions revoked for security reasons (password change, sign-out-everywhere, refresh reuse). */
export const AccountSessionsRevoked = defineEvent({
  eventType: 'identity.account.sessions-revoked',
  eventVersion: 1,
  aggregateType: AGGREGATE,
  payloadSchema: accountPayload.extend({
    reason: z.enum([
      'USER_SIGN_OUT_ALL',
      'PASSWORD_CHANGED',
      'PASSWORD_RESET',
      'REFRESH_TOKEN_REUSE',
      'DEACTIVATED',
      'DELETION_REQUESTED',
      'SUSPENDED',
    ]),
    sessionCount: z.number().int().nonnegative(),
  }),
});

/** Public profile changed (Profiles context). Consumers re-read through the ProfileQueryPort. */
export const ProfileUpdated = defineEvent({
  eventType: 'profiles.profile.updated',
  eventVersion: 1,
  aggregateType: 'profile',
  payloadSchema: z.object({
    accountId: z.uuid(),
    changedFields: z.array(z.string()),
  }),
});

export const IDENTITY_EVENTS = [
  AccountRegistered,
  AccountEmailVerified,
  AccountDeactivated,
  AccountReactivated,
  AccountSuspended,
  AccountReinstated,
  AccountDeletionRequested,
  AccountDeletionCancelled,
  AccountDeleted,
  AccountRoleGranted,
  AccountRoleRevoked,
  AccountSessionsRevoked,
  ProfileUpdated,
] as const;
