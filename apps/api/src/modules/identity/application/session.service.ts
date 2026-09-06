import { Inject, Injectable } from '@nestjs/common';
import {
  type ClientContext,
  type DeviceView,
  type RegisterDeviceRequest,
  type Role,
  SIGN_IN_ALLOWED_STATES,
  type SessionView,
  type TokenPair,
} from '@quest/types';

import type { Principal, PrincipalResolver } from '../../../common/auth/principal';
import { ApiError } from '../../../common/filters/api-error';
import { uuidv7 } from '../../../common/ids/uuid-v7';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { DATABASE, type Database } from '../../../infrastructure/database/database.module';
import type { Executor } from '../../../infrastructure/database/executor';
import { type AccountRecord, accountAgeBand } from '../domain/account';
import { generateRefreshToken, hashToken } from '../domain/secrets';
import { AccountRepository } from '../infrastructure/account.repository';
import { LifecycleRepository } from '../infrastructure/lifecycle.repository';
import { type SessionRecord, SessionRepository } from '../infrastructure/session.repository';
import { TOKEN_SIGNER, type TokenSignerPort } from '../ports/token-signer.port';

const DAY_MS = 86_400_000;

/**
 * Sessions and tokens (ADR-011): short-lived HS256 access tokens bound to a session id, opaque
 * rotating refresh tokens with reuse detection, per-account session cap, device registration.
 * Also the PrincipalResolver used by the AuthGuard for every request.
 */
