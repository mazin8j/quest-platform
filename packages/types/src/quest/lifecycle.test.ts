import { describe, expect, it } from 'vitest';

import {
  PARTICIPATION_ACTIVE_STATES,
  PARTICIPATION_TRANSITIONS,
  ParticipationState,
  ParticipationTransition,
  QUEST_EDITABLE_STATES,
  QUEST_TRANSITIONS,
  QUEST_VISIBLE_STATES,
  QuestState,
  QuestTransition,
  canTransitionParticipation,
  canTransitionQuest,
  nextParticipationState,
  nextQuestState,
} from './lifecycle';

const ALL_STATES = Object.values(QuestState);
const ALL_TRANSITIONS = Object.values(QuestTransition);

describe('Quest lifecycle', () => {
  it('is explicit: every state has an entry and unknown transitions are refused', () => {
    for (const state of ALL_STATES) {
      expect(QUEST_TRANSITIONS[state], state).toBeDefined();
      for (const transition of ALL_TRANSITIONS) {
        const to = nextQuestState(state, transition);
        expect(to === undefined || ALL_STATES.includes(to)).toBe(true);
        expect(canTransitionQuest(state, transition)).toBe(to !== undefined);
      }
    }
  });

  it('makes PUBLISHED reachable only from DRAFT', () => {
    const publishable = ALL_STATES.filter(
      (state) => nextQuestState(state, QuestTransition.PUBLISH) === QuestState.PUBLISHED,
    );
    expect(publishable).toEqual([QuestState.DRAFT]);
  });

  it('never publishes straight out of review — review must be revised and re-assessed', () => {
    expect(nextQuestState(QuestState.IN_REVIEW, QuestTransition.PUBLISH)).toBeUndefined();
    expect(nextQuestState(QuestState.IN_REVIEW, QuestTransition.REVISE)).toBe(QuestState.DRAFT);
  });

  it('unpublishes on a safety-relevant revision', () => {
    expect(nextQuestState(QuestState.PUBLISHED, QuestTransition.REVISE)).toBe(QuestState.DRAFT);
  });

  it('returns a suspended Quest to DRAFT, never straight back to visibility', () => {
    expect(nextQuestState(QuestState.SUSPENDED, QuestTransition.REINSTATE)).toBe(QuestState.DRAFT);
    expect(nextQuestState(QuestState.SUSPENDED, QuestTransition.PUBLISH)).toBeUndefined();
  });

  it('treats ERASED as terminal', () => {
    for (const transition of ALL_TRANSITIONS) {
      expect(nextQuestState(QuestState.ERASED, transition)).toBeUndefined();
    }
  });

  it('allows staff suspension from every non-terminal state', () => {
    for (const state of ALL_STATES) {
      if (state === QuestState.ERASED || state === QuestState.SUSPENDED) continue;
      expect(nextQuestState(state, QuestTransition.SUSPEND), state).toBe(QuestState.SUSPENDED);
    }
  });

  it('exposes PUBLISHED as the only visible state', () => {
    expect([...QUEST_VISIBLE_STATES]).toEqual([QuestState.PUBLISHED]);
    for (const state of ALL_STATES) {
      if (state === QuestState.PUBLISHED) continue;
      expect(QUEST_VISIBLE_STATES.has(state), state).toBe(false);
    }
  });

  it('never lets an archived, suspended or erased Quest be edited', () => {
    for (const state of [QuestState.ARCHIVED, QuestState.SUSPENDED, QuestState.ERASED]) {
      expect(QUEST_EDITABLE_STATES.has(state), state).toBe(false);
    }
  });
});

describe('Participation lifecycle', () => {
  const ALL_PARTICIPATION_STATES = Object.values(ParticipationState);

  it('is explicit and closed', () => {
    for (const state of ALL_PARTICIPATION_STATES) {
      expect(PARTICIPATION_TRANSITIONS[state], state).toBeDefined();
      for (const transition of Object.values(ParticipationTransition)) {
        const to = nextParticipationState(state, transition);
        expect(canTransitionParticipation(state, transition)).toBe(to !== undefined);
      }
    }
  });

  it('stops at COMPLETION_REQUESTED — verification and rewards are later phases', () => {
    for (const transition of Object.values(ParticipationTransition)) {
      expect(
        nextParticipationState(ParticipationState.COMPLETION_REQUESTED, transition),
      ).toBeUndefined();
    }
  });

  it('cannot request completion without starting', () => {
    expect(
      nextParticipationState(
        ParticipationState.ACCEPTED,
        ParticipationTransition.REQUEST_COMPLETION,
      ),
    ).toBeUndefined();
    expect(
      nextParticipationState(
        ParticipationState.STARTED,
        ParticipationTransition.REQUEST_COMPLETION,
      ),
    ).toBe(ParticipationState.COMPLETION_REQUESTED);
  });

  it('counts only ACCEPTED and STARTED as occupying the active slot', () => {
    expect([...PARTICIPATION_ACTIVE_STATES].sort()).toEqual(['ACCEPTED', 'STARTED']);
  });

  it('leaves cancelled and expired attempts terminal', () => {
    for (const state of [ParticipationState.CANCELLED, ParticipationState.EXPIRED]) {
      for (const transition of Object.values(ParticipationTransition)) {
        expect(nextParticipationState(state, transition), state).toBeUndefined();
      }
    }
  });
});
