// Judge Lab — Pair-banks manager (Screen 3). List pair-banks and seed a new one from an arena
// topic (pulls ALL article + paragraph comparison pairs, snapshotting texts + mu/sigma +
// baseline confidence). For very large topics the CLI (`judge-eval.ts seed`) is more robust.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import { listPairBanksAction, seedPairBankAction } from '@evolution/services/judgeEvalActions';
import { formatDate } from '@evolution/lib/utils/formatters';

const FEDERAL_RESERVE_2 = 'a546b7e9-f066-403d-9589-f5e0d2c9fa4f';

interface BankRow {
  id: string;
  name: string;
  source_topic_id: string | null;
  created_at: string;
}

export default function PairBanksPage(): JSX.Element {
  useEffect(() => {
    document.title = 'Judge Lab · Match Banks';
  }, []);
  const [rows, setRows] = useState<BankRow[]>([]);
  const [topicId, setTopicId] = useState(FEDERAL_RESERVE_2);
  const [bankName, setBankName] = useState('Federal Reserve 2');
  const [includeArticles, setIncludeArticles] = useState(true);
  const [includeParagraphs, setIncludeParagraphs] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await listPairBanksAction();
    if (res.success && res.data) setRows(res.data as BankRow[]);
    else if (!res.success) toast.error(res.error?.message ?? 'Failed to load match banks');
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const seed = async () => {
    if (!topicId || !bankName) {
      toast.error('Enter a topic id and match bank name');
      return;
    }
    setBusy(true);
    const res = await seedPairBankAction({ topicId, bankName, includeArticles, includeParagraphs });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error?.message ?? 'Seed failed (large topics: use the CLI)');
      return;
    }
    const r = res.data!;
    toast.success(`Seeded "${bankName}": ${r.articlePairs} article + ${r.paragraphPairs} paragraph (${r.skipped} skipped)`);
    void load();
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Lab', href: '/admin/evolution/judge-lab' },
          { label: 'Match Banks' },
        ]}
      />
      <p className="text-sm text-[var(--text-muted)] font-ui">
        A match bank is the full set of matches pulled from an arena topic. Carve frozen
        Test Sets from it for repeatable, comparable sweeps. Large topics may exceed the server
        time limit — use <code>judge-eval.ts seed</code> for those.
      </p>

      <div className="rounded-book paper-texture card-enhanced p-4 space-y-3" data-testid="seed-form">
        <div className="text-sm font-semibold font-ui" role="heading" aria-level={2}>Seed from arena topic</div>
        <div className="flex gap-2 flex-wrap items-center text-xs">
          <label>Topic id</label>
          <input className="w-80 font-mono bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={topicId} onChange={(e) => setTopicId(e.target.value)} data-testid="seed-topic" />
          <label>Match bank name</label>
          <input className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={bankName} onChange={(e) => setBankName(e.target.value)} data-testid="seed-bank-name" />
          <label className="flex items-center gap-1"><input type="checkbox" checked={includeArticles} onChange={(e) => setIncludeArticles(e.target.checked)} />articles</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={includeParagraphs} onChange={(e) => setIncludeParagraphs(e.target.checked)} />paragraphs</label>
          <button data-testid="seed-run" disabled={busy}
            className="text-xs px-3 py-1.5 rounded disabled:opacity-50" style={{ background: 'var(--accent-gold)', color: 'var(--text-on-primary)' }}
            onClick={() => void seed()}>
            {busy ? 'Seeding…' : 'Seed'}
          </button>
        </div>
      </div>

      <div className="rounded-book paper-texture card-enhanced p-4">
        <table className="w-full text-xs" data-testid="pair-banks-table">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1">Name</th><th>Source topic</th><th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={3} className="py-3 text-[var(--text-muted)]">No match banks yet — seed one above.</td></tr>}
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-[var(--border-default)]" data-testid="pair-bank-row">
                <td className="py-1">{b.name}</td>
                <td className="font-mono" title={b.source_topic_id ?? ''}>{b.source_topic_id ? b.source_topic_id.substring(0, 8) : '—'}</td>
                <td>{formatDate(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
