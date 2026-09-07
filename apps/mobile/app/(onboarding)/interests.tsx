import { INTERESTS_MIN_FOR_ONBOARDING, type Interest } from '@quest/types';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FormError, Muted, PrimaryButton, Title, useAction } from '../../src/components/Form';
import { LoadingState } from '../../src/components/LoadingState';
import { Screen } from '../../src/components/Screen';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { radii, spacing, typography, useTheme } from '../../src/theme';

/** Interest selection (≥ 3) then onboarding completion. */
export default function InterestsScreen() {
  const t = useTheme();
  const { store } = useAuth();
  const [catalogue, setCatalogue] = useState<Interest[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    store
      .call((api) => api.public.interests())
      .then((r) => setCatalogue(r.data))
      .catch(() => setCatalogue([]));
  }, [store]);

  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const finish = useAction(async () => {
    await store.call((api) => api.profile.updateInterests({ interestKeys: [...selected] }));
    await store.call((api) => api.profile.completeOnboarding());
    await store.refreshAccount();
  });

  if (!catalogue) return <LoadingState label="Loading interests…" />;

  return (
    <Screen>
      <Title>What do you want to do?</Title>
      <Muted>Pick at least {INTERESTS_MIN_FOR_ONBOARDING}. We use these to suggest quests.</Muted>
      <ScrollView contentContainerStyle={styles.chips}>
        {catalogue.map((i) => {
          const on = selected.has(i.key);
          return (
            <Pressable
              key={i.key}
              onPress={() => toggle(i.key)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? t.primary : t.surface,
                  borderColor: on ? t.primary : t.border,
                },
              ]}
            >
              <Text
                style={{ color: on ? t.onPrimary : t.textPrimary, fontSize: typography.size.sm }}
              >
                {i.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.footer}>
        <FormError error={finish.error} />
        <PrimaryButton
          title={finish.pending ? 'Finishing…' : `Continue (${selected.size} selected)`}
          onPress={() => finish.run()}
          disabled={finish.pending || selected.size < INTERESTS_MIN_FOR_ONBOARDING}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: spacing.md },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  footer: { gap: spacing.md },
});
