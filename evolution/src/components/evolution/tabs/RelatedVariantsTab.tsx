// Shared "Variants" tab for Run and Invocation detail pages.
// Fetches and displays variants related to a parent entity using EntityTable.

'use client';

import { useEffect, useState } from 'react';
import { EntityTable, type ColumnDef } from '../EntityTable';
import { buildVariantDetailUrl } from '@evolution/lib/utils/evolutionUrls';
import { listVariantsAction, type VariantListEntry } from '@evolution/services/evolutionActions';

export type RelatedVariantsTabProps =
  | { runId: string; invocationId?: never }
  | { invocationId: string; runId?: never };

const COLUMNS: ColumnDef<VariantListEntry>[] = [
  {
    key: 'id',
    header: 'Variant',
    render: (v) => <span className="font-mono">{v.id.substring(0, 8)}…</span>,
  },
  {
    key: 'agent',
    header: 'Agent',
    render: (v) => v.agent_name,
  },
  {
    key: 'elo',
    header: 'Elo',
    align: 'right',
    sortable: true,
    render: (v) => v.elo_score.toFixed(0),
  },
  {
    key: 'generation',
    header: 'Gen',
    align: 'right',
    render: (v) => v.generation,
  },
  {
    key: 'winner',
    header: 'Winner',
    align: 'center',
    render: (v) =>
      v.is_winner ? (
        <span className="inline-flex items-center px-1.5 py-0.5 text-xs font-medium rounded-full border border-[var(--status-success)] text-[var(--status-success)]">
          Winner
        </span>
      ) : null,
  },
  {
    key: 'created',
    header: 'Created',
    align: 'right',
    render: (v) => new Date(v.created_at).toLocaleDateString(),
  },
];

export function RelatedVariantsTab(props: RelatedVariantsTabProps): JSX.Element {
  const [variants, setVariants] = useState<VariantListEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const runId = props.runId ?? undefined;
  const invocationId = props.invocationId ?? undefined;
  const entityId = runId ?? invocationId;

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      // invocationId filtering is not yet supported by listVariantsAction;
      // when invocationId is provided, all variants are fetched (unfiltered).
      const filter = runId ? { runId } : {};
      const res = await listVariantsAction(filter);
      if (res.success && res.data) {
        setVariants(res.data.items);
      }
      setLoading(false);
    }
    load();
  }, [entityId, runId]);

  return (
    <EntityTable
      columns={COLUMNS}
      items={variants}
      loading={loading}
      getRowHref={(v) => buildVariantDetailUrl(v.id)}
      emptyMessage="No variants found."
      emptySuggestion="Variants will appear here as the run progresses."
      testId="related-variants"
    />
  );
}
