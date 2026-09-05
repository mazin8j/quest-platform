import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { spacing, typography, useTheme } from '../theme';

/** Standard loading pattern: spinner + optional label, accessible to screen readers. */
export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const t = useTheme();
  return (
    <View
      style={styles.container}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      <ActivityIndicator color={t.primary} size="large" />
      <Text style={[styles.label, { color: t.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  label: { fontSize: typography.size.sm },
});
