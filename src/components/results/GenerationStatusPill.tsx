/**
 * GenerationStatusPill — floating bottom-center status pill that hands off the
 * post-streaming UX from "AI is writing" to "you can now edit". Subscribes to
 * pageLifecycleReducer state passed as a prop.
 *
 * States:
 *   streaming  → "Drafting your article — hang tight…"  (gold accent)
 *   viewing    → "All set! Bringing the editor in…"      (green tick, 800ms)
 *               → "Try: 'explain it like I'm 12' — AI editor →"  (3s auto-fade)
 *   error      → "Generation failed — try again"         (red accent)
 *   other      → hidden
 *
 * Mounted at page root in src/app/results/page.tsx (NOT inside the article container)
 * because position: fixed shouldn't inherit the article's max-width constraint.
 * Reducer state must be passed via prop since pageLifecycleReducer is local
 * useReducer scope in results/page.tsx.
 */

'use client';

import { useEffect, useRef, useState } from 'react';
import { PencilSquareIcon, CheckCircleIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/solid';
import type { PageLifecycleState } from '@/reducers/pageLifecycleReducer';

type PillState = 'hidden' | 'streaming' | 'transition' | 'hint' | 'error';

interface Props {
  lifecycleState: PageLifecycleState;
}

const TRANSITION_DURATION_MS = 800;
const HINT_AUTO_DISMISS_MS = 3000;

export function GenerationStatusPill({ lifecycleState }: Props) {
  const [pillState, setPillState] = useState<PillState>('hidden');
  const [dismissed, setDismissed] = useState(false);
  const wasStreamingRef = useRef(false);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear stale timers whenever phase shifts.
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

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

    if (lifecycleState.phase === 'viewing' && wasStreamingRef.current && !dismissed) {
      // Just transitioned from streaming → viewing. Show State B for 800ms, then
      // State C until dismissed or auto-fade.
      setPillState('transition');
      transitionTimerRef.current = setTimeout(() => {
        setPillState('hint');
      }, TRANSITION_DURATION_MS);
      return;
    }

    // idle / loading / editing / saving / viewing-after-dismiss → hidden
    setPillState('hidden');
  }, [lifecycleState.phase, dismissed]);

  // Auto-dismiss the hint after 3s.
  useEffect(() => {
    if (pillState === 'hint') {
      hintTimerRef.current = setTimeout(() => {
        setDismissed(true);
        wasStreamingRef.current = false;
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
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, []);

  if (pillState === 'hidden') return null;

  const config = pillStateConfig(pillState);

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="generation-status-pill"
      data-pill-state={pillState}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 max-w-md pointer-events-auto motion-safe:animate-fade-up"
    >
      <div
        className={`flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--surface-secondary)] paper-texture shadow-warm-lg backdrop-blur-sm border border-[var(--border-default)] border-l-2 ${config.borderClass}`}
      >
        <config.Icon className={`w-4 h-4 shrink-0 ${config.iconClass}`} aria-hidden="true" />
        <span className="font-ui text-sm text-[var(--text-primary)] whitespace-nowrap">
          {config.copy}
        </span>
        {pillState === 'hint' && (
          <button
            type="button"
            onClick={() => {
              setDismissed(true);
              wasStreamingRef.current = false;
              setPillState('hidden');
            }}
            aria-label="Dismiss hint"
            data-testid="generation-status-pill-dismiss"
            className="ml-1 -mr-1 p-1 rounded-full text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] transition-colors"
          >
            <XMarkIcon className="w-3 h-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

function pillStateConfig(state: Exclude<PillState, 'hidden'>) {
  switch (state) {
    case 'streaming':
      return {
        copy: 'Drafting your article — hang tight…',
        Icon: PencilSquareIcon,
        borderClass: 'border-l-[var(--accent-gold)]',
        iconClass: 'text-[var(--accent-gold)]',
      };
    case 'transition':
      return {
        copy: 'All set! Bringing the editor in…',
        Icon: CheckCircleIcon,
        borderClass: 'border-l-[var(--status-success)]',
        iconClass: 'text-[var(--status-success)]',
      };
    case 'hint':
      return {
        copy: 'Try: "explain it like I\'m 12" — AI editor →',
        Icon: CheckCircleIcon,
        borderClass: 'border-l-[var(--status-success)]',
        iconClass: 'text-[var(--status-success)]',
      };
    case 'error':
      return {
        copy: 'Generation failed — try again',
        Icon: ExclamationTriangleIcon,
        borderClass: 'border-l-[var(--status-error)]',
        iconClass: 'text-[var(--status-error)]',
      };
  }
}
