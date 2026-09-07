import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

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
import { spacing } from '../../src/theme';

export default function VerifyEmailScreen() {
  const { state, store } = useAuth();
  const [code, setCode] = useState('');
  const email = state.status === 'signedIn' ? state.account.email : '';
  const verify = useAction(async () => {
    await store.verifyEmail(code.trim());
  });
  const resend = useAction(async () => {
    await store.resendVerification();
  });
  const signOut = useAction(() => store.signOut());

  return (
    <Screen>
      <Title>Check your email</Title>
      <Muted>We sent a 6-digit code to {email}. Enter it to activate your account.</Muted>
      <View style={styles.form}>
        <TextField
          label="Verification code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          maxLength={6}
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
        />
        <FormError error={verify.error} />
        <PrimaryButton
          title={verify.pending ? 'Verifying…' : 'Verify'}
          onPress={() => verify.run()}
          disabled={verify.pending || code.trim().length !== 6}
        />
        <FormError error={resend.error} />
        <PrimaryButton
          title={resend.pending ? 'Sending…' : 'Resend code'}
          onPress={() => resend.run()}
          disabled={resend.pending}
          variant="secondary"
        />
        <PrimaryButton
          title="Use a different account"
          onPress={() => signOut.run()}
          variant="secondary"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
