"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Global error boundary for Next.js App Router.
 * This catches errors in the root layout and handles them gracefully.
 *
 * Note: This component MUST be a client component and MUST render its own
 * <html> and <body> tags because it replaces the entire document when
 * the root layout fails.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report the error to Sentry
    Sentry.captureException(error, {
      extra: {
        digest: error.digest,
        componentStack: (error as Error & { componentStack?: string }).componentStack,
      },
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          data-testid="global-error-container"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '2rem',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            backgroundColor: '#faf7f2', // --surface-primary
          }}
        >
          <div style={{
            maxWidth: '500px',
            textAlign: 'center',
            padding: '2rem',
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
          }}>
            <h1
              data-testid="global-error-title"
              style={{
                fontSize: '1.5rem',
                marginBottom: '1rem',
                color: '#1a1a2e',
              }}
            >
              Something went wrong
            </h1>
            <p
              data-testid="global-error-message"
              style={{
                color: '#8a8a9a', // --text-muted
                marginBottom: '1.5rem',
                lineHeight: '1.6',
              }}
            >
              We encountered an unexpected error. Our team has been notified and is working to fix the issue.
            </p>
            <button
              data-testid="global-error-reset-button"
              onClick={() => reset()}
              style={{
                padding: '0.75rem 1.5rem',
                backgroundColor: '#d4a853', // --accent-gold
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '1rem',
                fontWeight: '500',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
