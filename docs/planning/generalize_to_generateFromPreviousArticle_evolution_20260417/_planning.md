# Generalize to generateFromPreviousArticle Plan

## Background

The evolution pipeline's `generateFromSeedArticle` agent always transforms the seed article. We want to generalize it to `generateFromPreviousArticle` so it can also transform a high-quality variant already in the current run's pool. On top of that, we want to surface variant-to-parent lineage (chain + text diff), attribute ELO delta at both variant and invocation levels, and make the invocation detail view richer for this agent.

## Requirements (from user)

See `_research.md` — verbatim task list.

## Problem

Today: (1) the generation agent is hard-coded to seed; (2) variants are created with `parent_variant_id` populated but the UI mostly treats this as decoration; (3) there's no way to attribute ELO gain to a specific generation strategy or dimension; (4) the lineage tab shows only a shallow chain and no text diffs. We need:

- Agent generalization (source-selection + quality cutoff).
- Consistent surfacing of `parent ELO, parent CI, ELO delta` in every variant list/card.
- Upgraded lineage tab with full chain + `TextDiff` between each hop.
- A systematic, declarative way for any "generate-type" agent to declare an **attribution dimension** (e.g., `strategy`) so the metric framework can break down ELO delta by that dimension.
- Improved invocation detail view with parent context + diff.

## Options Considered

### Option A: New DB column distinct from `parent_variant_id` (e.g., `ancestor_variant_id` for future multi-parent agents)
- Pros: semantic clarity if we ever introduce crossover/merge agents that produce multi-parent variants — "parent" can stay single-valued while "ancestors" becomes many-to-many.
- Cons: duplicates existing column's current usage today; migration + backfill + two columns to keep in sync; more code churn.

### Option B: Reuse existing `parent_variant_id` as the parent pointer (CHOSEN)
- Pros: zero migration; agent already writes it; Lineage tab already queries it.
- Cons: if we ever introduce a multi-parent generation agent, we'd need a bridge table or second column then — but YAGNI for now.

**Decision: Option B.** We'll treat `parent_variant_id` as authoritative parent. If a future agent needs multi-parent lineage, we add a bridge table (`variant_ancestry(child_id, parent_id, role)`) at that time.

### Option C: Precompute `elo_delta_vs_parent` as a DB metric row at finalization
- Pros: fast reads; aggregatable via existing bootstrap/CI machinery.
- Cons: must recompute on rating changes (arena matches) — but the stale-metric infra already handles this.

### Option D: Compute delta on-read via JOIN (CHOSEN for Phase 3; Phase 5 adds precomputed metrics)
- Pros: no new metric row; always fresh.
- Cons: N+1 risk on list views — mitigated by single JOIN query.

**Decision: Start with D for the per-variant badge (Phase 3). Phase 5 layers in the per-agent-dimension attribution metrics using the existing metric registry.**

### Option E: Attribution dimension — string path vs. typed method
- Original proposal: agent declares `attributionDimensionKey?: string` (JSONB field path).
- Rejected: stringly-typed, no type safety if the execution detail schema changes.
- **Chosen:** typed method `getAttributionDimension(detail: TDetail): string | null` on the `Agent` base class. Returns the dimension value (e.g., `detail.strategy`) or `null` if the invocation shouldn't participate in attribution (swiss/merge agents).
- For this project only `generateFromPreviousArticle` implements it — returns `detail.strategy`.
- Single dimension per agent is enough for now. If we ever need multi-dim, renaming to `getAttributionDimensions(detail): Record<string, string>` is an obvious upgrade — no breaking change to metric storage.
- Metric emission: `eloAttrDelta:<agentName>:<dimensionValue>` (follows existing `agentCost:<name>` pattern).

## Cross-Cutting Invariants (apply to every phase)

These resolve gaps surfaced by multi-agent plan review:

