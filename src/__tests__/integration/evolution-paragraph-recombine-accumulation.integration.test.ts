// Integration test for D10 cross-invocation Elo accumulation in paragraph_recombine.
// Per Phase 7 of rank_individual_paragraphs_evolution_20260525.
//
// LOAD-BEARING ASSERTIONS:
//   (a) Slot topic created in invocation 1 is REUSED via deterministic name in invocation 2.
//   (b) `evolution_arena_comparisons` rows persisted in inv 1 are loaded as competitors
//       in inv 2 via `loadArenaEntries` topK — assert by DB query.
//   (c) R-numbering continues across invocations (inv 2 emits R4-R6, not R1-R3).
//   (d) D20 `(this inv)` vs `(prior)` source tag is computed correctly.
//   (e) WARM-STATE INHERITANCE: R1's mu/sigma at start of inv 2 equals R1's mu/sigma
//       at end of inv 1 (proves prior Elo is inherited, not reset).
//   (f) agent_name + variant_kind are persisted correctly via the extended sync_to_arena RPC.
//
// SCOPE: This test requires a running real staging Supabase + LLM provider. The
// full pipeline runs end-to-end (3 iterations: generate → paragraph_recombine
// against the same pool parent → paragraph_recombine against the same pool parent
// AGAIN). Cleanup uses paragraphTopicParentPrefixes to cascade-delete paragraph
// topics + their variants + arena_comparisons rows (added to cleanupEvolutionData
// in Phase 7).
//
// IMPLEMENTATION: scaffolded per the plan. The full end-to-end harness setup is
// substantial (requires staging DB, model registry, LLM provider, full pipeline
// wiring) and lives in the dedicated harness file
// `src/__tests__/integration/setup-helpers/evolution-paragraph-harness.ts`
// which is the follow-up. Once the harness is built, .skip below switches to
// the real `describe`.

describe.skip('Paragraph recombine — cross-invocation Elo accumulation (D10)', () => {
  it('(a) reuses the slot topic via deterministic name across invocations', async () => {
    // Run a 3-iteration strategy: generate (inv 1) → paragraph_recombine (inv 2) →
    // paragraph_recombine (inv 3) against the SAME pool parent.
    // SELECT id FROM evolution_prompts WHERE prompt_kind='paragraph' AND prompt LIKE '[para] V<8hex>.P%'
    // Verify that the same id appears for the same slot in inv 2 and inv 3.
  });

  it('(b) persisted comparison rows from inv 1 load as competitors in inv 2', async () => {
    // SELECT prompt_id, count(*) FROM evolution_arena_comparisons WHERE prompt_id = <slotTopicId>
    // Returns > 0 after inv 2, proving persistSlotMatches wrote rows with the
    // slot's prompt_id (NOT the article's prompt_id).
  });

  it('(c) R-numbering continues across invocations (inv 2 = R4-R6 after inv 1 = R1-R3)', async () => {
    // formatParagraphLabel for the rewrites emitted by inv 2 should be V<hex>.P<n>.R4
    // through .R6 — proves R-number is derived from cumulative variant count
    // for the (parent, slot) pair, not reset per invocation.
  });

  it('(d) D20 winnerSource: "prior" vs "this_invocation" tag is correct', async () => {
    // execution_detail.slots[i].ranking.winnerSource on inv 2 must be:
    //   - 'this_invocation' if inv 2's R4-R6 beat all priors
    //   - 'prior_invocation' if R1 from inv 1 still leads
    //   - 'original' if neither rewrite cohort beat the original
  });

  it('(e) WARM-STATE INHERITANCE: R1 mu/sigma at start of inv 2 equals R1 mu/sigma at end of inv 1', async () => {
    // Capture R1's (mu, sigma) after MergeRatingsAgent at end of inv 1.
    // Capture R1's (mu, sigma) at the start of inv 2's per-slot ranking via the agent's
    // localRatings.get(R1.id) before any rankNewVariant call mutates it.
    // Assert |mu_after_inv1 - mu_before_inv2| < 1e-6.
    // LOAD-BEARING for D10's central claim.
  });

  it('(f) agent_name + variant_kind persist correctly (sync_to_arena extension)', async () => {
    // SELECT agent_name, variant_kind FROM evolution_variants
    //   WHERE prompt_id = <slotTopicId> AND id != <originalSlotVariantId>
    // Returns all rows with ('paragraph_rewrite', 'paragraph').
    // ON CONFLICT path: re-sync the same variant id, verify agent_name + variant_kind
    // are NOT clobbered (per RPC spec).
  });
});
