import { z } from 'zod';

import { isoDateTimeSchema, uuidSchema } from '../api/common';
import { paginatedSchema } from '../api/pagination';
import { ageBandSchema } from './age-policy';
import {
  clientPlatformSchema,
  consentDocumentVersionSchema,
  consentTypeSchema,
  installationIdSchema,
} from './auth';
import { roleSchema, staffRoleSchema } from './authz';
import { accountStateSchema } from './lifecycle';

/**
 * ACCOUNT contracts (Phase 01): sessions, devices, consent history, lifecycle actions, deletion
 * requests, data export. Everything here is keyed by the immutable `accountId`.
 */

// ---------------------------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------------------------

export const sessionViewSchema = z.object({
  sessionId: uuidSchema,
  /** True for the session that made the request. */
  current: z.boolean(),
  createdAt: isoDateTimeSchema,
  lastUsedAt: isoDateTimeSchema,
  expiresAt: isoDateTimeSchema,
  client: z.object({
    platform: clientPlatformSchema.nullable(),
    appVersion: z.string().nullable(),
    deviceName: z.string().nullable(),
  }),
});
export type SessionView = z.infer<typeof sessionViewSchema>;
export const sessionListSchema = paginatedSchema(sessionViewSchema);
export type SessionList = z.infer<typeof sessionListSchema>;

// ---------------------------------------------------------------------------------------------
// Devices (registration for future notifications; push tokens are CONFIDENTIAL)
// ---------------------------------------------------------------------------------------------

export const registerDeviceRequestSchema = z.object({
  installationId: installationIdSchema,
  platform: clientPlatformSchema,
  appVersion: z.string().max(32).optional(),
  deviceName: z.string().trim().max(64).optional(),
  /** Push provider token (APNs/FCM). Stored, never returned; rotated by re-registering. */
  pushToken: z.string().min(16).max(512).optional(),
  /** BCP-47 locale the device is set to, for notification localisation. */
  locale: z.string().max(16).optional(),
  timezone: z.string().max(64).optional(),
});
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;

export const deviceViewSchema = z.object({
  deviceId: uuidSchema,
  installationId: installationIdSchema,
  platform: clientPlatformSchema,
  appVersion: z.string().nullable(),
  deviceName: z.string().nullable(),
  /** Whether a push token is currently registered (the token itself is never returned). */
  pushEnabled: z.boolean(),
  createdAt: isoDateTimeSchema,
  lastSeenAt: isoDateTimeSchema,
});
export type DeviceView = z.infer<typeof deviceViewSchema>;
export const deviceListSchema = paginatedSchema(deviceViewSchema);
export type DeviceList = z.infer<typeof deviceListSchema>;

// ---------------------------------------------------------------------------------------------
// Consent history (append-only ledger)
// ---------------------------------------------------------------------------------------------

export const ConsentSource = {
  REGISTRATION: 'REGISTRATION',
  SETTINGS: 'SETTINGS',
  REPROMPT: 'REPROMPT',
  SUPPORT: 'SUPPORT',
} as const;
export type ConsentSource = (typeof ConsentSource)[keyof typeof ConsentSource];
export const consentSourceSchema = z.enum(
  Object.values(ConsentSource) as [ConsentSource, ...ConsentSource[]],
);

export const consentRecordSchema = z.object({
  consentId: uuidSchema,
  type: consentTypeSchema,
  /** Version of the document/setting the decision refers to. */
  documentVersion: consentDocumentVersionSchema.nullable(),
  granted: z.boolean(),
  source: consentSourceSchema,
  recordedAt: isoDateTimeSchema,
});
export type ConsentRecord = z.infer<typeof consentRecordSchema>;
export const consentHistorySchema = paginatedSchema(consentRecordSchema);

/** Current effective state per consent type (latest record wins). */
export const consentStateSchema = z.object({
  current: z.partialRecord(
    consentTypeSchema,
    z.object({
      granted: z.boolean(),
      documentVersion: z.string().nullable(),
      recordedAt: isoDateTimeSchema,
    }),
  ),
  /** Consent types whose latest granted version is older than the required version. */
  requiresReprompt: z.array(consentTypeSchema),
});
export type ConsentState = z.infer<typeof consentStateSchema>;

export const recordConsentRequestSchema = z.object({
  type: consentTypeSchema,
  granted: z.boolean(),
  documentVersion: consentDocumentVersionSchema.optional(),
});
export type RecordConsentRequest = z.infer<typeof recordConsentRequestSchema>;

// ---------------------------------------------------------------------------------------------
// Lifecycle actions
// ---------------------------------------------------------------------------------------------

