// Judge Lab — Match history for one eval run. Lists every persisted (pair × repeat) call (light
// Core rows, paginated) and lazily loads the heavy AUDIT payload on expand: both input content
// pieces, the winner, and the FULL judge input (incl. custom rubric) + output + reasoning for each
// pass. All model/user text is rendered as plain text (never dangerouslySetInnerHTML).
'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import {
  getJudgeEvalCallsAction,
  getJudgeEvalCallDetailAction,
  findArenaComparisonForVariantsAction,
} from '@evolution/services/judgeEvalActions';
import type { JudgeEvalCallCore, JudgeEvalCallAudit } from '@evolution/lib/judgeEval/schemas';

const PAGE_SIZE = 25;

function pct(v: number | null): string {
  return v == null ? '—' : `${(v * 100).toFixed(0)}%`;
}
function num(v: number | null, digits = 1): string {
  return v == null ? '—' : v.toFixed(digits);
}

/** Best-effort split of a rendered comparison prompt into its two content pieces (## Text A / ## Text B).
 *  Returns null if the prompt doesn't match the expected shape — the caller then shows the full prompt only. */
function extractTexts(prompt: string | null): { textA: string; textB: string } | null {
  if (!prompt) return null;
  const m = prompt.match(/## Text A\s*\n([\s\S]*?)\n## Text B\s*\n([\s\S]*?)(?:\n##|\nYour answer|\n[^\n]*your answer|$)/i);
  if (!m) return null;
  return { textA: m[1]!.trim(), textB: m[2]!.trim() };
}

/** A collapsible block of plain (auto-escaped) text — used for prompts/reasoning/raw output. */
function TextBlock({ label, value, testid, open = false }: { label: string; value: string | null; testid?: string; open?: boolean }): JSX.Element {
  return (
    <details open={open} className="mt-2">
      <summary className="cursor-pointer text-xs font-ui text-[var(--text-muted)]">{label}</summary>
      <pre data-testid={testid} className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] p-2 text-xs font-mono">
        {value && value.length > 0 ? value : '—'}
      </pre>
    </details>
  );
}

function reasoningStateLabel(fmt: JudgeEvalCallAudit['reasoning_trace_format'], hasText: boolean): string {
  if (fmt == null) return 'reasoning not requested';
  if (fmt === 'unavailable') return 'thinking happened but the provider dropped the trace';
  return hasText ? `${fmt} reasoning` : `${fmt} (empty)`;
}

function AuditDetail({ audit }: { audit: JudgeEvalCallAudit }): JSX.Element {
  const texts = extractTexts(audit.forward_prompt);
  const hasFwd = !!(audit.forward_reasoning && audit.forward_reasoning.length > 0);
  const hasRev = !!(audit.reverse_reasoning && audit.reverse_reasoning.length > 0);
  return (
    <div data-testid="match-audit-detail" className="space-y-3 border-l-2 border-[var(--border-default)] pl-3">
      {texts && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div className="text-xs font-ui font-semibold">Content A</div>
            <pre data-testid="match-text-a" className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] p-2 text-xs">{texts.textA || '—'}</pre>
          </div>
          <div>
            <div className="text-xs font-ui font-semibold">Content B</div>
            <pre data-testid="match-text-b" className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] p-2 text-xs">{texts.textB || '—'}</pre>
          </div>
        </div>
      )}

      <div data-testid="reasoning-format-state" className="text-xs text-[var(--text-muted)]">
        Reasoning trace: <span className="font-mono">{reasoningStateLabel(audit.reasoning_trace_format, hasFwd || hasRev)}</span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs font-ui font-semibold uppercase tracking-wide">Forward pass</div>
          <TextBlock label="Judge input (prompt)" value={audit.forward_prompt} testid="judge-input-forward" />
          <TextBlock label="Reasoning" value={audit.forward_reasoning} testid="judge-reasoning" open={hasFwd} />
          <TextBlock label="Raw output" value={audit.forward_raw} testid="judge-output-forward" />
        </div>
        <div>
          <div className="text-xs font-ui font-semibold uppercase tracking-wide">Reverse pass</div>
          <TextBlock label="Judge input (prompt)" value={audit.reverse_prompt} testid="judge-input-reverse" />
          <TextBlock label="Reasoning" value={audit.reverse_reasoning} open={hasRev} />
          <TextBlock label="Raw output" value={audit.reverse_raw} testid="judge-output-reverse" />
        </div>
      </div>
    </div>
  );
}

