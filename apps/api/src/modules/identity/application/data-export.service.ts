import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DATA_EXPORT_BUNDLE_VERSION,
  DATA_EXPORT_MIN_INTERVAL_HOURS,
  DATA_EXPORT_TTL_DAYS,
  type DataExportBundle,
  type DataExportRequestView,
  dataExportBundleSchema,
} from '@quest/types';
import { Logger } from 'nestjs-pino';

import type { Principal } from '../../../common/auth/principal';
import { ApiError } from '../../../common/filters/api-error';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import {
  DATA_EXPORT_REGISTRY,
  type DataExportRegistryPort,
} from '../../../infrastructure/data-export/data-export.port';
import {
  OBJECT_STORAGE,
  type ObjectStoragePort,
} from '../../../infrastructure/object-storage/object-storage.port';
import { AccountRepository } from '../infrastructure/account.repository';
import { type DataExportRecord, LifecycleRepository } from '../infrastructure/lifecycle.repository';
import { SessionRepository } from '../infrastructure/session.repository';
import { MAILER, type MailerPort } from '../ports/mailer.port';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DOWNLOAD_URL_TTL_S = 900;

/**
 * User-data export (right of access / portability). Requests are recorded synchronously and
 * fulfilled by `processOpen()` — invoked by the operator CLI now and by a scheduled worker once
 * the deployment exists (BACKLOG TD-21). Bundles are JSON, stored privately, downloadable via a
 * short-lived pre-signed URL for DATA_EXPORT_TTL_DAYS.
 */
