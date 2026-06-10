// Judge Lab — Test Sets manager (Screen 4). List frozen test sets and create new ones from a
// pair-bank (per-kind size + strategy + seed). "Size" is how many pairs enter a judging round;
// membership freezes at creation so consecutive runs compare on identical pairs.
'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import {
  listTestSetsAction,
  listPairBanksAction,
  createTestSetAction,
} from '@evolution/services/judgeEvalActions';
import { TEST_SET_STRATEGIES } from '@evolution/lib/judgeEval/schemas';

interface TestSetRow {
  id: string;
  name: string;
  strategy: string;
  seed: number;
  size_article: number;
  size_paragraph: number;
  created_at: string;
}
interface BankRow {
  id: string;
  name: string;
}

export default function TestSetsPage(): JSX.Element {
  useEffect(() => {
    document.title = 'Judge Lab · Test Sets';
  }, []);
  const [rows, setRows] = useState<TestSetRow[]>([]);
  const [banks, setBanks] = useState<BankRow[]>([]);
  const [form, setForm] = useState({
    bankName: '',
    name: '',
    strategy: 'stratified_confidence',
    seed: 1,
    sizeArticle: 50,
    sizeParagraph: 50,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [ts, bk] = await Promise.all([listTestSetsAction(), listPairBanksAction()]);
    if (ts.success && ts.data) setRows(ts.data as TestSetRow[]);
    if (bk.success && bk.data) {
      setBanks(bk.data as BankRow[]);
      if (bk.data.length > 0 && !form.bankName) {
        setForm((f) => ({ ...f, bankName: (bk.data as BankRow[])[0]!.name }));
      }
    }
  }, [form.bankName]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!form.bankName || !form.name) {
      toast.error('Pick a bank and enter a name');
      return;
    }
    setBusy(true);
    const res = await createTestSetAction({
      bankName: form.bankName,
      name: form.name,
      strategy: form.strategy as (typeof TEST_SET_STRATEGIES)[number],
      seed: form.seed,
      sizeArticle: form.sizeArticle,
      sizeParagraph: form.sizeParagraph,
    });
    setBusy(false);
    if (!res.success) {
      toast.error(res.error?.message ?? 'Create failed');
      return;
    }
    toast.success(res.data!.created ? `Created "${form.name}"` : `"${form.name}" already exists (frozen)`);
    void load();
  };

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Lab', href: '/admin/evolution/judge-lab' },
          { label: 'Test Sets' },
        ]}
      />
      <p className="text-sm text-[var(--text-muted)] font-ui">
        Frozen subsets of a pair-bank — runs against the same set are directly comparable. Size =
        how many pairs enter each judging round. Membership freezes at creation.
      </p>

      <div className="rounded-book paper-texture card-enhanced p-4 space-y-3" data-testid="test-set-create">
        <div className="text-sm font-semibold font-ui" role="heading" aria-level={2}>New test set</div>
        <div className="flex gap-2 flex-wrap items-center text-xs">
          <label>Bank</label>
          <select
            data-testid="ts-bank"
            className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={form.bankName}
            onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
          >
            {banks.length === 0 && <option value="">No banks — seed one first</option>}
            {banks.map((b) => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
          </select>
          <label>Name</label>
          <input
            data-testid="ts-name"
            className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="fr2-standard"
          />
          <label>Article</label>
          <input type="number" min={0} className="w-16 bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={form.sizeArticle} onChange={(e) => setForm((f) => ({ ...f, sizeArticle: Number(e.target.value) || 0 }))} />
          <label>Paragraph</label>
          <input type="number" min={0} className="w-16 bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={form.sizeParagraph} onChange={(e) => setForm((f) => ({ ...f, sizeParagraph: Number(e.target.value) || 0 }))} />
          <label>Strategy</label>
          <select className="bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={form.strategy} onChange={(e) => setForm((f) => ({ ...f, strategy: e.target.value }))}>
            {TEST_SET_STRATEGIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label>Seed</label>
          <input type="number" className="w-16 bg-[var(--bg-secondary)] border border-[var(--border-default)] rounded px-2 py-1"
            value={form.seed} onChange={(e) => setForm((f) => ({ ...f, seed: Number(e.target.value) || 0 }))} />
          <button data-testid="ts-create" disabled={busy}
            className="text-xs px-3 py-1.5 rounded disabled:opacity-50" style={{ background: 'var(--accent-gold)', color: 'var(--bg-primary)' }}
            onClick={() => void create()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>

      <div className="rounded-book paper-texture card-enhanced p-4">
        <table className="w-full text-xs" data-testid="test-sets-table">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1">Name</th><th>Article</th><th>Paragraph</th><th>Strategy</th><th>Seed</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="py-3 text-[var(--text-muted)]">No test sets yet.</td></tr>}
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-[var(--border-default)]" data-testid="test-set-row">
                <td className="py-1">{t.name}</td>
                <td>{t.size_article}</td>
                <td>{t.size_paragraph}</td>
                <td>{t.strategy}</td>
                <td>{t.seed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
