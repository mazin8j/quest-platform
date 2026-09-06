import { Inject, Injectable } from '@nestjs/common';

import { ApiError } from '../../../common/filters/api-error';
import { METRICS, type MetricsPort } from '../../../common/observability/metrics.port';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import type { Executor } from '../../../infrastructure/database/executor';
import {
  constantTimeEquals,
  generateVerificationCode,
  hashVerificationCode,
} from '../domain/secrets';
import {
  LifecycleRepository,
  type VerificationPurpose,
} from '../infrastructure/lifecycle.repository';
import { MAILER, type MailerPort } from '../ports/mailer.port';

/**
 * One-time codes for email verification and password reset: hashed at rest, short TTL, bounded
 * attempts, resend cooldown. The same generic failure is returned for wrong, expired and
 * exhausted codes so an attacker learns nothing about which applies.
 */
@Injectable()
export class VerificationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(METRICS) private readonly metrics: MetricsPort,
    private readonly lifecycle: LifecycleRepository,
  ) {}

  /** Issues (or re-issues) a code and emails it. Throws RATE_LIMITED-like CONFLICT inside the cooldown. */
  async issue(
    input: { accountId: string; email: string; language: string; purpose: VerificationPurpose },
    options: { enforceCooldown: boolean },
    tx?: Executor,
  ): Promise<void> {
    if (options.enforceCooldown) {
      const latest = await this.lifecycle.latestLiveCode(input.accountId, input.purpose, tx);
      if (latest) {
        const ageMs = Date.now() - latest.createdAt.getTime();
        if (ageMs < this.config.AUTH_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000) {
          throw ApiError.conflict(
            'A code was sent recently; please wait before requesting another',
          );
        }
      }
    }
    const code = generateVerificationCode();
    const ttlMinutes = this.config.AUTH_VERIFICATION_CODE_TTL_MINUTES;
    await this.lifecycle.issueCode(
      {
        accountId: input.accountId,
        purpose: input.purpose,
        codeHash: hashVerificationCode(input.accountId, code),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
      tx,
    );
    await this.mailer.send({
      to: input.email,
      language: input.language,
      template:
        input.purpose === 'VERIFY_EMAIL'
          ? { name: 'VERIFY_EMAIL', code, expiresInMinutes: ttlMinutes }
          : { name: 'RESET_PASSWORD', code, expiresInMinutes: ttlMinutes },
    });
    this.metrics.increment('quest.identity.code.issued', 1, { purpose: input.purpose });
  }

  /** Verifies and consumes a code. Returns true on success; false (after counting the attempt) otherwise. */
  async verify(
    accountId: string,
    purpose: VerificationPurpose,
    code: string,
    tx?: Executor,
  ): Promise<boolean> {
    const live = await this.lifecycle.latestLiveCode(accountId, purpose, tx);
    if (!live) {
      this.metrics.increment('quest.identity.code.verify', 1, { purpose, result: 'none' });
      return false;
    }
    if (live.expiresAt.getTime() <= Date.now()) {
      await this.lifecycle.consumeCode(live.id, tx);
      this.metrics.increment('quest.identity.code.verify', 1, { purpose, result: 'expired' });
      return false;
    }
    const attempts = await this.lifecycle.incrementCodeAttempts(live.id, tx);
    if (attempts > this.config.AUTH_VERIFICATION_MAX_ATTEMPTS) {
      await this.lifecycle.consumeCode(live.id, tx);
      this.metrics.increment('quest.identity.code.verify', 1, { purpose, result: 'exhausted' });
      return false;
    }
    const ok = constantTimeEquals(live.codeHash, hashVerificationCode(accountId, code));
    if (!ok) {
      this.metrics.increment('quest.identity.code.verify', 1, { purpose, result: 'mismatch' });
      return false;
    }
    await this.lifecycle.consumeCode(live.id, tx);
    this.metrics.increment('quest.identity.code.verify', 1, { purpose, result: 'ok' });
    return true;
  }
}
