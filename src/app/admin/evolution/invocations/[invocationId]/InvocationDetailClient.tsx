// Client-side interactive sections for the invocation detail page.
// InputVariantSection shows the input variant; OutputVariantsSection shows collapsible output variant diffs.

'use client';

import { useState } from 'react';
import { InputArticleSection } from '@evolution/components/evolution/InputArticleSection';
import { TextDiff } from '@evolution/components/evolution/TextDiff';
import { EloDeltaChip, ShortId } from '@evolution/components/evolution/agentDetails/shared';
import { ELO_SIGMA_SCALE } from '@evolution/lib/core/rating';
import { formatEloCIRange, elo95CI } from '@evolution/lib/utils/formatters';
import type { VariantBeforeAfter, InvocationFullDetail } from '@evolution/services/evolutionVisualizationActions';

// ─── Input Variant Section ───────────────────────────────────────

interface InputVariantSectionProps {
  inputVariant: InvocationFullDetail['inputVariant'];
  runId: string;
}

export function InputVariantSection({ inputVariant, runId }: InputVariantSectionProps): JSX.Element {
  if (!inputVariant) {
    return <div className="text-center py-8 text-[var(--text-muted)]">No input variant available.</div>;
  }
  return (
    <div className="space-y-3">
      <InputArticleSection
        variantId={inputVariant.variantId}
        strategy={inputVariant.strategy}
        text={inputVariant.text}
        textMissing={inputVariant.textMissing}
        elo={inputVariant.elo}
        runId={runId}
      />
      {inputVariant.elo != null && formatEloCIRange(inputVariant.elo, inputVariant.sigma != null ? inputVariant.sigma * ELO_SIGMA_SCALE : null) && (
        <div className="text-xs text-[var(--text-muted)]">
          95% CI: {formatEloCIRange(inputVariant.elo, inputVariant.sigma! * ELO_SIGMA_SCALE)}
        </div>
      )}
    </div>
  );
}

// ─── Output Variants Section ─────────────────────────────────────

interface OutputVariantsSectionProps {
  variantDiffs: VariantBeforeAfter[];
  eloHistory: Record<string, { iteration: number; elo: number }[]>;
  runId: string;
}

export function OutputVariantsSection({ variantDiffs, eloHistory, runId }: OutputVariantsSectionProps): JSX.Element {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  if (variantDiffs.length === 0) {
    return <div className="text-center py-8 text-[var(--text-muted)]">No output variants produced.</div>;
  }

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
        Output Variants ({variantDiffs.length})
      </h2>
      {variantDiffs.map(diff => {
        const isExpanded = expandedIds.has(diff.variantId);
        return (
          <div key={diff.variantId} className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book overflow-hidden">
            {/* Collapsible header bar */}
            <button
              type="button"
              onClick={() => toggleExpand(diff.variantId)}
              className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-[var(--surface-hover)] transition-colors"
            >
              <svg
                className={`w-3 h-3 text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                fill="currentColor" viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
              </svg>
              <ShortId id={diff.variantId} runId={runId} />
              <span className="text-xs text-[var(--text-muted)]">{diff.strategy}</span>
              {diff.eloDelta != null && <EloDeltaChip delta={diff.eloDelta} />}
              {diff.eloAfter != null && (
                <span className="text-xs text-[var(--text-muted)] font-mono">
                  Elo {Math.round(diff.eloAfter)}
                  {diff.sigmaAfter != null && diff.sigmaAfter > 0 && (
                    <span className="ml-1">±{elo95CI(diff.sigmaAfter * ELO_SIGMA_SCALE)}</span>
                  )}
                </span>
              )}
              {diff.parentId && (
                <span className="text-xs text-[var(--text-muted)]">
                  from <ShortId id={diff.parentId} runId={runId} />
                </span>
              )}
            </button>
            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-[var(--border-default)]">
                {diff.textMissing ? (
                  <div className="text-xs text-[var(--text-muted)] italic pt-3">Variant text not available</div>
                ) : (
                  <div className="pt-3">
                    <TextDiff original={diff.beforeText} modified={diff.afterText} />
                  </div>
                )}
                {eloHistory[diff.variantId] && eloHistory[diff.variantId].length > 1 && (
                  <div className="text-xs text-[var(--text-muted)]">
                    Elo trajectory: {eloHistory[diff.variantId].map(h => Math.round(h.elo)).join(' → ')}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

