# fix_iterative_editing_persistence_bug_20260508 Research

## Problem Statement

Iterative editing variants don't appear in the `evolution_variants` table. 14 editing invocations from 2026-05-09 had `execution_detail.surfaced=true` and 7 of those had `appliedCount > 0`, but DB queries return zero matching rows by any linkage method (agent_name, agent_invocation_id, parent_variant_ids+time-proximity). Phase 5 of the A/B project requires `parentToChildEloDelta` — uncomputable when no child rows exist.

## High Level Summary

**Definitive root cause:** `IterativeEditingAgent.ts:535-541` constructs `finalVariant` by spreading `input.parent`:

```ts
finalVariant = {
  ...input.parent,
  text: current.text,
  parentIds: [input.parent.id],
} as Variant;
```

The spread copies **all** fields of `input.parent`, including `id` AND `fromArena`. Editing iterations operate on parents that come from prior runs' pools (verified empirically: parents have a different `run_id` than the editing invocation), so `input.parent.fromArena === true`. The spread copies that flag onto `finalVariant`.

Then `persistRunResults.ts:177` filters:
```ts
const localPool = result.pool.filter((v) => !v.fromArena);
```

**The editing variant is silently filtered out** before reaching the variant upsert. No collision, no error, no log — just dropped. The "Persisting variants" log entry fires for the generate variants in the same run (which were created fresh and have `fromArena: false`) but the editing variants never make it.

This bug is **silent** — no error is thrown, the run completes successfully, the surfaced=true flag is correctly persisted in `execution_detail`, but no `evolution_variants` row is ever inserted for the editing transformation. Empirically confirmed (5 of 5 verifiable cases): parent rows are unchanged in the DB; the edited text exists only in the editing invocation's `execution_detail.cycles[i].childText`.

