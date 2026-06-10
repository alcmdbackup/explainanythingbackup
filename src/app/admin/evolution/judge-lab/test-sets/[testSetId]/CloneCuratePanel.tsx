// Judge Lab — "Clone & curate" panel for a test set. Lists the source's BANK pairs (the available
// universe) with filters (Kind · Membership · Gap-kind · Elo both-sides min/max · label search),
// pre-checks current members, and clones the curated selection into a NEW frozen set via the manual
// strategy. Existing pairs only — we select which recorded matchups are members, never edit texts.
'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  getBankPairsForCurationAction,
  getTestSetPairTextsAction,
  cloneTestSetAction,
} from '@evolution/services/judgeEvalActions';

type Kind = 'article' | 'paragraph' | 'both';
type Membership = 'all' | 'member' | 'non_member';
type GapKind = 'all' | 'large' | 'close';

interface CurationRow {
  label: string;
  pair_kind: string;
  elo_a: number | null;
  elo_b: number | null;
  uncertainty_a: number | null;
  uncertainty_b: number | null;
  elo_gap: number | null;
  gap_kind: string | null;
  isMember: boolean;
}
interface CurationResult {
  pairs: CurationRow[];
  total: number;
  memberCount: number;
  filteredLabels: string[];
}

const PAGE = 50;

function elo(v: number | null, u: number | null): string {
  if (v == null) return '—';
  return u == null ? `${v}` : `${v} ± ${u}`;
}
function num(v: string): number | null {
  const n = Number(v);
  return v.trim() === '' || Number.isNaN(n) ? null : n;
}

