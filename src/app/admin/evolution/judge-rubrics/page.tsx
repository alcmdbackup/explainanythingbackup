// Judge Rubrics admin page (self-managed): list rubrics + a create/edit builder that
// picks evolution_criteria as dimensions and assigns weights (entered as percentages
// that must sum to 100; normalized at judge time). Delete is gated server-side while an
// active strategy references the rubric. structured_judging_evolution_20260610.
'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { Button } from '@/components/ui/button';
import {
  listJudgeRubricsAction,
  getJudgeRubricDetailAction,
  createJudgeRubricAction,
  updateJudgeRubricAction,
  archiveJudgeRubricAction,
  deleteJudgeRubricAction,
  type JudgeRubricListItem,
} from '@evolution/services/judgeRubricActions';
import { listCriteriaAction, type CriteriaListItem } from '@evolution/services/criteriaActions';
import { evenSplit, hydrateDimensionWeights, type WeightedDim as DraftDim } from './rubricWeights';

const CARD = 'rounded-book border border-[var(--border-default)] bg-[var(--surface-secondary)] p-5';
const INPUT =
  'border border-[var(--border-default)] rounded-page px-2 py-1 text-sm bg-[var(--surface-input)] text-[var(--text-primary)] font-ui';
const WEIGHT_TOLERANCE = 0.01;

interface Draft { id?: string; name: string; label: string; description: string; dims: DraftDim[] }

const EMPTY_DRAFT: Draft = { name: '', label: '', description: '', dims: [] };

