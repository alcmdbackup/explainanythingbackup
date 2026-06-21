// Judge Lab → Agreement → Match history. Lists every persisted (pair × repeat) agreement call (light
// Core rows, paginated) and lazily loads the 4 raws (holistic forward + reverse, rubric forward +
// reverse) PLUS the per-criterion verdicts for that one call on row expand. Mirrors the regular-sweep
// runs/[evalRunId]/matches page but for the agreement-side data model.
//
// `?disagree=1` query param filters to both-decisive opposite-winner calls (the meaningful conflict).
//
// RENDER CONTRACT: every raw / reasoning / prompt is rendered as plain text only via the shared
// TextBlock primitive (auto-escaping <pre>). NO dangerouslySetInnerHTML.

'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { EvolutionBreadcrumb } from '@evolution/components/evolution';
import {
  TextBlock,
  extractTexts,
} from '@evolution/components/evolution/matches/sharedAuditPrimitives';
import {
  getAgreementCallsAction,
  getAgreementCallDetailAction,
  findArenaComparisonForVariantsAction,
} from '@evolution/services/judgeEvalActions';

const PAGE_SIZE = 25;

interface AgreementCallCoreRow {
  id: string;
  pair_label: string;
  pair_kind: 'article' | 'paragraph';
  repeat_index: number;
  holistic_winner: 'A' | 'B' | 'TIE';
  holistic_confidence: number;
  holistic_decisive: boolean;
  rubric_winner: 'A' | 'B' | 'TIE';
  rubric_confidence: number;
  rubric_decisive: boolean;
  rubric_matches_holistic: boolean | null;
  cost_usd: number | null;
  wall_ms: number | null;
  error: string | null;
  gap_kind: 'large' | 'close' | null;
  expected_winner: 'A' | 'B' | null;
  variant_a_id: string | null;
  variant_b_id: string | null;
}

interface AgreementAuditPayload {
  audit: {
    id: string;
    holistic_forward_raw: string | null;
    holistic_reverse_raw: string | null;
    rubric_forward_raw: string | null;
    rubric_reverse_raw: string | null;
  };
  criterionVerdicts: Array<{
    id: string;
    criteria_name: string;
    weight: number;
    forward_verdict: string | null;
    reverse_verdict: string | null;
    dimension_winner: string | null;
    agrees_with_holistic: boolean | null;
    matches_ground_truth: boolean | null;
    position: number;
  }>;
}

function num(v: number | null, digits = 1): string {
  return v == null ? '—' : v.toFixed(digits);
}

