/**
 * Transactional mail port. Templates are identified by name so the delivery adapter (SES, a
 * vendor, or the local logger) owns rendering; the Identity context never builds HTML.
 */
export type MailTemplate =
  | { name: 'VERIFY_EMAIL'; code: string; expiresInMinutes: number }
  | { name: 'RESET_PASSWORD'; code: string; expiresInMinutes: number }
  | { name: 'PASSWORD_CHANGED' }
  | { name: 'DELETION_REQUESTED'; scheduledFor: string }
  | { name: 'DATA_EXPORT_READY' };

export interface MailMessage {
  to: string;
  template: MailTemplate;
  /** BCP-47 language for the template. */
  language: string;
}

export interface MailerPort {
  send(message: MailMessage): Promise<void>;
}
export const MAILER = Symbol('MAILER');
