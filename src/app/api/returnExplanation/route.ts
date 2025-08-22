import { NextRequest } from 'next/server';
import { MatchMode, UserInputType } from '@/lib/schemas/schemas';
import { returnExplanationLogic, StreamingCallback } from '@/lib/services/returnExplanation';
import { logger } from '@/lib/server_utilities';

const FILE_DEBUG = true;

export async function POST(request: NextRequest) {
    try {
        const { userInput, savedId, matchMode, userid, userInputType, additionalRules, existingContent, previousExplanationViewedId, previousExplanationViewedVector } = await request.json();
        
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
                        console.log('API route streamingCallback called with content:', content);
                        logger.debug('API route streamingCallback called with content', { content }, FILE_DEBUG);
                        try {
                            // Check if this is a progress event (JSON string)
                            const parsedContent = JSON.parse(content);
                            if (parsedContent.type === 'progress') {
                                // Forward progress events directly
                                console.log('API route forwarding progress event:', parsedContent);
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
                        } catch (parseError) {
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
                        finalPreviousExplanationViewedVector
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

    } catch (error) {
        console.error('Error in returnExplanation API:', error);
        return Response.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}