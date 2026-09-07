import type { Logger } from 'nestjs-pino';

import type { MailMessage, MailerPort } from '../ports/mailer.port';

function redactAddress(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${domain}`;
}

/**
 * Development/staging adapter until a delivery provider is wired: logs a redacted delivery line.
 * One-time codes are included only when AUTH_DEV_EXPOSE_CODES=true (refused in production).
 */
export class LogMailer implements MailerPort {
  constructor(
    private readonly logger: Logger,
    private readonly exposeCodes: boolean,
  ) {}

  send(message: MailMessage): Promise<void> {
    const { template } = message;
    const code = this.exposeCodes && 'code' in template ? { code: template.code } : {};
    this.logger.log(
      {
        mail: {
          to: redactAddress(message.to),
          template: template.name,
          language: message.language,
          ...code,
        },
      },
      'mail delivery (log adapter)',
    );
    return Promise.resolve();
  }
}

/** Test adapter: keeps an outbox so suites can read one-time codes without a mail server. */
export class InMemoryMailer implements MailerPort {
  readonly outbox: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    return Promise.resolve();
  }

  lastFor(email: string, template?: MailMessage['template']['name']): MailMessage | undefined {
    return [...this.outbox]
      .reverse()
      .find((m) => m.to === email.toLowerCase() && (!template || m.template.name === template));
  }

  clear(): void {
    this.outbox.length = 0;
  }
}
