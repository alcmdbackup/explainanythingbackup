import { NextRequest } from 'next/server';
import { MatchMode, UserInputType, type SourceCacheFullType } from '@/lib/schemas/schemas';
import { returnExplanationLogic } from '@/lib/services/returnExplanation';
import { getOrCreateCachedSource } from '@/lib/services/sourceCache';
import { logger } from '@/lib/server_utilities';
import { RequestIdContext } from '@/lib/requestIdContext';
import { randomUUID } from 'crypto';

const FILE_DEBUG = true;

// Production guard: E2E_TEST_MODE cannot be enabled in production
if (process.env.E2E_TEST_MODE === 'true' && process.env.NODE_ENV === 'production') {
  throw new Error('E2E_TEST_MODE cannot be enabled in production');
}

export async function POST(request: NextRequest) {
  // E2E test mode bypass - use mock streaming for reliable testing
  if (process.env.E2E_TEST_MODE === 'true') {
    const { streamMockResponse } = await import('./test-mode');
    return streamMockResponse(request);
  }
    try {
        const { userInput, savedId, matchMode, userid, userInputType, additionalRules, existingContent, previousExplanationViewedId, previousExplanationViewedVector, sources, sourceUrls, __requestId } = await request.json();

        // Extract request ID data or create fallback
        const requestIdData = {
            requestId: __requestId?.requestId || `api-${randomUUID()}`,
            userId: __requestId?.userId || userid || 'anonymous',
            sessionId: __requestId?.sessionId || 'unknown'
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
        
        // Validate required parameters
        if (!userInput || !userid) {
            return Response.json(
                { error: 'Missing required parameters: userInput and userid are required' },
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
                    const cachedSource = await getOrCreateCachedSource(url, userid);
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
                        userid,
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

                    // Send final result (whether match found or generation completed)
                    const finalData = JSON.stringify({
                        type: 'complete',
                        result: result,
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