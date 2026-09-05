import { z } from 'zod';

/**
 * Product analytics contract (distinct from domain events: analytics describe *behaviour* for
 * measurement; domain events describe *facts* that other modules react to).
 * Full taxonomy arrives in Phase 15; the envelope and governance rules are fixed now.
 * Naming: `<surface>_<object>_<action>` in snake_case, e.g. `mobile_quest_accepted`.
 */
export const ANALYTICS_EVENT_NAME_PATTERN = /^(mobile|web|admin|api)_[a-z0-9]+(_[a-z0-9]+)+$/;

export const analyticsEventSchema = z.object({
  name: z.string().regex(ANALYTICS_EVENT_NAME_PATTERN),
  /** Schema version of this event's properties. */
  version: z.number().int().positive().default(1),
  occurredAt: z.iso.datetime(),
  /** Pseudonymous analytics id — never the account id, never email. */
  anonymousId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  /** Consent state at emission time; sinks MUST drop events without consent where required. */
  consent: z.object({ analytics: z.boolean(), personalization: z.boolean() }),
  /** Property values are primitives only: no nested PII objects, no free-text user content. */
  properties: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
  context: z
    .object({
      appVersion: z.string().optional(),
      platform: z.enum(['ios', 'android', 'web']).optional(),
      locale: z.string().optional(),
      /** Country only — never precise location in analytics. */
      countryCode: z
        .string()
        .regex(/^[A-Z]{2}$/)
        .optional(),
    })
    .default({}),
});
export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;
/** Input shape (defaults not yet applied) accepted by sinks. */
export type AnalyticsEventInput = z.input<typeof analyticsEventSchema>;

export interface AnalyticsSink {
  track(event: AnalyticsEventInput): Promise<void>;
  flush?(): Promise<void>;
}

/** Default sink until a vendor/warehouse export is chosen (Phase 15). */
export class NoopAnalyticsSink implements AnalyticsSink {
  track(_event: AnalyticsEventInput): Promise<void> {
    return Promise.resolve();
  }
}

/** Test helper that validates and buffers events; drops events lacking analytics consent. */
export class InMemoryAnalyticsSink implements AnalyticsSink {
  readonly events: AnalyticsEvent[] = [];
  readonly dropped: AnalyticsEvent[] = [];
  track(event: AnalyticsEventInput): Promise<void> {
    const parsed = analyticsEventSchema.parse(event);
    if (!parsed.consent.analytics) {
      this.dropped.push(parsed);
      return Promise.resolve();
    }
    this.events.push(parsed);
    return Promise.resolve();
  }
}
