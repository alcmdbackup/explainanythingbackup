// Judge Lab — Eval-run detail (Screen 2). Shows one settings cell's results against its test
// set: per-kind aggregate metrics (article vs paragraph) + a per-pair breakdown. Metrics are
// computed client-side from the persisted calls via the same pure reducer the CLI uses.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getEvalRunDetailAction } from '@evolution/services/judgeEvalActions';
import { computeMetrics } from '@evolution/lib/judgeEval/metrics';
import type { JudgeEvalCallCore } from '@evolution/lib/judgeEval/schemas';

type Kind = 'article' | 'paragraph';

interface RunRow {
  id: string;
  judge_model: string;
  temperature: number;
  reasoning_effort: string | null;
  kind_filter: string;
  prompt_variant: string | null;
  repeats: number;
}

// This page reads only the lightweight Core columns (verdict + metrics + ground-truth snapshot) —
// never the heavy audit payload (prompts/reasoning/raw), which the match-history view fetches per-row.
type RunCall = JudgeEvalCallCore;

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}

function KindBlock({ kind, calls }: { kind: Kind; calls: RunCall[] }): JSX.Element {
  const m = computeMetrics(calls);
  return (
    <div className="flex-1 min-w-[240px] space-y-1" data-testid={`kind-block-${kind}`}>
      <div className="text-sm font-semibold uppercase tracking-wide">{kind} ({calls.length})</div>
      <div className="text-xs grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span>decisive</span><span>{pct(m.decisiveRate)}</span>
        <span>agreement</span><span>{pct(m.selfConsistency)}</span>
        <span>avg conf</span><span>{m.avgConfidence.toFixed(2)}</span>
        <span>pos-bias</span><span>{pct(m.positionBiasRate)}</span>
        <span>accuracy*</span><span>{m.accuracy == null ? 'n/a' : pct(m.accuracy)}</span>
        <span>med wall</span><span>{m.medWallMs == null ? '—' : `${Math.round(m.medWallMs)} ms`}</span>
      </div>
    </div>
  );
}

export default function EvalRunDetailPage(): JSX.Element {
  const params = useParams<{ evalRunId: string }>();
  const runId = params.evalRunId;
  const [run, setRun] = useState<RunRow | null>(null);
  const [calls, setCalls] = useState<RunCall[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    const res = await getEvalRunDetailAction({ runId, kind: 'both' });
    if (res.success && res.data) {
      setRun(res.data.run as unknown as RunRow);
      setCalls(res.data.calls);
    } else if (!res.success) {
      toast.error(res.error?.message ?? 'Failed to load run');
    }
    setLoading(false);
  }, [runId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    document.title = 'Judge Lab · Run detail';
  }, []);

  const article = useMemo(() => calls.filter((c) => c.pair_kind === 'article'), [calls]);
  const paragraph = useMemo(() => calls.filter((c) => c.pair_kind === 'paragraph'), [calls]);

  // Per-pair summary (within whichever kinds are present).
  const perPair = useMemo(() => {
    const byLabel = new Map<string, RunCall[]>();
    for (const c of calls) {
      const arr = byLabel.get(c.pair_label) ?? [];
      arr.push(c);
      byLabel.set(c.pair_label, arr);
    }
    return [...byLabel.entries()].map(([label, cs]) => {
      const m = computeMetrics(cs);
      return { label, kind: cs[0]!.pair_kind, decisive: m.decisiveRate, conf: m.avgConfidence, n: cs.length };
    }).sort((a, b) => b.decisive - a.decisive);
  }, [calls]);

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Lab', href: '/admin/evolution/judge-lab' },
          { label: `Run ${runId?.substring(0, 8) ?? ''}` },
        ]}
      />
      {run && (
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-[var(--text-muted)] font-mono">
            {run.judge_model} · temp {run.temperature} · reasoning {run.reasoning_effort ?? 'none'} ·{' '}
            {run.prompt_variant ? 'custom rubric' : 'baseline rubric'} · repeats {run.repeats} · kind {run.kind_filter}
          </div>
          <Link
            className="text-xs underline whitespace-nowrap"
            data-testid="view-match-history"
            href={`/admin/evolution/judge-lab/runs/${runId}/matches`}
          >
            View match history →
          </Link>
        </div>
      )}

      <div className="rounded-book paper-texture card-enhanced p-4 flex gap-6 flex-wrap" data-testid="run-kind-aggregates">
        {loading && <span className="text-xs text-[var(--text-muted)]">Loading…</span>}
        {!loading && article.length > 0 && <KindBlock kind="article" calls={article} />}
        {!loading && paragraph.length > 0 && <KindBlock kind="paragraph" calls={paragraph} />}
        {!loading && calls.length === 0 && <span className="text-xs text-[var(--text-muted)]">No calls for this run.</span>}
      </div>

      <div className="rounded-book paper-texture card-enhanced p-4">
        <div className="text-sm font-semibold font-ui mb-2" role="heading" aria-level={2}>Per-pair</div>
        <table className="w-full text-xs" data-testid="per-pair-table">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1">Pair</th><th>Kind</th><th>Decisive</th><th>Avg conf</th><th>N</th>
            </tr>
          </thead>
          <tbody>
            {perPair.map((p) => (
              <tr key={p.label} className="border-t border-[var(--border-default)]" data-testid="per-pair-row">
                <td className="py-1 font-mono">{p.label}</td>
                <td>{p.kind}</td>
                <td>{pct(p.decisive)}</td>
                <td>{p.conf.toFixed(2)}</td>
                <td>{p.n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-[var(--text-muted)]">* accuracy uses large-gap pairs only (mu-gap ground truth); close pairs are tie-acceptable.</p>
    </div>
  );
}
