// Shared UI primitives for agent execution detail views.
// Provides consistent styling following the Midnight Scholar design system.

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

/** Cost display formatted to 4 decimal places. */
export function CostDisplay({ cost }: { cost: number }): JSX.Element {
  return <span className="font-mono text-xs">${cost.toFixed(4)}</span>;
}

/** Truncated ID display (first 8 chars). */
export function ShortId({ id }: { id: string }): JSX.Element {
  return <span className="font-mono text-xs text-[var(--accent-gold)]" title={id}>{id.substring(0, 8)}</span>;
}
