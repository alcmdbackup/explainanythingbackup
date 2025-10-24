'use server';

import { callOpenAIModel, default_model } from '@/lib/services/llms';
import { NextRequest } from 'next/server';
import { RequestIdContext } from '@/lib/requestIdContext';
import { randomUUID } from 'crypto';

export async function POST(request: NextRequest) {
  try {
    const { prompt, userid, __requestId } = await request.json();

    if (!prompt || !userid) {
      return new Response('Missing prompt or userid', { status: 400 });
    }

    // Extract request ID data or create fallback
    const requestIdData = __requestId || {
      requestId: `api-${randomUUID()}`,
      userId: userid || 'anonymous'
    };

    // Wrap the entire logic in RequestIdContext
    return await RequestIdContext.run(requestIdData, async () => {

    // Create a readable stream
    const encoder = new TextEncoder();
    let streamedText = '';
    
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Use callOpenAIModel with streaming
          await callOpenAIModel(
            prompt,
            "stream-chat-api",
            userid,
            default_model,
            true,
            (text: string) => {
              // Send incremental updates
              streamedText = text;
              const data = JSON.stringify({ text, isComplete: false });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
            },
            null,
            null
          );
          
          // Send completion signal
          const finalData = JSON.stringify({ text: streamedText, isComplete: true });
          controller.enqueue(encoder.encode(`data: ${finalData}\n\n`));
          controller.close();
        } catch (error) {
          const errorData = JSON.stringify({ 
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
    }); // Close RequestIdContext.run()
  } catch (error) {
    return new Response('Internal Server Error', { status: 500 });
  }
}