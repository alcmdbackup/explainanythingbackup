'use client';
// Client child of /edit/runs/[runId] page (Phase 2).
//
// Polls getEditRunStatusAction every 3s while status ∈ {pending, claimed, running}.
// Hard timeout at 10 minutes (200 polls). Once status='completed', renders the
// side-by-side diff via SideBySideWordDiff with leftLabel="Your text" /
// rightLabel="Evolved" — matches the variant-details "Diff vs parent" pattern.

import { useReducer, useEffect, useRef } from 'react';
import { getEditRunStatusAction } from '../../publicEditActions';
import {
  editPageLifecycleReducer,
  initialEditPageState,
  isInFlight,
} from '@/reducers/editPageLifecycleReducer';
import { SideBySideWordDiff } from '@evolution/components/evolution/visualizations/SideBySideWordDiff';

const POLL_INTERVAL_MS = 3_000;
const MAX_POLL_DURATION_MS = 10 * 60 * 1_000;
/** Tolerate transient fetch errors (Vercel function blips, mid-flight network
 *  drops). Surface the error UI only after this many consecutive failures so
 *  one bad poll doesn't abort the loop while the backend pipeline is still
 *  running. 5 consecutive failures @ 3s interval = ~15s of total connectivity
 *  loss before we give up. */
const MAX_CONSECUTIVE_POLL_ERRORS = 5;

interface Props {
  runId: string;
}

export default function EditRunViewer({ runId }: Props): JSX.Element | null {
  const [state, dispatch] = useReducer(editPageLifecycleReducer, initialEditPageState);
  const startedAtRef = useRef<number | null>(null);
  // Refs for the polling loop. Reading state from inside `tick` via a ref
  // avoids re-creating the interval on every dispatch — depending on `state`
  // in the useEffect deps caused the cleanup-and-restart cycle to fire ~3
  // polls/second instead of every 3s (observed in Vercel logs 2026-06-30).
  const isInFlightRef = useRef<boolean>(true);
  const consecutiveErrorsRef = useRef<number>(0);

  // Mirror in-flight state into the ref so the polling loop can read it
  // without subscribing.
  useEffect(() => {
    isInFlightRef.current = isInFlight(state);
  }, [state]);

  // Seed: assume queued, kick off polling.
  useEffect(() => {
    if (startedAtRef.current === null) {
      startedAtRef.current = Date.now();
      dispatch({ type: 'SUBMIT_SUCCESS', runId });
    }
  }, [runId]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = startedAtRef.current ?? Date.now();

    const tick = async (): Promise<void> => {
      if (cancelled) return;
      // Stop polling once the reducer has moved to a terminal phase (viewing
      // or error). The interval keeps firing harmlessly until cleanup but
      // never dispatches another action.
      if (!isInFlightRef.current) return;
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > MAX_POLL_DURATION_MS) {
        dispatch({ type: 'POLL_FAILED', runId, message: 'This is taking longer than expected. Try refreshing the page.' });
        return;
      }
      try {
        const result = await getEditRunStatusAction(runId);
        if (cancelled) return;
        if (!result?.success || !result.data) {
          // Treat action-level errors as transient too (Vercel function blips,
          // Supabase 503s). Bail only after N consecutive failures.
          consecutiveErrorsRef.current += 1;
          if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
            dispatch({ type: 'POLL_FAILED', runId, message: result?.error?.message ?? 'Could not fetch run status.' });
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
            strategyLabel: '',
            durationMs: elapsedMs,
          });
          return;
        }
        if (status === 'failed' || status === 'cancelled') {
          dispatch({ type: 'POLL_FAILED', runId, message: result.data.errorMessage ?? 'The rewrite hit a snag.' });
          return;
        }
        dispatch({ type: 'POLL_TICK', runId, status: status as 'pending' | 'claimed' | 'running', elapsedMs });
      } catch (err) {
        if (cancelled) return;
        // Transient fetch errors (network blip, edge timeout) shouldn't kill
        // the polling loop on the first failure. The backend pipeline keeps
        // running independently; we just retry on the next tick. Surface
        // the error UI only after N consecutive failures.
        consecutiveErrorsRef.current += 1;
        if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_POLL_ERRORS) {
          dispatch({ type: 'POLL_FAILED', runId, message: err instanceof Error ? err.message : 'Network error.' });
        }
      }
    };

    void tick(); // fire immediately
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Deps: only runId. State changes must NOT recreate the interval — that
    // was the 2026-06-30 regression that produced ~3 polls/second + made a
    // single fetch failure terminal.
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
    const durationStr = (() => {
      const totalSecs = Math.round(state.durationMs / 1000);
      const m = Math.floor(totalSecs / 60);
      const s = totalSecs % 60;
      return m > 0 ? `${m}m ${s}s` : `${s}s`;
    })();
    return (
      <div data-testid="edit-run-viewing">
        <div className="scholar-card paper-texture rounded-book shadow-warm-md border border-[var(--border-default)] p-4 mb-6">
          <div className="atlas-ui text-sm text-[var(--text-secondary)]">
            Finished in {durationStr}
          </div>
        </div>
        <SideBySideWordDiff
          parent={state.originalContent}
          variant={state.winnerVariantContent}
          leftLabel="Your text"
          rightLabel="Evolved"
        />
        <div className="flex justify-center gap-4 mt-8">
          <a href="/edit" className="atlas-button">Edit something else</a>
        </div>
      </div>
    );
  }

  return null;
}
