// Judge Lab → Agreement run detail. Loads the run's paired holistic↔rubric calls + per-criterion
// verdicts + server-side-derived position-bias aggregates, slices by kind, and runs the pure
// computeAgreementMetrics reducer. Renders 6 metric tiles (incl. holistic + rubric position bias),
// per-criterion agreement table with Wilson CIs, ground-truth accuracy, and a link to the full
// match-browse sub-route at /matches. Both-decisive opposite-winner disagreements are summarized
// with a count; full browsing happens on the matches page.

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { EvolutionBreadcrumb, MetricGrid } from '@evolution/components/evolution';
import { getAgreementRunDetailAction } from '@evolution/services/judgeEvalActions';
import {
  computeAgreementMetrics,
  type AgreementCallMetricsInput,
  type AgreementCriterionMetricsInput,
  type PositionBiasAggregates,
} from '@evolution/lib/judgeEval/agreementMetrics';
import type { WilsonInterval } from '@evolution/lib/shared/wilsonCI';

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
interface PositionBiasByKind {
  article: PositionBiasAggregates;
  paragraph: PositionBiasAggregates;
  both: PositionBiasAggregates;
}

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}
function pctWithCI(value: number | null, ci: WilsonInterval | null): string {
  if (value == null) return '—';
  const main = `${(value * 100).toFixed(0)}%`;
  if (!ci) return main;
  return `${main} [${(ci.low * 100).toFixed(0)}, ${(ci.high * 100).toFixed(0)}]`;
}

// Tooltip strings are inlined where used. MetricGrid does not accept per-tile title attributes today,
// so per-tile tooltips would require lifting the metric labels to wrapped spans — out of scope here.
// The <details>What do these mean?</summary> block above the tiles carries the canonical definitions.

