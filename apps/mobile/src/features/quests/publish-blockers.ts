/**
 * Turns the machine-readable publish blockers the API returns into something an owner can act on.
 *
 * The server is the authority — this file never decides whether a Quest may be published, it only
 * explains a refusal. Unknown codes get a safe, non-technical fallback rather than being hidden,
 * because silently dropping a blocker would show a "ready to publish" screen that is not true.
 */
const COPY: Readonly<Record<string, string>> = {
  NO_SAFETY_ASSESSMENT: 'Ask for a safety check before publishing.',
  SAFETY_ASSESSMENT_STALE: 'You changed the Quest since its safety check. Run the check again.',
  SAFETY_ASSESSMENT_EXPIRED: 'The safety check has expired. Run it again.',
  SAFETY_UNASSESSED: 'This Quest has not been checked yet.',
  SAFETY_REVIEW_REQUIRED: 'A moderator needs to review this Quest before it can be published.',
  SAFETY_REJECTED: 'This Quest cannot be published as written. Edit it and check again.',
  SAFETY_ESCALATED: 'This Quest cannot be published. Our safety team has been notified.',
  SAFETY_RESTRICTED: 'This Quest can only be published with an age restriction.',
  CONTENT_HASH_MISMATCH: 'This Quest changed somewhere else. Reload it and try again.',
  OWNER_EMAIL_NOT_VERIFIED: 'Verify your email address before publishing a Quest.',
  OWNER_NOT_ACTIVE: 'Your account cannot publish Quests right now.',
  NOT_OWNER: 'Only the owner can publish this Quest.',
};

const INVALID_STATE: Readonly<Record<string, string>> = {
  IN_REVIEW: 'This Quest is waiting for a moderator. Edit it to take it back to draft.',
  PUBLISHED: 'This Quest is already published.',
  ARCHIVED: 'Archived Quests cannot be published.',
  SUSPENDED: 'This Quest was withdrawn by our safety team.',
  ERASED: 'This Quest no longer exists.',
};

export function describePublishBlocker(code: string): string {
  const known = COPY[code];
  if (known) return known;
  if (code.startsWith('INVALID_STATE_')) {
    return (
      INVALID_STATE[code.slice('INVALID_STATE_'.length)] ?? 'This Quest cannot be published yet.'
    );
  }
  return 'This Quest cannot be published yet.';
}

export function describePublishBlockers(codes: readonly string[] | null): string[] {
  if (!codes) return [];
  // De-duplicated because two codes can map to the same sentence (e.g. two safety reasons).
  return [...new Set(codes.map(describePublishBlocker))];
}

/** The one-line summary shown on a Quest card. */
export function publishSummary(codes: readonly string[] | null): string {
  if (!codes) return '';
  if (codes.length === 0) return 'Ready to publish';
  return describePublishBlocker(codes[0] as string);
}

const ELIGIBILITY: Readonly<Record<string, string>> = {
  AUTHENTICATION_REQUIRED: 'Sign in to accept this Quest.',
  BLOCKED: 'This Quest is not available to you.',
  OWNER_CANNOT_PARTICIPATE: 'You cannot accept your own Quest.',
  QUEST_NOT_PUBLISHED: 'This Quest is not open right now.',
  OUTSIDE_AVAILABILITY_WINDOW: 'This Quest is not open right now.',
  EMAIL_NOT_VERIFIED: 'Verify your email address to accept Quests.',
  AGE_RESTRICTED: 'This Quest is not available for your age group.',
  COUNTRY_BLOCKED: 'This Quest is not available in your country.',
  COUNTRY_NOT_ALLOWED: 'This Quest is not available in your country.',
};

/** Explains why acceptance was refused. Never reveals another person's data. */
export function describeEligibilityReason(code: string): string {
  return ELIGIBILITY[code] ?? 'You cannot accept this Quest right now.';
}
