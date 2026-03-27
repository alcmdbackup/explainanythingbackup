// Tests for useTabState hook: URL sync, legacy mapping, default tab selection.

import { renderHook, act } from '@testing-library/react';
import { useTabState, type TabDef } from './EntityDetailTabs';

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, prefetch: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/test',
}));

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'runs', label: 'Runs' },
  { id: 'config', label: 'Config' },
];

describe('useTabState', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockSearchParams = new URLSearchParams();
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

  it('syncs tab change to URL', () => {
    const { result } = renderHook(() => useTabState(TABS));
    act(() => result.current[1]('runs'));
    expect(result.current[0]).toBe('runs');
    expect(mockReplace).toHaveBeenCalledWith(expect.stringContaining('tab=runs'), { scroll: false });
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
    const { result } = renderHook(() => useTabState(TABS));
    act(() => result.current[1]('runs'));
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining('agent=improver'),
      { scroll: false }
    );
  });

  it('uses defaultTab when specified', () => {
    const { result } = renderHook(() => useTabState(TABS, { defaultTab: 'config' }));
    expect(result.current[0]).toBe('config');
  });

  it('does not sync to URL when syncToUrl=false', () => {
    const { result } = renderHook(() => useTabState(TABS, { syncToUrl: false }));
    act(() => result.current[1]('runs'));
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('falls back to first tab for unknown URL param', () => {
    mockSearchParams = new URLSearchParams('tab=nonexistent');
    const { result } = renderHook(() => useTabState(TABS));
    expect(result.current[0]).toBe('overview');
  });
});