1. **Metric name whitelist.** Both `'eloAttrDelta:'` *and* `'eloAttrDeltaHist:'` must be added to `DYNAMIC_METRIC_PREFIXES` in `evolution/src/lib/metrics/types.ts`, and `isValidMetricName()` in `evolution/src/lib/metrics/registry.ts` must be updated accordingly. Strategy names embedded in the dimension value must be sanitized (no `:` or control chars); current 3 strategies are snake_case, safe.
2. **Variant persistence chokepoint.** `evolution/src/lib/pipeline/finalize/persistRunResults.ts` is the single insertion point. `agent_invocation_id` must be threaded from the in-memory `Variant` (populated by the agent from `AgentContext.invocationId`) into this insert. `evolution_agent_invocations` rows are inserted before variants in the finalize pipeline, so the FK is satisfied at insert time — add an assertion-level test to lock ordering.
3. **Pool scoping already handles cross-run contamination.** `runIterationLoop.ts:299` snapshots `initialPool` to this run only. No `fromArena` field exists in the `Variant` type (confirmed via grep); the earlier "arena-variant exclusion filter" was based on a non-existent field. `resolveParent` operates on the already-scoped `initialPool` without an additional filter.
4. **Discarded variants persist their local-rank ELO when available.** `GenerateFromPreviousArticleAgent.execute()` sets `execution_detail.ranking = null` on early-exit paths (generation-failed, format-invalid, generation-LLM-error, unknown-strategy, budget-exceeded-during-generation). `extractLocalRating(executionDetail): Rating | null` returns null for those cases; caller falls back to `createRating()` defaults and those rows are excluded from Phase 3/5 metric computation (filter `rating.uncertainty < defaultUncertainty` or track via a flag). For variants where ranking succeeded, local rank ELO is persisted — removes the survivorship bias that matters most (surfaced-vs-discarded after ranking).
5. **Delta computation is always live (never snapshotted).** Per user direction, Phase 3 badges and Phase 5 aggregated metrics both compute delta from the parent's current `mu`/`sigma`. The existing `mark_elo_metrics_stale()` trigger already fires on any variant's rating change; we register `eloAttrDelta:*` and `eloAttrDeltaHist:*` with the same stale-cascade so parent drift re-invalidates aggregates on next read. Consequence: numbers can drift over time — consistent with how `winner_elo` already behaves.
6. **Seeded RNG for pool picking.** `resolveParent` uses `createSeededRng` imported from `evolution/src/lib/metrics/experimentMetrics.ts` (confirmed path) — also re-exported from `evolution/src/lib/shared/seededRandom.ts`. Seed derived from `hashSeed(runId, iteration, executionOrder)`: concatenate `${runId}:${iteration}:${executionOrder}` and FNV-1a hash to a 32-bit integer. Unit test must prove determinism across parallel invocations with the same `(runId, iteration, executionOrder)` tuple.
7. **Strategy hash includes cutoff.** The new `qualityCutoff` field on `IterationConfig` is naturally part of the Zod-serialized `iterationConfigs` array, so it's hashed by `hashStrategyConfig`. Add an explicit unit test.
8. **Single attribution dimension per agent, typed method.** `Agent.getAttributionDimension(detail): string | null` (not a JSON-path string). `generateFromPreviousArticle` returns `detail.strategy`. Multi-dimension is a future upgrade path.
9. **Variant-display surfaces audit.** Phase 3 must cover: standalone variants page, run/strategy `VariantsTab`, arena leaderboard, variant **detail header** (current page shows parent link but no parent ELO/delta), `VariantCard` component, and `LineageGraph` nodes if rendered.
10. **Confidence-interval display.** `VariantParentBadge` renders both the parent's ELO±CI *and* the delta's CI: `Δ +45 [+10, +80]`. Delta CI comes from `bootstrapDeltaCI()`.
11. **Arbitrary-pair lineage diff.** Phase 4 ships both consecutive-pair diffs (default, shown inline between chain nodes) *and* a node-picker control to diff any two nodes in the chain. In the picker, rendered labels are "From / To" (not "Parent") since the two nodes aren't necessarily direct parent-child. The `VariantParentBadge` accepts a `role: 'parent' | 'from'` prop and varies labels accordingly.
12. **Invocation-detail forensics — data source correction.** The sent prompt, raw LLM response, and token counts are NOT in `execution_detail` (verified). They live in the separate `llmCallTracking` table (columns `prompt`, `content`, `raw_api_response`, token counts) keyed by `invocation_id`. Phase 6 adds a JOIN / server-action fetch to surface these. Prompts embed the user's seed/parent article text — add a compact PII-disclosure banner above the section ("Raw prompts may contain source article content — do not share externally").
13. **Chart library adoption.** Evolution `visualizations/` folder currently uses hand-rolled SVG. For Phase 5 bar chart + histogram, adopt **Recharts** (already in `package.json` v3.7.0, zero current usage). New `evolution/src/components/evolution/charts/` subfolder introduces the chart layer. Simpler than extending SVG for CI whiskers; consistent with `recharts` being already installed.
14. **Attribution dimension key.** `(agentName, dimensionValue)` only — where `dimensionValue = Agent.getAttributionDimension(detail)`. `sourceMode`/`qualityCutoff` do NOT affect the key (per user decision). Example metric names: `eloAttrDelta:generate_from_previous_article:lexical_simplify`. Seed variants and swiss/merge invocations return `null` dimension and are excluded from aggregation.
15. **Cross-run parent indicator.** When `parent_variant_id` points to a variant in a different run (happens when the seed variant was reused from prior work), `VariantParentBadge` renders the annotation "(other run)" next to the parent ID. Detect via comparing `parent.run_id !== variant.run_id`.
16. **Aggregation mechanism (firm).** Phase 5 uses **option (b)**: ad-hoc aggregation in `experimentMetrics.ts` following the existing `agentCost:<name>` pattern. Declarative registry extension is deferred.
17. **`sampleNormal` sourcing (firm).** Export `sampleNormal` from `evolution/src/lib/metrics/experimentMetrics.ts` (add the `export` keyword). `ratingDelta.ts` imports it. No inlining.
18. **Deferred items (documented as tech debt, out of scope):**
    - Vestigial `reusedFromSeed` schema field — leave alone.
    - Shared `VariantRow` table component — three list surfaces stay bespoke; standardization is semantic-only (via shared badge).
    - Phase 6 separate "Diff" tab removed as redundant with Phase 4 lineage — invocation detail view links to lineage tab instead.

