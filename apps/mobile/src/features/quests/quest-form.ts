import {
  QUEST_MAX_COMPLETION_WINDOW_HOURS,
  QUEST_MAX_EFFORT_MINUTES,
  QUEST_MIN_COMPLETION_WINDOW_HOURS,
  QUEST_MIN_EFFORT_MINUTES,
  type CreateQuestRequest,
  questContentSchema,
  questDurationSchema,
} from '@quest/types';

/**
 * Client-side pre-validation of the Quest composer, using the shared contracts so the phone and
 * the API agree on what a valid Quest is. The API re-validates everything — this exists to give
 * the author an error next to the field instead of a round trip.
 */
export interface QuestFormInput {
  title: string;
  summary: string;
  instructions: string;
  safetyNotes: string;
  categoryKey: string;
  difficulty: string;
  evidenceType: string;
  effortMinutes: string;
  completionWindowHours: string;
  visibility: string;
}

export const EMPTY_QUEST_FORM: QuestFormInput = {
  title: '',
  summary: '',
  instructions: '',
  safetyNotes: '',
  categoryKey: '',
  difficulty: 'EASY',
  evidenceType: 'PHOTO',
  effortMinutes: '30',
  completionWindowHours: '24',
  visibility: 'PUBLIC',
};

export function validateQuestForm(input: QuestFormInput): {
  ok: boolean;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const content = questContentSchema.safeParse(toContent(input));
  if (!content.success) {
    for (const issue of content.error.issues) {
      const field = String(issue.path[0] ?? 'form');
      errors[field] ??= issue.message;
    }
  }
  const effort = Number(input.effortMinutes);
  const window = Number(input.completionWindowHours);
  if (
    !Number.isInteger(effort) ||
    effort < QUEST_MIN_EFFORT_MINUTES ||
    effort > QUEST_MAX_EFFORT_MINUTES
  ) {
    errors.effortMinutes = `Between ${QUEST_MIN_EFFORT_MINUTES} and ${QUEST_MAX_EFFORT_MINUTES} minutes`;
  }
  if (
    !Number.isInteger(window) ||
    window < QUEST_MIN_COMPLETION_WINDOW_HOURS ||
    window > QUEST_MAX_COMPLETION_WINDOW_HOURS
  ) {
    errors.completionWindowHours = `Between ${QUEST_MIN_COMPLETION_WINDOW_HOURS} and ${QUEST_MAX_COMPLETION_WINDOW_HOURS} hours`;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

function toContent(input: QuestFormInput): Record<string, unknown> {
  return {
    title: input.title,
    summary: input.summary,
    instructions: input.instructions,
    ...(input.safetyNotes.trim() ? { safetyNotes: input.safetyNotes } : {}),
    categoryKey: input.categoryKey,
    difficulty: input.difficulty,
    evidence: { types: [input.evidenceType] },
    eligibility: {},
  };
}

/**
 * Builds the create request. Deliberately carries no owner, no state and no publication fields:
 * the server derives ownership from the token and only the publish endpoint changes state.
 */
export function toCreateRequest(input: QuestFormInput): CreateQuestRequest {
  return {
    visibility: input.visibility as CreateQuestRequest['visibility'],
    content: questContentSchema.parse(toContent(input)),
    duration: questDurationSchema.parse({
      effortMinutes: Number(input.effortMinutes),
      completionWindowHours: Number(input.completionWindowHours),
    }),
  };
}
