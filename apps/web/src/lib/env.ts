import { z } from 'zod';

/**
 * Public (browser-exposed) environment. Only NEXT_PUBLIC_* values may appear here; anything
 * secret belongs in server-only code and is read through a separate server schema when needed.
 * Values are inlined at build time by Next.js, so they must be referenced by literal name.
 */
export const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.url().default('http://localhost:4000'),
  NEXT_PUBLIC_APP_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
});
export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function readPublicEnv(
  source: Record<string, string | undefined> = {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  },
): PublicEnv {
  const r = publicEnvSchema.safeParse(source);
  if (!r.success) {
    throw new Error(
      `Invalid public environment: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  return r.data;
}

export const publicEnv: PublicEnv = readPublicEnv();
