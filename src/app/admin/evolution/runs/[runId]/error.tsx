'use client';

// UI-1: Error boundary for evolution run detail page.
// Catches rendering errors in the tabbed run detail view.

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RunDetailError({ error, reset }: ErrorProps): JSX.Element {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { page: 'evolution-run-detail' },
      extra: { digest: error.digest },
    });
  }, [error.digest, error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <div className="max-w-md text-center p-6 bg-[var(--surface-secondary)] rounded-book shadow-warm-lg border border-[var(--border-default)]">
        <h2 className="font-display text-xl font-semibold mb-2 text-[var(--status-error)]">
          Run Detail Error
        </h2>
        <p className="font-body text-[var(--text-secondary)] mb-4">
          Failed to load run details. The run data may be corrupted or unavailable.
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={reset}
            className="font-ui px-4 py-2 bg-[var(--accent-gold)] text-white rounded-page hover:opacity-90 transition-scholar"
          >
            Try again
          </button>
          <Link
            href="/admin/evolution/runs"
            className="font-ui px-4 py-2 border border-[var(--border-default)] text-[var(--text-secondary)] rounded-page hover:bg-[var(--surface-elevated)] transition-scholar"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