(My initial hypothesis was an `id`-collision triggering an in-place upsert that overwrote the parent. The empirical confirmation query disproved that — parent rows have their original content. The actual cause is the `fromArena` filter dropping the variant earlier in the pipeline, which is functionally identical from the user's perspective: no new row appears.)

Three secondary issues compound the bug:
1. The editing finalVariant inherits `parent.tactic` (no override), so even if a new row were inserted it'd be mislabeled
2. The editing finalVariant doesn't get `agentInvocationId` set to the editing invocation's ID
3. `runIterationLoop`'s editing branch lacks the `discardedVariants` collection that the generate branch has — non-surfaced editing variants are dropped entirely

## Key Findings

1. **`fromArena` inheritance is the primary bug.** Editing parents come from prior runs' pools (`fromArena: true`). The spread inherits this flag onto the editing finalVariant. `persistRunResults.ts:174,177` filters `result.pool.filter((v) => !v.fromArena)`, which silently drops the editing variant before the upsert. Confirmed empirically: zero all-time rows with `agent_name = 'iterative_editing'` or `'iterative_editing_rewrite'`; for 5 verifiable cases, parent rows in DB still hold their ORIGINAL pre-edit text, ruling out the in-place-overwrite alternative.

2. **`id` is also inherited, which would be a separate bug** if the parent were from the same run (rather than `fromArena`). The spread copies `parent.id` onto `finalVariant.id`, and `persistRunResults.ts:337` upserts with `onConflict: 'id'`. For same-run parents, this would update the parent row in place; for cross-run parents (today's stage workload), it would silently change the parent's `run_id` to the editing run. Both fail to produce a NEW row. The fix addresses both at once by generating a fresh UUID via `createVariant({...})`.

3. **Tactic + invocation linkage are also broken** (would surface as the next bug after the id/fromArena fix). The spread inherits `parent.tactic` (e.g., `'structural_transform'`), so persistence would write the wrong `agent_name`. It also leaves `agentInvocationId` pointing at whatever the parent had (often `null` or the parent's generation invocation), not the editing invocation.

3. **Asymmetric discarded-variant collection.** Generate branch (`runIterationLoop.ts:660-665`) has `else if (out.variant && !out.surfaced)` to push to `discardedVariants`. Editing branch (`runIterationLoop.ts:955-958`) only collects when `r.finalVariant !== null && r.surfaced` — non-surfaced editing variants are silently dropped, never reaching `result.discardedVariants`.

4. **The persistence path itself is correct.** `persistRunResults.ts:174-290` reads `result.pool` and inserts each variant, mapping `v.tactic → agent_name`, `v.agentInvocationId → agent_invocation_id`, `v.parentIds → parent_variant_ids`. No filtering by tactic. Editing-specific bug is purely in the agent's variant construction, not the persistence layer.

5. **Other agents do this correctly.** `GenerateFromPreviousArticleAgent`, `ProposerApproverCriteriaGenerateAgent`, etc. all use the `createVariant({...})` factory (`evolution/src/lib/types.ts:66-92`), which generates a fresh `crypto.randomUUID()` for the variant ID and requires explicit `tactic` + `agentInvocationId` parameters. The editing agent bypasses this factory.

6. **Tests didn't catch this.** The E2E `admin-evolution-iterative-editing.spec.ts:189` asserts `variants.length <= 1` — zero passes. Integration tests mock the DB (`createMockDb`) so the upsert behavior isn't exercised. No unit test asserts the agent's `finalVariant.id !== input.parent.id`.

7. **Latent since the editing agent was reintroduced** (`feat/bring_back_editing_agents_evolution_20260430`). Git blame on the spread shows it has been unchanged since the agent was added. Recent projects (rewrite mode, drift-snap) didn't touch this code path.

8. **Mode B (IterativeEditingRewriteAgent) inherits the same bug** — it extends IterativeEditingAgent without overriding the `finalVariant` construction.

## Documents Read

- `docs/docs_overall/getting_started.md` — doc index
- `docs/docs_overall/project_workflow.md` — workflow contract
- `evolution/docs/editing_agents.md` — design contract for editing agents (line 27 mandates "emit final Variant"; line 29-31 specifies post-cycle ranking)
- `evolution/docs/data_model.md` — `evolution_variants` schema (line 99-128); `agent_invocation_id` thread (line 702-712); `parent_variant_ids` array (line 111)

## Code Files Read

- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` — root-cause site at line 535-541
- `evolution/src/lib/core/agents/editing/IterativeEditingRewriteAgent.ts` — Mode B sibling, inherits same bug
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — editing branch ~849-1015 (collection logic at 955-958; missing discarded path)
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts` — `pool.push(v)` at line 177 (no error: it just adds the duplicate-id variant to in-memory pool)
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — variant insert at line 270-337 (upsert with `onConflict: 'id'` is what triggers the silent overwrite)
- `evolution/src/lib/types.ts` — `Variant` interface (line 66+); `createVariant({...})` factory (line 66-92)
- `evolution/src/lib/schemas.ts` — `iterativeEditingExecutionDetailSchema`; `finalVariantId` is optional in the schema, which is part of why the bug stayed silent

## Empirical Evidence

Definitive query results (run 2026-05-09 against staging):

```
Total editing invocations today: 138 across 12 runs
Surfaced + applied>0 invocations: 9
Variants matching by agent_invocation_id: 0
Variants matching by parent_variant_ids+time: 0
All-time variants with agent_name='iterative_editing[_rewrite]': 0
```

Run-by-run inventory shows: runs with editing iterations have all the GENERATE-iteration variants persisted (e.g., 4× `structural_transform`, 4× `lexical_simplify`, 3× `grounding_enhance`) but never any editing variants. One run (`57e4d938`) shows a separate symptom — zero variants of any kind, possibly indicating a DIFFERENT failure mode there worth a follow-up but not in scope for this fix.

**Mutation-vs-filter discriminator query (5 of 5 cases):**
- Parent (run d9d6ff26, agent_name=`grounding_enhance`) → CURRENT == ORIGINAL parent text (NOT overwritten)
- Parent (run e6ed1cbb, agent_name=`zoom_lens`) → CURRENT == ORIGINAL (NOT overwritten)
- Parent (run b1096fab, agent_name=`grounding_enhance`) → CURRENT == ORIGINAL (NOT overwritten)
- Parent (run e6ed1cbb, agent_name=`zoom_lens`) → CURRENT == ORIGINAL (NOT overwritten)
- Parent (run [varies], agent_name=`narrative_weave`) → CURRENT == ORIGINAL (NOT overwritten)

In every checked case the parent's run_id is DIFFERENT from the editing invocation's run_id — proving these are cross-run pool parents (`fromArena: true` in memory), and proving the parent rows in DB are intact. The variants are dropped by the filter, not overwritten.

## Open Questions

1. ~~**Are the parent rows actually getting mutated in place?**~~ **Resolved** — confirmation query (5 cases) shows parent rows are intact. The bug is the `fromArena` filter, not an in-place upsert.

2. ~~**Does the upsert overwrite the parent's `mu`/`sigma`/`elo_score` too?**~~ **Resolved** — no upsert touches the parent at all; the editing variant is filtered out before reaching it.

3. **Should we backfill historic data?** No backfill needed — no parent rows were corrupted, just no editing children ever existed. Historic analysis loses the editing transformations entirely (the edited text only lives in `execution_detail.cycles[i].childText`), but the existing data is internally consistent.

4. **Mode B's `helper_threw` budget-exceeded issue is separate** — fixed by raising the per-invocation budget cap on the strategy (no code change), independent of this persistence bug.

5. **Should the fix also remove the `fromArena` flag from the editing finalVariant explicitly?** Yes — `createVariant({...})` doesn't set it, so the fresh variant will have `fromArena: undefined` (i.e., `falsy`), and the filter at `persistRunResults.ts:177` will let it through. No additional explicit removal needed; using the factory automatically does the right thing.

## Recommended Fix

**One targeted change** in `IterativeEditingAgent.ts:535-541`:

Replace the spread-construction with the `createVariant({...})` factory call:

```ts
finalVariant = createVariant({
  text: current.text,
  tactic: this.name,                // 'iterative_editing' or 'iterative_editing_rewrite'
  iterationBorn: ctx.iteration,
  parentIds: [input.parent.id],
  agentInvocationId: ctx.invocationId,
});
```

This single change:
- Generates a fresh UUID for `finalVariant.id` — no more upsert collision
- Sets `tactic` correctly so `agent_name` in DB will be `'iterative_editing'` (or `'iterative_editing_rewrite'` via dynamic `this.name`)
- Sets `agentInvocationId` so the DB row threads back to the editing invocation
- Sets `iterationBorn` correctly (the editing iteration, not whatever the parent had)
- Drops parent's stale fields (costUsd, fromArena, etc.) that shouldn't propagate

Three follow-up changes (smaller priority):

- Add an `else if (r.finalVariant !== null && !r.surfaced)` clause to `runIterationLoop.ts:955` to push discarded editing variants to `discardedVariants` (mirror generate branch line 660-665)
- Tighten the E2E `admin-evolution-iterative-editing.spec.ts:189` assertion from `<= 1` to `=== 1` when surfaced+applied
- Add a unit test that asserts `result.finalVariant.id !== input.parent.id` and `result.finalVariant.tactic === this.name` and `result.finalVariant.agentInvocationId === ctx.invocationId`
- Add an integration test that runs a full editing cycle against the test DB and asserts a new row appears in `evolution_variants` with the right metadata

## Next Steps

1. Read `IterativeEditingAgent.ts:535` once more in context, then write the fix as planned
2. Add the unit test FIRST (should fail with current code; proves test quality)
3. Apply the fix
4. Confirm tests pass
5. Add the integration test + tighten the E2E assertion
6. Verify on stage by running one editing invocation and confirming the DB has the new row
7. Quickly check (via DB query) whether parent rows in past runs have been silently mutated — if yes, surface this in the PR description as a finding worth flagging to the team
