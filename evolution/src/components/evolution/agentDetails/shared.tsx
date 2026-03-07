// Shared UI primitives for agent execution detail views.
// Provides consistent styling following the Midnight Scholar design system.

import { formatCostMicro } from '@evolution/lib/utils/formatters';
import type { VariantBeforeAfter } from '@evolution/services/evolutionVisualizationActions';

const SUCCESS_STATUSES = new Set(['success', 'ACCEPT']);
const WARNING_STATUSES = new Set(['format_rejected', 'parse_failed']);
const ERROR_STATUSES = new Set(['error', 'REJECT']);

function statusColorClass(status: string): string {
  if (SUCCESS_STATUSES.has(status)) return 'bg-[var(--status-success)]/15 text-[var(--status-success)]';
  if (WARNING_STATUSES.has(status)) return 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]';
  if (ERROR_STATUSES.has(status)) return 'bg-[var(--status-error)]/15 text-[var(--status-error)]';
  return 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]';
}

/** Status badge with color-coded background. */
export function StatusBadge({ status }: { status: string }): JSX.Element {
  return (
    <span className={`px-2 py-0.5 rounded-page text-xs font-ui font-medium ${statusColorClass(status)}`}>
      {status}
    </span>
  );
}

/** Section header for detail views. */
export function DetailSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-3">
      <div className="text-xs font-ui font-medium text-[var(--text-secondary)] mb-1.5 uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}

/** Key-value metric display. */
export function Metric({ label, value }: { label: string; value: React.ReactNode }): JSX.Element {
  return (
    <div>
      <div className="text-[var(--text-muted)] text-xs font-ui">{label}</div>
      <div className="font-mono text-xs">{value}</div>
    </div>
  );
}

/** Cost display formatted to 4 decimal places (sub-cent precision for individual LLM calls). */
export function CostDisplay({ cost }: { cost: number }): JSX.Element {
  return <span className="font-mono text-xs">{formatCostMicro(cost)}</span>;
}

/** Renders a Record<string, number> as inline dimension: score badges. */
export function DimensionScoresDisplay({
  scores,
  className = '',
}: {
  scores: Record<string, number>;
  className?: string;
}): JSX.Element {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {Object.entries(scores).map(([dim, score]) => (
        <span key={dim} className="text-[var(--text-muted)] font-ui text-xs">
          {dim}: <span className="font-mono">{score.toFixed(1)}</span>
        </span>
      ))}
    </div>
  );
}

/** Truncated ID display (first 8 chars). Optionally clickable when href, runId, or onClick is provided.
 *  When runId is provided, auto-constructs a link to the variant detail on the run page. */
export function ShortId({ id, runId, href, onClick }: {
  id: string;
  /** When provided, auto-constructs variant URL: /admin/evolution/runs/{runId}?tab=variants&variant={id} */
  runId?: string;
  href?: string;
  onClick?: () => void;
}): JSX.Element {
  const effectiveHref = href ?? (runId ? `/admin/evolution/runs/${runId}?tab=variants&variant=${id}` : undefined);
  if (effectiveHref) {
    return (
      <a
        href={effectiveHref}
        className="font-mono text-xs text-[var(--accent-gold)] hover:underline cursor-pointer"
        title={id}
        onClick={(e) => {
          if (onClick) {
            e.preventDefault();
            onClick();
          }
        }}
      >
        {id.substring(0, 8)}
      </a>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className="font-mono text-xs text-[var(--accent-gold)] hover:underline cursor-pointer"
        title={id}
        onClick={onClick}
      >
        {id.substring(0, 8)}
      </button>
    );
  }
  return <span className="font-mono text-xs text-[var(--accent-gold)]" title={id}>{id.substring(0, 8)}</span>;
}

function eloDeltaColorVar(delta: number): string {
  if (delta > 0) return '--status-success';
  if (delta < 0) return '--status-error';
  return '--text-secondary';
}

/** Inline Elo delta badge: green for positive, red for negative, neutral for zero. */
export function EloDeltaChip({ delta }: { delta: number }): JSX.Element {
  const sign = delta > 0 ? '+' : '';
  const colorVar = eloDeltaColorVar(delta);
  return (
    <span
      className={`text-xs font-mono bg-[var(${colorVar})]/10 text-[var(${colorVar})] px-1.5 py-0.5 rounded`}
      data-testid="elo-delta-chip"
    >
      {sign}{Math.round(delta)}
    </span>
  );
}

/** Renders a single variant's before/after diff with metadata. */
export function VariantDiffSection({ diff, eloHistory, runId }: {
  diff: VariantBeforeAfter;
  eloHistory?: { iteration: number; elo: number }[];
  runId?: string;
}): JSX.Element {
  return (
    <div className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded-book p-3 space-y-2" data-testid="variant-diff-section">
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
        <div className="text-xs">
          {/* Lazy-load TextDiff to avoid pulling diff library into SSR bundle */}
          <pre className="whitespace-pre-wrap font-mono p-2 bg-[var(--surface-primary)] rounded max-h-[200px] overflow-y-auto text-[var(--text-secondary)]">
            {diff.afterText.length > 300 ? diff.afterText.slice(0, 300) + '…' : diff.afterText}
          </pre>
        </div>
      )}
      {eloHistory && eloHistory.length > 1 && (
        <div className="text-xs text-[var(--text-muted)]">
          Elo trajectory: {eloHistory.map(h => Math.round(h.elo)).join(' → ')}
        </div>
      )}
    </div>
  );
}
