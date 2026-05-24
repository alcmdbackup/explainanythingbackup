/**
 * @jest-environment node
 *
 * Tests for LINKS_BYPASS_WHITELIST env-gated bypass in linkResolver.
 * When LINKS_BYPASS_WHITELIST='true', the resolver merges link_candidates into
 * the whitelist so AI-suggested terms link inline without admin approval.
 *
 * Uses save/restore env pattern (mirrors llms.test.ts) to prevent leakage
 * across tests in the same Jest worker.
 */

import { resolveLinksForArticle, applyLinksToContent, __resetBypassCacheForTests } from './linkResolver';
import { createSupabaseServerClient } from '@/lib/utils/supabase/server';
import { getSnapshot, getHeadingLinksForArticle } from './linkWhitelist';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
}));

jest.mock('./linkWhitelist', () => ({
  getSnapshot: jest.fn(),
  getHeadingLinksForArticle: jest.fn(),
}));

jest.mock('./links', () => ({
  encodeStandaloneTitleParam: jest.fn((title: string) => encodeURIComponent(title)),
}));

describe('LinkResolver — LINKS_BYPASS_WHITELIST bypass', () => {
  let originalEnv: NodeJS.ProcessEnv;

  // Track candidates-table calls separately from other DB calls (e.g.,
  // getOverridesForArticleImpl also calls createSupabaseServerClient).
  let candidatesSelectSpy: jest.Mock;

  // Helper to build a chainable Supabase mock that returns specific candidates
  // for any `.from('link_candidates')` call and empty for any other table.
  function mockSupabaseWithCandidates(candidates: Array<{ term: string; term_lower: string }>) {
    candidatesSelectSpy = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: candidates, error: null }),
    });
    const candidatesChain = { select: candidatesSelectSpy };
    const emptyChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    (createSupabaseServerClient as jest.Mock).mockResolvedValue({
      from: jest.fn((table: string) =>
        table === 'link_candidates' ? candidatesChain : emptyChain,
      ),
    });
  }

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.clearAllMocks();
    __resetBypassCacheForTests();
    // Default: empty whitelist snapshot so the bypass branch's effect is visible.
    (getSnapshot as jest.Mock).mockResolvedValue({ data: {}, version: 1 });
    (getHeadingLinksForArticle as jest.Mock).mockResolvedValue([]);
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetBypassCacheForTests();
  });

  it('links a non-whitelisted term when LINKS_BYPASS_WHITELIST=true', async () => {
    process.env.LINKS_BYPASS_WHITELIST = 'true';
    mockSupabaseWithCandidates([{ term: 'transistor', term_lower: 'transistor' }]);

    const links = await resolveLinksForArticle('1', 'A transistor is the basic building block.');
    expect(links.some((l) => l.term.toLowerCase() === 'transistor')).toBe(true);
  });

  it('does NOT link a non-whitelisted term when LINKS_BYPASS_WHITELIST is unset', async () => {
    delete process.env.LINKS_BYPASS_WHITELIST;
    mockSupabaseWithCandidates([{ term: 'transistor', term_lower: 'transistor' }]);

    const links = await resolveLinksForArticle('1', 'A transistor is the basic building block.');
    expect(links.some((l) => l.term.toLowerCase() === 'transistor')).toBe(false);
  });

  it('does NOT link when LINKS_BYPASS_WHITELIST=false (string)', async () => {
    process.env.LINKS_BYPASS_WHITELIST = 'false';
    mockSupabaseWithCandidates([{ term: 'transistor', term_lower: 'transistor' }]);

    const links = await resolveLinksForArticle('1', 'A transistor is the basic building block.');
    expect(links.some((l) => l.term.toLowerCase() === 'transistor')).toBe(false);
  });

  it('uses term as standalone_title (clicks search/generate for the term)', async () => {
    process.env.LINKS_BYPASS_WHITELIST = 'true';
    mockSupabaseWithCandidates([{ term: 'GPU', term_lower: 'gpu' }]);

    const links = await resolveLinksForArticle('1', 'A GPU is parallel.');
    const enhanced = applyLinksToContent('A GPU is parallel.', links);
    // applyLinksToContent injects markdown links: [term](/standalone-title?t=encoded+title)
    expect(enhanced).toMatch(/\[GPU\]\(\/standalone-title\?t=GPU\)/);
  });

  it('whitelist entries take precedence over candidates on collision', async () => {
    process.env.LINKS_BYPASS_WHITELIST = 'true';
    (getSnapshot as jest.Mock).mockResolvedValue({
      data: {
        gpu: { canonical_term: 'Graphics Processing Unit', standalone_title: 'Introduction to GPUs' },
      },
      version: 1,
    });
    mockSupabaseWithCandidates([{ term: 'GPU', term_lower: 'gpu' }]);

    const links = await resolveLinksForArticle('1', 'A GPU is parallel.');
    const enhanced = applyLinksToContent('A GPU is parallel.', links);
    // Whitelist's standalone_title wins, not the candidate's degenerate self-title.
    expect(enhanced).toContain('Introduction%20to%20GPUs');
    expect(enhanced).not.toMatch(/\?t=GPU\)/);
  });

  it('TTL cache hit avoids the candidates DB call on second resolution', async () => {
    process.env.LINKS_BYPASS_WHITELIST = 'true';
    mockSupabaseWithCandidates([{ term: 'EUV', term_lower: 'euv' }]);

    await resolveLinksForArticle('1', 'EUV lithography...');
    expect(candidatesSelectSpy).toHaveBeenCalledTimes(1);
    await resolveLinksForArticle('2', 'EUV process...');
    // Cache hit: second resolution does NOT query link_candidates again.
    expect(candidatesSelectSpy).toHaveBeenCalledTimes(1);
  });

  it('honors __resetBypassCacheForTests between tests', async () => {
    process.env.LINKS_BYPASS_WHITELIST = 'true';
    mockSupabaseWithCandidates([{ term: 'CUDA', term_lower: 'cuda' }]);

    await resolveLinksForArticle('1', 'CUDA enables GPUs.');
    expect(candidatesSelectSpy).toHaveBeenCalledTimes(1);
    __resetBypassCacheForTests();
    await resolveLinksForArticle('2', 'CUDA enables GPUs.');
    // After reset, the cache is empty so the second resolution DOES re-query.
    expect(candidatesSelectSpy).toHaveBeenCalledTimes(2);
  });
});
