// Shared test helpers for handling the live minicomputer race against `claim_evolution_run`.
// The minicomputer polls staging every 60s with the same RPC integration tests use; the RPC's
// `LIMIT 1 FOR UPDATE SKIP LOCKED` makes the two callers mutually exclusive on a row's lock, so
// exactly one of them wins. Tests that asserted "OUR call claimed our run" failed ~50% of the
// time when the minicomputer won (see PR #1281 + `evolution-claim-gate.integration.test.ts`).
//
// The helpers below verify the gate's CONTRACT (the run becomes claimable, by ANY claimer) —
// not the irrelevant detail of which process did the claiming.

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Race-safe assertion that `claim_evolution_run` ALLOWED the run to be claimed.
 *
 * Outcomes:
 *  - Our `callClaim` returned the run → we won the race, gate verified directly.
 *  - Our `callClaim` returned a different/empty set → another claimer (likely the
 *    minicomputer) won the race. Briefly poll `evolution_runs.status`; if it transitions
 *    to `'claimed'` within ~2s the gate verified (the in-flight UPDATE finished after
 *    our SELECT but before our next read).
 *  - Status still `'pending'` after the poll window → genuine gate bug; throws.
 *
 * Use this anywhere an integration test asserts the queue claim should succeed for a
 * specific pending run. Two examples:
 *
 * ```ts
 * import { assertClaimAllowed } from '@evolution/testing/minicomputerRaceSafety';
 *
 * const claimed = await callClaim(sb);
 * await assertClaimAllowed(sb, claimed, runId);
 * ```
 */
export async function assertClaimAllowed(
  sb: SupabaseClient,
  claimedByUs: Array<{ id: string }>,
  runId: string,
  opts: { pollMs?: number; maxPolls?: number } = {},
): Promise<void> {
  if (claimedByUs.find((r) => r.id === runId)) return;
  const pollMs = opts.pollMs ?? 400;
  const maxPolls = opts.maxPolls ?? 5;
  for (let i = 0; i < maxPolls; i++) {
    const { data: run } = await sb
      .from('evolution_runs')
      .select('status')
      .eq('id', runId)
      .single();
    if ((run as { status?: string } | null)?.status === 'claimed') return;
    if (i < maxPolls - 1) await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(
    `assertClaimAllowed: run ${runId} still pending after ${(maxPolls * pollMs) / 1000}s — ` +
      `the gate genuinely blocked the claim (or no claimer attempted the row).`,
  );
}

/**
 * Inverse: assert the gate BLOCKED the queue claim. The minicomputer is subject to the same
 * gate, so for "no-opt-in test-content strategy" runs, neither we nor the minicomputer can
 * claim — the run stays pending. This is naturally race-safe (no claimer for the row).
 *
 * Provided for symmetry + readability in test bodies:
 *
 * ```ts
 * await assertClaimBlocked(sb, claimed, runId);
 * ```
 */
export async function assertClaimBlocked(
  sb: SupabaseClient,
  claimedByUs: Array<{ id: string }>,
  runId: string,
): Promise<void> {
  if (claimedByUs.find((r) => r.id === runId)) {
    throw new Error(`assertClaimBlocked: run ${runId} was claimed by us — gate let it through`);
  }
  const { data: run } = await sb
    .from('evolution_runs')
    .select('status')
    .eq('id', runId)
    .single();
  const status = (run as { status?: string } | null)?.status;
  if (status !== 'pending') {
    throw new Error(
      `assertClaimBlocked: run ${runId} status is '${status}' — expected 'pending' ` +
        `(another claimer may have racing-claimed it; if so the gate has a hole).`,
    );
  }
}
