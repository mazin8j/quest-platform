import {
  type QuestAgeBand,
  type QuestEligibility,
  type QuestVisibility,
  QuestState,
  ageBandSatisfies,
} from '@quest/types';

import type { QuestRecord } from './quest';

/**
 * Who may see and accept a Quest. Every input is server-derived: the age band and account state
 * come from the authenticated Principal (Identity), the block relation from the Profiles port.
 * Nothing here trusts the client.
 */

export interface ViewerContext {
  accountId: string | null;
  /** From the Principal; `null` for anonymous callers. */
  ageBand: QuestAgeBand | null;
  emailVerified: boolean;
  /** ISO 3166-1 alpha-2 of the viewer's profile country, when known. */
  countryCode: string | null;
  isStaff: boolean;
  /** True when either side blocked the other (BlockQueryPort). */
  blocked: boolean;
}

export const QuestAccess = {
  /** Full access: the owner, or staff. */
  OWNER: 'OWNER',
  /** May read the published Quest and (subject to eligibility) accept it. */
  VIEWER: 'VIEWER',
  /** Must not learn that the Quest exists — the caller gets 404, never 403. */
  HIDDEN: 'HIDDEN',
} as const;
export type QuestAccess = (typeof QuestAccess)[keyof typeof QuestAccess];

/**
 * Read access. Anything other than OWNER/VIEWER must surface as NOT FOUND: a 403 would confirm
 * that a private or suspended Quest exists, and a blocked user must not be able to probe.
 */
export function questAccessFor(quest: QuestRecord, viewer: ViewerContext): QuestAccess {
  if (viewer.accountId && viewer.accountId === quest.ownerAccountId) return QuestAccess.OWNER;
  if (viewer.isStaff) return QuestAccess.OWNER;
  if (viewer.blocked) return QuestAccess.HIDDEN;
  if (quest.state !== QuestState.PUBLISHED) return QuestAccess.HIDDEN;
  if (quest.visibility === 'PRIVATE') return QuestAccess.HIDDEN;
  return QuestAccess.VIEWER;
}

/** Quests that appear in the non-ranked discovery list (PUBLIC visibility only). */
export function isDiscoverable(quest: QuestRecord, now: Date): boolean {
  return (
    quest.state === QuestState.PUBLISHED &&
    quest.visibility === 'PUBLIC' &&
    withinAvailability(quest, now)
  );
}

export function withinAvailability(quest: QuestRecord, now: Date): boolean {
  if (quest.availableFrom && quest.availableFrom.getTime() > now.getTime()) return false;
  if (quest.availableUntil && quest.availableUntil.getTime() <= now.getTime()) return false;
  return true;
}

export interface AcceptEligibility {
  eligible: boolean;
  /** Machine-readable reasons, safe to show the viewer. */
  reasons: string[];
}

/**
 * Acceptance eligibility. Separate from read access on purpose: a 16-year-old may see that an
 * adults-only Quest exists on their own profile page of a friend, but may never accept it.
 */
export function evaluateAcceptEligibility(input: {
  quest: QuestRecord;
  eligibility: QuestEligibility;
  publishedMinimumAgeBand: QuestAgeBand;
  viewer: ViewerContext;
  now: Date;
}): AcceptEligibility {
  const reasons: string[] = [];
  const { quest, viewer } = input;

  if (!viewer.accountId) reasons.push('AUTHENTICATION_REQUIRED');
  if (viewer.blocked) reasons.push('BLOCKED');
  if (viewer.accountId === quest.ownerAccountId) reasons.push('OWNER_CANNOT_PARTICIPATE');
  if (quest.state !== QuestState.PUBLISHED) reasons.push('QUEST_NOT_PUBLISHED');
  if (!withinAvailability(quest, input.now)) reasons.push('OUTSIDE_AVAILABILITY_WINDOW');
  if (input.eligibility.requiresVerifiedEmail && !viewer.emailVerified) {
    reasons.push('EMAIL_NOT_VERIFIED');
  }
  if (!viewer.ageBand || !ageBandSatisfies(viewer.ageBand, input.publishedMinimumAgeBand)) {
    reasons.push('AGE_RESTRICTED');
  }
  const country = viewer.countryCode;
  const { allowedCountries, blockedCountries } = input.eligibility;
  if (blockedCountries.length > 0 && country && blockedCountries.includes(country)) {
    reasons.push('COUNTRY_BLOCKED');
  }
  if (allowedCountries.length > 0 && (!country || !allowedCountries.includes(country))) {
    reasons.push('COUNTRY_NOT_ALLOWED');
  }
  return { eligible: reasons.length === 0, reasons };
}

/** Visibility values a Quest may be published with (all of them; PRIVATE simply hides it). */
export const PUBLISHABLE_VISIBILITIES: ReadonlySet<QuestVisibility> = new Set([
  'PUBLIC',
  'UNLISTED',
  'PRIVATE',
]);
