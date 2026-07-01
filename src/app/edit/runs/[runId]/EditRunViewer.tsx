'use client';
// Client child of /edit/runs/[runId] page (Phase 2 of build_website_for_evolutiOn_20260626).
// Refactored by improvements_to_edit_page_evolution_20260630 Phase 3:
// - Viewing phase split into "Improved article" + "Diff" tabs
// - Meta strip shows strategyLabel + costSpent + duration
// - Variant tab renders LLM output as prose via react-markdown (XSS-defended
//   via editRunMarkdownComponents component-map + sanitizeMarkdownUrl urlTransform)
// - Diff tab keeps existing SideBySideWordDiff (relabeled "Rewrite")
//
// Polls getEditRunStatusAction every 3s while status ∈ {pending, claimed, running}.
// Hard timeout at 10 minutes (200 polls).

import { useReducer, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { getEditRunStatusAction } from '../../publicEditActions';
import {
  editPageLifecycleReducer,
  initialEditPageState,
  isInFlight,
} from '@/reducers/editPageLifecycleReducer';
import { SideBySideWordDiff } from '@evolution/components/evolution/visualizations/SideBySideWordDiff';
import { EntityDetailTabs, useTabState, type TabDef } from '@evolution/components/evolution/sections/EntityDetailTabs';
import { editRunMarkdownComponents } from './editRunMarkdownComponents';
import { sanitizeMarkdownUrl } from '@/lib/utils/sanitizeMarkdownUrl';

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1_000;
/** Tolerate transient fetch errors (Vercel function blips, mid-flight network
 *  drops). Surface the error UI only after this many consecutive failures so
 *  one bad poll doesn't abort the loop while the backend pipeline is still
 *  running. 5 consecutive failures @ 3s interval = ~15s of total connectivity
 *  loss before we give up. */
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

const VIEWING_TABS: TabDef[] = [
  { id: 'variant', label: 'Improved article' },
  { id: 'diff', label: 'Diff' },
];

interface Props {
  runId: string;
}

export default function EditRunViewer({ runId }: Props): JSX.Element | null {
  const [state, dispatch] = useReducer(editPageLifecycleReducer, initialEditPageState);
  const startedAtRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const consecutiveErrorsRef = useRef<number>(0);

  useEffect(() => {
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
      dispatch({ type: 'SUBMIT_SUCCESS', runId });
    }
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = startedAtRef.current ?? Date.now();
    const stopPolling = (): void => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      const elapsedMs = Date.now() - startedAt;
      try {
        const result = await getEditRunStatusAction(runId);
        if (cancelled) return;
        if (!result?.success || !result.data) {
          consecutiveErrorsRef.current += 1;
          if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
            dispatch({ type: 'POLL_FAILED', runId, message: result?.error?.message ?? 'Could not fetch run status.' });
            stopPolling();
          }
          return;
        }
        consecutiveErrorsRef.current = 0;
        const status = result.data.status;
        if (status === 'completed') {
          dispatch({
            type: 'POLL_COMPLETED',
            runId,
            originalContent: result.data.originalContent,
            winnerVariantContent: result.data.winnerVariantContent ?? '',
            strategyLabel: result.data.strategyLabel ?? '',
            costSpent: result.data.costSpent,
            durationMs: elapsedMs,
          });
          stopPolling();
          return;
        }
        if (status === 'failed' || status === 'cancelled') {
          dispatch({ type: 'POLL_FAILED', runId, message: result.data.errorMessage ?? 'The rewrite hit a snag.' });
          stopPolling();
          return;
        }
        if (elapsedMs > MAX_POLL_DURATION_MS) {
          dispatch({ type: 'POLL_FAILED', runId, message: 'This is taking longer than expected. Try refreshing the page.' });
          stopPolling();
          return;
        }
        dispatch({ type: 'POLL_TICK', runId, status: status as 'pending' | 'claimed' | 'running', elapsedMs });
      } catch (err) {
        if (cancelled) return;
        consecutiveErrorsRef.current += 1;
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
          dispatch({ type: 'POLL_FAILED', runId, message: err instanceof Error ? err.message : 'Network error.' });
          stopPolling();
        }
      }
    };

    void tick();
    intervalRef.current = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [runId]);

  // ─── Render branches ─────────────────────────────────────────────

  if (state.phase === 'error') {
    return (
      <div data-testid="edit-run-error" className="flex flex-col items-center text-center py-24">
        <div className="text-copper text-5xl mb-6">⚠</div>
        <h2 className="atlas-display-section text-[var(--text-primary)] mb-4">Something went wrong.</h2>
        <p className="atlas-body text-[var(--text-muted)] max-w-md mb-6">
          {state.message} Your text wasn&apos;t saved past this attempt.
          Try again with the same or a different style.
        </p>
        <a href="/edit" className="atlas-button">Try again →</a>
        <p data-testid="edit-run-reference" className="atlas-ui text-xs text-[var(--text-muted)] mt-8">
          Reference: {runId}
        </p>
      </div>
    );
  }

  if (isInFlight(state)) {
    const elapsed = state.phase === 'queued' || state.phase === 'running' ? state.elapsedMs : 0;
    const secs = Math.floor(elapsed / 1000);
    const statusCopy = state.phase === 'queued'
      ? 'Queued… (~30s until pickup)'
      : state.phase === 'running'
        ? 'Rewriting your text…'
        : 'Submitting…';
    return (
      <div data-testid="edit-run-pending" className="flex flex-col items-center text-center py-24">
        <div className="atlas-ui text-[var(--accent-gold)] text-4xl mb-6 select-none">✦ ✦ ✦</div>
        <h2 className="atlas-display-section text-[var(--text-primary)] mb-4">{statusCopy}</h2>
        <p className="atlas-ui text-[var(--text-muted)]">{secs}s elapsed</p>
        <p className="atlas-body text-[var(--text-muted)] max-w-md mt-6">
          This usually takes one to three minutes. We&apos;ll show the result here when it&apos;s ready —
          you can keep this tab open or come back to this URL later.
        </p>
      </div>
    );
  }

  if (state.phase === 'viewing') {
    return (
      <ViewingPhase
        originalContent={state.originalContent}
        winnerVariantContent={state.winnerVariantContent}
        strategyLabel={state.strategyLabel}
        costSpent={state.costSpent}
        durationMs={state.durationMs}
      />
    );
  }

  return null;
}

