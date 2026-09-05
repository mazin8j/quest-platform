import { ApiClientError } from '@quest/api-client';

import { RoleGate } from '../components/RoleGate';
import { getApiReadiness } from '../lib/api';
import { AdminPermission, getAdminSession } from '../lib/authz/roles';

export const dynamic = 'force-dynamic';

export default async function AdminHome() {
  const session = getAdminSession();
  let readiness: { ok: boolean; summary: string };
  try {
    const r = await getApiReadiness();
    readiness = {
      ok: r.status !== 'error',
      summary: Object.entries(r.checks)
        .map(([k, v]) => `${k}:${v.status}`)
        .join(' · '),
    };
  } catch (error) {
    readiness = {
      ok: false,
      summary: error instanceof ApiClientError ? `${error.code}` : 'unreachable',
    };
  }

  return (
    <section className="q-grid">
      <div className="q-card">
        <h1>Overview</h1>
        <p className="q-muted">
          Phase 00 shell. Moderation, support and analytics surfaces arrive in later phases.
        </p>
        <p>
          API readiness:{' '}
          <span className={readiness.ok ? 'q-status-up' : 'q-status-down'}>
            {readiness.ok ? 'ready' : 'not ready'}
          </span>{' '}
          <span className="q-muted">({readiness.summary})</span>
        </p>
      </div>
      <div className="q-card">
        <h2>Your access</h2>
        <RoleGate
          session={session}
          permission={AdminPermission.VIEW_MODERATION_QUEUE}
          fallback={
            <p className="q-muted">Sign in with a staff account to see moderation tools.</p>
          }
        >
          <p>Moderation queue available.</p>
        </RoleGate>
      </div>
    </section>
  );
}
