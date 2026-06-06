// Match detail + display-only re-judge sandbox. Shows a stored comparison (both texts +
// verdict) and lets an admin re-run the 2-pass judge with a chosen model, temperature, rubric,
// optional custom prompt, and optional reasoning output. Nothing is persisted.
// (match_viewer_with_experimentation_procedures_20260605)
'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { formatDate } from '@evolution/lib/utils/formatters';
import {
  getComparisonDetailAction,
  rejudgeComparisonAction,
  type ComparisonDetail,
  type RejudgeResult,
} from '@evolution/services/arenaActions';
import {
  getModelOptions,
  getModelMaxTemperature,
  modelSupportsReasoning,
  DEFAULT_JUDGE_MODEL,
} from '@/config/modelRegistry';

const SECTION = 'border border-[var(--border-default)] rounded-book bg-[var(--surface-elevated)] p-5';
const MODEL_OPTIONS = getModelOptions();

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

  // Sandbox controls.
  const [model, setModel] = useState(DEFAULT_JUDGE_MODEL);
  const [mode, setMode] = useState<'article' | 'paragraph'>('article');
  const [temperature, setTemperature] = useState(0);
  const [explainReasoning, setExplainReasoning] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');
  const [rejudging, setRejudging] = useState(false);
  const [results, setResults] = useState<RejudgeResult[]>([]);

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
      setResults((prev) => [res.data!, ...prev]);
    } else if (!res.success) {
      toast.error(res.error?.message ?? 'Re-judge failed');
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
        </div>
      </div>

      {/* Side-by-side texts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="match-texts">
        {(['a', 'b'] as const).map((side) => {
          const content = side === 'a' ? detail.entry_a_content : detail.entry_b_content;
          const elo = side === 'a' ? detail.entry_a_elo : detail.entry_b_elo;
          const id = side === 'a' ? detail.entry_a : detail.entry_b;
          return (
            <div key={side} className={SECTION}>
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm">Text {side.toUpperCase()}</span>
                <span className="font-mono text-xs text-[var(--text-muted)]" title={id}>
                  {elo != null ? `elo ${Math.round(elo)}` : 'elo —'} · {id.substring(0, 8)}
                </span>
              </div>
              {content != null
                ? <pre className="whitespace-pre-wrap break-words text-xs max-h-72 overflow-y-auto">{content}</pre>
                : <p className="text-xs text-[var(--status-error)]">Deleted variant {id.substring(0, 8)} — content unavailable</p>}
            </div>
          );
        })}
      </div>

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
            className="text-xs text-[var(--accent-gold)] hover:underline"
            onClick={() => setShowCustom((s) => !s)}
          >
            {showCustom ? '▾' : '▸'} Custom judge prompt (optional)
          </button>
          {showCustom && (
            <textarea
              data-testid="rejudge-custom-prompt"
              className="mt-1 w-full bg-[var(--surface-secondary)] border border-[var(--border-default)] rounded px-2 py-1 text-xs font-mono"
              rows={4}
              placeholder="Rubric/instructions only — the two texts and a verdict line are appended automatically."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
            />
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
            {results.map((r, i) => <ResultCard key={results.length - i} result={r} stored={stored} />)}
          </div>
        )}
      </div>
    </div>
  );
}
