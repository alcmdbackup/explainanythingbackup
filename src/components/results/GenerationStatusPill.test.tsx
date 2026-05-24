/**
 * GenerationStatusPill unit tests.
 *
 * Covers phase→copy mapping, transition timing (800ms B→C), auto-dismiss
 * (3s on hint), dismiss button, reduced-motion (handled via CSS so we just
 * assert the motion-safe class is present), and error state.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { GenerationStatusPill } from './GenerationStatusPill';
import type { PageLifecycleState } from '@/reducers/pageLifecycleReducer';

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function streaming(): PageLifecycleState {
  return { phase: 'streaming', content: '', title: '' };
}
function viewing(): PageLifecycleState {
  // Type assertion because ExplanationStatus is a string union; the pill only
  // reads `phase` so the exact status value doesn't matter for these tests.
  return {
    phase: 'viewing',
    content: 'x',
    title: 't',
    status: 'published' as PageLifecycleState extends { phase: 'viewing'; status: infer S } ? S : never,
    originalContent: 'x',
    originalTitle: 't',
    originalStatus: 'published' as PageLifecycleState extends { phase: 'viewing'; originalStatus: infer S } ? S : never,
  };
}
function errorState(): PageLifecycleState {
  return { phase: 'error', error: 'oops' };
}
function idle(): PageLifecycleState {
  return { phase: 'idle' };
}
function loading(): PageLifecycleState {
  return { phase: 'loading' };
}

describe('GenerationStatusPill', () => {
  it('renders State A (streaming) with the gold drafting copy', () => {
    render(<GenerationStatusPill lifecycleState={streaming()} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'streaming');
    expect(screen.getByText(/Drafting your article — hang tight…/i)).toBeInTheDocument();
  });

  it('renders nothing for idle phase', () => {
    render(<GenerationStatusPill lifecycleState={idle()} />);
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('renders nothing for loading phase (pre-stream)', () => {
    render(<GenerationStatusPill lifecycleState={loading()} />);
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('renders error state with red accent on error phase', () => {
    render(<GenerationStatusPill lifecycleState={errorState()} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'error');
    expect(screen.getByText(/Generation failed/i)).toBeInTheDocument();
  });

  it('transitions streaming → State B (transition) → State C (hint)', () => {
    const { rerender } = render(<GenerationStatusPill lifecycleState={streaming()} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'streaming');

    // Stream finishes — phase becomes viewing.
    rerender(<GenerationStatusPill lifecycleState={viewing()} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'transition');
    expect(screen.getByText(/All set! Bringing the editor in…/i)).toBeInTheDocument();

    // After 800ms, transitions to hint state.
    act(() => {
      jest.advanceTimersByTime(800);
    });
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'hint');
    expect(screen.getByText(/Try: "explain it like I'm 12" — AI editor/i)).toBeInTheDocument();
  });

  it('auto-dismisses hint after 3s', () => {
    const { rerender } = render(<GenerationStatusPill lifecycleState={streaming()} />);
    rerender(<GenerationStatusPill lifecycleState={viewing()} />);
    act(() => {
      jest.advanceTimersByTime(800);
    });
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'hint');

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('dismiss button hides the pill immediately', () => {
    const { rerender } = render(<GenerationStatusPill lifecycleState={streaming()} />);
    rerender(<GenerationStatusPill lifecycleState={viewing()} />);
    act(() => {
      jest.advanceTimersByTime(800);
    });

    const dismiss = screen.getByTestId('generation-status-pill-dismiss');
    fireEvent.click(dismiss);
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('does NOT show transition/hint on direct navigation (idle → viewing, no loading phase)', () => {
    // Direct navigation to an existing explanation: loadExplanation dispatches
    // LOAD_EXPLANATION (idle → viewing) without going through 'loading'.
    const { rerender } = render(<GenerationStatusPill lifecycleState={idle()} />);
    rerender(<GenerationStatusPill lifecycleState={viewing()} />);
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('shows transition/hint for instant cached-match queries (loading → viewing, no observable streaming)', () => {
    // When a query matches a cached explanation, React may batch the
    // loading → streaming → viewing transitions into one render so the
    // effect never observes 'streaming'. Priming wasStreamingRef during
    // 'loading' ensures the post-stream hint still fires for the user.
    const { rerender } = render(<GenerationStatusPill lifecycleState={idle()} />);
    rerender(<GenerationStatusPill lifecycleState={loading()} />);
    rerender(<GenerationStatusPill lifecycleState={viewing()} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'transition');
    act(() => {
      jest.advanceTimersByTime(800);
    });
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'hint');
  });

  it('respects prefers-reduced-motion via motion-safe Tailwind class', () => {
    render(<GenerationStatusPill lifecycleState={streaming()} />);
    expect(screen.getByTestId('generation-status-pill').className).toContain('motion-safe:animate-fade-up');
  });

  it('does not re-trigger transition after hint dismissed and viewing stays', () => {
    const { rerender } = render(<GenerationStatusPill lifecycleState={streaming()} />);
    rerender(<GenerationStatusPill lifecycleState={viewing()} />);
    act(() => {
      jest.advanceTimersByTime(800);
    });
    const dismiss = screen.getByTestId('generation-status-pill-dismiss');
    fireEvent.click(dismiss);

    // Re-render with same viewing state — should stay hidden, not re-show transition.
    rerender(<GenerationStatusPill lifecycleState={viewing()} />);
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('aria-live polite for accessibility', () => {
    render(<GenerationStatusPill lifecycleState={streaming()} />);
    const pill = screen.getByTestId('generation-status-pill');
    expect(pill).toHaveAttribute('role', 'status');
    expect(pill).toHaveAttribute('aria-live', 'polite');
  });
});
