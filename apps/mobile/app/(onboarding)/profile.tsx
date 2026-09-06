import { useEffect, useState } from 'react';
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

/** Username + display name (+ optional bio). Availability is checked live against the API. */
export default function ProfileOnboardingScreen() {
  const { store } = useAuth();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [availability, setAvailability] = useState<string | null>(null);

  useEffect(() => {
    if (username.trim().length < 3) {
      setAvailability(null);
      return;
    }
    const handle = setTimeout(() => {
      store
        .call((api) => api.public.usernameAvailability(username.trim()))
        .then((r) =>
          setAvailability(
            r.available
              ? null
              : r.reason === 'TAKEN'
                ? 'That username is taken'
                : r.reason === 'RESERVED'
                  ? 'That username is reserved'
                  : 'Use 3–30 lowercase letters, digits or underscores, starting with a letter',
          ),
        )
        .catch(() => setAvailability(null));
    }, 400);
    return () => clearTimeout(handle);
  }, [username, store]);

  const save = useAction(async () => {
    await store.call((api) =>
      api.profile.update({
        username: username.trim(),
        displayName: displayName.trim(),
        ...(bio.trim() ? { bio: bio.trim() } : {}),
      }),
    );
    await store.refreshAccount();
  });

  return (
    <Screen>
      <Title>Set up your profile</Title>
      <Muted>Your username is how others find you. You can change it later.</Muted>
      <View style={styles.form}>
        <TextField
          label="Username"
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase())}
          error={availability}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextField label="Display name" value={displayName} onChangeText={setDisplayName} />
        <TextField
          label="Bio (optional)"
          value={bio}
          onChangeText={setBio}
          multiline
          maxLength={300}
        />
        <FormError error={save.error} />
        <PrimaryButton
          title={save.pending ? 'Saving…' : 'Continue'}
          onPress={() => save.run()}
          disabled={save.pending || !username || !displayName || availability !== null}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({ form: { gap: spacing.md } });
