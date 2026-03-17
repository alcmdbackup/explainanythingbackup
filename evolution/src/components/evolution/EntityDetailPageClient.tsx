// Config-driven detail page shell wrapping EntityDetailHeader + EntityDetailTabs.
// Handles data fetching, loading/error states, and tab rendering from config.

'use client';

import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, EntityDetailHeader, EntityDetailTabs, useTabState } from '@evolution/components/evolution';
import type { EntityLink, TabDef } from '@evolution/components/evolution';

// ─── Config types ────────────────────────────────────────────────

export interface DetailPageConfig<T> {
  /** Breadcrumb items (last one is auto-generated from title). */
  breadcrumbs: Array<{ label: string; href?: string }>;
  /** Extract title from loaded data. */
  title: (data: T) => string;
  /** Entity ID to display (short hash). */
  entityId?: (data: T) => string;
  /** Status badge to show in header. */
  statusBadge?: (data: T) => ReactNode;
  /** Cross-links to related entities. */
  links?: (data: T) => EntityLink[];
  /** Header action buttons. */
  actions?: (data: T, reload: () => void) => ReactNode;
  /** Optional rename handler. */
  onRename?: (data: T, newName: string) => Promise<void>;
  /** Tab definitions. */
  tabs: TabDef[];
  /** Render content for a given tab. */
  renderTabContent: (tabId: string, data: T) => ReactNode;
}

interface EntityDetailPageClientProps<T> {
  config: DetailPageConfig<T>;
  /** Async function to load entity data. Throws on error. */
  loadData: () => Promise<T>;
}

// ─── Component ───────────────────────────────────────────────────

export function EntityDetailPageClient<T>({
  config,
  loadData: loadDataFn,
}: EntityDetailPageClientProps<T>): JSX.Element {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useTabState(config.tabs);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadDataFn();
      setData(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [loadDataFn]);

  useEffect(() => { reload(); }, [reload]);

  if (loading) {
    return (
      <div className="space-y-6">
        <EvolutionBreadcrumb items={[...config.breadcrumbs, { label: 'Loading...' }]} />
        <div className="animate-pulse space-y-4">
          <div className="h-32 bg-[var(--surface-elevated)] rounded-book" />
          <div className="h-64 bg-[var(--surface-elevated)] rounded-book" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <EvolutionBreadcrumb items={[...config.breadcrumbs, { label: 'Error' }]} />
        <div className="rounded-book bg-[var(--status-error)]/10 border border-[var(--status-error)]/20 p-6 text-center">
          <p className="font-ui text-sm" style={{ color: 'var(--status-error)' }}>
            {error || 'Entity not found'}
          </p>
        </div>
      </div>
    );
  }

  const title = config.title(data);

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb items={[...config.breadcrumbs, { label: title }]} />

      <EntityDetailHeader
        title={title}
        entityId={config.entityId?.(data)}
        statusBadge={config.statusBadge?.(data)}
        links={config.links?.(data)}
        actions={config.actions?.(data, reload)}
        onRename={config.onRename ? (name) => config.onRename!(data, name).then(reload) : undefined}
      />

      <EntityDetailTabs
        tabs={config.tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {config.renderTabContent(activeTab, data)}
      </EntityDetailTabs>
    </div>
  );
}
