import type { QuestCard } from '@quest/types';
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { radii, spacing, typography, useTheme } from '../../theme';

/** One Quest in a list. Shows only what the API returned for this viewer. */
export function QuestCardRow({ quest }: { quest: QuestCard }) {
  const t = useTheme();
  return (
    <Link href={`/(app)/quests/${quest.questId}`} asChild>
      <View
        style={[styles.card, { backgroundColor: t.surface, borderColor: t.border }]}
        accessibilityRole="link"
        accessibilityLabel={`${quest.title}. ${quest.summary}`}
      >
        <Text style={[styles.title, { color: t.textPrimary }]}>{quest.title}</Text>
        <Text style={[styles.summary, { color: t.textSecondary }]} numberOfLines={2}>
          {quest.summary}
        </Text>
        <View style={styles.meta}>
          <Text style={[styles.tag, { color: t.textSecondary, borderColor: t.border }]}>
            {quest.categoryKey}
          </Text>
          <Text style={[styles.tag, { color: t.textSecondary, borderColor: t.border }]}>
            {quest.difficulty.toLowerCase()}
          </Text>
          <Text style={[styles.tag, { color: t.textSecondary, borderColor: t.border }]}>
            {quest.duration.effortMinutes} min
          </Text>
          {quest.state !== 'PUBLISHED' ? (
            <Text style={[styles.tag, { color: t.warning, borderColor: t.warning }]}>
              {quest.state.toLowerCase().replace('_', ' ')}
            </Text>
          ) : null}
          {quest.participating ? (
            <Text style={[styles.tag, { color: t.success, borderColor: t.success }]}>accepted</Text>
          ) : null}
        </View>
        {quest.safety?.warning ? (
          <Text style={[styles.warning, { color: t.warning }]}>{quest.safety.warning}</Text>
        ) : null}
      </View>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radii.md, padding: spacing.lg, gap: spacing.xs },
  title: { fontSize: typography.size.lg, fontWeight: typography.weight.semibold },
  summary: { fontSize: typography.size.sm },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, paddingTop: spacing.xs },
  tag: {
    fontSize: typography.size.xs,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  warning: { fontSize: typography.size.xs, paddingTop: spacing.xs },
});