function AgreementAuditDetail({ payload }: { payload: AgreementAuditPayload }): JSX.Element {
  const texts = extractTexts(payload.audit.holistic_forward_raw); // best-effort; rubric forward also has them
  return (
    <div
      data-testid="agreement-audit-detail"
      className="space-y-3 border-l-2 border-[var(--border-default)] pl-3"
    >
      {texts && (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div>
            <div className="text-xs font-ui font-semibold">Content A</div>
            <pre
              data-testid="agreement-match-text-a"
              className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] p-2 text-xs"
            >
              {texts.textA || '—'}
            </pre>
          </div>
          <div>
            <div className="text-xs font-ui font-semibold">Content B</div>
            <pre
              data-testid="agreement-match-text-b"
              className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--bg-secondary)] p-2 text-xs"
            >
              {texts.textB || '—'}
            </pre>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs font-ui font-semibold uppercase tracking-wide">Holistic forward pass</div>
          <TextBlock label="Raw output" value={payload.audit.holistic_forward_raw} testid="holistic-forward-raw" />
        </div>
        <div>
          <div className="text-xs font-ui font-semibold uppercase tracking-wide">Holistic reverse pass</div>
          <TextBlock label="Raw output" value={payload.audit.holistic_reverse_raw} testid="holistic-reverse-raw" />
        </div>
        <div>
          <div className="text-xs font-ui font-semibold uppercase tracking-wide">Rubric forward pass</div>
          <TextBlock label="Raw output" value={payload.audit.rubric_forward_raw} testid="rubric-forward-raw" />
        </div>
        <div>
          <div className="text-xs font-ui font-semibold uppercase tracking-wide">Rubric reverse pass</div>
          <TextBlock label="Raw output" value={payload.audit.rubric_reverse_raw} testid="rubric-reverse-raw" />
        </div>
      </div>

      <div>
        <div className="text-xs font-ui font-semibold uppercase tracking-wide mb-1">Per-criterion verdicts</div>
        <table className="w-full text-xs font-ui" data-testid="agreement-criterion-detail">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1">Criterion</th>
              <th>Weight</th>
              <th>Forward</th>
              <th>Reverse</th>
              <th>Winner</th>
              <th>Agrees holistic?</th>
              <th>Matches GT?</th>
            </tr>
          </thead>
          <tbody>
            {payload.criterionVerdicts.length === 0 && (
              <tr>
                <td colSpan={7} className="py-2 text-[var(--text-muted)]">
                  No per-criterion verdicts recorded for this call.
                </td>
              </tr>
            )}
            {payload.criterionVerdicts.map((c) => (
              <tr key={c.id} data-testid="agreement-criterion-row">
                <td className="py-1">{c.criteria_name}</td>
                <td>{c.weight.toFixed(2)}</td>
                <td>{c.forward_verdict ?? '—'}</td>
                <td>{c.reverse_verdict ?? '—'}</td>
                <td>{c.dimension_winner ?? '—'}</td>
                <td>{c.agrees_with_holistic === null ? '—' : c.agrees_with_holistic ? 'yes' : 'no'}</td>
                <td>{c.matches_ground_truth === null ? '—' : c.matches_ground_truth ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AgreementMatchHistoryPage(): JSX.Element {
  const params = useParams<{ agreementRunId: string }>();
  const runId = params.agreementRunId;
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const disagreeOnly = searchParams.get('disagree') === '1';

  const [calls, setCalls] = useState<AgreementCallCoreRow[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [auditById, setAuditById] = useState<Record<string, AgreementAuditPayload | 'loading'>>({});
  const [resolvingMv, setResolvingMv] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Judge Lab · Agreement matches';
  }, []);

  const load = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    const res = await getAgreementCallsAction({
      runId,
      limit: PAGE_SIZE,
      offset,
      disagreeOnly,
    });
    if (res.success && res.data) {
      setCalls(res.data.calls as unknown as AgreementCallCoreRow[]);
      setTotal(res.data.total);
    } else if (!res.success) {
      toast.error(res.error?.message ?? 'Failed to load matches');
    }
    setLoading(false);
  }, [runId, offset, disagreeOnly]);

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
        const res = await getAgreementCallDetailAction({ callId });
        if (res.success && res.data) {
          setAuditById((m) => ({ ...m, [callId]: res.data as unknown as AgreementAuditPayload }));
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

  const openInMatchViewer = useCallback(async (c: AgreementCallCoreRow) => {
    if (!c.variant_a_id || !c.variant_b_id) {
      toast.error('No variant ids recorded on this match (pre-migration row).');
      return;
    }
    setResolvingMv(c.id);
    const res = await findArenaComparisonForVariantsAction({
      variantA: c.variant_a_id,
      variantB: c.variant_b_id,
    });
    setResolvingMv(null);
    if (res.success && res.data?.comparisonId) {
      window.open(`/admin/evolution/matches/${res.data.comparisonId}`, '_blank', 'noopener');
    } else if (res.success) {
      toast.error('No recorded arena match for this variant pair.');
    } else {
      toast.error(res.error?.message ?? 'Failed to resolve match');
    }
  }, []);

  const toggleDisagreeFilter = useCallback(() => {
    const next = !disagreeOnly;
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set('disagree', '1');
    else params.delete('disagree');
    router.push(`${pathname}?${params.toString()}`);
    setOffset(0);
  }, [disagreeOnly, searchParams, router, pathname]);

  return (
    <div className="space-y-6 p-4">
      <EvolutionBreadcrumb
        items={[
          { label: 'Evolution', href: '/admin/evolution-dashboard' },
          { label: 'Judge Lab', href: '/admin/evolution/judge-lab' },
          { label: 'Agreement', href: '/admin/evolution/judge-lab/agreement' },
          { label: `Run ${runId?.substring(0, 8) ?? ''}`, href: `/admin/evolution/judge-lab/agreement/runs/${runId}` },
          { label: 'Matches' },
        ]}
      />

      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold font-ui" role="heading" aria-level={1}>
          Match history
        </div>
        <Link
          className="text-xs underline"
          href={`/admin/evolution/judge-lab/agreement/runs/${runId}`}
        >
          ← Run aggregates
        </Link>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-1">
          <input
            type="checkbox"
            data-testid="agreement-disagree-only"
            checked={disagreeOnly}
            onChange={toggleDisagreeFilter}
          />
          Show only both-decisive disagreements
        </label>
      </div>

      <div className="rounded-book paper-texture card-enhanced p-4">
        <table className="w-full text-xs" data-testid="agreement-matches-table">
          <thead>
            <tr className="text-left text-[var(--text-muted)]">
              <th className="py-1">Pair</th>
              <th>Kind</th>
              <th>Rep</th>
              <th>Holistic</th>
              <th>Rubric</th>
              <th>Agree?</th>
              <th>Gap</th>
              <th>GT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={9} className="py-3 text-[var(--text-muted)]">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && calls.length === 0 && (
              <tr>
                <td colSpan={9} className="py-3 text-[var(--text-muted)]">
                  No matches for this run.
                </td>
              </tr>
            )}
            {calls.map((c) => {
              const isOpen = expanded === c.id;
              const audit = auditById[c.id];
              return (
                <Fragment key={c.id}>
                  <tr data-testid="agreement-match-row" className="border-t border-[var(--border-default)]">
                    <td className="py-1 font-mono">{c.pair_label}</td>
                    <td>{c.pair_kind}</td>
                    <td>{c.repeat_index}</td>
                    <td className="font-mono">
                      {c.holistic_winner} ({num(c.holistic_confidence)})
                    </td>
                    <td className="font-mono">
                      {c.rubric_winner} ({num(c.rubric_confidence)})
                    </td>
                    <td>
                      {c.rubric_matches_holistic === null
                        ? '—'
                        : c.rubric_matches_holistic
                          ? 'yes'
                          : 'no'}
                    </td>
                    <td>{c.gap_kind ?? '—'}</td>
                    <td>{c.gap_kind === 'large' ? c.expected_winner ?? '—' : '—'}</td>
                    <td className="whitespace-nowrap">
                      <button
                        type="button"
                        data-testid="agreement-match-expand"
                        className="underline text-[var(--accent-gold)]"
                        onClick={() => void toggle(c.id)}
                      >
                        {isOpen ? 'Hide' : 'View I/O'}
                      </button>
                      {c.variant_a_id && c.variant_b_id && (
                        <button
                          type="button"
                          data-testid="agreement-open-match-viewer"
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
                        {c.error && (
                          <div className="mb-2 text-xs text-[var(--accent-error,#c0392b)]">
                            Errored call: <span className="font-mono">{c.error}</span>
                          </div>
                        )}
                        {audit === 'loading' || audit === undefined ? (
                          <div className="text-xs text-[var(--text-muted)]">Loading match I/O…</div>
                        ) : (
                          <AgreementAuditDetail payload={audit} />
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
          <span data-testid="agreement-matches-range" className="text-[var(--text-muted)]">
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
        Holistic + rubric judges each ran a 2-pass A/B reversal (forward = A·B, reverse = B·A). The raws
        above are the LLM&apos;s exact output per pass; per-criterion verdicts are parsed from the rubric
        raws via the same logic as the live pipeline.
      </p>
    </div>
  );
}
