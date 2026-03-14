// Renders pipeline action summaries as colored badge chips.
// Used in timeline, invocation detail, and aggregate views to show what actions an agent dispatched.

'use client';

/** Color mapping for action types. */
const ACTION_COLORS: Record<string, string> = {
  ADD_TO_POOL: 'bg-blue-900/50 text-blue-300',
  RECORD_MATCHES: 'bg-purple-900/50 text-purple-300',
  APPEND_CRITIQUES: 'bg-amber-900/50 text-amber-300',
  MERGE_FLOW_SCORES: 'bg-teal-900/50 text-teal-300',
  SET_DIVERSITY_SCORE: 'bg-green-900/50 text-green-300',
  SET_META_FEEDBACK: 'bg-indigo-900/50 text-indigo-300',
  START_NEW_ITERATION: 'bg-gray-700/50 text-gray-300',
  UPDATE_ARENA_SYNC_INDEX: 'bg-rose-900/50 text-rose-300',
};

const DEFAULT_COLOR = 'bg-indigo-900/50 text-indigo-300';

/** Short display label for action types. */
function actionLabel(type: string): string {
  switch (type) {
    case 'ADD_TO_POOL': return 'Add';
    case 'RECORD_MATCHES': return 'Matches';
    case 'APPEND_CRITIQUES': return 'Critiques';
    case 'MERGE_FLOW_SCORES': return 'FlowScores';
    case 'SET_DIVERSITY_SCORE': return 'Diversity';
    case 'SET_META_FEEDBACK': return 'MetaFeedback';
    case 'START_NEW_ITERATION': return 'NewIter';
    case 'UPDATE_ARENA_SYNC_INDEX': return 'ArenaSync';
    default: return type;
  }
}

/** Extract a detail string from an action summary based on its type. */
function actionDetail(action: Record<string, unknown>): string {
  const { type } = action;
  if (type === 'ADD_TO_POOL' && typeof action.count === 'number') return ` (${action.count})`;
  if (type === 'RECORD_MATCHES' && typeof action.matchCount === 'number') return ` (${action.matchCount})`;
  if (type === 'APPEND_CRITIQUES' && typeof action.count === 'number') return ` (${action.count})`;
  if (type === 'MERGE_FLOW_SCORES' && typeof action.variantCount === 'number') return ` (${action.variantCount})`;
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
        const color = ACTION_COLORS[type] ?? DEFAULT_COLOR;
        return (
          <span
            key={i}
            className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${color}`}
          >
            {actionLabel(type)}{actionDetail(a)}
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
        const color = ACTION_COLORS[type] ?? DEFAULT_COLOR;
        const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
        return (
          <div key={type} className="flex items-center gap-2 text-xs">
            <span className={`inline-flex items-center px-2 py-0.5 rounded font-medium min-w-[90px] ${color}`}>
              {actionLabel(type)}
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
