import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/utils/supabase/middleware'

export async function middleware(request: NextRequest) {
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
     * - api/health (health check endpoint for smoke tests)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|error|api/client-logs|api/traces|api/monitoring|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
