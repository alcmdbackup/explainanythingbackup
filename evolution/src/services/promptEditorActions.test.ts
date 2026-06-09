// Tests for the Prompt Editor "Load recent…" picker actions: correct table/filter selection
// per (unit, mode) and text fetch by source.

import { createSupabaseServiceClient } from '@/lib/utils/supabase/server';

jest.mock('@/lib/utils/supabase/server', () => ({
  createSupabaseServiceClient: jest.fn(),
}));
jest.mock('@/lib/services/adminAuth', () => ({
  requireAdmin: jest.fn().mockResolvedValue('test-admin-user-id'),
}));
jest.mock('@/lib/logging/server/automaticServerLoggingBase', () => ({
  withLogging: jest.fn((fn: unknown) => fn),
}));
jest.mock('@/lib/serverReadRequestId', () => ({
  serverReadRequestId: jest.fn((fn: unknown) => fn),
}));

import { listRewriteSourcesAction, getRewriteSourceTextAction } from './promptEditorActions';

interface Captured {
  from: string[];
  eq: Array<{ col: string; val: unknown }>;
  not: Array<{ col: string; op: string; val: unknown }>;
}

function makeClient(result: { data: unknown; error: unknown }): { client: unknown; cap: Captured } {
  const cap: Captured = { from: [], eq: [], not: [] };
  // The query chain is thenable (awaitable). The CLIENT must NOT be thenable, or
  // `await createSupabaseServiceClient()` would unwrap it to the result.
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (col: string, val: unknown) => { cap.eq.push({ col, val }); return chain; },
    or: () => chain,
    order: () => chain,
    limit: () => chain,
    not: (col: string, op: string, val: unknown) => { cap.not.push({ col, op, val }); return chain; },
    single: () => Promise.resolve(result),
    then: (resolve: (r: unknown) => unknown) => resolve(result),
  });
  const client = { from: (t: string) => { cap.from.push(t); return chain; } };
  return { client, cap };
}

beforeEach(() => jest.clearAllMocks());

function useClient(result: { data: unknown; error: unknown }): Captured {
  const { client, cap } = makeClient(result);
  (createSupabaseServiceClient as jest.Mock).mockResolvedValue(client);
  return cap;
}

describe('listRewriteSourcesAction', () => {
  it('article/rewritten → evolution_variants, variant_kind=article, mapped preview', async () => {
    const cap = useClient({ data: [{ id: 'v1', variant_content: '# Title\n\nBody.', agent_name: 'structural_transform', model: 'gpt-4.1-nano', created_at: 't' }], error: null });
    const res = await listRewriteSourcesAction({ unit: 'article', mode: 'rewritten' });
    expect(res.success).toBe(true);
    expect(cap.from).toContain('evolution_variants');
    expect(cap.eq).toContainEqual({ col: 'variant_kind', val: 'article' });
    const items = res.success ? res.data!.items : [];
    expect(items[0]!.source).toBe('variant');
    expect(items[0]!.preview).not.toMatch(/^#/); // stripMarkdownTitle removed the heading marker
    expect(items[0]!.meta).toContain('structural_transform');
  });

  it('article/original → evolution_explanations', async () => {
    const cap = useClient({ data: [{ id: 'e1', title: 'Seed', content: 'Body text', created_at: 't' }], error: null });
    const res = await listRewriteSourcesAction({ unit: 'article', mode: 'original' });
    expect(cap.from).toContain('evolution_explanations');
    const items = res.success ? res.data!.items : [];
    expect(items[0]!.source).toBe('explanation');
    expect(items[0]!.meta).toBe('seed article');
  });

  it('paragraph/original → agent_name=paragraph_original', async () => {
    const cap = useClient({ data: [], error: null });
    await listRewriteSourcesAction({ unit: 'paragraph', mode: 'original' });
    expect(cap.eq).toContainEqual({ col: 'agent_name', val: 'paragraph_original' });
    expect(cap.eq).toContainEqual({ col: 'variant_kind', val: 'paragraph' });
  });

  it('paragraph/rewritten → agent_name=paragraph_rewrite', async () => {
    const cap = useClient({ data: [], error: null });
    await listRewriteSourcesAction({ unit: 'paragraph', mode: 'rewritten' });
    expect(cap.eq).toContainEqual({ col: 'agent_name', val: 'paragraph_rewrite' });
  });

  it('excludes test-marker rows via ilike NOT', async () => {
    const cap = useClient({ data: [], error: null });
    await listRewriteSourcesAction({ unit: 'article', mode: 'rewritten' });
    expect(cap.not.some((n) => n.op === 'ilike' && String(n.val).includes('[TEST'))).toBe(true);
  });
});

describe('getRewriteSourceTextAction', () => {
  it('explanation → returns content + title', async () => {
    useClient({ data: { title: 'T', content: 'the body' }, error: null });
    const res = await getRewriteSourceTextAction({ id: 'e1', source: 'explanation' });
    expect(res.success && res.data).toEqual({ text: 'the body', title: 'T' });
  });

  it('variant → returns variant_content', async () => {
    useClient({ data: { variant_content: 'variant body' }, error: null });
    const res = await getRewriteSourceTextAction({ id: 'v1', source: 'variant' });
    expect(res.success && res.data).toEqual({ text: 'variant body', title: '' });
  });
});
