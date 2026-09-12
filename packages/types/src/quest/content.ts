import { z } from 'zod';

import { AgeBand } from '../identity/age-policy';

/**
 * Quest content, taxonomy and the canonical serialisation that the content hash is taken over.
 *
 * The hash is what makes safety approval verifiable: an assessment records the hash it judged, and
 * the publish gate refuses to publish content whose hash differs. Only *safety-relevant* fields
 * take part — changing the estimated duration must not invalidate an approval, changing the
 * instructions must.
 */

// ------------------------------------------------------------------------------- taxonomy ----

/** Seeded catalogue keys (`quest_category`); the database table is the runtime authority. */
export const QUEST_CATEGORY_KEYS = [
  'fitness',
  'outdoors',
  'learning',
  'creativity',
  'community',
  'environment',
  'kindness',
  'culture',
  'food',
  'mindfulness',
  'skills',
  'exploration',
] as const;
export type QuestCategoryKey = (typeof QUEST_CATEGORY_KEYS)[number];
export const questCategoryKeySchema = z.enum(QUEST_CATEGORY_KEYS);

export const questCategorySchema = z.object({
  key: questCategoryKeySchema,
  label: z.string().min(1),
  sortOrder: z.number().int(),
});
export type QuestCategory = z.infer<typeof questCategorySchema>;

/** Effort, not danger: difficulty must never be a licence for risk (safety is a separate axis). */
export const QuestDifficulty = {
  EASY: 'EASY',
  MODERATE: 'MODERATE',
  HARD: 'HARD',
  EXPERT: 'EXPERT',
} as const;
export type QuestDifficulty = (typeof QuestDifficulty)[keyof typeof QuestDifficulty];
export const questDifficultySchema = z.enum(
  Object.values(QuestDifficulty) as [QuestDifficulty, ...QuestDifficulty[]],
);

export const QuestVisibility = {
  /** Listed in discovery for everyone eligible. */
  PUBLIC: 'PUBLIC',
  /** Reachable by direct link for eligible viewers, never listed. */
  UNLISTED: 'UNLISTED',
  /** Owner only, even when published (used for personal challenges). */
  PRIVATE: 'PRIVATE',
} as const;
export type QuestVisibility = (typeof QuestVisibility)[keyof typeof QuestVisibility];
export const questVisibilitySchema = z.enum(
  Object.values(QuestVisibility) as [QuestVisibility, ...QuestVisibility[]],
);

/** What a participant must be able to submit later (Phase 05 verifies it; Phase 02 only declares). */
export const EvidenceType = {
  PHOTO: 'PHOTO',
  VIDEO: 'VIDEO',
  TEXT_NOTE: 'TEXT_NOTE',
  CHECKLIST: 'CHECKLIST',
} as const;
export type EvidenceType = (typeof EvidenceType)[keyof typeof EvidenceType];
export const evidenceTypeSchema = z.enum(
  Object.values(EvidenceType) as [EvidenceType, ...EvidenceType[]],
);

export const evidenceRequirementSchema = z
  .object({
    types: z.array(evidenceTypeSchema).min(1).max(4),
    /** How many separate items of evidence the participant must provide. */
    minimumItems: z.number().int().min(1).max(10).default(1),
    /** Coarse location attestation only; precise coordinates are out of scope for Phase 02. */
    requiresLocationAttestation: z.boolean().default(false),
    notes: z.string().max(500).optional(),
  })
  .refine((r) => new Set(r.types).size === r.types.length, {
    message: 'Evidence types must be unique',
  });
export type EvidenceRequirement = z.infer<typeof evidenceRequirementSchema>;

// ------------------------------------------------------------------------------- duration ----

export const QUEST_MIN_EFFORT_MINUTES = 5;
export const QUEST_MAX_EFFORT_MINUTES = 8 * 60;
export const QUEST_MIN_COMPLETION_WINDOW_HOURS = 1;
export const QUEST_MAX_COMPLETION_WINDOW_HOURS = 30 * 24;

/**
 * Three distinct time concepts, deliberately separate:
 *  - `effortMinutes`   — how long doing it should take (planning/expectation setting);
 *  - `completionWindowHours` — how long a participant has after START before the attempt expires;
 *  - `availableFrom` / `availableUntil` — when the Quest itself may be discovered and accepted.
 */
export const questDurationSchema = z
  .object({
    effortMinutes: z.number().int().min(QUEST_MIN_EFFORT_MINUTES).max(QUEST_MAX_EFFORT_MINUTES),
    completionWindowHours: z
      .number()
      .int()
      .min(QUEST_MIN_COMPLETION_WINDOW_HOURS)
      .max(QUEST_MAX_COMPLETION_WINDOW_HOURS)
      .default(24),
    availableFrom: z.iso.datetime().optional(),
    availableUntil: z.iso.datetime().optional(),
  })
  .refine(
    (d) =>
      !d.availableFrom ||
      !d.availableUntil ||
      new Date(d.availableUntil).getTime() > new Date(d.availableFrom).getTime(),
    { message: 'availableUntil must be after availableFrom', path: ['availableUntil'] },
  );
export type QuestDuration = z.infer<typeof questDurationSchema>;

// ---------------------------------------------------------------------------- eligibility ----

