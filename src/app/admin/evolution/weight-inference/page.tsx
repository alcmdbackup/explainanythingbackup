// Implied Rubric Weights — sessions landing + new-session form. Lists weight-inference
// sessions and creates one (pick arena topic + criteria + pool size), showing the exact
// match-count preview + (auto mode) a cost estimate before creation. Human or auto (LLM-judge) mode.

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  listWeightInferenceSessionsAction,
  createWeightInferenceSessionAction,
  getWeightInferencePreviewAction,
  type WiSessionListItem,
  type WiPreviewResult,
} from '@evolution/services/weightInferenceActions';
import { getArenaTopicsAction } from '@evolution/services/arenaActions';
import { listCriteriaAction } from '@evolution/services/criteriaActions';
import { listTestSetsAction } from '@evolution/services/judgeEvalActions';
import { estimateAutoRunCost } from '@evolution/lib/weightInference/autoCost';
import { EXPERIMENT_ARMS, type ArmKey } from '@evolution/lib/weightInference/experimentArms';
import { getModelOptions, DEFAULT_JUDGE_MODEL } from '@/config/modelRegistry';

const MODEL_OPTIONS = getModelOptions();
type Mode = 'human' | 'auto';
type SourceKind = 'topic' | 'test_set';
type PairKind = 'article' | 'paragraph';

interface TestSetOpt { id: string; name: string; sizeArticle: number; sizeParagraph: number }

interface TopicOpt { id: string; name: string }
interface CriterionOpt { id: string; name: string; description: string | null }

const inputCls =
  'w-full rounded-page border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-[var(--text-primary)] font-ui text-sm';
const labelCls = 'block font-ui text-sm font-medium text-[var(--text-secondary)] mb-1';

