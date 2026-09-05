/** Route-level loading state (Suspense fallback) — the loading-state pattern for the web app. */
export default function Loading() {
  return (
    <section className="q-card" aria-busy="true" aria-live="polite">
      <p className="q-muted">Loading…</p>
    </section>
  );
}
