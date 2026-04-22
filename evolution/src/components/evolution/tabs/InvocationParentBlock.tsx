// Phase 6: Parent block + Raw LLM collapsed section for generate_from_previous_article invocations.
// Renders above the standard execution detail on the invocation detail page.

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import {
  getInvocationVariantContextAction,
  getLLMCallsForInvocationAction,
  type InvocationVariantContext,
  type LLMCallRow,
} from '@evolution/services/invocationActions';
import { VariantParentBadge } from '@evolution/components/evolution/variant/VariantParentBadge';
import { bootstrapDeltaCI } from '@evolution/lib/shared/ratingDelta';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { dbToRating } from '@evolution/lib/shared/computeRatings';

interface Props {
  invocationId: string;
  /** execution_detail.tactic (dimension) — when present we're confident this is a variant-producing invocation. */
  tactic?: string | null;
  /** execution_detail.sourceMode if Phase 2 source-mode was recorded. Currently synthesised
   *  from detail if present; optional. */
  sourceMode?: string | null;
}

export function InvocationParentBlock({ invocationId, tactic, sourceMode }: Props): JSX.Element | null {
  const [variantCtx, setVariantCtx] = useState<InvocationVariantContext | null>(null);
  const [llmCalls, setLLMCalls] = useState<LLMCallRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getInvocationVariantContextAction(invocationId),
      getLLMCallsForInvocationAction(invocationId),
    ]).then(([vRes, lRes]) => {
      if (cancelled) return;
      if (vRes.success && vRes.data) setVariantCtx(vRes.data);
      if (lRes.success && lRes.data) setLLMCalls(lRes.data);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [invocationId]);

  if (loading) {
    return <div className="h-32 bg-[var(--surface-elevated)] rounded-book animate-pulse" />;
  }

  const hasRaw = llmCalls.length > 0;
  const hasVariantCtx = !!variantCtx;

  if (!hasRaw && !hasVariantCtx) return null;

  // Compute delta + CI using application-layer Rating via dbToRating.
  const variantRating = variantCtx?.variantMu != null && variantCtx.variantSigma != null
    ? dbToRating(variantCtx.variantMu, variantCtx.variantSigma)
    : variantCtx ? { elo: variantCtx.variantElo, uncertainty: 0 } : null;
  const parentRating = variantCtx && variantCtx.parentMu != null && variantCtx.parentSigma != null
    ? dbToRating(variantCtx.parentMu, variantCtx.parentSigma)
    : variantCtx?.parentElo != null ? { elo: variantCtx.parentElo, uncertainty: 0 } : null;

  const deltaResult = variantRating && parentRating
    ? bootstrapDeltaCI(variantRating, parentRating)
    : null;

  return (
    <>
      {hasVariantCtx && (
        <div
          className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4 space-y-3"
          data-testid="invocation-parent-block"
        >
          <h3 className="text-lg font-display font-semibold text-[var(--text-primary)]">Parent context</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm font-ui">
            {variantCtx!.parentVariantId ? (
              <div>
                <div className="text-xs text-[var(--text-muted)]">Parent</div>
                <Link
                  href={buildVariantDetailUrl(variantCtx!.parentVariantId)}
                  className="text-[var(--accent-gold)] hover:underline font-mono"
                >
                  #{variantCtx!.parentVariantId.substring(0, 8)}
                </Link>
                <div className="text-xs text-[var(--text-secondary)] mt-1">
                  ELO {parentRating ? Math.round(parentRating.elo) : '—'}
                  {parentRating?.uncertainty != null ? ` ± ${Math.round(parentRating.uncertainty)}` : ''}
                </div>
              </div>
            ) : (
              <div>
                <div className="text-xs text-[var(--text-muted)]">Parent</div>
                <span className="text-[var(--text-secondary)]">Seed · no parent</span>
              </div>
            )}
            <div>
              <div className="text-xs text-[var(--text-muted)]">Generated variant</div>
              <Link
                href={buildVariantDetailUrl(variantCtx!.variantId)}
                className="text-[var(--accent-gold)] hover:underline font-mono"
              >
                #{variantCtx!.variantId.substring(0, 8)}
              </Link>
              <div className="text-xs text-[var(--text-secondary)] mt-1">
                ELO {variantRating ? Math.round(variantRating.elo) : '—'}
                {variantRating?.uncertainty != null ? ` ± ${Math.round(variantRating.uncertainty)}` : ''}
              </div>
            </div>
            {tactic && (
              <div>
                <div className="text-xs text-[var(--text-muted)]">Tactic</div>
                <span className="font-mono">{tactic}</span>
              </div>
            )}
            {sourceMode && (
              <div>
                <div className="text-xs text-[var(--text-muted)]">Source</div>
                <span>{sourceMode === 'seed' ? 'Seed article' : "This run's top variants"}</span>
              </div>
            )}
          </div>
          {deltaResult && (
            <div className="text-sm font-ui pt-2 border-t border-[var(--border-default)]">
              <VariantParentBadge
                parentId={variantCtx!.parentVariantId}
                parentElo={parentRating?.elo ?? null}
                parentUncertainty={parentRating?.uncertainty ?? null}
                delta={deltaResult.delta}
                deltaCi={deltaResult.ci}
                crossRun={!!variantCtx!.parentRunId && variantCtx!.parentRunId !== variantCtx!.variantRunId}
                parentRunId={variantCtx!.parentRunId ?? null}
              />
            </div>
          )}
          <div className="pt-2">
            <Link
              href={`${buildVariantDetailUrl(variantCtx!.variantId)}?tab=lineage`}
              className="text-xs text-[var(--accent-gold)] hover:underline font-ui"
              data-testid="view-full-lineage-link"
            >
              View full lineage →
            </Link>
          </div>
        </div>
      )}

      {hasRaw && (
        <details
          className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4"
          data-testid="invocation-raw-llm-section"
        >
          <summary className="cursor-pointer font-ui font-medium text-[var(--text-primary)]">
            Raw LLM call{llmCalls.length > 1 ? `s (${llmCalls.length})` : ''}
          </summary>
          <div className="mt-3 text-xs font-ui text-[var(--status-warning)] border border-[var(--status-warning)] rounded px-3 py-2 mb-4">
            Raw prompts may contain source article content — do not share externally.
          </div>
          <div className="space-y-4">
            {llmCalls.map((c) => (
              <div key={c.id} className="border border-[var(--border-default)] rounded p-3 space-y-2 text-xs font-ui">
                <div className="flex flex-wrap gap-4 text-[var(--text-secondary)]">
                  {c.model && <span>Model: <code>{c.model}</code></span>}
                  {c.call_source && <span>Source: <code>{c.call_source}</code></span>}
                  {c.prompt_tokens != null && <span>Prompt tokens: {c.prompt_tokens}</span>}
                  {c.completion_tokens != null && <span>Completion tokens: {c.completion_tokens}</span>}
                </div>
                <div>
                  <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Prompt</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs bg-[var(--surface-secondary)] p-2 rounded max-h-64 overflow-auto">{c.prompt}</pre>
                </div>
                <div>
                  <div className="text-xs text-[var(--text-muted)] uppercase mb-1">Response</div>
                  <pre className="whitespace-pre-wrap font-mono text-xs bg-[var(--surface-secondary)] p-2 rounded max-h-64 overflow-auto">{c.content}</pre>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}
