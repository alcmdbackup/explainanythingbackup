import { NextRequest, NextResponse } from 'next/server';
import { validateApiAuth } from '@/lib/utils/supabase/validateApiAuth';
import { logger } from '@/lib/server_utilities';

/**
 * Test-only API route for AI Suggestions Pipeline
 *
 * This route exists to enable E2E testing of the AI suggestions feature.
 * Server actions use RSC wire format which cannot be mocked by Playwright.
 * This API route returns standard JSON, allowing Playwright to intercept and mock responses.
 *
 * IMPORTANT: Production code uses runAISuggestionsPipelineAction (server action).
 * This API route is only called from E2E test helpers.
 */
export async function POST(request: NextRequest) {
  try {
    const { currentContent, userPrompt, sessionData, __requestId } = await request.json();

    // Server-side auth validation (E2E tests authenticate before running)
    const authResult = await validateApiAuth(__requestId);
    if (authResult.error) {
      logger.warn('runAISuggestionsPipeline: Auth validation failed', {
        error: authResult.error
      });
      return NextResponse.json(
        { success: false, error: 'Authentication required', redirectTo: '/login' },
        { status: 401 }
      );
    }

    if (!currentContent || !userPrompt) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: currentContent and userPrompt' },
        { status: 400 }
      );
    }

    // Import dynamically to avoid client-side bundling issues
    const { getAndApplyAISuggestions } = await import('@/editorFiles/aiSuggestion');

    // Prepare session data with user prompt
    const sessionRequestData = sessionData
      ? {
          ...sessionData,
          user_prompt: userPrompt.trim(),
        }
      : undefined;

    const result = await getAndApplyAISuggestions(
      currentContent,
      null, // editorRef not needed for API route
      undefined, // onProgress callback not supported
      sessionRequestData,
      authResult.data?.userId // Pass userId for LLM tracking
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('runAISuggestionsPipeline API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'AI suggestions pipeline failed',
      },
      { status: 500 }
    );
  }
}