export default function MatchHistoryPage(): JSX.Element {
  const params = useParams<{ evalRunId: string }>();
  const runId = params.evalRunId;
  const [calls, setCalls] = useState<JudgeEvalCallCore[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [auditById, setAuditById] = useState<Record<string, JudgeEvalCallAudit | 'loading'>>({});
  const [resolvingMv, setResolvingMv] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Judge Lab · Match history';
  }, []);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    const res = await getJudgeEvalCallsAction({ runId, limit: PAGE_SIZE, offset });
    if (res.success && res.data) {
      setCalls(res.data.calls);
      setTotal(res.data.total);
    } else if (!res.success) {
      toast.error(res.error?.message ?? 'Failed to load matches');
    }
    setLoading(false);
  }, [runId, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (callId: string) => {
      if (expanded === callId) {
        setExpanded(null);
        return;
      }
      setExpanded(callId);
      if (auditById[callId] === undefined) {
        setAuditById((m) => ({ ...m, [callId]: 'loading' }));
        const res = await getJudgeEvalCallDetailAction({ callId });
        if (res.success && res.data) {
          setAuditById((m) => ({ ...m, [callId]: res.data as JudgeEvalCallAudit }));
        } else {
          setAuditById((m) => {
            const next = { ...m };
            delete next[callId];
            return next;
          });
          if (!res.success) toast.error(res.error?.message ?? 'Failed to load match detail');
        }
      }
    },
    [expanded, auditById],
  );

  // Judge-eval pairs are seeded from arena comparisons, so the snapshotted variant pair usually maps
  // to a recorded comparison. Resolve it on click and open the Match Viewer in a new tab (so the
  // match-history list stays put); toast if no comparison is found or variant ids are missing (legacy).
  const openInMatchViewer = useCallback(async (c: JudgeEvalCallCore) => {
    if (!c.variant_a_id || !c.variant_b_id) {
      toast.error('No variant ids recorded on this match (pre-migration row).');
      return;
    }
    setResolvingMv(c.id);
    const res = await findArenaComparisonForVariantsAction({ variantA: c.variant_a_id, variantB: c.variant_b_id });
    setResolvingMv(null);
    if (res.success && res.data?.comparisonId) {
      window.open(`/admin/evolution/matches/${res.data.comparisonId}`, '_blank', 'noopener');
    } else if (res.success) {
      toast.error('No recorded arena match for this variant pair.');
    } else {
      toast.error(res.error?.message ?? 'Failed to resolve match');
    }
  }, []);

  return (
    <div className="space-y-6">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Lab', href: '/admin/evolution/judge-lab' },
          { label: `Run ${runId?.substring(0, 8) ?? ''}`, href: `/admin/evolution/judge-lab/runs/${runId}` },
          { label: 'Matches' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold font-ui" role="heading" aria-level={1}>Match history</div>
        <Link className="text-xs underline" href={`/admin/evolution/judge-lab/runs/${runId}`}>← Run aggregates</Link>
      </div>

      <div className="rounded-book paper-texture card-enhanced p-4">
        <table className="w-full text-xs" data-testid="matches-table">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1">Pair</th><th>Kind</th><th>Rep</th><th>Winner</th>
              <th>Conf</th><th>Decisive</th><th>Gap</th><th>Baseline</th><th></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="py-3 text-[var(--text-muted)]">Loading…</td></tr>}
            {!loading && calls.length === 0 && (
              <tr><td colSpan={9} className="py-3 text-[var(--text-muted)]">No matches for this run.</td></tr>
            )}
            {calls.map((c) => {
              const isOpen = expanded === c.id;
              const audit = auditById[c.id];
              return (
                <Fragment key={c.id}>
                  <tr data-testid="match-row" className="border-t border-[var(--border-default)]">
                    <td className="py-1 font-mono">{c.pair_label}</td>
                    <td>{c.pair_kind}</td>
                    <td>{c.repeat_index}</td>
                    <td className="font-mono">{c.winner}</td>
                    <td>{num(c.confidence)}</td>
                    <td>{c.decisive ? 'yes' : 'no'}</td>
                    <td>{c.gap_kind ?? '—'}</td>
                    <td>{pct(c.baseline_confidence)}</td>
                    <td className="whitespace-nowrap">
                      <button
                        type="button"
                        data-testid="match-expand"
                        className="underline text-[var(--accent-gold)]"
                        onClick={() => void toggle(c.id)}
                      >
                        {isOpen ? 'Hide' : 'View I/O'}
                      </button>
                      {c.variant_a_id && c.variant_b_id && (
                        <button
                          type="button"
                          data-testid="open-match-viewer"
                          className="ml-3 underline text-[var(--accent-gold)] disabled:opacity-50"
                          onClick={() => void openInMatchViewer(c)}
                          disabled={resolvingMv === c.id}
                          title="Open this variant pair in the Match Viewer (new tab)"
                        >
                          {resolvingMv === c.id ? 'Opening…' : 'Open in Match Viewer'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={9} className="pb-3">
                        {c.error && <div className="mb-2 text-xs text-[var(--accent-error,#c0392b)]">Errored call: <span className="font-mono">{c.error}</span></div>}
                        {audit === 'loading' || audit === undefined ? (
                          <div className="text-xs text-[var(--text-muted)]">Loading match I/O…</div>
                        ) : (
                          <AuditDetail audit={audit} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>

        <div className="mt-3 flex items-center gap-3 text-xs">
          <button
            type="button"
            className="underline disabled:opacity-40 disabled:no-underline"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            ← Prev
          </button>
          <span data-testid="matches-range" className="text-[var(--text-muted)]">
            {total === 0 ? '0' : `${offset + 1}–${Math.min(offset + PAGE_SIZE, total)}`} of {total}
          </span>
          <button
            type="button"
            className="underline disabled:opacity-40 disabled:no-underline"
            disabled={offset + PAGE_SIZE >= total || loading}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next →
          </button>
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        Inputs/outputs are the exact text sent to and returned by the judge for each pass (forward = A·B, reverse = B·A).
      </p>
    </div>
  );
}
