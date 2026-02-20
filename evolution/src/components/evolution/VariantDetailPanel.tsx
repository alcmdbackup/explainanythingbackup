// Variant debugging panel showing match history, parent lineage, dimension scores,
// and links to creating agent. Usable inline (VariantsTab) or as side panel (graphs).
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ShortId } from '@evolution/components/evolution/agentDetails/shared';
import {
  getVariantDetailAction,
  type VariantDetail,
} from '@evolution/services/evolutionVisualizationActions';
import { buildRunUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatCostMicro, formatScore1 } from '@evolution/lib/utils/formatters';

interface VariantDetailPanelProps {
  runId: string;
  variantId: string;
  /** Agent name from parent context (for "Jump to agent" link). */
  agentName?: string;
  /** Generation/iteration from parent context. */
  generation?: number;
}

export function VariantDetailPanel({ runId, variantId, agentName, generation }: VariantDetailPanelProps) {
  const [detail, setDetail] = useState<VariantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getVariantDetailAction(runId, variantId);
      if (result.success && result.data) {
        setDetail(result.data);
      } else {
        setError(result.error?.message ?? 'Variant not found');
      }
      setLoading(false);
    }
    load();
  }, [runId, variantId]);

  if (loading) {
    return (
      <div className="space-y-2 animate-pulse">
        <div className="h-4 bg-[var(--surface-elevated)] rounded w-1/3" />
        <div className="h-20 bg-[var(--surface-elevated)] rounded" />
      </div>
    );
  }

  if (error || !detail) {
    return <div className="text-xs text-[var(--text-muted)] p-2">{error ?? 'No detail available'}</div>;
  }

  const effectiveAgent = detail.strategy || agentName;
  const effectiveIteration = detail.iterationBorn ?? generation;

  return (
    <div className="space-y-3 text-xs" data-testid="variant-detail-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShortId id={detail.id} runId={runId} />
          <span className="font-mono text-[var(--text-muted)]">Rating {Math.round(detail.elo)}</span>
          <span className="text-[var(--text-muted)]">{detail.strategy}</span>
          <span className="text-[var(--text-muted)]">gen {detail.iterationBorn}</span>
          {detail.costUsd !== null && (
            <span className="text-[var(--accent-gold)] font-mono">{formatCostMicro(detail.costUsd)}</span>
          )}
        </div>
        {effectiveAgent && effectiveIteration !== undefined && (
          <Link
            href={`${buildRunUrl(runId)}?tab=timeline&iteration=${effectiveIteration}&agent=${effectiveAgent}`}
            className="text-[var(--accent-gold)] hover:underline"
            data-testid="jump-to-agent"
          >
            Jump to agent
          </Link>
        )}
      </div>

      {/* Dimension Scores */}
      {detail.dimensionScores && Object.keys(detail.dimensionScores).length > 0 && (
        <div data-testid="dimension-scores">
          <div className="text-[var(--text-muted)] font-ui font-medium mb-1">Dimension Scores</div>
          <div className="space-y-1">
            {Object.entries(detail.dimensionScores).map(([dim, score]) => (
              <div key={dim} className="flex items-center gap-2">
                <span className="w-24 text-[var(--text-secondary)] truncate">{dim}</span>
                <div className="flex-1 h-2 bg-[var(--surface-elevated)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent-gold)] rounded-full"
                    style={{ width: `${Math.min(100, score * 100)}%` }}
                  />
                </div>
                <span className="font-mono text-[var(--text-muted)] w-8 text-right">{formatScore1(score)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match History */}
      {detail.matches.length > 0 && (
        <div data-testid="match-history">
          <div className="text-[var(--text-muted)] font-ui font-medium mb-1">
            Match History ({detail.matches.length})
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {detail.matches.map((m, i) => (
              <div
                key={i}
                className={`flex items-center gap-2 px-2 py-1 rounded ${
                  m.won ? 'bg-[var(--status-success)]/5' : 'bg-[var(--status-error)]/5'
                }`}
              >
                <span className={m.won ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]'}>
                  {m.won ? 'W' : 'L'}
                </span>
                <span className="text-[var(--text-muted)]">vs</span>
                <ShortId id={m.opponentId} runId={runId} />
                <span className="font-mono text-[var(--text-muted)]">{(m.confidence * 100).toFixed(0)}%</span>
                {Object.keys(m.dimensionScores).length > 0 && (
                  <span className="text-[var(--text-muted)] truncate">
                    {Object.entries(m.dimensionScores).map(([d, s]) => `${d}:${s}`).join(' ')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Parent Lineage */}
      {detail.parentIds.length > 0 && (
        <div data-testid="parent-lineage">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[var(--text-muted)] font-ui font-medium">
              Parents ({detail.parentIds.length})
            </span>
            {Object.keys(detail.parentTexts).length > 0 && (
              <button
                onClick={() => setShowDiff(!showDiff)}
                className="text-[var(--accent-gold)] hover:underline"
                data-testid="toggle-diff"
              >
                {showDiff ? 'hide diff' : 'show diff'}
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {detail.parentIds.map(pid => (
              <ShortId key={pid} id={pid} runId={runId} />
            ))}
          </div>
          {showDiff && Object.entries(detail.parentTexts).map(([pid, text]) => (
            <div key={pid} className="mt-2 border border-[var(--border-default)] rounded-page p-2">
              <div className="flex items-center gap-1 mb-1">
                <span className="text-[var(--text-muted)]">Parent</span>
                <ShortId id={pid} runId={runId} />
              </div>
              <TextDiff original={text} modified={detail.text} />
            </div>
          ))}
        </div>
      )}

      {/* Content Preview */}
      <div>
        <div className="text-[var(--text-muted)] font-ui font-medium mb-1">Content Preview</div>
        <pre className="whitespace-pre-wrap text-[var(--text-secondary)] max-h-64 overflow-y-auto p-2 bg-[var(--surface-elevated)] rounded-page">
          {detail.text.substring(0, 1000)}
          {detail.text.length > 1000 && '…'}
        </pre>
      </div>
    </div>
  );
}

// ─── Simple word-level diff (no external dependency) ────────────

function TextDiff({ original, modified }: { original: string; modified: string }) {
  // Simple word-level diff without importing 'diff' library
  const origWords = original.split(/\s+/);
  const modWords = modified.split(/\s+/);

  // Find common prefix and suffix
  let prefixLen = 0;
  while (prefixLen < origWords.length && prefixLen < modWords.length && origWords[prefixLen] === modWords[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < origWords.length - prefixLen &&
    suffixLen < modWords.length - prefixLen &&
    origWords[origWords.length - 1 - suffixLen] === modWords[modWords.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const commonPrefix = origWords.slice(0, prefixLen).join(' ');
  const removedMiddle = origWords.slice(prefixLen, origWords.length - suffixLen).join(' ');
  const addedMiddle = modWords.slice(prefixLen, modWords.length - suffixLen).join(' ');
  const commonSuffix = origWords.slice(origWords.length - suffixLen).join(' ');

  return (
    <pre className="whitespace-pre-wrap text-xs max-h-40 overflow-y-auto">
      {commonPrefix && <span>{commonPrefix} </span>}
      {removedMiddle && <span className="bg-[var(--status-error)]/20 line-through">{removedMiddle} </span>}
      {addedMiddle && <span className="bg-[var(--status-success)]/20">{addedMiddle} </span>}
      {commonSuffix && <span>{commonSuffix}</span>}
    </pre>
  );
}
