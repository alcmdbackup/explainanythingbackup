// "Diff vs parent" tab body for the variant detail page. Fetches the variant + its primary
// parent's text and renders a side-by-side word diff (Parent left / This variant right).
// Paragraph variants show a "Paragraph N" header; parentless variants (seed article /
// original-slot paragraph) render an explicit empty state.
// enable_side_by_side_variant_comparisons_vs_parent_20260531.

'use client';

import { useEffect, useState } from 'react';
import { getVariantParentDiffAction, type VariantParentDiff } from '@evolution/services/variantDetailActions';
import { SideBySideWordDiff } from '@evolution/components/evolution/visualizations/SideBySideWordDiff';

interface VariantParentDiffTabProps {
  variantId: string;
}

export function VariantParentDiffTab({ variantId }: VariantParentDiffTabProps): JSX.Element {
  const [diff, setDiff] = useState<VariantParentDiff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getVariantParentDiffAction(variantId)
      .then((res) => {
        if (!active) return;
        setDiff(res.success ? (res.data ?? null) : null);
        setLoading(false);
      })
      .catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [variantId]);

  if (loading) {
    return <div className="h-32 bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  }

  if (!diff) {
    return (
      <p className="text-sm font-ui text-[var(--text-secondary)]" data-testid="variant-parent-diff-empty">
        Variant not found.
      </p>
    );
  }

  const { variantKind, parent, crossRun, slotContext, variantContent } = diff;

  const header = slotContext ? (
    <div className="text-sm font-ui font-medium text-[var(--text-primary)]" data-testid="variant-parent-diff-slot">
      Paragraph {slotContext.paragraphNumber}
    </div>
  ) : null;

  if (!parent) {
    const message = variantKind === 'paragraph'
      ? 'Original paragraph — this is the source paragraph, no parent to diff against.'
      : 'Seed · no parent.';
    return (
      <div className="space-y-3" data-testid="variant-parent-diff">
        {header}
        <div
          className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 text-sm font-ui text-[var(--text-secondary)]"
          data-testid="variant-parent-diff-empty"
        >
          {message}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="variant-parent-diff">
      {(header || crossRun) && (
        <div className="flex items-center gap-2 flex-wrap">
          {header}
          {crossRun && (
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-ui font-medium border"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--accent-copper) 20%, transparent)',
                color: 'var(--accent-copper)',
                borderColor: 'color-mix(in srgb, var(--accent-copper) 30%, transparent)',
              }}
              data-testid="variant-parent-diff-cross-run"
            >
              other run{parent.runId ? ` ${parent.runId.substring(0, 6)}` : ''}
            </span>
          )}
        </div>
      )}
      <SideBySideWordDiff parent={parent.content} variant={variantContent} />
    </div>
  );
}
