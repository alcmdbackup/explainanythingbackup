'use client';

/**
 * Test page that intentionally throws an error to trigger global-error.tsx.
 * Used for E2E testing of the global error boundary and Sentry integration.
 *
 * This page is in the (debug) folder and should only be used in development/testing.
 */

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function ErrorThrower() {
  const searchParams = useSearchParams();
  const shouldThrow = searchParams.get('throw') === 'true';
  const [hasThrown, setHasThrown] = useState(false);

  useEffect(() => {
    if (shouldThrow && !hasThrown) {
      setHasThrown(true);
      // Throw error in next tick to ensure React can catch it
      throw new Error('Test error for global-error.tsx E2E test');
    }
  }, [shouldThrow, hasThrown]);

  if (shouldThrow) {
    // Also throw during render to ensure error boundary catches it
    throw new Error('Test error for global-error.tsx E2E test');
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h1>Global Error Test Page</h1>
      <p>Add <code>?throw=true</code> to the URL to trigger an error.</p>
      <p>
        <a href="/test-global-error?throw=true" style={{ color: 'blue', textDecoration: 'underline' }}>
          Click here to throw an error
        </a>
      </p>
    </div>
  );
}

export default function TestGlobalErrorPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ErrorThrower />
    </Suspense>
  );
}
