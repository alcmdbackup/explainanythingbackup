// Judge Lab admin page: launch a cost-capped judge-settings sweep over a frozen Test Set and
// view the decisive-rate leaderboard (article + paragraph reported separately). The heavy
// interactive single-match re-judge lives in the Match Viewer; this is the batch + persisted
// measurement surface. (create_tool_systematic_judge_evaluation_evolution_20260606)
'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { getEvolutionModelIds, DEFAULT_JUDGE_MODEL } from '@/config/modelRegistry';
import { ARTICLE_SANDBOX_RUBRIC, PARAGRAPH_SANDBOX_RUBRIC } from '@evolution/lib/shared/judgeRubrics';
import {
  listTestSetsAction,
  createEvalRunAction,
  getEvalLeaderboardAction,
  getJudgeModelOptionsAction,
} from '@evolution/services/judgeEvalActions';

type Kind = 'article' | 'paragraph' | 'both';
const TEMPERATURE_CHOICES = [0, 0.3, 0.7, 1.0];

// The default rubric shown for the current Kind. 'both' shows the paragraph rubric (mixed sweeps
// are dominated by paragraph pairs); it's only a reference — when left unchanged it is NOT sent as
// an override, so the engine's built-in PER-PAIR rubric selection applies (article rubric to article
// pairs, paragraph rubric to paragraph pairs).
function defaultRubricFor(kind: Kind): string {
  return kind === 'article' ? ARTICLE_SANDBOX_RUBRIC : PARAGRAPH_SANDBOX_RUBRIC;
}
function isDefaultRubric(text: string): boolean {
  const t = text.trim();
  return t === ARTICLE_SANDBOX_RUBRIC.trim() || t === PARAGRAPH_SANDBOX_RUBRIC.trim();
}

// Render an untyped ErrorResponse.details for a toast description. `details` is a raw
// string for LLM/timeout errors and an object for DB errors; truncate long strings so
// the toast stays readable.
function formatErrorDetail(details: unknown): string | undefined {
  if (details == null) return undefined;
  const text = typeof details === 'string' ? details : JSON.stringify(details);
  if (!text) return undefined;
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

interface TestSetOption {
  id: string;
  name: string;
  size_article: number;
  size_paragraph: number;
  strategy: string;
  seed: number;
}

interface LeaderboardRow {
  eval_run_id: string | null;
  judge_model: string | null;
  temperature: number | null;
  reasoning_effort: string | null;
  pair_kind: string | null;
  n_calls: number | null;
  decisive_rate: number | null;
  avg_confidence: number | null;
  cost_per_decisive_usd: number | null;
  // Enriched by getEvalLeaderboardAction from judge_eval_runs.prompt_variant.
  used_custom_prompt?: boolean;
  prompt_variant?: string | null;
}

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}
function conf(v: number | null): string {
  return v == null ? '—' : v.toFixed(2);
}
function usd(v: number | null): string {
  return v == null ? '∞' : `$${v.toFixed(5)}`;
}

