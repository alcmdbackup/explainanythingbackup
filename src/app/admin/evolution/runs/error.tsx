'use client';

// UI-1: Error boundary for evolution admin dashboard.
// Catches rendering errors in the evolution runs list and queue dialog.

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function EvolutionError({ error, reset }: ErrorProps): JSX.Element {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { page: 'evolution-dashboard' },
      extra: { digest: error.digest },
    });
  }, [error.digest, error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8">
      <div className="max-w-md text-center p-6 bg-[var(--surface-secondary)] rounded-book shadow-warm-lg border border-[var(--border-default)]">
        <h2 className="font-display text-xl font-semibold mb-2 text-[var(--status-error)]">
          Evolution Dashboard Error
        </h2>
        <p className="font-body text-[var(--text-secondary)] mb-4">
          Failed to load the evolution dashboard. This may be a temporary issue.
        </p>
        <button
          onClick={reset}
          className="font-ui px-4 py-2 bg-[var(--accent-gold)] text-white rounded-page hover:opacity-90 transition-scholar"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
