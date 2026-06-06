// Prompt Playground: customize a rewrite prompt + model + temperature and compare raw model
// outputs side-by-side across N configs over one shared source input. Single LLM call per config
// (no agent orchestration / no evolution-pipeline rows). See evolution/docs/prompt_playground.md.

'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { SideBySideWordDiff } from '@evolution/components/evolution/visualizations/SideBySideWordDiff';
import { getModelOptions, getModelMaxTemperature } from '@/config/modelRegistry';
import { getTacticDef, GENERATE_TACTIC_NAMES } from '@evolution/lib/core/tactics';
import { PARAGRAPH_REWRITE_DIRECTIVES } from '@evolution/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt';
import type { RewriteUnit, PlaygroundRunResult, PlaygroundConfigResult } from '@evolution/lib/playground/types';

const MODEL_OPTIONS = getModelOptions();
const DEFAULT_MODEL = MODEL_OPTIONS.some((m) => m.value === 'gpt-4.1-nano') ? 'gpt-4.1-nano' : MODEL_OPTIONS[0]!.value;
const MAX_CONFIGS = 10;

interface ConfigState {
  id: number;
  label: string;
  // article
  preamble: string;
  instructions: string;
  // paragraph
  directive: string;
  model: string;
  temperature: number;
}

function tempSupported(model: string): boolean {
  const max = getModelMaxTemperature(model);
  return max !== null && max !== undefined;
}

function newConfig(id: number, unit: RewriteUnit): ConfigState {
  if (unit === 'article') {
    const first = getTacticDef(GENERATE_TACTIC_NAMES[0]!);
    return { id, label: `config ${id}`, preamble: first?.preamble ?? '', instructions: first?.instructions ?? '', directive: '', model: DEFAULT_MODEL, temperature: 0.7 };
  }
  return { id, label: `config ${id}`, preamble: '', instructions: '', directive: PARAGRAPH_REWRITE_DIRECTIVES[0]!, model: DEFAULT_MODEL, temperature: 0.7 };
}

const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  success: { label: '✓ success', color: 'var(--status-success)' },
  budget: { label: '💲 budget', color: 'var(--status-warning)' },
  killed: { label: '🛑 killed', color: 'var(--status-error)' },
  timeout: { label: '⏱ timeout', color: 'var(--status-warning)' },
  error: { label: '✖ error', color: 'var(--status-error)' },
};

const inputCls = 'w-full px-2 py-1.5 text-sm font-ui rounded-page border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-primary)]';
const labelCls = 'block text-xs font-ui text-[var(--text-muted)] mb-1';

