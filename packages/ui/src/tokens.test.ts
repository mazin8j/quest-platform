import { describe, expect, it } from 'vitest';

import { a11y, darkTheme, lightTheme, spacing, themes } from './tokens';

/** Relative luminance per WCAG 2.x. */
function luminance(hex: string): number {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

describe('design tokens', () => {
  it('light and dark themes expose the same token names (names are the contract)', () => {
    expect(Object.keys(darkTheme).sort()).toEqual(Object.keys(lightTheme).sort());
    expect(Object.keys(themes)).toEqual(['light', 'dark']);
  });

  it('body text meets WCAG AA contrast (>= 4.5:1) in both themes', () => {
    expect(contrast(lightTheme.textPrimary, lightTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(darkTheme.textPrimary, darkTheme.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(lightTheme.textSecondary, lightTheme.background)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary buttons meet AA for large text/UI components (>= 3:1)', () => {
    expect(contrast(lightTheme.onPrimary, lightTheme.primary)).toBeGreaterThanOrEqual(3);
    expect(contrast(darkTheme.onPrimary, darkTheme.primary)).toBeGreaterThanOrEqual(3);
  });

  it('spacing is a monotonic 4-pt scale and touch targets are >= 44px', () => {
    const values = Object.values(spacing);
    expect(values.every((v) => v % 4 === 0)).toBe(true);
    expect([...values].sort((a, b) => a - b)).toEqual(values);
    expect(a11y.minTouchTargetPx).toBeGreaterThanOrEqual(44);
  });
});
