import { Link } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  FormError,
  Muted,
  PrimaryButton,
  TextField,
  Title,
  useAction,
} from '../../src/components/Form';
import { Screen } from '../../src/components/Screen';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { buildClientContext } from '../../src/features/auth/client-context';
import { secureStorage } from '../../src/lib/secure-storage.expo';
import { spacing, useTheme } from '../../src/theme';

export default function SignInScreen() {
  const t = useTheme();
  const { store } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const action = useAction(async () => {
    await store.signIn({ email, password, client: await buildClientContext(secureStorage) });
  });

  return (
    <Screen>
      <Title>Welcome back</Title>
      <Muted>Don&apos;t just watch life — do something.</Muted>
      <View style={styles.form}>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextField
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
        />
        <FormError error={action.error} />
        <PrimaryButton
          title={action.pending ? 'Signing in…' : 'Sign in'}
          onPress={() => action.run()}
          disabled={action.pending || !email || !password}
        />
      </View>
      <Text style={{ color: t.textSecondary }}>
        New to QUEST?{' '}
        <Link href="/(auth)/sign-up" style={{ color: t.primary }}>
          Create an account
        </Link>
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
