import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/utils/supabase/middleware'
import {
  classifyHost,
  PUBLIC_PREFIXES,
  EVOLUTION_PREFIXES,
  ALWAYS_ALLOWED_PREFIXES,
} from '@/config/hostnames'

/**
 * Next.js middleware — gates the explainanything / evolution website split
 * AND refreshes the Supabase auth session for downstream handlers.
 *
 * For the website split (Option B per
 * docs/planning/split_evolution_explainanythig_into_separate_websites_20260522/):
 *  - public host → 404 any `/admin/evolution` or `/api/evolution` request.
 *  - evolution host → 404 any public-only route; redirect `/` to the dashboard.
 *  - local / preview → no hostname-based gate.
 *  - unknown host → fail-closed (404) except for ALWAYS_ALLOWED paths.
 *
 * B087 (preserved): `/api/evolution` is included in the matcher so long-running
 * evolution calls have their auth cookie refreshed by updateSession() and don't
 * silently run with an expired session.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname

  // ALWAYS_ALLOWED paths bypass the hostname gate — health/observability/log
  // ingestion must work from any host so monitoring survives DNS/domain churn.
  // They still go through updateSession so auth cookie refresh is consistent.
  if (ALWAYS_ALLOWED_PREFIXES.some((p) => path.startsWith(p))) {
    return await updateSession(request)
  }

  const tier = classifyHost(request.headers.get('host'))

  if (tier === 'unknown') {
    // Fail-closed. Log the rejected host so misconfiguration / spoofing is
    // observable. Use console.warn (Edge-runtime compatible; no @/lib/server_utilities here).
    console.warn('[middleware] unknown host rejected', {
      host: request.headers.get('host'),
      path,
    })
    return new NextResponse(null, { status: 404 })
  }

  if (tier === 'public') {
    if (EVOLUTION_PREFIXES.some((p) => path.startsWith(p))) {
      return new NextResponse(null, { status: 404 })
    }
  } else if (tier === 'evolution') {
    if (path === '/') {
      return NextResponse.redirect(new URL('/admin/evolution-dashboard', request.url))
    }
    if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
      return new NextResponse(null, { status: 404 })
    }
  }
  // tier === 'local' or 'preview' falls through with no host gate.

  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - error (error page)
     * - api/client-logs (client logging endpoint)
     * - api/traces (OTLP traces proxy endpoint)
     * - api/monitoring (Sentry tunnel endpoint)
     * B087: api/evolution intentionally included — long-running evolution calls
     *       otherwise bypass updateSession() and can run with an expired cookie.
     * The middleware function also bypasses ALWAYS_ALLOWED_PREFIXES as defense
     * in depth in case the matcher exclusions are ever loosened.
     */
    '/((?!_next/static|_next/image|favicon.ico|error|api/client-logs|api/traces|api/monitoring|api/health|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
