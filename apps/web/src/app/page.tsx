import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="q-grid">
      <div className="q-card">
        <h1>QUEST</h1>
        <p className="q-muted">
          Discover → Accept → Do → Prove → Achieve → Share → Challenge → Repeat.
        </p>
        <p>This is the Phase 00 application shell. Product experiences arrive phase by phase.</p>
        <Link href="/status" className="q-button">
          Platform status
        </Link>
      </div>
      <div className="q-card">
        <h2>Foundation</h2>
        <ul>
          <li>Typed API client with correlation ids</li>
          <li>Validated public environment</li>
          <li>Error boundaries and not-found handling</li>
          <li>Responsive, token-based layout</li>
        </ul>
      </div>
    </section>
  );
}
