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
  /**
   * Holds `VIEW_QUEST_SUPPORT` — not merely "has a staff role". An ANALYST or READ_ONLY account
   * is staff but has no business reading an unpublished Quest, so the support view is gated on
   * the permission the RBAC matrix actually grants (audit P02-05).
   */
  canViewSupport: boolean;
  /** True when either side blocked the other (BlockQueryPort). */
  blocked: boolean;
}

/**
 * Whether the Quest's OWNER may currently have public content, as the Identity context judges it
 * (`OwnerEligibilityPort`). Quest Core never interprets a lifecycle state itself.
 *
 * `false` is the safe default and the value every caller must use when the answer could not be
 * established — a lookup that failed is not permission (audit P02-41 / TD-48, ADR-014).
 */
export type OwnerEligible = boolean;

/**
 * The two facts about a Quest that live outside the row and outside this function, both of which
 * can conceal it. Grouped rather than passed as a pair of positional booleans, because "the third
 * and fourth arguments are both `true`" is exactly the call site nobody reads carefully.
 */
export interface AccessGates {
  /** From `OwnerEligibilityPort`; `false` whenever it could not be established. */
  ownerEligible: OwnerEligible;
  /**
   * Whether the safety decision **in force** for the Quest's published content permits publication
   * (`publishedDecisionPublishable`). `null` means the Quest is not published, so the question does
   * not arise — `false` means it is published and something has ruled against that content, which
   * must conceal it (final delta audit P1-3).
   */
  safetyPublishable: boolean | null;
}

export const QuestAccess = {
  /** Full access: the owner, or support staff. */
  OWNER: 'OWNER',
  /** May read the published Quest and (subject to eligibility) accept it. */
  VIEWER: 'VIEWER',
  /** Must not learn that the Quest exists — the caller gets 404, never 403. */
  HIDDEN: 'HIDDEN',
} as const;
export type QuestAccess = (typeof QuestAccess)[keyof typeof QuestAccess];

/**
 * The age band a Quest was published with, which is the only band that governs anything. The
 * `eligibility` column is editable draft content and may already say something looser.
 */
export function publishedAgeBand(quest: QuestRecord): QuestAgeBand | null {
  return (quest.publishedMinimumAgeBand as QuestAgeBand | null) ?? null;
}

/**
 * True when the published band is stricter than the platform minimum, i.e. the Quest is genuinely
 * age-gated rather than simply carrying the default band every Quest has.
 */
function isAgeGated(band: QuestAgeBand | null): boolean {
  return band !== null && band !== 'TEEN_13_15';
}

/**
 * Read access.
 *
 * Anything other than OWNER/VIEWER must surface as NOT FOUND: a 403 would confirm that a private
 * or suspended Quest exists, and a blocked user must not be able to probe.
 *
 * Age restriction hides rather than merely blocking acceptance (audit P02-07). A Trust & Safety
 * decision that a Quest is adults-only has to keep the *instructions* away from a 14-year-old, not
 * just grey out a button — the instructions are the dangerous part.
 */