/** Age bands a Quest may require, ordered from least to most restrictive. */
export const QUEST_AGE_BANDS = [AgeBand.TEEN_13_15, AgeBand.TEEN_16_17, AgeBand.ADULT] as const;
export const questAgeBandSchema = z.enum(QUEST_AGE_BANDS);
export type QuestAgeBand = (typeof QUEST_AGE_BANDS)[number];

const BAND_RANK: Readonly<Record<QuestAgeBand, number>> = {
  TEEN_13_15: 0,
  TEEN_16_17: 1,
  ADULT: 2,
};

/** True when a participant's band satisfies a Quest's minimum band. Server-side only. */
export function ageBandSatisfies(participant: QuestAgeBand, required: QuestAgeBand): boolean {
  return BAND_RANK[participant] >= BAND_RANK[required];
}

/** The stricter of two bands — used to fold safety restrictions into the owner's own choice. */
export function strictestAgeBand(a: QuestAgeBand, b: QuestAgeBand): QuestAgeBand {
  return BAND_RANK[a] >= BAND_RANK[b] ? a : b;
}

/** Minimum age (years) → the band that satisfies it, for safety restrictions. */
export function ageBandForMinimumAge(minimumAge: number): QuestAgeBand {
  if (minimumAge >= 18) return AgeBand.ADULT;
  if (minimumAge >= 16) return AgeBand.TEEN_16_17;
  return AgeBand.TEEN_13_15;
}

export const questEligibilitySchema = z.object({
  minimumAgeBand: questAgeBandSchema.default(AgeBand.TEEN_13_15),
  /** Participants must have a verified email address before accepting. */
  requiresVerifiedEmail: z.boolean().default(true),
  /** ISO 3166-1 alpha-2. Empty = everywhere the safety assessment allows. */
  allowedCountries: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(50)
    .default([]),
  blockedCountries: z
    .array(z.string().regex(/^[A-Z]{2}$/))
    .max(50)
    .default([]),
});
export type QuestEligibility = z.infer<typeof questEligibilitySchema>;

// ---------------------------------------------------------------------- safety-relevant ----

/** Coarse location constraint. Country + human label only: no coordinates are stored in Phase 02. */
export const questLocationSchema = z.object({
  countryCode: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  label: z.string().max(120).optional(),
});
export type QuestLocation = z.infer<typeof questLocationSchema>;

/**
 * The fields a safety decision is made about. Changing any of them invalidates an approval; the
 * hash is computed over exactly this set (see `canonicalQuestContent`).
 */
export const questContentSchema = z.object({
  title: z.string().trim().min(4).max(120),
  summary: z.string().trim().min(10).max(280),
  instructions: z.string().trim().min(20).max(4000),
  safetyNotes: z.string().trim().max(1000).optional(),
  categoryKey: questCategoryKeySchema,
  difficulty: questDifficultySchema,
  evidence: evidenceRequirementSchema,
  eligibility: questEligibilitySchema,
  location: questLocationSchema.optional(),
});
export type QuestContent = z.infer<typeof questContentSchema>;
export type QuestContentInput = z.input<typeof questContentSchema>;

/**
 * Canonical, stable serialisation of the safety-relevant content. The API hashes this string
 * (SHA-256) to produce `contentHash`; the same input must always produce the same string on every
 * runtime, so key order is fixed here rather than left to `JSON.stringify` of an object literal.
 *
 * Whitespace is normalised because "a  b" and "a b" are the same content to a reader and to a
 * policy engine; case is preserved because it can carry meaning.
 */
export function canonicalQuestContent(content: QuestContent): string {
  const text = (value: string | undefined): string => (value ?? '').replace(/\s+/g, ' ').trim();
  const parts: string[] = [
    `v=${QUEST_CONTENT_HASH_VERSION}`,
    `title=${text(content.title)}`,
    `summary=${text(content.summary)}`,
    `instructions=${text(content.instructions)}`,
    `safetyNotes=${text(content.safetyNotes)}`,
    `category=${content.categoryKey}`,
    `difficulty=${content.difficulty}`,
    `evidenceTypes=${[...content.evidence.types].sort().join(',')}`,
    `evidenceMin=${String(content.evidence.minimumItems)}`,
    `evidenceLocation=${String(content.evidence.requiresLocationAttestation)}`,
    `evidenceNotes=${text(content.evidence.notes)}`,
    `minimumAgeBand=${content.eligibility.minimumAgeBand}`,
    `requiresVerifiedEmail=${String(content.eligibility.requiresVerifiedEmail)}`,
    `allowedCountries=${[...content.eligibility.allowedCountries].sort().join(',')}`,
    `blockedCountries=${[...content.eligibility.blockedCountries].sort().join(',')}`,
    `locationCountry=${content.location?.countryCode ?? ''}`,
    `locationLabel=${text(content.location?.label)}`,
  ];
  return parts.join('\n');
}

/** Bumping this invalidates every stored hash on purpose (re-assessment required). */
export const QUEST_CONTENT_HASH_VERSION = 1;

/** Fields an owner may change while a Quest stays published — nothing a policy decision rests on. */
export const publishedEditableFields = ['visibility', 'duration'] as const;
