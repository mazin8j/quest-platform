import { ApiClientError } from '@quest/api-client';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { LoadingState } from '@/components/LoadingState';
import { Screen } from '@/components/Screen';
import { getApiLiveness } from '@/lib/api';
import { spacing, typography, useTheme } from '@/theme';

type Status =
  { kind: 'loading' } | { kind: 'up'; version: string } | { kind: 'down'; reason: string };

/** Phase 00 home screen: proves the API client, loading and error patterns on device. */
export default function HomeScreen() {
  const t = useTheme();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });

  const check = useCallback(async () => {
    setStatus({ kind: 'loading' });
    try {
      const live = await getApiLiveness();
      setStatus({ kind: 'up', version: live.version });
    } catch (error) {
      setStatus({ kind: 'down', reason: error instanceof ApiClientError ? error.code : 'UNKNOWN' });
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <Screen>
      <Text style={[styles.title, { color: t.textPrimary }]}>QUEST</Text>
      <Text style={[styles.subtitle, { color: t.textSecondary }]}>
        Don&apos;t just watch life — do something.
      </Text>
      {status.kind === 'loading' ? (
        <LoadingState label="Checking platform…" />
      ) : (
        <Text
          style={{
            color: status.kind === 'up' ? t.success : t.danger,
            fontSize: typography.size.md,
          }}
        >
          {status.kind === 'up'
            ? `API up · ${status.version}`
            : `API unreachable · ${status.reason}`}
        </Text>
      )}
      <Pressable
        onPress={() => void check()}
        style={[styles.button, { backgroundColor: t.primary }]}
        accessibilityRole="button"
        accessibilityLabel="Retry platform check"
      >
        <Text style={[styles.buttonText, { color: t.onPrimary }]}>Retry</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: typography.size.display, fontWeight: typography.weight.bold },
  subtitle: { fontSize: typography.size.md },
  button: {
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: spacing.xl,
    borderRadius: 999,
    justifyContent: 'center',
  },
  buttonText: { fontSize: typography.size.md, fontWeight: typography.weight.semibold },
});
