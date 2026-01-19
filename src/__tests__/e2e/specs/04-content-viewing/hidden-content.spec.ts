/**
 * E2E Tests for Hidden Content Visibility
 *
 * Verifies that soft-deleted (hidden) explanations are not accessible
 * to regular users. This is a defense-in-depth test - RLS policies
 * provide the primary protection at the database level.
 *
 * @tags non-critical
 */
import { test, expect } from '../../fixtures/auth';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

/**
 * Creates a service client that bypasses RLS for test setup/cleanup.
 */
function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for test setup');
  }

  return createClient(url, serviceKey);
}

test.describe('Hidden Content Visibility', () => {
  // Mark as non-critical - RLS provides primary protection
  test.describe.configure({ retries: 1 });
  test.setTimeout(30000);

  let hiddenExplanationId: number | null = null;
  let serviceClient: ReturnType<typeof createServiceClient>;

  test.beforeAll(async () => {
    serviceClient = createServiceClient();

    // First, get or create a test topic (required for explanations)
    const { data: topic, error: topicError } = await serviceClient
      .from('topics')
      .upsert(
        {
          topic_title: 'test-e2e-hidden-content-topic',
          topic_description: 'Topic for hidden content E2E tests',
        },
        { onConflict: 'topic_title' }
      )
      .select('id')
      .single();

    if (topicError || !topic?.id) {
      throw new Error(`Failed to get or create test topic: ${topicError?.message || 'No topic ID'}`);
    }

    // Create a hidden test explanation using the topic
    const { data, error } = await serviceClient
      .from('explanations')
      .insert({
        explanation_title: '[E2E TEST] Hidden Content Test - Do Not Display',
        content: 'This content should never be visible to regular users.',
        status: 'published',
        delete_status: 'hidden',
        primary_topic_id: topic.id,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create hidden test explanation: ${error.message}`);
    }

    hiddenExplanationId = data?.id ?? null;
    if (!hiddenExplanationId) {
      throw new Error('Failed to get ID for created hidden test explanation');
    }
    console.log(`Created hidden test explanation ID: ${hiddenExplanationId}`);
  });

  test.afterAll(async () => {
    // Clean up test explanation
    if (hiddenExplanationId && serviceClient) {
      await serviceClient
        .from('explanations')
        .delete()
        .eq('id', hiddenExplanationId);
      console.log(`Cleaned up hidden test explanation ID: ${hiddenExplanationId}`);
    }
  });

  test('direct URL access to hidden explanation shows error or empty state', async ({ authenticatedPage }) => {
    // Note: If hiddenExplanationId is null, beforeAll would have thrown

    // Try to access the hidden explanation directly
    await authenticatedPage.goto(`/results?explanation_id=${hiddenExplanationId}`);

    // Wait for the page to load and check for error states
    // The app should either show an error, redirect, or show empty content
    await authenticatedPage.waitForLoadState('networkidle');

    // Check various indicators that content is not displayed
    const pageContent = await authenticatedPage.content();

    // The hidden explanation title should not appear in page content
    expect(pageContent).not.toContain('Hidden Content Test - Do Not Display');

    // Check for common error/not-found indicators
    const hasErrorIndicator =
      pageContent.includes('not found') ||
      pageContent.includes('Not Found') ||
      pageContent.includes('error') ||
      pageContent.includes('unavailable') ||
      pageContent.includes('does not exist') ||
      // Or the page redirected/shows empty state
      !pageContent.includes('This content should never be visible');

    expect(hasErrorIndicator).toBe(true);
  });

  test('hidden explanation content is not revealed in page source', async ({ authenticatedPage }) => {
    // Note: If hiddenExplanationId is null, beforeAll would have thrown

    // Navigate to the hidden explanation
    await authenticatedPage.goto(`/results?explanation_id=${hiddenExplanationId}`);
    await authenticatedPage.waitForLoadState('networkidle');

    // Get full page source
    const pageSource = await authenticatedPage.content();

    // The hidden content should not appear anywhere in the page source
    // This catches cases where content might be hidden with CSS but still present
    expect(pageSource).not.toContain('This content should never be visible');
  });
});
