import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AuthGuard } from '../../common/auth/auth.guard';
import { PRINCIPAL_RESOLVER } from '../../common/auth/principal';
import { APP_CONFIG, type AppConfig } from '../../config/app-config';
import { ProfilesModule } from '../profiles';
import { AdminAccountsController } from './api/admin-accounts.controller';
import { AuthController } from './api/auth.controller';
import { MeController } from './api/me.controller';
import { AccountDeletionJob } from './application/account-deletion.job';
import { AccountViewService } from './application/account-view.service';
import { AccountService } from './application/account.service';
import { AuthenticationService } from './application/authentication.service';
import { DataExportService } from './application/data-export.service';
import { RegistrationService } from './application/registration.service';
import { SessionService } from './application/session.service';
import { VerificationService } from './application/verification.service';
import { AccountRepository } from './infrastructure/account.repository';
import { Argon2PasswordHasher } from './infrastructure/argon2-password-hasher';
import {
  APPLE_OIDC,
  FakeIdentityProvider,
  GOOGLE_OIDC,
  OidcIdentityProvider,
  StaticIdentityProviderRegistry,
} from './infrastructure/identity-providers';
import { JoseTokenSigner } from './infrastructure/jose-token-signer';
import { LifecycleRepository } from './infrastructure/lifecycle.repository';
import { InMemoryMailer, LogMailer } from './infrastructure/mailers';
import { SessionRepository } from './infrastructure/session.repository';
import { IDENTITY_PROVIDERS, type IdentityProviderPort } from './ports/identity-provider.port';
import { MAILER } from './ports/mailer.port';
import { PASSWORD_HASHER } from './ports/password-hasher.port';
import { TOKEN_SIGNER } from './ports/token-signer.port';

/**
 * Identity bounded context: ACCOUNT (lifecycle, roles, consents, deletion, export) and
 * AUTHENTICATION (credentials, external identities, sessions, devices, verification codes).
 * Registers the global AuthGuard, so every controller in the API is protected by default.
 * Depends on Profiles (downstream) through its exported ports only.
 */
@Module({
  imports: [ProfilesModule],
  controllers: [AuthController, MeController, AdminAccountsController],
  providers: [
    AccountRepository,
    SessionRepository,
    LifecycleRepository,
    SessionService,
    VerificationService,
    AccountViewService,
    RegistrationService,
    AuthenticationService,
    AccountService,
    DataExportService,
    AccountDeletionJob,
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    {
      provide: TOKEN_SIGNER,
      useFactory: (config: AppConfig) => new JoseTokenSigner(config),
      inject: [APP_CONFIG],
    },
    {
      provide: MAILER,
      useFactory: (config: AppConfig, logger: Logger) =>
        config.MAIL_PROVIDER === 'memory'
          ? new InMemoryMailer()
          : new LogMailer(logger, config.AUTH_DEV_EXPOSE_CODES),
      inject: [APP_CONFIG, Logger],
    },
    {
      provide: IDENTITY_PROVIDERS,
      useFactory: (config: AppConfig) => {
        const providers: IdentityProviderPort[] = [];
        if (config.AUTH_FAKE_PROVIDER_ENABLED) providers.push(new FakeIdentityProvider());
        if (config.AUTH_APPLE_CLIENT_ID) {
          providers.push(
            new OidcIdentityProvider({
              provider: 'APPLE',
              audience: config.AUTH_APPLE_CLIENT_ID,
              ...APPLE_OIDC,
            }),
          );
        }
        if (config.AUTH_GOOGLE_CLIENT_ID) {
          providers.push(
            new OidcIdentityProvider({
              provider: 'GOOGLE',
              audience: config.AUTH_GOOGLE_CLIENT_ID,
              issuer: [...GOOGLE_OIDC.issuer],
              jwksUrl: GOOGLE_OIDC.jwksUrl,
            }),
          );
        }
        return new StaticIdentityProviderRegistry(providers);
      },
      inject: [APP_CONFIG],
    },
    { provide: PRINCIPAL_RESOLVER, useExisting: SessionService },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [PRINCIPAL_RESOLVER, AccountDeletionJob, DataExportService, MAILER],
})
export class IdentityModule {}
