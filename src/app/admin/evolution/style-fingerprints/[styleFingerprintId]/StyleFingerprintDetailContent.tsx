'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { EntityDetailHeader, EntityDetailTabs, useTabState, EvolutionBreadcrumb } from '@evolution/components/evolution';
import { EntityMetricsTab } from '@evolution/components/evolution/tabs/EntityMetricsTab';
import {
  getStyleFingerprintDetailAction,
  addArticleToFingerprintAction,
  removeArticleFromFingerprintAction,
  reorderFingerprintArticlesAction,
  reExtractFingerprintAction,
  type StyleFingerprintDetail,
} from '@evolution/services/styleFingerprintActions';
import type { TabDef } from '@evolution/lib/core/types';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'articles', label: 'Articles' },
  { id: 'metrics', label: 'Metrics' },
];

function OverviewTab(
  { detail, onReExtract, busy }: { detail: StyleFingerprintDetail; onReExtract: () => void; busy: boolean },
): JSX.Element {
  const fp = detail.fingerprint.fingerprint;
  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-ui font-semibold text-[var(--text-secondary)] mb-1">Description</h3>
        <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
          {detail.fingerprint.description || <span className="text-[var(--text-muted)] italic">No description.</span>}
        </p>
      </section>

      <div className="flex justify-end">
        <button
          data-testid="re-extract-button"
          onClick={onReExtract}
          disabled={busy || detail.fingerprint.article_count === 0}
          className="px-3 py-1.5 text-sm border border-[var(--border-default)] rounded disabled:opacity-40"
        >
          {busy ? 'Re-extracting…' : 'Re-extract'}
        </button>
      </div>

      {fp ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section>
            <h3 className="text-sm font-ui font-semibold text-[var(--text-secondary)] mb-2">Structured traits</h3>
            <ul className="space-y-1 text-sm text-[var(--text-secondary)]">
              <li>Sentence length: ~{Math.round(fp.sentenceLength.avgWords)} words ({fp.sentenceLength.distribution})</li>
              <li>Spelling: {fp.spellingRegion}</li>
              <li>Tone: {fp.tone.join(', ') || '—'}</li>
              <li>Vocabulary: {fp.vocabularyLevel}</li>
              <li>Signature phrases: {fp.signaturePhrases.map((p) => `"${p.phrase}" (${p.frequency})`).join(', ') || '—'}</li>
              <li>Structural: {fp.structuralHabits.join('; ') || '—'}</li>
              <li>Articles: {detail.fingerprint.article_count}</li>
            </ul>
          </section>
          <section>
            <h3 className="text-sm font-ui font-semibold text-[var(--text-secondary)] mb-2">Rendered prose (used in prompts)</h3>
            <p className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap">{detail.fingerprint.fingerprint_prose}</p>
          </section>
        </div>
      ) : (
        <p className="text-sm text-[var(--text-muted)] italic">
          No fingerprint computed yet. Add one or more articles on the Articles tab to compute it.
        </p>
      )}
    </div>
  );
}

