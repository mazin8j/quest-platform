import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  type AccountSupportView,
  Permission,
  grantRoleRequestSchema,
  revokeRoleRequestSchema,
  suspendAccountRequestSchema,
  uuidSchema,
} from '@quest/types';
import type { z } from 'zod';

import { CurrentPrincipal, RequirePermission } from '../../../common/auth/decorators';
import type { Principal } from '../../../common/auth/principal';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AccountService } from '../application/account.service';

/**
 * Staff endpoints (admin console). Support fields only — never the DOB, credentials or tokens.
 * Every action is attributed to the staff principal in the audit ledger.
 */
@Controller({ path: 'admin/accounts', version: '1' })
export class AdminAccountsController {
  constructor(private readonly accounts: AccountService) {}

  @Get(':accountId')
  @RequirePermission(Permission.VIEW_USER_SUPPORT_PROFILE)
  support(
    @Param('accountId', new ZodValidationPipe(uuidSchema)) accountId: string,
  ): Promise<AccountSupportView> {
    return this.accounts.supportView(accountId);
  }

  @Post(':accountId/suspend')
  @RequirePermission(Permission.SANCTION_USER)
  @HttpCode(200)
  suspend(
    @CurrentPrincipal() staff: Principal,
    @Param('accountId', new ZodValidationPipe(uuidSchema)) accountId: string,
    @Body(new ZodValidationPipe(suspendAccountRequestSchema))
    body: z.infer<typeof suspendAccountRequestSchema>,
  ): Promise<AccountSupportView> {
    return this.accounts.suspend(staff, accountId, body.reason);
  }

  @Post(':accountId/reinstate')
  @RequirePermission(Permission.SANCTION_USER)
  @HttpCode(200)
  reinstate(
    @CurrentPrincipal() staff: Principal,
    @Param('accountId', new ZodValidationPipe(uuidSchema)) accountId: string,
  ): Promise<AccountSupportView> {
    return this.accounts.reinstate(staff, accountId);
  }

  @Post(':accountId/roles')
  @RequirePermission(Permission.MANAGE_STAFF)
  @HttpCode(200)
  grantRole(
    @CurrentPrincipal() staff: Principal,
    @Param('accountId', new ZodValidationPipe(uuidSchema)) accountId: string,
    @Body(new ZodValidationPipe(grantRoleRequestSchema))
    body: z.infer<typeof grantRoleRequestSchema>,
  ): Promise<AccountSupportView> {
    return this.accounts.grantRole(staff, accountId, body.role);
  }

  @Post(':accountId/roles/revoke')
  @RequirePermission(Permission.MANAGE_STAFF)
  @HttpCode(200)
  revokeRole(
    @CurrentPrincipal() staff: Principal,
    @Param('accountId', new ZodValidationPipe(uuidSchema)) accountId: string,
    @Body(new ZodValidationPipe(revokeRoleRequestSchema))
    body: z.infer<typeof revokeRoleRequestSchema>,
  ): Promise<AccountSupportView> {
    return this.accounts.revokeRole(staff, accountId, body.role);
  }
}
