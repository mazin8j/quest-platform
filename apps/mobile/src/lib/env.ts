import { z } from 'zod';

/**
 * Public mobile environment. Expo inlines EXPO_PUBLIC_* at bundle time; values must be read via
 * literal `process.env.EXPO_PUBLIC_X` expressions (no dynamic keys). Nothing secret lives here —
 * a mobile bundle is public by definition.
 */
export const mobileEnvSchema = z.object({
  EXPO_PUBLIC_API_BASE_URL: z.url().default('http://localhost:4000'),
  EXPO_PUBLIC_APP_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
});
export type MobileEnv = z.infer<typeof mobileEnvSchema>;

/** Expo types process.env loosely; narrow explicitly so the rest of the app stays strictly typed. */
const inlined = {
  EXPO_PUBLIC_API_BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL as string | undefined,
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV as string | undefined,
};

export function readMobileEnv(source: Record<string, string | undefined> = inlined): MobileEnv {
  const r = mobileEnvSchema.safeParse(source);
  if (!r.success)
    throw new Error(
      `Invalid mobile environment: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  return r.data;
}

export const env: MobileEnv = readMobileEnv();
