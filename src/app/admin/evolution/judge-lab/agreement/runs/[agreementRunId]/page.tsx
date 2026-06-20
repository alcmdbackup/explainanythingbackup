// Judge Lab → Agreement run detail. Loads the run's paired holistic↔rubric calls + per-criterion
// verdicts, slices by kind (Both/Article/Paragraph) and runs the pure computeAgreementMetrics reducer
// (matching the runs/[evalRunId] TS-reducer pattern). Renders the three TIE buckets + per-repeat,
// per-criterion agreement table, ground-truth accuracy, and a disagreement drill-down.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, MetricGrid } from '@evolution/components/evolution';
import {
  getAgreementRunDetailAction,
  findArenaComparisonForVariantsAction,
} from '@evolution/services/judgeEvalActions';
import {
  computeAgreementMetrics,
  type AgreementCallMetricsInput,
  type AgreementCriterionMetricsInput,
} from '@evolution/lib/judgeEval/agreementMetrics';

type Kind = 'article' | 'paragraph' | 'both';

interface CallRow {
  id: string;
  pair_label: string;
  pair_kind: 'article' | 'paragraph';
  repeat_index: number;
  holistic_winner: 'A' | 'B' | 'TIE';
  holistic_confidence: number;
  rubric_winner: 'A' | 'B' | 'TIE';
  rubric_confidence: number;
  gap_kind: 'large' | 'close' | null;
  expected_winner: 'A' | 'B' | null;
  error: string | null;
  variant_a_id: string | null;
  variant_b_id: string | null;
}
interface CriterionRow {
  agreement_call_id: string;
  criteria_name: string;
  weight: number;
  agrees_with_holistic: boolean | null;
  matches_ground_truth: boolean | null;
}
interface RunRow {
  id: string;
  judge_model: string;
  temperature: number;
  kind_filter: string;
  repeats: number;
}

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}

