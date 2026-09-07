import { Link } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

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
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  validateSignUp,
} from '../../src/features/auth/sign-up-form';
import { spacing, useTheme } from '../../src/theme';

/**
 * Registration: email, password, date of birth (age gate), mandatory terms/privacy acceptance and
 * age attestation; optional analytics/personalisation consents default OFF (never pre-ticked).
 */
export default function SignUpScreen() {
  const t = useTheme();
  const { store } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [personalisation, setPersonalisation] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const action = useAction(async () => {
    const result = validateSignUp({ email, password, dateOfBirth, accepted });
    setFieldErrors(result.errors);
    if (!result.ok) throw new Error('validation');
    await store.signUp({
      email,
      password,
      dateOfBirth,
      consents: {
        termsOfServiceVersion: CURRENT_TERMS_VERSION,
        privacyPolicyVersion: CURRENT_PRIVACY_VERSION,
        ageAttestation: true,
        analytics,
        personalisation,
      },
      client: await buildClientContext(secureStorage),
    });
  });

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <Title>Create your account</Title>
        <Muted>You must be at least 13 to join QUEST.</Muted>
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={fieldErrors.email}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        <TextField
          label="Password (10+ characters)"
          value={password}
          onChangeText={setPassword}
          error={fieldErrors.password}
          secureTextEntry
          autoComplete="new-password"
        />
        <TextField
          label="Date of birth (YYYY-MM-DD)"
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          error={fieldErrors.dateOfBirth}
          placeholder="2000-01-31"
          keyboardType="numbers-and-punctuation"
        />
        <View style={styles.row}>
          <Switch
            value={accepted}
            onValueChange={setAccepted}
            accessibilityLabel="Accept terms and privacy policy"
          />
          <Text
            style={[styles.rowText, { color: fieldErrors.accepted ? t.danger : t.textPrimary }]}
          >
            I accept the Terms of Service and Privacy Policy, and confirm my date of birth is
            accurate.
          </Text>
        </View>
        <View style={styles.row}>
          <Switch
            value={analytics}
            onValueChange={setAnalytics}
            accessibilityLabel="Allow product analytics"
          />
          <Text style={[styles.rowText, { color: t.textPrimary }]}>
            Help improve QUEST with anonymous usage analytics (optional).
          </Text>
        </View>
        <View style={styles.row}>
          <Switch
            value={personalisation}
            onValueChange={setPersonalisation}
            accessibilityLabel="Allow personalisation"
          />
          <Text style={[styles.rowText, { color: t.textPrimary }]}>
            Personalise my recommendations (optional).
          </Text>
        </View>
        <FormError
          error={
            action.error === 'Something went wrong. Please try again.' &&
            Object.keys(fieldErrors).length > 0
              ? null
              : action.error
          }
        />
        <PrimaryButton
          title={action.pending ? 'Creating…' : 'Create account'}
          onPress={() => action.run()}
          disabled={action.pending}
        />
        <Text style={{ color: t.textSecondary }}>
          Already have an account?{' '}
          <Link href="/(auth)/sign-in" style={{ color: t.primary }}>
            Sign in
          </Link>
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md, paddingBottom: spacing.xxl },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1 },
});