export default function CloneCuratePanel({
  testSetId,
  sourceName,
  onCloned,
}: {
  testSetId: string;
  sourceName: string;
  onCloned: () => void;
}): JSX.Element {
  const [newName, setNewName] = useState(`${sourceName}-curated`);
  const [kind, setKind] = useState<Kind>('both');
  const [membership, setMembership] = useState<Membership>('all');
  const [gapKind, setGapKind] = useState<GapKind>('all');
  const [search, setSearch] = useState('');
  const [eloMin, setEloMin] = useState('');
  const [eloMax, setEloMax] = useState('');
  const [offset, setOffset] = useState(0);

  const [result, setResult] = useState<CurationResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState(false);
  const [texts, setTexts] = useState<Record<string, { text_a: string; text_b: string }>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Seed the selection from the source set's CURRENT members (all of them, not just a page).
  useEffect(() => {
    void (async () => {
      const res = await getBankPairsForCurationAction({ testSetId, membership: 'member', limit: 1 });
      if (res.success && res.data) {
        setSelected(new Set((res.data as CurationResult).filteredLabels));
      }
      setSeeded(true);
    })();
  }, [testSetId]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getBankPairsForCurationAction({
      testSetId,
      kind,
      membership,
      gapKind,
      search: search.trim() || undefined,
      eloMin: num(eloMin),
      eloMax: num(eloMax),
      limit: PAGE,
      offset,
    });
    setLoading(false);
    if (!res.success) {
      toast.error(res.error?.message ?? 'Failed to load pairs');
      return;
    }
    setResult(res.data as CurationResult);
  }, [testSetId, kind, membership, gapKind, search, eloMin, eloMax, offset]);

  useEffect(() => {
    void load();
  }, [load]);
  // Reset to page 1 whenever a filter changes.
  useEffect(() => {
    setOffset(0);
  }, [kind, membership, gapKind, search, eloMin, eloMax]);

  const toggleLabel = (label: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const selectAllFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const l of result?.filteredLabels ?? []) next.add(l);
      return next;
    });
  const clearFiltered = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const l of result?.filteredLabels ?? []) next.delete(l);
      return next;
    });

  const toggleTexts = useCallback(
    async (label: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        return next;
      });
      if (!texts[label]) {
        const res = await getTestSetPairTextsAction({ testSetId, pairLabel: label });
        if (res.success && res.data) {
          setTexts((prev) => ({ ...prev, [label]: res.data as { text_a: string; text_b: string } }));
        }
      }
    },
    [testSetId, texts],
  );

  const submit = async () => {
    if (!newName.trim()) {
      toast.error('Enter a name for the clone');
      return;
    }
    if (selected.size === 0) {
      toast.error('Select at least one pair');
      return;
    }
    setBusy(true);
    const res = await cloneTestSetAction({
      sourceTestSetId: testSetId,
      newName,
      strategy: 'manual',
      manualLabels: [...selected],
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error?.message ?? 'Clone failed');
      return;
    }
    toast.success(`Cloned ${selected.size} pair(s) → "${newName}"`);
    onCloned();
  };

  const total = result?.total ?? 0;
  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div className="rounded-book paper-texture card-enhanced p-4 space-y-3" data-testid="clone-curate">
      <div className="text-sm font-semibold font-ui">Clone &amp; curate from {sourceName}</div>
      <p className="text-xs text-[var(--text-muted)]">
        Pick which existing pairs become members of a NEW frozen set (the source + its runs are
        untouched). Current members are pre-checked; uncheck to remove, check to add. The Elo filter
        requires BOTH sides of a pair to fall within the bounds.
      </p>

      <div className="flex flex-wrap gap-3 items-center text-xs font-ui">
        <label>
          New name{' '}
          <input data-testid="curate-name" className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <span className="ml-auto" data-testid="curate-selected">Selected: {selected.size}</span>
      </div>

      <div className="flex flex-wrap gap-3 items-center text-xs font-ui">
        <span>Kind:</span>
        <select data-testid="curate-kind" className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-1 py-1"
          value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          <option value="both">both</option><option value="article">article</option><option value="paragraph">paragraph</option>
        </select>
        <span>Show:</span>
        <select data-testid="curate-membership" className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-1 py-1"
          value={membership} onChange={(e) => setMembership(e.target.value as Membership)}>
          <option value="all">all</option><option value="member">members</option><option value="non_member">non-members</option>
        </select>
        <span>Gap:</span>
        <select data-testid="curate-gap" className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-1 py-1"
          value={gapKind} onChange={(e) => setGapKind(e.target.value as GapKind)}>
          <option value="all">any</option><option value="large">large</option><option value="close">close</option>
        </select>
        <span>Elo both sides:</span>
        <input data-testid="curate-elo-min" type="number" placeholder="min" className="w-20 bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
          value={eloMin} onChange={(e) => setEloMin(e.target.value)} />
        <input data-testid="curate-elo-max" type="number" placeholder="max" className="w-20 bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
          value={eloMax} onChange={(e) => setEloMax(e.target.value)} />
        <input data-testid="curate-search" placeholder="label search" className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="flex gap-2 items-center text-xs">
        <button data-testid="curate-select-all" className="underline" onClick={selectAllFiltered}>Select all (filtered: {total})</button>
        <button data-testid="curate-clear" className="underline" onClick={clearFiltered}>Clear filtered</button>
      </div>

      <table className="w-full text-xs" data-testid="curate-table">
        <thead>
          <tr className="text-left text-[var(--text-muted)]">
            <th className="py-1 w-6"></th><th>Pair</th><th>Kind</th><th>Elo A</th><th>Elo B</th><th>Gap</th><th>Member</th><th>Texts</th>
          </tr>
        </thead>
        <tbody>
          {(loading || !seeded) && <tr><td colSpan={8} className="py-3 text-[var(--text-muted)]">Loading…</td></tr>}
          {!loading && seeded && (result?.pairs.length ?? 0) === 0 && (
            <tr><td colSpan={8} className="py-3 text-[var(--text-muted)]">No pairs match the filters.</td></tr>
          )}
          {!loading && seeded && result?.pairs.map((p) => (
            <Fragment key={p.label}>
              <tr data-testid="curate-row" className="border-t border-[var(--border-default)]">
                <td>
                  <input type="checkbox" data-testid={`curate-check-${p.label}`}
                    checked={selected.has(p.label)} onChange={() => toggleLabel(p.label)} />
                </td>
                <td className="font-mono">{p.label}</td>
                <td>{p.pair_kind}</td>
                <td>{elo(p.elo_a, p.uncertainty_a)}</td>
                <td>{elo(p.elo_b, p.uncertainty_b)}</td>
                <td>{p.elo_gap ?? '—'}</td>
                <td>{p.isMember ? '✓' : ''}</td>
                <td><button className="underline text-[var(--accent-gold)]" onClick={() => void toggleTexts(p.label)}>{expanded.has(p.label) ? 'hide' : 'view'}</button></td>
              </tr>
              {expanded.has(p.label) && (
                <tr className="bg-[var(--bg-secondary)]">
                  <td colSpan={8} className="p-2">
                    {texts[p.label] ? (
                      <div className="grid grid-cols-2 gap-3">
                        <div><div className="font-semibold mb-1">Text A</div><pre className="whitespace-pre-wrap break-words font-mono text-xs">{texts[p.label]!.text_a}</pre></div>
                        <div><div className="font-semibold mb-1">Text B</div><pre className="whitespace-pre-wrap break-words font-mono text-xs">{texts[p.label]!.text_b}</pre></div>
                      </div>
                    ) : <span className="text-[var(--text-muted)]">Loading texts…</span>}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      <div className="flex items-center gap-2 text-xs">
        <button className="underline disabled:opacity-40" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>‹ Prev</button>
        <span>page {page} / {pages}</span>
        <button className="underline disabled:opacity-40" disabled={page >= pages} onClick={() => setOffset(offset + PAGE)}>Next ›</button>
        <button data-testid="curate-clone" disabled={busy} className="ml-auto text-xs px-3 py-1.5 rounded disabled:opacity-50"
          style={{ background: 'var(--accent-gold)', color: 'var(--bg-primary)' }} onClick={() => void submit()}>
          {busy ? 'Cloning…' : `Clone with ${selected.size} pairs`}
        </button>
      </div>
    </div>
  );
}