export default function AgreementRunDetailPage(): JSX.Element {
  const params = useParams<{ agreementRunId: string }>();
  const runId = params.agreementRunId;
  const [run, setRun] = useState<RunRow | null>(null);
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [criteria, setCriteria] = useState<CriterionRow[]>([]);
  const [positionBias, setPositionBias] = useState<PositionBiasByKind | null>(null);
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
      setPositionBias(res.data.positionBias as PositionBiasByKind);
    })();
  }, [runId]);

  // Error-free calls of the selected kind + their criterion rows → the reducer.
  const { metrics, disagreementCount } = useMemo(() => {
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
    const bias = positionBias ? positionBias[viewKind] : undefined;
    // Both-decisive opposite-winner count (the meaningful conflict — surfaced as a count + link).
    const disagreementCount = kindCalls.filter(
      (c) =>
        c.holistic_confidence > 0.6 &&
        c.rubric_confidence > 0.6 &&
        c.holistic_winner !== c.rubric_winner,
    ).length;
    return { metrics: computeAgreementMetrics(callInputs, critInputs, bias), disagreementCount };
  }, [calls, criteria, viewKind, positionBias]);

  const tiles = [
    { label: 'Per-pair agreement', value: pctWithCI(metrics.perPairModalAgreeRate, metrics.perPairModalAgreeRateCi) },
    { label: 'Per-repeat agreement', value: pctWithCI(metrics.perRepeatAgreeRate, metrics.perRepeatAgreeRateCi) },
    { label: 'Both-decisive agreement', value: pctWithCI(metrics.bothDecisiveAgreeRate, metrics.bothDecisiveAgreeRateCi) },
    { label: 'Single-judge abstain', value: pctWithCI(metrics.abstainDivergenceRate, metrics.abstainDivergenceRateCi) },
    { label: 'Holistic position bias', value: pctWithCI(metrics.holisticPositionBiasRate, metrics.holisticPositionBiasRateCi) },
    { label: 'Rubric position bias', value: pctWithCI(metrics.rubricPositionBiasRate, metrics.rubricPositionBiasRateCi) },
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

      <div className="flex items-center justify-between">
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
        <Link
          data-testid="agreement-view-all-matches"
          href={`/admin/evolution/judge-lab/agreement/runs/${runId}/matches`}
          className="text-xs underline"
          style={{ color: 'var(--accent-gold)' }}
        >
          View all matches →
        </Link>
      </div>

      <details data-testid="agreement-definitions" className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
        <summary className="cursor-pointer">What do these mean?</summary>
        <ul className="mt-2 space-y-1 pl-4 list-disc">
          <li>
            <strong>Per-repeat agreement</strong> — Fraction of (pair × repeat) calls where rubric winner equals holistic
            winner. Strict — no decisive filter.
          </li>
          <li>
            <strong>Per-pair (modal) agreement</strong> — Reduce each judge to its modal winner per pair, compare once per pair.
            Smooths over per-call noise.
          </li>
          <li>
            <strong>Both-decisive agreement</strong> — Among calls where both judges had confidence &gt; 0.6, fraction that agreed.
          </li>
          <li>
            <strong>Single-judge abstain</strong> — Fraction of calls where exactly one judge was decisive (the other abstained
            / returned TIE).
          </li>
          <li>
            <strong>Holistic / Rubric position bias</strong> — Fraction of calls where forward-pass and reverse-pass picked
            different winners. High values indicate the judge&apos;s verdict depends on text ordering.
          </li>
          <li>
            <strong>[low, high]</strong> — 95% Wilson score interval (binomial CI on the proportion).
          </li>
        </ul>
      </details>

      {loading ? (
        <p className="text-sm font-ui" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      ) : (
        <div className="space-y-4" data-testid={`kind-block-${viewKind}`}>
          <div className="rounded-book paper-texture card-enhanced p-4 space-y-2">
            <div className="text-sm font-ui font-semibold">
              Rubric ↔ Holistic agreement ({metrics.n} calls)
            </div>
            <MetricGrid metrics={tiles} columns={3} variant="card" testId="agreement-metrics" />
            <p className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
              Both decisive &amp; opposite: rubric A / holistic B {pct(metrics.rubricAHolisticBRate)} · rubric B / holistic A{' '}
              {pct(metrics.rubricBHolisticARate)}
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
                  <th className="text-right" title="Fraction of decided rows where this criterion agreed with the holistic winner.">Agree</th>
                  <th className="text-right" title="Fraction of decided rows where this criterion disagreed with the holistic winner.">Disagree</th>
                  <th className="text-right" title="Fraction of rows where this criterion abstained (TIE / unparsed). Excluded from Agree/Disagree denominators.">Abstain</th>
                  <th className="text-right" title="Among large-gap decisive rows, fraction matching the Elo ground truth.">GT-Acc</th>
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
                    <td className="text-right">{pctWithCI(c.agreeRate, c.agreeRateCi)}</td>
                    <td className="text-right">{pctWithCI(c.disagreeRate, c.disagreeRateCi)}</td>
                    <td className="text-right">{pctWithCI(c.abstainRate, c.abstainRateCi)}</td>
                    <td className="text-right">{pctWithCI(c.groundTruthAccuracy, c.groundTruthAccuracyCi)}</td>
                  </tr>
                ))}
                <tr style={{ fontWeight: 600 }}>
                  <td className="py-1">Aggregated rubric</td>
                  <td className="text-right">—</td>
                  <td className="text-right">{pctWithCI(metrics.bothDecisiveAgreeRate, metrics.bothDecisiveAgreeRateCi)}</td>
                  <td className="text-right">{pctWithCI(metrics.bothDecisiveOppositeRate, metrics.bothDecisiveOppositeRateCi)}</td>
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
                { label: 'Holistic judge', value: pctWithCI(metrics.holisticAccuracy, metrics.holisticAccuracyCi) },
                { label: 'Rubric judge', value: pctWithCI(metrics.rubricAccuracy, metrics.rubricAccuracyCi) },
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

          {/* Disagreement summary + link to /matches */}
          <div className="rounded-book paper-texture card-enhanced p-4 space-y-2">
            <div className="text-sm font-ui font-semibold">Both-decisive disagreement pairs</div>
            <p className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
              {disagreementCount} both-decisive opposite-winner call{disagreementCount === 1 ? '' : 's'} in this view.{' '}
              <Link
                data-testid="agreement-view-disagreements"
                href={`/admin/evolution/judge-lab/agreement/runs/${runId}/matches?disagree=1`}
                className="underline"
                style={{ color: 'var(--accent-gold)' }}
              >
                Browse them in the match-history view →
              </Link>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