## Phased Execution Plan

### Phase 1: Rename agent → `generateFromPreviousArticle`

**Scope:** pure rename + DB backfill; no behavior change. Ships as an independently-verifiable PR.

- [x] Rename file `evolution/src/lib/core/agents/generateFromSeedArticle.ts` → `generateFromPreviousArticle.ts`.
- [x] Rename colocated test file `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` → `generateFromPreviousArticle.test.ts`.
- [x] Rename class `GenerateFromSeedArticleAgent` → `GenerateFromPreviousArticleAgent`.
- [x] Rename agent `name` field: `'generate_from_seed_article'` → `'generate_from_previous_article'`.
- [x] Rename `detailType` literal in execution detail schema + update `detailViewConfigs.ts` key.
- [x] Rename input/output types: `GenerateFromSeedInput` → `GenerateFromPreviousInput`, etc.
- [x] Rename agent-input field `seedVariantId` → `parentVariantId`, `originalText` → `parentText`.
- [x] Keep `parentIds: [parentVariantId]` on variant creation (unchanged semantics).
- [x] Update `evolution/src/lib/core/agentRegistry.ts` import.
- [x] Update `evolution/src/lib/pipeline/loop/runIterationLoop.ts` dispatch (~line 299–360).
- [x] **No DB backfill.** Historic rows keyed to `'generate_from_seed_article'` will be deleted post-merge (see Historic-Data Deletion Runbook below).
- [x] **Explicit blast-radius file list** (all known occurrences of the old agent name — update in the same PR to keep CI green):
    - `evolution/src/lib/pipeline/finalize/persistRunResults.ts`
    - `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx` (timeline-gate set `TIMELINE_AGENTS`)
    - `evolution/src/services/costEstimationActions.ts`
    - `evolution/src/lib/core/agentNames.ts` (if it lists the old name)
    - Integration tests: `evolution-cost-attribution.integration.test.ts`, `evolution-seed-cost.integration.test.ts`
    - E2E specs: `admin-evolution-budget-dispatch.spec.ts` (and any other matching spec)
    - Any other hit from: `grep -r "generate_from_seed_article\|generateFromSeedArticle\|GenerateFromSeedArticle" evolution/ src/ supabase/`.
- [x] Update `agentExecutionDetailSchema` discriminated union in `evolution/src/lib/schemas.ts` to swap the `detailType` literal.
- [x] **Historic-Data Deletion Runbook** (executed AFTER this PR merges to main, before Phase 2 ships):
    - Runner: engineer with DB admin access.
    - Order: (1) delete metric rows with `origin_entity_id IN (affected invocation IDs)`; (2) delete `evolution_variants` where `agent_name = 'generate_from_seed_article'`; (3) delete `evolution_agent_invocations where agent_name = 'generate_from_seed_article'`; (4) delete parent `evolution_runs` that become empty.
    - Safeguards: wrap in transaction; dry-run with COUNT first; run against staging before production; communicate in #eng channel before running.
    - Blast radius: all saved links to historic invocation detail pages will 404; dashboards referencing those invocation IDs will show gaps; archive of run summaries in admin UI will be shorter.
    - Out of scope for this PR: only the code change ships here. Data deletion is a follow-up operation.

**Verification:** existing unit + integration + E2E tests still pass. Admin UI still loads invocation detail for previously-completed runs (with the DB backfill applied).

### Phase 2: Source selection — seed vs. run pool + quality cutoff

**Scope:** extend `IterationConfig` + wire pool-sourcing in the iteration loop.

- [x] Extend `iterationConfigSchema` in `evolution/src/lib/schemas.ts`:
    ```ts
    const qualityCutoffSchema = z.object({
      mode: z.enum(['topN', 'topPercent']),
      value: z.number().positive(),  // topN: integer>=1; topPercent: 0<x<=100
    });
    
    export const iterationConfigSchema = z.object({
      agentType: iterationAgentTypeEnum,
      budgetPercent: z.number().min(1).max(100),
      maxAgents: z.number().int().min(1).max(100).optional(),
      sourceMode: z.enum(['seed', 'pool']).optional(),       // default 'seed'
      qualityCutoff: qualityCutoffSchema.optional(),
    }).refine(c => c.agentType !== 'swiss' || c.sourceMode === undefined,
              { message: 'sourceMode only valid for generate iterations' })
     .refine(c => c.sourceMode !== 'pool' || c.qualityCutoff !== undefined,
              { message: 'qualityCutoff required when sourceMode is pool' });
    ```
- [x] Strategy-level `.refine()`: first iteration must be `sourceMode: 'seed'` (or undefined).
- [x] Add `evolution/src/lib/pipeline/loop/resolveParent.ts`:
    ```ts
    export function resolveParent(args: {
      sourceMode: 'seed' | 'pool';
      qualityCutoff?: QualityCutoff;
      seedVariant: Variant;
      pool: ReadonlyArray<Variant>;
      ratings: ReadonlyMap<string, Rating>;
      rng: () => number;
    }): { variantId: string; text: string };
    ```
    - For `seed`: return seed variant.
    - For `pool`: `initialPool` is already scoped to the current run by `runIterationLoop.ts:299` — no additional filter needed (there is no `fromArena` field in `Variant`; that invariant in earlier drafts was based on a non-existent field). Compute eligible ids by cutoff against `ratings` map, pick uniformly random via `rng`.
    - If eligible pool is empty (e.g., cutoff too strict or iteration runs before any variants were ranked), fall back to seed and log a warning.