export default function AgreementRunDetailPage(): JSX.Element {
  const params = useParams<{ agreementRunId: string }>();
  const runId = params.agreementRunId;
  const [run, setRun] = useState<RunRow | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [criteria, setCriteria] = useState<CriterionRow[]>([]);
  const [viewKind, setViewKind] = useState<Kind>('both');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    document.title = 'Judge Lab · Agreement run';
    void (async () => {
      const res = await getAgreementRunDetailAction({ runId });
      setLoading(false);
      if (!res.success || !res.data) {
        toast.error(res.success ? 'Run not found' : res.error?.message ?? 'Failed to load run');
        return;
      }
      setRun(res.data.run as unknown as RunRow);
      setCalls(res.data.calls as unknown as CallRow[]);
      setCriteria(res.data.criterionVerdicts as unknown as CriterionRow[]);
    })();
  }, [runId]);

  // Error-free calls of the selected kind + their criterion rows → the reducer.
  const { metrics, disagreements } = useMemo(() => {
    const errorFree = calls.filter((c) => c.error == null);
    const kindCalls = viewKind === 'both' ? errorFree : errorFree.filter((c) => c.pair_kind === viewKind);
    const callInputs: AgreementCallMetricsInput[] = kindCalls.map((c) => ({
      pair_label: c.pair_label,
      repeat_index: c.repeat_index,
      holistic_winner: c.holistic_winner,
      holistic_confidence: c.holistic_confidence,
      rubric_winner: c.rubric_winner,
      rubric_confidence: c.rubric_confidence,
      gap_kind: c.gap_kind,
      expected_winner: c.expected_winner,
    }));
    const kindCallIds = new Set(kindCalls.map((c) => c.id));
    const critInputs: AgreementCriterionMetricsInput[] = criteria
      .filter((cv) => kindCallIds.has(cv.agreement_call_id))
      .map((cv) => ({
        criteria_name: cv.criteria_name,
        weight: cv.weight,
        agrees_with_holistic: cv.agrees_with_holistic,
        matches_ground_truth: cv.matches_ground_truth,
      }));
    // Both-decisive opposite-winner disagreements (the meaningful conflict).
    const disagreements = kindCalls.filter(
      (c) =>
        c.holistic_confidence > 0.6 &&
        c.rubric_confidence > 0.6 &&
        c.holistic_winner !== c.rubric_winner,
    );
    return { metrics: computeAgreementMetrics(callInputs, critInputs), disagreements };
  }, [calls, criteria, viewKind]);

  const openInMatchViewer = useCallback(async (c: CallRow) => {
    if (!c.variant_a_id || !c.variant_b_id) return toast.error('No variant ids on this row');
    const res = await findArenaComparisonForVariantsAction({ variantA: c.variant_a_id, variantB: c.variant_b_id });
    if (res.success && res.data?.comparisonId) {
      window.open(`/admin/evolution/matches/${res.data.comparisonId}`, '_blank');
    } else {
      toast.error('No matching arena comparison found');
    }
  }, []);

  const tiles = [
    { label: 'Per-pair agree', value: pct(metrics.perPairModalAgreeRate) },
    { label: 'Agree (both-dec)', value: pct(metrics.bothDecisiveAgreeRate) },
    { label: 'Abstain / diverge', value: pct(metrics.abstainDivergenceRate) },
    { label: 'Per-repeat agree', value: pct(metrics.perRepeatAgreeRate) },
  ];

  return (
    <div className="space-y-4 p-4">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Lab', href: '/admin/evolution/judge-lab' },
          { label: 'Agreement', href: '/admin/evolution/judge-lab/agreement' },
          { label: runId.slice(0, 8) },
        ]}
      />

      {run && (
        <p className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
          {run.judge_model} · temp {run.temperature} · {run.kind_filter} · {run.repeats} repeats
        </p>
      )}

      <div className="flex gap-1" data-testid="agreement-view-toggle">
        {(['both', 'article', 'paragraph'] as Kind[]).map((k) => (
          <button
            key={k}
            data-testid={`view-${k}`}
            className="text-xs px-2 py-1 rounded border"
            style={{
              borderColor: 'var(--border-default)',
              background: viewKind === k ? 'var(--accent-gold)' : 'transparent',
              color: viewKind === k ? 'var(--text-on-primary)' : 'var(--text-secondary)',
            }}
            onClick={() => setViewKind(k)}
          >
            {k}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm font-ui" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      ) : (
        <div className="space-y-4" data-testid={`kind-block-${viewKind}`}>
          <div className="rounded-book paper-texture card-enhanced p-4 space-y-2">
            <div className="text-sm font-ui font-semibold">Rubric ↔ Holistic agreement ({metrics.n} calls)</div>
            <MetricGrid metrics={tiles} columns={4} variant="card" testId="agreement-metrics" />
            <p className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
              Both decisive &amp; opposite: rubric A / holistic B {pct(metrics.rubricAHolisticBRate)} ·
              rubric B / holistic A {pct(metrics.rubricBHolisticARate)}
            </p>
          </div>

          {/* Per-criterion agreement */}
          <div className="rounded-book paper-texture card-enhanced p-4 space-y-2">
            <div className="text-sm font-ui font-semibold">Per-criterion agreement with holistic winner</div>
            <table className="w-full text-xs font-ui" data-testid="per-criterion-table">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left py-1">Criterion</th>
                  <th className="text-right">Weight</th>
                  <th className="text-right">Agree</th>
                  <th className="text-right">Disagree</th>
                  <th className="text-right">Abstain</th>
                  <th className="text-right">GT-Acc</th>
                </tr>
              </thead>
              <tbody>
                {metrics.perCriterion.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-2" style={{ color: 'var(--text-muted)' }}>
                      No criterion verdicts for this view.
                    </td>
                  </tr>
                )}
                {metrics.perCriterion.map((c) => (
                  <tr key={c.name} data-testid="per-criterion-row">
                    <td className="py-1">{c.name}</td>
                    <td className="text-right">{c.weight.toFixed(2)}</td>
                    <td className="text-right">{pct(c.agreeRate)}</td>
                    <td className="text-right">{pct(c.disagreeRate)}</td>
                    <td className="text-right">{pct(c.abstainRate)}</td>
                    <td className="text-right">{pct(c.groundTruthAccuracy)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td className="py-1">Aggregated rubric</td>
                  <td className="text-right">—</td>
                  <td className="text-right">{pct(metrics.bothDecisiveAgreeRate)}</td>
                  <td className="text-right">{pct(metrics.bothDecisiveOppositeRate)}</td>
                  <td className="text-right">—</td>
                  <td className="text-right">—</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Ground-truth accuracy */}
          <div className="rounded-book paper-texture card-enhanced p-4">
            <div className="text-sm font-ui font-semibold mb-2">
              Accuracy vs Elo ground truth (large-gap pairs, n={metrics.nLargeGap})
            </div>
            <MetricGrid
              metrics={[
                { label: 'Holistic judge', value: pct(metrics.holisticAccuracy) },
                { label: 'Rubric judge', value: pct(metrics.rubricAccuracy) },
                {
                  label: 'Δ (rubric − holistic)',
                  value: metrics.accuracyDelta == null ? '—' : pct(metrics.accuracyDelta),
                },
              ]}
              columns={3}
              variant="card"
              testId="agreement-accuracy"
            />
          </div>

          {/* Disagreement drill-down */}
          <div className="rounded-book paper-texture card-enhanced p-4 space-y-2">
            <div className="text-sm font-ui font-semibold">
              Disagreement pairs (both decisive, opposite winner) — {disagreements.length}
            </div>
            <table className="w-full text-xs font-ui" data-testid="disagree-table">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }}>
                  <th className="text-left py-1">Pair</th>
                  <th className="text-left">Kind</th>
                  <th className="text-left">Holistic</th>
                  <th className="text-left">Rubric</th>
                  <th className="text-left">GT</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {disagreements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-2" style={{ color: 'var(--text-muted)' }}>
                      No both-decisive disagreements in this view.
                    </td>
                  </tr>
                )}
                {disagreements.slice(0, 100).map((c) => (
                  <tr key={c.id} data-testid="disagree-row">
                    <td className="py-1">{c.pair_label}</td>
                    <td>{c.pair_kind}</td>
                    <td>
                      {c.holistic_winner} ({c.holistic_confidence.toFixed(1)})
                    </td>
                    <td>
                      {c.rubric_winner} ({c.rubric_confidence.toFixed(1)})
                    </td>
                    <td>{c.gap_kind === 'large' ? c.expected_winner ?? '—' : '—'}</td>
                    <td className="text-right">
                      <button
                        className="text-xs underline"
                        style={{ color: 'var(--accent-gold)' }}
                        onClick={() => void openInMatchViewer(c)}
                      >
                        Match Viewer ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
