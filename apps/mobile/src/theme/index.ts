import { type Theme, radii, spacing, themes, typography } from '@quest/ui';
import { useColorScheme } from 'react-native';

export { radii, spacing, themes, typography };
export type { Theme };

/** Resolves the active theme from the OS colour scheme. Components never hardcode colours. */
export function useTheme(): Theme {
  const scheme = useColorScheme();
  return scheme === 'dark' ? themes.dark : themes.light;
}
