// Prompt Editor: customize a rewrite prompt + model + temperature and compare raw model
// outputs side-by-side across N configs over one shared source input. Single LLM call per config
// (no agent orchestration / no evolution-pipeline rows). See evolution/docs/prompt_editor.md.

'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { toast } from 'sonner';
import {
  listRewriteSourcesAction,
  getRewriteSourceTextAction,
  type RewriteSourceItem,
  type RewriteSourceMode,
} from '@evolution/services/promptEditorActions';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { SideBySideWordDiff } from '@evolution/components/evolution/visualizations/SideBySideWordDiff';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { getModelOptions, getModelMaxTemperature } from '@/config/modelRegistry';
import { getTacticDef, GENERATE_TACTIC_NAMES } from '@evolution/lib/core/tactics';
import { nextConfigId } from './configId';
import { PARAGRAPH_REWRITE_DIRECTIVES } from '@evolution/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt';
import type { RewriteUnit, PromptEditorRunResult, PromptEditorConfigResult, PromptEditorConfigStatus } from '@evolution/lib/promptEditor/types';

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

const STATUS_STYLES: Record<PromptEditorConfigStatus, { label: string; color: string }> = {
  success: { label: '✓ success', color: 'var(--status-success)' },
  budget: { label: '💲 budget', color: 'var(--status-warning)' },
  killed: { label: '🛑 killed', color: 'var(--status-error)' },
  timeout: { label: '⏱ timeout', color: 'var(--status-warning)' },
  error: { label: '✖ error', color: 'var(--status-error)' },
};

const inputCls = 'w-full px-3 py-2 text-sm font-ui rounded-page border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] transition-colors focus:border-[var(--accent-gold)] focus:outline-none';
const labelCls = 'block text-xs font-ui font-medium uppercase tracking-wide text-[var(--text-muted)] mb-1';
const subCardCls = 'rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture shadow-warm-sm';

/** A soft tinted status pill (matches the variant-detail badge treatment). */
function chipStyle(color: string): CSSProperties {
  return {
    color,
    backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
    borderColor: `color-mix(in srgb, ${color} 35%, transparent)`,
  };
}

