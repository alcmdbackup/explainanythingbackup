/**
 * GenerationStatusPill — floating bottom-center status pill that hands off the
 * post-streaming UX from "AI is writing" to "you can now edit". Subscribes to
 * pageLifecycleReducer state passed as a prop, plus a `streamFinished` signal
 * so the transition copy can swap as soon as the SSE complete event arrives
 * — independently of when the URL change / LOAD_EXPLANATION races underneath.
 *
 * States:
 *   streaming  → "Drafting your article — hang tight…"  (while content streams)
 *   transition → "All set! Bringing the editor in…"     (stream done, editor not yet rendered)
 *   hint       → "Try: 'explain it like I'm 12' — AI editor →"  (editor rendered; auto-fade after 3s)
 *   error      → "Generation failed — try again"
 *   hidden     → component returns null
 *
 * Mounted at page root in src/app/results/page.tsx (NOT inside the article container)
 * because position: fixed shouldn't inherit the article's max-width constraint.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import type { PageLifecycleState } from '@/reducers/pageLifecycleReducer';

type PillState = 'hidden' | 'streaming' | 'transition' | 'hint' | 'error';

interface Props {
  lifecycleState: PageLifecycleState;
  /**
   * Set by results/page.tsx the moment the SSE `complete` event arrives. Lets
   * the pill switch from 'streaming' → 'transition' immediately, instead of
   * waiting for the URL change + LOAD_EXPLANATION dance to complete and dispatch
   * phase: 'viewing'. The transition copy ("Bringing the editor in…") then
   * stays put through link-resolve / reset / reload until LOAD_EXPLANATION
   * actually fires, at which point we advance to 'hint'.
   */
  streamFinished?: boolean;
}

const HINT_AUTO_DISMISS_MS = 3000;

export function GenerationStatusPill({ lifecycleState, streamFinished = false }: Props) {
  const [pillState, setPillState] = useState<PillState>('hidden');
  const [dismissed, setDismissed] = useState(false);
  // Tracks "we entered streaming at some point during this generation". Used to
  // distinguish a real user generation (loading→streaming→viewing) from a passive
  // page load (idle→viewing) so we only show the post-stream transition for the former.
  const wasStreamingRef = useRef(false);
  // Tracks "we've already started the transition→hint sequence". Once true, the
  // pill owns its lifecycle through to hint auto-dismiss and ignores intermediate
  // phase changes (RESET → idle → loading → viewing race that follows router.push).
  const inTransitionFlowRef = useRef(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // (1) Stream just finished — start the transition immediately, regardless of
    //     any later phase shuffling. Stay in 'transition' (no auto-advance to
    //     hint) until LOAD_EXPLANATION dispatches viewing — that's when the
    //     editor actually renders and "Try AI editor →" becomes truthful.
    if (
      lifecycleState.phase === 'streaming' &&
      streamFinished &&
      !inTransitionFlowRef.current
    ) {
      inTransitionFlowRef.current = true;
      setPillState('transition');
      return;
    }

    // (2) Editor is now actually on screen — advance from transition to hint.
    if (
      lifecycleState.phase === 'viewing' &&
      inTransitionFlowRef.current &&
      !dismissed
    ) {
      setPillState('hint');
      return;
    }

    // (3) Once the transition flow has started, ignore RESET/idle/loading phase
    //     changes that come from the URL change underneath. The pill owns its
    //     own state until hint auto-dismisses or the user clicks the X.
    if (inTransitionFlowRef.current) return;

    // (4) Standard pre-stream states.
    if (lifecycleState.phase === 'streaming') {
      wasStreamingRef.current = true;
      setDismissed(false);
      setPillState('streaming');
      return;
    }

    if (lifecycleState.phase === 'error') {
      setPillState('error');
      return;
    }

    // (5) Legacy path: phase reached 'viewing' without ever seeing a streamFinished
    //     signal (e.g., direct navigation to /results?explanation_id=...). Today
    //     this just stays hidden — wasStreamingRef would only be true if we'd
    //     come through streaming, which means we should have hit branch (1) first.
    setPillState('hidden');
  }, [lifecycleState.phase, dismissed, streamFinished]);

  // Auto-dismiss the hint after 3s.
  useEffect(() => {
    if (pillState === 'hint') {
      hintTimerRef.current = setTimeout(() => {
        setDismissed(true);
        wasStreamingRef.current = false;
        inTransitionFlowRef.current = false;
        setPillState('hidden');
      }, HINT_AUTO_DISMISS_MS);
    }
    return () => {
      if (hintTimerRef.current) {
        clearTimeout(hintTimerRef.current);
        hintTimerRef.current = null;
      }
    };
  }, [pillState]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  if (pillState === 'hidden') return null;

  const copy = pillCopy(pillState);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="generation-status-pill"
      data-pill-state={pillState}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-md pointer-events-auto motion-safe:animate-fade-up"
    >
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--surface-secondary)] paper-texture shadow-warm-lg backdrop-blur-sm border border-[var(--border-default)]">
        <span className="font-ui text-sm text-[var(--text-primary)] whitespace-nowrap">
          {copy}
        </span>
      </div>
    </div>
  );
}

function pillCopy(state: Exclude<PillState, 'hidden'>): string {
  switch (state) {
    case 'streaming':
      return 'Drafting your article — hang tight…';
    case 'transition':
      return 'All set! Bringing the editor in…';
    case 'hint':
      return 'Try: "explain it like I\'m 12" — AI editor →';
    case 'error':
      return 'Generation failed — try again';
  }
}
