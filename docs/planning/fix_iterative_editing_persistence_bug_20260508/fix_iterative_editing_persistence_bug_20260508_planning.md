# fix_iterative_editing_persistence_bug_20260508 Plan

## Background

I want to fix the persistence issue where iterative editing variations don't get persisted and don't have elo.

## Problem

Today's stage analysis (60 Mode B + 9 Mode A invocations on 2026-05-09) showed `surfaced=true` in `execution_detail` for 14 invocations, with 7 of those having `appliedCount > 0`. But **zero rows in `evolution_variants`** have `agent_name = 'iterative_editing'` or `agent_name = 'iterative_editing_rewrite'`, and **zero rows have `agent_invocation_id` linking back to any of those 14 surfaced editing invocations**. The editing pipeline is computing edits, applying them in memory, running ranking comparisons against the pool, but the resulting child variants never reach the DB. Downstream, this means there is no parent→child Elo data for editing variants, which makes the Phase 5 A/B decision rule (`parentToChildEloDelta(B) ≥ parentToChildEloDelta(A) − 5`) impossible to evaluate. The docs (`evolution/docs/editing_agents.md` line 27) explicitly state that "after cycle loop terminates: emit final `Variant` if any cycle produced edits" — so the design contract is being violated by the runtime.

## Investigation needed

- Trace the exit path of `IterativeEditingAgent.execute()` and verify whether `finalVariant` is set in the returned `IterativeEditOutput`.
- Trace `runIterationLoop` post-editing block: it currently passes `newVariants` (returned from the editing agent invocations) to `MergeRatingsAgent`. Confirm whether `newVariants` actually contains the editing children, or whether it is empty for editing iterations.
- Inspect `MergeRatingsAgent.execute()`'s persist path: it pushes variants into the in-memory pool, but does it write them to `evolution_variants`? If so, with what `agent_name` and `agent_invocation_id`?
- Check the finalize step (`evolution/src/lib/pipeline/finalize/`): does it batch-insert in-memory variants? If so, why are editing children absent from those rows?
- Cross-reference with `GenerateFromPreviousArticleAgent` which DOES produce DB-persisted child variants — what does its output flow look like that editing's doesn't?

## Likely root-cause hypotheses (to verify, not assume)

- **H1 (most likely):** the `surfaced=true` flag in editing's execution_detail does not gate variant persistence. Some other condition (e.g. having a `newVariantId` in a cycle, having `cycle.appliedCount > 0`, or having a non-null `finalVariant` on the agent output) is what gates DB write — and that condition is not being met in production runs even when `surfaced=true`.
- **H2:** the editing agent IS producing a `finalVariant`, but the in-memory variant is not being added to the `newVariants` array passed to `MergeRatingsAgent`, so the merge step doesn't persist it.
- **H3:** the editing agent's variant text equals the parent's text byte-for-byte (because `appliedCount=0` for many of the surfaced cases), so a "no actual change" fast-path skips persistence — but that fast-path is misclassifying cases where edits genuinely applied.

The data point that 7/14 surfaced invocations have `applied=0` and 7/14 have `applied>0` matters: H3 might explain the `applied=0` half, but cannot explain why the `applied>0` half also fail to persist.

## Acceptance criteria

- [ ] Editing iterations that successfully apply at least one edit (`appliedCount > 0` in any cycle) produce one new row in `evolution_variants` with `agent_name` matching the editing agent (`iterative_editing` or `iterative_editing_rewrite`).
- [ ] Each new editing variant has `agent_invocation_id` set to the editing invocation that produced it, `parent_variant_ids[0]` set to the original input parent, and `mu`/`sigma` populated by the post-cycle ranking step.
- [ ] Re-running today's failing case reproduces and then proves the fix: pull a recent surfaced editing invocation that did NOT produce a DB row, replay it locally with the fix, observe a new row.
- [ ] Phase 5's `parentToChildEloDelta` query becomes computable for both Mode A and Mode B.

## Verification

- [ ] Unit test that asserts the agent output shape contains a non-null `finalVariant` when `appliedCount > 0` in any cycle.
- [ ] Integration test that runs a full editing cycle end-to-end against a test DB and asserts the row appears in `evolution_variants` with the expected `agent_name` + `agent_invocation_id`.
- [ ] Stage smoke: trigger a single editing run on stage, confirm the resulting variant row exists.

## Open questions

- Is this regression specific to my recent merges (PR #1042 Mode B + PR #1047 drift-snap), or has it been latent since editing was reintroduced (`feat/bring_back_editing_agents_evolution_20260430`)? Quickly query historic data to find out.
- Should the fix also backfill historic surfaced-but-unpersisted editing invocations? Probably not (DB churn risk; just go forward).
