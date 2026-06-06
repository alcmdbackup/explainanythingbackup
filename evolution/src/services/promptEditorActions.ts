// Server actions for the Prompt Editor's "Load recent…" picker: list recently rewritten
// articles/paragraphs (or the originals that were rewritten) so they can be selected and
// pre-populated as the editor's source text. Read-only; admin-gated via adminAction.

'use server';

import { adminAction, type AdminContext } from './adminAction';
import { stripMarkdownTitle } from '@evolution/lib/shared/computeRatings';
import { NON_DISCARDED_OR_FILTER } from '@evolution/lib/utils/variantStatus';
import type { RewriteUnit } from '@evolution/lib/promptEditor/types';

/** 'original' = the source that was fed into a rewrite; 'rewritten' = the model's output. */
export type RewriteSourceMode = 'original' | 'rewritten';

export interface RewriteSourceItem {
  id: string;
  /** Which table the row lives in — needed to fetch its full text on selection. */
  source: 'variant' | 'explanation';
  /** Short single-line preview (title or first sentence). */
  preview: string;
  /** Secondary label (agent · model, or "seed article"). */
  meta: string;
  createdAt: string;
}

export interface ListRewriteSourcesInput {
  unit: RewriteUnit;
  mode: RewriteSourceMode;
  limit?: number;
}

const PREVIEW_CHARS = 100;
// Heuristic test-content exclusion for this convenience picker: the strict strategy-join
// filter can't be applied uniformly (paragraph_original rows have no run_id), so we exclude
// rows whose text carries a [TEST.../[E2E] marker via ilike.

export const listRewriteSourcesAction = adminAction(
  'listRewriteSources',
  async (input: ListRewriteSourcesInput, ctx: AdminContext): Promise<{ items: RewriteSourceItem[] }> => {
    const { supabase } = ctx;
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);

    // Article originals = the seed articles fed into runs (evolution_explanations).
    if (input.unit === 'article' && input.mode === 'original') {
      let q = supabase
        .from('evolution_explanations')
        .select('id, title, content, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      q = q.not('title', 'ilike', '%[TEST%').not('title', 'ilike', '%[E2E]%');
      const { data, error } = await q;
      if (error) throw error;
      const items: RewriteSourceItem[] = (data ?? []).map((r) => ({
        id: r.id,
        source: 'explanation' as const,
        preview: (r.title?.trim() || stripMarkdownTitle(r.content ?? '')).slice(0, PREVIEW_CHARS),
        meta: 'seed article',
        createdAt: r.created_at,
      }));
      return { items };
    }

    // Everything else comes from evolution_variants.
    //   article/rewritten   → variant_kind='article' (non-discarded)
    //   paragraph/rewritten → variant_kind='paragraph', agent_name='paragraph_rewrite'
    //   paragraph/original  → variant_kind='paragraph', agent_name='paragraph_original'
    let q = supabase
      .from('evolution_variants')
      .select('id, variant_content, agent_name, model, created_at')
      .eq('variant_kind', input.unit)
      .or(NON_DISCARDED_OR_FILTER)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (input.unit === 'paragraph') {
      q = q.eq('agent_name', input.mode === 'original' ? 'paragraph_original' : 'paragraph_rewrite');
    }
    q = q.not('variant_content', 'ilike', '%[TEST%').not('variant_content', 'ilike', '%[E2E]%');

    const { data, error } = await q;
    if (error) throw error;
    const items: RewriteSourceItem[] = (data ?? []).map((r) => ({
      id: r.id,
      source: 'variant' as const,
      preview: stripMarkdownTitle(r.variant_content ?? '').slice(0, PREVIEW_CHARS),
      meta: [r.agent_name, r.model].filter(Boolean).join(' · ') || 'variant',
      createdAt: r.created_at,
    }));
    return { items };
  },
);

export interface GetRewriteSourceTextInput {
  id: string;
  source: 'variant' | 'explanation';
}

export const getRewriteSourceTextAction = adminAction(
  'getRewriteSourceText',
  async (input: GetRewriteSourceTextInput, ctx: AdminContext): Promise<{ text: string; title: string }> => {
    const { supabase } = ctx;
    if (input.source === 'explanation') {
      const { data, error } = await supabase
        .from('evolution_explanations')
        .select('title, content')
        .eq('id', input.id)
        .single();
      if (error) throw error;
      return { text: data.content ?? '', title: data.title ?? '' };
    }
    const { data, error } = await supabase
      .from('evolution_variants')
      .select('variant_content')
      .eq('id', input.id)
      .single();
    if (error) throw error;
    return { text: data.variant_content ?? '', title: '' };
  },
);
