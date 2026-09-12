import { canPublishWithAssessment } from '@quest/types';

import type { AssessmentRecord } from './quest';

/**
 * Which safety decision is in force, when several exist about the same content.
 *
 * The assessment ledger is append-only, so "the current decision" is a resolution rule rather than
 * a column. Phase 02 answered it with "greatest `seq` wins", which is right for one writer and
 * wrong for three. The final delta audit (P1-2) showed why: Trust & Safety suspends a Quest, which
 * records a HUMAN `REVIEW_REQUIRED` for that exact content; staff reinstate it to DRAFT; the owner
 * calls the ordinary assessment route on byte-identical content; the deterministic engine answers
 * `ALLOWED`; that row has the greatest `seq`, and the sanction is gone. No state check can stop it,
 * because after reinstatement the state is DRAFT — which is exactly the shape a legitimate publish
 * has.
 *
 * ## The precedence model (ADR-015)
 *
 * Authority: **HUMAN > AI > RULES**, applied as *supersession* rather than as a ranking of
 * simultaneous opinions:
 *
 * - a decision may only be superseded by one of **equal or higher** authority about the same
 *   content;
 * - so the effective decision is the latest decision made by the **highest authority that has
 *   spoken** about this content;
 * - and a human decision — blocking or clearing — stands until another human revisits that content.
 *
 * This is the whole rule. It is deliberately not "the latest blocking decision wins": a moderator
 * who reviews content and clears it must be able to release it, or the only human action the system
 * respects is refusal. It is deliberately not "any human decision is final forever" either, because
 * the scope is one content hash: a safety-relevant edit produces a different hash, and no earlier
 * decision — human or machine — applies to content nobody has judged (ADR-013).
 *
 * A machine may still record its opinion about content a human has ruled on. The row is kept, and a
 * moderator can see it; it simply does not take effect. Recording is not deciding.
 */

/** Authority of a decision's source. Higher wins; equal authority resolves by recency. */
const AUTHORITY: Readonly<Record<string, number>> = { HUMAN: 3, AI: 2, RULES: 1 };

function authorityOf(decidedBy: string): number {
  // An unrecognised source is treated as the lowest authority rather than the highest: a new
  // decider must be given standing deliberately, not inherit it by being unknown.
  return AUTHORITY[decidedBy] ?? 0;
}

/**
 * The decision in force for `contentHash`, or `null` when nothing has judged that content.
 *
 * Assessments about other content are ignored rather than treated as stale: staleness is the
 * caller's question (`canPublishWithAssessment` answers it), and mixing the two here would let a
 * decision about old content silently answer for new content.
 */
export function effectiveAssessment(
  assessments: readonly AssessmentRecord[],
  contentHash: string,
): AssessmentRecord | null {
  let winner: AssessmentRecord | null = null;
  let winningAuthority = -1;
  for (const candidate of assessments) {
    if (candidate.contentHash !== contentHash) continue;
    const authority = authorityOf(candidate.decidedBy);
    if (authority > winningAuthority) {
      winner = candidate;
      winningAuthority = authority;
      continue;
    }
    // Same authority: the later decision supersedes. `seq` and not `assessedAt`, which defaults to
    // the transaction start time and cannot order two concurrent decisions (audit P02-30).
    if (authority === winningAuthority && winner !== null && candidate.seq > winner.seq) {
      winner = candidate;
    }
  }
  return winner;
}

/**
 * Whether the content a Quest currently has **published** may stay public.
 *
 * `null` for a Quest that is not published: the question does not arise, and answering it "no"
 * would conceal every draft from its own author. Callers that need a boolean must decide what an
 * absent answer means for them — for the read path it means "no opinion, so the other rules
 * decide", never "publishable".
 */
export function publishedDecisionPublishable(
  quest: { state: string; publishedContentHash: string | null },
  assessments: readonly AssessmentRecord[],
): boolean | null {
  if (quest.state !== 'PUBLISHED' || quest.publishedContentHash === null) return null;
  const effective = effectiveAssessment(assessments, quest.publishedContentHash);
  // A PUBLISHED row without a decision about its published content should be impossible (the
  // database CHECK requires publication proof), so treat it as a broken invariant and fail closed.
  if (!effective) return false;
  return canPublishWithAssessment(
    {
      assessmentId: effective.id,
      subjectType: 'QUEST',
      subjectId: effective.questId,
      subjectContentVersion: effective.contentHash,
      state: effective.state,
      signals: effective.signals,
      restrictions: effective.restrictions,
      policyVersion: effective.policyVersion,
      decidedBy: effective.decidedBy,
      assessedAt: effective.assessedAt.toISOString(),
    },
    quest.publishedContentHash,
  ).allowed;
}
