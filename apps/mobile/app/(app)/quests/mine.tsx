import type { QuestCard, QuestDetail } from '@quest/types';
import { Link } from 'expo-router';
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
  describePublishBlockers,
  publishSummary,
} from '../../../src/features/quests/publish-blockers';
import { radii, spacing, typography, useTheme } from '../../../src/theme';

/**
 * The owner's own Quests, and the publish flow: check → publish. Both steps are explicit, and the
 * server's blockers are shown verbatim (translated to plain language) rather than second-guessed.
 */
export default function MyQuestsScreen() {
  const { call } = useQuests();
  const [quests, setQuests] = useState<QuestCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    call((api) => api.mine({ limit: 50 }))
      .then((page) => setQuests(page.data))
      .catch((e: unknown) => {
        setQuests([]);
        setError(describeError(e));
      });
  }, [call]);

  useEffect(load, [load]);

  if (quests === null) return <LoadingState label="Loading your Quests…" />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body}>
        <Title>My Quests</Title>
        <FormError error={error} />
        {quests.length === 0 ? <Muted>You have not created a Quest yet.</Muted> : null}
        {quests.map((quest) => (
          <OwnedQuest key={quest.questId} card={quest} onChanged={load} />
        ))}
        <PrimaryButton title="Refresh" onPress={load} variant="secondary" />
      </ScrollView>
    </Screen>
  );
}

function OwnedQuest({ card, onChanged }: { card: QuestCard; onChanged: () => void }) {
  const t = useTheme();
  const { call } = useQuests();
  const [detail, setDetail] = useState<QuestDetail | null>(null);

  const load = useCallback(() => {
    call((api) => api.get(card.questId))
      .then(setDetail)
      .catch(() => setDetail(null));
  }, [call, card.questId]);

  useEffect(load, [load]);

  const check = useAction(async () => {
    await call((api) => api.assess(card.questId));
    load();
  });
  const publish = useAction(async () => {
    if (!detail?.contentHash) throw new Error('Reload this Quest and try again.');
    await call((api) => api.publish(card.questId, detail.contentHash as string));
    load();
    onChanged();
  });
  const archive = useAction(async () => {
    await call((api) => api.archive(card.questId, {}));
    load();
    onChanged();
  });

  const blockers = describePublishBlockers(detail?.publishBlockers ?? null);
  const canPublish = detail !== null && blockers.length === 0 && detail.state !== 'PUBLISHED';

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}>
      <Link href={`/(app)/quests/${card.questId}`} style={[styles.title, { color: t.textPrimary }]}>
        {card.title}
      </Link>
      <Muted>
        {card.state.toLowerCase().replace('_', ' ')} ·{' '}
        {publishSummary(detail?.publishBlockers ?? null)}
      </Muted>
      {blockers.map((line) => (
        <Text key={line} style={[styles.blocker, { color: t.warning }]}>
          {line}
        </Text>
      ))}
      <FormError error={check.error ?? publish.error ?? archive.error} />
      <View style={styles.actions}>
        {card.state !== 'PUBLISHED' && card.state !== 'ARCHIVED' ? (
          <PrimaryButton
            title="Run safety check"
            onPress={check.run}
            disabled={check.pending}
            variant="secondary"
          />
        ) : null}
        {canPublish ? (
          <PrimaryButton title="Publish" onPress={publish.run} disabled={publish.pending} />
        ) : null}
        {card.state === 'PUBLISHED' ? (
          <PrimaryButton
            title="Archive"
            onPress={archive.run}
            disabled={archive.pending}
            variant="secondary"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.xxl },
  card: { borderWidth: 1, borderRadius: radii.md, padding: spacing.lg, gap: spacing.xs },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold },
  blocker: { fontSize: typography.size.sm },
  actions: { gap: spacing.sm, paddingTop: spacing.sm },
});