- [x] Add pure helpers: `computeTopNIds(ratings, n)`, `computeTopPercentIds(ratings, pct)`.
- [x] Wire `resolveParent` into `runIterationLoop.ts` before agent launch — each parallel agent gets its own picked parent.
- [x] Seed the RNG per invocation: `createSeededRng(hashSeed(runId, iteration, executionOrder))`. Import `createSeededRng` from **`evolution/src/lib/metrics/experimentMetrics.ts`** (corrected path). New `hashSeed()` helper uses FNV-1a to fold the string `${runId}:${iteration}:${executionOrder}` into a 32-bit integer. Add unit test: two calls with same tuple return the same pick; calls in parallel iterations with different executionOrder return different picks.
- [x] **Persist local-rank ELO for discarded variants (with null-safety).** Modify `persistRunResults.ts` (~line 245): for `persisted: false` rows, call `extractLocalRating(executionDetail)` — returns `Rating | null`. If non-null, persist `finalLocalElo` / `finalLocalUncertainty` from `execution_detail.ranking`. If null (early-exit paths: generation_failed, format-invalid, budget-exceeded, unknown-strategy), fall back to `createRating()` defaults AND set a new in-memory `Variant.rankingFailed: true` flag. Phase 3/5 metric computation filters out `rankingFailed: true` rows (accept survivorship bias only for rows that never got ranked; honest picture for all others).
- [x] Update Zod `StrategyConfig.refine()` to enforce: if `iterationConfigs[0].sourceMode === 'pool'` → reject.
- [x] **Unit test on strategy hash:** `qualityCutoff.value` change mints a new strategy (two configs differing only by cutoff value hash to different IDs).
- [x] UI: extend strategy builder (`src/app/admin/evolution/strategies/new/page.tsx`) with per-iteration source-mode + cutoff controls. Only visible for non-first generate iterations.

**Verification:** unit tests on `resolveParent`, `computeTopNIds`, `computeTopPercentIds`; Zod-schema tests on `iterationConfigSchema`; strategy-builder Playwright test.

### Phase 3: Variant-level ELO delta surfacing

**Scope:** backend query extensions + shared `VariantParentBadge` component + apply to 3 list views.

- [x] Extend variant-list server actions to JOIN `parent_variant_id` → parent's `mu, sigma, elo_score, run_id` (run_id for cross-run indicator). Return parent fields inline on each variant row.
    - `listVariantsAction` in `evolution/src/services/evolutionActions.ts` (serves standalone list + run/strategy `VariantsTab` — confirm single action covers both; if arena uses a separate action, identify it via `grep -rn "arena" evolution/src/services/` and extend that too).
- [x] Compute delta at the application layer:
    ```ts
    // evolution/src/lib/shared/ratingDelta.ts
    export function bootstrapDeltaCI(
      child: Rating,
      parent: Rating,
      iterations = 1000,
      rng: () => number = Math.random,
    ): { delta: number; ci: [number, number] } {
      const samples: number[] = [];
      for (let i = 0; i < iterations; i++) {
        const c = sampleNormal(child.elo, child.uncertainty, rng);
        const p = sampleNormal(parent.elo, parent.uncertainty, rng);
        samples.push(c - p);
      }
      samples.sort((a, b) => a - b);
      return {
        delta: child.elo - parent.elo,
        ci: [samples[Math.floor(0.025 * iterations)], samples[Math.floor(0.975 * iterations)]],
      };
    }
    ```
    - Independence-assumption bootstrap (matches existing `bootstrapMeanCI` / `bootstrapPercentileCI` pattern in `experimentMetrics.ts`).
    - Note: child and parent ELOs share a reference frame via pairwise matches, so their marginal σ's likely overstate the delta's uncertainty (positive correlation → true SD is smaller). This is a conservative upper bound — the correct fix would require tracking the joint posterior, which the current rating system does not expose. We accept the conservative CI and document the caveat.
- [x] Export `sampleNormal` (Box-Muller) from `evolution/src/lib/metrics/experimentMetrics.ts` (currently not exported — add `export`). Import it into `ratingDelta.ts`. Per invariant #17.
- [x] New component `evolution/src/components/evolution/variant/VariantParentBadge.tsx`:
    - Props: `{ parentId, parentElo, parentUncertainty, delta, deltaCi }`.
    - Renders: `Parent #a1b2c3 — 1250 ± 40 · Δ +45 [+10, +80]` (parent ELO±uncertainty + delta point + delta 95% CI).
