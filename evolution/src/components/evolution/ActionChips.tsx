// Renders pipeline action summaries as colored badge chips.
// Used in timeline, invocation detail, and aggregate views to show what actions an agent dispatched.

'use client';

const DEFAULT_COLOR = 'bg-indigo-900/50 text-indigo-300';

/** Color and short label for each action type. */
const ACTION_CONFIG: Record<string, { color: string; label: string }> = {
  ADD_TO_POOL: { color: 'bg-blue-900/50 text-blue-300', label: 'Add' },
  RECORD_MATCHES: { color: 'bg-purple-900/50 text-purple-300', label: 'Matches' },
  APPEND_CRITIQUES: { color: 'bg-amber-900/50 text-amber-300', label: 'Critiques' },
  MERGE_FLOW_SCORES: { color: 'bg-teal-900/50 text-teal-300', label: 'FlowScores' },
  SET_DIVERSITY_SCORE: { color: 'bg-green-900/50 text-green-300', label: 'Diversity' },
  SET_META_FEEDBACK: { color: 'bg-indigo-900/50 text-indigo-300', label: 'MetaFeedback' },
  START_NEW_ITERATION: { color: 'bg-gray-700/50 text-gray-300', label: 'NewIter' },
  UPDATE_ARENA_SYNC_INDEX: { color: 'bg-rose-900/50 text-rose-300', label: 'ArenaSync' },
};

/** Extract a detail string from an action summary based on its type. */
function actionDetail(action: Record<string, unknown>): string {
  const { type } = action;
  const countField =
    type === 'RECORD_MATCHES' ? action.matchCount :
    type === 'MERGE_FLOW_SCORES' ? action.variantCount :
    action.count;
  if (typeof countField === 'number') return ` (${countField})`;
  if (type === 'SET_DIVERSITY_SCORE' && typeof action.score === 'number') return ` ${action.score.toFixed(2)}`;
  return '';
}

interface ActionChipsProps {
  /** Array of action summaries (ActionSummary objects from pipeline). */
  actions: unknown[];
  /** Optional className for the wrapper div. */
  className?: string;
}

/** Renders a list of action summary badges. */
export function ActionChips({ actions, className }: ActionChipsProps): JSX.Element | null {
  if (!actions || actions.length === 0) return null;

  return (
    <div className={className ?? 'flex flex-wrap gap-1'} data-testid="action-chips">
      {actions.map((action, i) => {
        const a = action as Record<string, unknown>;
        const type = (a.type as string) ?? 'unknown';
        const cfg = ACTION_CONFIG[type];
        const color = cfg?.color ?? DEFAULT_COLOR;
        return (
          <span
            key={i}
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}
          >
            {cfg?.label ?? type}{actionDetail(a)}
          </span>
        );
      })}
    </div>
  );
}

interface ActionDistributionProps {
  /** Map of action type to total count. */
  counts: Record<string, number>;
  /** Optional className for the wrapper div. */
  className?: string;
}

/** Renders aggregated action counts as a horizontal bar-style display. */
export function ActionDistribution({ counts, className }: ActionDistributionProps): JSX.Element | null {
  const entries = Object.entries(counts).filter(([, v]) => v > 0).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return null;

  const maxCount = entries[0][1];

  return (
    <div className={className ?? 'space-y-1.5'} data-testid="action-distribution">
      {entries.map(([type, count]) => {
        const cfg = ACTION_CONFIG[type];
        const color = cfg?.color ?? DEFAULT_COLOR;
        const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
        return (
          <div key={type} className="flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium min-w-[90px] ${color}`}>
              {cfg?.label ?? type}
            </span>
            <div className="flex-1 h-3 bg-[var(--surface-secondary)] rounded overflow-hidden">
              <div
                className="h-full bg-[var(--accent-gold)]/60 rounded"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[var(--text-muted)] w-10 text-right">{count}</span>
          </div>
        );
      })}
    </div>
  );
}
