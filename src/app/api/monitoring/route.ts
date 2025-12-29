import { NextResponse } from 'next/server';

/**
 * Sentry Tunnel Endpoint
 *
 * This endpoint forwards Sentry events from the client to Sentry's servers.
 * By routing through our own domain, we bypass ad blockers that block
 * requests to sentry.io directly.
 *
 * The tunnel receives envelope data from the Sentry SDK and forwards it
 * to the appropriate Sentry ingest URL based on the DSN.
 *
 * @see https://docs.sentry.io/platforms/javascript/troubleshooting/#dealing-with-ad-blockers
 */
export async function POST(request: Request) {
  try {
    const envelope = await request.text();
    const dsn = process.env.SENTRY_DSN;

    if (!dsn) {
      // Silently fail if DSN is not configured (allows development without Sentry)
      return new NextResponse(null, { status: 200 });
    }

    // Parse the DSN to extract the project ID and host
    const url = new URL(dsn);
    const projectId = url.pathname.replace('/', '');
    const sentryHost = url.host;

    // Construct the Sentry ingest URL
    const sentryUrl = `https://${sentryHost}/api/${projectId}/envelope/`;

    // Forward the envelope to Sentry
    const response = await fetch(sentryUrl, {
      method: 'POST',
      body: envelope,
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
      },
    });

    return new NextResponse(null, { status: response.status });
  } catch (error) {
    // Log the error but don't expose details to the client
    console.error('[Sentry Tunnel] Error forwarding envelope:', error);
    return new NextResponse(null, { status: 500 });
  }
}

// Also handle OPTIONS for CORS preflight (though typically not needed for same-origin)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
