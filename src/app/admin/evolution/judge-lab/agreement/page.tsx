// Judge Lab → Agreement sweep launcher + leaderboard. Runs a HOLISTIC (no-rubric) judge AND a RUBRIC
// judge on the same frozen test set, then surfaces how often the rubric agrees with the holistic
// winner (overall + per criterion) and each side's accuracy vs the Elo ground truth. Client component
// calling the cap-gated createAgreementSweepAction + the zero-cost read actions.
//
// Live cost preview: estimateAgreementCostAction (ZERO LLM calls) recomputes on every input change,
// debounced 300ms. `cancelled` flag is the sole stale-response guard (Next.js server actions do not
// honor AbortSignal). Launch button color-shifts + disables when the estimate exceeds the cap; estimate
// failure ≠ disabled (preserves user agency when a transient action error occurs).

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getEvolutionModelIds, DEFAULT_JUDGE_MODEL } from '@/config/modelRegistry';
import {
  listTestSetsAction,
  getJudgeModelOptionsAction,
  createAgreementSweepAction,
  getAgreementLeaderboardAction,
  estimateAgreementCostAction,
  type AgreementCostEstimate,
  type AgreementLeaderboardRow,
} from '@evolution/services/judgeEvalActions';
import { listJudgeRubricsAction } from '@evolution/services/judgeRubricActions';

type Kind = 'article' | 'paragraph' | 'both';

