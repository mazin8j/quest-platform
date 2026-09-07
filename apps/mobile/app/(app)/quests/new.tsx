import type { QuestCategory } from '@quest/types';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  FormError,
  Muted,
  PrimaryButton,
  TextField,
  Title,
  useAction,
} from '../../../src/components/Form';
import { Screen } from '../../../src/components/Screen';
import { useQuests } from '../../../src/features/quests/quest-client';
import {
  EMPTY_QUEST_FORM,
  type QuestFormInput,
  toCreateRequest,
  validateQuestForm,
} from '../../../src/features/quests/quest-form';
import { radii, spacing, typography, useTheme } from '../../../src/theme';

const DIFFICULTIES = ['EASY', 'MODERATE', 'HARD', 'EXPERT'] as const;
const EVIDENCE = ['PHOTO', 'VIDEO', 'TEXT_NOTE', 'CHECKLIST'] as const;

/**
 * Quest composer. It creates a DRAFT and nothing more — publication is a separate, deliberate
 * step behind the safety check, so nobody publishes by accident from a create form.
 */
export default function NewQuestScreen() {
  const router = useRouter();
  const { call } = useQuests();
  const [form, setForm] = useState<QuestFormInput>(EMPTY_QUEST_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [categories, setCategories] = useState<QuestCategory[]>([]);

  useEffect(() => {
    call((api) => api.categories())
      .then((res) => setCategories(res.data))
      .catch(() => setCategories([]));
  }, [call]);

  const set = (key: keyof QuestFormInput) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = useAction(async () => {
    const validation = validateQuestForm(form);
    setErrors(validation.errors);
    if (!validation.ok) throw new Error('Please fix the highlighted fields.');
    const created = await call((api) => api.create(toCreateRequest(form)));
    router.replace(`/(app)/quests/${created.questId}`);
  });

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Title>Create a Quest</Title>
        <Muted>Saved as a draft. You will run a safety check before anyone else can see it.</Muted>

        <TextField
          label="Title"
          value={form.title}
          onChangeText={set('title')}
          error={errors.title}
          placeholder="Plant something and watch it grow"
        />
        <TextField
          label="Summary"
          value={form.summary}
          onChangeText={set('summary')}
          error={errors.summary}
          multiline
          placeholder="One or two sentences about what this Quest is."
        />
        <TextField
          label="What to do"
          value={form.instructions}
          onChangeText={set('instructions')}
          error={errors.instructions}
          multiline
          numberOfLines={6}
          placeholder="Step by step, what a participant actually does."
        />
        <TextField
          label="Safety notes (optional)"
          value={form.safetyNotes}
          onChangeText={set('safetyNotes')}
          error={errors.safetyNotes}
          multiline
          placeholder="Anything a participant should be careful about."
        />

        <Choices
          label="Category"
          error={errors.categoryKey}
          options={categories.map((c) => ({ value: c.key, label: c.label }))}
          selected={form.categoryKey}
          onSelect={set('categoryKey')}
        />
        <Choices
          label="Difficulty"
          options={DIFFICULTIES.map((d) => ({ value: d, label: d.toLowerCase() }))}
          selected={form.difficulty}
          onSelect={set('difficulty')}
        />
        <Choices
          label="Evidence"
          options={EVIDENCE.map((e) => ({ value: e, label: e.toLowerCase().replace('_', ' ') }))}
          selected={form.evidenceType}
          onSelect={set('evidenceType')}
        />

        <TextField
          label="Effort (minutes)"
          value={form.effortMinutes}
          onChangeText={set('effortMinutes')}
          error={errors.effortMinutes}
          keyboardType="number-pad"
        />
        <TextField
          label="Hours to finish once started"
          value={form.completionWindowHours}
          onChangeText={set('completionWindowHours')}
          error={errors.completionWindowHours}
          keyboardType="number-pad"
        />

        <FormError error={submit.error} />
        <PrimaryButton title="Save draft" onPress={submit.run} disabled={submit.pending} />
      </ScrollView>
    </Screen>
  );
}

function Choices({
  label,
  options,
  selected,
  onSelect,
  error,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (value: string) => void;
  error?: string;
}) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.textSecondary }]}>{label}</Text>
      <View style={styles.choices}>
        {options.map((option) => {
          const active = option.value === selected;
          return (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${label}: ${option.label}`}
              style={[
                styles.choice,
                {
                  borderColor: active ? t.primary : t.border,
                  backgroundColor: active ? t.primary : t.surface,
                },
              ]}
            >
              <Text style={{ color: active ? t.onPrimary : t.textPrimary }}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={[styles.error, { color: t.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.md, paddingBottom: spacing.xxl },
  field: { gap: spacing.xs },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.medium },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
  },
  error: { fontSize: typography.size.xs },
});
