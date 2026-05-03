# Add Ranking to IterativeEditingAgent — Planning

## Background

The just-shipped `bring_back_editing_agents_evolution_20260430` project (PR #1020) ships `IterativeEditingAgent` with Decisions §14 explicitly forbidding arena ranking inside the agent ("editing emits ZERO `arena_comparisons` rows"). This was a deliberate v1 simplification — local ranking was deferred to a downstream `swiss` iteration.

This follow-up project revisits that decision. New editing variants currently land in the pool unranked; they don't surface until a later `swiss` iteration compares them. That delay is operationally awkward: dashboards show fresh editing variants with no Elo, dispatch decisions can't act on their relative quality, and the cost-attribution split between "edit cost" and "rank cost" stays opaque.

We follow the `rankNewVariant()` pattern that `GenerateFromPreviousArticleAgent` already uses, and that `ReflectAndGenerateFromPreviousArticleAgent` inherits transitively via inner-GFPA delegation. Per the 16-agent research synthesis, almost all of the infrastructure is reusable as-is.

This project also brings the broader editing feature out of dormancy: the parent project's `EDITING_AGENTS_ENABLED='false'` default is being flipped to `'true'`, landing editing+ranking together in production at merge time.

## Requirements (from user)

- Read the docs for iterative editing agent for evolution.
- Add ranking; follow the modular pattern of `generateFromPreviousArticle` and `reflectThenGenerateFromPreviousArticle`.
- Adjust all components of the agent, including invocation detail view, as needed.

## Problem

`IterativeEditingAgent` produces one final `Variant` per parent (Decisions §14) but never ranks it locally. As a result:

1. Newly-edited variants have no Elo until a Swiss iteration runs (could be 1+ iterations later, or never if editing is the terminal iteration).
2. Downstream iterations can't use editing outputs as inputs to "top-N" heuristics until they're ranked.
3. The agent's `iterative_edit_cost` metric is a single bucket; once we add ranking we need to surface ranking cost separately for operational visibility.
4. The invocation detail view has no `ranking` section, so the audit surface lacks parity with generate/reflect agents.

## Decisions Locked (from /plan-walkthrough Q&A)

### D1 — Surface/discard policy: Option A (mirror GFPA)
After ranking, if `rankResult.status === 'budget'` AND `localElo < computeTop15Cutoff(localRatings)`, the variant is marked `surfaced: false` and not inserted into the pool. `discardReason: { localElo, localTop15Cutoff }` is propagated. *Same policy as `GenerateFromPreviousArticleAgent`.*

**Risk to monitor in staging**: at small pool sizes (early iterations, pool ≤ 7) the top-15% cutoff equals the parent's elo, so any non-improvement under budget pressure gets discarded. Staging cycle measures discard-rate and we revisit if it's pathological.

### D2 — Duplicate arena rows: not a real risk
Each editing agent emits a unique new `Variant` (DB-assigned UUID) per parent. Each agent receives the iteration-start pool snapshot, not other agents' in-flight outputs. So `(variant_id, opponent_id, iteration)` rows are unique by construction. No `ON CONFLICT` clause needed.

### D3 — Cost decomposition: `editingRank` as peer field on `EstPerAgentValue`
Add `editingRank: number` peer field (mirroring how PR #1017 added `reflection`). Total formula becomes `total = gen + rank + reflection + editing + editingRank`. The dispatch wizard shows the breakdown explicitly so users see where their dollars go.

### D4 — `EDITING_RANK_ENABLED` default: `'true'`
Feature lands hot. Mirrors `EVOLUTION_REFLECTION_ENABLED` precedent with TWO explicit gate sites:

- **Runtime gate**: `runIterationLoop.ts` editing branch (around line 794, where `IterativeEditingAgent` is instantiated). Reads `process.env.EDITING_RANK_ENABLED !== 'false'`; if `'false'`, the dispatch passes empty/undefined rank-context fields (`initialPool`, `initialRatings`, `initialMatchCounts`, `cache`, `parentVariantId`) to `IterativeEditInput`. The agent's `execute()` then checks input-field presence and skips the rank call. *No env reads inside the agent itself* — keeps the agent env-agnostic, matching how `GenerateFromPreviousArticleAgent` works.
- **Planner gate**: `projectDispatchPlan.ts` accepts a new `editingRankEnabled?: boolean` option in `DispatchPlanOptions`. When `false`, `editingRank` is zeroed in the EstPerAgentValue. The boundary that resolves env → option lives in `evolution/src/services/strategyPreviewActions.ts` (alongside the existing `reflectionEnabled` resolution).

The flag exists as an emergency kill-switch, not a staged-rollout lever.

### D5 — Pre-rank budget guard: skip
Don't add an explicit `if (estimatedRankCost would blow budget) skipRanking` check before the ranking call. The 10% post-cycle budget headroom (~$0.005 at typical $0.05/invocation) is too small to fit ranking anyway — the check would fire "skip" almost always and create variants without rank data, undermining the always-on stance. Instead: rely on the outer try/catch + I3 partial-detail-on-throw if ranking truly blows the budget mid-comparison.

### D6 — `EDITING_AGENTS_ENABLED` default: flip to `'true'`
Scope expansion from the original ranking-only project: this project also reverses the parent project's dormant rollout. Editing + ranking land hot together. Consequence: the parent project's "Pre-flag-on rollout checklist" (50-strategy staging soak, calibrate operational thresholds, verify cost alerts) becomes a **pre-merge gate** for *this* project — that work runs in staging before merging the PR, not after.

### D7 — Final-output ranking only (architecturally enforced)
Only the single final variant emitted by `execute()` is ranked. Intermediate cycle outputs are not Variants (per §14, they live as `execution_detail.cycles[i].childText` strings only) so they cannot be ranked. The ranking call sits at line 351 — after the cycle loop ends — so there's exactly one ranking pass per invocation regardless of cycle count.

## Cost Rationale (Why This Project Has Real Cost Impact)

Editing per invocation is already expensive: 3 cycles × 2 LLM calls (Proposer + Approver), each processing the full article with 1.5×-per-cycle growth potential. ~$2.24 per invocation upper-bound at 3 cycles, 8K-char article, gpt-4.1-nano.

Adding ranking layers **30 judge LLM calls** per ranked variant on top (15 comparisons × 2 for bias mitigation), each call processing both articles fully (~16–24K chars input each). Total payload moved by ranking is **8–10× the input volume editing itself moves**.

The 100–400% per-invocation cost bump is real but bounded by levers the user already controls:
- `maxComparisonsPerVariant` (Q5 follow-up): caps ranking depth; lowering from 15 → 8 cuts ranking cost ~47%.
- `judgeModel`: nano-priced judge keeps the bump moderate; bumping to a flagship model is what makes it pathological.
- Pool size: ranking cost scales with `min(poolSize, maxComparisonsPerVariant)`, so early iterations (small pool) cost less.

The wizard's existing dispatch-cost preview already recalculates as the user changes these knobs. After D3 lands, `editingRank` becomes a separate line item in that preview, making the cost shock visible at strategy-design time rather than at runtime.

## Reuse-vs-New Ledger

| Surface | Reuse | New |
|---|---|---|
| `rankNewVariant`, `rankSingleVariant`, `computeTop15Cutoff` | ✓ | — |
| `MergeRatingsAgent` (already accepts `iterationType: 'iterative_editing'`) | ✓ | — |
| `'ranking'` cost-calibration phase (already in CHECK constraint) | ✓ | — |
| `rankNewVariantDetailInnerSchema` + `rankingDetailRenameKeys` | ✓ | — |
| `estimateRankingCost` helper | ✓ | — |
| `ConfigDrivenDetailRenderer` field types (`'object'`, `'table'`) | ✓ | — |
| Property tests (`parseProposedEdits`, `applyAcceptedGroups`) | ✓ unchanged | — |
| `IterativeEditInput` shape | extend | Add `initialPool`, `initialRatings`, `initialMatchCounts`, `cache`, `parentVariantId` (mirror `GenerateFromPreviousInput`) |
| `iterativeEditingExecutionDetailSchema` | extend | Optional/nullable `ranking` field (back-compat for old rows) |
| `EstPerAgentValue` | extend | New `editingRank` peer field |
| `DETAIL_VIEW_CONFIGS['iterative_editing']` | extend | 2 new entries (object + table) copying GFPA's ranking blocks |
| `runIterationLoop.ts` editing branch | extend | Thread inputs + populate match buffers (currently `[]` per §14) |
| `IterativeEditingAgent.execute()` | extend | New ranking call site at line 351 |
| `EDITING_RANK_ENABLED` env flag | — | New flag, default `'true'` (D4) |
| `iterative_edit_rank_cost` metric + 2 propagation metrics | — | New |
| Strategy wizard help text on `maxComparisonsPerVariant` | extend | Mention editing-rank in scope |
| E2E spec | flip | Reverse §14 assertion + add ranking-cost assertion |

## Phased Execution Plan

### Phase 1 — Schema + types
- [ ] **1.1** Extend `iterativeEditingExecutionDetailSchema` (`evolution/src/lib/schemas.ts:817`) with `ranking` field embedding `rankNewVariantDetailInnerSchema` extended with `cost` + `estimatedCost` (literal copy from GFPA's schema). **Use `.optional().nullable()`** — both modifiers are required: `.nullable()` allows `null`, `.optional()` allows the field to be absent entirely (back-compat for old DB rows that lack the column). Concrete shape:
   ```typescript
   ranking: z.preprocess(
     rankingDetailRenameKeys,
     rankNewVariantDetailInnerSchema.extend({
       cost: z.number().min(0),
       estimatedCost: z.number().min(0).optional(),
     }),
   ).optional().nullable(),  // optional() for missing-field rows, nullable() for explicitly-null rows
   ```
- [ ] **1.2** Mirror in `IterativeEditingExecutionDetail` TS type (`evolution/src/lib/types.ts`).
- [ ] **1.3** Extend `IterativeEditInput` (`evolution/src/lib/core/agents/editing/types.ts`) with **5 OPTIONAL fields** (`?:` modifier on each — required to support Phase 4.1's "omit fields when `editingRankEnabled === false`" pattern and Phase 2.3's input-presence gate):
   ```typescript
   initialPool?: ReadonlyArray<Variant>;
   initialRatings?: ReadonlyMap<string, Rating>;
   initialMatchCounts?: ReadonlyMap<string, number>;
   cache?: Map<string, ComparisonResult>;
   parentVariantId?: string;
   ```
   Diverges from `GenerateFromPreviousInput` (where these are required) because GFPA *always* ranks; editing can be configured off. The agent's input-presence gate (Phase 2.3) checks `input.initialPool === undefined` to decide whether to skip ranking.
- [ ] **1.4** Update `executionDetailFixtures.iterativeEditingDetailFixture` with realistic `ranking` block (1–2 comparisons, non-default elo).
- [ ] **1.5** Update `schemas.test.ts:1036` editing test case to include the ranking block.
- [ ] **1.6** Add `EDITING_RANK_ENABLED` env-resolution helper. New function `resolveEditingRankEnabled(env: NodeJS.ProcessEnv = process.env): boolean` in `evolution/src/lib/pipeline/loop/editingDispatch.ts` (alongside existing helpers). Returns `env.EDITING_RANK_ENABLED !== 'false'` (default-true semantics). Consumed by the runtime gate (Phase 4.1) and the planner-boundary resolver (Phase 3.3).

### Phase 2 — Agent ranking integration
- [ ] **2.1** Insert ranking call at `IterativeEditingAgent.ts:351` (after cycle loop terminates, before final-variant materialization). Snapshot `costBeforeRankingCall = ctx.costTracker.getOwnSpent?.() ?? 0` immediately before the call.
- [ ] **2.2** Pass `{ variant: finalVariant, localPool, localRatings, localMatchCounts, completedPairs, cache, llm: input.llm, config: ctx.config, invocationId: ctx.invocationId, logger: ctx.logger, costTracker: ctx.costTracker }` to `rankNewVariant`. Pull `localPool/localRatings/localMatchCounts/cache/parentVariantId` from `input` (which the runtime dispatch threads through per Phase 4.1).
- [ ] **2.3** **Input-presence gate, not env-read**: skip the rank call if `input.initialPool === undefined` (or any of the rank-context fields are absent). The agent itself does not read `process.env.EDITING_RANK_ENABLED` — that env-check happens at the dispatch site (Phase 4.1). Keeps the agent env-agnostic and matches GFPA's pattern (no env reads inside agent).
- [ ] **2.4** Surface `surfaced` boolean through `AgentOutput.result` (D1: copy GFPA's discard policy verbatim — `rankNewVariant` already returns the right shape). Also persist `surfaced` on `execution_detail` so the invocation detail page can render it as a yes/no badge.
- [ ] **2.5** Populate `detail.ranking = { ...rankResult.detail, cost: rankingCost, estimatedCost? }` and include `rankingCost` in `buildDetail()`'s `totalCost` sum.
   - **NOT in scope for v1**: persisting `discardReason: { localElo, localTop15Cutoff }` to `execution_detail`. GFPA only carries this in-memory on `AgentOutput.result`, not on the persisted detail. Matching GFPA preserves wrapper-pattern parity. Track as v1.1 follow-up if operators want "discarded — why?" visible on the invocation detail page.
- [ ] **2.6** Extend `IterativeEditOutput` (`evolution/src/lib/core/agents/editing/types.ts`, alongside `IterativeEditInput`) with `matches: ReadonlyArray<V2Match>` field. Agent populates from `rankResult.matches` (empty array if rank step skipped). Phase 4.2 consumes this in the dispatch loop's match-buffer collection.
- [ ] **2.7** Add new unit tests: "ranking runs when initialPool is present", "ranking is skipped when initialPool is absent (env-off path)", "ranking is skipped when no final variant emitted (all-rejected path)", "rankingCost lands on top-level execution_detail.ranking.cost", "discardReason populated on AgentOutput.result when surfaced=false", "matches array exposed on AgentOutput.result". Mock `compareWithBiasMitigation` (mirror GFPA test's queue-driven mock).
- [ ] **2.6** Add new unit tests: "ranking runs after cycle loop completes", "ranking is skipped when EDITING_RANK_ENABLED=false", "ranking is skipped when no final variant emitted (all-rejected path)", "rankingCost lands on top-level execution_detail.ranking.cost", "discardReason populated when surfaced=false". Mock `compareWithBiasMitigation` (mirror GFPA test's queue-driven mock).

### Phase 3 — Cost estimator + metrics
- [ ] **3.1** Update `estimateIterativeEditingCost` (`evolution/src/lib/pipeline/infra/estimateCosts.ts:312`) to add `+ estimateRankingCost(finalArticleChars, judgeModel, poolSize, maxComparisonsPerVariant)` to both `expected` and `upperBound`. Function already takes `judgeModel` so no signature change.
- [ ] **3.2** Add `editingRank: number` peer field to `EstPerAgentValue` (`projectDispatchPlan.ts:91`); update `total` formula.
- [ ] **3.3** Update `projectDispatchPlan.ts:367` editing branch:
   - Add `editingRankEnabled?: boolean` to `DispatchPlanOptions` (mirror existing `reflectionEnabled?: boolean`). Default treated as `true` when undefined.
   - In the editing iteration branch (around line 367, where `editCost` is computed and assigned), split the editing cost return:
     ```typescript
     const editingRankCost = (opts?.editingRankEnabled ?? true)
       ? estimateRankingCost(finalArticleChars, judgeModel, poolSize, maxComparisonsPerVariant)
       : 0;
     // ... then in the EstPerAgentValue construction ...
     expected: { gen: 0, rank: 0, reflection: 0, editing: editCost.expected, editingRank: editingRankCost.expected, total: editCost.expected + editingRankCost.expected },
     upperBound: { gen: 0, rank: 0, reflection: 0, editing: editCost.upperBound, editingRank: editingRankCost.upperBound, total: editCost.upperBound + editingRankCost.upperBound },
     ```
     (Mirrors how `reflectionEnabled === false` zeros `reflection` cost in the reflect-and-generate branch around line 393, 408.)
   - Boundary that resolves env → option: `evolution/src/services/strategyPreviewActions.ts` — call `resolveEditingRankEnabled(process.env)` from Phase 1.6 and pass into the `opts` argument, alongside the existing `reflectionEnabled` resolution.
- [ ] **3.4** Mirror `IterationPlanEntryClient` (`evolution/src/services/strategyPreviewActions.ts`) — add `editingRank` field to the client mirror (regression test caught a similar drift in PR #1020; this catches it again).
- [ ] **3.5** Add `iterative_edit_rank_cost` metric (live-written, mirror `ranking_cost`/`reflection_cost` patterns) in `evolution/src/lib/metrics/registry.ts` + `evolution/src/lib/core/metricCatalog.ts`.
- [ ] **3.6** Add 2 propagation metrics: `total_iterative_edit_rank_cost`, `avg_iterative_edit_rank_cost_per_run`. Update `RunEntity`, `StrategyEntity`, `ExperimentEntity`.
- [ ] **3.7** Bump `entities.test.ts` count assertions:
   - InvocationEntity execution metrics: 9 → **10** (adds `iterative_edit_rank_cost`).
   - StrategyEntity propagation metrics: 35 → **37** (adds 2: `total_iterative_edit_rank_cost` + `avg_iterative_edit_rank_cost_per_run`).
   - ExperimentEntity propagation: same +2 bump as StrategyEntity (verify expected count in test and update accordingly).
   - RunEntity execution metrics: same +1 bump as InvocationEntity.
- [ ] **3.8** Add unit test "estimateIterativeEditingCost includes ranking cost delta" + "upperBound covers ranking worst-case".

### Phase 4 — Pipeline integration
- [ ] **4.1** Update `runIterationLoop.ts:814` editing dispatch site to pass new fields. **Runtime gate lives here**: at the top of the editing branch, call `const editingRankEnabled = resolveEditingRankEnabled(process.env)` (helper from Phase 1.6). When `editingRankEnabled === true`, pass `initialPool`, `initialRatings`, `initialMatchCounts`, `cache`, `parentVariantId` to each `IterativeEditingAgent`'s input (mirror generate-branch lines 513–522). When `false`, omit those fields — the agent's input-presence gate (Phase 2.3) then skips ranking.
- [ ] **4.2** Replace `editingMatchBuffers: []` (line 796) with collection logic mirroring generate-branch line 561: `editingMatchBuffers.push(out.matches.map((m) => ({ match: m, idA: m.winnerId, idB: m.loserId })))`. Reads `out.matches` from the new field on `IterativeEditOutput` (Phase 2.6).
- [ ] **4.3** Confirm `MergeRatingsAgent` already handles non-empty buffers for `iterationType: 'iterative_editing'` (it does — widened in PR #1020).
- [ ] **4.4** Flip `EDITING_AGENTS_ENABLED` default to `'true'` (D6) — find every place this is read (`runIterationLoop.ts:760`, etc.) and update the default-via-env-check semantics.
- [ ] **4.5** Add integration test: extend `evolution-iterative-editing-agent.integration.test.ts` with `rankingResponses: [...]` mock + assertion that editing-born variants have non-default Elo post-run.
- [ ] **4.6** Add integration test for `MergeRatingsAgent.test.ts`: `iterationType: 'iterative_editing'` with non-empty match buffers → arena_comparisons rows written.
- [ ] **4.7** Update `strategy-preview-dispatch.integration.test.ts:149`: `expectedKeys` from `['editing', 'gen', 'rank', 'reflection', 'total']` → `['editing', 'editingRank', 'gen', 'rank', 'reflection', 'total']`.

### Phase 5 — Invocation detail UI + Wizard
- [ ] **5.1** Update `DETAIL_VIEW_CONFIGS['iterative_editing']` (`evolution/src/lib/core/detailViewConfigs.ts:240`):
   - Insert `surfaced` boolean field after `finalVariantId` (line 242).
   - Insert ranking object + comparisons table entries between `cycles.0` annotated-edits (line 277) and `totalCost` (line 278). Literal copy of GFPA's ranking blocks (lines 50–75 in same file).
   - Concrete diff:
     ```diff
        iterative_editing: [
          { key: 'parentVariantId', label: 'Parent Variant', type: 'text' },
          { key: 'finalVariantId', label: 'Final Variant', type: 'text' },
     +    { key: 'surfaced', label: 'Surfaced', type: 'boolean' },
          { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
          ...
          { key: 'cycles.0', label: 'Annotated Edits (Cycle 1)', type: 'annotated-edits', ... },
     +    {
     +      key: 'ranking', label: 'Ranking (binary search local view)', type: 'object',
     +      children: [
     +        { key: 'cost', label: 'Ranking Cost', type: 'number', formatter: 'cost' },
     +        { key: 'localPoolSize', label: 'Local Pool Size', type: 'number' },
     +        { key: 'initialTop15Cutoff', label: 'Initial Top-15% Cutoff', type: 'number' },
     +        { key: 'stopReason', label: 'Stop Reason', type: 'badge' },
     +        { key: 'totalComparisons', label: 'Total Comparisons', type: 'number' },
     +        { key: 'finalLocalElo', label: 'Final Local Elo', type: 'number' },
     +        { key: 'finalLocalUncertainty', label: 'Final Local Uncertainty', type: 'number' },
     +        { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
     +      ],
     +    },
     +    {
     +      key: 'ranking.comparisons', label: 'Comparisons', type: 'table',
     +      columns: [
     +        { key: 'round', label: '#' },
     +        { key: 'opponentId', label: 'Opponent' },
     +        { key: 'selectionScore', label: 'Score' },
     +        { key: 'pWin', label: 'pWin' },
     +        { key: 'outcome', label: 'Out' },
     +        { key: 'variantEloAfter', label: 'Elo after' },
     +        { key: 'variantUncertaintyAfter', label: 'Uncertainty after' },
     +        { key: 'durationMs', label: 'ms' },
     +      ],
     +    },
          { key: 'totalCost', label: 'Total Cost', type: 'number', formatter: 'cost' },
        ],
     ```
   - Renderer (`ConfigDrivenDetailRenderer.tsx`) handles `'object'` + `'table'` + `'boolean'` already → **NO renderer changes**.
- [ ] **5.2** Mirror the same ranking blocks (and `surfaced` field) in `IterativeEditingAgent.detailViewConfig` class-level field. Then add an explicit assertion to `evolution/src/lib/core/entities/entities.test.ts` parity test: `expect(IterativeEditingAgent.detailViewConfig).toEqual(DETAIL_VIEW_CONFIGS['iterative_editing'])` so any future drift between the two surfaces fails CI immediately. (PR #1020 added similar parity for GFPA and Reflect; this just extends the pattern to editing.)
- [ ] **5.3** Add new test cases to `evolution-iterative-editing-ui.integration.test.tsx`: "renders `surfaced` boolean field", "renders the ranking object block with cost/poolSize/stopReason fields", "renders the ranking.comparisons table with 8 column headers", "renders ranking section as omitted when no final variant emitted (all-rejected path)".
- [ ] **5.4** Update strategy wizard help text on `maxComparisonsPerVariant` (Step 1) — mention that this also caps editing-rank depth.
- [ ] **5.5** Verify dispatch preview's cost projection recomputes `editingRank` when `maxComparisonsPerVariant` changes (should be automatic — same plumbing as `gen.rank`).

### Phase 6 — E2E spec + docs + finalize
- [ ] **6.1** Update `admin-evolution-iterative-editing.spec.ts`:
   - **FLIP** the §14 assertion: "ZERO arena_comparisons rows" → ">=1 row per surfaced editing variant".
   - **ADD**: editing-born variants have non-default mu after run; `iterative_edit_rank_cost` metric > 0.
   - Wizard tests unaffected.
   - Keep `setTimeout(360_000)` — ranking adds ~10–20s at nano speed.
- [ ] **6.2** Update `docs/feature_deep_dives/editing_agents.md`:
   - Algorithm gets step 6: "Rank final variant via `rankNewVariant()`". *(Drafted during planning — commit `afbe52db`.)*
   - Cost tracking gets the new ranking line + `iterative_edit_rank_cost` metric + 4-layer cost-anatomy section + cost-knobs table. *(Drafted during planning — commit `afbe52db`.)*
   - Kill switches list updated with `EDITING_RANK_ENABLED` + new `EDITING_AGENTS_ENABLED` default. *(Drafted during planning — commit `afbe52db`.)*
   - Still pending: Decisions §14 supersession note (deferred until parent project's planning doc is updated in 6.5).
- [ ] **6.3** Update `evolution/docs/agents/overview.md` if helper extraction changes the agent surface.
- [ ] **6.4** Update `evolution/docs/reference.md` with the new `EDITING_RANK_ENABLED` env var.
- [ ] **6.5** Append "Decisions §14 superseded by `add_ranking_iterative_editing_agent_evolution_20260502`" note to the parent project's planning doc (line ~46-60 of `bring_back_editing_agents_evolution_20260430_planning.md`).
- [ ] **6.6** Update `.github/workflows/ci.yml` evolution-integration job env block: add `EDITING_RANK_ENABLED: 'true'` alongside the existing `EDITING_AGENTS_ENABLED: 'true'` (parent project's Phase 6.9 set this pattern). Makes the kill-switch explicit at CI scope so accidentally-disabled-in-staging doesn't ship green checks.
- [ ] **6.7** Run `/finalize`.

### Phase 7 — Pre-merge staging calibration (D6 consequence)
Since `EDITING_AGENTS_ENABLED` flips to `'true'` at merge (no separate flag-flip event), the parent project's pre-flag-on checklist runs as a pre-merge gate for *this* project:

- [ ] **7.1** Run 50 shadow-deploy strategies in staging covering the editing-strategy mix (1×gen+1×edit, 2×gen+1×edit, 1×gen+1×edit+1×swiss, edit-terminal, edit-with-swiss-following).
- [ ] **7.2** Measure actual per-invocation rank cost distribution (p50, p95, p99). Compare against `estimateIterativeEditingCost`'s upper-bound; tighten `EXPECTED_RANK_COMPARISONS_RATIO` if delta >10%.
- [ ] **7.3** Measure operational health metric baselines:
   - `iterative_edit_drift_rate` — confirm < 0.30 threshold
   - `iterative_edit_recovery_success_rate` — confirm > 0.70 threshold
   - `iterative_edit_accept_rate` — confirm < 0.95 threshold
   - **NEW**: editing-rank discard rate (% of surfaced=false variants under D1's policy) — record baseline; alert if >50% in any single strategy run (small-pool collapse early-warning).
- [ ] **7.4** Verify dispatch-plan accuracy: predicted `editing + editingRank` upper-bound ≥ actual spend with <5% overage.
- [ ] **7.5** Run E2E `admin-evolution-iterative-editing.spec.ts` end-to-end against staging; confirm flipped §14 assertion passes.
- [ ] **7.6** If any of 7.1–7.5 fails, treat as blocker — fix and re-run before merge.

## Testing

### Unit Tests
- `IterativeEditingAgent.test.ts` — 5 new cases (Phase 2.6).
- `estimateCosts.test.ts` — 2 new cases (Phase 3.8).
- `MergeRatingsAgent.test.ts` — 1 new case for `iterationType: 'iterative_editing'` non-empty buffers (Phase 4.6).
- `entities.test.ts` — count assertions bumped (Phase 3.7).
- `Agent.test.ts` parity test — add `IterativeEditingAgent.detailViewConfig` non-empty assertion.

### Integration Tests
- `evolution-iterative-editing-agent.integration.test.ts` — extend with rankingResponses + post-run Elo assertion (Phase 4.5).
- `evolution-iterative-editing-ui.integration.test.tsx` — render assertions for new ranking section (Phase 5.3).
- `strategy-preview-dispatch.integration.test.ts` — update expected keys (Phase 4.7).
- `evolution-startup-assertion-check.integration.test.ts` — NO change (`'ranking'` phase already in CHECK).

### E2E Tests
- `admin-evolution-iterative-editing.spec.ts` — flip §14 assertion + add ranking assertions (Phase 6.1). Tagged `@evolution`, runs in production E2E.

### Manual Verification
Real-LLM run of an editing strategy in staging; confirm via admin UI:
- Editing iteration's invocation detail page shows the new ranking section with comparisons table populated.
- Editing-born variants display Elo badges in the runs/variants list.
- Dispatch preview in strategy wizard shows `editingRank` cost line item, recalculates as `maxComparisonsPerVariant` is adjusted.

## Verification

### A) Playwright Verification
- `admin-evolution-iterative-editing.spec.ts` (post-Phase 6.1)
- Visual check on invocation detail page (Phase 5.3 covers via RTL; manual spot-check in staging)
- Wizard cost preview live-update on `maxComparisonsPerVariant` slider (Phase 5.5)

### B) Automated Tests
All unit + integration + E2E enumerated above. Pre-merge gate runs full check list (lint, tsc, build, unit, ESM, integration, E2E critical, E2E evolution).

## Documentation Updates

- `docs/feature_deep_dives/editing_agents.md` (Phase 6.2)
- `evolution/docs/agents/overview.md` (Phase 6.3, conditional)
- `evolution/docs/reference.md` (Phase 6.4 — `EDITING_RANK_ENABLED`)
- Parent project planning doc — supersession note for §14 (Phase 6.5)

## Risk Register

| Risk | Mitigation |
|---|---|
| Cost shock breaks parallel dispatch | D3 (peer field) makes cost visible in wizard preview. Phase 7 staging cycle calibrates estimator before merge. |
| Small-pool top-15% cutoff collapses to "discard unless improved" (D1) | Phase 7.3 measures discard rate baseline; alert if pathological in any single run. |
| `EDITING_AGENTS_ENABLED='true'` default exposes parent project's untested operational behavior in production | Phase 7 pre-merge staging cycle is the safety net. Treat any 7.1–7.5 failure as merge blocker. |
| Schema drift between `IterativeEditingAgent.detailViewConfig` and `DETAIL_VIEW_CONFIGS['iterative_editing']` | `entities.test.ts` parity test catches drift at CI. |
| Old detail rows missing `ranking` field break parsing | Schema makes `ranking` optional/nullable (Phase 1.1). |
| `IterationPlanEntryClient` mirror drift (PR #1017 hit this) | Phase 3.4 explicitly mirrors `editingRank`; Phase 4.7 regression test guards. |

## Rollout / Rollback

### Deploy order
1. Migrations: NO new migrations needed.
2. Code: lands together. Editing already on (D6); ranking auto-runs (D4).
3. Pre-merge staging cycle (Phase 7) is the gate.

### Rollback model
- `EDITING_RANK_ENABLED='false'` — disables ranking only; editing still runs but emits no arena_comparisons (regress to v1 behavior).
- `EDITING_AGENTS_ENABLED='false'` — disables editing entirely (and ranking with it).
- Both flags independent; either can be flipped without code revert. No DB downgrade path needed.

### Forward-only constraint
The Phase 1.6 startup assertion (parent project) still gates the agent registry. No new phase strings introduced; `'ranking'` already in CHECK.

## Deferred (Known v1.1 Follow-ups)

Surfaced during planning but explicitly out of scope for v1:

- **Persist `discardReason` to `execution_detail`**. GFPA currently only carries `discardReason: { localElo, localTop15Cutoff }` on the in-memory `AgentOutput.result` — it isn't on the persisted `execution_detail.ranking` blob. The invocation detail page can show `surfaced: false` but cannot show *why*. Mirror GFPA's gap for v1; revisit if operators say they want the reason visible. (Same fix would apply to GFPA — single shared change rather than editing-only.)
- **Per-cycle ranking timeline UI**. Today's plan ranks only the final variant. A future iteration could rank intermediate cycle outputs and surface a "cycle 1 elo → cycle 2 elo → cycle 3 elo" trajectory in the invocation detail. Cost-prohibitive at default settings (~3× the current ranking cost).
- **Discard-policy alternatives** (D1 follow-up). If staging shows the GFPA-style top-15% policy collapses pathologically at small pools (>50% discard rate), revisit Option C: "discard only if elo < parent's elo". Requires post-ranking inspection of parent vs new-variant elo, which the current `rankNewVariant` interface doesn't expose cleanly.
- **Per-cycle annotated-edits view for cycles 2+**. Today's `cycles.0` annotated-edits entry only renders cycle 1. Multi-cycle runs lose visibility into what happened in later cycles. Already noted in `detailViewConfigs.ts` line 268 as a future-iteration item.

## Review & Discussion

(To be filled during /plan-review iterations.)
