'use client';
/**
 * Account disabled page.
 * Shown to users whose accounts have been disabled by an admin.
 */

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

function AccountDisabledContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)] p-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-6">🚫</div>
        <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-4">
          Account Disabled
        </h1>
        <p className="text-[var(--text-secondary)] mb-6">
          Your account has been disabled and you cannot access this application.
        </p>
        {reason && (
          <div className="p-4 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-color)] mb-6">
            <p className="text-sm text-[var(--text-muted)]">Reason:</p>
            <p className="text-[var(--text-primary)]">{reason}</p>
          </div>
        )}
        <p className="text-sm text-[var(--text-muted)]">
          If you believe this is a mistake, please contact support.
        </p>
      </div>
    </div>
  );
}

export default function AccountDisabledPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[var(--bg-primary)]">
        <div className="text-[var(--text-muted)]">Loading...</div>
      </div>
    }>
      <AccountDisabledContent />
    </Suspense>
  );
}
