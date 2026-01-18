'use server';

import { callOpenAIModel, default_model } from '@/lib/services/llms';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { RequestIdContext } from '@/lib/requestIdContext';
import { randomUUID } from 'crypto';
import { validateApiAuth } from '@/lib/utils/supabase/validateApiAuth';
import { logger } from '@/lib/server_utilities';

export async function POST(request: NextRequest) {
  try {
    const { prompt, userid, __requestId } = await request.json();

    // Server-side auth validation
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
      logger.error('UserId mismatch in stream-chat', {
        clientUserId: userid,
        authUserId: verifiedUserId,
        requestId: __requestId?.requestId
      });
      return NextResponse.json(
        { error: 'Session mismatch' },
        { status: 403 }
      );
    }

    if (!prompt) {
      return new Response('Missing prompt', { status: 400 });
    }

    // Set up RequestIdContext with verified values
    const requestIdData = {
      requestId: __requestId?.requestId || `api-${randomUUID()}`,
      userId: verifiedUserId,
      sessionId
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
            verifiedUserId,
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
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no', // Disable nginx buffering for SSE
      },
    });
    }); // Close RequestIdContext.run()
  } catch (error) {
    logger.error('Error in stream-chat API', { error: error instanceof Error ? error.message : String(error) });
    Sentry.captureException(error, {
      tags: { endpoint: '/api/stream-chat', method: 'POST' },
      extra: { requestId: RequestIdContext.getRequestId() },
    });
    return new Response('Internal Server Error', { status: 500 });
  }
}