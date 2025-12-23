import { NextRequest } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/server_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';
import { randomUUID } from 'crypto';
import { fetchAndExtractSource, extractDomain, getFaviconUrl } from '@/lib/services/sourceFetcher';
import { type SourceChipType } from '@/lib/schemas/schemas';

// Request body schema
const requestBodySchema = z.object({
  url: z.string().url(),
  userid: z.string().optional()
});

/**
 * POST /api/fetchSourceMetadata
 *
 * Fetches metadata and content from a URL for source preview.
 * Returns SourceChipType data for UI display.
 *
 * Body: { url: string, userid?: string }
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

    const { url, userid } = validationResult.data;

    // Set up request context
    const requestIdData = {
      requestId: `fetch-source-${randomUUID()}`,
      userId: userid || 'anonymous'
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

    return Response.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