function ArticlesTab(
  { detail, onChange }: { detail: StyleFingerprintDetail; onChange: () => Promise<void> },
): JSX.Element {
  const fingerprintId = detail.fingerprint.id;
  const [mode, setMode] = useState<'search' | 'paste'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [explanationId, setExplanationId] = useState('');
  const [busy, setBusy] = useState(false);

  const articles = detail.articles;

  const add = async () => {
    setBusy(true);
    try {
      const input = mode === 'paste'
        ? { fingerprintId, articleText: pasteText.trim() }
        : { fingerprintId, explanationId: Number(explanationId) };
      const result = await addArticleToFingerprintAction(input);
      if (!result.success) throw new Error(result.error?.message ?? 'Add failed');
      toast.success('Article added — fingerprint recomputed');
      setPasteText('');
      setExplanationId('');
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Add failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (articleId: string) => {
    setBusy(true);
    try {
      const result = await removeArticleFromFingerprintAction({ fingerprintId, articleId });
      if (!result.success) throw new Error(result.error?.message ?? 'Remove failed');
      toast.success('Article removed — fingerprint recomputed');
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, dir: -1 | 1) => {
    const next = [...articles];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const a = next[index];
    const b = next[target];
    if (!a || !b) return;
    next[index] = b;
    next[target] = a;
    setBusy(true);
    try {
      const result = await reorderFingerprintArticlesAction({ fingerprintId, orderedArticleIds: next.map((r) => r.id) });
      if (!result.success) throw new Error(result.error?.message ?? 'Reorder failed');
      await onChange();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reorder failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="articles-tab">
      <div className="text-xs text-[var(--text-muted)]">
        {articles.length} article(s). Adding or removing recomputes the fingerprint.
      </div>

      <table className="w-full text-xs">
        <tbody>
          {articles.map((a, i) => (
            <tr key={a.id} className="border-b border-[var(--border-subtle)] last:border-0" data-testid="article-row">
              <td className="py-1.5 pr-3 w-8 text-[var(--text-muted)]">{i + 1}</td>
              <td className="py-1.5 pr-3">
                {a.explanation_id != null
                  ? <span>explanation #{a.explanation_id}</span>
                  : <span className="text-[var(--text-secondary)]">{(a.article_text ?? '').slice(0, 80)}…</span>}
              </td>
              <td className="py-1.5 pr-1 text-right">
                <button onClick={() => move(i, -1)} disabled={busy || i === 0} className="px-1 disabled:opacity-30" aria-label="Move up">↑</button>
                <button onClick={() => move(i, 1)} disabled={busy || i === articles.length - 1} className="px-1 disabled:opacity-30" aria-label="Move down">↓</button>
                <button onClick={() => remove(a.id)} disabled={busy} className="px-2 text-[var(--status-error)] disabled:opacity-30" data-testid="remove-article">Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'search'} onChange={() => setMode('search')} /> Existing explanation
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'paste'} onChange={() => setMode('paste')} /> Paste text
          </label>
        </div>
        {mode === 'search' ? (
          <input
            data-testid="article-explanation-id"
            type="number"
            value={explanationId}
            onChange={(e) => setExplanationId(e.target.value)}
            placeholder="Explanation ID"
            className="w-full px-2 py-1 text-sm border border-[var(--border-default)] rounded bg-transparent"
          />
        ) : (
          <textarea
            data-testid="article-paste-text"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste an article in the target author's voice…"
            rows={5}
            className="w-full px-2 py-1 text-sm border border-[var(--border-default)] rounded bg-transparent"
          />
        )}
        <button
          data-testid="add-article-button"
          onClick={add}
          disabled={busy || (mode === 'paste' ? pasteText.trim().length === 0 : explanationId.trim().length === 0)}
          className="px-3 py-1.5 text-sm border border-[var(--border-default)] rounded disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Add article'}
        </button>
      </div>
    </div>
  );
}

export function StyleFingerprintDetailContent({ fingerprintId }: { fingerprintId: string }): JSX.Element {
  const [detail, setDetail] = useState<StyleFingerprintDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useTabState(TABS);

  const load = useCallback(async () => {
    const result = await getStyleFingerprintDetailAction(fingerprintId);
    if (result.success && result.data) { setDetail(result.data); setError(null); }
    else setError(result.error?.message ?? 'Style fingerprint not found');
    setLoading(false);
  }, [fingerprintId]);

  useEffect(() => { load(); }, [load]);

  const reExtract = useCallback(async () => {
    setBusy(true);
    try {
      const result = await reExtractFingerprintAction(fingerprintId);
      if (!result.success) throw new Error(result.error?.message ?? 'Re-extract failed');
      toast.success('Re-extracted');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Re-extract failed');
    } finally {
      setBusy(false);
    }
  }, [fingerprintId, load]);

  if (loading) return <div className="p-8 text-center text-sm text-[var(--text-secondary)]">Loading style fingerprint…</div>;
  if (error || !detail) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-display font-bold text-[var(--status-error)] mb-4">Error</h2>
        <p className="text-sm text-[var(--text-secondary)]">{error ?? 'Style fingerprint not found'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <EvolutionBreadcrumb items={[
        { label: 'Evolution', href: '/admin/evolution-dashboard' },
        { label: 'Style Fingerprints', href: '/admin/evolution/style-fingerprints' },
        { label: detail.fingerprint.name },
      ]} />

      <EntityDetailHeader title={detail.fingerprint.name} entityId={detail.fingerprint.id} />

      <EntityDetailTabs tabs={TABS} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'overview' && <OverviewTab detail={detail} onReExtract={reExtract} busy={busy} />}
        {activeTab === 'articles' && <ArticlesTab detail={detail} onChange={load} />}
        {activeTab === 'metrics' && <EntityMetricsTab entityType="style_fingerprint" entityId={fingerprintId} />}
      </EntityDetailTabs>
    </div>
  );
}