export default function JudgeLabPage(): JSX.Element {
  useEffect(() => {
    document.title = 'Judge Lab | Evolution';
  }, []);

  // Start with the static evolution list, then replace with the server-curated list (which drops
  // local-only models that can't run in this deployment). Falls back to the static list on error.
  const [modelIds, setModelIds] = useState<string[]>(() => getEvolutionModelIds());
  useEffect(() => {
    void (async () => {
      const res = await getJudgeModelOptionsAction();
      if (res.success && res.data && res.data.length > 0) setModelIds(res.data);
    })();
  }, []);
  const [testSets, setTestSets] = useState<TestSetOption[]>([]);
  const [testSetId, setTestSetId] = useState<string>('');
  const [kind, setKind] = useState<Kind>('both');
  const [models, setModels] = useState<string[]>([DEFAULT_JUDGE_MODEL]);
  const [temperatures, setTemperatures] = useState<number[]>([0]);
  const [reasoning, setReasoning] = useState<'none' | 'low' | 'medium'>('none');
  // Explicit, default-off control for whether the judge is asked to explain before its verdict.
  // Decoupled from the custom-prompt textarea (which is now pre-filled with the default rubric).
  const [explainReasoning, setExplainReasoning] = useState(false);
  const [repeats, setRepeats] = useState(10);
  // Pre-filled with the default rubric for the current Kind so it is visible + directly editable.
  // When left unchanged it is NOT sent as an override (see runSweep) — the engine's built-in
  // per-pair rubric is used. Editing it turns it into a real custom override applied to all pairs.
  const [customPrompt, setCustomPrompt] = useState(() => defaultRubricFor('both'));
  const [launching, setLaunching] = useState(false);
  const [estimate, setEstimate] = useState<string | null>(null);

  // Mode-aware: when Kind changes, swap the box to that Kind's default rubric — but only if the user
  // hasn't hand-edited it (it still equals one of the presets), mirroring the Match Viewer.
  useEffect(() => {
    setCustomPrompt((cur) => (isDefaultRubric(cur) ? defaultRubricFor(kind) : cur));
  }, [kind]);

  const [viewKind, setViewKind] = useState<Kind>('both');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loadingBoard, setLoadingBoard] = useState(false);

  const selectedTestSet = testSets.find((t) => t.id === testSetId);

  useEffect(() => {
    void (async () => {
      const res = await listTestSetsAction();
      if (res.success && res.data) {
        setTestSets(res.data as TestSetOption[]);
        if (res.data.length > 0) setTestSetId((res.data[0] as TestSetOption).id);
      } else if (!res.success) {
        toast.error(res.error?.message ?? 'Failed to load test sets');
      }
    })();
  }, []);

  const loadLeaderboard = useCallback(async () => {
    if (!testSetId) return;
    setLoadingBoard(true);
    const res = await getEvalLeaderboardAction({ testSetId, kind: viewKind });
    if (res.success && res.data) {
      setRows(res.data as LeaderboardRow[]);
    } else if (!res.success) {
      toast.error(res.error?.message ?? 'Failed to load leaderboard');
    }
    setLoadingBoard(false);
  }, [testSetId, viewKind]);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  const toggle = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const runSweep = async (dryRun: boolean) => {
    if (!selectedTestSet) {
      toast.error('Select a test set');
      return;
    }
    if (models.length === 0 || temperatures.length === 0) {
      toast.error('Pick at least one model and temperature');
      return;
    }
    setLaunching(true);
    setEstimate(null);
    // Only send a custom override when the user actually EDITED the box. An unchanged preset rubric
    // is a reference only → null → the engine uses its built-in per-pair rubric (so an article sweep
    // is judged with the article rubric, not whatever preset happens to be displayed).
    const promptVariant = !isDefaultRubric(customPrompt) && customPrompt.trim() ? customPrompt.trim() : null;
    const res = await createEvalRunAction({
      testSetName: selectedTestSet.name,
      kindFilter: kind,
      models,
      temperatures,
      reasoningEfforts: [reasoning],
      promptVariant,
      explainReasoning,
      repeats,
      dryRun,
    });
    setLaunching(false);
    if (!res.success) {
      // Surface the underlying provider error (res.error.details) — not just the
      // generic message — so judge-model failures are diagnosable. `details` is
      // untyped (a raw string for LLM/timeout errors, an object for DB errors),
      // so render it generically.
      const detail = formatErrorDetail(res.error?.details);
      toast.error(res.error?.message ?? 'Sweep failed', detail ? { description: detail } : undefined);
      return;
    }
    const o = res.data!;
    const line = `${o.estimate.cells} cells · ${o.estimate.comparisons} comparisons · ${o.plannedCalls} calls · est $${o.estimate.estimatedCostUsd.toFixed(4)}`;
    if (dryRun) {
      setEstimate(line);
      toast.success('Dry run complete — no LLM calls made');
    } else {
      toast.success(`Sweep complete: ${o.cells.length} cell(s). ${line}`);
      void loadLeaderboard();
    }
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb
        items={[{ label: 'Evolution', href: '/admin/evolution-dashboard' }, { label: 'Judge Lab' }]}
      />
      <p className="text-sm text-[var(--text-muted)] font-ui">
        Systematically evaluate judge settings on a frozen Test Set. Article and paragraph
        decisiveness are reported separately. Interactive single-match re-judge lives in the{' '}
        <Link className="underline" href="/admin/evolution/matches">Match Viewer</Link>.
      </p>
      <div className="flex gap-3 text-xs">
        <Link className="underline" href="/admin/evolution/judge-lab/pair-banks">Pair-banks</Link>
        <Link className="underline" href="/admin/evolution/judge-lab/test-sets">Test Sets</Link>
      </div>

      {/* Sweep launcher */}
      <div className="rounded-book paper-texture card-enhanced p-4 space-y-3" data-testid="judge-lab-sweep">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-sm font-ui">Test set</label>
          <select
            data-testid="test-set-select"
            className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1 text-sm"
            value={testSetId}
            onChange={(e) => setTestSetId(e.target.value)}
          >
            {testSets.length === 0 && <option value="">No test sets — seed a bank + create one via CLI</option>}
            {testSets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} · {t.size_article} art / {t.size_paragraph} para · seed {t.seed}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-ui">Kind</span>
          {(['article', 'paragraph', 'both'] as Kind[]).map((k) => (
            <button
              key={k}
              data-testid={`kind-${k}`}
              className="text-xs px-2 py-1 rounded border"
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

        <div className="flex gap-2 flex-wrap">
          <span className="text-sm font-ui">Models</span>
          {modelIds.map((m) => (
            <label key={m} className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={models.includes(m)} onChange={() => setModels((p) => toggle(p, m))} />
              {m}
            </label>
          ))}
        </div>

        <div className="flex gap-3 flex-wrap items-center">
          <span className="text-sm font-ui">Temps</span>
          {TEMPERATURE_CHOICES.map((t) => (
            <label key={t} className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={temperatures.includes(t)} onChange={() => setTemperatures((p) => toggle(p, t))} />
              {t}
            </label>
          ))}
          <span className="text-sm font-ui ml-4">Reasoning</span>
          <select
            className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1 text-xs"
            value={reasoning}
            onChange={(e) => setReasoning(e.target.value as 'none' | 'low' | 'medium')}
          >
            <option value="none">none</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
          </select>
          <span className="text-sm font-ui ml-4">Repeats</span>
          <input
            type="number"
            min={1}
            max={50}
            value={repeats}
            onChange={(e) => setRepeats(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            className="w-16 bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1 text-xs"
          />
        </div>

        <details>
          <summary className="text-xs cursor-pointer text-[var(--text-muted)]">Custom judge prompt (rubric override)</summary>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            Pre-filled with the default rubric for the selected Kind, for reference. <strong>Leave it
            unchanged</strong> to use the engine&apos;s built-in per-pair rubric (article pairs judged
            with the article rubric, paragraph pairs with the paragraph rubric). <strong>Edit it</strong>
            to apply your own rubric to <em>all</em> pairs in the sweep — it overrides only the rubric
            block; the two texts and a final &ldquo;Your answer: A|B|TIE&rdquo; line are appended.
          </p>
          <textarea
            data-testid="custom-prompt"
            className="mt-2 w-full h-40 bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded p-2 text-xs font-mono"
            value={customPrompt}
            onChange={(e) => setCustomPrompt(e.target.value)}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className="text-xs underline text-[var(--text-muted)]"
              onClick={() => setCustomPrompt(defaultRubricFor(kind))}
            >
              Reset to default {kind === 'article' ? 'article' : 'paragraph'} rubric
            </button>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs font-ui">
            <input
              type="checkbox"
              data-testid="explain-reasoning"
              checked={explainReasoning}
              onChange={(e) => setExplainReasoning(e.target.checked)}
            />
            Explain reasoning (judge writes a brief rationale before its verdict — more tokens/cost)
          </label>
        </details>

        {estimate && <div className="text-xs text-[var(--text-muted)]" data-testid="sweep-estimate">Estimate: {estimate}</div>}

        <div className="flex gap-2">
          <button
            data-testid="judge-lab-dry-run"
            disabled={launching}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border-default)] disabled:opacity-50"
            onClick={() => void runSweep(true)}
          >
            Dry run
          </button>
          <button
            data-testid="judge-lab-launch"
            disabled={launching}
            className="text-xs px-3 py-1.5 rounded disabled:opacity-50"
            style={{ background: 'var(--accent-gold)', color: 'var(--text-on-primary)' }}
            onClick={() => void runSweep(false)}
          >
            {launching ? 'Running…' : '▶ Launch sweep'}
          </button>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="rounded-book paper-texture card-enhanced p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm font-semibold font-ui" role="heading" aria-level={2}>
            Leaderboard{selectedTestSet ? ` — ${selectedTestSet.name}` : ''}
          </div>
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
        <table className="w-full text-xs" data-testid="leaderboard-table">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1">Model</th>
              <th>Temp</th>
              <th>Reas.</th>
              <th>Kind</th>
              <th>Decisive</th>
              <th>Avg conf</th>
              <th>$/dec</th>
              <th>N</th>
              <th>Prompt</th>
            </tr>
          </thead>
          <tbody>
            {loadingBoard && (
              <tr><td colSpan={9} className="py-3 text-[var(--text-muted)]">Loading…</td></tr>
            )}
            {!loadingBoard && rows.length === 0 && (
              <tr><td colSpan={9} className="py-3 text-[var(--text-muted)]">No runs yet for this test set. Launch a sweep above.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={`${r.eval_run_id}-${r.pair_kind}-${i}`} data-testid="leaderboard-row" className="border-t border-[var(--border-default)]">
                <td className="py-1 font-mono">
                  {r.eval_run_id ? (
                    <Link className="underline" href={`/admin/evolution/judge-lab/runs/${r.eval_run_id}`}>
                      {r.judge_model ?? '—'}
                    </Link>
                  ) : (
                    r.judge_model ?? '—'
                  )}
                </td>
                <td>{r.temperature ?? '—'}</td>
                <td>{r.reasoning_effort ?? 'none'}</td>
                <td>{r.pair_kind ?? '—'}</td>
                <td>{pct(r.decisive_rate)}</td>
                <td>{conf(r.avg_confidence)}</td>
                <td>{usd(r.cost_per_decisive_usd)}</td>
                <td>{r.n_calls ?? 0}</td>
                <td data-testid="leaderboard-prompt">
                  {r.used_custom_prompt ? (
                    <details>
                      <summary className="cursor-pointer text-[var(--accent-gold)]">Custom</summary>
                      <pre className="mt-1 max-w-md whitespace-pre-wrap break-words text-xs font-mono text-[var(--text-muted)]">
                        {r.prompt_variant}
                      </pre>
                    </details>
                  ) : (
                    <span className="text-[var(--text-muted)]">Built-in</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
