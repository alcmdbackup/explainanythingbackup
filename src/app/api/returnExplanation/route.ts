import { NextRequest, NextResponse } from 'next/server';
import { MatchMode, UserInputType, type SourceCacheFullType, type SourceChipType } from '@/lib/schemas/schemas';
import { returnExplanationLogic } from '@/lib/services/returnExplanation';
import { getOrCreateCachedSource } from '@/lib/services/sourceCache';
import { logger } from '@/lib/server_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';
import { randomUUID } from 'crypto';
import { validateApiAuth } from '@/lib/utils/supabase/validateApiAuth';

const FILE_DEBUG = true;

// Production guard: E2E_TEST_MODE cannot be enabled in production
// Exception: Allow in CI environments (GitHub Actions sets CI=true)
if (process.env.E2E_TEST_MODE === 'true' && process.env.NODE_ENV === 'production' && !process.env.CI) {
  throw new Error('E2E_TEST_MODE cannot be enabled in production');
}

export async function POST(request: NextRequest) {
  // E2E test mode bypass - use mock streaming for reliable testing
  if (process.env.E2E_TEST_MODE === 'true') {
    logger.info('[E2E DEBUG] returnExplanation API called in test mode');
    const { streamMockResponse } = await import('./test-mode');
    return streamMockResponse(request);
  }
    try {
        const { userInput, savedId, matchMode, userid, userInputType, additionalRules, existingContent, previousExplanationViewedId, previousExplanationViewedVector, sources, sourceUrls, __requestId } = await request.json();

        // Server-side auth validation - verify user is authenticated
        const authResult = await validateApiAuth(__requestId);
        if (!authResult.data) {
            return NextResponse.json(
                { error: 'Authentication required', redirectTo: '/login' },
                { status: 401 }
            );
        }

        // Use server-verified values
        const { userId: verifiedUserId, sessionId } = authResult.data;

        // Verify client-provided userId matches authenticated user (if provided)
        if (userid && userid !== verifiedUserId) {
            logger.error('UserId mismatch in returnExplanation', {
                clientUserId: userid,
                authUserId: verifiedUserId,
                requestId: __requestId?.requestId
            });
            return NextResponse.json(
                { error: 'Session mismatch' },
                { status: 403 }
            );
        }

        // Set up RequestIdContext with verified values
        const requestIdData = {
            requestId: __requestId?.requestId || `api-${randomUUID()}`,
            userId: verifiedUserId,
            sessionId
        };

        // Wrap the entire logic in RequestIdContext
        return await RequestIdContext.run(requestIdData, async () => {

        // Add debug logging for all requests
        logger.debug('API route received request', {
            userInput,
            userInputType,
            previousExplanationViewedId,
            previousExplanationViewedVector: previousExplanationViewedVector ? {
                hasValues: !!previousExplanationViewedVector.values,
                valuesType: typeof previousExplanationViewedVector.values,
                isArray: Array.isArray(previousExplanationViewedVector.values),
                valuesLength: previousExplanationViewedVector.values?.length
            } : null
        }, FILE_DEBUG);

        // Validate required parameters (userid check removed - now using verifiedUserId)
        if (!userInput) {
            return Response.json(
                { error: 'Missing required parameter: userInput is required' },
                { status: 400 }
            );
        }

        // Set defaults for optional parameters
        const finalSavedId = savedId ?? null;
        const finalMatchMode = matchMode ?? MatchMode.Normal;
        const finalUserInputType = userInputType ?? UserInputType.Query;
        const finalAdditionalRules = additionalRules ?? [];
        const finalExistingContent = existingContent ?? undefined;
        const finalPreviousExplanationViewedId = previousExplanationViewedId ?? null;
        const finalPreviousExplanationViewedVector = previousExplanationViewedVector ?? null;

        // Resolve sources - either from direct sources array or from sourceUrls
        let finalSources: SourceCacheFullType[] | undefined = sources ?? undefined;

        // If sourceUrls are provided, fetch the full source data
        if (!finalSources && sourceUrls && Array.isArray(sourceUrls) && sourceUrls.length > 0) {
            logger.debug('Fetching sources from URLs', { sourceUrls }, FILE_DEBUG);
            const resolvedSources: SourceCacheFullType[] = [];

            for (const url of sourceUrls) {
                try {
                    const cachedSource = await getOrCreateCachedSource(url, verifiedUserId);
                    if (cachedSource.source && cachedSource.source.fetch_status === 'success') {
                        resolvedSources.push(cachedSource.source);
                    } else {
                        logger.debug('Source fetch failed or not successful', { url, status: cachedSource.source?.fetch_status }, FILE_DEBUG);
                    }
                } catch (error) {
                    logger.error('Failed to fetch source from URL', { url, error });
                }
            }

            if (resolvedSources.length > 0) {
                finalSources = resolvedSources;
                logger.debug('Resolved sources from URLs', { count: resolvedSources.length }, FILE_DEBUG);
            }
        }

        // Create streaming response
        const encoder = new TextEncoder();
        
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    // Send streaming start signal
                    const startData = JSON.stringify({
                        type: 'streaming_start',
                        isStreaming: true
                    });
                    controller.enqueue(encoder.encode(`data: ${startData}\n\n`));

                    // Streaming callback that forwards content to the client
                    const streamingCallback = (content: string) => {
                        logger.debug('API route streamingCallback called', { contentLength: content?.length }, FILE_DEBUG);
                        try {
                            // Check if this is a progress event (JSON string)
                            const parsedContent = JSON.parse(content);
                            if (parsedContent.type === 'progress') {
                                // Forward progress events directly
                                logger.debug('API route forwarding progress event', parsedContent, FILE_DEBUG);
                                const data = JSON.stringify({ 
                                    type: 'progress',
                                    ...parsedContent,
                                    isStreaming: true,
                                    isComplete: false 
                                });
                                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                            } else {
                                // Regular content
                                const data = JSON.stringify({ 
                                    type: 'content',
                                    content: content,
                                    isStreaming: true, // Always true when we receive content
                                    isComplete: false 
                                });
                                controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                            }
                        } catch {
                            // If parsing fails, treat as regular content
                            const data = JSON.stringify({ 
                                type: 'content',
                                content: content,
                                isStreaming: true, // Always true when we receive content
                                isComplete: false 
                            });
                            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                        }
                    };

                            // Call returnExplanationLogic with streaming support and additional rules
        const result = await returnExplanationLogic(
                        userInput,
                        finalSavedId,
                        finalMatchMode,
                        verifiedUserId,
                        finalUserInputType,
                        finalAdditionalRules,
                        streamingCallback,
                        finalExistingContent,
                        finalPreviousExplanationViewedId,
                        finalPreviousExplanationViewedVector,
                        finalSources
                    );

                    // Add debug logging for rewrite operations
                    if (finalUserInputType === UserInputType.Rewrite) {
                        logger.debug('API route calling returnExplanationLogic with REWRITE parameters', {
                            userInput,
                            userInputType: finalUserInputType,
                            previousExplanationViewedId: finalPreviousExplanationViewedId,
                            previousExplanationViewedVector: finalPreviousExplanationViewedVector ? {
                                hasValues: !!finalPreviousExplanationViewedVector.values,
                                valuesType: typeof finalPreviousExplanationViewedVector.values,
                                isArray: Array.isArray(finalPreviousExplanationViewedVector.values),
                                valuesLength: finalPreviousExplanationViewedVector.values?.length
                            } : null
                        }, FILE_DEBUG);
                    }

                    // Send streaming end signal
                    const endData = JSON.stringify({
                        type: 'streaming_end',
                        isStreaming: false
                    });
                    controller.enqueue(encoder.encode(`data: ${endData}\n\n`));

                    // Convert finalSources to SourceChipType[] for client consumption
                    // This eliminates the race condition where client queries DB before sources are visible
                    // Strip extracted_text to reduce payload (~100KB -> ~5KB)
                    const sourceChips: SourceChipType[] = (finalSources || []).map(source => ({
                        url: source.url,
                        title: source.title,
                        favicon_url: source.favicon_url,
                        domain: source.domain,
                        status: source.fetch_status === 'success' ? 'success'
                              : source.fetch_status === 'pending' ? 'loading'
                              : 'failed',
                        error_message: source.error_message
                    }));

                    // Send final result with sources included (whether match found or generation completed)
                    const finalData = JSON.stringify({
                        type: 'complete',
                        result: { ...result, sources: sourceChips },
                        isStreaming: false,
                        isComplete: true
                    });
                    controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
                    controller.close();

                } catch (error) {
                    const errorData = JSON.stringify({
                        type: 'error',
                        error: error instanceof Error ? error.message : 'Unknown error',
                        isStreaming: false,
                        isComplete: true
                    });
                    controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });
        }); // Close RequestIdContext.run()

    } catch (error) {
        logger.error('Error in returnExplanation API', { error: error instanceof Error ? error.message : String(error) });
        return Response.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}