import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AccountView,
  type ConsentRecord,
  type ConsentState,
  type DataExportRequestView,
  type DeletionRequestView,
  type DeviceView,
  type Paginated,
  Permission,
  type SessionView,
  recordConsentRequestSchema,
  registerDeviceRequestSchema,
  requestDeletionRequestSchema,
  uuidSchema,
} from '@quest/types';
import type { z } from 'zod';

import {
  AllowStates,
  CurrentPrincipal,
  RequirePermission,
  RequireVerifiedEmail,
} from '../../../common/auth/decorators';
import type { Principal } from '../../../common/auth/principal';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AccountService } from '../application/account.service';
import { DataExportService } from '../application/data-export.service';
import { SessionService } from '../application/session.service';

function page<T>(data: T[]): Paginated<T> {
  return { data, pageInfo: { nextCursor: null, hasMore: false } };
}

/** The signed-in account: view, sessions, devices, consents, lifecycle, export. */
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(
    private readonly accounts: AccountService,
    private readonly sessions: SessionService,
    private readonly exports: DataExportService,
  ) {}

  @Get()
  @AllowStates('ACTIVE', 'PENDING_VERIFICATION', 'DELETION_REQUESTED')
  me(@CurrentPrincipal() principal: Principal): Promise<AccountView> {
    return this.accounts.me(principal);
  }

  // ---- sessions ----

  @Get('sessions')
  @RequirePermission(Permission.MANAGE_OWN_SESSIONS)
  async listSessions(@CurrentPrincipal() principal: Principal): Promise<Paginated<SessionView>> {
    return page(await this.sessions.list(principal.accountId, principal.sessionId));
  }

  @Delete('sessions/:sessionId')
  @RequirePermission(Permission.MANAGE_OWN_SESSIONS)
  @HttpCode(204)
  async revokeSession(
    @CurrentPrincipal() principal: Principal,
    @Param('sessionId', new ZodValidationPipe(uuidSchema)) sessionId: string,
  ): Promise<void> {
    await this.sessions.revoke(principal.accountId, sessionId, 'USER_REVOKED');
  }

  // ---- devices ----

  @Get('devices')
  @RequirePermission(Permission.MANAGE_OWN_DEVICES)
  async listDevices(@CurrentPrincipal() principal: Principal): Promise<Paginated<DeviceView>> {
    return page(await this.sessions.listDevices(principal.accountId));
  }

  @Post('devices')
  @RequirePermission(Permission.MANAGE_OWN_DEVICES)
  @HttpCode(200)
  @Throttle({ global: { limit: 20, ttl: 60_000 } })
  registerDevice(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(registerDeviceRequestSchema))
    body: z.infer<typeof registerDeviceRequestSchema>,
  ): Promise<DeviceView> {
    return this.sessions.registerDevice(principal.accountId, body);
  }

  @Delete('devices/:deviceId')
  @RequirePermission(Permission.MANAGE_OWN_DEVICES)
  @HttpCode(204)
  async revokeDevice(
    @CurrentPrincipal() principal: Principal,
    @Param('deviceId', new ZodValidationPipe(uuidSchema)) deviceId: string,
  ): Promise<void> {
    await this.sessions.revokeDevice(principal.accountId, deviceId);
  }

  // ---- consents ----

  @Get('consents')
  @RequirePermission(Permission.MANAGE_OWN_ACCOUNT)
  @AllowStates('ACTIVE', 'PENDING_VERIFICATION', 'DELETION_REQUESTED')
  consentState(@CurrentPrincipal() principal: Principal): Promise<ConsentState> {
    return this.accounts.consentState(principal.accountId);
  }

  @Get('consents/history')
  @RequirePermission(Permission.MANAGE_OWN_ACCOUNT)
  @AllowStates('ACTIVE', 'PENDING_VERIFICATION', 'DELETION_REQUESTED')
  async consentHistory(
    @CurrentPrincipal() principal: Principal,
  ): Promise<Paginated<ConsentRecord>> {
    return page(await this.accounts.consentHistory(principal.accountId));
  }

  @Post('consents')
  @RequirePermission(Permission.MANAGE_OWN_ACCOUNT)
  @HttpCode(200)
  recordConsent(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(recordConsentRequestSchema))
    body: z.infer<typeof recordConsentRequestSchema>,
  ): Promise<ConsentState> {
    return this.accounts.recordConsent(principal, body);
  }

  // ---- lifecycle ----

  @Post('deactivate')
  @RequirePermission(Permission.MANAGE_OWN_ACCOUNT)
  @AllowStates('ACTIVE')
  @HttpCode(204)
  async deactivate(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.accounts.deactivate(principal);
  }

  @Post('deletion-request')
  @RequirePermission(Permission.REQUEST_OWN_DELETION)
  @HttpCode(201)
  @Throttle({ global: { limit: 3, ttl: 300_000 } })
  requestDeletion(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(requestDeletionRequestSchema))
    body: z.infer<typeof requestDeletionRequestSchema>,
  ): Promise<DeletionRequestView> {
    return this.accounts.requestDeletion(principal, body);
  }

  @Get('deletion-request')
  @RequirePermission(Permission.REQUEST_OWN_DELETION)
  @AllowStates('ACTIVE', 'PENDING_VERIFICATION', 'DELETION_REQUESTED')
  deletionStatus(@CurrentPrincipal() principal: Principal): Promise<DeletionRequestView> {
    return this.accounts.deletionStatus(principal);
  }

  @Post('deletion-request/cancel')
  @RequirePermission(Permission.REQUEST_OWN_DELETION)
  @AllowStates('DELETION_REQUESTED')
  @HttpCode(200)
  cancelDeletion(@CurrentPrincipal() principal: Principal): Promise<AccountView> {
    return this.accounts.cancelDeletion(principal);
  }

  // ---- data export ----

  @Post('data-export')
  @RequirePermission(Permission.REQUEST_OWN_DATA_EXPORT)
  @RequireVerifiedEmail()
  @HttpCode(202)
  @Throttle({ global: { limit: 3, ttl: 300_000 } })
  requestExport(@CurrentPrincipal() principal: Principal): Promise<DataExportRequestView> {
    return this.exports.request(principal);
  }

  @Get('data-export')
  @RequirePermission(Permission.REQUEST_OWN_DATA_EXPORT)
  latestExport(@CurrentPrincipal() principal: Principal): Promise<DataExportRequestView> {
    return this.exports.latest(principal);
  }

  @Get('data-export/:exportId')
  @RequirePermission(Permission.REQUEST_OWN_DATA_EXPORT)
  getExport(
    @CurrentPrincipal() principal: Principal,
    @Param('exportId', new ZodValidationPipe(uuidSchema)) exportId: string,
  ): Promise<DataExportRequestView> {
    return this.exports.get(principal, exportId);
  }
}
