// Horizontal bar chart showing per-step quality scores for outline-based variants.
// Color-coded by score threshold: green (≥0.8), yellow (0.5–0.8), red (<0.5).
'use client';

import type { GenerationStepName } from '@/lib/evolution/types';

export interface StepScoreData {
  name: GenerationStepName;
  score: number;
  costUsd: number;
}

const STEP_LABELS: Record<GenerationStepName, string> = {
  outline: 'Outline',
  expand: 'Expand',
  polish: 'Polish',
  verify: 'Verify',
};

function scoreColor(score: number): string {
  if (score >= 0.8) return 'var(--status-success)';
  if (score >= 0.5) return 'var(--accent-gold)';
  return 'var(--status-error)';
}

export function StepScoreBar({
  steps,
  weakestStep,
}: {
  steps: StepScoreData[];
  weakestStep: GenerationStepName | null;
}) {
  if (steps.length === 0) return null;

  return (
    <div className="space-y-1.5" data-testid="step-score-bar">
      {steps.map((step) => (
        <div key={step.name} className="flex items-center gap-2 text-xs">
          <span
            className={`w-14 text-right font-mono ${
              step.name === weakestStep
                ? 'text-[var(--status-error)] font-semibold'
                : 'text-[var(--text-muted)]'
            }`}
          >
            {STEP_LABELS[step.name]}
          </span>
          <div className="flex-1 h-3 bg-[var(--surface-elevated)] rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm transition-all"
              style={{
                width: `${Math.round(step.score * 100)}%`,
                backgroundColor: scoreColor(step.score),
              }}
              data-testid={`step-bar-${step.name}`}
            />
          </div>
          <span className="w-8 text-right text-[var(--text-muted)] font-mono">
            {step.score.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}
