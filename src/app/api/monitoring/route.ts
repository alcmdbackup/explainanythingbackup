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

    // Debug logging - always log receipt of events
    console.log('[Sentry Tunnel] Received envelope, size:', envelope.length, 'bytes');

    if (!dsn) {
      // Log when DSN is missing - this is likely a configuration issue
      console.warn('[Sentry Tunnel] SENTRY_DSN not configured - dropping envelope');
      return new NextResponse(null, { status: 200 });
    }

    console.log('[Sentry Tunnel] DSN configured, forwarding to Sentry');

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

    console.log('[Sentry Tunnel] Forwarded to Sentry, response status:', response.status);

    return new NextResponse(null, { status: response.status });
  } catch (error) {
    // Log the error but don't expose details to the client
    console.error('[Sentry Tunnel] Error forwarding envelope:', error);
    return new NextResponse(null, { status: 500 });
  }
}

/**
 * Diagnostic endpoint to check Sentry configuration status.
 * Returns JSON with configuration info (safe to expose - no secrets).
 */
export async function GET() {
  const serverDsn = process.env.SENTRY_DSN;
  const clientDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  // Parse DSNs to extract project info (without exposing full DSN)
  const parseProjectId = (dsn: string | undefined) => {
    if (!dsn) return null;
    try {
      const url = new URL(dsn);
      return url.pathname.replace('/', '');
    } catch {
      return 'invalid-dsn-format';
    }
  };

  const diagnostic = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    serverDsnConfigured: !!serverDsn,
    clientDsnConfigured: !!clientDsn,
    serverProjectId: parseProjectId(serverDsn),
    clientProjectId: parseProjectId(clientDsn),
    dsnMatch: serverDsn === clientDsn,
    message: !serverDsn
      ? 'SENTRY_DSN not configured - tunnel will drop all events'
      : !clientDsn
        ? 'NEXT_PUBLIC_SENTRY_DSN not configured - client SDK will not initialize'
        : 'Both DSNs configured',
  };

  console.log('[Sentry Tunnel] Diagnostic check:', JSON.stringify(diagnostic));

  return NextResponse.json(diagnostic);
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
