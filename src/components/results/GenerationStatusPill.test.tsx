/**
 * GenerationStatusPill unit tests.
 *
 * Covers phase→copy mapping; the streamFinished-driven transition (fires
 * the moment the SSE complete event arrives, not when phase becomes viewing);
 * the LOAD_EXPLANATION-driven advance from transition→hint; 3s auto-dismiss;
 * cached-match silence; reduced-motion class; and error state.
 */

import { render, screen, act } from '@testing-library/react';
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
  it('renders streaming state with the drafting copy', () => {
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

  it('renders error state on error phase', () => {
    render(<GenerationStatusPill lifecycleState={errorState()} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'error');
    expect(screen.getByText(/Generation failed/i)).toBeInTheDocument();
  });

  it('streaming → transition fires the moment streamFinished flips, NOT on phase change', () => {
    const { rerender } = render(<GenerationStatusPill lifecycleState={streaming()} streamFinished={false} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'streaming');

    // SSE complete event arrives — pill swaps to transition immediately, even
    // though the lifecycle phase is still 'streaming' (URL change + reload race
    // are still pending underneath).
    rerender(<GenerationStatusPill lifecycleState={streaming()} streamFinished={true} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'transition');
    expect(screen.getByText(/All set! Bringing the editor in…/i)).toBeInTheDocument();
  });

  it('transition → hint fires when phase reaches viewing (editor is on screen)', () => {
    const { rerender } = render(<GenerationStatusPill lifecycleState={streaming()} streamFinished={false} />);
    rerender(<GenerationStatusPill lifecycleState={streaming()} streamFinished={true} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'transition');

    // LOAD_EXPLANATION dispatches viewing — pill advances to hint.
    rerender(<GenerationStatusPill lifecycleState={viewing()} streamFinished={true} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'hint');
    expect(screen.getByText(/Try: "explain it like I'm 12" — AI editor/i)).toBeInTheDocument();
  });

  it('transition state HOLDS through the URL change race (idle/loading do not interrupt)', () => {
    // After streamFinished fires, results/page.tsx may briefly dispatch RESET
    // (→ idle) then loadExplanation (→ loading → viewing). The pill must not
    // flash hidden in between — the transition copy stays put.
    const { rerender } = render(<GenerationStatusPill lifecycleState={streaming()} streamFinished={true} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'transition');

    rerender(<GenerationStatusPill lifecycleState={idle()} streamFinished={true} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'transition');

    rerender(<GenerationStatusPill lifecycleState={loading()} streamFinished={true} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'transition');

    rerender(<GenerationStatusPill lifecycleState={viewing()} streamFinished={true} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'hint');
  });

  it('hint auto-dismisses 3s after entering', () => {
    const { rerender } = render(<GenerationStatusPill lifecycleState={streaming()} streamFinished={true} />);
    rerender(<GenerationStatusPill lifecycleState={viewing()} streamFinished={true} />);
    expect(screen.getByTestId('generation-status-pill')).toHaveAttribute('data-pill-state', 'hint');

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('stays hidden for cached-match queries (loading → viewing, no streamFinished signal)', () => {
    // Cached-match server path never emits streaming_start (no begin_streaming),
    // so phase never enters streaming, streamFinished never flips. Pill silent.
    const { rerender } = render(<GenerationStatusPill lifecycleState={idle()} streamFinished={false} />);
    rerender(<GenerationStatusPill lifecycleState={loading()} streamFinished={false} />);
    rerender(<GenerationStatusPill lifecycleState={viewing()} streamFinished={false} />);
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('stays hidden on direct navigation (idle → viewing)', () => {
    const { rerender } = render(<GenerationStatusPill lifecycleState={idle()} />);
    rerender(<GenerationStatusPill lifecycleState={viewing()} />);
    expect(screen.queryByTestId('generation-status-pill')).not.toBeInTheDocument();
  });

  it('respects prefers-reduced-motion via motion-safe Tailwind class', () => {
    render(<GenerationStatusPill lifecycleState={streaming()} />);
    expect(screen.getByTestId('generation-status-pill').className).toContain('motion-safe:animate-fade-up');
  });

  it('aria-live polite for accessibility', () => {
    render(<GenerationStatusPill lifecycleState={streaming()} />);
    const pill = screen.getByTestId('generation-status-pill');
    expect(pill).toHaveAttribute('role', 'status');
    expect(pill).toHaveAttribute('aria-live', 'polite');
  });

  it('renders plain text — no icon, no left border accent', () => {
    // Verify the visual refresh: no <svg> children, no border-l-* class on the
    // inner pill div. Icons and the colored left border were removed for a
    // cleaner, less ornamental presentation.
    const { container } = render(<GenerationStatusPill lifecycleState={streaming()} />);
    expect(container.querySelectorAll('svg')).toHaveLength(0);
    expect(container.querySelector('[class*="border-l-"]')).toBeNull();
  });
});