interface TestSetOption {
  id: string;
  name: string;
}
interface RubricOption {
  id: string;
  name: string;
}

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}
function pctWithCI(value: number | null, low: number | null, high: number | null): string {
  if (value == null) return '—';
  const main = `${(value * 100).toFixed(0)}%`;
  if (low == null || high == null) return main;
  return `${main} [${(low * 100).toFixed(0)}, ${(high * 100).toFixed(0)}]`;
}
function delta(rubric: number | null, holistic: number | null): string {
  if (rubric == null || holistic == null) return '—';
  const d = (rubric - holistic) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(0)}%`;
}

// Estimate state shape. `error: true` is the graceful fallback when the action throws.
type EstimateState = AgreementCostEstimate | { error: true } | null;

const TT_REPEATS =
  'Number of times each pair is judged. 4 LLM calls per repeat (2 holistic + 2 rubric). Doubling repeats doubles cost and halves per-pair noise.';
const TT_TEMPERATURE =
  '0 (recommended — matches the production judge path). Higher temperatures introduce judge noise on nano-class models.';
const TT_PER_REP =
  'Per-repeat agreement: fraction of (pair × repeat) calls where rubric winner equals holistic winner. Strict — no decisive filter. Note: mutual TIE counts as agreement (both judges agreeing there is no winner).';
const TT_BOTH_DEC =
  'Both-decisive agreement: among calls where both judges had confidence > 0.6, the fraction that agreed. Note: a confident TIE counts as a verdict — mutual high-confidence TIE counts as agreement.';
const TT_ABSTAIN =
  'Abstain divergence: fraction of calls where exactly one judge committed to A or B (the other abstained or returned TIE). Mutual TIE does NOT count as divergence.';
const TT_ACC_DELTA =
  'Accuracy delta vs Elo ground truth on large-gap pairs. Positive = rubric judge more accurate than holistic; negative = the reverse.';
const TT_WORST_CRIT =
  'The criterion whose verdict most often diverged from the holistic judge in this run (highest disagree rate among decided rows).';

export default function AgreementSweepPage(): JSX.Element {
  const [modelIds, setModelIds] = useState<string[]>(() => getEvolutionModelIds());
  const [testSets, setTestSets] = useState<TestSetOption[]>([]);
  const [rubrics, setRubrics] = useState<RubricOption[]>([]);

  const [testSetId, setTestSetId] = useState<string>('');
  const [testSetName, setTestSetName] = useState<string>('');
  const [kind, setKind] = useState<Kind>('both');
  const [judgeModel, setJudgeModel] = useState<string>(DEFAULT_JUDGE_MODEL);
  const [judgeRubricId, setJudgeRubricId] = useState<string>('');
  const [temperature, setTemperature] = useState<number>(0);
  const [reasoning, setReasoning] = useState<'none' | 'low' | 'medium'>('none');
  const [repeats, setRepeats] = useState<number>(1);

  const [launching, setLaunching] = useState(false);
  const [estimate, setEstimate] = useState<EstimateState>(null);
  const [estimating, setEstimating] = useState(false);

  const [viewKind, setViewKind] = useState<Kind>('both');
  const [rows, setRows] = useState<AgreementLeaderboardRow[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);

  useEffect(() => {
    document.title = 'Judge Lab · Agreement';
    void (async () => {
      const ts = await listTestSetsAction();
      if (ts.success && ts.data) {
        const opts = ts.data.map((t) => ({ id: t.id, name: t.name }));
        setTestSets(opts);
        if (opts[0]) {
          setTestSetId(opts[0].id);
          setTestSetName(opts[0].name);
        }
      }
      const models = await getJudgeModelOptionsAction();
      if (models.success && models.data && models.data.length > 0) setModelIds(models.data);
      const rb = await listJudgeRubricsAction({ status: 'active' });
      if (rb.success && rb.data) {
        const opts = rb.data.items.map((r) => ({ id: r.id, name: r.name }));
        setRubrics(opts);
        if (opts[0]) setJudgeRubricId(opts[0].id);
      }
    })();
  }, []);

  // Live cost preview — debounced; cancelled flag is the sole stale-response guard.
  // Sets `estimating=true` while the debounce + roundtrip is in-flight so the UI can show an
  // explicit "updating…" state; otherwise the preview line would mix the user's current input
  // (immediate React state for `repeats`) with the previous action's `plannedCalls` and look
  // mathematically inconsistent for ~300-500ms after every keystroke.
  useEffect(() => {
    // Min-input-length guard: skip estimate when key inputs missing.
    if (!testSetName || !judgeModel || repeats < 1) {
      setEstimate(null);
      setEstimating(false);
      return;
    }
    setEstimating(true);
    let cancelled = false;
    const timer = setTimeout(async () => {
      const res = await estimateAgreementCostAction({
        testSetName,
        kindFilter: kind,
        repeats,
        judgeModel,
        reasoningEffort: reasoning === 'none' ? null : reasoning,
      });
      if (cancelled) return; // stale-response guard
      setEstimating(false);
      if (!res.success) {
        setEstimate({ error: true }); // graceful fallback — Launch stays enabled
        return;
      }
      setEstimate(res.data);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [testSetName, judgeModel, kind, repeats, reasoning]);

  const loadBoard = useCallback(async () => {
    if (!testSetId) return;
    setLoadingBoard(true);
    const res = await getAgreementLeaderboardAction({ testSetId, kind: viewKind });
    setLoadingBoard(false);
    if (res.success && res.data) setRows(res.data);
    else if (!res.success) toast.error(res.error?.message ?? 'Failed to load leaderboard');
  }, [testSetId, viewKind]);

  useEffect(() => {
    void loadBoard();
  }, [loadBoard]);

  const run = useCallback(
    async (dryRun: boolean) => {
      if (!testSetName) return toast.error('Pick a test set');
      if (!judgeRubricId) return toast.error('Pick a rubric');
      setLaunching(true);
      const res = await createAgreementSweepAction({
        testSetName,
        kindFilter: kind,
        judgeModel,
        temperature,
        reasoningEffort: reasoning === 'none' ? null : reasoning,
        judgeRubricId,
        repeats,
        dryRun,
      });
      setLaunching(false);
      if (!res.success) {
        toast.error(res.error?.message ?? 'Sweep failed');
        return;
      }
      const o = res.data!;
      if (dryRun) {
        toast.success(`Dry run: ${o.plannedCalls} calls planned, est $${o.estimate.estimatedCostUsd.toFixed(4)}`);
        return;
      }
      toast.success(`Agreement run complete · ${o.callCount} calls`);
      void loadBoard();
    },
    [testSetName, judgeRubricId, kind, judgeModel, temperature, reasoning, repeats, loadBoard],
  );

  const inputStyle = { borderColor: 'var(--border-default)', background: 'var(--bg-secondary)' };
  const estIsError = estimate !== null && 'error' in estimate;
  const estData = estimate !== null && !('error' in estimate) ? estimate : null;
  const capBlocking = estData?.capStatus !== 'ok' && estData !== null;

  return (
    <div className="space-y-4 p-4">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Lab', href: '/admin/evolution/judge-lab' },
          { label: 'Agreement' },
        ]}
      />

      <div
        className="rounded-book paper-texture card-enhanced p-4 space-y-3"
        data-testid="judge-lab-agreement-launcher"
      >
        <p className="text-sm font-ui" style={{ color: 'var(--text-secondary)' }}>
          Run a holistic (no-rubric) judge AND a rubric judge on the same pairs, then measure how often
          the rubric — overall and per criterion — agrees with the holistic winner. 4 LLM calls per
          pair·repeat (2 holistic + 2 rubric).
        </p>

        <div className="grid grid-cols-2 gap-3 text-xs font-ui md:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span>Test set</span>
            <select
              data-testid="agreement-test-set-select"
              className="rounded border px-2 py-1"
              style={inputStyle}
              value={testSetId}
              onChange={(e) => {
                setTestSetId(e.target.value);
                setTestSetName(testSets.find((t) => t.id === e.target.value)?.name ?? '');
              }}
            >
              {testSets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span>Judge model (both judges)</span>
            <select
              data-testid="agreement-model-select"
              className="rounded border px-2 py-1"
              style={inputStyle}
              value={judgeModel}
              onChange={(e) => setJudgeModel(e.target.value)}
            >
              {modelIds.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span>Rubric (required)</span>
            <select
              data-testid="agreement-rubric-select"
              className="rounded border px-2 py-1"
              style={inputStyle}
              value={judgeRubricId}
              onChange={(e) => setJudgeRubricId(e.target.value)}
            >
              <option value="">— select a rubric —</option>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1">
            <span>Kind</span>
            <div className="flex gap-1">
              {(['both', 'article', 'paragraph'] as Kind[]).map((k) => (
                <button
                  key={k}
                  data-testid={`agreement-kind-${k}`}
                  className="rounded border px-2 py-1"
                  style={{
                    borderColor: 'var(--border-default)',
                    background: kind === k ? 'var(--accent-gold)' : 'transparent',
                    color: kind === k ? 'var(--text-on-primary)' : 'var(--text-secondary)',
                  }}
                  onClick={() => setKind(k)}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span title={TT_TEMPERATURE}>Temperature</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              className="rounded border px-2 py-1"
              style={inputStyle}
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              0 (recommended — matches production judge). Higher introduces judge noise.
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span>Reasoning</span>
            <select
              className="rounded border px-2 py-1"
              style={inputStyle}
              value={reasoning}
              onChange={(e) => setReasoning(e.target.value as 'none' | 'low' | 'medium')}
            >
              {(['none', 'low', 'medium'] as const).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span title={TT_REPEATS}>Repeats</span>
            <input
              type="number"
              min="1"
              max="50"
              className="rounded border px-2 py-1"
              style={inputStyle}
              value={repeats}
              data-testid="agreement-repeats-input"
              onChange={(e) => setRepeats(Number(e.target.value))}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Each pair judged N times. 4 calls/repeat (2 holistic + 2 rubric). Doubles cost; halves noise.
            </span>
          </label>
        </div>

        {/* Live cost preview — compact one-liner above buttons. Every value below comes from
            the action result (estData.*) so the displayed math stays internally consistent;
            the immediate-update React state for `repeats` is intentionally NOT rendered here
            (would otherwise read N pairs × M-from-state × 4 ≠ plannedCalls-from-action result
            until the next debounced action lands). The "updating…" suffix surfaces the
            in-flight state instead. */}
        <div
          className="text-xs font-ui"
          data-testid="agreement-cost-preview"
          style={{
            color: estIsError ? 'var(--text-muted)' : capBlocking ? 'var(--accent-error, #c0392b)' : 'var(--text-muted)',
          }}
        >
          {estimate === null && (estimating ? 'Computing estimate…' : '—')}
          {estIsError && 'Cost preview unavailable'}
          {estData && (
            <>
              {estData.pairCount} pairs × {estData.repeats} repeats × 4 calls = {estData.plannedCalls} calls · est ${estData.estimatedCostUsd.toFixed(4)}
              {estData.capStatus === 'over_usd' && ` · exceeds $${estData.maxUsd} cap`}
              {estData.capStatus === 'over_calls' && ` · exceeds ${estData.maxCalls} calls cap`}
              {estData.capStatus === 'ok' && ` · within $${estData.maxUsd} cap`}
              {estimating && ' · updating…'}
            </>
          )}
        </div>

        <div className="flex gap-2">
          <button
            data-testid="agreement-dry-run"
            disabled={launching || capBlocking}
            className="text-xs px-3 py-1 rounded border disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)' }}
            onClick={() => void run(true)}
          >
            Dry run
          </button>
          <button
            data-testid="agreement-launch"
            disabled={launching || capBlocking}
            className="text-xs px-3 py-1 rounded border disabled:opacity-50"
            style={{ borderColor: 'var(--border-default)', background: 'var(--accent-gold)', color: 'var(--text-on-primary)' }}
            onClick={() => void run(false)}
          >
            {launching ? 'Running…' : 'Launch sweep'}
          </button>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="rounded-book paper-texture card-enhanced p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-ui font-semibold">Agreement runs</div>
          <div className="flex gap-1">
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
        </div>

        <details data-testid="agreement-definitions" className="text-xs font-ui" style={{ color: 'var(--text-muted)' }}>
          <summary className="cursor-pointer">Glossary — every term on this page</summary>
          <div className="mt-3 space-y-3 pl-1">

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Form inputs</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li><strong>Test set</strong> — A frozen sample of pairs (drawn once and re-used across runs). Created from a pair-bank.</li>
              <li><strong>Judge model (both judges)</strong> — The LLM that judges both the holistic and the rubric calls. Same model for both sides.</li>
              <li><strong>Rubric</strong> — The named bundle of criteria (each with a weight) used by the rubric judge. Required.</li>
              <li><strong>Kind</strong> — Filter the run to <code>article</code> pairs, <code>paragraph</code> pairs, or <code>both</code>.</li>
              <li><strong>Temperature</strong> — Sampling temperature for the judge LLM. 0 = deterministic (recommended; matches the production judge path).</li>
              <li><strong>Reasoning</strong> — Reasoning-mode setting for thinking models. <code>none</code> = off; <code>low</code> / <code>medium</code> = increasing budgets.</li>
              <li><strong>Repeats</strong> — Number of times each pair is judged. 4 LLM calls per repeat (2 holistic + 2 rubric).</li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Cost preview line</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li><strong>pairs</strong> — Number of pairs in the test set after the Kind filter.</li>
              <li><strong>repeats</strong> — Number of times each pair will be judged.</li>
              <li><strong>calls</strong> — Total LLM calls planned = pairs × repeats × 4.</li>
              <li><strong>est $X</strong> — Pre-flight cost estimate. Approximate; the authoritative cost is the per-call onUsage estimate captured during the run.</li>
              <li><strong>cap</strong> — Hard JUDGE_EVAL_MAX_USD ceiling (default $5). The sweep is rejected before any LLM call if the estimate exceeds the cap.</li>
              <li><strong>updating…</strong> — A new estimate is in flight (debounced 300ms after input change).</li>
              <li><strong>Cost preview unavailable</strong> — The estimate action errored. Launch stays enabled — preserves user agency on transient errors.</li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Launcher buttons</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li><strong>Dry run</strong> — Computes the sweep plan + estimate but makes NO LLM calls. Useful as a final sanity check before Launch.</li>
              <li><strong>Launch sweep</strong> — Actually runs the sweep. Disabled when the estimate exceeds the cap.</li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Core concepts (used in the leaderboard)</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li><strong>Holistic judge</strong> — Judges the pair with a single overall A/B/TIE prompt (no per-criterion breakdown).</li>
              <li><strong>Rubric judge</strong> — Judges each criterion separately, then weights the per-criterion verdicts into one overall A/B/TIE decision.</li>
              <li><strong>2-pass A/B reversal</strong> — Every judge call is made twice — forward (Text A, Text B) and reverse (swapped) — then reconciled into one verdict + confidence.</li>
              <li><strong>confidence</strong> — 1.0 both passes agreed · 0.7 one TIE + one winner · 0.5 they disagreed (forced TIE) · 0.3 one pass returned nothing · 0.0 both failed.</li>
              <li><strong>committed</strong> — A judge call where confidence &gt; 0.6 AND the winner is A or B (not TIE).</li>
              <li><strong>decisive / confident</strong> — Confidence &gt; 0.6 regardless of winner. A high-confidence TIE is &quot;confident&quot; but NOT &quot;committed&quot; — it&apos;s an abstention.</li>
              <li><strong>TIE</strong> — Verdict meaning &quot;neither text wins&quot;. Includes both genuine ties and &quot;couldn&apos;t pick&quot; outcomes.</li>
              <li><strong>ground truth / large-gap pair</strong> — A pair whose Elo gap is wide enough that the higher-rated side is the unambiguous <code>expected_winner</code>. Only large-gap pairs feed the accuracy column.</li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Leaderboard columns</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li><strong>Run</strong> — First 8 chars of the agreement-run UUID; click to open the detail page.</li>
              <li><strong>Model</strong> — Judge model used for this run.</li>
              <li><strong>Kind</strong> — <code>article</code> or <code>paragraph</code>. One row per (run × kind).</li>
              <li>
                <strong>Per-rep</strong> — Per-repeat agreement. Fraction of (pair × repeat) calls where rubric_winner = holistic_winner. <em>Mutual TIE counts as agreement.</em>
              </li>
              <li>
                <strong>Both-dec</strong> — Both-decisive agreement. Among calls where both judges&apos; confidence &gt; 0.6, fraction with matching winners. <em>A confident TIE counts as a verdict — mutual high-confidence TIE counts as agreement.</em>
              </li>
              <li>
                <strong>Abstain</strong> — Abstain divergence. Fraction of calls where exactly one judge committed to A or B (the other abstained or returned TIE). <em>Mutual TIE does NOT count as divergence.</em>
              </li>
              <li>
                <strong>Acc Δ</strong> — Rubric accuracy − holistic accuracy on large-gap pairs. Only counts calls where the judge committed to A or B; confident TIEs are abstentions, not wrong guesses.
              </li>
              <li><strong>Worst criterion</strong> — The rubric dimension whose verdicts diverged from the holistic winner most often in this run.</li>
              <li><strong>N</strong> — Total error-free calls in this (run × kind) — the denominator for Per-rep / Abstain.</li>
            </ul>
          </section>

          <section>
            <p className="font-semibold text-[var(--text-secondary)]">Inline notation</p>
            <ul className="mt-1 space-y-1 pl-4 list-disc">
              <li><strong>[low, high]</strong> — 95% Wilson score interval (binomial CI on the proportion). Tight = lots of data; wide = few data points.</li>
              <li><strong>—</strong> — Insufficient data to compute this rate (typically n=0).</li>
            </ul>
          </section>
          </div>
        </details>

        <table className="w-full text-xs font-ui" data-testid="agreement-leaderboard">
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th className="text-left py-1">Run</th>
              <th className="text-left">Model</th>
              <th className="text-left">Kind</th>
              <th className="text-right" title={TT_PER_REP}>Per-rep</th>
              <th className="text-right" title={TT_BOTH_DEC}>Both-dec</th>
              <th className="text-right" title={TT_ABSTAIN}>Abstain</th>
              <th className="text-right" title={TT_ACC_DELTA}>Acc Δ</th>
              <th className="text-left" title={TT_WORST_CRIT}>Worst criterion</th>
              <th className="text-right">N</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="py-2" style={{ color: 'var(--text-muted)' }}>
                  {loadingBoard ? 'Loading…' : 'No agreement runs for this test set yet.'}
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.agreement_run_id}-${r.pair_kind}-${i}`} data-testid="agreement-leaderboard-row">
                <td className="py-1">
                  {r.agreement_run_id ? (
                    <Link
                      href={`/admin/evolution/judge-lab/agreement/runs/${r.agreement_run_id}`}
                      style={{ color: 'var(--accent-gold)' }}
                    >
                      {r.agreement_run_id.slice(0, 8)}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
                <td>{r.judge_model ?? '—'}</td>
                <td>{r.pair_kind ?? '—'}</td>
                <td className="text-right" data-testid="agreement-leaderboard-per-rep">
                  {pctWithCI(r.strict_agree_rate, r.strict_agree_ci_low, r.strict_agree_ci_high)}
                </td>
                <td className="text-right" data-testid="agreement-leaderboard-both-dec">
                  {pctWithCI(r.both_decisive_agree_rate, r.both_decisive_agree_ci_low, r.both_decisive_agree_ci_high)}
                </td>
                <td className="text-right" data-testid="agreement-leaderboard-abstain">
                  {pctWithCI(r.abstain_divergence_rate, r.abstain_divergence_ci_low, r.abstain_divergence_ci_high)}
                </td>
                <td className="text-right">{delta(r.rubric_accuracy, r.holistic_accuracy)}</td>
                <td data-testid="agreement-leaderboard-worst-criterion">
                  {r.worst_criterion_name
                    ? `${r.worst_criterion_name} (${pct(r.worst_criterion_disagree_rate)})`
                    : '—'}
                </td>
                <td className="text-right">{r.n_calls ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
