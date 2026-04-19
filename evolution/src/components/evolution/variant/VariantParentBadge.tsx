// Shared badge rendering a variant's parent info + delta ELO with CI.
// Used on every surface where a variant is displayed so numbers stay
// semantically consistent (variants list, VariantsTab, arena, detail header,
// VariantCard, lineage tab, invocation detail).
//
// Format: "Parent #a1b2c3 · 1250 ± 40 · Δ +45 [+10, +80]"
// Null-parent (seed variant): "Seed · no parent"
// Cross-run parent: adds "(other run)" suffix on the ID.
// role='from' (used by the lineage-tab node-picker for arbitrary-pair diffs):
// renders "From #a1b2c3 · 1250 ± 40 · Δ +45 [+10, +80]" instead.

'use client';

import Link from 'next/link';

import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { formatEloWithUncertainty } from '@evolution/lib/utils/formatters';

export interface VariantParentBadgeProps {
  /** Null when the variant has no parent (seed variant). */
  parentId: string | null;
  parentElo: number | null;
  parentUncertainty: number | null;
  /** child.elo - parent.elo (or null when no parent). */
  delta: number | null;
  /** 95% CI from bootstrapDeltaCI. */
  deltaCi: [number, number] | null;
  /** When true, annotate that the parent is in a different run than the child. */
  crossRun?: boolean;
  /** Semantic role: 'parent' (default) or 'from' (used in lineage-tab pair picker). */
  role?: 'parent' | 'from';
  /** Optional CSS class override. */
  className?: string;
}

function formatDelta(delta: number): string {
  if (delta > 0) return `+${Math.round(delta)}`;
  return String(Math.round(delta));
}

function formatCi(ci: [number, number]): string {
  const lo = ci[0] >= 0 ? `+${Math.round(ci[0])}` : String(Math.round(ci[0]));
  const hi = ci[1] >= 0 ? `+${Math.round(ci[1])}` : String(Math.round(ci[1]));
  return `[${lo}, ${hi}]`;
}

export function VariantParentBadge(props: VariantParentBadgeProps): JSX.Element {
  const { parentId, parentElo, parentUncertainty, delta, deltaCi, crossRun, role, className } = props;

  // Null-parent state (seed variant, or when lookup failed).
  if (parentId == null || parentElo == null) {
    return (
      <span
        data-testid="variant-parent-badge"
        data-state="seed"
        className={className ?? 'text-[var(--text-secondary)] text-xs font-ui'}
      >
        Seed · no parent
      </span>
    );
  }

  const shortId = parentId.slice(0, 8);
  const label = role === 'from' ? `From #${shortId}` : `Parent #${shortId}`;
  const eloLabel = formatEloWithUncertainty(parentElo, parentUncertainty ?? undefined);
  const deltaLabel = delta != null ? `Δ ${formatDelta(delta)}` : null;
  const ciLabel = deltaCi != null ? formatCi(deltaCi) : null;

  return (
    <span
      data-testid="variant-parent-badge"
      data-state={role === 'from' ? 'from' : 'parent'}
      className={className ?? 'text-[var(--text-secondary)] text-xs font-ui'}
    >
      <Link
        href={buildVariantDetailUrl(parentId)}
        className="text-[var(--accent-gold)] hover:underline"
        data-testid="variant-parent-badge-link"
      >
        {label}
      </Link>
      {crossRun ? <span className="ml-1 text-[var(--text-secondary)]">(other run)</span> : null}
      <span className="mx-1">·</span>
      <span>{eloLabel}</span>
      {deltaLabel ? (
        <>
          <span className="mx-1">·</span>
          <span className="font-medium text-[var(--text-primary)]">{deltaLabel}</span>
          {ciLabel ? <span className="ml-1 text-[var(--text-secondary)]">{ciLabel}</span> : null}
        </>
      ) : null}
    </span>
  );
}
