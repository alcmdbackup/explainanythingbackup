// Judge Lab — Test Set contents (view-only). Shows a frozen test set's metadata + its member
// pairs (display Elo + Elo-gap, NOT raw mu) with the two snapshot texts fetched lazily per row.
// Read-only: membership is frozen (the comparability anchor for eval runs); editing is metadata
// -only and cloning is the only safe membership-change path (see the test-sets list page).
'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import {
  getTestSetContentsAction,
  getTestSetPairTextsAction,
} from '@evolution/services/judgeEvalActions';
import CloneCuratePanel from './CloneCuratePanel';

type Kind = 'article' | 'paragraph' | 'both';

interface ContentPair {
  label: string;
  pair_kind: string;
  elo_a: number | null;
  elo_b: number | null;
  uncertainty_a: number | null;
  uncertainty_b: number | null;
  elo_gap: number | null;
  expected_winner: 'A' | 'B' | null;
  gap_kind: string | null;
  baseline_confidence: number | null;
}

interface Contents {
  testSet: {
    id: string;
    name: string;
    description: string | null;
    strategy: string;
    seed: number;
    size_article: number;
    size_paragraph: number;
  };
  pairs: ContentPair[];
  memberCount: number;
  resolvedCount: number;
  orphanCount: number;
}

function elo(v: number | null, u: number | null): string {
  if (v == null) return '—';
  return u == null ? `${v}` : `${v} ± ${u}`;
}
function conf(v: number | null): string {
  return v == null ? '—' : v.toFixed(2);
}

export default function TestSetContentsPage(): JSX.Element {
  const params = useParams<{ testSetId: string }>();
  const testSetId = params.testSetId;
  const [kind, setKind] = useState<Kind>('both');
  const [data, setData] = useState<Contents | null>(null);
  const [loading, setLoading] = useState(true);
  const [texts, setTexts] = useState<Record<string, { text_a: string; text_b: string }>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [curating, setCurating] = useState(false);

  useEffect(() => {
    if (data?.testSet.name) document.title = `${data.testSet.name} | Test Set | Judge Lab`;
  }, [data?.testSet.name]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getTestSetContentsAction({ testSetId, kind });
    setLoading(false);
    if (!res.success) {
      toast.error(res.error?.message ?? 'Failed to load test set');
      return;
    }
    setData(res.data as Contents);
  }, [testSetId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleRow = useCallback(
    async (label: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      });
      if (!texts[label]) {
        const res = await getTestSetPairTextsAction({ testSetId, pairLabel: label });
        if (res.success && res.data) {
          setTexts((prev) => ({ ...prev, [label]: res.data as { text_a: string; text_b: string } }));
        } else {
          toast.error(res.error?.message ?? 'Failed to load pair texts');
        }
      }
    },
    [testSetId, texts],
  );

  return (
    <div className="space-y-4">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Lab', href: '/admin/evolution/judge-lab' },
          { label: 'Test Sets', href: '/admin/evolution/judge-lab/test-sets' },
          { label: data?.testSet.name ?? 'Test set' },
        ]}
      />

      {data && (
        <div className="text-xs text-[var(--text-muted)] font-ui space-y-1">
          <div>
            <span className="font-semibold text-[var(--text-default)]">{data.testSet.name}</span>
            {data.testSet.description ? ` — ${data.testSet.description}` : ''}
          </div>
          <div>
            strategy: {data.testSet.strategy} · seed: {data.testSet.seed} · sizes:{' '}
            {data.testSet.size_article} article / {data.testSet.size_paragraph} paragraph · members:{' '}
            {data.memberCount} · resolved: {data.resolvedCount}
          </div>
          {data.orphanCount > 0 && (
            <div className="text-[var(--accent-warning,#b45309)]" data-testid="orphan-warning">
              ⚠ {data.orphanCount} frozen member(s) no longer resolve in the pair-bank (the bank was
              re-seeded since this set was frozen). Those pairs are omitted below.
            </div>
          )}
        </div>
      )}

      <div>
        <button
          data-testid="open-clone-curate"
          className="text-xs px-3 py-1.5 rounded border border-[var(--border-default)]"
          onClick={() => setCurating((v) => !v)}
        >
          {curating ? 'Close Clone & curate' : 'Clone & curate ▸'}
        </button>
      </div>

      {curating && data && (
        <CloneCuratePanel
          testSetId={testSetId}
          sourceName={data.testSet.name}
          onCloned={() => setCurating(false)}
        />
      )}

      <div className="flex items-center gap-2 text-xs font-ui">
        <span className="text-[var(--text-muted)]">Kind:</span>
        {(['both', 'article', 'paragraph'] as const).map((k) => (
          <button
            key={k}
            data-testid={`kind-${k}`}
            className={`px-2 py-1 rounded border ${
              kind === k ? 'border-[var(--accent-gold)]' : 'border-[var(--border-default)]'
            }`}
            onClick={() => setKind(k)}
          >
            {k}
          </button>
        ))}
      </div>

      <table className="w-full text-xs" data-testid="test-set-pairs-table">
        <thead>
          <tr className="text-left text-[var(--text-muted)]">
            <th className="py-1">Pair</th>
            <th>Kind</th>
            <th>Elo A</th>
            <th>Elo B</th>
            <th>Elo gap</th>
            <th>Gap</th>
            <th>Expected</th>
            <th>Base conf</th>
            <th>Texts</th>
          </tr>
        </thead>
        <tbody>
          {loading && (
            <tr><td colSpan={9} className="py-3 text-[var(--text-muted)]">Loading…</td></tr>
          )}
          {!loading && data && data.pairs.length === 0 && (
            <tr><td colSpan={9} className="py-3 text-[var(--text-muted)]">No pairs for this kind.</td></tr>
          )}
          {!loading &&
            data?.pairs.map((p) => (
              <Fragment key={p.label}>
                <tr data-testid="pair-row" className="border-t border-[var(--border-default)]">
                  <td className="py-1 font-mono">{p.label}</td>
                  <td>{p.pair_kind}</td>
                  <td>{elo(p.elo_a, p.uncertainty_a)}</td>
                  <td>{elo(p.elo_b, p.uncertainty_b)}</td>
                  <td>{p.elo_gap ?? '—'}</td>
                  <td>{p.gap_kind ?? '—'}</td>
                  <td>{p.expected_winner ?? 'tie-acceptable'}</td>
                  <td>{conf(p.baseline_confidence)}</td>
                  <td>
                    <button
                      className="underline text-[var(--accent-gold)]"
                      data-testid="toggle-texts"
                      onClick={() => void toggleRow(p.label)}
                    >
                      {expanded.has(p.label) ? 'hide' : 'view'}
                    </button>
                  </td>
                </tr>
                {expanded.has(p.label) && (
                  <tr className="bg-[var(--bg-secondary)]">
                    <td colSpan={9} className="p-2">
                      {texts[p.label] ? (
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <div className="font-semibold mb-1">Text A</div>
                            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{texts[p.label]!.text_a}</pre>
                          </div>
                          <div>
                            <div className="font-semibold mb-1">Text B</div>
                            <pre className="whitespace-pre-wrap break-words font-mono text-xs">{texts[p.label]!.text_b}</pre>
                          </div>
                        </div>
                      ) : (
                        <span className="text-[var(--text-muted)]">Loading texts…</span>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
        </tbody>
      </table>

      <Link className="text-xs underline text-[var(--text-muted)]" href="/admin/evolution/judge-lab/test-sets">
        ← Back to test sets
      </Link>
    </div>
  );
}