@Injectable()
export class DataExportService implements OnModuleInit {
  constructor(
    @Inject(DATA_EXPORT_REGISTRY) private readonly registry: DataExportRegistryPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    private readonly logger: Logger,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly lifecycle: LifecycleRepository,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      context: 'identity',
      schemaVersion: 1,
      exportAccountData: (accountId) => this.exportIdentityData(accountId),
    });
  }

  async request(principal: Principal): Promise<DataExportRequestView> {
    const latest = await this.lifecycle.latestExport(principal.accountId);
    if (latest) {
      if (latest.status === 'REQUESTED' || latest.status === 'PROCESSING') {
        throw ApiError.conflict('An export is already in progress');
      }
      const ageMs = Date.now() - latest.requestedAt.getTime();
      if (ageMs < DATA_EXPORT_MIN_INTERVAL_HOURS * HOUR_MS) {
        throw ApiError.conflict(
          `Exports can be requested once every ${DATA_EXPORT_MIN_INTERVAL_HOURS} hours`,
        );
      }
    }
    const created = await this.lifecycle.createExport(principal.accountId);
    await this.lifecycle.audit({ accountId: principal.accountId, eventType: 'EXPORT_REQUESTED' });
    this.metrics.increment('quest.identity.export.requested');
    return this.view(created);
  }

  async get(principal: Principal, exportId: string): Promise<DataExportRequestView> {
    const record = await this.lifecycle.findExport(principal.accountId, exportId);
    if (!record) throw ApiError.notFound('Export');
    return this.view(await this.expireIfDue(record));
  }

  async latest(principal: Principal): Promise<DataExportRequestView> {
    const record = await this.lifecycle.latestExport(principal.accountId);
    if (!record) throw ApiError.notFound('Export');
    return this.view(await this.expireIfDue(record));
  }

  /** Worker entry point: fulfils open requests. Idempotent per request (status guards). */
  async processOpen(limit = 20): Promise<{ processed: number; failed: number }> {
    const open = await this.lifecycle.openExports(limit);
    let processed = 0;
    let failed = 0;
    for (const record of open) {
      try {
        await this.fulfil(record);
        processed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          { exportId: record.id, err: error instanceof Error ? error.message : String(error) },
          'data export failed',
        );
        await this.lifecycle.updateExport(record.id, {
          status: 'FAILED',
          failureReason: 'INTERNAL',
          completedAt: new Date(),
        });
        await this.lifecycle.audit({ accountId: record.accountId, eventType: 'EXPORT_FAILED' });
      }
    }
    return { processed, failed };
  }

  async fulfil(record: DataExportRecord): Promise<void> {
    await this.lifecycle.updateExport(record.id, { status: 'PROCESSING', startedAt: new Date() });
    const sections = [];
    for (const contributor of this.registry.contributors()) {
      sections.push({
        context: contributor.context,
        schemaVersion: contributor.schemaVersion,
        data: await contributor.exportAccountData(record.accountId),
      });
    }
    const bundle: DataExportBundle = dataExportBundleSchema.parse({
      bundleVersion: DATA_EXPORT_BUNDLE_VERSION,
      accountId: record.accountId,
      generatedAt: new Date().toISOString(),
      sections,
    });
    const objectKey = `exports/${record.accountId}/${record.id}.json`;
    await this.storage.putObject({
      objectKey,
      body: JSON.stringify(bundle, null, 2),
      contentType: 'application/json',
    });
    const now = new Date();
    await this.lifecycle.updateExport(record.id, {
      status: 'READY',
      completedAt: now,
      expiresAt: new Date(now.getTime() + DATA_EXPORT_TTL_DAYS * DAY_MS),
      objectKey,
    });
    await this.lifecycle.audit({ accountId: record.accountId, eventType: 'EXPORT_COMPLETED' });
    this.metrics.increment('quest.identity.export.completed');
    const account = await this.accounts.findById(record.accountId);
    if (account?.email) {
      await this.mailer.send({
        to: account.email,
        language: 'en',
        template: { name: 'DATA_EXPORT_READY' },
      });
    }
  }

  /** Identity's own section: account facts, consents, sessions, devices, audit trail. No secrets. */
  async exportIdentityData(accountId: string): Promise<unknown> {
    const account = await this.accounts.findById(accountId);
    if (!account) return null;
    const [roles, identities, consents, sessions, devices, audit] = await Promise.all([
      this.accounts.activeRoles(accountId),
      this.accounts.listIdentities(accountId),
      this.accounts.listConsents(accountId),
      this.sessions.listLiveSessions(accountId),
      this.sessions.listDevices(accountId),
      this.lifecycle.listAudit(accountId, 500),
    ]);
    return {
      account: {
        accountId: account.id,
        email: account.email,
        emailVerifiedAt: account.emailVerifiedAt?.toISOString() ?? null,
        state: account.state,
        dateOfBirth: account.dateOfBirth,
        createdAt: account.createdAt.toISOString(),
        lastLoginAt: account.lastLoginAt?.toISOString() ?? null,
      },
      roles: ['USER', ...roles],
      linkedIdentities: identities.map((i) => ({
        provider: i.provider,
        linkedAt: i.createdAt.toISOString(),
      })),
      consents: consents.map((c) => ({
        type: c.consentType,
        documentVersion: c.documentVersion,
        granted: c.granted,
        source: c.source,
        recordedAt: c.recordedAt.toISOString(),
      })),
      sessions: sessions.map((s) => ({
        createdAt: s.createdAt.toISOString(),
        lastUsedAt: s.lastUsedAt.toISOString(),
        platform: s.clientPlatform,
        appVersion: s.clientAppVersion,
        deviceName: s.clientDeviceName,
      })),
      devices: devices.map((d) => ({
        platform: d.platform,
        appVersion: d.appVersion,
        deviceName: d.deviceName,
        pushEnabled: d.pushToken !== null,
        registeredAt: d.createdAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
      })),
      securityEvents: audit.map((a) => ({
        type: a.eventType,
        occurredAt: a.occurredAt.toISOString(),
        details: a.metadata,
      })),
    };
  }

  private async expireIfDue(record: DataExportRecord): Promise<DataExportRecord> {
    if (record.status === 'READY' && record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
      await this.lifecycle.updateExport(record.id, { status: 'EXPIRED' });
      if (record.objectKey) await this.storage.delete(record.objectKey).catch(() => undefined);
      return { ...record, status: 'EXPIRED' };
    }
    return record;
  }

  private async view(record: DataExportRecord): Promise<DataExportRequestView> {
    const downloadUrl =
      record.status === 'READY' && record.objectKey
        ? await this.storage.presignDownload(record.objectKey, DOWNLOAD_URL_TTL_S)
        : null;
    return {
      exportId: record.id,
      status: record.status,
      requestedAt: record.requestedAt.toISOString(),
      completedAt: record.completedAt?.toISOString() ?? null,
      expiresAt: record.expiresAt?.toISOString() ?? null,
      downloadUrl,
    };
  }
}
