import type { QuestCard } from '@quest/types';
import { Link } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';

import {
  FormError,
  Muted,
  PrimaryButton,
  Title,
  describeError,
} from '../../../src/components/Form';
import { LoadingState } from '../../../src/components/LoadingState';
import { Screen } from '../../../src/components/Screen';
import { QuestCardRow } from '../../../src/features/quests/QuestCardRow';
import { useQuests } from '../../../src/features/quests/quest-client';
import { spacing, typography, useTheme } from '../../../src/theme';

/**
 * Discovery. Deliberately a plain, newest-first list: ranking and recommendation are later
 * phases, and pretending otherwise here would bake an unowned algorithm into the product.
 */
export default function QuestsScreen() {
  const t = useTheme();
  const { call } = useQuests();
  const [quests, setQuests] = useState<QuestCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    call((api) => api.list({ limit: 20 }))
      .then((page) => setQuests(page.data))
      .catch((e: unknown) => {
        setQuests([]);
        setError(describeError(e));
      });
  }, [call]);

  useEffect(load, [load]);

  if (quests === null) return <LoadingState label="Loading Quests…" />;

  return (
    <Screen>
      <Title>Discover</Title>
      <FormError error={error} />
      <View style={styles.actions}>
        <Link href="/(app)/quests/mine" style={[styles.link, { color: t.primary }]}>
          My Quests
        </Link>
        <Link href="/(app)/quests/new" style={[styles.link, { color: t.primary }]}>
          Create a Quest
        </Link>
      </View>
      <FlatList
        data={quests}
        keyExtractor={(q) => q.questId}
        renderItem={({ item }) => <QuestCardRow quest={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Muted>No Quests are published yet. Be the first.</Muted>
            <PrimaryButton title="Try again" onPress={load} variant="secondary" />
          </View>
        }
      />
      <Text style={[styles.note, { color: t.textSecondary }]}>Newest first — not ranked.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.lg },
  link: { fontSize: typography.size.md, fontWeight: typography.weight.medium },
  list: { gap: spacing.md, paddingVertical: spacing.md },
  empty: { gap: spacing.md, paddingVertical: spacing.xl },
  note: { fontSize: typography.size.xs, textAlign: 'center' },
});
