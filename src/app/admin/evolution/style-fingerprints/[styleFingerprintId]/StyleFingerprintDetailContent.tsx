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
  updateStyleFingerprintDetailsAction,
  type StyleFingerprintDetail,
} from '@evolution/services/styleFingerprintActions';
import type { StyleFingerprintTraits } from '@evolution/lib/schemas';
import type { TabDef } from '@evolution/lib/core/types';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'articles', label: 'Articles' },
  { id: 'metrics', label: 'Metrics' },
];

const inputCls = 'w-full px-2 py-1 text-sm border border-[var(--border-default)] rounded bg-transparent';
const FREQUENCIES = ['rare', 'occasional', 'frequent'] as const;

function EditDetailsForm(
  { initial, onCancel, onSave }: {
    initial: StyleFingerprintTraits;
    onCancel: () => void;
    onSave: (traits: StyleFingerprintTraits) => Promise<void>;
  },
): JSX.Element {
  const [avgWords, setAvgWords] = useState(String(initial.sentenceLength.avgWords));
  const [distribution, setDistribution] = useState(initial.sentenceLength.distribution);
  const [spellingRegion, setSpellingRegion] = useState<StyleFingerprintTraits['spellingRegion']>(initial.spellingRegion);
  const [vocabularyLevel, setVocabularyLevel] = useState(initial.vocabularyLevel);
  const [tone, setTone] = useState(initial.tone.join(', '));
  const [phrases, setPhrases] = useState(initial.signaturePhrases.map((p) => ({ ...p })));
  const [structural, setStructural] = useState(initial.structuralHabits.join('\n'));
  const [punctuation, setPunctuation] = useState(initial.punctuationHabits.join('\n'));
  const [summary, setSummary] = useState(initial.summary);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const traits: StyleFingerprintTraits = {
        sentenceLength: { avgWords: Number(avgWords), distribution: distribution.trim() },
        spellingRegion,
        vocabularyLevel: vocabularyLevel.trim(),
        tone: tone.split(',').map((s) => s.trim()).filter(Boolean),
        signaturePhrases: phrases
          .filter((p) => p.phrase.trim().length > 0)
          .map((p) => ({ phrase: p.phrase.trim(), frequency: p.frequency })),
        structuralHabits: structural.split('\n').map((s) => s.trim()).filter(Boolean),
        punctuationHabits: punctuation.split('\n').map((s) => s.trim()).filter(Boolean),
        summary: summary.trim(),
      };
      await onSave(traits);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="edit-details-form">
      <p className="text-xs text-[var(--status-warning)]">
        Editing the generated details directly. A later add/remove-article or Re-extract recomputes from
        the article set and overwrites these edits.
      </p>
      <div>
        <label className="text-xs text-[var(--text-muted)]">Summary</label>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className={inputCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[var(--text-muted)]">Avg words / sentence</label>
          <input type="number" value={avgWords} onChange={(e) => setAvgWords(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)]">Spelling region</label>
          <select
            value={spellingRegion}
            onChange={(e) => setSpellingRegion(e.target.value as StyleFingerprintTraits['spellingRegion'])}
            className={inputCls}
          >
            <option value="american">american</option>
            <option value="british">british</option>
            <option value="mixed">mixed</option>
          </select>
        </div>
      </div>
      <div>
        <label className="text-xs text-[var(--text-muted)]">Sentence-length distribution</label>
        <input value={distribution} onChange={(e) => setDistribution(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="text-xs text-[var(--text-muted)]">Vocabulary level</label>
        <input value={vocabularyLevel} onChange={(e) => setVocabularyLevel(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="text-xs text-[var(--text-muted)]">Tone (comma-separated)</label>
        <input value={tone} onChange={(e) => setTone(e.target.value)} className={inputCls} />
      </div>
      <div>
        <label className="text-xs text-[var(--text-muted)]">Signature phrases</label>
        <div className="space-y-1">
          {phrases.map((p, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={p.phrase}
                onChange={(e) => setPhrases((prev) => prev.map((x, j) => (j === i ? { ...x, phrase: e.target.value } : x)))}
                placeholder="phrase"
                className={inputCls}
              />
              <select
                value={p.frequency}
                onChange={(e) => setPhrases((prev) => prev.map((x, j) => (j === i ? { ...x, frequency: e.target.value as typeof x.frequency } : x)))}
                className="px-2 py-1 text-sm border border-[var(--border-default)] rounded bg-transparent"
              >
                {FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <button onClick={() => setPhrases((prev) => prev.filter((_, j) => j !== i))} className="px-2 text-[var(--status-error)]" aria-label="Remove phrase">✕</button>
            </div>
          ))}
          <button
            onClick={() => setPhrases((prev) => [...prev, { phrase: '', frequency: 'occasional' as const }])}
            className="text-xs text-[var(--accent-gold)]"
          >
            + Add phrase
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[var(--text-muted)]">Structural habits (one per line)</label>
          <textarea value={structural} onChange={(e) => setStructural(e.target.value)} rows={3} className={inputCls} />
        </div>
        <div>
          <label className="text-xs text-[var(--text-muted)]">Punctuation habits (one per line)</label>
          <textarea value={punctuation} onChange={(e) => setPunctuation(e.target.value)} rows={3} className={inputCls} />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} disabled={busy} className="px-3 py-1.5 text-sm border border-[var(--border-default)] rounded disabled:opacity-40">Cancel</button>
        <button data-testid="save-details-button" onClick={save} disabled={busy} className="px-3 py-1.5 text-sm border border-[var(--accent-gold)] text-[var(--accent-gold)] rounded disabled:opacity-40">
          {busy ? 'Saving…' : 'Save details'}
        </button>
      </div>
    </div>
  );
}

function OverviewTab(
  { detail, onReExtract, onChange, busy }: {
    detail: StyleFingerprintDetail;
    onReExtract: () => void;
    onChange: () => Promise<void>;
    busy: boolean;
  },
): JSX.Element {
  const fp = detail.fingerprint.fingerprint;
  const [editing, setEditing] = useState(false);

  const saveDetails = async (traits: StyleFingerprintTraits) => {
    const result = await updateStyleFingerprintDetailsAction({ id: detail.fingerprint.id, fingerprint: traits });
    if (!result.success) { toast.error(result.error?.message ?? 'Save failed'); return; }
    toast.success('Details updated');
    setEditing(false);
    await onChange();
  };

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-sm font-ui font-semibold text-[var(--text-secondary)] mb-1">Description</h3>
        <p className="text-sm text-[var(--text-primary)] whitespace-pre-wrap">
          {detail.fingerprint.description || <span className="text-[var(--text-muted)] italic">No description.</span>}
        </p>
      </section>

      {!editing && (
        <div className="flex justify-end gap-2">
          {fp && (
            <button
              data-testid="edit-details-button"
              onClick={() => setEditing(true)}
              disabled={busy}
              className="px-3 py-1.5 text-sm border border-[var(--border-default)] rounded disabled:opacity-40"
            >
              Edit details
            </button>
          )}
          <button
            data-testid="re-extract-button"
            onClick={onReExtract}
            disabled={busy || detail.fingerprint.article_count === 0}
            className="px-3 py-1.5 text-sm border border-[var(--border-default)] rounded disabled:opacity-40"
          >
            {busy ? 'Re-extracting…' : 'Re-extract'}
          </button>
        </div>
      )}

      {editing && fp ? (
        <EditDetailsForm initial={fp} onCancel={() => setEditing(false)} onSave={saveDetails} />
      ) : fp ? (
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
        {activeTab === 'overview' && <OverviewTab detail={detail} onReExtract={reExtract} onChange={load} busy={busy} />}
        {activeTab === 'articles' && <ArticlesTab detail={detail} onChange={load} />}
        {activeTab === 'metrics' && <EntityMetricsTab entityType="style_fingerprint" entityId={fingerprintId} />}
      </EntityDetailTabs>
    </div>
  );
}
