// Arena entry detail page. Shows full content text, elo stats, generation info, and run link.
// V2 schema: all elo data lives directly on the entry row.
'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  EvolutionBreadcrumb,
  EntityDetailHeader,
  MetricGrid,
} from '@evolution/components/evolution';
import {
  getArenaEntryDetailAction,
  type ArenaEntry,
} from '@evolution/services/arenaActions';

export default function ArenaEntryDetailPage(): JSX.Element {
  const { entryId } = useParams<{ entryId: string }>();
  const [entry, setEntry] = useState<ArenaEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const result = await getArenaEntryDetailAction(entryId);
      if (!result.success || !result.data) {
        setError(result.error?.message ?? 'Failed to load entry');
        setLoading(false);
        return;
      }
      setEntry(result.data);
      setLoading(false);
    }
    load();
  }, [entryId]);

  if (loading) {
    return (
      <div className="p-8 text-center text-sm font-ui text-[var(--text-muted)]">Loading...</div>
    );
  }

  if (error || !entry) {
    return (
      <div className="p-8 text-center text-sm font-ui text-[var(--status-error)]">
        {error ?? 'Entry not found'}
      </div>
    );
  }

  const links = entry.run_id
    ? [{ prefix: 'Run', label: entry.run_id.substring(0, 8), href: `/admin/evolution/invocations/${entry.run_id}` }]
    : undefined;

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Arena', href: '/admin/evolution/arena' },
          { label: 'Entry' },
        ]}
      />

      <EntityDetailHeader
        title="Arena Entry"
        entityId={entry.id}
        links={links}
      />

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 space-y-4 shadow-warm-lg">
        <h2 className="text-2xl font-display font-bold text-[var(--text-primary)]">Elo Stats</h2>
        <MetricGrid
          metrics={[
            { label: 'Elo Rating', value: entry.elo_rating },
            { label: 'Mu', value: entry.mu.toFixed(2) },
            { label: 'Sigma', value: entry.sigma.toFixed(2) },
            { label: 'Matches', value: entry.match_count },
          ]}
          columns={4}
          variant="card"
        />
      </div>

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 space-y-4 shadow-warm-lg">
        <h2 className="text-2xl font-display font-bold text-[var(--text-primary)]">Generation Info</h2>
        <MetricGrid
          metrics={[
            { label: 'Method', value: entry.generation_method },
            { label: 'Model', value: entry.model ?? 'N/A' },
            { label: 'Cost', value: entry.cost_usd != null ? `$${entry.cost_usd.toFixed(2)}` : 'N/A' },
          ]}
          columns={3}
          variant="card"
        />
      </div>

      <div className="bg-[var(--surface-elevated)] border border-[var(--border-default)] rounded-book p-6 shadow-warm-lg">
        <h2 className="text-2xl font-display font-bold text-[var(--text-primary)] mb-4">Content</h2>
        <div
          className="text-sm font-ui text-[var(--text-secondary)] whitespace-pre-wrap bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-page p-4"
          data-testid="entry-content"
        >
          {entry.content}
        </div>
      </div>

      {entry.run_id && (
        <div className="text-sm font-ui">
          <Link
            href={`/admin/evolution/invocations/${entry.run_id}`}
            className="text-[var(--accent-gold)] hover:underline"
            data-testid="run-link"
          >
            View associated run →
          </Link>
        </div>
      )}
    </div>
  );
}
