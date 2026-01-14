import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { logger } from '@/lib/server_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';
import { randomUUID } from 'crypto';
import { fetchAndExtractSource, extractDomain, getFaviconUrl } from '@/lib/services/sourceFetcher';
import { type SourceChipType } from '@/lib/schemas/schemas';
import { validateApiAuth } from '@/lib/utils/supabase/validateApiAuth';

// Request body schema
const requestBodySchema = z.object({
  url: z.string().url(),
  userid: z.string().optional(),
  __requestId: z.object({
    requestId: z.string().optional(),
    userId: z.string().optional(),
    sessionId: z.string().optional()
  }).optional()
});

/**
 * POST /api/fetchSourceMetadata
 *
 * Fetches metadata and content from a URL for source preview.
 * Returns SourceChipType data for UI display.
 *
 * Body: { url: string, userid?: string, __requestId?: object }
 * Returns: { success: boolean, data?: SourceChipType, error?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request body
    const validationResult = requestBodySchema.safeParse(body);
    if (!validationResult.success) {
      return Response.json(
        { success: false, error: 'Invalid request: ' + validationResult.error.message },
        { status: 400 }
      );
    }

    const { url, userid, __requestId } = validationResult.data;

    // Server-side auth validation
    const authResult = await validateApiAuth(__requestId);
    if (!authResult.data) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', redirectTo: '/login' },
        { status: 401 }
      );
    }

    // Use server-verified values
    const { userId: verifiedUserId, sessionId } = authResult.data;

    // Verify client-provided userId matches authenticated user (if provided)
    if (userid && userid !== verifiedUserId) {
      logger.error('UserId mismatch in fetchSourceMetadata', {
        clientUserId: userid,
        authUserId: verifiedUserId,
        requestId: __requestId?.requestId
      });
      return NextResponse.json(
        { success: false, error: 'Session mismatch' },
        { status: 403 }
      );
    }

    // Set up request context with verified values
    const requestIdData = {
      requestId: __requestId?.requestId || `fetch-source-${randomUUID()}`,
      userId: verifiedUserId,
      sessionId
    };

    return await RequestIdContext.run(requestIdData, async () => {
      logger.info('fetchSourceMetadata: Processing', { url });

      // Fetch and extract source content
      const result = await fetchAndExtractSource(url);

      if (!result.success || !result.data) {
        const domain = extractDomain(url);
        const errorChip: SourceChipType = {
          url,
          title: null,
          favicon_url: getFaviconUrl(domain),
          domain,
          status: 'failed',
          error_message: result.error || 'Failed to fetch source'
        };

        return Response.json({
          success: false,
          data: errorChip,
          error: result.error
        });
      }

      // Build success chip
      const successChip: SourceChipType = {
        url: result.data.url,
        title: result.data.title,
        favicon_url: result.data.favicon_url,
        domain: result.data.domain,
        status: 'success',
        error_message: null
      };

      logger.info('fetchSourceMetadata: Success', {
        url,
        title: result.data.title,
        domain: result.data.domain
      });

      return Response.json({
        success: true,
        data: successChip,
        error: null
      });
    });

  } catch (error) {
    logger.error('fetchSourceMetadata: Unexpected error', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    Sentry.captureException(error, {
      tags: { endpoint: '/api/fetchSourceMetadata', method: 'POST' },
      extra: { requestId: RequestIdContext.getRequestId() },
    });

    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