export const DeletionRequestStatus = {
  PENDING: 'PENDING',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
} as const;
export type DeletionRequestStatus =
  (typeof DeletionRequestStatus)[keyof typeof DeletionRequestStatus];
export const deletionRequestStatusSchema = z.enum(
  Object.values(DeletionRequestStatus) as [DeletionRequestStatus, ...DeletionRequestStatus[]],
);

/** Grace period during which a deletion request can be cancelled by signing in. */
export const DELETION_GRACE_DAYS = 30;

export const requestDeletionRequestSchema = z.object({
  /** Re-authentication: current password (password accounts) — provider accounts pass none. */
  currentPassword: z.string().min(1).max(128).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type RequestDeletionRequest = z.infer<typeof requestDeletionRequestSchema>;

export const deletionRequestViewSchema = z.object({
  deletionRequestId: uuidSchema,
  status: deletionRequestStatusSchema,
  requestedAt: isoDateTimeSchema,
  /** When the account will be irreversibly anonymised unless cancelled. */
  scheduledFor: isoDateTimeSchema,
  cancelledAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
});
export type DeletionRequestView = z.infer<typeof deletionRequestViewSchema>;

// ---------------------------------------------------------------------------------------------
// Data export (user-data export contract)
// ---------------------------------------------------------------------------------------------

export const DataExportStatus = {
  REQUESTED: 'REQUESTED',
  PROCESSING: 'PROCESSING',
  READY: 'READY',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED',
} as const;
export type DataExportStatus = (typeof DataExportStatus)[keyof typeof DataExportStatus];
export const dataExportStatusSchema = z.enum(
  Object.values(DataExportStatus) as [DataExportStatus, ...DataExportStatus[]],
);

/** How long a finished export stays downloadable. */
export const DATA_EXPORT_TTL_DAYS = 7;
/** Minimum spacing between export requests per account. */
export const DATA_EXPORT_MIN_INTERVAL_HOURS = 24;

export const dataExportRequestViewSchema = z.object({
  exportId: uuidSchema,
  status: dataExportStatusSchema,
  requestedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  expiresAt: isoDateTimeSchema.nullable(),
  /** Short-lived pre-signed download URL; present only while READY. */
  downloadUrl: z.string().url().nullable(),
});
export type DataExportRequestView = z.infer<typeof dataExportRequestViewSchema>;

/**
 * The export bundle every bounded context contributes to. Each context returns one section keyed
 * by its name with its own schema version, so consumers can evolve sections independently.
 * Bundle version bumps only when the envelope changes.
 */
export const DATA_EXPORT_BUNDLE_VERSION = 1;

export const dataExportSectionSchema = z.object({
  context: z.string().regex(/^[a-z][a-z0-9-]*$/),
  schemaVersion: z.number().int().positive(),
  /** JSON-serialisable, PII belonging to the account only; never other users' data. */
  data: z.unknown(),
});
export type DataExportSection = z.infer<typeof dataExportSectionSchema>;

export const dataExportBundleSchema = z.object({
  bundleVersion: z.literal(DATA_EXPORT_BUNDLE_VERSION),
  accountId: uuidSchema,
  generatedAt: isoDateTimeSchema,
  sections: z.array(dataExportSectionSchema),
});
export type DataExportBundle = z.infer<typeof dataExportBundleSchema>;

// ---------------------------------------------------------------------------------------------
// Staff / support (admin support fields only where needed)
// ---------------------------------------------------------------------------------------------

/** Support view: enough to help a user, never the DOB, never credentials, never push tokens. */
export const accountSupportViewSchema = z.object({
  accountId: uuidSchema,
  email: z.string(),
  emailVerified: z.boolean(),
  state: accountStateSchema,
  ageBand: ageBandSchema,
  roles: z.array(roleSchema),
  createdAt: isoDateTimeSchema,
  lastLoginAt: isoDateTimeSchema.nullable(),
  suspendedAt: isoDateTimeSchema.nullable(),
  suspensionReason: z.string().nullable(),
  deletionScheduledFor: isoDateTimeSchema.nullable(),
  activeSessionCount: z.number().int().nonnegative(),
  username: z.string().nullable(),
});
export type AccountSupportView = z.infer<typeof accountSupportViewSchema>;

export const suspendAccountRequestSchema = z.object({
  /** Internal reason shown to staff only; the user receives a generic notice. */
  reason: z.string().trim().min(3).max(500),
});
export type SuspendAccountRequest = z.infer<typeof suspendAccountRequestSchema>;

export const grantRoleRequestSchema = z.object({ role: staffRoleSchema });
export const revokeRoleRequestSchema = z.object({ role: staffRoleSchema });
