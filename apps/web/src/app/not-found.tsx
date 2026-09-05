import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="q-card">
      <h1>Page not found</h1>
      <p className="q-muted">The page you are looking for does not exist.</p>
      <Link href="/" className="q-button">
        Back home
      </Link>
    </section>
  );
}
