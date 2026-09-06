import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type AcceptedResponse,
  type AccountView,
  type AuthResponse,
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  providerRegisterRequestSchema,
  providerSignInRequestSchema,
  refreshRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
} from '@quest/types';
import type { z } from 'zod';

import { AllowStates, CurrentPrincipal, Public } from '../../../common/auth/decorators';
import type { Principal } from '../../../common/auth/principal';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import { AuthenticationService } from '../application/authentication.service';
import { RegistrationService } from '../application/registration.service';

/**
 * Authentication endpoints. Every route here is rate limited per client IP more strictly than
 * the global default (docs/security/IDENTITY_THREAT_MODEL.md "Abuse controls"). Account-level
 * lockout and code attempt limits live in the application services.
 */
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly auth: AuthenticationService,
  ) {}

  @Post('register')
  @Public()
  @HttpCode(201)
  @Throttle({ global: { limit: 5, ttl: 60_000 } })
  register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: z.infer<typeof registerRequestSchema>,
  ): Promise<AuthResponse> {
    return this.registration.registerWithPassword(body);
  }

  @Post('login')
  @Public()
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: z.infer<typeof loginRequestSchema>,
  ): Promise<AuthResponse> {
    return this.auth.loginWithPassword(body);
  }

  @Post('provider/sign-in')
  @Public()
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  providerSignIn(
    @Body(new ZodValidationPipe(providerSignInRequestSchema))
    body: z.infer<typeof providerSignInRequestSchema>,
  ): Promise<AuthResponse> {
    return this.auth.loginWithProvider(body);
  }

  @Post('provider/register')
  @Public()
  @HttpCode(201)
  @Throttle({ global: { limit: 5, ttl: 60_000 } })
  providerRegister(
    @Body(new ZodValidationPipe(providerRegisterRequestSchema))
    body: z.infer<typeof providerRegisterRequestSchema>,
  ): Promise<AuthResponse> {
    return this.registration.registerWithProvider(body);
  }

  @Post('refresh')
  @Public()
  @HttpCode(200)
  @Throttle({ global: { limit: 30, ttl: 60_000 } })
  refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: z.infer<typeof refreshRequestSchema>,
  ): Promise<AuthResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @AllowStates('ACTIVE', 'PENDING_VERIFICATION', 'DELETION_REQUESTED')
  @HttpCode(204)
  async logout(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.auth.logout(principal);
  }

  @Post('logout-all')
  @AllowStates('ACTIVE', 'PENDING_VERIFICATION', 'DELETION_REQUESTED')
  @HttpCode(200)
  async logoutAll(@CurrentPrincipal() principal: Principal): Promise<{ revokedSessions: number }> {
    return { revokedSessions: await this.auth.logoutAll(principal) };
  }

  @Post('email/verify')
  @HttpCode(200)
  @Throttle({ global: { limit: 10, ttl: 60_000 } })
  verifyEmail(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(verifyEmailRequestSchema))
    body: z.infer<typeof verifyEmailRequestSchema>,
  ): Promise<AccountView> {
    return this.auth.verifyEmail(principal, body.code);
  }

  @Post('email/resend')
  @HttpCode(202)
  @Throttle({ global: { limit: 3, ttl: 300_000 } })
  async resend(@CurrentPrincipal() principal: Principal): Promise<AcceptedResponse> {
    await this.auth.resendVerification(principal);
    return { accepted: true };
  }

  @Post('password/change')
  @HttpCode(204)
  @Throttle({ global: { limit: 5, ttl: 60_000 } })
  async changePassword(
    @CurrentPrincipal() principal: Principal,
    @Body(new ZodValidationPipe(changePasswordRequestSchema))
    body: z.infer<typeof changePasswordRequestSchema>,
  ): Promise<void> {
    await this.auth.changePassword(principal, body);
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(202)
  @Throttle({ global: { limit: 3, ttl: 300_000 } })
  async forgot(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema))
    body: z.infer<typeof forgotPasswordRequestSchema>,
  ): Promise<AcceptedResponse> {
    await this.auth.forgotPassword(body.email);
    return { accepted: true };
  }

  @Post('password/reset')
  @Public()
  @HttpCode(204)
  @Throttle({ global: { limit: 5, ttl: 60_000 } })
  async reset(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema))
    body: z.infer<typeof resetPasswordRequestSchema>,
  ): Promise<void> {
    await this.auth.resetPassword(body);
  }
}
