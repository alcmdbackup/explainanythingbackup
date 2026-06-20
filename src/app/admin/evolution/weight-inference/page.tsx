// Implied Rubric Weights — sessions landing + new-session form. Lists weight-inference
// sessions and creates one (pick arena topic + criteria + pool size), showing the
// ratings-needed preview before creation. Human mode (auto mode added in Phase 5).

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
} from '@evolution/services/weightInferenceActions';
import { getArenaTopicsAction } from '@evolution/services/arenaActions';
import { listCriteriaAction } from '@evolution/services/criteriaActions';

interface TopicOpt { id: string; name: string }
interface CriterionOpt { id: string; name: string }

const inputCls =
  'w-full rounded-page border border-[var(--border-default)] bg-[var(--surface-input)] px-3 py-2 text-[var(--text-primary)] font-ui text-sm';
const labelCls = 'block font-ui text-sm font-medium text-[var(--text-secondary)] mb-1';

export default function WeightInferencePage(): JSX.Element {
  const router = useRouter();
  const [sessions, setSessions] = useState<WiSessionListItem[]>([]);
  const [topics, setTopics] = useState<TopicOpt[]>([]);
  const [criteria, setCriteria] = useState<CriterionOpt[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [topicId, setTopicId] = useState('');
  const [selectedCriteria, setSelectedCriteria] = useState<Set<string>>(new Set());
  const [sampleSize, setSampleSize] = useState(30);
  const [replicationRate, setReplicationRate] = useState(0.15);
  const [preview, setPreview] = useState<{ pairs: number; comparisons: number; verdicts: number } | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    const res = await listWeightInferenceSessionsAction({ filterTestContent: true });
    if (res.success && res.data) setSessions(res.data.items);
    else if (!res.success) toast.error(res.error?.message ?? 'Failed to load sessions');
  }, []);

  useEffect(() => {
    void (async () => {
      const [s, t, c] = await Promise.all([
        listWeightInferenceSessionsAction({ filterTestContent: true }),
        getArenaTopicsAction({ filterTestContent: true }),
        listCriteriaAction({ status: 'active', filterTestContent: true, limit: 200 }),
      ]);
      if (s.success && s.data) setSessions(s.data.items);
      if (t.success && t.data) setTopics(t.data.map((x) => ({ id: x.id, name: x.name || x.id })));
      if (c.success && c.data) setCriteria(c.data.items.map((x) => ({ id: x.id, name: x.name })));
      setLoading(false);
    })();
  }, []);

  // live ratings-needed preview
  useEffect(() => {
    void (async () => {
      const res = await getWeightInferencePreviewAction({
        criteriaCount: selectedCriteria.size,
        replicationRate,
      });
      if (res.success && res.data) setPreview(res.data.required);
    })();
  }, [selectedCriteria, replicationRate]);

  const toggleCriterion = (id: string): void => {
    setSelectedCriteria((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const create = async (): Promise<void> => {
    if (!name.trim() || !topicId || selectedCriteria.size < 2) {
      toast.error('Name, a topic, and at least 2 criteria are required.');
      return;
    }
    setCreating(true);
    const res = await createWeightInferenceSessionAction({
      name: name.trim(),
      mode: 'human',
      prompt_id: topicId,
      sample_size: sampleSize,
      replication_rate: replicationRate,
      criteriaIds: [...selectedCriteria],
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

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <EvolutionBreadcrumb items={[{ label: 'Implied Rubric Weights' }]} />
      <div>
        <h1 className="font-display text-4xl font-bold text-[var(--text-primary)]">Implied Rubric Weights</h1>
        <p className="font-body text-[var(--text-secondary)] mt-1">
          Infer judge-rubric weights from human pairwise verdicts, then save the result as a rubric.
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
              <label className={labelCls} htmlFor="wi-topic">Arena topic</label>
              <select id="wi-topic" data-testid="wi-topic" className={inputCls} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
                <option value="">Select a topic…</option>
                {topics.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="wi-pool">Article pool size</label>
              <input id="wi-pool" type="number" min={2} max={100} className={inputCls} value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value))} />
            </div>
            <div>
              <label className={labelCls} htmlFor="wi-rep">Reversal audit rate</label>
              <input id="wi-rep" type="number" min={0} max={1} step={0.05} className={inputCls} value={replicationRate} onChange={(e) => setReplicationRate(Number(e.target.value))} />
            </div>
          </div>

          <div>
            <span className={labelCls}>Criteria to weight ({selectedCriteria.size} selected)</span>
            <div className="flex flex-wrap gap-2" data-testid="wi-criteria">
              {criteria.map((c) => {
                const on = selectedCriteria.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
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
          </div>

          {preview && selectedCriteria.size >= 2 && (
            <div className="rounded-page border border-[var(--border-default)] bg-[var(--surface-elevated)] p-4 font-body text-sm text-[var(--text-secondary)]" data-testid="wi-preview">
              Preview: ≈ <strong className="text-[var(--text-primary)]">{preview.pairs}</strong> pairs →{' '}
              {preview.comparisons} comparisons (with reversal audit) → {preview.verdicts} total verdicts.
              <span className="block text-[var(--text-secondary)] mt-1">Rough estimate; refines live as you judge.</span>
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
