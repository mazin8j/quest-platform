import { SafetyRiskCategory } from '@quest/types';

/**
 * Phase 02 rule lexicon: deterministic patterns per risk category with a severity tier.
 *
 * This is intentionally simple and conservative. It is not a content classifier — Phase 06 adds
 * one behind the AI Gateway — it is the floor that guarantees a Quest cannot be published without
 * *some* policy decision, and that the obviously dangerous cases never reach `ALLOWED`. False
 * positives cost an owner a human review; false negatives cost a participant their safety, so
 * every ambiguous case is written to route upward.
 *
 * Maintenance rules: patterns are word-boundary regexes over normalised (lower-cased) text; add
 * categories rather than loosening tiers; never add a pattern that matches ordinary language.
 */

export const SafetyTier = {
  /** Not publishable at all; the decision is REJECTED (or ESCALATED for imminent harm). */
  PROHIBITED: 'PROHIBITED',
  /** A human must look at it: REVIEW_REQUIRED. */
  REVIEW: 'REVIEW',
  /** Publishable for adults with a warning: RESTRICTED (18+) plus warning copy. */
  ADULT_ONLY: 'ADULT_ONLY',
  /** Publishable with a displayed caution: ALLOWED_WITH_WARNING. */
  CAUTION: 'CAUTION',
} as const;
export type SafetyTier = (typeof SafetyTier)[keyof typeof SafetyTier];

export interface LexiconRule {
  category: SafetyRiskCategory;
  tier: SafetyTier;
  /** Matched against normalised text (lower case, collapsed whitespace). */
  pattern: RegExp;
  /** Short, non-PII rationale for the moderator queue. */
  rationale: string;
  /** Signal strength recorded on the assessment (0..1). */
  score: number;
}

const C = SafetyRiskCategory;

export const SAFETY_LEXICON: ReadonlyArray<LexiconRule> = [
  // ---- imminent harm: never publishable, escalate ----
  {
    category: C.SELF_HARM,
    tier: SafetyTier.PROHIBITED,
    pattern: /\b(self[-\s]?harm|cut yourself|kill yourself|suicide|starve yourself|purge after)\b/,
    rationale: 'Self-harm instruction or encouragement',
    score: 1,
  },
  {
    category: C.VIOLENCE,
    tier: SafetyTier.PROHIBITED,
    pattern: /\b(punch|beat up|attack|assault|fight) (someone|a stranger|somebody|people)\b/,
    rationale: 'Violence against a person',
    score: 1,
  },
  {
    category: C.WEAPONS,
    tier: SafetyTier.PROHIBITED,
    pattern: /\b(gun|firearm|knife attack|explosive|bomb|molotov|ammunition)\b/,
    rationale: 'Weapons involvement',
    score: 0.9,
  },
  {
    category: C.SEXUAL_CONTENT,
    tier: SafetyTier.PROHIBITED,
    pattern: /\b(nude|naked|strip|sexual|porn|sext)\b/,
    rationale: 'Sexual content in a participation challenge',
    score: 0.9,
  },
  {
    category: C.MINORS,
    tier: SafetyTier.PROHIBITED,
    pattern:
      /\b(child|children|kids|minors?|schoolgirl|schoolboy)\b.{0,40}\b(alone|meet|photo|video)\b/,
    rationale: 'Challenge involving minors in an unsafe framing',
    score: 1,
  },

  // ---- serious risk: human review ----
  {
    category: C.DANGEROUS_DRIVING,
    tier: SafetyTier.REVIEW,
    pattern: /\b(speeding|street race|drift|drive blindfold|hands off the wheel|overtake)\b/,
    rationale: 'Driving-related risk',
    score: 0.8,
  },
  {
    category: C.ILLEGAL_BEHAVIOR,
    tier: SafetyTier.REVIEW,
    pattern: /\b(steal|shoplift|graffiti|vandal|hack into|break into|bribe)\b/,
    rationale: 'Possible illegal act',
    score: 0.8,
  },
  {
    category: C.TRESPASSING,
    tier: SafetyTier.REVIEW,
    pattern:
      /\b(trespass|abandoned building|restricted area|climb the fence|rooftop|construction site)\b/,
    rationale: 'Access to restricted or unsafe places',
    score: 0.8,
  },
  {
    category: C.DANGEROUS_PHYSICAL_ACTIVITY,
    tier: SafetyTier.REVIEW,
    pattern: /\b(free ?climb|cliff|parkour|jump from|hold your breath|fast for \d+|no water for)\b/,
    rationale: 'Physically dangerous activity',
    score: 0.8,
  },
  {
    category: C.DANGEROUS_LOCATION,
    tier: SafetyTier.REVIEW,
    pattern:
      /\b(train tracks?|railway|highway|motorway|quarry|flood|storm|electrical substation)\b/,
    rationale: 'Dangerous location',
    score: 0.8,
  },
  {
    category: C.HUMILIATION_OR_COERCION,
    tier: SafetyTier.REVIEW,
    pattern:
      /\b(humiliate|embarrass (someone|a stranger)|prank (someone|a stranger)|dare them to)\b/,
    rationale: 'Humiliation or coercion of another person',
    score: 0.8,
  },
  {
    category: C.HARASSMENT,
    tier: SafetyTier.REVIEW,
    pattern: /\b(follow (someone|a stranger)|confront (someone|a stranger)|shout at)\b/,
    rationale: 'Harassment risk',
    score: 0.8,
  },
  {
    category: C.BULLYING,
    tier: SafetyTier.REVIEW,
    pattern: /\b(bully|mock (someone|a stranger)|make fun of (someone|a stranger))\b/,
    rationale: 'Bullying risk',
    score: 0.8,
  },
  {
    category: C.PRIVACY_INVASION,
    tier: SafetyTier.REVIEW,
    pattern:
      /\b(film (someone|strangers) without|record (someone|strangers) without|home address|doxx)\b/,
    rationale: 'Filming or exposing people without consent',
    score: 0.8,
  },
  {
    category: C.DRUGS,
    tier: SafetyTier.REVIEW,
    pattern: /\b(cocaine|weed|cannabis|mdma|pills|get high)\b/,
    rationale: 'Drug involvement',
    score: 0.8,
  },

  // ---- adults only ----
  {
    category: C.ALCOHOL,
    tier: SafetyTier.ADULT_ONLY,
    pattern: /\b(beer|wine|whisky|whiskey|cocktail|brewery|pub crawl|alcohol)\b/,
    rationale: 'Alcohol context — adults only',
    score: 0.5,
  },

  // ---- caution ----
  {
    category: C.DANGEROUS_PHYSICAL_ACTIVITY,
    tier: SafetyTier.CAUTION,
    pattern: /\b(hike|swim|run \d+ ?km|cycle|ski|skate|cold water|marathon)\b/,
    rationale: 'Physical activity — participants should judge their own fitness',
    score: 0.3,
  },
  {
    category: C.DANGEROUS_LOCATION,
    tier: SafetyTier.CAUTION,
    pattern: /\b(at night|after dark|alone in)\b/,
    rationale: 'Context that can be unsafe alone or after dark',
    score: 0.3,
  },
];

/** Normalisation applied before matching: case-folded, whitespace-collapsed. */
export function normaliseForMatching(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}
