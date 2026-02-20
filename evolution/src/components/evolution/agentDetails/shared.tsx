// Shared UI primitives for agent execution detail views.
// Provides consistent styling following the Midnight Scholar design system.

import { formatCostMicro } from '@evolution/lib/utils/formatters';

/** Status badge with color-coded background. */
export function StatusBadge({ status }: { status: string }): JSX.Element {
  const successStatuses = new Set(['success', 'ACCEPT']);
  const warningStatuses = new Set(['format_rejected', 'parse_failed']);
  const errorStatuses = new Set(['error', 'REJECT']);

  let colorClass: string;
  if (successStatuses.has(status)) {
    colorClass = 'bg-[var(--status-success)]/15 text-[var(--status-success)]';
  } else if (warningStatuses.has(status)) {
    colorClass = 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]';
  } else if (errorStatuses.has(status)) {
    colorClass = 'bg-[var(--status-error)]/15 text-[var(--status-error)]';
  } else {
    colorClass = 'bg-[var(--surface-elevated)] text-[var(--text-secondary)]';
  }
  return (
    <span className={`px-2 py-0.5 rounded-page text-xs font-ui font-medium ${colorClass}`}>
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
  /** When provided, auto-constructs variant URL: /admin/quality/evolution/run/{runId}?tab=variants&variant={id} */
  runId?: string;
  href?: string;
  onClick?: () => void;
}): JSX.Element {
  const effectiveHref = href ?? (runId ? `/admin/quality/evolution/run/${runId}?tab=variants&variant=${id}` : undefined);
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
