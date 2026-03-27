// Not-found page for evolution routes. Renders within the admin layout so the sidebar is preserved.
import Link from 'next/link';

export default function EvolutionNotFound(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-20 space-y-4">
      <h1 className="text-4xl font-display font-bold text-[var(--text-primary)]">404</h1>
      <p className="text-sm font-ui text-[var(--text-secondary)]">
        The evolution page you requested could not be found.
      </p>
      <Link
        href="/admin/evolution-dashboard"
        className="text-sm font-ui text-[var(--accent-gold)] hover:underline"
      >
        Back to Evolution Dashboard
      </Link>
    </div>
  );
}