export default function WeightInferencePage(): JSX.Element {
  const router = useRouter();
  const [sessions, setSessions] = useState<WiSessionListItem[]>([]);
  const [topics, setTopics] = useState<TopicOpt[]>([]);
  const [criteria, setCriteria] = useState<CriterionOpt[]>([]);
  const [testSets, setTestSets] = useState<TestSetOpt[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState<SourceKind>('topic');
  const [pairKind, setPairKind] = useState<PairKind>('article');
  const [testSetId, setTestSetId] = useState('');
  const [topicId, setTopicId] = useState('');
  const [selectedCriteria, setSelectedCriteria] = useState<Set<string>>(new Set());
  const [sampleSize, setSampleSize] = useState(30);
  const [replicationRate, setReplicationRate] = useState(0.15);
  const [mode, setMode] = useState<Mode>('human');
  const [judgeModel, setJudgeModel] = useState(DEFAULT_JUDGE_MODEL);
  const [judgeTemperature, setJudgeTemperature] = useState(0);
  const [autoRepeats, setAutoRepeats] = useState(1);
  // evalute_implied_rubric_results_and_experimentally_validate_20260623 Phase 3:
  // Custom holistic prompt — optional, advanced. The Arm-preset dropdown auto-fills the
  // textarea verbatim from the canonical EXPERIMENT_ARMS constants so the analysis script's
  // SHA-256 hash gate stays clean (no operator-paste byte drift).
  const [holisticPromptOverride, setHolisticPromptOverride] = useState('');
  const [armPreset, setArmPreset] = useState<'' | Exclude<ArmKey, 'A'>>('');
  const [preview, setPreview] = useState<WiPreviewResult | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const res = await listWeightInferenceSessionsAction({ filterTestContent: true });
    if (res.success && res.data) setSessions(res.data.items);
    else if (!res.success) toast.error(res.error?.message ?? 'Failed to load sessions');
  }, []);

  useEffect(() => {
    void (async () => {
      const [s, t, c, ts] = await Promise.all([
        listWeightInferenceSessionsAction({ filterTestContent: true }),
        getArenaTopicsAction({ filterTestContent: true }),
        listCriteriaAction({ status: 'active', filterTestContent: true, limit: 200 }),
        listTestSetsAction(),
      ]);
      if (s.success && s.data) setSessions(s.data.items);
      if (t.success && t.data) setTopics(t.data.map((x) => ({ id: x.id, name: x.name || x.id })));
      if (c.success && c.data) setCriteria(c.data.items.map((x) => ({ id: x.id, name: x.name, description: x.description ?? null })));
      if (ts.success && ts.data) {
        setTestSets(
          ts.data.map((x) => ({ id: x.id, name: x.name, sizeArticle: x.size_article ?? 0, sizeParagraph: x.size_paragraph ?? 0 })),
        );
      }
      setLoading(false);
    })();
  }, []);

  // Live preview: re-fires when ANY input that changes the match count / cost changes —
  // criteria, replication rate, source, topic, pool size, pair kind, test set. (Q1: the old
  // effect only depended on criteria + replicationRate, so pool size / topic never updated it.)
  useEffect(() => {
    void (async () => {
      if (selectedCriteria.size < 2) { setPreview(null); return; }
      const res = await getWeightInferencePreviewAction({
        criteriaCount: selectedCriteria.size,
        replicationRate,
        sourceKind,
        promptId: sourceKind === 'topic' ? (topicId || undefined) : undefined,
        sampleSize,
        pairKind: sourceKind === 'topic' ? 'article' : pairKind,
        testSetId: sourceKind === 'test_set' ? (testSetId || undefined) : undefined,
      });
      if (res.success && res.data) setPreview(res.data);
    })();
  }, [selectedCriteria, replicationRate, sourceKind, topicId, sampleSize, pairKind, testSetId]);

  const toggleCriterion = (id: string): void => {
    setSelectedCriteria((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async (): Promise<void> => {
    if (!name.trim() || selectedCriteria.size < 2) {
      toast.error('Name and at least 2 criteria are required.');
      return;
    }
    if (sourceKind === 'topic' && !topicId) { toast.error('Select an arena topic.'); return; }
    if (sourceKind === 'test_set' && !testSetId) { toast.error('Select a Judge Lab test set.'); return; }
    setCreating(true);
    const res = await createWeightInferenceSessionAction({
      name: name.trim(),
      mode,
      source_kind: sourceKind,
      pair_kind: sourceKind === 'topic' ? 'article' : pairKind,
      prompt_id: sourceKind === 'topic' ? topicId : null,
      judge_eval_test_set_id: sourceKind === 'test_set' ? testSetId : null,
      sample_size: sampleSize,
      replication_rate: mode === 'auto' ? 0 : replicationRate,
      criteriaIds: [...selectedCriteria],
      ...(mode === 'auto'
        ? {
            judge_model: judgeModel,
            judge_temperature: judgeTemperature,
            auto_repeats: autoRepeats,
            holistic_prompt_override: holisticPromptOverride.trim() || null,
          }
        : {}),
    });
    setCreating(false);
    if (res.success && res.data) {
      toast.success('Session created');
      router.push(`/admin/evolution/weight-inference/${res.data.sessionId}`);
    } else {
      toast.error(res.error?.message ?? 'Create failed');
      void reload();
    }
  };

  // Preview math, derived from the server's exact estimate (Q1: matchesToJudge already accounts
  // for the pool size / min(C(M,2), recommended) cap). A "match" is one head-to-head pairing.
  const criteriaCount = selectedCriteria.size;
  const matches = preview?.matchesToJudge ?? 0;
  const recommended = preview?.required.pairs ?? 0;
  const replicas = mode === 'auto' ? 0 : Math.floor(matches * replicationRate);
  const comparisons = matches + replicas; // matches + reversal re-checks
  const judgments = comparisons * (1 + criteriaCount); // one overall + K per-criterion each
  const llmCalls = matches * autoRepeats * 4;
  const costEst =
    mode === 'auto'
      ? estimateAutoRunCost({
          matches,
          repeats: autoRepeats,
          model: judgeModel,
          avgArticleChars: preview?.avgArticleChars ?? 0,
          criteriaCount,
          holisticOverrideChars: holisticPromptOverride.trim().length,
        })
      : null;
  const fmtUsd = (x: number): string => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);

  // Plain-language breakdown of min( C(M,2), max(20, 12·K) ) for the topic source (Q1 explainer).
  let bindingNote = '';
  if (preview && sourceKind === 'topic' && preview.poolSize > 0) {
    const cMax = (preview.poolSize * (preview.poolSize - 1)) / 2;
    bindingNote =
      preview.bindingLimit === 'pool'
        ? `Your pool of ${preview.poolSize} articles allows ${cMax} distinct matches (${preview.poolSize}×${preview.poolSize - 1}÷2) — fewer than the ${recommended} recommended for ${criteriaCount} criteria (12 per criterion, min 20), so all ${matches} will be judged.`
        : `That's the recommended ${recommended} for ${criteriaCount} criteria (12 per criterion, min 20); your pool of ${preview.poolSize} could supply up to ${cMax} distinct matches.`;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <EvolutionBreadcrumb items={[{ label: 'Implied Rubric Weights' }]} />
      <div>
        <h1 className="font-display text-4xl font-bold text-[var(--text-primary)]">Implied Rubric Weights</h1>
        <p className="font-body text-[var(--text-secondary)] mt-1">
          Infer judge-rubric weights from pairwise winners — picked by you, or by an LLM judge (auto mode) —
          then save the result as a rubric. Weights are <em>implied</em>: each criterion&apos;s weight is fit so
          the weighted vote of per-criterion winners best predicts the overall winner, then normalized to sum
          to 100%. Pick an arena topic (its top arena articles become the pool) or a Judge Lab test set.
        </p>
      </div>

      {/* New session */}
      <Card className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture">
        <CardContent className="p-6 space-y-4">
          <h2 className="font-display text-2xl text-[var(--text-primary)]">New session</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls} htmlFor="wi-name">Name</label>
              <input id="wi-name" data-testid="wi-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fed-rubric v1" />
            </div>
            <div>
              <span className={labelCls}>Pair source</span>
              <div className="flex gap-2 mb-2">
                {(['topic', 'test_set'] as SourceKind[]).map((sk) => (
                  <button
                    key={sk}
                    type="button"
                    data-testid={`wi-source-${sk}`}
                    onClick={() => setSourceKind(sk)}
                    className={`rounded-page border px-3 py-1 font-ui text-sm ${
                      sourceKind === sk ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]' : 'border-[var(--border-default)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {sk === 'topic' ? 'Arena topic' : 'Judge Lab test set'}
                  </button>
                ))}
              </div>
              {sourceKind === 'topic' ? (
                <select id="wi-topic" data-testid="wi-topic" className={inputCls} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                  <option value="">Select a topic…</option>
                  {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              ) : (
                <>
                  <select id="wi-test-set" data-testid="wi-test-set" className={inputCls} value={testSetId} onChange={(e) => setTestSetId(e.target.value)}>
                    <option value="">Select a test set…</option>
                    {testSets.map((t) => <option key={t.id} value={t.id}>{t.name} (A:{t.sizeArticle} P:{t.sizeParagraph})</option>)}
                  </select>
                  <div className="flex gap-2 mt-2" data-testid="wi-pair-kind">
                    {(['article', 'paragraph'] as PairKind[]).map((pk) => (
                      <button
                        key={pk}
                        type="button"
                        onClick={() => setPairKind(pk)}
                        className={`rounded-page border px-3 py-1 font-ui text-xs ${
                          pairKind === pk ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]' : 'border-[var(--border-default)] text-[var(--text-secondary)]'
                        }`}
                      >
                        {pk === 'article' ? 'Article pairs' : 'Paragraph pairs'}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {sourceKind === 'topic' && (
              <div>
                <label className={labelCls} htmlFor="wi-pool">Article pool size</label>
                <input id="wi-pool" data-testid="wi-pool" type="number" min={2} max={100} className={inputCls} value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value))} />
              </div>
            )}
            <div>
              <label className={labelCls} htmlFor="wi-rep">Reversal audit rate</label>
              <input id="wi-rep" type="number" min={0} max={1} step={0.05} className={inputCls} value={replicationRate} onChange={(e) => setReplicationRate(Number(e.target.value))} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <span className={labelCls}>Mode</span>
            {(['human', 'auto'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`wi-mode-${m}`}
                onClick={() => setMode(m)}
                className={`rounded-page border px-3 py-1 font-ui text-sm ${
                  mode === m ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]' : 'border-[var(--border-default)] text-[var(--text-secondary)]'
                }`}
              >
                {m === 'human' ? 'Human' : 'Auto — LLM as judge'}
              </button>
            ))}
          </div>

          {mode === 'auto' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-page border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4" data-testid="wi-auto-settings">
              <div>
                <label className={labelCls} htmlFor="wi-judge-model">Judge model</label>
                <select id="wi-judge-model" className={inputCls} value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)}>
                  {MODEL_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="wi-judge-temp">Temperature</label>
                <input id="wi-judge-temp" type="number" min={0} max={2} step={0.1} className={inputCls} value={judgeTemperature} onChange={(e) => setJudgeTemperature(Number(e.target.value))} />
              </div>
              <div>
                <label className={labelCls} htmlFor="wi-repeats">Repeats / pair</label>
                <input id="wi-repeats" type="number" min={1} max={10} className={inputCls} value={autoRepeats} onChange={(e) => setAutoRepeats(Number(e.target.value))} />
              </div>
              {/* Phase 3 (evalute_implied_rubric_results_and_experimentally_validate_20260623):
                  optional holistic-prompt override, fronted by an Arm-preset dropdown that
                  auto-fills the textarea from canonical EXPERIMENT_ARMS constants so the
                  analysis script's SHA-256 hash gate stays clean. */}
              <details className="md:col-span-3" data-testid="wi-advanced">
                <summary className="font-ui text-sm text-[var(--text-secondary)] cursor-pointer">
                  Advanced — custom holistic prompt (experiments)
                </summary>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <label className={labelCls} htmlFor="wi-arm-preset">Arm preset</label>
                    <select
                      id="wi-arm-preset"
                      data-testid="wi-arm-preset"
                      className={inputCls}
                      value={armPreset}
                      onChange={(e) => {
                        const arm = e.target.value as '' | 'B' | 'C' | 'D';
                        setArmPreset(arm);
                        setHolisticPromptOverride(arm ? (EXPERIMENT_ARMS[arm].prompt ?? '') : '');
                      }}
                    >
                      <option value="">— No preset (free-form) —</option>
                      <option value="B">{EXPERIMENT_ARMS.B.label}</option>
                      <option value="C">{EXPERIMENT_ARMS.C.label}</option>
                      <option value="D">{EXPERIMENT_ARMS.D.label}</option>
                    </select>
                  </div>
                </div>
                <textarea
                  id="wi-holistic-override"
                  data-testid="wi-holistic-override"
                  className={`${inputCls} mt-2`}
                  rows={8}
                  maxLength={8000}
                  placeholder="Leave blank to use the default holistic prompt."
                  value={holisticPromptOverride}
                  onChange={(e) => {
                    // If operator edits after picking a preset, clear the preset so the
                    // dropdown can't lie about what's actually in the textarea.
                    if (armPreset) setArmPreset('');
                    setHolisticPromptOverride(e.target.value);
                  }}
                />
              </details>
            </div>
          )}

          <div>
            <span className={labelCls}>Criteria to weight ({selectedCriteria.size} selected)</span>
            <div className="flex flex-wrap gap-2" data-testid="wi-criteria">
              {criteria.map((c) => {
                const on = selectedCriteria.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    title={c.description ?? undefined}
                    onClick={() => toggleCriterion(c.id)}
                    className={`rounded-page border px-3 py-1 font-ui text-sm transition-scholar ${
                      on
                        ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]'
                        : 'border-[var(--border-default)] text-[var(--text-secondary)]'
                    }`}
                  >
                    {on ? '✓ ' : ''}{c.name}
                  </button>
                );
              })}
              {criteria.length === 0 && (
                <span className="font-body text-sm text-[var(--text-secondary)]">
                  No criteria yet — create some under Criteria first.
                </span>
              )}
            </div>
            {/* Descriptions of the selected criteria (hover the chips above for any criterion). */}
            {selectedCriteria.size > 0 && (
              <ul className="mt-2 space-y-1" data-testid="wi-criteria-descriptions">
                {criteria
                  .filter((c) => selectedCriteria.has(c.id))
                  .map((c) => (
                    <li key={c.id} className="font-body text-xs text-[var(--text-secondary)]">
                      <strong className="text-[var(--text-primary)]">{c.name}</strong>
                      {c.description ? ` — ${c.description}` : ''}
                    </li>
                  ))}
              </ul>
            )}
          </div>

          {preview && selectedCriteria.size >= 2 && (
            <div className="rounded-page border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 font-body text-sm text-[var(--text-secondary)]" data-testid="wi-preview">
              <span data-testid="wi-recommended">
                Judging <strong className="text-[var(--text-primary)]">{matches}</strong> match{matches === 1 ? '' : 'es'} ({criteriaCount} criteria; ≈ {recommended} recommended).
              </span>
              {sourceKind === 'topic' && preview.poolSize > 0 && (
                <span className="block mt-1" data-testid="wi-match-breakdown">{bindingNote}</span>
              )}
              {sourceKind === 'topic' && topicId && preview.poolSize === 0 && (
                <span className="block mt-1 text-[var(--status-warning)]">This topic has no arena articles yet — pick another topic.</span>
              )}
              {sourceKind === 'test_set' && (
                <span className="block mt-1" data-testid="wi-testset-size">
                  This test set provides <strong className="text-[var(--text-primary)]">{matches}</strong> {pairKind} match{matches === 1 ? '' : 'es'}
                  {recommended > matches
                    ? ` — fewer than the ~${recommended} recommended; weights will be rougher.`
                    : ` — at or above the ~${recommended} recommended.`}
                </span>
              )}
              <span className="block mt-1">
                {mode === 'auto'
                  ? `≈ ${llmCalls} LLM calls (4 per match × ${autoRepeats} repeat${autoRepeats === 1 ? '' : 's'}; 2 holistic + 2 rubric).`
                  : `You'll make ${comparisons} comparisons (incl. reversal re-checks) → ${judgments} total judgments.`}
              </span>
              {costEst && matches > 0 && (
                <span className="block mt-1" data-testid="wi-cost-estimate">
                  Estimated cost: ≈ <strong className="text-[var(--text-primary)]">{fmtUsd(costEst.totalUsd)}</strong> with {judgeModel} (upper-bound).
                </span>
              )}
              <span className="block text-[var(--text-secondary)] mt-1">Rough estimate; refines live{mode === 'auto' ? ' as the run progresses' : ' as you judge'}.</span>
            </div>
          )}

          <Button variant="scholar" data-testid="wi-create" disabled={creating} onClick={() => void create()}>
            {creating ? 'Creating…' : 'Create session'}
          </Button>
        </CardContent>
      </Card>

      {/* Sessions list */}
      <Card className="rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] paper-texture">
        <CardContent className="p-6">
          <h2 className="font-display text-2xl text-[var(--text-primary)] mb-4">Sessions</h2>
          {loading ? (
            <p className="font-body text-[var(--text-secondary)]">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="font-body text-[var(--text-secondary)]">No sessions yet.</p>
          ) : (
            <table className="w-full font-ui text-sm">
              <thead>
                <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border-default)]">
                  <th className="py-2">Name</th><th>Mode</th><th>Criteria</th><th>Progress</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--border-default)] scholar-table-row">
                    <td className="py-2">
                      <Link href={`/admin/evolution/weight-inference/${s.id}`} className="text-[var(--accent-gold)] gold-underline">
                        {s.name}
                      </Link>
                      {s.has_override && (
                        <span
                          className="ml-2 rounded-page border border-[var(--accent-gold)] px-1.5 py-0.5 text-xs text-[var(--accent-gold)]"
                          data-testid="wi-custom-badge"
                          title="Custom holistic prompt in use"
                        >
                          custom
                        </span>
                      )}
                    </td>
                    <td>{s.mode}{s.judge_model ? ` · ${s.judge_model}` : ''}</td>
                    <td>{s.criteria_count}</td>
                    <td>{s.pairs_overall_done}/{s.pairs_total} pairs</td>
                    <td>{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
