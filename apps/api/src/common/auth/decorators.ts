import { type ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { AccountState, Permission } from '@quest/types';
import type { Request } from 'express';

import { type Principal, REQUEST_PRINCIPAL_KEY } from './principal';

export const IS_PUBLIC_KEY = 'quest:auth:public';
export const REQUIRED_PERMISSIONS_KEY = 'quest:auth:permissions';
export const ALLOWED_STATES_KEY = 'quest:auth:allowedStates';
export const REQUIRE_VERIFIED_EMAIL_KEY = 'quest:auth:requireVerifiedEmail';

/** Route needs no authentication (registration, sign-in, public profiles, catalogue). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Route requires ALL listed permissions (default-deny: a route without this is still authenticated). */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Lifecycle states in which the route may be used. Default for authenticated routes:
 * ACTIVE and PENDING_VERIFICATION. Routes that must work during the deletion grace period (view
 * account, cancel deletion, sign out) add DELETION_REQUESTED explicitly.
 */
export const AllowStates = (...states: AccountState[]) => SetMetadata(ALLOWED_STATES_KEY, states);

/** Route requires a verified email (onboarding completion, profile publication, exports). */
export const RequireVerifiedEmail = () => SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true);

export function principalFromRequest(req: Request): Principal | undefined {
  return (req as Request & { [REQUEST_PRINCIPAL_KEY]?: Principal })[REQUEST_PRINCIPAL_KEY];
}

/** Injects the authenticated Principal into a handler parameter. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Principal => {
    const principal = principalFromRequest(ctx.switchToHttp().getRequest<Request>());
    if (!principal) {
      // Programming error: the route forgot the guard chain. Fail closed.
      throw new Error('No principal on request — is the route guarded?');
    }
    return principal;
  },
);
