// Shows the current pipeline phase (EXPANSION/COMPETITION) with iteration progress.
// Used in run detail headers and timeline markers.
'use client';

import type { PipelinePhase } from '@/lib/evolution/types';

const PHASE_STYLES: Record<PipelinePhase, string> = {
  EXPANSION:
    'bg-[var(--accent-gold)]/15 text-[var(--accent-gold)] border-[var(--accent-gold)]/30',
  COMPETITION:
    'bg-[var(--status-success)]/15 text-[var(--status-success)] border-[var(--status-success)]/30',
};

export function PhaseIndicator({
  phase,
  iteration,
  maxIterations,
  className = '',
}: {
  phase: PipelinePhase;
  iteration: number;
  maxIterations: number;
  className?: string;
}) {
  const style = PHASE_STYLES[phase];
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border ${style} ${className}`}
      data-testid="phase-indicator"
    >
      <span>{phase}</span>
      <span className="opacity-60">
        {iteration}/{maxIterations}
      </span>
    </span>
  );
}