export default function PromptEditorPage(): JSX.Element {
  const [unit, setUnit] = useState<RewriteUnit>('article');
  const [sourceText, setSourceText] = useState('');
  const [title, setTitle] = useState('');
  const [configs, setConfigs] = useState<ConfigState[]>([newConfig(1, 'article')]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PromptEditorRunResult | null>(null);
  // "Load recent…" picker: lists recently rewritten content to pre-populate the source.
  const [loadMode, setLoadMode] = useState<RewriteSourceMode>('rewritten');
  const [recentItems, setRecentItems] = useState<RewriteSourceItem[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);

  const loadRecentList = useCallback(async (u: RewriteUnit, m: RewriteSourceMode) => {
    setLoadingRecent(true);
    try {
      const res = await listRewriteSourcesAction({ unit: u, mode: m, limit: 25 });
      setRecentItems(res.success && res.data ? res.data.items : []);
    } catch {
      setRecentItems([]);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  useEffect(() => { void loadRecentList(unit, loadMode); }, [unit, loadMode, loadRecentList]);

  const pickRecent = useCallback(async (id: string) => {
    const item = recentItems.find((i) => i.id === id);
    if (!item) return;
    try {
      const res = await getRewriteSourceTextAction({ id: item.id, source: item.source });
      if (res.success && res.data) {
        setSourceText(res.data.text);
        if (unit === 'paragraph' && res.data.title) setTitle(res.data.title);
        toast.success('Loaded source');
      } else {
        toast.error('Could not load source');
      }
    } catch {
      toast.error('Could not load source');
    }
  }, [recentItems, unit]);

  const switchUnit = useCallback((u: RewriteUnit) => {
    setUnit(u);
    setConfigs([newConfig(1, u)]);
    setResult(null);
  }, []);

  const addConfig = useCallback(() => {
    // T16: derive the next id purely from the current list INSIDE the updater (no mutable
    // ref) so React StrictMode's double-invoke can't skip numbers (config 1, 3, 5…).
    setConfigs((cs) => (cs.length >= MAX_CONFIGS ? cs : [...cs, newConfig(nextConfigId(cs), unit)]));
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
      const res = await fetch('/api/evolution/prompt-editor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error ?? `Run failed (${res.status})`);
        return;
      }
      setResult(json as PromptEditorRunResult);
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
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <EvolutionBreadcrumb items={[{ label: 'Prompt Editor' }]} />

      <header className="space-y-1">
        <h1 className="font-display text-4xl font-bold text-[var(--text-primary)]">Prompt Editor</h1>
        <p className="font-body text-base text-[var(--text-secondary)] max-w-3xl">
          Customize a rewrite prompt + model + temperature and compare raw model outputs side-by-side.
          Single LLM call per config — no ranking, no recombine, no pipeline run.
        </p>
      </header>

      {/* Builder */}
      <Card>
        <CardContent className="p-6 space-y-5">
          {/* Unit toggle */}
          <div className="flex items-center gap-2" role="tablist" aria-label="Rewrite unit">
            <span className="text-xs font-ui font-medium uppercase tracking-wide text-[var(--text-muted)] mr-1">Unit</span>
            {(['article', 'paragraph'] as RewriteUnit[]).map((u) => (
              <Button
                key={u}
                type="button"
                role="tab"
                aria-selected={unit === u}
                size="sm"
                variant={unit === u ? 'default' : 'outline'}
                data-testid={`prompt-editor-unit-${u}`}
                onClick={() => switchUnit(u)}
              >
                {u === 'article' ? 'Whole article' : 'Paragraph'}
              </Button>
            ))}
          </div>

          {/* Shared source */}
          <div>
            {unit === 'paragraph' && (
              <input
                data-testid="prompt-editor-title"
                className={`${inputCls} mb-2`}
                placeholder="Article title (optional context for the paragraph rewrite)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
            <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
              <label className={`${labelCls} mb-0`}>{unit === 'article' ? 'Source article — shared by all configs' : 'Source paragraph — shared by all configs'}</label>
              <div className="flex items-center gap-2" data-testid="prompt-editor-load-recent">
                <span className="text-xs font-ui text-[var(--text-muted)]">Load recent</span>
                <div className="inline-flex rounded-page border border-[var(--border-default)] overflow-hidden">
                  {(['rewritten', 'original'] as RewriteSourceMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      data-testid={`prompt-editor-load-mode-${m}`}
                      onClick={() => setLoadMode(m)}
                      className={`px-2 py-1 text-xs font-ui transition-colors ${
                        loadMode === m
                          ? 'bg-[var(--accent-gold)] text-[var(--surface-primary)]'
                          : 'text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)]'
                      }`}
                    >
                      {m === 'rewritten' ? 'Rewritten' : 'Originals'}
                    </button>
                  ))}
                </div>
                <select
                  data-testid="prompt-editor-recent-select"
                  className="px-2 py-1 text-xs font-ui rounded-page border border-[var(--border-default)] bg-[var(--surface-input)] text-[var(--text-primary)] max-w-[18rem] focus:border-[var(--accent-gold)] focus:outline-none"
                  value=""
                  onChange={(e) => { void pickRecent(e.target.value); e.target.value = ''; }}
                >
                  <option value="">{loadingRecent ? 'Loading…' : recentItems.length ? 'Pick a source…' : 'None found'}</option>
                  {recentItems.map((it) => (
                    <option key={it.id} value={it.id}>{it.preview}{it.meta ? ` — ${it.meta}` : ''}</option>
                  ))}
                </select>
              </div>
            </div>
            <textarea
              data-testid="prompt-editor-source"
              className={`${inputCls} font-mono leading-relaxed min-h-[140px] resize-y`}
              placeholder={unit === 'article' ? '# Title\n\nPaste the article to rewrite…' : 'Paste a single paragraph to rewrite…'}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
            />
          </div>

          {/* Config cards */}
          <div className="flex items-center justify-between border-t border-[var(--border-default)] pt-4">
            <h2 className="font-display text-2xl text-[var(--text-primary)]">
              Configs <span className="font-ui text-sm font-normal text-[var(--text-muted)]">({configs.length}/{MAX_CONFIGS})</span>
            </h2>
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="prompt-editor-add-config"
              onClick={addConfig}
              disabled={configs.length >= MAX_CONFIGS}
            >
              + Add config
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {configs.map((c, i) => (
              <div key={c.id} data-testid="prompt-editor-config-card" className={`${subCardCls} p-4 space-y-3`}>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="label"
                    data-testid={`prompt-editor-label-${i}`}
                    className={`${inputCls} flex-1 font-medium`}
                    value={c.label}
                    onChange={(e) => updateConfig(c.id, { label: e.target.value })}
                  />
                  <button
                    data-testid={`prompt-editor-remove-${i}`}
                    onClick={() => removeConfig(c.id)}
                    disabled={configs.length <= 1}
                    className="text-sm text-[var(--text-muted)] hover:text-[var(--status-error)] disabled:opacity-30 transition-colors"
                    aria-label="remove config"
                    title="Remove config"
                  >
                    🗑
                  </button>
                </div>

                <div>
                  <label className={labelCls}>Preset</label>
                  <select
                    data-testid={`prompt-editor-preset-${i}`}
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
                      <textarea data-testid={`prompt-editor-preamble-${i}`} className={`${inputCls} min-h-[48px] resize-y`} value={c.preamble} onChange={(e) => updateConfig(c.id, { preamble: e.target.value })} />
                    </div>
                    <div>
                      <label className={labelCls}>Instructions</label>
                      <textarea data-testid={`prompt-editor-instructions-${i}`} className={`${inputCls} min-h-[80px] resize-y`} value={c.instructions} onChange={(e) => updateConfig(c.id, { instructions: e.target.value })} />
                    </div>
                    <p className="text-xs font-ui text-[var(--text-muted)]">ⓘ FORMAT_RULES auto-appended</p>
                  </>
                ) : (
                  <div>
                    <label className={labelCls}>Directive</label>
                    <textarea data-testid={`prompt-editor-directive-${i}`} className={`${inputCls} min-h-[80px] resize-y`} value={c.directive} onChange={(e) => updateConfig(c.id, { directive: e.target.value })} />
                    <p className="text-xs font-ui text-[var(--text-muted)] mt-1">ⓘ preserve-meaning + ±20% length scaffolding auto-wrapped</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls}>Model</label>
                    <select data-testid={`prompt-editor-model-${i}`} className={inputCls} value={c.model} onChange={(e) => updateConfig(c.id, { model: e.target.value })}>
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
                      data-testid={`prompt-editor-temp-${i}`}
                      className={`${inputCls} font-mono disabled:opacity-50`}
                      value={c.temperature}
                      disabled={!tempSupported(c.model)}
                      onChange={(e) => updateConfig(c.id, { temperature: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Run */}
          <div className="flex items-center gap-4 border-t border-[var(--border-default)] pt-4">
            <Button
              type="button"
              variant="default"
              size="lg"
              data-testid="prompt-editor-run"
              onClick={run}
              disabled={!canRun}
            >
              {running ? 'Running…' : `▶ Run all ${configs.length}`}
            </Button>
            {result && (
              <span data-testid="prompt-editor-total-cost" className="font-mono text-sm text-[var(--text-muted)]">
                total ${result.totalCostUsd.toFixed(4)}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <section className="space-y-3">
          <h2 className="font-display text-2xl text-[var(--text-primary)]">Results</h2>
          <div data-testid="prompt-editor-results" className="space-y-4">
            {result.configs.map((r: PromptEditorConfigResult, i: number) => {
              const st = STATUS_STYLES[r.status] ?? STATUS_STYLES.error!;
              return (
                <div key={i} data-testid="prompt-editor-result-panel" className={`${subCardCls} overflow-hidden flex flex-col`}>
                  <div className="p-3 border-b border-[var(--border-default)] space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-ui text-sm font-medium text-[var(--text-primary)] truncate">{r.label}</span>
                      <span data-testid={`prompt-editor-status-${i}`} className="text-xs font-ui font-medium px-2 py-0.5 rounded-page border shadow-warm-sm shrink-0" style={chipStyle(st.color)}>{st.label}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs font-mono text-[var(--text-muted)]">
                      <span>{r.model}{r.temperatureUsed != null ? ` · t=${r.temperatureUsed}` : ''}</span>
                      <span data-testid={`prompt-editor-cost-${i}`}>${r.costUsd.toFixed(4)} · {r.durationMs}ms</span>
                    </div>
                    {!r.formatValid && r.formatIssues && r.formatIssues.length > 0 && (
                      <div data-testid={`prompt-editor-format-chip-${i}`} className="text-xs font-ui" style={{ color: 'var(--status-warning)' }}>
                        ⚠ would-drop: {r.formatIssues.join(', ')}
                      </div>
                    )}
                    {r.looksLikeRefusal && <div className="text-xs font-ui text-[var(--text-muted)]">↪ output looks like a refusal</div>}
                    {r.errorMsg && <div className="text-xs font-ui text-[var(--status-error)] truncate" title={r.errorMsg}>{r.errorMsg}</div>}
                  </div>
                  {r.output ? (
                    <>
                      {/* Two panes only: Parent (left) + New output (right), both diffed
                          (removals struck red, additions green) — patterned after the
                          variant-detail Diff tab. No separate raw-output pane. */}
                      <div data-testid={`prompt-editor-diff-${i}`} className="p-3">
                        <SideBySideWordDiff parent={sourceText} variant={r.output} />
                      </div>
                      <div className="p-2 border-t border-[var(--border-default)]">
                        <button className="text-xs font-ui text-[var(--text-secondary)] hover:text-[var(--accent-gold)] transition-colors" onClick={() => { navigator.clipboard?.writeText(r.output ?? ''); toast.success('Copied'); }}>⧉ copy new output</button>
                      </div>
                    </>
                  ) : (
                    <div className="p-3 text-xs font-mono text-[var(--text-muted)]">— no output</div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
