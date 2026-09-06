import type { SessionView } from '@quest/types';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  FormError,
  Muted,
  PrimaryButton,
  TextField,
  Title,
  useAction,
} from '../../../src/components/Form';
import { Screen } from '../../../src/components/Screen';
import { useAuth } from '../../../src/features/auth/AuthProvider';
import { spacing, typography, useTheme } from '../../../src/theme';

/** Sessions, sign-out-everywhere, deactivation and deletion request (re-authenticated). */
export default function AccountSettingsScreen() {
  const t = useTheme();
  const { state, store } = useAuth();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [password, setPassword] = useState('');
  const email = state.status === 'signedIn' ? state.account.email : '';

  const load = useCallback(() => {
    store
      .call((api) => api.me.sessions())
      .then((r) => setSessions(r.data))
      .catch(() => setSessions([]));
  }, [store]);
  useEffect(load, [load]);

  const revoke = useAction(async (sessionId: string) => {
    await store.call((api) => api.me.revokeSession(sessionId));
    load();
  });
  const signOutAll = useAction(async () => {
    await store.call((api) => api.auth.logoutAll());
    await store.signOut();
  });
  const deactivate = useAction(async () => {
    await store.call((api) => api.me.deactivate());
    await store.signOut();
  });
  const requestDeletion = useAction(async () => {
    await store.call((api) => api.me.requestDeletion({ currentPassword: password }));
    await store.refreshAccount();
  });

  return (
    <Screen>
      <Title>Account</Title>
      <Muted>{email}</Muted>
      <Text style={[styles.section, { color: t.textPrimary }]}>Active sessions</Text>
      {sessions.map((s) => (
        <View key={s.sessionId} style={[styles.session, { borderColor: t.border }]}>
          <Text style={{ color: t.textPrimary }}>
            {s.client.deviceName ?? s.client.platform ?? 'Unknown device'}{' '}
            {s.current ? '(this device)' : ''}
          </Text>
          <Muted>Last used {new Date(s.lastUsedAt).toLocaleString()}</Muted>
          {!s.current ? (
            <PrimaryButton
              title="Revoke"
              onPress={() => revoke.run(s.sessionId)}
              variant="secondary"
            />
          ) : null}
        </View>
      ))}
      <FormError error={revoke.error} />
      <PrimaryButton
        title="Sign out everywhere"
        onPress={() => signOutAll.run()}
        variant="secondary"
        disabled={signOutAll.pending}
      />
      <Text style={[styles.section, { color: t.textPrimary }]}>Danger zone</Text>
      <Muted>
        Deactivating hides your profile until you sign in again. Deleting removes your account after
        a 30-day grace period.
      </Muted>
      <PrimaryButton
        title="Deactivate account"
        onPress={() => deactivate.run()}
        variant="secondary"
        disabled={deactivate.pending}
      />
      <TextField
        label="Confirm your password to request deletion"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />
      <FormError error={requestDeletion.error ?? deactivate.error} />
      <PrimaryButton
        title="Request account deletion"
        onPress={() => requestDeletion.run()}
        variant="danger"
        disabled={requestDeletion.pending || !password}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: {
    fontSize: typography.size.lg,
    fontWeight: typography.weight.semibold,
    marginTop: spacing.lg,
  },
  session: { borderWidth: 1, borderRadius: 10, padding: spacing.md, gap: spacing.xs },
});