export function questAccessFor(
  quest: QuestRecord,
  viewer: ViewerContext,
  gates: AccessGates,
): QuestAccess {
  if (viewer.accountId && viewer.accountId === quest.ownerAccountId) return QuestAccess.OWNER;
  if (viewer.canViewSupport) return QuestAccess.OWNER;
  if (viewer.blocked) return QuestAccess.HIDDEN;
  if (quest.state !== QuestState.PUBLISHED) return QuestAccess.HIDDEN;
  // The owner's account lifecycle governs their published content: a suspended, deactivated or
  // departing author's Quests stop being public with them. Checked after owner/support so that
  // neither the author nor a moderator loses sight of the Quest, and before everything else so an
  // ineligible owner's Quest is concealed for the same reason an unpublished one is (P02-41).
  if (!gates.ownerEligible) return QuestAccess.HIDDEN;
  // The safety decision in force for the PUBLISHED content, independently of whatever took the
  // Quest down (or failed to). A rejection recorded by a moderator or a future AI decider used to
  // be displayed as a badge and otherwise ignored: the Quest stayed PUBLISHED, listed and
  // acceptable, and the API told the viewer the content was REJECTED while handing it to them
  // (final delta audit P1-3). Read-side enforcement means no writer can leave dangerous content
  // public by failing to call the right service method.
  if (gates.safetyPublishable === false) return QuestAccess.HIDDEN;
  if (quest.visibility === 'PRIVATE') return QuestAccess.HIDDEN;
  const band = publishedAgeBand(quest);
  if (band !== null && isAgeGated(band)) {
    if (!viewer.ageBand || !ageBandSatisfies(viewer.ageBand, band)) return QuestAccess.HIDDEN;
  }
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

/** Age bands a viewer may be shown, given their own band. Used to filter the discovery query. */
export function visibleAgeBandsFor(viewerBand: QuestAgeBand | null): QuestAgeBand[] {
  const all: QuestAgeBand[] = ['TEEN_13_15', 'TEEN_16_17', 'ADULT'];
  if (!viewerBand) return ['TEEN_13_15'];
  return all.filter((band) => ageBandSatisfies(viewerBand, band));
}

export interface AcceptEligibility {
  eligible: boolean;
  /** Machine-readable reasons, safe to show the viewer. */
  reasons: string[];
  /**
   * True when the refusal must be reported as NOT FOUND rather than FORBIDDEN: telling a caller
   * "not eligible: QUEST_NOT_PUBLISHED" for someone else's draft confirms that the draft exists
   * (audit P02-06). Only refusals about a Quest the caller may legitimately see are explained.
   */
  hidden: boolean;
}

/**
 * Acceptance eligibility.
 *
 * Read access is a precondition, not a parallel check: `questAccessFor` decides whether the caller
 * may know the Quest exists, and only then do the participation-specific rules run. Without that
 * ordering a PRIVATE or age-gated Quest that a caller cannot read could still be accepted by id
 * (audit P02-01).
 */
export function evaluateAcceptEligibility(input: {
  quest: QuestRecord;
  /** Owner-declared eligibility folded with the published assessment's restrictions. */
  eligibility: QuestEligibility;
  publishedMinimumAgeBand: QuestAgeBand;
  viewer: ViewerContext;
  /** Both external concealment inputs; see `AccessGates`. */
  gates: AccessGates;
  now: Date;
}): AcceptEligibility {
  const { quest, viewer } = input;

  // Anything the viewer may not even see is refused as "not found", with no reasons attached.
  const access = questAccessFor(quest, viewer, input.gates);
  if (access === QuestAccess.HIDDEN)
    return { eligible: false, reasons: ['NOT_FOUND'], hidden: true };
  // Support staff read Quests; they take part as ordinary members or not at all, and a support
  // permission must never become a way past a participation rule.
  const staffOnly = access === QuestAccess.OWNER && viewer.accountId !== quest.ownerAccountId;

  const reasons: string[] = [];
  if (!viewer.accountId) reasons.push('AUTHENTICATION_REQUIRED');
  if (viewer.blocked) reasons.push('BLOCKED');
  if (viewer.accountId === quest.ownerAccountId) reasons.push('OWNER_CANNOT_PARTICIPATE');
  if (quest.state !== QuestState.PUBLISHED) reasons.push('QUEST_NOT_PUBLISHED');
  if (quest.visibility === 'PRIVATE') reasons.push('QUEST_NOT_OPEN');
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
  // A country restriction the viewer cannot be checked against fails closed rather than open.
  if (blockedCountries.length > 0 && !country) reasons.push('COUNTRY_UNKNOWN');

  return {
    eligible: reasons.length === 0,
    reasons,
    // Staff reading someone else's Quest get the same "not found" as anyone else when they try to
    // act on it in a state that is not open to them.
    hidden: staffOnly && reasons.length > 0 && quest.state !== QuestState.PUBLISHED,
  };
}

/** Visibility values a Quest may be published with (all of them; PRIVATE simply hides it). */
export const PUBLISHABLE_VISIBILITIES: ReadonlySet<QuestVisibility> = new Set([
  'PUBLIC',
  'UNLISTED',
  'PRIVATE',
]);
