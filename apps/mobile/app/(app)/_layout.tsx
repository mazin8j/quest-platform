import { Stack } from 'expo-router';

import { useTheme } from '../../src/theme';

export default function AppLayout() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.background },
        headerTintColor: t.textPrimary,
        contentStyle: { backgroundColor: t.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'QUEST' }} />
      <Stack.Screen name="deletion-pending" options={{ title: 'Account deletion' }} />
      <Stack.Screen name="quests/index" options={{ title: 'Discover' }} />
      <Stack.Screen name="quests/mine" options={{ title: 'My Quests' }} />
      <Stack.Screen name="quests/new" options={{ title: 'New Quest' }} />
      <Stack.Screen name="quests/[questId]" options={{ title: 'Quest' }} />
      <Stack.Screen name="settings/privacy" options={{ title: 'Privacy' }} />
      <Stack.Screen name="settings/account" options={{ title: 'Account' }} />
    </Stack>
  );
}
