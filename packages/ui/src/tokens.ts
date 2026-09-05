/**
 * QUEST design tokens. Platform-neutral primitives; each app maps them to its styling system.
 * Values are the Phase 00 baseline — the UX architect refines them in later phases without
 * changing token NAMES (names are the contract).
 */
export const palette = {
  // Brand
  primary50: '#EEF4FF',
  primary500: '#2F5BFF',
  primary600: '#1F45D6',
  primary700: '#16349F',
  // Achievement accent
  accent500: '#FFB020',
  // Neutrals
  neutral0: '#FFFFFF',
  neutral50: '#F7F8FA',
  neutral100: '#EEF0F3',
  neutral300: '#C9CED6',
  neutral500: '#5F6877',
  neutral700: '#3F4652',
  neutral900: '#14181F',
  // Semantic
  success500: '#1F9D55',
  warning500: '#D97706',
  danger500: '#D9342B',
  info500: '#0E7AAF',
} as const;

export interface Theme {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  primary: string;
  primaryPressed: string;
  onPrimary: string;
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export const lightTheme: Theme = {
  background: palette.neutral0,
  surface: palette.neutral50,
  surfaceRaised: palette.neutral0,
  border: palette.neutral100,
  textPrimary: palette.neutral900,
  textSecondary: palette.neutral500,
  primary: palette.primary500,
  primaryPressed: palette.primary600,
  onPrimary: palette.neutral0,
  accent: palette.accent500,
  success: palette.success500,
  warning: palette.warning500,
  danger: palette.danger500,
  info: palette.info500,
};

export const darkTheme: Theme = {
  background: palette.neutral900,
  surface: '#1B2029',
  surfaceRaised: '#222834',
  border: '#2C3340',
  textPrimary: palette.neutral0,
  textSecondary: palette.neutral300,
  primary: '#5C82FF',
  primaryPressed: palette.primary500,
  onPrimary: palette.neutral900,
  accent: palette.accent500,
  success: '#38B26F',
  warning: '#F59E0B',
  danger: '#F05A52',
  info: '#2E9BD6',
};

export type ThemeName = 'light' | 'dark';
export const themes: Record<ThemeName, Theme> = { light: lightTheme, dark: darkTheme };

/** 4-pt spacing scale. */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radii = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const typography = {
  fontFamily: {
    sans: 'Inter, "Segoe UI", Roboto, system-ui, -apple-system, sans-serif',
    /** Arabic-capable fallback stack; global-first product principle. */
    sansArabic: '"Noto Sans Arabic", "Segoe UI", Tahoma, system-ui, sans-serif',
    mono: '"JetBrains Mono", Menlo, Consolas, monospace',
  },
  size: { xs: 12, sm: 14, md: 16, lg: 18, xl: 22, xxl: 28, display: 36 },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  lineHeight: { tight: 1.2, normal: 1.45, relaxed: 1.6 },
} as const;

export const motion = { fastMs: 120, normalMs: 200, slowMs: 320 } as const;

/** Minimum touch target per WCAG 2.5.5 / platform guidelines. */
export const a11y = { minTouchTargetPx: 44, focusRingWidthPx: 2 } as const;

/** Responsive breakpoints (px) for web/admin; mobile is single-column by design. */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280 } as const;
