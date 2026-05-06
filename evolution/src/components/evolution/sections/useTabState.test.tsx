// Tests for useTabState hook: URL sync, legacy mapping, default tab selection.

import { renderHook, act } from '@testing-library/react';
import { useTabState, type TabDef } from './EntityDetailTabs';

let mockSearchParams = new URLSearchParams();
const mockReplaceState = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), prefetch: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/test',
}));

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs' },
  { id: 'config', label: 'Config' },
];

// useTabState calls window.history.replaceState to update the URL without triggering
// a Next.js soft-nav (which would abort in-flight client fetches). Spy on the method
// and drive the URL via history.replaceState() so assertions operate on the browser
// API we actually use.
const originalReplaceState = window.history.replaceState;
beforeAll(() => {
  window.history.replaceState = mockReplaceState as unknown as typeof window.history.replaceState;
});
afterAll(() => {
  window.history.replaceState = originalReplaceState;
});

function setLocationSearch(search: string): void {
  const href = `http://localhost/test${search ? `?${search}` : ''}`;
  originalReplaceState.call(window.history, null, '', href);
}

describe('useTabState', () => {
  beforeEach(() => {
    mockReplaceState.mockClear();
    mockSearchParams = new URLSearchParams();
    setLocationSearch('');
  });

  it('defaults to first tab when no URL param', () => {
    const { result } = renderHook(() => useTabState(TABS));
    expect(result.current[0]).toBe('overview');
  });

  it('reads initial tab from URL', () => {
    mockSearchParams = new URLSearchParams('tab=config');
    const { result } = renderHook(() => useTabState(TABS));
    expect(result.current[0]).toBe('config');
  });

  it('syncs tab change to URL via history.replaceState (no soft-nav)', () => {
    const { result } = renderHook(() => useTabState(TABS));
    act(() => result.current[1]('runs'));
    expect(result.current[0]).toBe('runs');
    expect(mockReplaceState).toHaveBeenCalledWith(null, '', expect.stringContaining('tab=runs'));
  });

  it('handles legacy tab mapping', () => {
    mockSearchParams = new URLSearchParams('tab=budget');
    const { result } = renderHook(() =>
      useTabState(TABS, { legacyTabMap: { budget: 'overview' } })
    );
    expect(result.current[0]).toBe('overview');
  });

  it('preserves other search params when updating tab', () => {
    mockSearchParams = new URLSearchParams('agent=improver&tab=overview');
    setLocationSearch('agent=improver&tab=overview');
    const { result } = renderHook(() => useTabState(TABS));
    act(() => result.current[1]('runs'));
    expect(mockReplaceState).toHaveBeenCalledWith(null, '', expect.stringContaining('agent=improver'));
  });

  it('uses defaultTab when specified', () => {
    const { result } = renderHook(() => useTabState(TABS, { defaultTab: 'config' }));
    expect(result.current[0]).toBe('config');
  });

  it('does not sync to URL when syncToUrl=false', () => {
    const { result } = renderHook(() => useTabState(TABS, { syncToUrl: false }));
    act(() => result.current[1]('runs'));
    expect(mockReplaceState).not.toHaveBeenCalled();
  });

  it('falls back to first tab for unknown URL param', () => {
    mockSearchParams = new URLSearchParams('tab=nonexistent');
    const { result } = renderHook(() => useTabState(TABS));
    expect(result.current[0]).toBe('overview');
  });
});
