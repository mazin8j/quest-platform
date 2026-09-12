import type { OwnProfileView } from '@quest/types';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Muted, PrimaryButton, Title } from '../../src/components/Form';
import { Screen } from '../../src/components/Screen';
import { useAuth } from '../../src/features/auth/AuthProvider';
import { spacing, typography, useTheme } from '../../src/theme';

/** Home: the signed-in profile card, Quest entry points and settings. */
export default function HomeScreen() {
  const t = useTheme();
  const { state, store } = useAuth();
  const [profile, setProfile] = useState<OwnProfileView | null>(null);

  useEffect(() => {
    store
      .call((api) => api.profile.get())
      .then(setProfile)
      .catch(() => setProfile(null));
  }, [store, state]);

  return (
    <Screen>
      <Title>{profile?.displayName ?? 'QUEST'}</Title>
      {profile?.username ? <Muted>@{profile.username}</Muted> : null}
      {profile?.bio ? <Text style={{ color: t.textPrimary }}>{profile.bio}</Text> : null}
      <Text style={[styles.interests, { color: t.textSecondary }]}>
        {profile ? `${profile.interests.length} interests selected` : ''}
      </Text>
      <View style={styles.links}>
        <Link href="/(app)/quests" style={[styles.link, { color: t.primary }]}>
          Discover Quests
        </Link>
        <Link href="/(app)/quests/mine" style={[styles.link, { color: t.primary }]}>
          My Quests
        </Link>
        <Link href="/(app)/settings/privacy" style={[styles.link, { color: t.primary }]}>
          Privacy settings
        </Link>
        <Link href="/(app)/settings/account" style={[styles.link, { color: t.primary }]}>
          Account & sessions
        </Link>
      </View>
      <PrimaryButton title="Sign out" onPress={() => void store.signOut()} variant="secondary" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  interests: { fontSize: typography.size.sm },
  links: { gap: spacing.md, paddingVertical: spacing.lg },
  link: { fontSize: typography.size.md, fontWeight: typography.weight.medium },
});
