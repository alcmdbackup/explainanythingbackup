// Shared tab bar for detail pages with URL sync via useTabState hook. URL sync uses
// window.history.replaceState (not router.replace) to avoid aborting client fetches
// that run inside a freshly-mounted tab panel on Next.js 15 prod builds.
// Controlled component: parent owns activeTab state and conditional content rendering.

'use client';

import { useState, useCallback, useEffect, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

export interface TabDef {
  id: string;
  label: string;
}

export interface EntityDetailTabsProps {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  children: ReactNode;
}

export function EntityDetailTabs({
  tabs,
  activeTab,
  onTabChange,
  children,
}: EntityDetailTabsProps): JSX.Element {
  const handleKeyDown = (e: KeyboardEvent, index: number): void => {
    let nextIndex = index;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = tabs.length - 1;
    else return;
    e.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    onTabChange(nextTab.id);
    const el = document.querySelector(`[data-testid="tab-${nextTab.id}"]`) as HTMLElement | null;
    el?.focus();
  };

  return (
    <div>
      <div
        className="flex gap-1 border-b border-[var(--border-default)] mb-4"
        role="tablist"
        data-testid="tab-bar"
      >
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => onTabChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, i)}
            className={`px-4 py-2 text-sm font-medium font-ui border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'text-[var(--accent-gold)] border-[var(--accent-gold)]'
                : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            data-testid={`tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`tabpanel-${activeTab}`}
        aria-labelledby={`tab-${activeTab}`}
        data-testid="tab-content"
      >
        {children}
      </div>
    </div>
  );
}

export interface UseTabStateOptions {
  defaultTab?: string;
  syncToUrl?: boolean;
  legacyTabMap?: Record<string, string>;
}

export function useTabState(
  tabs: TabDef[],
  options?: UseTabStateOptions,
): [string, (tabId: string) => void] {
  const { defaultTab, syncToUrl = true, legacyTabMap } = options ?? {};
  const searchParams = useSearchParams();

  const resolveTab = useCallback((raw: string | null): string => {
    if (!raw) return defaultTab ?? tabs[0]?.id ?? '';
    if (legacyTabMap && raw in legacyTabMap) return legacyTabMap[raw]!;
    if (tabs.some((t) => t.id === raw)) return raw;
    return defaultTab ?? tabs[0]?.id ?? '';
  }, [tabs, defaultTab, legacyTabMap]);

  const initialTab = syncToUrl ? resolveTab(searchParams.get('tab')) : (defaultTab ?? tabs[0]?.id ?? '');
  const [activeTab, setActiveTabState] = useState(initialTab);

  // Update the URL's `?tab=` param WITHOUT triggering a Next.js soft-nav. `router.replace`
  // re-executes the RSC tree and aborts any in-flight client fetches (e.g.
  // `EntityMetricsTab`'s `useEffect`), leaving tabpanels permanently empty — a known
  // Next.js 15 race diagnosed in commit 7b1240bc. `window.history.replaceState` updates
  // only the browser URL; the server tree and in-flight fetches are untouched, and
  // bookmarks/reloads still resolve to the correct tab via `initialTab`.
  const updateUrlTab = useCallback((tabId: string) => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    params.set('tab', tabId);
    const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, '', next);
  }, []);

  // Redirect legacy tab params on mount.
  useEffect(() => {
    if (!syncToUrl) return;
    const raw = searchParams.get('tab');
    if (raw && legacyTabMap && raw in legacyTabMap) {
      updateUrlTab(legacyTabMap[raw]!);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabState(tabId);
    if (syncToUrl) updateUrlTab(tabId);
  }, [syncToUrl, updateUrlTab]);

  return [activeTab, setActiveTab];
}
