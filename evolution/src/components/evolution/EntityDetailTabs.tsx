// Shared tab bar for detail pages with URL sync via useTabState hook.
// Controlled component: parent owns activeTab state and conditional content rendering.

'use client';

import type { KeyboardEvent, ReactNode } from 'react';
import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

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
  const handleKeyDown = (e: KeyboardEvent, index: number) => {
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
  const router = useRouter();
  const searchParams = useSearchParams();

  const resolveTab = useCallback((raw: string | null): string => {
    if (!raw) return defaultTab ?? tabs[0]?.id ?? '';
    if (legacyTabMap && raw in legacyTabMap) return legacyTabMap[raw]!;
    if (tabs.some((t) => t.id === raw)) return raw;
    return defaultTab ?? tabs[0]?.id ?? '';
  }, [tabs, defaultTab, legacyTabMap]);

  const initialTab = syncToUrl ? resolveTab(searchParams.get('tab')) : (defaultTab ?? tabs[0]?.id ?? '');
  const [activeTab, setActiveTabState] = useState(initialTab);

  // Redirect legacy tab params on mount
  useEffect(() => {
    if (!syncToUrl) return;
    const raw = searchParams.get('tab');
    if (raw && legacyTabMap && raw in legacyTabMap) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', legacyTabMap[raw]!);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setActiveTab = useCallback((tabId: string) => {
    setActiveTabState(tabId);
    if (syncToUrl) {
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tabId);
      router.replace(`?${params.toString()}`, { scroll: false });
    }
  }, [syncToUrl, router, searchParams]);

  return [activeTab, setActiveTab];
}
