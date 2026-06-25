// Weight-inference session detail: judge pairs (OVERALL first, then per-criterion on a
// separate step), view the inferred weights + CIs + reviewer-bias audit, and export the
// result as a real judge rubric. (Human mode; auto-mode Run tab added in Phase 5.)

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  getNextPairAction,
  recordOverallVerdictAction,
  recordDimensionVerdictsAction,
  getWeightInferencePreviewAction,
  getWeightInferenceFitAction,
  getWeightInferenceProgressAction,
  exportWeightInferenceRubricAction,
  type WiNextPair,
  type WiFitResult,
  type WiAutoProgress,
} from '@evolution/services/weightInferenceActions';

type Tab = 'judge' | 'run' | 'results';
type V = 'a' | 'b' | 'tie';

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;

function runButtonLabel(running: boolean, progress: WiAutoProgress | null): string {
  if (running) return 'Running…';
  if (progress?.done) return 'Done';
  if (progress && progress.pairsJudged > 0) return 'Resume';
  return 'Run';
}

export default function WeightInferenceSessionPage(): JSX.Element {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;

  const [tab, setTab] = useState<Tab>('judge');
  const [mode, setMode] = useState<'human' | 'auto'>('human');
  const [autoProgress, setAutoProgress] = useState<WiAutoProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<'overall' | 'criteria'>('overall');
  const [pair, setPair] = useState<WiNextPair | null>(null);
  const [loadingPair, setLoadingPair] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dimChoices, setDimChoices] = useState<Record<string, V>>({});
  const [progress, setProgress] = useState<{ overallDone: number; pairsTotal: number; remaining: number } | null>(null);

  const [fit, setFit] = useState<WiFitResult | null>(null);
  const [rubricName, setRubricName] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportedRubricId, setExportedRubricId] = useState<string | null>(null);

  const refreshProgress = useCallback(async () => {
    const res = await getWeightInferencePreviewAction({ sessionId });
    if (res.success && res.data) {
      setProgress({
        overallDone: res.data.overallDone,
        pairsTotal: res.data.pairsTotal,
        remaining: res.data.remaining,
      });
    }
  }, [sessionId]);

  const loadNext = useCallback(
    async (currentStep: 'overall' | 'criteria') => {
      setLoadingPair(true);
      const res = await getNextPairAction({ sessionId, step: currentStep });
      if (!res.success) {
        toast.error(res.error?.message ?? 'Failed to load pair');
        setLoadingPair(false);
        return;
      }
      if (res.data) {
        setPair(res.data);
        setDimChoices({});
        setLoadingPair(false);
        return;
      }
      // queue for this step is drained
      if (currentStep === 'overall') {
        setStep('criteria');
        const cr = await getNextPairAction({ sessionId, step: 'criteria' });
        setPair(cr.success ? cr.data : null);
        setLoadingPair(false);
      } else {
        setPair(null); // all judging done
        setLoadingPair(false);
      }
    },
    [sessionId],
  );

  const refreshAuto = useCallback(async () => {
    const res = await getWeightInferenceProgressAction({ sessionId });
    if (res.success && res.data) setAutoProgress(res.data);
    return res.success ? res.data : null;
  }, [sessionId]);

  useEffect(() => {
    void (async () => {
      const p = await refreshAuto();
      const m = p?.mode ?? 'human';
      setMode(m);
      if (m === 'auto') {
        setTab('run');
      } else {
        setTab('judge');
        void loadNext('overall');
        void refreshProgress();
      }
    })();
  }, [refreshAuto, loadNext, refreshProgress]);

  // Resumable auto-run: POST chunks until done, polling progress between chunks.
  const runAuto = useCallback(async () => {
    setRunning(true);
    try {
      for (let i = 0; i < 1000; i++) {
        const resp = await fetch('/api/evolution/weight-inference/auto-run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const body = (await resp.json().catch(() => ({}))) as { done?: boolean; error?: string };
        if (!resp.ok) {
          toast.error(body.error ?? `Auto-run failed (${resp.status})`);
          break;
        }
        await refreshAuto();
        if (body.done) {
          toast.success('Auto run complete');
          break;
        }
      }
    } finally {
      setRunning(false);
    }
  }, [sessionId, refreshAuto]);

  const submitOverall = async (winner: V): Promise<void> => {
    if (!pair) return;
    setBusy(true);
    const res = await recordOverallVerdictAction({ sessionId, comparisonId: pair.comparisonId, onScreenWinner: winner });
    setBusy(false);
    if (!res.success) { toast.error(res.error?.message ?? 'Save failed'); return; }
    await refreshProgress();
    await loadNext(step);
  };

  const submitDims = async (): Promise<void> => {
    if (!pair?.criteria) return;
    if (pair.criteria.some((c) => !dimChoices[c.id])) {
      toast.error('Rate every criterion first.');
      return;
    }
    setBusy(true);
    const res = await recordDimensionVerdictsAction({
      sessionId,
      comparisonId: pair.comparisonId,
      verdicts: pair.criteria.map((c) => ({ criteriaId: c.id, onScreenVerdict: dimChoices[c.id]! })),
    });
    setBusy(false);
    if (!res.success) { toast.error(res.error?.message ?? 'Save failed'); return; }
    await loadNext('criteria');
  };

  const loadFit = useCallback(async () => {
    const res = await getWeightInferenceFitAction({ sessionId });
    if (res.success && res.data) setFit(res.data);
    else if (!res.success) toast.error(res.error?.message ?? 'Fit failed');
  }, [sessionId]);

  const doExport = async (): Promise<void> => {
    if (!rubricName.trim()) { toast.error('Rubric name required.'); return; }
    setExporting(true);
    const res = await exportWeightInferenceRubricAction({ sessionId, rubricName: rubricName.trim() });
    setExporting(false);
    if (res.success && res.data) {
      setExportedRubricId(res.data.rubricId);
      toast.success('Rubric created');
    } else {
      toast.error(res.error?.message ?? 'Export failed');
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <EvolutionBreadcrumb items={[{ label: 'Implied Rubric Weights', href: '/admin/evolution/weight-inference' }, { label: 'Session' }]} />

      <div className="flex gap-2" role="tablist">
        {((mode === 'auto' ? ['run', 'results'] : ['judge', 'results']) as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            data-testid={`wi-tab-${t}`}
            onClick={() => { setTab(t); if (t === 'results') void loadFit(); }}
            className={`rounded-page px-4 py-2 font-ui text-sm capitalize ${
              tab === t ? 'bg-[var(--accent-gold)] text-[var(--text-on-primary)]' : 'text-[var(--text-secondary)]'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {mode === 'human' && progress && (
        <p className="font-ui text-sm text-[var(--text-secondary)]" data-testid="wi-progress">
          Overall {progress.overallDone}/{progress.pairsTotal} · ≈ {progress.remaining} matches to go
        </p>
      )}

      {tab === 'run' && (
        <Card className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture">
          <CardContent className="p-6 space-y-4">
            <h2 className="font-display text-2xl text-[var(--text-primary)]">Auto run (LLM as judge)</h2>
            {autoProgress?.hasHolisticOverride && (
              <details
                className="rounded-page border border-[var(--accent-gold)] bg-[var(--surface-elevated)] p-3"
                data-testid="wi-custom-prompt-banner"
              >
                <summary className="font-ui text-sm text-[var(--accent-gold)] cursor-pointer">
                  ⚙ Custom holistic prompt in use — click to view
                </summary>
                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs text-[var(--text-secondary)]">
                  {autoProgress.holisticOverride}
                </pre>
              </details>
            )}
            {autoProgress && (
              <div className="font-ui text-sm text-[var(--text-secondary)] space-y-1" data-testid="wi-run-progress">
                <div>Matches judged {autoProgress.pairsJudged}/{autoProgress.pairsTotal}</div>
                <div>LLM calls {autoProgress.llmCalls} · spend ${autoProgress.spendUsd.toFixed(4)} · position-bias {(autoProgress.positionBiasRate * 100).toFixed(0)}%</div>
                <div className="h-3 rounded-page bg-[var(--surface-elevated)] overflow-hidden">
                  <div className="h-full bg-[var(--accent-gold)]" style={{ width: `${autoProgress.pairsTotal > 0 ? Math.round((autoProgress.pairsJudged / autoProgress.pairsTotal) * 100) : 0}%` }} />
                </div>
                {autoProgress.done && <div className="text-[var(--status-success)]" data-testid="auto-run-complete">✓ Run complete — see Results.</div>}
              </div>
            )}
            <p className="font-body text-xs text-[var(--text-secondary)]">
              Derived from persisted rows; runs in resumable chunks. (Judging is automatic — no human input.)
            </p>
            <div className="flex gap-2">
              <Button variant="scholar" data-testid="wi-run" disabled={running || autoProgress?.done} onClick={() => void runAuto()}>
                {runButtonLabel(running, autoProgress)}
              </Button>
              <Button variant="secondary" disabled={running} onClick={() => void refreshAuto()}>Refresh</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {tab === 'judge' && mode === 'human' && (
        <Card className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture">
          <CardContent className="p-6 space-y-4">
            {loadingPair ? (
              <p className="font-body text-[var(--text-secondary)]">Loading…</p>
            ) : !pair ? (
              <div data-testid="wi-judging-done">
                <h2 className="font-display text-2xl text-[var(--text-primary)]">All matches judged 🎉</h2>
                <p className="font-body text-[var(--text-secondary)] mt-1">Head to the Results tab to view + export the inferred weights.</p>
              </div>
            ) : (
              <>
                <h2 className="font-display text-2xl text-[var(--text-primary)]">
                  {step === 'overall' ? 'Overall — which article wins?' : 'Per criterion — which article wins?'}
                </h2>
                <p className="font-body text-xs text-[var(--text-secondary)]" data-testid="wi-replica-notice">
                  Some matches reappear later with the two articles swapped left↔right — that&apos;s an intentional
                  consistency check, not a duplicate. Judge each one on its own.
                  {pair.pass > 0 && (
                    <span className="ml-1 rounded-page border border-[var(--accent-gold)] px-2 py-0.5 text-[var(--accent-gold)]">
                      ↔ re-check (sides swapped)
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[pair.left, pair.right].map((art, i) => (
                    <div key={art.id} className="rounded-page border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4">
                      <div className="font-ui text-xs uppercase text-[var(--text-secondary)] mb-2">{i === 0 ? 'Left' : 'Right'}</div>
                      <div className="font-body text-sm text-[var(--text-primary)] whitespace-pre-wrap max-h-80 overflow-auto">{art.content}</div>
                    </div>
                  ))}
                </div>

                {step === 'overall' ? (
                  <div className="flex gap-3" data-testid="wi-overall-controls">
                    <Button variant="outline" disabled={busy} onClick={() => void submitOverall('a')}>Left wins</Button>
                    <Button variant="secondary" disabled={busy} onClick={() => void submitOverall('tie')}>Tie</Button>
                    <Button variant="outline" disabled={busy} onClick={() => void submitOverall('b')}>Right wins</Button>
                  </div>
                ) : (
                  <div className="space-y-2" data-testid="wi-criteria-controls">
                    {(pair.criteria ?? []).map((c) => (
                      <div key={c.id} className="flex items-center justify-between gap-3 border-b border-[var(--border-default)] py-2">
                        <div>
                          <div className="font-ui text-sm text-[var(--text-primary)]">{c.name}</div>
                          {c.description && <div className="font-body text-xs text-[var(--text-secondary)]">{c.description}</div>}
                        </div>
                        <div className="flex gap-1">
                          {(['a', 'tie', 'b'] as V[]).map((v) => (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setDimChoices((p) => ({ ...p, [c.id]: v }))}
                              className={`rounded-page border px-3 py-1 font-ui text-xs ${
                                dimChoices[c.id] === v
                                  ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]'
                                  : 'border-[var(--border-default)] text-[var(--text-secondary)]'
                              }`}
                            >
                              {v === 'a' ? 'Left' : v === 'b' ? 'Right' : 'Tie'}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <Button variant="scholar" disabled={busy} data-testid="wi-submit-dims" onClick={() => void submitDims()}>Submit & next</Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'results' && (
        <Card className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture">
          <CardContent className="p-6 space-y-4">
            {!fit ? (
              <p className="font-body text-[var(--text-secondary)]">Loading fit…</p>
            ) : (
              <>
                <h2 className="font-display text-2xl text-[var(--text-primary)]">Inferred weights</h2>
                <p className="font-ui text-sm text-[var(--text-secondary)]">
                  {fit.nPairs} matches used · train {pct(fit.trainAccuracy)}
                  {fit.heldOutAccuracy != null ? ` · held-out ${pct(fit.heldOutAccuracy)}` : ''}
                  {fit.degenerate ? ' · ⚠ not enough data yet' : ''}
                </p>
                <p className="font-body text-xs text-[var(--text-secondary)]" data-testid="wi-results-legend">
                  Weights are normalized to sum to 100% (each is a criterion&apos;s share of the decision). Brackets are a
                  95% confidence interval — wider means less certain. <strong className="text-[var(--text-primary)]">Held-out</strong>{' '}
                  accuracy (cross-validated, shown once ≥ 10 matches) is the realistic estimate; train accuracy is optimistic.
                </p>
                <div className="space-y-2" data-testid="wi-weights">
                  {fit.weights.map((w) => (
                    <div key={w.criteriaId} className="flex items-center gap-3">
                      <div className="w-32 font-ui text-sm text-[var(--text-primary)] truncate">{w.name}</div>
                      <div className="flex-1 h-4 rounded-page bg-[var(--surface-elevated)] overflow-hidden">
                        <div className="h-full bg-[var(--accent-gold)]" style={{ width: pct(w.weight) }} />
                      </div>
                      <div className="w-32 font-ui text-xs text-[var(--text-secondary)] text-right">
                        {pct(w.weight)} [{pct(w.ciLow)}, {pct(w.ciHigh)}]
                      </div>
                    </div>
                  ))}
                </div>

                {fit.flags.barelyMatters.length > 0 && (
                  <p className="font-ui text-xs text-[var(--status-warning)]">⚠ barely matters: {fit.flags.barelyMatters.join(', ')}</p>
                )}
                {fit.flags.disagreesWithOverall.length > 0 && (
                  <p className="font-ui text-xs text-[var(--status-warning)]">⚠ disagrees with overall: {fit.flags.disagreesWithOverall.join(', ')}</p>
                )}

                <div className="font-ui text-sm text-[var(--text-secondary)]" data-testid="wi-audit">
                  Reviewer-bias audit ({fit.audit.overall.n} reversal-checked): position-bias {pct(fit.audit.overall.positionBiasRate)} · self-consistency {pct(fit.audit.overall.selfConsistencyRate)}
                </div>

                <div className="border-t border-[var(--border-default)] pt-4 space-y-2">
                  <label className="block font-ui text-sm font-medium text-[var(--text-secondary)]" htmlFor="wi-rubric-name">Export as judge rubric</label>
                  <div className="flex gap-2">
                    <input
                      id="wi-rubric-name"
                      data-testid="wi-rubric-name"
                      className="flex-1 rounded-page border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-[var(--text-primary)] font-ui text-sm"
                      value={rubricName}
                      onChange={(e) => setRubricName(e.target.value)}
                      placeholder="Rubric name"
                    />
                    <Button variant="scholar" data-testid="wi-export" disabled={exporting || fit.degenerate} onClick={() => void doExport()}>
                      {exporting ? 'Exporting…' : 'Export'}
                    </Button>
                  </div>
                  {exportedRubricId && (
                    <p className="font-ui text-sm text-[var(--status-success)]" data-testid="wi-exported">
                      ✓ Created — <Link href="/admin/evolution/judge-rubrics" className="gold-underline text-[var(--accent-gold)]">view in Judge Rubrics</Link>
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
