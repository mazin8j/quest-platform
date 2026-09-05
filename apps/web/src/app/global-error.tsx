'use client';

/** Root error boundary (replaces the root layout when it fails). Must render its own <html>. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h1>QUEST is temporarily unavailable</h1>
        <button type="button" onClick={() => reset()}>
          Reload
        </button>
      </body>
    </html>
  );
}
