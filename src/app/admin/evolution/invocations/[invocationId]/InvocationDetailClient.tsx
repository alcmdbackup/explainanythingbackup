// Client-side interactive sections for the invocation detail page.
// Handles InputArticleSection and TextDiff tabs which require client-side state.

'use client';

import { InputArticleSection } from '@evolution/components/evolution/InputArticleSection';
import { TextDiff } from '@evolution/components/evolution/TextDiff';
import { EloDeltaChip, ShortId } from '@evolution/components/evolution/agentDetails/shared';
import type { VariantBeforeAfter, InvocationFullDetail } from '@evolution/services/evolutionVisualizationActions';

interface InvocationDetailClientProps {
  inputVariant: InvocationFullDetail['inputVariant'];
  variantDiffs: VariantBeforeAfter[];
  eloHistory: Record<string, { iteration: number; elo: number }[]>;
  runId: string;
}

export function InvocationDetailClient({
  inputVariant,
  variantDiffs,
  eloHistory,
  runId,
}: InvocationDetailClientProps): JSX.Element {
  return (
    <>
      {inputVariant && (
        <InputArticleSection
          variantId={inputVariant.variantId}
          strategy={inputVariant.strategy}
          text={inputVariant.text}
          textMissing={inputVariant.textMissing}
          elo={inputVariant.elo}
          runId={runId}
        />
      )}

      {variantDiffs.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
            Variants Produced ({variantDiffs.length})
          </h2>
          {variantDiffs.map(diff => (
            <div key={diff.variantId} className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <ShortId id={diff.variantId} runId={runId} />
                <span className="text-xs text-[var(--text-muted)]">{diff.strategy}</span>
                {diff.eloDelta != null && <EloDeltaChip delta={diff.eloDelta} />}
                {diff.eloAfter != null && (
                  <span className="text-xs text-[var(--text-muted)] font-mono">Elo {Math.round(diff.eloAfter)}</span>
                )}
                {diff.parentId && (
                  <span className="text-xs text-[var(--text-muted)]">
                    from <ShortId id={diff.parentId} runId={runId} />
                  </span>
                )}
              </div>
              {diff.textMissing ? (
                <div className="text-xs text-[var(--text-muted)] italic">Variant text not available</div>
              ) : (
                <TextDiff original={diff.beforeText} modified={diff.afterText} />
              )}
              {eloHistory[diff.variantId] && eloHistory[diff.variantId].length > 1 && (
                <div className="text-xs text-[var(--text-muted)]">
                  Elo trajectory: {eloHistory[diff.variantId].map(h => Math.round(h.elo)).join(' → ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
