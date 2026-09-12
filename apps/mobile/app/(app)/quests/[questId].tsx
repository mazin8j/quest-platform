import type { ParticipationView, QuestDetail } from '@quest/types';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  FormError,
  Muted,
  PrimaryButton,
  Title,
  describeError,
  useAction,
} from '../../../src/components/Form';
import { LoadingState } from '../../../src/components/LoadingState';
import { Screen } from '../../../src/components/Screen';
import { useQuests } from '../../../src/features/quests/quest-client';
import {
  describeEligibilityReason,
  describePublishBlockers,
} from '../../../src/features/quests/publish-blockers';
import { radii, spacing, typography, useTheme } from '../../../src/theme';

/**
 * Quest detail and the participant's own controls.
 *
 * The screen never decides eligibility: it offers the action and shows the server's answer. That
 * keeps one authority for who may accept what, and means a stale client cannot talk itself into
 * an attempt it is not allowed to make.
 */
export default function QuestDetailScreen() {
  const t = useTheme();
  const { questId } = useLocalSearchParams<{ questId: string }>();
  const { call } = useQuests();
  const [quest, setQuest] = useState<QuestDetail | null>(null);
  const [attempt, setAttempt] = useState<ParticipationView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!questId) return;
    setError(null);
    call((api) => api.get(questId))
      .then(setQuest)
      .catch((e: unknown) => setError(describeError(e)));
    call((api) => api.participation.mine({ limit: 50 }))
      .then((page) =>
        setAttempt(page.data.find((p) => p.questId === questId && isActive(p.state)) ?? null),
      )
      .catch(() => setAttempt(null));
  }, [call, questId]);

  useEffect(load, [load]);

  const accept = useAction(async () => {
    if (!quest) return;
    try {
      setAttempt(
        await call((api) =>
          api.participation.accept(quest.questId, {
            expectedPublishedVersion: quest.publishedVersion ?? undefined,
          }),
        ),
      );
    } catch (error) {
      // The API refuses with machine-readable reasons; show the participant the plain-language
      // one rather than the raw code, and never invent a reason the server did not give.
      throw new Error(eligibilityMessage(error));
    }
    load();
  });
  const start = useAction(async () => {
    if (!attempt) return;
    setAttempt(await call((api) => api.participation.start(attempt.participationId)));
  });
  const complete = useAction(async () => {
    if (!attempt) return;
    setAttempt(await call((api) => api.participation.requestCompletion(attempt.participationId)));
  });
  const cancel = useAction(async () => {
    if (!attempt) return;
    setAttempt(await call((api) => api.participation.cancel(attempt.participationId)));
    load();
  });

  if (!quest)
    return error ? <ErrorScreen error={error} /> : <LoadingState label="Loading Quest…" />;

  const blockers = describePublishBlockers(quest.publishBlockers);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Title>{quest.title}</Title>
        <Muted>
          by {quest.owner.displayName ?? quest.owner.username ?? 'a QUEST member'} ·{' '}
          {quest.categoryKey} · {quest.difficulty.toLowerCase()}
        </Muted>
        <Text style={{ color: t.textPrimary }}>{quest.summary}</Text>

        {quest.safety?.warning ? (
          <View style={[styles.callout, { borderColor: t.warning, backgroundColor: t.surface }]}>
            <Text style={[styles.calloutText, { color: t.warning }]}>{quest.safety.warning}</Text>
          </View>
        ) : null}

        <Section title="What to do">
          <Text style={{ color: t.textPrimary }}>{quest.instructions}</Text>
        </Section>

        {quest.safetyNotes ? (
          <Section title="Stay safe">
            <Text style={{ color: t.textPrimary }}>{quest.safetyNotes}</Text>
          </Section>
        ) : null}

        <Section title="Time">
          <Muted>
            About {quest.duration.effortMinutes} minutes of effort ·{' '}
            {quest.duration.completionWindowHours} hours to finish once you start
          </Muted>
        </Section>

        <Section title="Evidence you will need">
          <Muted>
            {quest.evidence.minimumItems} × {quest.evidence.types.join(', ').toLowerCase()}
          </Muted>
        </Section>

        {blockers.length > 0 ? (
          <Section title="Before you can publish">
            {blockers.map((line) => (
              <Text key={line} style={[styles.blocker, { color: t.warning }]}>
                {line}
              </Text>
            ))}
          </Section>
        ) : null}

        <FormError error={error ?? accept.error ?? start.error ?? complete.error ?? cancel.error} />

        {attempt ? (
          <View style={styles.actions}>
            <Muted>Your attempt: {attempt.state.toLowerCase().replace('_', ' ')}</Muted>
            {attempt.state === 'ACCEPTED' ? (
              <PrimaryButton title="Start now" onPress={start.run} disabled={start.pending} />
            ) : null}
            {attempt.state === 'STARTED' ? (
              <PrimaryButton
                title="I have done it"
                onPress={complete.run}
                disabled={complete.pending}
              />
            ) : null}
            {isActive(attempt.state) ? (
              <PrimaryButton
                title="Give up for now"
                onPress={cancel.run}
                disabled={cancel.pending}
                variant="secondary"
              />
            ) : null}
            {attempt.state === 'COMPLETION_REQUESTED' ? (
              <Muted>Evidence and verification arrive in a later release.</Muted>
            ) : null}
          </View>
        ) : (
          <View style={styles.actions}>
            <PrimaryButton
              title="Accept this Quest"
              onPress={accept.run}
              disabled={accept.pending}
            />
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: t.textSecondary }]}>{title}</Text>
      {children}
    </View>
  );
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <Screen>
      <Title>Quest unavailable</Title>
      <FormError error={error} />
    </Screen>
  );
}

/** Turns an eligibility refusal from the API into copy, falling back to the generic message. */
function eligibilityMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const codes = message.match(/[A-Z][A-Z_]{4,}/g) ?? [];
  const first = codes[0];
  return first ? describeEligibilityReason(first) : describeError(error);
}

function isActive(state: ParticipationView['state']): boolean {
  return state === 'ACCEPTED' || state === 'STARTED';
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.xxl },
  section: { gap: spacing.xs, paddingTop: spacing.sm },
  sectionTitle: {
    fontSize: typography.size.xs,
    fontWeight: typography.weight.semibold,
    textTransform: 'uppercase',
  },
  callout: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md },
  calloutText: { fontSize: typography.size.sm },
  blocker: { fontSize: typography.size.sm },
  actions: { gap: spacing.md, paddingTop: spacing.lg },
});
