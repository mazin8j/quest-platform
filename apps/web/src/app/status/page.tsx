import { ApiClientError } from '@quest/api-client';

import { getApiLiveness } from '../../lib/api';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Status' };

/** Server component: demonstrates the API client abstraction and honest error handling. */
export default async function StatusPage() {
  let result:
    | { ok: true; version: string; uptimeSeconds: number }
    | { ok: false; reason: string; correlationId?: string };
  try {
    const live = await getApiLiveness();
    result = { ok: true, version: live.version, uptimeSeconds: live.uptimeSeconds };
  } catch (error) {
    result =
      error instanceof ApiClientError
        ? {
            ok: false,
            reason: `${error.code}: ${error.message}`,
            correlationId: error.correlationId,
          }
        : { ok: false, reason: 'Unexpected error' };
  }

  return (
    <section className="q-card" aria-live="polite">
      <h1>Platform status</h1>
      {result.ok ? (
        <p>
          API <span className="q-status-up">up</span> · version {result.version} · uptime{' '}
          {result.uptimeSeconds}s
        </p>
      ) : (
        <p>
          API <span className="q-status-down">unreachable</span> · {result.reason}
          {result.correlationId ? (
            <span className="q-muted"> (ref {result.correlationId})</span>
          ) : null}
        </p>
      )}
    </section>
  );
}
