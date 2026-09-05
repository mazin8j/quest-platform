import { z } from 'zod';

/** Public (browser) env for the admin console. Secrets never appear here. */
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
  if (!r.success)
    throw new Error(
      `Invalid public environment: ${r.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  return r.data;
}

export const publicEnv: PublicEnv = readPublicEnv();
