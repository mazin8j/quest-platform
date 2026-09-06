import { ApiClientError } from '@quest/api-client';
import { type AccountSupportView, uuidSchema } from '@quest/types';
import { redirect } from 'next/navigation';

import { RoleGate } from '../../components/RoleGate';
import { AdminPermission, can } from '../../lib/authz/roles';
import { apiFor, getStaffContext } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Support lookup (Phase 01): the support fields the API exposes — state, verification, roles,
 * session count, deletion status. Never the date of birth, credentials or tokens.
 */
export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; error?: string }>;
}) {
  const ctx = await getStaffContext();
  if (!ctx) redirect('/sign-in');
  if (!can(ctx.session, AdminPermission.VIEW_USER_SUPPORT_PROFILE)) {
    return (
      <section className="q-card">
        <h1>Accounts</h1>
        <p className="q-muted">Your role does not include support access.</p>
      </section>
    );
  }
  const { id, error } = await searchParams;
  let account: AccountSupportView | null = null;
  let lookupError: string | null = error ?? null;
  const parsed = id ? uuidSchema.safeParse(id.trim()) : null;
  if (id && !parsed?.success) lookupError = 'Enter a valid account id (UUID).';
  if (parsed?.success) {
    try {
      account = await apiFor(ctx.accessToken).admin.account(parsed.data);
    } catch (e) {
      lookupError =
        e instanceof ApiClientError && e.status === 404
          ? 'No account with that id.'
          : 'Lookup failed.';
    }
  }

  return (
    <section className="q-grid">
      <div className="q-card">
        <h1>Account lookup</h1>
        <form method="get" className="q-form">
          <label>
            Account id
            <input name="id" defaultValue={id ?? ''} placeholder="019203f4-…" required />
          </label>
          <button type="submit">Look up</button>
        </form>
        {lookupError ? (
          <p role="alert" className="q-status-down">
            {lookupError}
          </p>
        ) : null}
      </div>
      {account ? (
        <div className="q-card">
          <h2>{account.username ? `@${account.username}` : 'No username yet'}</h2>
          <dl className="q-dl">
            <dt>Account id</dt>
            <dd>
              <code>{account.accountId}</code>
            </dd>
            <dt>Email</dt>
            <dd>
              {account.email} {account.emailVerified ? '(verified)' : '(unverified)'}
            </dd>
            <dt>State</dt>
            <dd>{account.state}</dd>
            <dt>Age band</dt>
            <dd>{account.ageBand}</dd>
            <dt>Roles</dt>
            <dd>{account.roles.join(', ')}</dd>
            <dt>Created</dt>
            <dd>{account.createdAt}</dd>
            <dt>Last sign-in</dt>
            <dd>{account.lastLoginAt ?? '—'}</dd>
            <dt>Active sessions</dt>
            <dd>{account.activeSessionCount}</dd>
            <dt>Deletion scheduled</dt>
            <dd>{account.deletionScheduledFor ?? '—'}</dd>
            {account.suspendedAt ? (
              <>
                <dt>Suspended</dt>
                <dd>
                  {account.suspendedAt} — {account.suspensionReason}
                </dd>
              </>
            ) : null}
          </dl>
          <RoleGate session={ctx.session} permission={AdminPermission.SANCTION_USER}>
            {account.state === 'SUSPENDED' ? (
              <form method="post" action={`/api/accounts/${account.accountId}/reinstate`}>
                <button type="submit">Reinstate</button>
              </form>
            ) : account.state === 'DELETED' ? null : (
              <form
                method="post"
                action={`/api/accounts/${account.accountId}/suspend`}
                className="q-form"
              >
                <label>
                  Reason (internal)
                  <input name="reason" minLength={3} maxLength={500} required />
                </label>
                <button type="submit">Suspend</button>
              </form>
            )}
          </RoleGate>
        </div>
      ) : null}
    </section>
  );
}
