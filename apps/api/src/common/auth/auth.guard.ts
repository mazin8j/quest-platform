import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type AccountState, type Permission, hasPermission } from '@quest/types';
import type { Request } from 'express';

import { getRequestContext } from '../context/request-context';
import { ApiError } from '../filters/api-error';
import {
  ALLOWED_STATES_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRE_VERIFIED_EMAIL_KEY,
} from './decorators';
import {
  PRINCIPAL_RESOLVER,
  type Principal,
  type PrincipalResolver,
  REQUEST_PRINCIPAL_KEY,
} from './principal';

const DEFAULT_ALLOWED_STATES: ReadonlyArray<AccountState> = ['ACTIVE', 'PENDING_VERIFICATION'];

/**
 * Single guard for authentication, lifecycle state and permissions (default deny):
 *  1. @Public routes pass without a token (a valid token is still resolved when present).
 *  2. Otherwise a valid bearer token with a live session is required → 401 UNAUTHENTICATED.
 *  3. The account state must be allowed for the route → 403 FORBIDDEN (never reveals more).
 *  4. @RequireVerifiedEmail → 403 when the email is unverified.
 *  5. @RequirePermission → every permission must be granted by the principal's roles → 403.
 * Registered as APP_GUARD by the Identity module, so every controller is covered.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PRINCIPAL_RESOLVER) private readonly resolver: PrincipalResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) ?? false;
    const req = context.switchToHttp().getRequest<Request>();

    const token = extractBearer(req.header('authorization'));
    const principal = token ? await this.resolver.resolve(token) : null;
    if (principal) attachPrincipal(req, principal);

    if (isPublic) return true;
    if (!principal) throw ApiError.unauthenticated();

    const allowedStates =
      this.reflector.getAllAndOverride<AccountState[]>(ALLOWED_STATES_KEY, targets) ??
      DEFAULT_ALLOWED_STATES;
    if (!allowedStates.includes(principal.state)) {
      throw ApiError.forbidden('Account state does not permit this action');
    }

    const requireVerified =
      this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED_EMAIL_KEY, targets) ?? false;
    if (requireVerified && !principal.emailVerified) {
      throw ApiError.forbidden('Email verification required');
    }

    const required =
      this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS_KEY, targets) ?? [];
    for (const permission of required) {
      if (!hasPermission(principal.roles, permission)) throw ApiError.forbidden();
    }
    return true;
  }
}

export function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{16,4096})$/i.exec(header.trim());
  return match?.[1];
}

function attachPrincipal(req: Request, principal: Principal): void {
  (req as Request & { [REQUEST_PRINCIPAL_KEY]?: Principal })[REQUEST_PRINCIPAL_KEY] = principal;
  const ctx = getRequestContext();
  if (ctx) ctx.actorId = principal.accountId;
}