interface ViewingPhaseProps {
  originalContent: string;
  winnerVariantContent: string;
  strategyLabel: string;
  costSpent: number | null;
  durationMs: number;
}

/** Result-view tabs, extracted so useTabState (which calls useSearchParams) mounts
 *  only inside the viewing branch. */
function ViewingPhase({
  originalContent,
  winnerVariantContent,
  strategyLabel,
  costSpent,
  durationMs,
}: ViewingPhaseProps): JSX.Element {
  const [activeTab, setActiveTab] = useTabState(VIEWING_TABS, { defaultTab: 'variant', syncToUrl: false });

  const durationStr = ((): string => {
    const totalSecs = Math.round(durationMs / 1000);
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  })();

  const metaParts: string[] = [];
  if (strategyLabel) metaParts.push(`Rewrote with '${strategyLabel}'`);
  else metaParts.push('Finished');
  if (costSpent != null && costSpent > 0) metaParts.push(`$${costSpent.toFixed(2)}`);
  metaParts.push(durationStr);

  return (
    <div data-testid="edit-run-viewing">
      <div className="scholar-card paper-texture rounded-book shadow-warm-md border border-[var(--border-default)] p-4 mb-6">
        <div data-testid="edit-run-meta-strip" className="atlas-ui text-sm text-[var(--text-secondary)]">
          {metaParts.join(' · ')}
        </div>
      </div>

      <span data-testid="edit-run-tabs-hydrated" style={{ display: 'none' }} />
      <EntityDetailTabs tabs={VIEWING_TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'variant' && (
          <div data-testid="edit-run-tab-variant" className="mt-4">
            <ReactMarkdown
              components={editRunMarkdownComponents}
              urlTransform={sanitizeMarkdownUrl}
            >
              {winnerVariantContent}
            </ReactMarkdown>
          </div>
        )}
        {activeTab === 'diff' && (
          <div data-testid="edit-run-tab-diff" className="mt-4">
            <SideBySideWordDiff
              parent={originalContent}
              variant={winnerVariantContent}
              leftLabel="Your text"
              rightLabel="Rewrite"
            />
          </div>
        )}
      </EntityDetailTabs>

      <div className="flex justify-center gap-4 mt-8">
        <a href="/edit" className="atlas-button">Edit something else</a>
      </div>
    </div>
  );
}
