import { NextRequest } from 'next/server';
import { MatchMode, UserInputType } from '@/lib/schemas/schemas';
import { generateExplanationLogic, StreamingCallback } from '@/lib/services/generateExplanation';

export async function POST(request: NextRequest) {
    try {
        const { userInput, savedId, matchMode, userid, userInputType, additionalRules } = await request.json();
        
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
                        const data = JSON.stringify({ 
                            type: 'content',
                            content: content,
                            isStreaming: true, // Always true when we receive content
                            isComplete: false 
                        });
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    };

                    // Call generateExplanationLogic with streaming support and additional rules
                    const result = await generateExplanationLogic(
                        userInput,
                        finalSavedId,
                        finalMatchMode,
                        userid,
                        finalUserInputType,
                        finalAdditionalRules,
                        streamingCallback
                    );

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
        console.error('Error in generate-explanation API:', error);
        return Response.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}