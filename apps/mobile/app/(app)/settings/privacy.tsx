import {
  type ChallengeInvitesFrom,
  type LocationVisibility,
  type PrivacySettings,
  type ProfileVisibility,
  type UpdatePrivacySettingsRequest,
} from '@quest/types';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { FormError, Muted, Title, useAction } from '../../../src/components/Form';
import { LoadingState } from '../../../src/components/LoadingState';
import { Screen } from '../../../src/components/Screen';
import { useAuth } from '../../../src/features/auth/AuthProvider';
import { radii, spacing, typography, useTheme } from '../../../src/theme';

const PROFILE: ProfileVisibility[] = ['PUBLIC', 'FOLLOWERS', 'PRIVATE'];
const LOCATION: LocationVisibility[] = ['HIDDEN', 'CITY', 'NEIGHBOURHOOD'];
const INVITES: ChallengeInvitesFrom[] = ['EVERYONE', 'FOLLOWERS', 'NOBODY'];

/** Privacy controls. Fields locked by the age policy render disabled with an explanation. */
export default function PrivacySettingsScreen() {
  const t = useTheme();
  const { store } = useAuth();
  const [settings, setSettings] = useState<PrivacySettings | null>(null);

  useEffect(() => {
    store
      .call((api) => api.profile.privacy())
      .then(setSettings)
      .catch(() => setSettings(null));
  }, [store]);

  const update = useAction(async (patch: UpdatePrivacySettingsRequest) => {
    const next = await store.call((api) => api.profile.updatePrivacy(patch));
    setSettings(next);
  });

  if (!settings) return <LoadingState label="Loading privacy settings…" />;
  const locked = new Set<string>(settings.lockedByPolicy);

  const Segment = <V extends string>({
    label,
    field,
    options,
    value,
  }: {
    label: string;
    field: string;
    options: V[];
    value: V;
  }) => (
    <View style={styles.group}>
      <Text style={[styles.label, { color: t.textSecondary }]}>{label}</Text>
      <View style={styles.segments}>
        {options.map((o) => {
          const on = o === value;
          const disabled = locked.has(field);
          return (
            <Pressable
              key={o}
              disabled={disabled}
              onPress={() => update.run({ [field]: o })}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled }}
              style={[
                styles.segment,
                {
                  backgroundColor: on ? t.primary : t.surface,
                  borderColor: on ? t.primary : t.border,
                  opacity: disabled ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={{ color: on ? t.onPrimary : t.textPrimary, fontSize: typography.size.sm }}
              >
                {o.replace('_', ' ')}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {locked.has(field) ? <Muted>Locked by the age policy for your account.</Muted> : null}
    </View>
  );

  return (
    <Screen>
      <Title>Privacy</Title>
      <Segment
        label="Who can see your profile"
        field="profileVisibility"
        options={PROFILE}
        value={settings.profileVisibility}
      />
      <Segment
        label="Location shown to others (never precise)"
        field="locationVisibility"
        options={LOCATION}
        value={settings.locationVisibility}
      />
      <Segment
        label="Who can challenge you"
        field="challengeInvitesFrom"
        options={INVITES}
        value={settings.challengeInvitesFrom}
      />
      <View style={styles.row}>
        <Switch
          value={settings.discoverable}
          disabled={locked.has('discoverable')}
          onValueChange={(v) => update.run({ discoverable: v })}
          accessibilityLabel="Discoverable by username search"
        />
        <Text style={[styles.rowText, { color: t.textPrimary }]}>
          Let people find me by username
        </Text>
      </View>
      <FormError error={update.error} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  label: { fontSize: typography.size.sm, fontWeight: typography.weight.medium },
  segments: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1 },
});
