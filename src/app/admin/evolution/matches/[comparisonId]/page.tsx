// Match detail + display-only re-judge sandbox. Shows a stored comparison (both texts +
// verdict) and lets an admin re-run the 2-pass judge with a chosen model, temperature, rubric,
// optional custom prompt, and optional reasoning output. Nothing is persisted.
// (match_viewer_with_experimentation_procedures_20260605)
'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { SideBySideWordDiff } from '@evolution/components/evolution/visualizations/SideBySideWordDiff';
import { formatDate } from '@evolution/lib/utils/formatters';
import {
  getComparisonDetailAction,
  rejudgeComparisonAction,
  type ComparisonDetail,
  type ComparisonSubmatch,
  type RejudgeResult,
} from '@evolution/services/arenaActions';
import {
  getModelOptions,
  getModelMaxTemperature,
  modelSupportsReasoning,
  DEFAULT_JUDGE_MODEL,
} from '@/config/modelRegistry';
import { ARTICLE_SANDBOX_RUBRIC, PARAGRAPH_SANDBOX_RUBRIC } from '@evolution/lib/shared/judgeRubrics';
import type { RubricBreakdown } from '@evolution/lib/shared/rubricJudge';

const SECTION = 'border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-5';

/** Full two-pass rubric breakdown: per-dimension forward/reverse verdicts + weight,
 *  each pass's weighted score, and the overall weighted winner + confidence. Only
 *  rendered for rubric-judged matches (null for holistic). */
