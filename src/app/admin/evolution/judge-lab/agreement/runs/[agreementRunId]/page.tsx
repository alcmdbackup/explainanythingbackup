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
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
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

// Tile = label + value/CI + always-visible formula. Self-documenting: the formula text makes the
// exact computation unambiguous so operators don't need to consult docs. (We deliberately do NOT
// use MetricGrid here — MetricGrid hides the description behind a hover-only tooltip and lacks
// space for the formula line.) Formulas use plain-language pseudo-SQL — `count(condition) / count(*)`
// over the error-free per-(pair × repeat) call set, kind-filtered.
function Tile({
  label,
  value,
  formula,
  testId,
}: {
  label: string;
  value: string;
  formula: string;
  testId?: string;
}): JSX.Element {
  return (
    <div
      className="p-3 bg-[var(--surface-elevated)] rounded-page space-y-1"
      data-testid={testId}
    >
      <div className="text-xs font-ui text-[var(--text-muted)] uppercase tracking-wide">{label}</div>
      <div className="text-sm font-mono text-[var(--text-primary)]">{value}</div>
      <div className="text-xs font-mono italic text-[var(--text-muted)] leading-tight">{formula}</div>
    </div>
  );
}

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

  // Each tile carries its computation as a small formula line so the metric is unambiguous
  // without consulting docs. Formulas are evaluated over the error-free per-(pair × repeat)
  // call set, kind-filtered. "committed" = confidence > 0.6 AND winner ∈ {A, B}.
  const tiles: Array<{ label: string; value: string; formula: string; testId: string }> = [
    {
      label: 'Per-pair (most-common) agreement',
      value: pctWithCI(metrics.perPairModalAgreeRate, metrics.perPairModalAgreeRateCi),
      formula: 'pairs where most-common(rubric_winner) = most-common(holistic_winner) / total pairs · TIE=TIE counts as agreement · collapses N repeats into one verdict per judge',
      testId: 'tile-per-pair',
    },
    {
      label: 'Per-repeat agreement',
      value: pctWithCI(metrics.perRepeatAgreeRate, metrics.perRepeatAgreeRateCi),
      formula: 'calls where rubric_winner = holistic_winner / total calls · TIE=TIE counts as agreement · no decisive filter',
      testId: 'tile-per-repeat',
    },
    {
      label: 'Both-decisive agreement',
      value: pctWithCI(metrics.bothDecisiveAgreeRate, metrics.bothDecisiveAgreeRateCi),
      formula: 'calls where rubric_winner = holistic_winner AND both confidence > 0.6 / calls where both confidence > 0.6 · mutual TIE@>0.6 counts as agreement',
      testId: 'tile-both-decisive',
    },
    {
      label: 'Single-judge abstain',
      value: pctWithCI(metrics.abstainDivergenceRate, metrics.abstainDivergenceRateCi),
      formula: 'calls where exactly one judge is committed to A or B / total calls · committed = confidence > 0.6 AND winner ∈ {A, B} · mutual TIE does NOT count as divergence',
      testId: 'tile-abstain',
    },
    {
      label: 'Holistic position bias',
      value: pctWithCI(metrics.holisticPositionBiasRate, metrics.holisticPositionBiasRateCi),
      formula: 'calls where holistic_forward_winner ≠ holistic_reverse_winner / calls where both passes parsed · derived server-side from stored raws',
      testId: 'tile-holistic-pos-bias',
    },
    {
      label: 'Rubric position bias',
      value: pctWithCI(metrics.rubricPositionBiasRate, metrics.rubricPositionBiasRateCi),
      formula: 'calls where rubric_forward_winner ≠ rubric_reverse_winner / calls where both passes parsed · derived server-side from stored raws',
      testId: 'tile-rubric-pos-bias',
    },
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

      <details data-testid="agreement-methodology" className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
        <summary className="cursor-pointer">How this run was scored (methodology)</summary>
        <div className="mt-3 space-y-3 pl-1">
          <section>
            <p className="font-semibold text-[var(--text-secondary)]">The end-to-end flow</p>
            <ol className="mt-1 space-y-1 pl-5 list-decimal">
              <li>
                <strong>Pick pairs.</strong> The run draws a fixed set of (variant_a, variant_b) <strong>pairs</strong> from the frozen test set (filtered to the chosen Kind: article, paragraph, or both). Same pairs across all repeats — nothing is re-sampled.
              </li>
              <li>
                <strong>Judge each pair N times.</strong> Each pair is judged <code>repeats</code> times. One <strong>repeat</strong> = 4 LLM calls: 2 holistic (forward + reverse text order) + 2 rubric (forward + reverse).
              </li>
              <li>
                <strong>Reconcile each repeat into one verdict per side.</strong> The 2 holistic calls are merged into a single holistic_winner (A/B/TIE) + confidence using the standard 2-pass reversal rule. The 2 rubric calls are merged the same way into a rubric_winner + confidence. Result: each (pair × repeat) call has exactly one holistic_winner and one rubric_winner.
              </li>
              <li>
                <strong>Compare holistic vs rubric.</strong> All the agreement metrics on this page are functions of those paired (holistic_winner, rubric_winner) verdicts, computed at two granularities (per-repeat = each call counted separately; per-pair = collapse N repeats into one most-common winner per judge, then compare once per pair). Position-bias metrics dig deeper and look at the forward-pass and reverse-pass winners separately.
              </li>
              <li>
                <strong>Compare against ground truth.</strong> On <strong>large-gap pairs</strong> only (Elo gap wide enough to declare a winner), we know which side was supposed to win. The ground-truth panel measures how often each judge&apos;s <em>committed</em> verdict (A or B, conf &gt; 0.6) matched. High-confidence TIEs are abstentions, NOT wrong guesses — they don&apos;t count against accuracy.
              </li>
              <li>
                <strong>Decompose the rubric.</strong> The per-criterion table breaks down what each individual rubric criterion was saying, so you can see whether one dimension is dragging the aggregate around.
              </li>
            </ol>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Per-pair vs per-repeat — when each is useful</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li>
                <strong>Per-repeat agreement</strong> treats every (pair × repeat) call independently. Denominator = total calls. Best for measuring raw judge-vs-judge alignment including all the per-call noise.
              </li>
              <li>
                <strong>Per-pair (most-common) agreement</strong> first collapses each judge&apos;s N verdicts on a pair into its most-common winner, then compares once per pair. Denominator = total pairs. Best for asking &ldquo;ignoring per-call noise, do the two judges land on the same overall winner for each pair?&rdquo;
              </li>
              <li>
                When <code>repeats = 1</code>, the two metrics are identical (only one verdict to take the most-common of). The bigger <code>repeats</code> is, the more per-pair smooths over judge variance and the more the two numbers can diverge.
              </li>
              <li>
                Worked example with 5 repeats on one pair where holistic_winners = [A, A, A, TIE, A] and rubric_winners = [A, A, B, A, TIE]: per-repeat scores 3/5 (the 3 rows where they match), per-pair scores 1/1 (A vs A — most-common on both sides is A).
              </li>
            </ul>
          </section>
        </div>
      </details>

      <details data-testid="agreement-definitions" className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
        <summary className="cursor-pointer">Glossary — every term on this page</summary>
        <div className="mt-3 space-y-3 pl-1">
          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Core concepts</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li>
                <strong>Holistic judge</strong> — Judges the two texts against a single overall A/B/TIE prompt (no per-criterion breakdown).
              </li>
              <li>
                <strong>Rubric judge</strong> — Judges each criterion separately, then weights the per-criterion verdicts into one overall A/B/TIE decision.
              </li>
              <li>
                <strong>2-pass A/B reversal</strong> — Every judge call is made twice: forward shows (Text A, Text B); reverse swaps them. The two passes are reconciled into one verdict + confidence.
              </li>
              <li>
                <strong>confidence</strong> — 1.0 both passes agreed · 0.7 one TIE + one winner · 0.5 they disagreed on a winner (forced TIE) · 0.3 one pass returned nothing · 0.0 both failed.
              </li>
              <li>
                <strong>committed</strong> — A call where confidence &gt; 0.6 AND the winner is A or B (not TIE). The right denominator for accuracy / abstain-divergence.
              </li>
              <li>
                <strong>decisive / confident</strong> — A call where confidence &gt; 0.6 regardless of winner. A high-confidence TIE is &quot;confident&quot; but NOT &quot;committed&quot; — it&apos;s an abstention.
              </li>
              <li>
                <strong>TIE</strong> — Verdict meaning &quot;neither text wins&quot;. Includes both genuine ties and &quot;couldn&apos;t pick&quot; outcomes.
              </li>
              <li>
                <strong>abstention</strong> — A TIE verdict. Excluded from accuracy denominators (a TIE on a known A/B pair is not a wrong guess).
              </li>
              <li>
                <strong>repeat</strong> — One full 4-call cycle (2 holistic + 2 rubric) for a single pair. Each pair is judged N times where N = the run&apos;s <code>repeats</code> setting.
              </li>
              <li>
                <strong>pair</strong> — One (variant_a, variant_b) comparison drawn from the test set.
              </li>
              <li>
                <strong>kind</strong> — <code>article</code> or <code>paragraph</code>. The toggle re-slices every panel.
              </li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Ground truth</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li>
                <strong>Elo ground truth</strong> — Each pair carries the Elo skill ratings of variant_a and variant_b from the evolution arena.
              </li>
              <li>
                <strong>large-gap pair</strong> — A pair whose Elo gap is wide enough that one side is the unambiguous expected winner. Only large-gap pairs feed the accuracy panel.
              </li>
              <li>
                <strong>expected_winner</strong> — On a large-gap pair, the side with the higher Elo (A or B). Null on close pairs.
              </li>
              <li>
                <strong>close pair</strong> — Elo gap too small to declare a winner; excluded from accuracy.
              </li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Tile metrics (top panel)</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li>
                <strong>Per-pair (most-common) agreement</strong> — For each pair, take the <em>most common</em> winner each judge produced across its N repeats — then compare those two single winners. One comparison per pair. Smooths over per-call noise. Mutual TIE counts as agreement. Tiebreak order when two winners tie within a pair: A &gt; B &gt; TIE.
              </li>
              <li>
                <strong>Per-repeat agreement</strong> — Every (pair × repeat) call: was rubric_winner = holistic_winner? No decisive filter. Mutual TIE counts as agreement.
              </li>
              <li>
                <strong>Both-decisive agreement</strong> — Subset to calls where both judges&apos; confidence &gt; 0.6. Fraction with matching winners. Mutual high-confidence TIE counts as agreement.
              </li>
              <li>
                <strong>Single-judge abstain</strong> — Fraction of calls where exactly one judge committed to A or B (the other abstained or returned TIE). Mutual TIE does NOT count as divergence.
              </li>
              <li>
                <strong>Holistic / Rubric position bias</strong> — Fraction of calls where the forward pass picked one winner and the reverse pass picked a different one. High = the judge&apos;s verdict depends on text ordering.
              </li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Per-criterion table</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li>
                <strong>Weight</strong> — The criterion&apos;s contribution to the rubric&apos;s aggregate score. Higher weight = more influence on the rubric_winner.
              </li>
              <li>
                <strong>Agree / Disagree</strong> — Among rows where this criterion committed to A or B, fraction that matched (Agree) or differed from (Disagree) the holistic winner. Abstaining rows excluded.
              </li>
              <li>
                <strong>Abstain</strong> — Fraction of all rows where this criterion returned TIE or unparseable.
              </li>
              <li>
                <strong>GT-Acc</strong> — Among large-gap rows where this criterion committed, fraction matching the expected_winner. The criterion&apos;s accuracy when it actually picks a side.
              </li>
              <li>
                <strong>Aggregated rubric</strong> (bold row at bottom) — Same Agree / Disagree as the per-criterion rows but for the rubric_winner as a whole. Denominator: both-decisive calls.
              </li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Inline notation</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li>
                <strong>[low, high]</strong> — 95% Wilson score interval (binomial CI on the proportion). Tight = lots of data; wide = few data points.
              </li>
              <li>
                <strong>rubric A / holistic B</strong> — Fraction of calls where the rubric committed to A while the holistic committed to B. The two-direction breakdown of &quot;both-decisive opposite winner&quot;.
              </li>
              <li>
                <strong>n=N</strong> — Number of calls in the relevant subset (the denominator).
              </li>
              <li>
                <strong>Δ (rubric − holistic)</strong> — Rubric accuracy minus holistic accuracy. Positive = rubric beats holistic.
              </li>
            </ul>
          </section>
        </div>
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="agreement-metrics">
              {tiles.map((t) => (
                <Tile key={t.label} label={t.label} value={t.value} formula={t.formula} testId={t.testId} />
              ))}
            </div>
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
          <div className="rounded-book paper-texture card-enhanced p-4 space-y-2">
            <div className="text-sm font-ui font-semibold">
              Accuracy vs Elo ground truth (large-gap pairs, n={metrics.nLargeGap})
            </div>
            <p className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
              Large-gap pair = the two variants&apos; Elo gap is wide enough that the higher-rated one is the
              expected winner. Accuracy denominator counts only calls where the judge committed to A or B
              (confidence &gt; 0.6 AND winner ∈ &#123;A, B&#125;) — confident TIE is an abstention, not a wrong guess.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3" data-testid="agreement-accuracy">
              <Tile
                label="Holistic judge"
                value={pctWithCI(metrics.holisticAccuracy, metrics.holisticAccuracyCi)}
                formula="committed holistic calls where holistic_winner = expected_winner / committed holistic calls on large-gap pairs"
                testId="tile-holistic-acc"
              />
              <Tile
                label="Rubric judge"
                value={pctWithCI(metrics.rubricAccuracy, metrics.rubricAccuracyCi)}
                formula="committed rubric calls where rubric_winner = expected_winner / committed rubric calls on large-gap pairs"
                testId="tile-rubric-acc"
              />
              <Tile
                label="Δ (rubric − holistic)"
                value={metrics.accuracyDelta == null ? '—' : pct(metrics.accuracyDelta)}
                formula="rubric_accuracy − holistic_accuracy · positive = rubric beats holistic; negative = the reverse"
                testId="tile-acc-delta"
              />
            </div>
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
