/**
 * E2E Tests for Hidden Content Visibility
 *
 * Verifies that soft-deleted (hidden) explanations are not accessible
 * to regular users. This is a defense-in-depth test - RLS policies
 * provide the primary protection at the database level.
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
  let testTopicId: number | null = null;
  let serviceClient: ReturnType<typeof createServiceClient>;

  test.beforeAll(async () => {
    serviceClient = createServiceClient();

    // Create or reuse test topic (handles leftover data from prior CI runs)
    // Try insert first; if duplicate key, select existing instead
    const { data: newTopic, error: insertErr } = await serviceClient
      .from('topics')
      .insert({ topic_title: '[E2E TEST] Hidden Content Topic' })
      .select('id')
      .single();

    if (newTopic) {
      testTopicId = newTopic.id;
    } else if (insertErr?.message?.includes('duplicate key')) {
      const { data: existing } = await serviceClient
        .from('topics')
        .select('id')
        .eq('topic_title', '[E2E TEST] Hidden Content Topic')
        .single();
      if (!existing) throw new Error('Topic exists but cannot be found');
      // Clean up stale explanations
      await serviceClient.from('explanations').delete().eq('primary_topic_id', existing.id);
      testTopicId = existing.id;
    } else {
      throw new Error(`Failed to create test topic: ${insertErr?.message}`);
    }

    // Create a hidden test explanation
    const { data, error } = await serviceClient
      .from('explanations')
      .insert({
        explanation_title: '[E2E TEST] Hidden Content Test - Do Not Display',
        content: 'This content should never be visible to regular users.',
        status: 'published',
        delete_status: 'hidden',
        primary_topic_id: testTopicId,
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
    // Clean up test explanation then topic (FK order)
    if (hiddenExplanationId && serviceClient) {
      await serviceClient
        .from('explanations')
        .delete()
        .eq('id', hiddenExplanationId);
      console.log(`Cleaned up hidden test explanation ID: ${hiddenExplanationId}`);
    }
    if (testTopicId && serviceClient) {
      await serviceClient.from('topics').delete().eq('id', testTopicId);
    }
  });

  test('direct URL access to hidden explanation shows error or empty state', async ({ authenticatedPage }) => {
    // Note: If hiddenExplanationId is null, beforeAll would have thrown

    // Try to access the hidden explanation directly
    await authenticatedPage.goto(`/results?explanation_id=${hiddenExplanationId}`);

    // Wait for the page to load and check for error states
    // The app should either show an error, redirect, or show empty content
    await authenticatedPage.waitForLoadState('domcontentloaded');
    await authenticatedPage.waitForSelector('body', { state: 'visible' });

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
    await authenticatedPage.waitForLoadState('domcontentloaded');
    await authenticatedPage.waitForSelector('body', { state: 'visible' });

    // Get full page source
    const pageSource = await authenticatedPage.content();

    // The hidden content should not appear anywhere in the page source
    // This catches cases where content might be hidden with CSS but still present
    expect(pageSource).not.toContain('This content should never be visible');
  });
});