- [x] **Drop badge into all variant-display surfaces** (expanded audit per invariant #9):
    - Standalone variants page (`src/app/admin/evolution/variants/page.tsx`) — new column.
    - Run/strategy `VariantsTab.tsx` — new column.
    - Arena leaderboard (`src/app/admin/evolution/arena/[topicId]/page.tsx`) — new column.
    - **Variant detail page header** (`VariantDetailContent.tsx`) — inline below the ELO badge.
    - `VariantCard.tsx` — compact form below the primary content.
    - `LineageGraph` nodes (if present in variant detail or elsewhere) — check via grep.
- [x] Audit sweep: `grep -r "parent_variant_id\|parentVariantId\|VariantRow\|VariantCard\|LineageGraph" src/ evolution/src/` to confirm no list view is missed.
- [x] **No `persisted`-filter needed** (invariant #4 persists real local-rank ELO for discarded variants).

**Verification:** unit tests on delta computation; Playwright test verifies badge renders in variants page, VariantsTab, arena page.

### Phase 4: Lineage tab upgrade — full chain + text diff

**Scope:** swap the shallow chain for a full recursive walk + integrate `TextDiff.tsx` between hops.

- [x] New server action `getVariantFullChainAction(variantId)`:
    - Supabase client cannot express `WITH RECURSIVE`; the query **must be behind a Postgres RPC** (same pattern as existing RPCs called from `claimAndExecuteRun`, `persistRunResults`, `writeMetrics`). No `WITH RECURSIVE` CTE exists anywhere in the codebase today — this introduces the first.
    - Returns `Array<{ variant, parent? }>` root-first.
    - Cap at 20 hops to match `iterationConfigs` max.
    - **Cycle protection:** RPC uses Postgres `WITH RECURSIVE ... CYCLE variant_id SET is_cycle USING path` clause and terminates when `is_cycle = true` or `depth >= 20`. `parent_variant_id` has no FK declared today (verified via `database.types.ts:916–938`), so corrupt rows can technically exist.
- [x] **DB migration #1:** add index on `evolution_variants(parent_variant_id)` for fast recursive walk. Filename: `YYYYMMDDHHmm00N_variants_parent_variant_id_index.sql` (14-digit timestamp + seq suffix per repo convention).
    ```sql
    CREATE INDEX IF NOT EXISTS idx_evolution_variants_parent_variant_id
      ON evolution_variants(parent_variant_id);
    ```
- [x] **DB migration #2:** Postgres RPC `get_variant_full_chain(variant_id UUID)` in `YYYYMMDDHHmm00N_variants_get_full_chain_rpc.sql`, implementing the recursive+cycle-safe walk described above.
- [x] Update `VariantLineageSection.tsx`:
    - Render vertical chain root→leaf.
    - Between each consecutive pair: render `TextDiff` (collapsed by default, expand-on-click) showing word-level changes.
    - `VariantParentBadge` between each pair (ELO delta with CI).
- [x] **Arbitrary-pair diff control.** Add two node-pickers (left/right dropdowns listing every node in the chain by short ID + generation index). On selection, render a `TextDiff` and `VariantParentBadge` between the two chosen nodes (treating the left as parent for the delta computation).
- [x] Deprecate shallow `getVariantLineageChainAction` or have it delegate to the new full action.
- [x] Reuse existing `TextDiff.tsx` — no new diff dep.

**Verification:** unit test on recursive query helper with seeded variant chain; Playwright test on lineage tab loads correctly for a multi-hop variant.

### Phase 5: Invocation-level ELO attribution by dimension (agent/metric framework extension)

**Scope:** declarative dimension field on `Agent` + new per-dimension metric registered at run/strategy/experiment level.

- [x] **Extend `Agent` base class** (`evolution/src/lib/core/Agent.ts`) with a typed method (not a string path):
    ```ts
    abstract class Agent<TInput, TOutput, TDetail> {
      // ...
      /** Return the attribution dimension value for an invocation.
       * Null for agents that don't produce variants (swiss, merge_ratings)
       * or invocations where the dimension is not applicable. */
      getAttributionDimension(detail: TDetail): string | null {
        return null;
      }
    }
    ```
- [x] `GenerateFromPreviousArticleAgent.getAttributionDimension = (d) => d.strategy ?? null;`.
- [x] **DB migration** `supabase/migrations/<timestamp>_variants_add_agent_invocation_id.sql`:
    ```sql
    ALTER TABLE evolution_variants
      ADD COLUMN agent_invocation_id UUID
      REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL;
    CREATE INDEX idx_evolution_variants_agent_invocation_id
      ON evolution_variants(agent_invocation_id);
    ```
    No backfill — old rows keep `agent_invocation_id = NULL` and are naturally excluded from attribution. Historic data will be deleted post-merge.
- [x] **Thread `invocationId` through variant creation** (the Phase 5 chokepoint):
    - Extend `Variant` in-memory type: add `agentInvocationId?: string`.
    - Extend `createVariant()` signature to accept `agentInvocationId`.
    - In `GenerateFromPreviousArticleAgent.execute()` and `CreateSeedArticleAgent.execute()`, pass `ctx.invocationId`.
    - In `persistRunResults.ts` INSERT, include `agent_invocation_id: v.agentInvocationId ?? null`.
    - Also extend `evolutionVariantInsertSchema` (Zod) to accept the nullable field.
- [x] **Whitelist both new dynamic metric prefixes.** Add `'eloAttrDelta:'` AND `'eloAttrDeltaHist:'` to `DYNAMIC_METRIC_PREFIXES` in `evolution/src/lib/metrics/types.ts`. Update `isValidMetricName()` in `evolution/src/lib/metrics/registry.ts` to accept both.
- [x] **Compute function `computeInvocationEloDelta(invocationId, ctx)`:**
    - Fetch variants where `agent_invocation_id = invocationId`, skipping `rankingFailed: true` rows.
    - For each variant with a non-null `parent_variant_id`, fetch the parent's current `mu, sigma` via JOIN; compute `child.elo - parent.elo` + bootstrap CI via `bootstrapDeltaCI`.
    - Return `Rating`-shaped metric (`{value, uncertainty, ci_lower, ci_upper}`). Null if no produced variant or no parent.
    - **Always live (no snapshot).** Parent's rating is read fresh per invariant #5. The existing `mark_elo_metrics_stale()` trigger invalidates these metrics on rating drift — we just need to include them in its stale-cascade whitelist.
- [x] **Extend stale-flag trigger.** Update `mark_elo_metrics_stale()` (migrated in `supabase/migrations/20260328000002_expand_stale_trigger_invocations.sql`) to include `elo_delta_vs_parent`, `eloAttrDelta:*`, and `eloAttrDeltaHist:*` in its invalidated-metric-names list so parent rating drift triggers recomputation of child attribution.
- [x] **Register** per-invocation metric `elo_delta_vs_parent` in `METRIC_REGISTRY['invocation'].atFinalization`.
- [x] **Aggregate invocation → run/strategy/experiment** via **option (b)** (per invariant #16): ad-hoc aggregation in `experimentMetrics.ts` following the `agentCost:<name>` pattern near line ~305. Declarative `atPropagation` extension is deferred.
- [x] For each `(agentName, dimensionValue)` group with ≥1 invocation, emit `eloAttrDelta:<agentName>:<dimensionValue>`:
    - `value` = mean of per-invocation deltas.
    - `ci_lower/ci_upper` = bootstrap 95% CI via `bootstrapMeanCI` (n≥2 required; n=1 returns null CI).
    - `n` = count of invocations in group.
    - `origin_entity_type='invocation'`.
- [x] Also emit histogram metric family `eloAttrDeltaHist:<agentName>:<bucketStart>:<bucketEnd>` with `value` = fraction of deltas falling into that 10-ELO bucket. Buckets: `(-∞, -40), [-40, -30), ..., [30, 40), [40, +∞)`.
- [x] **UI: strategy-breakdown bar chart.** On run and strategy detail pages, new `StrategyEffectivenessChart` component — mean ELO Δ per strategy with CI whiskers. Shown only for agents where `getAttributionDimension` is non-null.
- [x] **UI: per-agent histogram.** New `EloDeltaHistogram` component — fixed 10-ELO buckets; rendered on the run + strategy + experiment detail pages (one per variant-producing agent). Primary view aggregates across all strategies; a strategy-selector dropdown allows filtering.
- [x] Documentation: update `evolution/docs/agents/overview.md` with the dimension concept + histogram metric.

**Verification:** unit test for `computeInvocationEloDelta`; integration test via seeded run that asserts metric rows are emitted with expected values; Playwright test renders the strategy-breakdown chart.

### Phase 6: Invocation detail view improvements for `generate_from_previous_article`

**Scope:** richer display for this agent. No separate Diff tab — Phase 4's lineage tab is the diff home; we link to it from the parent block.

- [x] **Parent block on Overview.** New section above the existing metrics grid:
    - Parent variant ID (short) as a link to its detail page.
    - Parent ELO ± uncertainty + 95% CI.
    - Generated variant ELO ± uncertainty + 95% CI.
    - **`Δ +45 [+10, +80]`** (prominent) using `VariantParentBadge`.
    - Generation strategy (dimension value).
    - Source mode (`seed` vs. `pool`).
    - Rank of parent in pool at generation time (captured in `execution_detail`).
    - Surfaced flag + discard reason if applicable.
    - "View full lineage →" link that navigates to the variant's detail page on the Lineage tab.
- [x] **Collapsed "Raw LLM call" section** below execution detail. Data source corrected: prompt + raw response + token counts live in the separate `llmCallTracking` table (columns `prompt`, `content`, `raw_api_response`, plus token-count columns), **not** in `execution_detail` (`generateFromSeedExecutionDetailSchema` only stores `promptLength`/`textLength`).
    - New server action `getLLMCallsForInvocationAction(invocationId)` joins `llmCallTracking` by `invocation_id`.
    - Render (on expand): full prompt, raw response text, prompt tokens, completion tokens, model, temperature.
    - **PII disclosure banner** above the section: "Raw prompts may contain source article content — do not share externally." (Prompts embed the seed/parent article text.)
- [x] Admin-access gating: invocation detail page is already wrapped by `adminAction`, so access control is satisfied. No additional gating required unless a "production data hiding" flag exists in the codebase — check during execution.
- [x] Extend `detailViewConfigs.ts` entry for `generate_from_previous_article` with the new field layout.
- [x] Keep existing Timeline tab unchanged.

**Verification:** Playwright test against a seeded completed invocation — all new fields render; "View full lineage" link navigates correctly; Raw-LLM section expands.

### Phase 5b: Migration safety + rollback plan

**Destructive-DDL guard.** CI `.github/workflows/ci.yml` (around line 97) blocks destructive DDL in migrations. The Phase 5 `ALTER TABLE ... ADD COLUMN agent_invocation_id` is additive and passes the guard. However:

- **Rollback strategy for Phase 5 column.** If a deploy needs to be reverted, `DROP COLUMN agent_invocation_id` is destructive and would be blocked. Compensating migration: leave column in place, add a null-setting migration + code revert to stop writing it. Document this in the PR description.
- **Migration filenames.** Must match 14-digit convention `YYYYMMDDHHmm00N_<desc>.sql`. Phase 4 index, Phase 4 RPC, Phase 5 column, Phase 5 trigger-extension — four migrations total; sequence them correctly.
- **`generate-types` workflow** auto-runs on PR (CI line 142–181) after migration changes — regenerates `database.types.ts`. No manual step needed.

### Phase 7: Documentation + finalization

- [x] Update `evolution/docs/strategies_and_experiments.md` — document `sourceMode` + `qualityCutoff`.
- [x] Update `evolution/docs/agents/overview.md` — rename + dimension concept.
- [x] Update `evolution/docs/data_model.md` — `parent_variant_id` as parent + any new columns.
- [x] Update `docs/feature_deep_dives/multi_iteration_strategies.md` if it references the old agent name.
- [x] Add new deep dive `docs/feature_deep_dives/variant_lineage.md` — chain queries, diff rendering, attribution.

## Testing

Convention: unit/integration tests are **colocated** next to source (e.g., `resolveParent.ts` + `resolveParent.test.ts`, as existing `swissPairing.test.ts`, `runIterationLoop.test.ts` demonstrate). E2E specs live under `src/__tests__/e2e/specs/09-evolution-admin/` and must be tagged `@critical` to run in PR CI (see `.github/workflows/ci.yml` — `test:e2e:critical` job).

### Unit Tests (colocated)
- [x] `evolution/src/lib/pipeline/loop/resolveParent.test.ts` — seed + pool modes, cutoff variants, empty-pool fallback, seeded-RNG determinism (same tuple produces same pick; different executionOrder produces different pick).
- [x] `evolution/src/lib/pipeline/loop/cutoffHelpers.test.ts` — `computeTopNIds`, `computeTopPercentIds`, edge cases.
- [x] **Extend** existing `evolution/src/lib/schemas.test.ts` (or equivalent) with `iterationConfigSchema` refine coverage (sourceMode + qualityCutoff validity; first-iteration rule; backward-compat for configs missing sourceMode).
- [x] **Extend** existing `evolution/src/lib/shared/hashStrategyConfig.test.ts` with a case: `qualityCutoff.value` change yields a new strategy hash.
- [x] `evolution/src/lib/shared/ratingDelta.test.ts` — `bootstrapDeltaCI` returns expected point + CI against seeded-RNG fixtures; n=1 fallback returns null CI gracefully.
- [x] `evolution/src/components/evolution/variant/VariantParentBadge.test.tsx` — render parent ELO±uncertainty + Δ with CI; null-parent renders "Seed · no parent"; cross-run parent renders "(other run)"; `role='from'` renders "From/To" picker labels.
- [x] `evolution/src/lib/pipeline/finalize/persistLocalRankElo.test.ts` — discarded variants with non-null `execution_detail.ranking` persist `finalLocalElo`; early-exit (null ranking) falls back to defaults + `rankingFailed: true`.
- [x] `evolution/src/lib/metrics/eloDeltaAttribution.test.ts` — `computeInvocationEloDelta` + aggregation into `eloAttrDelta:<agent>:<dim>` + histogram buckets; NULL dimension excluded; parallel-dispatch determinism.
- [x] `evolution/src/lib/metrics/dynamicMetricPrefix.test.ts` — `isValidMetricName('eloAttrDelta:foo:bar')` AND `isValidMetricName('eloAttrDeltaHist:foo:-10:0')` both return true.
- [x] **Extend** existing `evolution/src/lib/core/Agent.test.ts` (or add) — `getAttributionDimension` returns null by default (swiss, merge, seed); overridden to return `detail.strategy` on `GenerateFromPreviousArticleAgent`.

### Integration Tests (colocated)
- [x] `evolution/src/lib/pipeline/finalize/poolSourcing.integration.test.ts` — full iteration with `sourceMode='pool'` picks from pool, writes `parent_variant_id` + `agent_invocation_id`.
- [x] `evolution/src/lib/metrics/attributionPipeline.integration.test.ts` — seeded run produces expected `eloAttrDelta:*` + `eloAttrDeltaHist:*` rows.
- [x] `evolution/src/lib/pipeline/finalize/variantInvocationLink.integration.test.ts` — every persisted variant from a `generateFromPreviousArticle` invocation has `agent_invocation_id` set; FK ordering (invocation rows inserted before variants) locked in.
- [x] `evolution/src/lib/pipeline/finalize/lineageCtesafety.integration.test.ts` — RPC `get_variant_full_chain` terminates on simulated cycle (via CYCLE clause) and on orphan (parent pointing to nonexistent variant) without infinite loop.

### E2E Tests (under `src/__tests__/e2e/specs/09-evolution-admin/`, all tagged `@critical`)
- [x] `variantLineageTab.spec.ts` — 3-hop chain renders full chain + consecutive-pair diffs + From/To arbitrary-pair picker.
- [x] `strategyEffectivenessChart.spec.ts` — run detail page shows strategy-breakdown bar chart + per-agent histogram.
- [x] `variantParentBadge.spec.ts` — Δ badge visible on variants page, VariantsTab, arena, variant detail header, `VariantCard`; null-parent seed renders "Seed · no parent".
- [x] `invocationDetailPrevious.spec.ts` — parent block + Raw-LLM collapsed section (from `llmCallTracking` JOIN) + lineage link on `generate_from_previous_article` invocation.

### E2E Fixture Extension
- [x] Add `evolutionMultiHopRunFixture` to `src/__tests__/e2e/fixtures/` seeding: a multi-hop run with variants, invocations, and `llmCallTracking` rows. Consumed by the 4 E2E specs above. Existing fixtures directory only contains auth fixtures today.

### Manual Verification
- [x] Create a strategy with `sourceMode: 'pool'` + `qualityCutoff: { mode: 'topN', value: 5 }` on iteration 2. Run it; confirm iteration 2 pulls from pool.
- [x] Open a variant with multi-hop ancestry; verify lineage tab shows all hops, consecutive diffs, and arbitrary-pair picker works.
- [x] Confirm Δ vs. parent column appears on all variant-display surfaces.
- [x] Open a discarded variant and confirm its delta badge shows a real (non-default) ELO.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Invocation detail page for a `generate_from_previous_article` invocation shows parent block, Raw-LLM collapsed section, and "View full lineage" link.
- [x] Strategy builder UI allows configuring `sourceMode` on non-first iterations.
- [x] Lineage tab renders full chain, consecutive-pair TextDiff between hops, *and* the arbitrary-pair node-picker diff control.
- [x] Δ vs. parent badge visible on: variants page, VariantsTab, arena page, variant detail header, `VariantCard`.
- [x] Strategy-effectiveness bar chart renders on run/strategy detail page.
- [x] Per-agent ELO-delta histogram renders with fixed 10-ELO buckets on run/strategy/experiment detail pages.

### B) Automated Tests
- [x] `npm run test` passes (unit + integration).
- [x] `npm run test:e2e` passes (selected critical specs above).
- [x] `npm run typecheck && npm run lint && npm run build`.

## Documentation Updates
- [x] `evolution/docs/strategies_and_experiments.md` — new iteration config fields.
- [x] `evolution/docs/agents/overview.md` — rename + `attributionDimensionKey`.
- [x] `evolution/docs/data_model.md` — `parent_variant_id` semantics + any new columns.
- [x] `evolution/docs/metrics.md` — new `eloAttrDelta:*` dynamic metric family.
- [x] `docs/feature_deep_dives/variant_lineage.md` (new) — lineage tab, diff tooling, recursive queries.
- [x] `docs/docs_overall/architecture.md` — brief mention if any top-level surface changes.

## Review & Discussion

_Populated by `/plan-review`._

## Resolved Questions

1. **Rename backfill:** no backfill. Historic `'generate_from_seed_article'` rows will be deleted after merge.
2. **Delta CI:** bootstrap via independent Normal sampling (matches existing `bootstrapMeanCI` pattern). Algebraically equivalent to `sqrt(σ_child² + σ_parent²)`. Conservative upper bound (child/parent ELOs positively correlated via shared reference frame → true SD likely smaller; joint posterior not exposed by the rating system). Caveat documented.
3. **Pool picking:** uniformly random within cutoff; RNG seeded by `(runId, iteration, executionOrder)` for reproducibility.
4. **First iteration:** `iterationConfigs[0].sourceMode` must be `'seed'` (or omitted, defaulting to seed).
5. **`agent_invocation_id`:** confirmed absent. Migration in Phase 5.
6. **Attribution dimensions:** single dimension per agent, typed method `getAttributionDimension(detail)`. `generateFromPreviousArticle` returns `detail.strategy`. Multi-dim is a future upgrade.
7. **Attribution visualizations:** (a) bar chart of mean ELO Δ per strategy (with CI whiskers); (b) per-agent histogram of ELO Δ distribution in fixed 10-ELO buckets.
8. **Discarded variants:** included in all metrics and badges. Local-rank ELO (from `finalLocalElo` in execution detail) is persisted instead of default ratings — no survivorship bias.
9. **Arbitrary-ancestor diff:** included in Phase 4. Node-picker control alongside consecutive-pair diffs.
10. **Invocation detail forensics:** collapsed "Raw LLM call" section (prompt + raw response + token counts + model/temperature).
11. **`reusedFromSeed`:** vestigial, left alone as out-of-scope tech debt.
