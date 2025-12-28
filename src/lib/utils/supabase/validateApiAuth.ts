/**
 * API Route Authentication Validation
 *
 * Server-side auth validation for API routes. Unlike middleware which protects
 * page routes, this validates auth for API calls and returns the verified userId.
 *
 * Key behaviors:
 * - userId: Verified from Supabase session cookies (401 if missing)
 * - sessionId: Extracted from client __requestId (warns if missing, proceeds)
 */

import { createSupabaseServerClient } from './server';
import { logger } from '@/lib/server_utilities';

interface AuthResult {
  userId: string;
  sessionId: string;  // May be 'unknown' if client didn't provide
}

interface ClientRequestId {
  requestId?: string;
  userId?: string;
  sessionId?: string;
}

type AuthSuccess = { data: AuthResult; error: null };
type AuthFailure = { data: null; error: string };
type AuthResponse = AuthSuccess | AuthFailure;

/**
 * Validates that the request comes from an authenticated user.
 *
 * @param clientRequestId - Optional __requestId from client for sessionId extraction
 * @returns Object with either { data: AuthResult, error: null } or { data: null, error: string }
 *
 * Usage:
 * ```typescript
 * const authResult = await validateApiAuth(__requestId);
 * if (authResult.error) {
 *   return NextResponse.json({ error: 'Authentication required', redirectTo: '/login' }, { status: 401 });
 * }
 * const { userId, sessionId } = authResult.data;
 * ```
 */
export async function validateApiAuth(
  clientRequestId?: ClientRequestId
): Promise<AuthResponse> {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    logger.warn('API auth validation failed', {
      error: error?.message,
      hasUser: !!user,
      requestId: clientRequestId?.requestId
    });
    return { data: null, error: 'User not authenticated' };
  }

  // Handle sessionId - warn if missing but proceed
  const sessionId = clientRequestId?.sessionId || 'unknown';
  if (sessionId === 'unknown') {
    logger.warn('Request missing sessionId', {
      userId: user.id,
      requestId: clientRequestId?.requestId
    });
  }

  return {
    data: {
      userId: user.id,
      sessionId
    },
    error: null
  };
}
