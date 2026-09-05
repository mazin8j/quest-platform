import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useTheme } from '@/theme';

/**
 * Root navigation layout (expo-router). Deep links use the `quest://` scheme declared in
 * app.config.ts; route files under app/ define the URL structure automatically.
 */
export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.background },
            headerTintColor: t.textPrimary,
            contentStyle: { backgroundColor: t.background },
          }}
        >
          <Stack.Screen name="index" options={{ title: 'QUEST' }} />
          <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
        </Stack>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