export default function PromptPlaygroundPage(): JSX.Element {
  const [unit, setUnit] = useState<RewriteUnit>('article');
  const [sourceText, setSourceText] = useState('');
  const [title, setTitle] = useState('');
  const nextId = useRef(2);
  const [configs, setConfigs] = useState<ConfigState[]>([newConfig(1, 'article')]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PlaygroundRunResult | null>(null);
  const [diffOpen, setDiffOpen] = useState<Record<number, boolean>>({});

  const switchUnit = useCallback((u: RewriteUnit) => {
    setUnit(u);
    nextId.current = 2;
    setConfigs([newConfig(1, u)]);
    setResult(null);
  }, []);

  const addConfig = useCallback(() => {
    setConfigs((cs) => (cs.length >= MAX_CONFIGS ? cs : [...cs, newConfig(nextId.current++, unit)]));
  }, [unit]);

  const removeConfig = useCallback((id: number) => {
    setConfigs((cs) => (cs.length <= 1 ? cs : cs.filter((c) => c.id !== id)));
  }, []);

  const updateConfig = useCallback((id: number, patch: Partial<ConfigState>) => {
    setConfigs((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const applyPreset = useCallback((id: number, presetKey: string) => {
    if (!presetKey) return;
    if (unit === 'article') {
      const t = getTacticDef(presetKey);
      if (t) updateConfig(id, { preamble: t.preamble, instructions: t.instructions });
    } else {
      const idx = Number(presetKey);
      const d = PARAGRAPH_REWRITE_DIRECTIVES[idx];
      if (d) updateConfig(id, { directive: d });
    }
  }, [unit, updateConfig]);

  const canRun = sourceText.trim().length > 0 && !running && configs.length > 0;

  const run = useCallback(async () => {
    if (!canRun) return;
    setRunning(true);
    setResult(null);
    try {
      const body = {
        unit,
        sourceText,
        title: unit === 'paragraph' && title ? title : undefined,
        configs: configs.map((c) => ({
          label: c.label,
          model: c.model,
          temperature: tempSupported(c.model) ? c.temperature : undefined,
          prompt: unit === 'article'
            ? { preamble: c.preamble, instructions: c.instructions }
            : { directive: c.directive },
        })),
      };
      const res = await fetch('/api/evolution/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? `Run failed (${res.status})`);
        return;
      }
      setResult(json as PlaygroundRunResult);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  }, [canRun, unit, sourceText, title, configs]);

  const presetOptions = useMemo(() => {
    if (unit === 'article') {
      return GENERATE_TACTIC_NAMES.map((n) => ({ value: n, label: getTacticDef(n)?.label ?? n }));
    }
    return PARAGRAPH_REWRITE_DIRECTIVES.map((d, i) => ({ value: String(i), label: `Directive ${i + 1}: ${d.slice(0, 28)}…` }));
  }, [unit]);

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <EvolutionBreadcrumb items={[{ label: 'Prompt Playground' }]} />

      <header>
        <h1 className="font-display text-4xl text-[var(--text-primary)]">Prompt Playground</h1>
        <p className="font-ui text-sm text-[var(--text-muted)] mt-1">
          Customize a rewrite prompt + model + temperature and compare raw model outputs side-by-side.
          Single LLM call per config — no ranking, no recombine, no pipeline run.
        </p>
      </header>

      {/* Unit toggle */}
      <div className="flex gap-2" role="tablist" aria-label="Rewrite unit">
        {(['article', 'paragraph'] as RewriteUnit[]).map((u) => (
          <button
            key={u}
            role="tab"
            aria-selected={unit === u}
            data-testid={`playground-unit-${u}`}
            onClick={() => switchUnit(u)}
            className={`px-3 py-1.5 text-sm font-ui rounded-page border transition-colors ${
              unit === u
                ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)] border-[var(--accent-gold)]'
                : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]'
            }`}
          >
            {u === 'article' ? 'Whole article' : 'Paragraph'}
          </button>
        ))}
      </div>

      {/* Shared source */}
      <div>
        {unit === 'paragraph' && (
          <input
            data-testid="playground-title"
            className={`${inputCls} mb-2`}
            placeholder="Article title (optional context for the paragraph rewrite)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        )}
        <label className={labelCls}>{unit === 'article' ? 'Source article (shared by all configs)' : 'Source paragraph (shared by all configs)'}</label>
        <textarea
          data-testid="playground-source"
          className={`${inputCls} font-mono min-h-[140px]`}
          placeholder={unit === 'article' ? '# Title\n\nPaste the article to rewrite…' : 'Paste a single paragraph to rewrite…'}
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
        />
      </div>

      {/* Config cards */}
      <div className="flex items-center justify-between">
        <div className="font-ui text-sm text-[var(--text-secondary)]">Configs ({configs.length}/{MAX_CONFIGS})</div>
        <button
          data-testid="playground-add-config"
          onClick={addConfig}
          disabled={configs.length >= MAX_CONFIGS}
          className="px-2 py-1 text-xs font-ui border border-[var(--border-default)] rounded-page hover:bg-[var(--surface-elevated)] disabled:opacity-40"
        >
          + Add config
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {configs.map((c, i) => (
          <div key={c.id} data-testid="playground-config-card" className="p-3 rounded-page border border-[var(--border-default)] bg-[var(--surface-primary)] space-y-2">
            <div className="flex items-center gap-2">
              <input
                aria-label="label"
                data-testid={`playground-label-${i}`}
                className={`${inputCls} flex-1`}
                value={c.label}
                onChange={(e) => updateConfig(c.id, { label: e.target.value })}
              />
              <button
                data-testid={`playground-remove-${i}`}
                onClick={() => removeConfig(c.id)}
                disabled={configs.length <= 1}
                className="text-xs text-[var(--status-error)] hover:underline disabled:opacity-30"
                aria-label="remove config"
              >
                🗑
              </button>
            </div>

            <div>
              <label className={labelCls}>Preset</label>
              <select
                data-testid={`playground-preset-${i}`}
                className={inputCls}
                defaultValue=""
                onChange={(e) => applyPreset(c.id, e.target.value)}
              >
                <option value="">Load a preset…</option>
                {presetOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {unit === 'article' ? (
              <>
                <div>
                  <label className={labelCls}>Preamble (role)</label>
                  <textarea data-testid={`playground-preamble-${i}`} className={`${inputCls} min-h-[48px]`} value={c.preamble} onChange={(e) => updateConfig(c.id, { preamble: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Instructions</label>
                  <textarea data-testid={`playground-instructions-${i}`} className={`${inputCls} min-h-[80px]`} value={c.instructions} onChange={(e) => updateConfig(c.id, { instructions: e.target.value })} />
                </div>
                <p className="text-xs font-ui text-[var(--text-muted)]">ⓘ FORMAT_RULES auto-appended</p>
              </>
            ) : (
              <div>
                <label className={labelCls}>Directive</label>
                <textarea data-testid={`playground-directive-${i}`} className={`${inputCls} min-h-[80px]`} value={c.directive} onChange={(e) => updateConfig(c.id, { directive: e.target.value })} />
                <p className="text-xs font-ui text-[var(--text-muted)] mt-1">ⓘ preserve-meaning + ±20% length scaffolding auto-wrapped</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Model</label>
                <select data-testid={`playground-model-${i}`} className={inputCls} value={c.model} onChange={(e) => updateConfig(c.id, { model: e.target.value })}>
                  {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Temperature{!tempSupported(c.model) && ' (n/a)'}</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  data-testid={`playground-temp-${i}`}
                  className={inputCls}
                  value={c.temperature}
                  disabled={!tempSupported(c.model)}
                  onChange={(e) => updateConfig(c.id, { temperature: Number(e.target.value) })}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          data-testid="playground-run"
          onClick={run}
          disabled={!canRun}
          className="px-4 py-2 font-ui text-sm font-medium bg-[var(--accent-gold)] text-[var(--surface-primary)] rounded-page hover:opacity-90 disabled:opacity-50"
        >
          {running ? 'Running…' : `▶ Run all ${configs.length}`}
        </button>
        {result && (
          <span data-testid="playground-total-cost" className="font-mono text-xs text-[var(--text-muted)]">
            total ${result.totalCostUsd.toFixed(4)}
          </span>
        )}
      </div>

      {/* Results */}
      {result && (
        <div data-testid="playground-results" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {result.configs.map((r: PlaygroundConfigResult, i: number) => {
            const st = STATUS_STYLES[r.status] ?? STATUS_STYLES.error!;
            return (
              <div key={i} data-testid="playground-result-panel" className="rounded-page border border-[var(--border-default)] bg-[var(--surface-primary)] overflow-hidden flex flex-col">
                <div className="p-2 border-b border-[var(--border-default)] space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-ui text-sm text-[var(--text-primary)] truncate">{r.label}</span>
                    <span data-testid={`playground-status-${i}`} className="text-xs font-ui px-1.5 py-0.5 rounded" style={{ color: st.color, border: `1px solid ${st.color}` }}>{st.label}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-mono text-[var(--text-muted)]">
                    <span>{r.model}{r.temperatureUsed != null ? ` · t=${r.temperatureUsed}` : ''}</span>
                    <span data-testid={`playground-cost-${i}`}>${r.costUsd.toFixed(4)} · {r.durationMs}ms</span>
                  </div>
                  {!r.formatValid && r.formatIssues && r.formatIssues.length > 0 && (
                    <div data-testid={`playground-format-chip-${i}`} className="text-xs font-ui" style={{ color: 'var(--status-warning)' }}>
                      ⚠ would-drop: {r.formatIssues.join(', ')}
                    </div>
                  )}
                  {r.looksLikeRefusal && <div className="text-xs font-ui text-[var(--text-muted)]">↪ output looks like a refusal</div>}
                  {r.errorMsg && <div className="text-xs font-ui text-[var(--status-error)] truncate" title={r.errorMsg}>{r.errorMsg}</div>}
                </div>
                <pre data-testid={`playground-output-${i}`} className="whitespace-pre-wrap text-xs font-mono p-3 max-h-[360px] overflow-y-auto text-[var(--text-primary)]">{r.output ?? '—'}</pre>
                {r.output && (
                  <div className="p-2 border-t border-[var(--border-default)] flex items-center gap-3">
                    <button className="text-xs font-ui text-[var(--text-secondary)] hover:underline" onClick={() => { navigator.clipboard?.writeText(r.output ?? ''); toast.success('Copied'); }}>⧉ copy</button>
                    <button className="text-xs font-ui text-[var(--text-secondary)] hover:underline" onClick={() => setDiffOpen((d) => ({ ...d, [i]: !d[i] }))}>⇄ vs source</button>
                  </div>
                )}
                {r.output && diffOpen[i] && (
                  <div className="p-2 border-t border-[var(--border-default)]">
                    <SideBySideWordDiff parent={sourceText} variant={r.output} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
