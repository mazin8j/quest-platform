import { ApiClientError } from '@quest/api-client';
import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { radii, spacing, typography, useTheme } from '../theme';

/** Labelled text field with an accessible error line. */
export function TextField({
  label,
  error,
  ...input
}: { label: string; error?: string | null } & TextInputProps) {
  const t = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: t.textSecondary }]}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        placeholderTextColor={t.textSecondary}
        style={[
          styles.input,
          {
            color: t.textPrimary,
            borderColor: error ? t.danger : t.border,
            backgroundColor: t.surface,
          },
        ]}
      />
      {error ? (
        <Text style={[styles.error, { color: t.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const t = useTheme();
  const background =
    variant === 'danger' ? t.danger : variant === 'secondary' ? t.surface : t.primary;
  const color = variant === 'secondary' ? t.textPrimary : t.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.5 : 1, borderColor: t.border },
      ]}
    >
      <Text style={[styles.buttonText, { color }]}>{title}</Text>
    </Pressable>
  );
}

export function FormError({ error }: { error: string | null }) {
  const t = useTheme();
  if (!error) return null;
  return (
    <Text style={[styles.formError, { color: t.danger }]} accessibilityLiveRegion="assertive">
      {error}
    </Text>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.title, { color: t.textPrimary }]}>{children}</Text>;
}

export function Muted({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={[styles.muted, { color: t.textSecondary }]}>{children}</Text>;
}

/** Maps API errors to user-facing copy by stable code (never the raw developer message for 5xx). */
export function describeError(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.code) {
      case 'VALIDATION_ERROR':
        return error.envelope?.error.issues?.[0]?.message ?? 'Please check the highlighted fields.';
      case 'UNAUTHENTICATED':
        return error.message || 'Please sign in again.';
      case 'CONFLICT':
        return error.message;
      case 'FORBIDDEN':
        return error.message || 'This action is not available for your account.';
      case 'RATE_LIMITED':
        return 'Too many attempts. Please wait a moment and try again.';
      case 'NETWORK_ERROR':
      case 'TIMEOUT':
        return 'Cannot reach QUEST right now. Check your connection.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }
  return 'Something went wrong. Please try again.';
}

/** Tiny async-action hook: pending flag + last error, for buttons that call the API. */
export function useAction<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = (...args: A) => {
    setPending(true);
    setError(null);
    fn(...args)
      .catch((e: unknown) => setError(describeError(e)))
      .finally(() => setPending(false));
  };
  return { run, pending, error };
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.medium },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: typography.size.md,
  },
  error: { fontSize: typography.size.xs },
  formError: { fontSize: typography.size.sm },
  button: {
    minHeight: 48,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  buttonText: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
  title: { fontSize: typography.size.xxl, fontWeight: typography.weight.bold },
  muted: { fontSize: typography.size.sm },
});
