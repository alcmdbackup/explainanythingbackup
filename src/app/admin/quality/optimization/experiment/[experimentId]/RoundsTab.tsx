// Rounds tab: displays per-round analysis with structured tables.
// Placeholder — full implementation in Phase 3.

'use client';

import type { ExperimentStatus } from '@evolution/services/experimentActions';
import { RoundAnalysisCard } from './RoundAnalysisCard';

interface RoundsTabProps {
  rounds: ExperimentStatus['rounds'];
}

export function RoundsTab({ rounds }: RoundsTabProps) {
  if (rounds.length === 0) {
    return (
      <p className="text-sm font-body text-[var(--text-muted)] py-4">
        No rounds yet.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {rounds.map((round) => (
        <RoundAnalysisCard key={round.roundNumber} round={round} />
      ))}
    </div>
  );
}
