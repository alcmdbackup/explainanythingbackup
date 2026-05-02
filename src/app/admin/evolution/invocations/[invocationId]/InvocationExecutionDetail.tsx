// Config-driven execution detail display for invocation detail pages.
// Uses DETAIL_VIEW_CONFIGS for structured rendering; falls back to raw JSON for unknown types.
'use client';

import { useState } from 'react';
import { DETAIL_VIEW_CONFIGS } from '@evolution/lib/core/detailViewConfigs';
import { ConfigDrivenDetailRenderer } from './ConfigDrivenDetailRenderer';

interface Props {
  detail: Record<string, unknown> | null;
  /** Phase 9 of develop_reflection_and_generateFromParentArticle_agent_evolution_20260430:
   *  optional filter on the DetailFieldDef[] keys, used by the wrapper agent's split
   *  Reflection Overview / Generation Overview tabs to render disjoint slices of the
   *  same `execution_detail` blob. When omitted, all fields render (legacy behavior). */
  keyFilter?: (key: string) => boolean;
}

function RawJsonDetail({ detail }: { detail: Record<string, unknown> }): JSX.Element {
  return (
    <pre
      className="mt-3 text-xs text-[var(--text-secondary)] bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page p-3 overflow-x-auto max-h-96 overflow-y-auto"
      data-testid="raw-json-detail"
    >
      {JSON.stringify(detail, null, 2)}
    </pre>
  );
}

export function InvocationExecutionDetail({ detail, keyFilter }: Props): JSX.Element {
  const [expanded, setExpanded] = useState(false);

  if (!detail) {
    return (
      <div className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4" data-testid="execution-detail">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Execution Detail</h2>
        <p className="text-xs text-[var(--text-muted)] mt-2">No execution detail available.</p>
      </div>
    );
  }

  const detailType = detail.detailType as string | undefined;
  const baseConfig = detailType ? DETAIL_VIEW_CONFIGS[detailType] : undefined;
  // Phase 9: when keyFilter is provided, slice the config to the matching DetailFieldDefs.
  // The renderer reads from `data` (the full execution_detail blob) so slicing the config
  // is the right granularity — leaves nested children intact for matching keys.
  const config = baseConfig && keyFilter
    ? baseConfig.filter((d) => keyFilter(d.key))
    : baseConfig;

  return (
    <div className="border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-4" data-testid="execution-detail">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-semibold text-[var(--text-primary)]">Execution Detail</h2>
        <div className="flex items-center gap-2">
          {detailType && (
            <span className="text-xs font-ui text-[var(--text-secondary)] bg-[var(--surface-primary)] px-2 py-0.5 rounded">
              {detailType}
            </span>
          )}
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-[var(--accent-gold)] hover:underline font-ui"
            data-testid="toggle-detail"
          >
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3">
          {config ? (
            <ConfigDrivenDetailRenderer config={config} data={detail} />
          ) : (
            <RawJsonDetail detail={detail} />
          )}
        </div>
      )}
    </div>
  );
}
