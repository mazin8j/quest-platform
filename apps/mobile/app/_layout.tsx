import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { LoadingState } from '../src/components/LoadingState';
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { isAuthRoute, routeForAccount } from '../src/features/onboarding/routing';
import { useTheme } from '../src/theme';

/**
 * Root layout: the AuthProvider restores the session from secure storage; AuthGate routes every
 * navigation according to the server-side account view (signed-out → auth group, onboarding
 * steps → onboarding group, otherwise the app). Deep links use the `quest://` scheme.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <AuthProvider>
          <StatusBar style="auto" />
          <AuthGate />
        </AuthProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function AuthGate() {
  const t = useTheme();
  const { state } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (state.status === 'loading') return;
    const target = routeForAccount(state.status === 'signedIn' ? state.account : null);
    const inAuthArea = isAuthRoute(pathname);
    if (state.status === 'signedOut' && !inAuthArea) router.replace(target);
    if (state.status === 'signedIn') {
      const inOnboarding =
        pathname.startsWith('/(onboarding)') ||
        pathname.startsWith('/verify-email') ||
        pathname.startsWith('/profile') ||
        pathname.startsWith('/interests');
      const needsOnboarding = target !== '/(app)';
      if (inAuthArea || (needsOnboarding && !inOnboarding) || (!needsOnboarding && inOnboarding)) {
        router.replace(target);
      }
    }
  }, [state, pathname, router]);

  if (state.status === 'loading') return <LoadingState label="Restoring your session…" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.background },
        headerTintColor: t.textPrimary,
        contentStyle: { backgroundColor: t.background },
      }}
    >
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="(onboarding)" options={{ headerShown: false }} />
      <Stack.Screen name="(app)" options={{ headerShown: false }} />
      <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
    </Stack>
  );
}
