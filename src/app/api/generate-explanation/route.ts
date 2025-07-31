import { NextRequest } from 'next/server';
import { MatchMode, UserInputType } from '@/lib/schemas/schemas';
import { generateExplanationLogic } from '@/lib/services/generateExplanation';

export async function POST(request: NextRequest) {
    try {
        const { userInput, savedId, matchMode, userid, userInputType } = await request.json();
        
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

        // Create streaming response
        const encoder = new TextEncoder();
        
        const stream = new ReadableStream({
            async start(controller) {
                try {
                    // Streaming callback for LLM content
                    const streamingCallback = (content: string) => {
                        const data = JSON.stringify({ 
                            type: 'content',
                            content: content,
                            isComplete: false 
                        });
                        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                    };

                    // Call generateExplanationLogic with streaming support
                    const result = await generateExplanationLogic(
                        userInput,
                        finalSavedId,
                        finalMatchMode,
                        userid,
                        finalUserInputType,
                        streamingCallback
                    );

                    // Send final result (whether match found or generation completed)
                    const finalData = JSON.stringify({
                        type: 'complete',
                        result: result,
                        isComplete: true
                    });
                    controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
                    controller.close();

                } catch (error) {
                    const errorData = JSON.stringify({
                        type: 'error',
                        error: error instanceof Error ? error.message : 'Unknown error',
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