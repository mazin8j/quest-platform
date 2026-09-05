import type { ExpoConfig } from 'expo/config';

/**
 * Expo app configuration. Environment-specific values come from EXPO_PUBLIC_* variables (inlined
 * at bundle time) — never from committed constants. Bundle identifiers are placeholders until the
 * store accounts exist.
 */
const appEnv = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

const config: ExpoConfig = {
  name: appEnv === 'production' ? 'QUEST' : `QUEST (${appEnv})`,
  slug: 'quest',
  version: '0.0.1',
  orientation: 'portrait',
  scheme: 'quest',
  userInterfaceStyle: 'automatic',
  platforms: ['ios', 'android'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'app.quest.mobile',
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: { package: 'app.quest.mobile' },
  plugins: ['expo-router', 'expo-secure-store'],
  experiments: { typedRoutes: true },
  extra: { appEnv },
};

export default config;
