'use client';

/** Route-level error boundary. Never renders error.message from unknown errors (may leak internals). */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="q-card" role="alert">
      <h1>Something went wrong</h1>
      <p className="q-muted">
        Please try again.{error.digest ? ` Reference: ${error.digest}` : ''}
      </p>
      <button type="button" className="q-button" onClick={() => reset()}>
        Try again
      </button>
    </section>
  );
}
