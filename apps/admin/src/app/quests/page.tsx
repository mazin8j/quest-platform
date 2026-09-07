import { ApiClientError } from '@quest/api-client';
import { type QuestSupportView, uuidSchema } from '@quest/types';
import { redirect } from 'next/navigation';

import { RoleGate } from '../../components/RoleGate';
import { AdminPermission, can } from '../../lib/authz/roles';
import { getStaffContext, questApiFor } from '../../lib/session';

export const dynamic = 'force-dynamic';

/**
 * Quest support (Phase 02): what a Quest currently is, what safety decisions were made about it,
 * and the two actions staff need today — withdraw it from visibility, or put it back to DRAFT.
 *
 * Deliberately not a moderation queue: cases, appeals and reporter workflows are Phase 14. This
 * is the minimum needed to take a dangerous Quest down while the rest is built.
 */
export default async function QuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; error?: string }>;
}) {
  const ctx = await getStaffContext();
  if (!ctx) redirect('/sign-in');
  if (!can(ctx.session, AdminPermission.VIEW_QUEST_SUPPORT)) {
    return (
      <section className="q-card">
        <h1>Quests</h1>
        <p className="q-muted">Your role does not include Quest support access.</p>
      </section>
    );
  }

  const { id, error } = await searchParams;
  let quest: QuestSupportView | null = null;
  let lookupError: string | null = error ?? null;
  const parsed = id ? uuidSchema.safeParse(id.trim()) : null;
  if (id && !parsed?.success) lookupError = 'Enter a valid Quest id (UUID).';
  if (parsed?.success) {
    try {
      quest = await questApiFor(ctx.accessToken).admin.get(parsed.data);
    } catch (e) {
      lookupError =
        e instanceof ApiClientError && e.status === 404
          ? 'No Quest with that id.'
          : 'Lookup failed.';
    }
  }

  return (
    <section className="q-grid">
      <div className="q-card">
        <h1>Quest lookup</h1>
        <form method="get" className="q-form">
          <label>
            Quest id
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

      {quest ? (
        <>
          <div className="q-card">
            <h2>{quest.title}</h2>
            <dl className="q-dl">
              <dt>Quest id</dt>
              <dd>
                <code>{quest.questId}</code>
              </dd>
              <dt>Owner</dt>
              <dd>
                <code>{quest.ownerAccountId}</code>
              </dd>
              <dt>State</dt>
              <dd>{quest.state}</dd>
              <dt>Visibility</dt>
              <dd>{quest.visibility}</dd>
              <dt>Revision</dt>
              <dd>{quest.revision}</dd>
              <dt>Content hash</dt>
              <dd>
                <code>{quest.contentHash.slice(0, 16)}…</code>
              </dd>
              <dt>Published hash</dt>
              <dd>
                {quest.publishedContentHash ? (
                  <code>{quest.publishedContentHash.slice(0, 16)}…</code>
                ) : (
                  '—'
                )}
              </dd>
              <dt>Published</dt>
              <dd>{quest.publishedAt ?? '—'}</dd>
              <dt>Attempts</dt>
              <dd>{quest.participationCount}</dd>
              {quest.suspendedAt ? (
                <>
                  <dt>Suspended</dt>
                  <dd>
                    {quest.suspendedAt} — {quest.suspensionReason}
                  </dd>
                </>
              ) : null}
            </dl>

            <RoleGate session={ctx.session} permission={AdminPermission.SANCTION_QUEST}>
              {quest.state === 'SUSPENDED' ? (
                <form method="post" action={`/api/quests/${quest.questId}/reinstate`}>
                  <button type="submit">Reinstate (returns to draft)</button>
                </form>
              ) : quest.state === 'ERASED' ? null : (
                <form
                  method="post"
                  action={`/api/quests/${quest.questId}/suspend`}
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

          <div className="q-card">
            <h2>Safety decisions</h2>
            <p className="q-muted">
              Append-only. A decision applies to one exact content hash — an edit makes it stale by
              definition, and only a decision matching the published hash can keep a Quest visible.
            </p>
            {quest.assessments.length === 0 ? (
              <p className="q-muted">No assessment has been recorded for this Quest.</p>
            ) : (
              <table className="q-table">
                <thead>
                  <tr>
                    <th scope="col">Decided</th>
                    <th scope="col">State</th>
                    <th scope="col">Content</th>
                    <th scope="col">By</th>
                    <th scope="col">Policy</th>
                    <th scope="col">Categories</th>
                    <th scope="col">Publishable</th>
                  </tr>
                </thead>
                <tbody>
                  {quest.assessments.map((a) => (
                    <tr key={a.assessmentId}>
                      <td>{a.assessedAt}</td>
                      <td>{a.state}</td>
                      <td>
                        <code>{a.contentHash.slice(0, 12)}…</code>
                        {a.contentHash === quest.publishedContentHash ? ' (published)' : ''}
                      </td>
                      <td>{a.decidedBy}</td>
                      <td>{a.policyVersion}</td>
                      <td>{a.categories.join(', ') || '—'}</td>
                      <td>{a.publishable ? 'yes' : `no — ${a.reason}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