@Injectable()
export class SessionService implements PrincipalResolver {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TOKEN_SIGNER) private readonly signer: TokenSignerPort,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    private readonly accounts: AccountRepository,
    private readonly sessions: SessionRepository,
    private readonly lifecycle: LifecycleRepository,
  ) {}

  // ----------------------------------------------------------------- principal resolver ----

  async resolve(bearerToken: string): Promise<Principal | null> {
    const claims = await this.signer.verify(bearerToken);
    if (!claims) return null;
    const session = await this.sessions.findSessionById(claims.sid);
    const now = Date.now();
    if (
      !session ||
      session.accountId !== claims.sub ||
      session.revokedAt ||
      session.absoluteExpiresAt.getTime() <= now ||
      session.refreshExpiresAt.getTime() <= now
    ) {
      return null;
    }
    const account = await this.accounts.findById(claims.sub);
    if (!account || !SIGN_IN_ALLOWED_STATES.has(account.state)) return null;
    const roles = await this.accounts.activeRoles(account.id);
    return {
      accountId: account.id,
      sessionId: session.id,
      roles: ['USER', ...roles],
      state: account.state,
      emailVerified: account.emailVerifiedAt !== null,
      ageBand: accountAgeBand(account),
    };
  }

  // ----------------------------------------------------------------------- issue / rotate ----

  /** Creates a session (optionally bound to a registered device) and returns the token pair. */
  async issueSession(
    account: AccountRecord,
    roles: ReadonlyArray<Role>,
    client: ClientContext | undefined,
    tx?: Executor,
  ): Promise<TokenPair> {
    const now = new Date();
    const refreshToken = generateRefreshToken();
    let deviceId: string | null = null;
    if (client) {
      const device = await this.sessions.upsertDevice(
        {
          accountId: account.id,
          installationId: client.installationId,
          platform: client.platform,
          appVersion: client.appVersion ?? null,
          deviceName: client.deviceName ?? null,
        },
        tx,
      );
      deviceId = device.id;
    }
    await this.sessions.evictOldestBeyond(
      account.id,
      this.config.AUTH_MAX_SESSIONS_PER_ACCOUNT - 1,
      tx,
    );
    const session = await this.sessions.insertSession(
      {
        id: uuidv7(),
        accountId: account.id,
        deviceId,
        refreshTokenHash: hashToken(refreshToken),
        refreshGeneration: 1,
        refreshExpiresAt: new Date(
          now.getTime() + this.config.AUTH_REFRESH_TOKEN_TTL_DAYS * DAY_MS,
        ),
        absoluteExpiresAt: new Date(
          now.getTime() + this.config.AUTH_SESSION_ABSOLUTE_TTL_DAYS * DAY_MS,
        ),
        clientPlatform: client?.platform ?? null,
        clientAppVersion: client?.appVersion ?? null,
        clientDeviceName: client?.deviceName ?? null,
      },
      tx,
    );
    this.metrics.increment('quest.identity.session.issued', 1, {
      platform: client?.platform ?? 'unknown',
    });
    return this.tokenPair(session, account.id, roles, refreshToken);
  }

  /**
   * Refresh-token rotation. A token from an older generation means it was already used: the whole
   * session is revoked (theft signal) and the caller gets 401. Concurrency-safe via the generation
   * compare-and-set in the repository.
   */
  async refresh(
    refreshToken: string,
  ): Promise<{ tokens: TokenPair; account: AccountRecord; roles: Role[] }> {
    const hash = hashToken(refreshToken);
    const found = await this.sessions.findSessionByRefreshHash(hash);
    const now = Date.now();
    if (!found) throw ApiError.unauthenticated('Invalid refresh token');
    const { session } = found;
    if (found.matchedPrevious) {
      // The token was already rotated out: someone is replaying it. Fail closed for everyone.
      await this.sessions.revokeSession(session.id, 'REFRESH_TOKEN_REUSE');
      await this.lifecycle.audit({
        accountId: session.accountId,
        eventType: 'REFRESH_REUSE_DETECTED',
        sessionId: session.id,
      });
      this.metrics.increment('quest.identity.refresh', 1, { result: 'reuse' });
      throw ApiError.unauthenticated('Refresh token reuse detected; session revoked');
    }
    if (
      session.revokedAt ||
      session.absoluteExpiresAt.getTime() <= now ||
      session.refreshExpiresAt.getTime() <= now
    ) {
      throw ApiError.unauthenticated('Session expired');
    }
    const account = await this.accounts.findById(session.accountId);
    if (!account || !SIGN_IN_ALLOWED_STATES.has(account.state)) {
      await this.sessions.revokeSession(session.id, 'ACCOUNT_STATE');
      throw ApiError.unauthenticated('Session expired');
    }
    const next = generateRefreshToken();
    const refreshExpiresAt = new Date(now + this.config.AUTH_REFRESH_TOKEN_TTL_DAYS * DAY_MS);
    const rotated = await this.sessions.rotateRefreshToken(
      session.id,
      session.refreshGeneration,
      hashToken(next),
      refreshExpiresAt,
    );
    if (!rotated) {
      // Lost the race with another refresh, or reuse of an already-rotated token.
      await this.sessions.revokeSession(session.id, 'REFRESH_TOKEN_REUSE');
      await this.lifecycle.audit({
        accountId: account.id,
        eventType: 'REFRESH_REUSE_DETECTED',
        sessionId: session.id,
      });
      this.metrics.increment('quest.identity.refresh', 1, { result: 'reuse' });
      throw ApiError.unauthenticated('Refresh token reuse detected; session revoked');
    }
    const roles = await this.accounts.activeRoles(account.id);
    await this.lifecycle.audit({
      accountId: account.id,
      eventType: 'TOKEN_REFRESHED',
      sessionId: session.id,
    });
    this.metrics.increment('quest.identity.refresh', 1, { result: 'ok' });
    const updated: SessionRecord = {
      ...session,
      refreshGeneration: session.refreshGeneration + 1,
      refreshExpiresAt,
    };
    return { tokens: await this.tokenPair(updated, account.id, roles, next), account, roles };
  }

  // ------------------------------------------------------------------------- revocation ----

  async revoke(
    accountId: string,
    sessionId: string,
    reason: string,
    tx?: Executor,
  ): Promise<boolean> {
    const session = await this.sessions.findSessionById(sessionId, tx);
    if (!session || session.accountId !== accountId) return false;
    const revoked = await this.sessions.revokeSession(sessionId, reason, tx);
    if (revoked) {
      await this.lifecycle.audit(
        { accountId, eventType: 'SESSION_REVOKED', sessionId, metadata: { reason } },
        tx,
      );
      this.metrics.increment('quest.identity.session.revoked', 1, { reason });
    }
    return revoked;
  }

  async revokeAll(
    accountId: string,
    reason: string,
    exceptSessionId?: string,
    tx?: Executor,
  ): Promise<number> {
    const n = await this.sessions.revokeAllSessions(accountId, reason, exceptSessionId, tx);
    await this.lifecycle.audit(
      { accountId, eventType: 'SESSIONS_REVOKED_ALL', metadata: { reason, count: n } },
      tx,
    );
    this.metrics.increment('quest.identity.session.revoked', n, { reason });
    return n;
  }

  async list(accountId: string, currentSessionId: string): Promise<SessionView[]> {
    const rows = await this.sessions.listLiveSessions(accountId);
    return rows.map((s) => ({
      sessionId: s.id,
      current: s.id === currentSessionId,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: (s.refreshExpiresAt < s.absoluteExpiresAt
        ? s.refreshExpiresAt
        : s.absoluteExpiresAt
      ).toISOString(),
      client: {
        platform: s.clientPlatform,
        appVersion: s.clientAppVersion,
        deviceName: s.clientDeviceName,
      },
    }));
  }

  // ---------------------------------------------------------------------------- devices ----

  async registerDevice(accountId: string, input: RegisterDeviceRequest): Promise<DeviceView> {
    const d = await this.sessions.upsertDevice({
      accountId,
      installationId: input.installationId,
      platform: input.platform,
      appVersion: input.appVersion,
      deviceName: input.deviceName,
      pushToken: input.pushToken,
      locale: input.locale,
      timezone: input.timezone,
    });
    await this.lifecycle.audit({
      accountId,
      eventType: 'DEVICE_REGISTERED',
      metadata: { platform: d.platform },
    });
    return toDeviceView(d);
  }

  async listDevices(accountId: string): Promise<DeviceView[]> {
    return (await this.sessions.listDevices(accountId)).map(toDeviceView);
  }

  async revokeDevice(accountId: string, deviceId: string): Promise<void> {
    const revoked = await this.sessions.revokeDevice(accountId, deviceId);
    if (!revoked) throw ApiError.notFound('Device');
    await this.lifecycle.audit({ accountId, eventType: 'DEVICE_REVOKED' });
  }

  // ---------------------------------------------------------------------------- helpers ----

  private async tokenPair(
    session: SessionRecord,
    accountId: string,
    roles: ReadonlyArray<Role>,
    refreshToken: string,
  ): Promise<TokenPair> {
    const ttl = this.config.AUTH_ACCESS_TOKEN_TTL_SECONDS;
    const accessToken = await this.signer.sign(
      {
        sub: accountId,
        sid: session.id,
        roles: ['USER', ...roles.filter((r) => r !== 'USER')],
        jti: uuidv7(),
      },
      ttl,
    );
    return {
      accessToken,
      accessTokenExpiresIn: ttl,
      refreshToken,
      refreshTokenExpiresAt: session.refreshExpiresAt.toISOString(),
      sessionId: session.id,
      tokenType: 'Bearer',
    };
  }
}

function toDeviceView(d: {
  id: string;
  installationId: string;
  platform: DeviceView['platform'];
  appVersion: string | null;
  deviceName: string | null;
  pushToken: string | null;
  createdAt: Date;
  lastSeenAt: Date;
}): DeviceView {
  return {
    deviceId: d.id,
    installationId: d.installationId,
    platform: d.platform,
    appVersion: d.appVersion,
    deviceName: d.deviceName,
    pushEnabled: d.pushToken !== null,
    createdAt: d.createdAt.toISOString(),
    lastSeenAt: d.lastSeenAt.toISOString(),
  };
}
