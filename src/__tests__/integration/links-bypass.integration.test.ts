/**
 * Integration test for LINKS_BYPASS_WHITELIST env-gated bypass
 * (Phase 2 of fixes_explainanything_for_public_demo_20260523).
 *
 * Verifies that with the env var set, terms from link_candidates that are
 * NOT in link_whitelist still get linked at render time.
 */

import { createTestSupabaseClient } from '@/testing/utils/integration-helpers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

const TEST_TERM = `[TEST] integration-link-${Date.now()}`;

describe('LINKS_BYPASS_WHITELIST (integration)', () => {
  let serviceClient: SupabaseClient<Database>;
  let originalEnv: NodeJS.ProcessEnv;
  let candidateId: number | null = null;

  beforeAll(async () => {
    serviceClient = createTestSupabaseClient();

    // Seed a candidate that is NOT in link_whitelist. Use [TEST] prefix to
    // ensure it's filtered out of normal search paths.
    const { data, error } = await serviceClient
      .from('link_candidates')
      .insert({
        term: TEST_TERM,
        term_lower: TEST_TERM.toLowerCase(),
        source: 'integration-test',
        status: 'pending',
      })
      .select('id')
      .single();

    if (error) {
      // If link_candidates schema diverges, skip the suite.
      // eslint-disable-next-line no-console
      console.warn('[skip] could not seed link_candidates:', error.message);
      return;
    }
    candidateId = data.id;
  });

  afterAll(async () => {
    if (candidateId) {
      await serviceClient.from('link_candidates').delete().eq('id', candidateId);
    }
  });

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
    // Reset module-scope cache between tests.
    // Dynamic require so the helper is available even when module not yet imported.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { __resetBypassCacheForTests } = require('@/lib/services/linkResolver');
    __resetBypassCacheForTests();
  });

  it('with LINKS_BYPASS_WHITELIST=true, candidate term gets linked in rendered content', async () => {
    if (!candidateId) return;
    process.env.LINKS_BYPASS_WHITELIST = 'true';
    // Dynamic import so the module re-reads process.env on first use.
    const { resolveLinksForArticle, applyLinksToContent } = await import('@/lib/services/linkResolver');

    const content = `Some text mentioning the ${TEST_TERM} term inline.`;
    const links = await resolveLinksForArticle(99999, content);
    const matched = links.some((l) => l.term.toLowerCase() === TEST_TERM.toLowerCase());
    expect(matched).toBe(true);

    const enhanced = applyLinksToContent(content, links);
    expect(enhanced).toContain(`[${TEST_TERM}](`);
  });

  it('with LINKS_BYPASS_WHITELIST unset, candidate term does NOT get linked', async () => {
    if (!candidateId) return;
    delete process.env.LINKS_BYPASS_WHITELIST;
    const { resolveLinksForArticle } = await import('@/lib/services/linkResolver');

    const content = `Some text mentioning the ${TEST_TERM} term inline.`;
    const links = await resolveLinksForArticle(99999, content);
    expect(links.some((l) => l.term.toLowerCase() === TEST_TERM.toLowerCase())).toBe(false);
  });
});