function RubricBreakdownSection({ breakdown }: { breakdown: RubricBreakdown }): JSX.Element {
  const pct = (w: number): string => `${Math.round(w * 100)}%`;
  const score = (n: number): string => n.toFixed(2);
  return (
    <div className={SECTION} data-testid="rubric-breakdown">
      <div className="text-sm font-semibold mb-2">
        Rubric Breakdown — WINNER {breakdown.overall.winner}
        <span className="font-normal text-[var(--text-muted)]"> · confidence {breakdown.overall.confidence.toFixed(2)} · both passes {breakdown.forwardPass.winner === breakdown.reversePass.winner ? 'agree' : 'disagree'}</span>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-left text-[var(--text-muted)]">
            <th className="py-1 pr-3">Dimension</th>
            <th className="py-1 pr-3">Weight</th>
            <th className="py-1 pr-3">Forward</th>
            <th className="py-1 pr-3">Reverse</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.dimensions.map((d) => (
            <tr key={d.criteriaId} className="border-t border-[var(--border-subtle)]" data-testid="rubric-dim-row">
              <td className="py-1 pr-3 font-medium">{d.name}</td>
              <td className="py-1 pr-3">{pct(d.weight)}</td>
              <td className="py-1 pr-3 font-mono">{d.forwardVerdict ?? '—'}</td>
              <td className="py-1 pr-3 font-mono">{d.reverseVerdict ?? '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-[var(--border-default)] text-[var(--text-muted)]">
            <td className="py-1 pr-3">Pass score (A / B)</td>
            <td className="py-1 pr-3"></td>
            <td className="py-1 pr-3 font-mono">{score(breakdown.forwardPass.scoreA)} / {score(breakdown.forwardPass.scoreB)} → {breakdown.forwardPass.winner ?? '—'}</td>
            <td className="py-1 pr-3 font-mono">{score(breakdown.reversePass.scoreA)} / {score(breakdown.reversePass.scoreB)} → {breakdown.reversePass.winner ?? '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Phase 4: the escalation chain — one card per submatch (judge), in chain order, each with its
 *  per-dimension verdict table (rubric mode). A legacy single-judge match has no submatches and this
 *  section is not rendered (it falls back to RubricBreakdownSection / the holistic verdict). */
function EscalationSection({
  submatches,
  aggregationRule,
  agreement,
}: {
  submatches: ComparisonSubmatch[];
  aggregationRule: string | null | undefined;
  agreement: number | null | undefined;
}): JSX.Element {
  const pct = (w: number): string => `${Math.round(w * 100)}%`;
  return (
    <div className={SECTION} data-testid="escalation-breakdown">
      <div className="text-sm font-semibold mb-3">
        Escalation Chain — {submatches.length} judge{submatches.length === 1 ? '' : 's'}
        <span className="font-normal text-[var(--text-muted)]">
          {aggregationRule ? ` · rule ${aggregationRule}` : ''}
          {typeof agreement === 'number' ? ` · agreement ${pct(agreement)}` : ''}
        </span>
      </div>
      <div className="space-y-3">
        {submatches.map((s) => (
          <div
            key={s.id}
            data-testid="escalation-submatch"
            className="border border-[var(--border-subtle)] rounded p-3 bg-[var(--surface-secondary)]"
          >
            <div className="text-xs font-medium mb-1">
              Step {s.escalation_step} · <span className="font-mono">{s.judge_model}</span> · winner{' '}
              <span className="font-mono">{s.winner ?? '—'}</span>
              <span className="text-[var(--text-muted)]">
                {typeof s.confidence === 'number' ? ` · confidence ${s.confidence.toFixed(2)}` : ''}
                {s.triggered_escalation ? ' · escalated →' : ' · decisive'}
              </span>
            </div>
            {s.dimensions.length > 0 && (
              <table className="w-full text-xs border-collapse mt-1">
                <thead>
                  <tr className="text-left text-[var(--text-muted)]">
                    <th className="py-1 pr-3">Dimension</th>
                    <th className="py-1 pr-3">Weight</th>
                    <th className="py-1 pr-3">Forward</th>
                    <th className="py-1 pr-3">Reverse</th>
                    <th className="py-1 pr-3">Winner</th>
                  </tr>
                </thead>
                <tbody>
                  {s.dimensions.map((d) => (
                    <tr
                      key={`${s.id}-${d.position}`}
                      className="border-t border-[var(--border-subtle)]"
                      data-testid="escalation-dim-row"
                    >
                      <td className="py-1 pr-3 font-medium">{d.criteria_name}</td>
                      <td className="py-1 pr-3">{pct(d.weight)}</td>
                      <td className="py-1 pr-3 font-mono">{d.forward_verdict ?? '—'}</td>
                      <td className="py-1 pr-3 font-mono">{d.reverse_verdict ?? '—'}</td>
                      <td className="py-1 pr-3 font-mono">{d.dimension_winner ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
const MODEL_OPTIONS = getModelOptions();

/** The default rubric block the custom prompt overrides, for the given comparison mode. */
function rubricFor(mode: 'article' | 'paragraph'): string {
  return mode === 'paragraph' ? PARAGRAPH_SANDBOX_RUBRIC : ARTICLE_SANDBOX_RUBRIC;
}

function storedToVerdict(winner: 'a' | 'b' | 'draw'): 'A' | 'B' | 'TIE' {
  return winner === 'a' ? 'A' : winner === 'b' ? 'B' : 'TIE';
}

function PassDetails({ pass }: { pass: RejudgeResult['passes'][number] }): JSX.Element {
  const dir = pass.direction;
  return (
    <div className="mt-2 space-y-1">
      {/* Model output (incl. any reasoning the judge produced) is shown by default; the prompt
          sent is collapsed since it is long and less interesting. */}
      <div>
        <div className="text-xs text-[var(--text-muted)] mb-0.5">Model output ({dir})</div>
        <pre data-testid="rejudge-pass-output" className="whitespace-pre-wrap break-words text-xs bg-[var(--surface-secondary)] rounded p-2 font-mono">{pass.rawResponse || '(empty)'}</pre>
      </div>
      <details>
        <summary className="cursor-pointer text-xs text-[var(--text-muted)]">Prompt sent ({dir})</summary>
        <pre data-testid="rejudge-pass-prompt" className="mt-1 whitespace-pre-wrap break-words text-xs bg-[var(--surface-secondary)] rounded p-2 font-mono">{pass.prompt}</pre>
      </details>
    </div>
  );
}

function ResultCard({ result, stored }: { result: RejudgeResult; stored: 'A' | 'B' | 'TIE' }): JSX.Element {
  const agrees = result.winner === stored;
  return (
    <div data-testid="rejudge-result-card" className="border border-[var(--border-default)] rounded p-3 bg-[var(--surface-secondary)]">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-mono text-xs text-[var(--text-muted)]">
          {result.judgeModel} · temp {result.temperature ?? '—'} · {result.explainReasoning ? 'reasoning' : 'verdict-only'}
        </span>
        <span className="font-semibold">
          WINNER {result.winner} · conf {result.confidence.toFixed(2)} · {result.turns}t · ${result.costUsd.toFixed(4)}
        </span>
      </div>
      <div className="mt-1 text-xs">
        Stored {stored} → Re-judge {result.winner}{' '}
        {agrees
          ? <span className="text-[var(--status-success)]">✓ agrees with stored</span>
          : <span className="text-[var(--status-error)]">⚠ disagrees with stored</span>}
      </div>
      {result.passes.map((p) => <PassDetails key={p.direction} pass={p} />)}
    </div>
  );
}

export default function MatchDetailPage(): JSX.Element {
  const { comparisonId } = useParams<{ comparisonId: string }>();
  const [detail, setDetail] = useState<ComparisonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Text comparison view: word-diff (default) vs raw side-by-side.
  const [view, setView] = useState<'diff' | 'sideBySide'>('diff');

  // Sandbox controls.
  const [model, setModel] = useState(DEFAULT_JUDGE_MODEL);
  const [mode, setMode] = useState<'article' | 'paragraph'>('article');
  const [temperature, setTemperature] = useState(0);
  const [explainReasoning, setExplainReasoning] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  // Pre-filled with the real default rubric for the current mode so it's visible + directly editable.
  const [customPrompt, setCustomPrompt] = useState(() => rubricFor('article'));
  const [rejudging, setRejudging] = useState(false);

  // Mode-aware: when the rubric toggle changes, swap the box to that mode's default rubric — but
  // only if the user hasn't hand-edited it (i.e. it still equals one of the two presets).
  useEffect(() => {
    setCustomPrompt((cur) =>
      cur === ARTICLE_SANDBOX_RUBRIC || cur === PARAGRAPH_SANDBOX_RUBRIC ? rubricFor(mode) : cur,
    );
  }, [mode]);
  // Stable id per result so prepending new cards doesn't reshuffle React keys.
  const resultIdRef = useRef(0);
  const [results, setResults] = useState<{ id: number; result: RejudgeResult }[]>([]);

  const maxTemp = getModelMaxTemperature(model);
  const tempSupported = maxTemp != null;

  useEffect(() => { document.title = 'Match | Evolution'; }, []);

  useEffect(() => {
    let active = true;
    getComparisonDetailAction({ comparisonId })
      .then((res) => {
        if (!active) return;
        if (res.success && res.data) setDetail(res.data);
        else setError(res.error?.message ?? 'Failed to load match');
        setLoading(false);
      })
      .catch(() => { if (active) { setError('Failed to load match'); setLoading(false); } });
    return () => { active = false; };
  }, [comparisonId]);

  // Clamp temperature when switching to a model with a lower (or no) max.
  useEffect(() => {
    if (maxTemp == null) return;
    setTemperature((t) => Math.min(t, maxTemp));
  }, [maxTemp]);

  const handleRejudge = useCallback(async () => {
    setRejudging(true);
    const res = await rejudgeComparisonAction({
      comparisonId,
      judgeModel: model,
      mode,
      temperature: tempSupported ? temperature : undefined,
      explainReasoning,
      customPrompt: showCustom && customPrompt.trim() ? customPrompt : undefined,
    });
    if (res.success && res.data) {
      setResults((prev) => [{ id: resultIdRef.current++, result: res.data! }, ...prev]);
    } else if (!res.success) {
      // categorizeError replaces the user-facing `message` with a generic bucket label
      // (e.g. "Error communicating with AI service") but keeps the raw cause in `details`.
      // Surface details when it's a string so config / SDK errors (missing API key,
      // 401 from provider) reach the operator directly.
      const detail = typeof res.error?.details === 'string' ? res.error.details : null;
      toast.error(detail && detail !== res.error?.message ? `${res.error?.message}: ${detail}` : res.error?.message ?? 'Re-judge failed');
    }
    setRejudging(false);
  }, [comparisonId, model, mode, temperature, tempSupported, explainReasoning, showCustom, customPrompt]);

  if (loading) {
    return <div className="p-6 animate-pulse text-[var(--text-muted)]">Loading match…</div>;
  }
  if (error || !detail) {
    return <div className="p-6 text-[var(--status-error)]">{error ?? 'Match not found'}</div>;
  }

  const stored = storedToVerdict(detail.winner);

  return (
    <div className="space-y-5" data-testid="match-detail">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Match Viewer', href: '/admin/evolution/matches' },
          { label: comparisonId.substring(0, 8) },
        ]}
      />

      {/* Metadata + stored verdict */}
      <div className={SECTION}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <span className="font-mono text-xs text-[var(--text-muted)]" title={comparisonId}>Match {comparisonId.substring(0, 8)}…</span>
          {detail.run_id && <span className="font-mono text-xs text-[var(--text-muted)]" title={detail.run_id}>Run {detail.run_id.substring(0, 8)}…</span>}
          <span className="text-xs text-[var(--text-muted)]">{formatDate(detail.created_at)}</span>
        </div>
        <div className="mt-2 text-sm">
          Stored result: <span className="font-semibold">WINNER {stored}</span>
          {' · '}confidence {detail.confidence.toFixed(2)}
          {' · '}status {detail.status}
          {detail.judge_rubric_id && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-page bg-[var(--accent-gold)] text-[var(--text-on-primary)]">rubric</span>}
        </div>
      </div>

      {/* Rubric breakdown (rubric-judged matches only; holistic → omitted) */}
      {detail.rubric_breakdown && <RubricBreakdownSection breakdown={detail.rubric_breakdown} />}
      {detail.submatches.length > 0 && (
        <EscalationSection
          submatches={detail.submatches}
          aggregationRule={detail.aggregation_rule}
          agreement={detail.agreement}
        />
      )}

      {/* Text comparison — word diff (default) or raw side-by-side */}
      {(() => {
        const aId = detail.entry_a.substring(0, 8);
        const bId = detail.entry_b.substring(0, 8);
        const aElo = detail.entry_a_elo != null ? `elo ${Math.round(detail.entry_a_elo)}` : 'elo —';
        const bElo = detail.entry_b_elo != null ? `elo ${Math.round(detail.entry_b_elo)}` : 'elo —';
        // Word diff needs both texts; if either variant was deleted, fall back to raw panels.
        const canDiff = detail.entry_a_content != null && detail.entry_b_content != null;
        const activeView = canDiff ? view : 'sideBySide';
        const tabBtn = (v: 'diff' | 'sideBySide', label: string) => (
          <button
            data-testid={`match-view-${v}`}
            onClick={() => setView(v)}
            disabled={v === 'diff' && !canDiff}
            className={`px-2 py-1 text-xs rounded ${activeView === v
              ? 'bg-[var(--accent-gold)] text-[var(--surface-base)] font-semibold'
              : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'} disabled:opacity-40`}
          >
            {label}
          </button>
        );
        return (
          <div className={SECTION} data-testid="match-texts">
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-sm">
                Text A <span className="font-mono text-xs text-[var(--text-muted)]" title={detail.entry_a}>({aElo} · {aId})</span>
                {' vs '}
                Text B <span className="font-mono text-xs text-[var(--text-muted)]" title={detail.entry_b}>({bElo} · {bId})</span>
              </span>
              <div className="flex items-center gap-1">
                {tabBtn('diff', 'Word diff')}
                {tabBtn('sideBySide', 'Side by side')}
              </div>
            </div>

            {activeView === 'diff' ? (
              <SideBySideWordDiff
                parent={detail.entry_a_content ?? ''}
                variant={detail.entry_b_content ?? ''}
                leftLabel={`Text A · ${aElo}`}
                rightLabel={`Text B · ${bElo}`}
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(['a', 'b'] as const).map((side) => {
                  const content = side === 'a' ? detail.entry_a_content : detail.entry_b_content;
                  const id = side === 'a' ? detail.entry_a : detail.entry_b;
                  return (
                    <div key={side}>
                      <div className="text-xs text-[var(--text-muted)] mb-1">Text {side.toUpperCase()}</div>
                      {content != null
                        ? <pre className="whitespace-pre-wrap break-words text-xs max-h-72 overflow-y-auto bg-[var(--surface-secondary)] rounded p-2">{content}</pre>
                        : <p className="text-xs text-[var(--status-error)]">Deleted variant {id.substring(0, 8)} — content unavailable</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })()}

      {/* Re-judge sandbox */}
      <div className={SECTION}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xl font-display font-semibold">⚖ Re-judge sandbox</h2>
          <span data-testid="rejudge-not-persisted" className="text-xs text-[var(--text-muted)]">ⓘ not persisted</span>
        </div>

        <div className="flex flex-wrap items-end gap-4 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">Model</span>
            <select
              data-testid="rejudge-model-select"
              className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {MODEL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}{modelSupportsReasoning(o.value) ? ' (reasoning)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-[var(--text-muted)]">Rubric</span>
            <select
              data-testid="rejudge-rubric-select"
              className="bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
              value={mode}
              onChange={(e) => setMode(e.target.value as 'article' | 'paragraph')}
            >
              <option value="article">Article</option>
              <option value="paragraph">Paragraph</option>
            </select>
          </label>

          {tempSupported && (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-[var(--text-muted)]">Temperature: {temperature.toFixed(1)} (max {maxTemp})</span>
              <input
                data-testid="rejudge-temperature"
                type="range" min={0} max={maxTemp} step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
            </label>
          )}

          <label className="flex items-center gap-2">
            <input
              data-testid="rejudge-explain-reasoning"
              type="checkbox"
              checked={explainReasoning}
              onChange={(e) => setExplainReasoning(e.target.checked)}
            />
            <span className="text-xs">Explain reasoning</span>
          </label>
        </div>

        <div className="mt-3">
          <button
            data-testid="rejudge-toggle-custom"
            className="text-xs text-[var(--accent-gold)] hover:underline"
            onClick={() => setShowCustom((s) => !s)}
          >
            {showCustom ? '▾' : '▸'} Custom judge prompt (optional)
          </button>
          {showCustom && (
            <>
              <p className="mt-1 text-xs text-[var(--text-muted)]">
                Pre-filled with the default {mode} rubric — edit and run it directly. Overrides only
                the rubric block; the two texts and a verdict line are appended automatically.
              </p>
              <textarea
                data-testid="rejudge-custom-prompt"
                className="mt-1 w-full bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded px-2 py-1 text-xs font-mono"
                rows={6}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
              />
              <button
                className="mt-1 text-xs text-[var(--text-muted)] underline"
                onClick={() => setCustomPrompt(rubricFor(mode))}
              >
                Reset to default {mode} rubric
              </button>
            </>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            data-testid="rejudge-run-button"
            className="px-3 py-1.5 rounded bg-[var(--accent-gold)] text-[var(--surface-base)] text-sm font-semibold disabled:opacity-50"
            onClick={handleRejudge}
            disabled={rejudging}
          >
            {rejudging ? 'Re-judging…' : '▶ Re-judge'}
          </button>
          <span className="text-xs text-[var(--text-muted)]">2-pass reversal · {explainReasoning ? 'reasoning ↑ tokens' : 'verdict-only'}</span>
        </div>

        {results.length > 0 && (
          <div className="mt-4 space-y-3">
            {results.map((r) => <ResultCard key={r.id} result={r.result} stored={stored} />)}
          </div>
        )}
      </div>
    </div>
  );
}