export default function JudgeRubricsPage(): JSX.Element {
  const [rubrics, setRubrics] = useState<JudgeRubricListItem[]>([]);
  const [criteria, setCriteria] = useState<CriteriaListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const [r, c] = await Promise.all([
      listJudgeRubricsAction({ filterTestContent: false }),
      // The dimension picker intentionally shows ALL active criteria (including test-named
      // ones): the rubric builder + its E2E spec build rubrics from factory-created test
      // criteria, and admins may legitimately compose test rubrics. (Finding T8 proposed
      // filtering test criteria here, but that breaks the builder workflow — won't fix.)
      listCriteriaAction({ status: 'active', filterTestContent: false, limit: 200 }),
    ]);
    if (r.success && r.data) setRubrics(r.data.items);
    if (c.success && c.data) setCriteria(c.data.items);
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const openEdit = async (id: string): Promise<void> => {
    const res = await getJudgeRubricDetailAction(id);
    if (!res.success || !res.data) { toast.error(res.error?.message ?? 'Load failed'); return; }
    const d = res.data;
    setDraft({
      id: d.id,
      name: d.name,
      label: d.label,
      description: d.description ?? '',
      dims: hydrateDimensionWeights(d.dimensions.map((x) => ({ criteria_id: x.criteria_id, weight: x.weight }))),
    });
  };

  const toggleDim = (criteriaId: string): void => {
    if (!draft) return;
    const has = draft.dims.some((x) => x.criteria_id === criteriaId);
    const next = has
      ? draft.dims.filter((x) => x.criteria_id !== criteriaId)
      : [...draft.dims, { criteria_id: criteriaId, weight: 0 }];
    // Re-balance to an even split so a fresh selection always sums to 100; the user can
    // then fine-tune individual weights.
    setDraft({ ...draft, dims: evenSplit(next) });
  };

  const setWeight = (criteriaId: string, weight: number): void => {
    if (!draft) return;
    setDraft({ ...draft, dims: draft.dims.map((x) => (x.criteria_id === criteriaId ? { ...x, weight } : x)) });
  };

  const weightSum = draft ? draft.dims.reduce((s, d) => s + (Number.isFinite(d.weight) ? d.weight : 0), 0) : 0;
  const weightsValid = !!draft && draft.dims.length > 0 && Math.abs(weightSum - 100) <= WEIGHT_TOLERANCE;

  const save = async (): Promise<void> => {
    if (!draft) return;
    if (!draft.name.trim()) { toast.error('Name is required'); return; }
    if (draft.dims.length === 0) { toast.error('Pick at least one dimension'); return; }
    if (!weightsValid) { toast.error(`Weights must add up to 100% (currently ${weightSum.toFixed(0)}%)`); return; }
    const dimensions = draft.dims.map((d, i) => ({ criteria_id: d.criteria_id, weight: d.weight, position: i }));
    const res = draft.id
      ? await updateJudgeRubricAction({ id: draft.id, name: draft.name, label: draft.label, description: draft.description, dimensions })
      : await createJudgeRubricAction({ name: draft.name, label: draft.label || undefined, description: draft.description || null, dimensions });
    if (!res.success) { toast.error(res.error?.message ?? 'Save failed'); return; }
    toast.success(draft.id ? 'Rubric updated' : 'Rubric created');
    setDraft(null);
    void reload();
  };

  const archive = async (id: string): Promise<void> => {
    const res = await archiveJudgeRubricAction(id);
    if (!res.success) { toast.error(res.error?.message ?? 'Archive failed'); return; }
    toast.success('Rubric archived');
    void reload();
  };

  const remove = async (id: string): Promise<void> => {
    if (!confirm('Delete this rubric? (blocked if an active strategy references it)')) return;
    const res = await deleteJudgeRubricAction(id);
    if (!res.success) { toast.error(res.error?.message ?? 'Delete failed'); return; }
    toast.success('Rubric deleted');
    void reload();
  };

  return (
    <div className="space-y-5 font-ui" data-testid="judge-rubrics-page">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Rubrics' },
        ]}
      />

      <div className="flex items-center justify-between">
        <h1 className="font-display text-4xl font-bold text-[var(--text-primary)]">Judge Rubrics</h1>
        <Button size="sm" data-testid="new-rubric-btn" onClick={() => setDraft({ ...EMPTY_DRAFT })}>
          New rubric
        </Button>
      </div>

      <div className={CARD}>
        {loading ? <div className="text-sm text-[var(--text-secondary)]">Loading…</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--text-secondary)] text-xs">
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Dimensions</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rubrics.length === 0 && (
                <tr><td colSpan={4} className="py-2 text-[var(--text-secondary)]">No rubrics yet. Create one to use rubric-based judging in a strategy.</td></tr>
              )}
              {rubrics.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border-default)]" data-testid="rubric-row">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-primary)]">{r.name}</td>
                  <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{r.dimension_count}</td>
                  <td className="py-1.5 pr-3 text-[var(--text-secondary)]">{r.status}</td>
                  <td className="py-1.5 pr-3 text-right space-x-1">
                    <Button variant="ghost" size="sm" onClick={() => void openEdit(r.id)}>Edit</Button>
                    {r.status === 'active' && <Button variant="ghost" size="sm" onClick={() => void archive(r.id)}>Archive</Button>}
                    <Button variant="ghost" size="sm" className="text-[var(--status-error)]" onClick={() => void remove(r.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {draft && (
        <div className={CARD} data-testid="rubric-builder">
          <div className="font-display text-lg text-[var(--text-primary)] mb-3">{draft.id ? 'Edit rubric' : 'New rubric'}</div>
          <div className="grid gap-2 mb-4">
            <input className={INPUT} placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} data-testid="rubric-name" />
            <input className={INPUT} placeholder="Label (optional)" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
            <textarea className={INPUT} placeholder="Description (optional)" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </div>

          <div className="flex items-center justify-between mb-1">
            <div className="text-xs text-[var(--text-secondary)]">Dimensions & weights (must add up to 100%)</div>
            <div className="flex items-center gap-2">
              <span
                data-testid="weight-sum"
                className={`text-xs font-medium ${weightsValid ? 'text-[var(--status-success)]' : 'text-[var(--status-error)]'}`}
              >
                {weightsValid ? '✓ 100%' : `${weightSum.toFixed(0)}% / 100%`}
              </span>
              {draft.dims.length > 0 && (
                <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, dims: evenSplit(draft.dims) })}>Even split</Button>
              )}
            </div>
          </div>
          {draft.dims.length > 0 && !weightsValid && (
            <div className="text-xs text-[var(--status-error)] mb-2" data-testid="weight-error">
              Weights must add up to 100% (currently {weightSum.toFixed(0)}%). Adjust the values or use “Even split”.
            </div>
          )}

          <div className="max-h-80 overflow-y-auto rounded-page border border-[var(--border-default)]">
            {criteria.map((c) => {
              const sel = draft.dims.find((x) => x.criteria_id === c.id);
              return (
                <label key={c.id} className="flex items-start gap-2 px-3 py-2 text-sm border-b border-[var(--border-default)] last:border-b-0">
                  <input type="checkbox" className="mt-1" checked={!!sel} onChange={() => toggleDim(c.id)} data-testid={`dim-toggle-${c.name}`} />
                  <span className="flex-1">
                    <span className="text-[var(--text-primary)] font-medium">{c.name}</span>
                    {c.description && <span className="block text-xs text-[var(--text-secondary)]">{c.description}</span>}
                  </span>
                  {sel && (
                    <span className="flex items-center gap-1 shrink-0">
                      <input
                        type="number" min={0} max={100} step={1} value={sel.weight}
                        onChange={(e) => setWeight(c.id, Number(e.target.value))}
                        className={`${INPUT} w-16 text-right`} data-testid={`dim-weight-${c.name}`}
                      />
                      <span className="text-xs text-[var(--text-secondary)]">%</span>
                    </span>
                  )}
                </label>
              );
            })}
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button size="sm" onClick={() => void save()} disabled={!weightsValid || !draft.name.trim()} data-testid="rubric-save">Save</Button>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
