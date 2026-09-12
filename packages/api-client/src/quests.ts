import type {
  AcceptQuestRequest,
  ArchiveQuestRequest,
  CompletionRequest,
  CreateQuestRequest,
  ParticipationList,
  ParticipationView,
  QuestAssessmentView,
  QuestCategory,
  QuestDetail,
  QuestList,
  QuestListQuery,
  QuestSupportView,
  SuspendQuestRequest,
  UpdateQuestRequest,
} from '@quest/types';

import type { ApiClient } from './client';

/**
 * Typed Quest endpoints (Phase 02). Paths mirror docs/api/openapi/v1.json.
 *
 * Two things are deliberately absent because the server owns them: there is no way to set an
 * owner (it comes from the token) and no way to set a state (only `publish` / `archive` move a
 * Quest, and only when the safety gate allows it).
 */
export function questsApi(client: ApiClient) {
  return {
    create: (body: CreateQuestRequest) => client.post<QuestDetail>('/quests', body),
    /** Discovery: published, public, newest first. Works signed out. */
    list: (query: Partial<QuestListQuery> = {}) => client.get<QuestList>('/quests', { query }),
    mine: (query: { cursor?: string; limit?: number } = {}) =>
      client.get<QuestList>('/quests/mine', { query }),
    get: (questId: string) => client.get<QuestDetail>(`/quests/${encodeURIComponent(questId)}`),
    update: (questId: string, body: UpdateQuestRequest) =>
      client.put<QuestDetail>(`/quests/${encodeURIComponent(questId)}`, body),
    /** Requests a safety decision. Never publishes by itself. */
    assess: (questId: string) =>
      client.post<QuestAssessmentView>(`/quests/${encodeURIComponent(questId)}/assessment`),
    /**
     * The only path to visibility. `expectedContentHash` is the hash the client last read, so an
     * edit made in another tab cannot be published by accident; a refusal comes back as a 409
     * whose body lists the blockers.
     */
    publish: (questId: string, expectedContentHash: string) =>
      client.post<QuestDetail>(`/quests/${encodeURIComponent(questId)}/publish`, {
        expectedContentHash,
      }),
    archive: (questId: string, body: ArchiveQuestRequest = {}) =>
      client.post<QuestDetail>(`/quests/${encodeURIComponent(questId)}/archive`, body),
    categories: () => client.get<{ data: QuestCategory[] }>('/quest-categories'),

    participation: {
      accept: (questId: string, body: AcceptQuestRequest = {}) =>
        client.post<ParticipationView>(
          `/quests/${encodeURIComponent(questId)}/participation`,
          body,
        ),
      mine: (query: { cursor?: string; limit?: number } = {}) =>
        client.get<ParticipationList>('/me/participations', { query }),
      start: (participationId: string) =>
        client.post<ParticipationView>(
          `/me/participations/${encodeURIComponent(participationId)}/start`,
        ),
      requestCompletion: (participationId: string, body: CompletionRequest = {}) =>
        client.post<ParticipationView>(
          `/me/participations/${encodeURIComponent(participationId)}/completion-request`,
          body,
        ),
      cancel: (participationId: string) =>
        client.post<ParticipationView>(
          `/me/participations/${encodeURIComponent(participationId)}/cancel`,
        ),
    },

    admin: {
      get: (questId: string) =>
        client.get<QuestSupportView>(`/admin/quests/${encodeURIComponent(questId)}`),
      suspend: (questId: string, body: SuspendQuestRequest) =>
        client.post<QuestSupportView>(`/admin/quests/${encodeURIComponent(questId)}/suspend`, body),
      reinstate: (questId: string) =>
        client.post<QuestSupportView>(`/admin/quests/${encodeURIComponent(questId)}/reinstate`),
    },
  };
}

export type QuestsApi = ReturnType<typeof questsApi>;
