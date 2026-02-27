// Displays Elo attribution gain with confidence interval and z-score color coding.
// Colors: grey (|z|<1.0 = noise), amber (1.0-2.0 = suggestive), green/red (≥2.0 = significant).

import type { EloAttribution } from '@evolution/lib/types';

interface AttributionBadgeProps {
  attribution: EloAttribution;
  /** Show compact form (gain only) vs full form (gain ± ci). Defaults to full. */
  compact?: boolean;
}

/** Maps z-score to a CSS variable name indicating significance band. */
function getZScoreVar(zScore: number): string {
  const absZ = Math.abs(zScore);
  if (absZ < 1.0) return '--text-secondary';   // grey — noise
  if (absZ < 2.0) return '--status-warning';    // amber — suggestive
  return zScore > 0 ? '--status-success' : '--status-error'; // significant
}

function getZScoreColor(zScore: number): string {
  return `text-[var(${getZScoreVar(zScore)})]`;
}

function getZScoreBg(zScore: number): string {
  return `bg-[var(${getZScoreVar(zScore)})]/10`;
}

export function AttributionBadge({ attribution, compact = false }: AttributionBadgeProps): JSX.Element {
  const { gain, ci, zScore } = attribution;
  const textColor = getZScoreColor(zScore);
  const bgColor = getZScoreBg(zScore);
  const sign = gain >= 0 ? '+' : '';
  const gainStr = `${sign}${Math.round(gain)}`;

  if (compact) {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded-page text-xs font-ui font-medium ${textColor} ${bgColor}`}
        title={`z=${zScore.toFixed(2)}, gain=${gain.toFixed(1)} ± ${ci.toFixed(1)}`}
      >
        {gainStr}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-page text-xs font-ui font-medium ${textColor} ${bgColor}`}
      title={`z-score: ${zScore.toFixed(2)}`}
    >
      <span>{gainStr}</span>
      <span className="opacity-60">±</span>
      <span className="opacity-60">{Math.round(ci)}</span>
    </span>
  );
}

/** Badge for agent-level aggregated attribution. */
interface AgentAttributionSummaryProps {
  agentName: string;
  avgGain: number;
  avgCi: number;
  variantCount: number;
  zScore?: number;
}

export function AgentAttributionSummary({ agentName, avgGain, avgCi, variantCount, zScore }: AgentAttributionSummaryProps): JSX.Element {
  const z = zScore ?? (avgCi > 0 ? avgGain / (avgCi / 1.96) : 0);

  return (
    <div className="flex items-center gap-2 text-xs font-ui">
      <span className="text-[var(--text-secondary)]">{agentName}</span>
      <span className="text-[var(--text-secondary)]">({variantCount})</span>
      <AttributionBadge
        attribution={{
          gain: avgGain,
          ci: avgCi,
          zScore: z,
          deltaMu: avgGain / 16,
          sigmaDelta: avgCi / (1.96 * 16),
        }}
      />
    </div>
  );
}
