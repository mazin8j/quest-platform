import { redirect } from 'next/navigation';

import { getStaffContext } from '../../lib/session';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  invalid: 'Enter your staff email and password.',
  'not-staff': 'This account has no staff role.',
  UNAUTHENTICATED: 'Invalid email or password.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getStaffContext()) redirect('/');
  const { error } = await searchParams;
  return (
    <section className="q-card" style={{ maxWidth: 420 }}>
      <h1>Staff sign-in</h1>
      <p className="q-muted">Use your QUEST account. Only accounts with a staff role can enter.</p>
      {error ? (
        <p role="alert" className="q-status-down">
          {MESSAGES[error] ?? 'Sign-in failed. Please try again.'}
        </p>
      ) : null}
      <form method="post" action="/api/auth/sign-in" className="q-form">
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    </section>
  );
}
