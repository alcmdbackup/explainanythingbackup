# Develop Reflection and GenerateFromParentArticle Agent Evolution Plan

## Background
Add a new evolution-pipeline agent `ReflectAndGenerateFromPreviousArticleAgent` that runs ONE reflection LLM call before delegating to the existing `GenerateFromPreviousArticleAgent` (GFPA). The reflection step receives the parent article + all 24 tactics (with compressed summaries + recent ELO-boost stats) in a randomized order, and returns a ranked list of top-N tactics with per-tactic reasoning. The wrapper executes as ONE invocation row covering the whole reflect+generate+rank flow with unified cost attribution. UI surfaces (Invocation detail tabs, Timeline, Logs) extend cleanly to display reflection alongside the existing GFPA detail. The wrapper agent's existence is opt-in per generate iteration via a new `iterationConfig.useReflection` flag.

## Requirements (from GH Issue #NNN)
- Overview
    - This will be a new agent type
    - This will add a new reflection step in from of generateFromPreviousArticle
    - Please extend our existing agent code to make this code as much as possible
    - Re-use existing generateFromPreviousArticle in a modular way as much as possible
- Prompt
    - Read the existing parent
    - Pass in existing list of tactics, a brief summary of each, and the relative elo boosts of each based on performance data
        - Randomize the order with which tactics are passed in to prevent positional bias
    - Pick the best tactic to apply
- Pick the best tactic to use
    - Configurable input for # of tactics to try to apply
- Then call generateFromPreviousArticle

How should this work?

- All of this will be one agent, called reflectAndGenerateFromPreviousArticle
- Lightly modify same re-usable components for invocation details - see below for details

Existing details overview

- Reflection Overview - separate tab for reflection portion
- GenerateFromPreviousArticle Overview - re-use the existing tab for generateFromPreviousArticle
- Metrics - no change, only generateFromPreviousArticle produces metrics anyway
- Timeline - show additional calls used by reflection
- Logs - show logs from both

## Problem
The current evolution pipeline picks tactics for `GenerateFromPreviousArticleAgent` externally — round-robin (default) or weighted-random via `generationGuidance`. Both ignore the parent article's content when choosing a tactic; both ignore historical performance data. There is no LLM-mediated selection mechanism. We want to test whether asking an LLM to pick the tactic — given the parent text and recent ELO performance per tactic — produces better variants. Building this requires composing a reflection step in front of the existing generation flow without forking the GFPA implementation, while preserving the user's ability to opt in per iteration. Several latent gaps in the framework also surface: the invocation-detail LogsTab is empty for all agents today (run-level logger reused), and the metrics aggregator hardcodes a field path instead of calling the `getAttributionDimension` override the base class declares.

## Resolved Decisions (from Research Phase)
1. Default to **all 24 tactics** every reflection call. No `reflectionTacticCount` cap. Compressed 1–2 sentence summaries via new `getTacticSummary(name)` helper distilled from `TacticDef.preamble + first sentence of instructions`.
2. `useReflection` and `generationGuidance` are **mutually exclusive** per iteration — Zod refinement + UI enforcement.
3. **Framework-level logger fix in scope**: `Agent.run()` builds invocation-scoped logger; passes via `extendedCtx.logger` and to `EvolutionLLMClient`. Retroactively populates LogsTab for all agents.
4. Reflection returns **ranked top-N with per-tactic reasoning**. New `IterationConfig.reflectionTopN?: number` (1–10, default 3). Today consumes only `tacticRanking[0]`; tail preserved for future multi-tactic generation.
5. **Aggregator cleanup in scope**: `computeEloAttributionMetrics` migrated to dispatch via `agent.getAttributionDimension(detail)` registry lookup. Zero user-facing change; pure architecture.
6. **No deterministic fallback** on failure. Reflection LLM throw or parser yielding zero valid tactics → invocation row marked `success=false`. Partial `execution_detail` (candidates presented + raw LLM response) preserved for debugging.

## Options Considered

### Integration shape — how the new agent enters the iterationConfig
- [ ] **Option A: New `agentType: 'reflect_and_generate'` enum value**: cleanest enum, explicit. Requires updating dispatch switch + first-iter validation refinement. Forces user choice between vanilla generate and reflect-generate at config time.
- [x] **Option B: `useReflection: boolean` flag on existing `agentType: 'generate'`** *(chosen)*: minimal schema disruption (one optional bool + one optional number), backward compatible, dispatch dispatch is a one-line conditional in `runIterationLoop`. Couples reflection to generate iterations, which matches the actual semantics (reflection is a generation augmentation). Composes with existing generate-only validations (sourceMode, qualityCutoff).
- [ ] **Option C: Strategy-level setting + per-iteration override**: more flexible, but adds complexity for negligible gain. Two-level cascade is harder to reason about.

### Tactic candidate-list size policy
- [x] **All 24 tactics every call** *(chosen)*: prompt-size cost is negligible (~$0.0005/call delta), LLM gets fullest signal, `generationGuidance` mutual exclusivity already covers the "narrow my choices" use case for non-reflection iterations.
- [ ] Capped at K (with K-of-24 selection policy): introduces an additional design knob (uniform vs ELO-weighted sampling), adds complexity to no observable benefit.

### Inner GFPA invocation pattern
- [x] **Direct `.execute()` call on a `GenerateFromPreviousArticleAgent` instance** *(chosen)*: avoids creating a nested `Agent.run()` scope which would split cost attribution. All LLM calls share the wrapper's `AgentCostScope`.
- [ ] Extract a shared helper `runGenerateAndRankPhase(input, ctx, tactic)` that both GFPA's `execute()` and the wrapper call: cleaner if either path is likely to evolve. Current scope: prefer minimal change unless proven necessary.
- [ ] Inner `.run()` call: rejected — creates nested scope, splits cost, breaks attribution invariant.

## Phased Execution Plan

### Phase 1: Schema & Cost-Stack Foundation
Foundation layer — new types, constants, and Zod schemas. No runtime behavior changes yet.

**Cost-stack changes**:

- [ ] Add `'reflection'` to `AGENT_NAMES` in `evolution/src/lib/core/agentNames.ts`
- [ ] Add `'reflection_cost'` to `COST_METRIC_BY_AGENT` mapping in `evolution/src/lib/core/agentNames.ts`
- [ ] Add `'reflection_cost'`, `'total_reflection_cost'`, and `'avg_reflection_cost_per_run'` ALL THREE to `STATIC_METRIC_NAMES` in `evolution/src/lib/metrics/types.ts` (the propagation registry validates `metric_name` against this list at write time, so missing the propagated names will fail compile-time `MetricName` checks AND runtime metric writes)
- [ ] Add `'reflection'` value to phase enum in `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts:24`
- [ ] **Add `'reflection'` branch to the calibration-lookup ladder in `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:91-95`** — without this branch, calibrated estimates are never queried for reflection calls and `OUTPUT_TOKEN_ESTIMATES.reflection` becomes the only source even when `COST_CALIBRATION_ENABLED='true'`.
- [ ] Add `OUTPUT_TOKEN_ESTIMATES.reflection = 600` in `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts:33-36`. Unit is **tokens** (consistent with sibling entries `generation: 1000`, `ranking: 100`). Reasoning: top-3 ranked output × ~200 tokens reasoning each ≈ 600 tokens (~2400 chars). Adjust comment to reflect token unit.
- [ ] Add propagation metric defs (`total_reflection_cost`, `avg_reflection_cost_per_run`) to `SHARED_PROPAGATION_DEFS` in `evolution/src/lib/metrics/registry.ts`
- [ ] Update `EstPerAgentValue` interface in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts:68-72`: add `reflection: number` field

**Kill-switch / feature flag**:

- [ ] Define new env var `EVOLUTION_REFLECTION_ENABLED` (default `'true'`). When set to exact string `'false'`, the orchestrator falls back to vanilla GFPA dispatch even when `iterCfg.useReflection === true`. Document in `evolution/docs/reference.md` Kill Switches table alongside `EVOLUTION_TOPUP_ENABLED`. The check site is `runIterationLoop.ts` per Phase 7 — before constructing the wrapper agent, gate on `process.env.EVOLUTION_REFLECTION_ENABLED !== 'false'`.

**Schema additions**:

- [ ] Extend `iterationConfigSchema` in `evolution/src/lib/schemas.ts:402-425`:
  ```typescript
  useReflection: z.boolean().optional(),
  reflectionTopN: z.number().int().min(1).max(10).optional(),
  ```
- [ ] Add Zod refinements (full matrix — must cover ALL invalid combinations):
  - `useReflection` only valid when `agentType === 'generate'` (rejects on swiss)
  - `reflectionTopN` only valid when `useReflection === true` (rejects when reflection disabled)
  - `useReflection === true` cannot coexist with `generationGuidance` (mutual exclusivity)
- [ ] Add new `reflectAndGenerateFromPreviousArticleExecutionDetailSchema` in `evolution/src/lib/schemas.ts` — extends `executionDetailBaseSchema`. Each sub-object (`reflection`, `generation`, `ranking`) is **individually optional** so partial-failure rows validate. **Also add the new schema to the discriminated `agentExecutionDetailSchema` union at `evolution/src/lib/schemas.ts:1107-1123`** — without this, type-narrowed UI consumers (e.g., the renderer's discriminator on `detailType`) won't accept the new variant. The schema includes:
  ```typescript
  reflection: z.object({
    candidatesPresented: z.array(z.string()),
    tacticRanking: z.array(z.object({ tactic: z.string(), reasoning: z.string() })),
    tacticChosen: z.string(),
    rawResponse: z.string().optional(),    // preserved on parser failure for debugging
    parseError: z.string().optional(),     // populated when parser threw
    durationMs: z.number().int().min(0).optional(),
    cost: z.number().min(0).optional(),
  }).optional(),
  generation: <reuse GFPA's existing shape>.optional(),
  ranking: <reuse GFPA's existing shape>.nullable().optional(),
  tactic: z.string(),                       // top-level for query convenience
  totalCost: z.number().min(0),             // sum of reflection + generation + ranking
  estimatedTotalCost: z.number().min(0).optional(),
  estimationErrorPct: z.number().optional(),
  surfaced: z.boolean(),
  discardReason: ... .optional(),
  ```

**Hash canonicalization** (prevents existing-strategy hash drift):

- [ ] Update `hashStrategyConfig()` in `evolution/src/lib/shared/hashStrategyConfig.ts` to **strip falsy optional fields** before serializing the input. Specifically: for each optional boolean field on iterationConfig (`useReflection`, etc.), if the value is `undefined` or `false`, remove it from the object before stringifying. This guarantees `{useReflection: undefined}`, `{useReflection: false}`, and `{}` all produce the same hash. New optional number fields (`reflectionTopN`) follow the same rule (strip if `undefined`). Document the canonicalization rule in a comment on the function.
- [ ] **Backward-compat hash regression test** in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts`: snapshot a list of representative existing strategy configs (no reflection fields), assert their hashes are byte-identical pre/post Phase 1 schema additions. If anything changes, the test fails and prevents accidentally re-hashing all production strategies.

**Fixture migration** (avoids broken CI on Phase 1 ship):

- [ ] Update the following test-fixture files to include the new optional fields (default to undefined / absent):
  - `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — `makeConfig()` helper iteration-config fixtures
  - `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` — strategy-config fixtures
  - `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — hash input fixtures (add new positive cases for reflection variants)
  - `evolution/src/lib/core/agents/generateFromPreviousArticle.test.ts` — keep unchanged (GFPA tests don't touch new fields)
  - `evolution/src/testing/evolution-test-helpers.ts` — `createTestStrategyConfig()`, `createMockExecutionContext()` (any hardcoded iterationConfigs)
  - `src/app/admin/evolution/_components/ExperimentForm.test.tsx` — STRATEGIES array fixtures
  - `evolution/src/services/strategyRegistryActions.test.ts` — create/update mocks
  - `evolution/src/services/experimentActions.test.ts` — strategy mocks
  - `evolution/src/lib/schemas.test.ts` — extend with full refinement matrix (see Testing section)
  - `evolution/src/testing/executionDetailFixtures.ts` — add `reflectAndGenerateFromPreviousArticleDetailFixture` with realistic shape including reasoning text
  - E2E seed-data scripts (search `src/__tests__/e2e/fixtures/` and `evolution/src/__tests__/integration/`) for any strategy-config seed JSON
- [ ] Run lint, tsc, build, unit after each schema change

### Phase 2: Framework Logger Fix
Make the invocation-scoped logger available so all agents (existing + new) write to the right entity.

**AgentContext extension**:

- [ ] Audit `AgentContext` in `evolution/src/lib/core/types.ts:137-178`. Per direct verification, `db: SupabaseClient` is **ALREADY** on `AgentContext` (line 138) — do NOT add a duplicate. Only `experimentId` and `strategyId` are net-new. Add as optional fields:
  ```typescript
  experimentId?: string;
  strategyId?: string;
  ```
- [ ] In `evolution/src/lib/pipeline/setup/buildRunContext.ts`, populate the new fields when building the run-level `AgentContext`. Source: `claimedRun.experiment_id`, `claimedRun.strategy_id`. (`db` is already populated.)

**Fix `updateInvocation` to support true partial updates** (load-bearing for Phase 6's wrapper error handling):

- [ ] Modify `evolution/src/lib/pipeline/infra/trackInvocations.ts:74` so `execution_detail` is only included in the SQL UPDATE when explicitly provided in the `updates` argument. Today it writes `execution_detail: updates.execution_detail ?? null` — which OVERWRITES any previously-written detail with null when callers omit the field. Replace with the conditional-spread pattern already used by `duration_ms` and `variant_surfaced` on lines 76-77:
  ```typescript
  // Before (line 74):
  execution_detail: updates.execution_detail ?? null,
  // After (replace as conditional spread):
  ...(updates.execution_detail !== undefined && { execution_detail: updates.execution_detail }),
  ```
  Apply the same fix to `error_message` (line 75) for symmetry — `Agent.run()`'s success path doesn't pass `error_message`, so the current code clobbers any previously-written error to null. Less critical, but keeps the API uniform.
- [ ] Add unit test in `evolution/src/lib/pipeline/infra/trackInvocations.test.ts`:
  - Sub-case 1 (`execution_detail` partial-update): setup row with `execution_detail = {foo: 1}`. Call `updateInvocation(db, id, {cost_usd: 0.01, success: true})` — `execution_detail` OMITTED. Assert post-update row has `execution_detail = {foo: 1}` (NOT null).
  - Sub-case 1 inverse: call `updateInvocation(db, id, {execution_detail: {bar: 2}, ...})` — assert overwritten to `{bar: 2}`.
  - **Sub-case 2 (`error_message` partial-update — symmetric to sub-case 1)**: setup row with `error_message = 'previous error'`. Call `updateInvocation(db, id, {cost_usd: 0.01, success: true})` — `error_message` OMITTED. Assert post-update row has `error_message = 'previous error'` (NOT null), proving the symmetric clobber fix on line 75.
  - Sub-case 2 inverse: call `updateInvocation(db, id, {error_message: 'new error', ...})` — assert overwritten to `'new error'`.

**runIterationLoop AgentContext call-site enumeration** (THIS IS THE INVASIVE PART):

There are **4+ AgentContext literal constructions** in `runIterationLoop.ts` that build `ctxForAgent` for individual agent dispatches. Each must propagate `experimentId`, `strategyId`, `db` from the parent `agentContext`. Verified call sites:

- [ ] `runIterationLoop.ts:414` — parallel-batch generate dispatch (`dispatchOneAgent` closure)
- [ ] `runIterationLoop.ts:600` — MergeRatingsAgent dispatch (generate iteration end)
- [ ] `runIterationLoop.ts:666` — SwissRankingAgent dispatch
- [ ] `runIterationLoop.ts:693` — MergeRatingsAgent dispatch (swiss iteration end)
- [ ] `claimAndExecuteRun.ts:291` — `seedCtx` for `CreateSeedArticleAgent` dispatch (NEW — pre-iteration seed phase). Without this 5th site, seed-phase invocation logger writes null for `experiment_id`/`strategy_id` denormalized FKs and the LogsTab on a seed invocation page won't aggregate by experiment/strategy.
- [ ] (Search the file for `costTracker:` to confirm the full set; flag any missed sites with grep `\bctxForAgent\b\|\bAgentContext\b` inside this file)

Each call site spreads the parent `agentContext` AND adds per-dispatch fields. After Phase 2, each must also pass `experimentId`, `strategyId`, `db` (typically these are already in the spread; verify nothing is dropped).

**Agent.run() changes**:

- [ ] In `evolution/src/lib/core/Agent.ts`, after `invocationId` creation (line 52-55), build:
  ```typescript
  const invocationLogger = invocationId && ctx.db
    ? createEntityLogger({
        entityType: 'invocation',
        entityId: invocationId,
        runId: ctx.runId,
        experimentId: ctx.experimentId,
        strategyId: ctx.strategyId,
      }, ctx.db)
    : ctx.logger;
  ```
  Falls back to `ctx.logger` when invocation creation failed OR `ctx.db` is not in scope (test environments without a real Supabase client).
- [ ] Update `extendedCtx` (line 60-61) to use `invocationLogger`.
- [ ] Pass `invocationLogger` to `createEvolutionLLMClient(...)` instead of `ctx.logger` (line 73).
- [ ] Keep run-level lifecycle logs (start/complete/error at lines 81, 126, 141) on `ctx.logger`.

**Backward-compat verification**:

- [ ] Verify with grep: zero existing test assertions on the message strings of `ctx.logger.warn()` calls inside `generateFromPreviousArticle.ts:207`, `MergeRatingsAgent`, `SwissRankingAgent`, `CreateSeedArticleAgent`. Search:
  ```bash
  grep -rn "format validation failed" evolution/ src/__tests__/
  grep -rn "MergeRatings.*warn\|SwissRanking.*warn\|CreateSeed.*warn" evolution/ src/__tests__/
  ```
- [ ] **Production-dashboard query audit** (NEW): grep production code (not tests) for queries against `evolution_logs` that filter on `entity_type='run'` (strict). Path: `src/app/admin/evolution/`, `evolution/src/services/`, `evolution/src/components/`. Any consumer that filters strictly on `entity_type='run'` will miss the moved-to-invocation logs. Mitigation: those queries should already be widening to `run_id` (which works because of the denormalized FK), but verify case-by-case.
  ```bash
  grep -rn "entity_type.*run\|entityType.*'run'" src/app/ evolution/src/services/ evolution/src/components/
  ```
- [ ] **Log-routing regression test** (NEW): in `evolution/src/lib/core/Agent.test.ts`, add a test that runs a mock agent with a real-shaped `ctx` (mocked `db`), captures all logger writes, and asserts:
  - Run lifecycle logs (`'Agent X starting'`, `'Agent X completed'`) carry `entity_type='run'`, `entity_id=runId`.
  - LLM-client logs and agent's own `logger.info/warn/error/debug` calls carry `entity_type='invocation'`, `entity_id=invocationId`.
  - Both `run_id` ancestor field is set on invocation-level rows for cross-aggregation.
- [ ] Document the behavior change in the planning doc's `Documentation Updates` (Phase 12) for `evolution/docs/logging.md`.
- [ ] Run lint, tsc, build, unit

### Phase 3: Cost Estimation Integration
Add reflection-cost component throughout the dispatch-prediction stack.

- [ ] New `estimateReflectionCost(seedArticleChars, generationModel, judgeModel, topN)` function in `evolution/src/lib/pipeline/infra/estimateCosts.ts`
- [ ] Update `estimateAgentCost()` (lines 122-134) to accept optional `useReflection: boolean` and `reflectionTopN: number` parameters; sum reflection cost into total
- [ ] Update `weightedAgentCost()` in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts:179-195` to compute weighted reflection cost
- [ ] Update `projectDispatchPlan()` to thread `iterCfg.useReflection` and `iterCfg.reflectionTopN` through to estimation calls
- [ ] Update `getStrategyDispatchPreviewAction` in `evolution/src/services/strategyPreviewActions.ts` to surface reflection cost in `IterationPlanEntry`
- [ ] Run lint, tsc, build, unit

### Phase 4: Mid-Run Tactic ELO Query
Helper to populate the reflection prompt's ELO-boost column.

**Critical correction**: `is_test_content` lives on `evolution_strategies`, `evolution_prompts`, and `evolution_experiments` — **NOT on `evolution_runs`**. The query must join through `evolution_strategies` to filter test runs. Reuse the existing helper pattern `applyNonTestStrategyFilter` from `evolution/src/services/shared.ts`.

- [ ] New file `evolution/src/services/tacticReflectionActions.ts`
- [ ] Function `getTacticEloBoostsForReflection(db, promptId, tacticNames): Promise<Map<string, number | null>>`
  - **Trip 1 — live aggregate** (corrected SQL):
    ```typescript
    const { data, error } = await db
      .from('evolution_variants')
      .select(`
        agent_name,
        elo_score,
        evolution_runs!inner(
          id,
          status,
          prompt_id,
          evolution_strategies!inner(is_test_content)
        )
      `)
      .eq('evolution_runs.status', 'completed')
      .eq('evolution_runs.prompt_id', promptId)
      .eq('evolution_runs.evolution_strategies.is_test_content', false)
      .not('agent_name', 'is', null);
    ```
    Group by `agent_name` JS-side, compute mean(`elo_score` - 1200) per tactic. Tactics with `n < 3` flagged for fallback.
  - **Trip 2 — global fallback**: read `evolution_metrics` rows where `entity_type='tactic'`, `metric_name='avg_elo_delta'`, for the `evolution_tactics.id` UUIDs corresponding to under-sampled tactic names. Use `getMetricsForEntities` (chunked at 100 IDs).
  - Cold-start prompts (zero variants) → all tactics fall through to Trip 2; tactics not in `evolution_metrics` either return `null` in the map.

**Caching** — iteration-scoped, NOT per-AgentContext:

- [ ] Cache lives in a `let tacticEloBoosts` variable in `runIterationLoop.ts`'s iteration loop body — populated once before parallel/top-up dispatch when ANY iteration's `useReflection === true`. Each `dispatchOneAgent` invocation reads from the closure-captured variable; per-dispatch `ctxForAgent` literals carry the SAME map reference.
- [ ] Add optional `tacticEloBoosts?: Map<string, number | null>` field to `AgentContext` in `evolution/src/lib/core/types.ts` so the wrapper agent can read it from `extendedCtx`.

**Defensive behavior**:

- [ ] If Trip 1 errors (e.g., DB transient), log a warning and treat as empty data → fall through to Trip 2.
- [ ] If both trips error, log warning, return empty `Map<string, null>`. Reflection still runs; LLM sees "boost: —" for every tactic. Acceptable degraded mode (parser still validates names against the registry).
- [ ] Run lint, tsc, build, unit

### Phase 5: Tactic Summary Helper
Compressed 1–2 sentence summary distilled from existing tactic prompt fields.

- [ ] New helper `getTacticSummary(name: string): string | null` in `evolution/src/lib/core/tactics/index.ts`
  - Returns `null` if tactic name unknown
  - Returns `${label} — ${preamble} ${firstSentence(instructions)}` (capped at ~200 chars)
- [ ] **Add `ALL_TACTIC_NAMES` export** (NEW) in `evolution/src/lib/core/tactics/index.ts`:
  ```typescript
  export const ALL_TACTIC_NAMES: ReadonlyArray<string> = Object.keys(ALL_SYSTEM_TACTICS);
  ```
  Required by Phase 7's `getTacticEloBoostsForReflection(db, promptId, ALL_TACTIC_NAMES)` call site — without it, Phase 7 fails to compile.
- [ ] Unit-test for known tactics (snapshot-style: structural_transform → expected summary)
- [ ] Run lint, tsc, build, unit

### Phase 6: ReflectAndGenerateFromPreviousArticleAgent
The new agent class.

- [ ] New file `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts`
- [ ] Class: `ReflectAndGenerateFromPreviousArticleAgent extends Agent<ReflectAndGenerateInput, ReflectAndGenerateOutput, ReflectAndGenerateExecutionDetail>`
  - `name = 'reflect_and_generate_from_previous_article'`
  - `usesLLM = true`
  - Override `getAttributionDimension(detail) → detail?.tactic ?? null`
  - `detailViewConfig` inherits from GFPA's structure (extended with reflection sub-fields)
  - `invocationMetrics` mirrors GFPA's (`format_rejection_rate`)
- [ ] `ReflectAndGenerateInput` interface:
  ```typescript
  interface ReflectAndGenerateInput {
    parentText: string;
    parentVariantId: string;
    tacticCandidates: TacticCandidate[];   // 24 entries, pre-shuffled
    tacticEloBoosts: Map<string, number | null>;
    reflectionTopN: number;                 // default 3 from iteration config
    initialPool: ReadonlyArray<Variant>;
    initialRatings: ReadonlyMap<string, Rating>;
    initialMatchCounts: ReadonlyMap<string, number>;
    cache: Map<string, ComparisonResult>;
    llm?: EvolutionLLMClient;               // injected by Agent.run
  }
  ```
- [ ] Reflection prompt builder `buildReflectionPrompt(parentText, candidates, eloBoosts, topN)`:
  - Preamble: "You are an expert writing strategist..."
  - Parent article (full text)
  - Numbered candidate list: `${index}. **${label}** — ${getTacticSummary(name)}` + ELO boost (or "—" for unknowns)
  - Structured ask: "Rank your top N tactics ... `Tactic: <name>\nReasoning: <text>`"
- [ ] Parser `parseReflectionRanking(response, validTacticNames): Array<{tactic, reasoning}>`:
  - Line-pattern match: `/^\s*\d+\.\s*Tactic:\s*(.+?)$/m` (capture-to-EOL, NOT `\S+` which only captures up to whitespace and would lose multi-word tactic names if the LLM hallucinates them)
  - Strip the captured tactic string, lowercase, and substitute spaces with underscores before lookup
  - Case-insensitive label match against `ALL_SYSTEM_TACTICS`
  - Levenshtein fuzzy match (distance ≤ 2) for typo tolerance — handled AFTER exact match fails
  - Validate each name via `isValidTactic`. Drop unknown entries from the result (with `logger.warn`).
  - Throw `ReflectionParseError` if zero valid entries remain after extraction + validation
- [ ] **Custom error types** (in the agent file):
  ```typescript
  class ReflectionLLMError extends Error {}
  class ReflectionParseError extends Error {
    constructor(message: string, readonly rawResponse: string) { super(message); }
  }
  ```
- [ ] `execute()` flow with FULL error handling. Note: `updateInvocation` signature is `(db, id, updates, logger?)` per `evolution/src/lib/pipeline/infra/trackInvocations.ts:52-65` — pass `ctx.db` as first arg in every call:
  1. **Capture starting cost**: `const costBeforeReflection = ctx.costTracker.getOwnSpent?.() ?? 0;` — used in step 7 to compute reflection's incremental spend. This MUST happen before the reflection LLM call.
  2. Validate input shape — `tacticCandidates.length === 0` → throw new Error('No tactic candidates provided'). Use a runtime length check; the type system's non-optional declaration is not a runtime guarantee.
  3. Build reflection prompt. Capture `reflStart = Date.now()`.
  4. Call `input.llm.complete(prompt, 'reflection', { model: ctx.config.generationModel, invocationId: ctx.invocationId })` inside a try/catch:
     - On throw (network / content / refusal): persist partial detail via `await updateInvocation(ctx.db, ctx.invocationId, { cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0, success: false, execution_detail: { detailType: 'reflect_and_generate_from_previous_article', reflection: { candidatesPresented, durationMs: Date.now() - reflStart, cost: (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeReflection } } })`, then re-throw. Per Phase 2's `updateInvocation` partial-update fix, the partial `execution_detail` we just wrote will SURVIVE `Agent.run()`'s subsequent catch-path update (which omits `execution_detail`).
     - Note: `release()` is auto-called inside `createEvolutionLLMClient`'s catch path (`createEvolutionLLMClient.ts:172/180/194`), so reservations are cleaned up automatically — no explicit `costTracker.release()` needed in wrapper code.
  5. Capture `reflectionCost = (ctx.costTracker.getOwnSpent?.() ?? 0) - costBeforeReflection;` and `reflectionDurationMs = Date.now() - reflStart;`.
  6. Parse ranked output. On `ReflectionParseError`: persist partial detail via `updateInvocation(ctx.db, ctx.invocationId, { cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0, success: false, execution_detail: { detailType: 'reflect_and_generate_from_previous_article', reflection: { candidatesPresented, rawResponse: response, parseError: err.message, durationMs: reflectionDurationMs, cost: reflectionCost } } })`, then re-throw.
  7. Validate `tacticChosen = ranking[0].tactic` via `isValidTactic`. If invalid, throw `ReflectionParseError` with raw response preserved (caught by step 6's handler if reordered into a single catch; or written before re-throw analogous to step 6).
  8. **Inner GFPA dispatch with explicit error preservation**:
     ```typescript
     let gfpaDetail: GenerateFromPreviousExecutionDetail;
     let gfpaOutput: GenerateFromPreviousOutput;
     try {
       const gfpaResult = await new GenerateFromPreviousArticleAgent().execute(
         { ...input, tactic: tacticChosen },  // input already has parentText, parentVariantId, etc.
         extendedCtx,
       );
       gfpaOutput = gfpaResult.result;
       gfpaDetail = gfpaResult.detail;
     } catch (err) {
       // Inner GFPA threw (most likely BudgetExceededError mid-generation or mid-ranking).
       // Preserve reflection detail before re-throwing so it's visible in the failed invocation row.
       const partialDetail = {
         detailType: 'reflect_and_generate_from_previous_article',
         reflection: { candidatesPresented, tacticRanking, tacticChosen, durationMs: reflectionDurationMs, cost: reflectionCost },
         tactic: tacticChosen,
         surfaced: false,
         totalCost: reflectionCost,
       };
       await updateInvocation(ctx.db, ctx.invocationId, {
         cost_usd: ctx.costTracker.getOwnSpent?.() ?? 0,
         success: false,
         execution_detail: partialDetail,
       });
       throw err; // Agent.run() catches and writes error_message; partial-update fix preserves our execution_detail
     }
     ```
     **Critical invariant**: must call `.execute()` directly on a fresh GFPA instance, NOT `.run()`. Calling `.run()` would create a NESTED `Agent.run()` scope (separate `AgentCostScope`), splitting cost attribution. Add `// LOAD-BEARING INVARIANT: DO NOT change to .run() — see planning doc Phase 6` comment at the call site.
  9. **Merge result detail with explicit `totalCost` recompute**:
     ```typescript
     const merged: ReflectAndGenerateExecutionDetail = {
       detailType: 'reflect_and_generate_from_previous_article',
       ...gfpaDetail,
       reflection: { candidatesPresented, tacticRanking, tacticChosen, durationMs: reflectionDurationMs, cost: reflectionCost },
       tactic: tacticChosen,
       totalCost: reflectionCost + (gfpaDetail.totalCost ?? 0),
       estimatedTotalCost: estReflectionCost + (gfpaDetail.estimatedTotalCost ?? 0),
       estimationErrorPct: /* recompute from new totals */,
     };
     ```
     **CRITICAL**: GFPA's `totalCost` field is generation+ranking only (not reflection). A naive `{...gfpaDetail, reflection}` spread would leave `totalCost` understating the invocation's real cost — diverging from the invocation row's `cost_usd` (which comes from `scope.getOwnSpent()` and DOES include reflection). The explicit recompute keeps the two in sync.
  10. Return `AgentOutput<ReflectAndGenerateOutput, ReflectAndGenerateExecutionDetail>` with `result` matching GFPA's output shape and the merged detail.
- [ ] Register in `agentRegistry.ts` `_agents` array
- [ ] Add `// LOAD-BEARING INVARIANT` comment block above the inner-`.execute()` call site explaining why `.run()` would break cost attribution. Cross-link to the ADR-style note in the planning doc.
- [ ] Run lint, tsc, build, unit

### Phase 7: Orchestrator Integration
Wire the wrapper agent into the iteration dispatch. **Critical**: `dispatchOneAgent` is a closure (lines 382-435 of runIterationLoop.ts) used by BOTH the parallel batch AND the top-up loop (lines 516-575). The conditional must live INSIDE the closure, not at the call site, or top-up will silently dispatch the wrong agent.

**Iteration-scoped tacticEloBoosts cache**:

- [ ] At the top of each iteration's body (before `dispatchOneAgent` is defined), if `iterCfg.useReflection === true`:
  ```typescript
  let tacticEloBoosts: Map<string, number | null> | undefined;
  if (iterCfg.useReflection && process.env.EVOLUTION_REFLECTION_ENABLED !== 'false') {
    try {
      tacticEloBoosts = await getTacticEloBoostsForReflection(db, promptId, ALL_TACTIC_NAMES);
    } catch (err) {
      logger.warn('Tactic ELO boost query failed; reflection prompt will show "—" for boosts', { error: String(err) });
      tacticEloBoosts = new Map();
    }
  }
  ```
  Captured by `dispatchOneAgent` via closure.

**Kill-switch resolution**:

- [ ] Compute `effectiveUseReflection` once per iteration:
  ```typescript
  const reflectionEnabled = iterCfg.useReflection === true && process.env.EVOLUTION_REFLECTION_ENABLED !== 'false';
  ```
  If env flips to `'false'` mid-prod-rollout, `useReflection: true` configs fall back to vanilla GFPA.

**`dispatchOneAgent` closure refactor** (load-bearing for top-up):

- [ ] Refactor the existing closure body so that BOTH agent instantiation AND input construction branch on `reflectionEnabled`. Sketch (verified types — `ALL_SYSTEM_TACTICS` is a Record so iterate via `Object.values`; `resolveParent` is synchronous, no await):
  ```typescript
  const dispatchOneAgent = async (tactic: string, mode: 'parallel' | 'top_up'): Promise<...> => {
    const resolved = resolveParent(...);  // SYNCHRONOUS — no await
    const ctxForAgent: AgentContext = {
      ...agentContext,
      iteration,
      executionOrder: ++execOrder,
      experimentId: agentContext.experimentId,  // explicit — Phase 2 added these
      strategyId: agentContext.strategyId,
      tacticEloBoosts,    // captured from iteration-scoped variable; same Map reference for all dispatches
      randomSeed: deriveSeed(randomSeed, `iter${iteration}`, `gfsa${execOrder}`),
    };
    
    if (reflectionEnabled) {
      const shuffleSeed = deriveSeed(randomSeed, `iter${iteration}`, `reflect_shuffle${execOrder}`);
      const rng = new SeededRandom(shuffleSeed);
      // Object.values() because ALL_SYSTEM_TACTICS is a Record<string, TacticDef>, NOT an iterable array
      const tacticDefs: TacticDef[] = Object.values(ALL_SYSTEM_TACTICS);
      const candidates: TacticCandidate[] = rng.shuffle(tacticDefs.slice()).map(t => ({
        name: t.name, label: t.label, summary: getTacticSummary(t.name),
      }));
      const agent = new ReflectAndGenerateFromPreviousArticleAgent();
      return agent.run({
        parentText: resolved.text,
        parentVariantId: resolved.variantId,
        tacticCandidates: candidates,
        tacticEloBoosts: tacticEloBoosts ?? new Map(),
        reflectionTopN: iterCfg.reflectionTopN ?? 3,
        initialPool, initialRatings, initialMatchCounts, cache,
      }, ctxForAgent);
    } else {
      const agent = new GenerateFromPreviousArticleAgent();
      return agent.run({
        parentText: resolved.text,
        tactic,
        parentVariantId: resolved.variantId,
        initialPool, initialRatings, initialMatchCounts, cache,
      }, ctxForAgent);
    }
  };
  ```
- [ ] Both the parallel batch (`Promise.allSettled` at line 439) AND the top-up loop (line 549) now invoke this closure unchanged — they automatically pick up the conditional dispatch.

**Cost-estimation sizing**:

- [ ] Update `estimateAgentCost(...)` invocation at runIterationLoop.ts:334-338 (and any other dispatch-sizing call site) to pass `iterCfg.useReflection` and `iterCfg.reflectionTopN` so `parallelDispatchCount` projection is accurate. Otherwise dispatch oversizes for reflection iterations (reflection cost not reserved per agent → BudgetExceeded throws partway through batch).

**Tactic-resolution shim**:

- [ ] When `reflectionEnabled === false`, the existing tactic-resolution path (`selectTactic(i)` at lines 342-350) feeds the `tactic` argument to `dispatchOneAgent`. When `reflectionEnabled === true`, this argument is unused (the wrapper picks its own tactic). Either pass an empty string and have the closure ignore it for reflection mode, or change the signature to make `tactic` conditional. Recommended: pass empty string; document in closure.

- [ ] Run lint, tsc, build, unit, integration

### Phase 8: Aggregator Migration
Make `getAttributionDimension` load-bearing for the new agent (and retroactively for GFPA), without creating a metrics→core circular dependency.

**Avoid the cycle**: `evolution/src/lib/metrics/types.ts` already exports `MetricValue`; if `experimentMetrics.ts` imports from `agentRegistry.ts`, which transitively imports the agent files, which import from `metrics/computations/finalizationInvocation.ts`, which imports from `metrics/types.ts` — that's a circular import. Instead use a **registration map** populated at module load time.

**`ATTRIBUTION_EXTRACTORS` map** (new architecture):

- [ ] New file `evolution/src/lib/metrics/attributionExtractors.ts`:
  ```typescript
  type DimensionExtractor = (detail: unknown) => string | null;
  
  // Map keyed by agent_name (matches evolution_agent_invocations.agent_name)
  export const ATTRIBUTION_EXTRACTORS: Record<string, DimensionExtractor> = {};
  
  export function registerAttributionExtractor(agentName: string, extractor: DimensionExtractor): void {
    ATTRIBUTION_EXTRACTORS[agentName] = extractor;
  }
  ```
  Pure data + 3 lines of registration logic; no agent-class imports here.
- [ ] At the bottom of `evolution/src/lib/core/agents/generateFromPreviousArticle.ts`, register:
  ```typescript
  import { registerAttributionExtractor } from '@/evolution/src/lib/metrics/attributionExtractors';
  registerAttributionExtractor('generate_from_previous_article', (detail) => {
    return (detail as { tactic?: string })?.tactic ?? null;
  });
  ```
- [ ] At the bottom of `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts`, similarly:
  ```typescript
  registerAttributionExtractor('reflect_and_generate_from_previous_article', (detail) => {
    return (detail as { tactic?: string })?.tactic ?? null;
  });
  ```
- [ ] Verify import direction is one-way: agents → metrics, never metrics → agents.
- [ ] **Registration-ordering safeguard** (NEW): create or update `evolution/src/lib/core/agents/index.ts` (a barrel) that explicitly imports all concrete agent modules — `generateFromPreviousArticle.ts`, `reflectAndGenerateFromPreviousArticle.ts`, `MergeRatingsAgent.ts`, `SwissRankingAgent.ts`, `createSeedArticle.ts`. The side-effect imports in those modules populate `ATTRIBUTION_EXTRACTORS`. Then in `evolution/src/lib/metrics/experimentMetrics.ts`, add `import '@/evolution/src/lib/core/agents';` (side-effect import) at the top of the file. This guarantees that any code path that imports `experimentMetrics` (workers, crons, server actions, isolated metric-aggregation entry points) eagerly loads the agent registrations BEFORE `computeEloAttributionMetrics` runs. Without this, the registry is empty in worker contexts and the legacy fallback silently fires for every invocation, regressing attribution.
- [ ] **Registry self-test** (NEW): in `evolution/src/lib/metrics/attributionExtractors.test.ts`, add a test that imports `experimentMetrics.ts` (which transitively triggers the barrel) and asserts `ATTRIBUTION_EXTRACTORS['generate_from_previous_article']` and `ATTRIBUTION_EXTRACTORS['reflect_and_generate_from_previous_article']` are both registered. Fails immediately if a future refactor breaks the barrel-import chain.

**`computeEloAttributionMetrics` refactor**:

- [ ] In `evolution/src/lib/metrics/experimentMetrics.ts`, modify `computeEloAttributionMetrics` (around line 443-449 per Round 5 finding):
  - Replace the hardcoded `inv.execution_detail.strategy` read with:
    ```typescript
    const extractor = ATTRIBUTION_EXTRACTORS[inv.agent_name];
    let dim: string | null = null;
    if (extractor) {
      const extracted = extractor(inv.execution_detail);
      if (typeof extracted === 'string' && extracted.length > 0 && !extracted.includes(':')) {
        dim = extracted;
      }
    } else {
      // Legacy fallback for unknown agent names — preserves B052 backward compatibility.
      const d = (inv.execution_detail as { strategy?: unknown })?.strategy;
      if (typeof d === 'string' && d.length > 0 && !d.includes(':')) dim = d;
    }
    if (dim === null) continue; // skip this invocation; do NOT double-count
    ```
- [ ] **Mutual exclusivity invariant**: extractor-hit XOR legacy-fallback. NEVER both. The `if (extractor) { ... } else { ... }` branch above guarantees this. Add a comment block above the branch documenting it.

**Tests**:

- [ ] **Backward-compat regression**: today's aggregator hardcodes `inv.execution_detail.strategy`, but GFPA's actual execution_detail uses field name `tactic` (rename happened in `runSummaryV3Rename`). Verify by sampling staging/prod data: if today's `eloAttrDelta:generate_from_previous_article:<tactic>` rows DO exist, GFPA must currently be writing the tactic to a `strategy` field too — confirm via grep on `generateFromPreviousArticle.ts`. If those rows DO NOT exist today (legacy path is dead), the migration is a net-new feature and there's nothing to regress against. The correct test framing:
  - **Sub-test A — no row removed**: snapshot the existing `evolution_metrics` rows where `metric_name LIKE 'eloAttrDelta:%'` from a known fixture, run aggregator post-migration, assert no row that existed before is missing or has `value` / `n` / `ci_lower` / `ci_upper` changed.
  - **Sub-test B — new rows are correct**: same fixture, post-migration, assert any newly-emitted rows match the registered extractor's output (e.g., `eloAttrDelta:generate_from_previous_article:lexical_simplify` has `value = mean(child.elo - parent.elo) for invocations of that agent with that tactic`).
- [ ] Mixed-agents test: fixture with both `generate_from_previous_article` and `reflect_and_generate_from_previous_article` invocations → assert each emits its own `eloAttrDelta:<agent>:<tactic>` rows; no double-counting; no merging across agent_names.
- [ ] Unknown-agent fallback (positive path): invocation with `agent_name='unknown_agent'` AND `execution_detail.strategy` set → legacy path emits attribution under `unknown_agent`. Assert one row is emitted.
- [ ] Unknown-agent fallback (negative path): invocation with `agent_name='unknown_agent'` AND NEITHER `execution_detail.strategy` NOR `execution_detail.tactic` set → assert ZERO rows emitted (the `if (dim === null) continue` branch). This proves the dispatch is exhaustive — no double-counting, no silent-skip-with-stale-data.
- [ ] Run lint, tsc, build, unit

### Phase 9: UI — Invocation Detail Tabs
Wrapper-specific tab dispatcher; Reflection Overview is the only new render layer. Generation Overview, Metrics, and Logs reuse existing components without modification.

**Reuse summary**:
- `DETAIL_VIEW_CONFIGS['generate_from_previous_article']` — reused unchanged for the Generation Overview tab. The wrapper's `execution_detail` exposes `generation`, `ranking`, `tactic`, `surfaced`, `discardReason`, and cost fields at the same paths with identical semantics; the unfamiliar `reflection` sub-object is simply ignored by that config.
- `ConfigDrivenDetailRenderer` — reused unchanged.
- `InvocationParentBlock` — reused; only the agent-name gate is widened to include `reflect_and_generate_from_previous_article` (or moved inside the GFPA tab branch). 1-line edit.
- `EntityMetricsTab` — reused **fully unchanged**. The wrapper class declares the same `invocationMetrics` array as GFPA (likely via shared const import, not duplication). All metrics — `format_rejection_rate`, `total_comparisons` (or whichever GFPA exposes), `best_variant_elo`, `avg_variant_elo`, `variant_count`, `elo_delta_vs_parent` — flow naturally because the wrapper's `execution_detail.generation` and `execution_detail.ranking` paths match GFPA's. Per-phase cost breakdown lives on the Reflection/Generation Overview tabs, not here. Per user directive: "Metrics — no change."

**Concrete changes**:

- [ ] In `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx:13-23`:
  - Refactor `buildTabs(agentName)` to `buildTabs(agentName, executionDetail)` — inspect `executionDetail` for `reflection` section key.
  - For `agent_name === 'reflect_and_generate_from_previous_article'`: tabs = `['overview-reflection', 'overview-gfpa', 'metrics', 'timeline', 'logs']`.
  - For other agents: existing static tab list preserved.
  - Add `'reflect_and_generate_from_previous_article'` to `TIMELINE_AGENTS`.
- [ ] Update the active-tab dispatcher (currently renders one Overview block at lines 67-103). Branch on `activeTab`:
  - `'overview-reflection'` → render `ConfigDrivenDetailRenderer` with `DETAIL_VIEW_CONFIGS['reflection_only']` against `execution_detail.reflection`.
  - `'overview-gfpa'` → render today's GFPA Overview block (header summary + `InvocationParentBlock` + `ConfigDrivenDetailRenderer` with `DETAIL_VIEW_CONFIGS['generate_from_previous_article']` against the full `execution_detail`).
  - Other tab ids unchanged.
- [ ] Widen `InvocationParentBlock` agent-name gate (lines 90-96) to include the wrapper agent name, OR keep the existing gate and call the block explicitly inside the `'overview-gfpa'` branch. Pick one — the second is slightly cleaner since the parent block is GFPA-specific semantically.
- [ ] Add new entry to `evolution/src/lib/core/detailViewConfigs.ts`:
  ```typescript
  reflection_only: [
    { key: 'tacticChosen', label: 'Tactic Chosen', type: 'badge' },
    { key: 'tacticRanking', label: 'Ranked Tactics', type: 'table',
      columns: [
        { key: 'tactic', label: 'Tactic' },
        { key: 'reasoning', label: 'Reasoning' },
      ] },
    { key: 'candidatesPresented', label: 'Candidates Presented', type: 'list' },
    { key: 'cost', label: 'Reflection Cost', type: 'number', formatter: 'cost' },
    { key: 'durationMs', label: 'Duration (ms)', type: 'number' },
  ]
  ```
- [ ] DO NOT touch existing `'reflection'` config entry (V1 dead code; will leave for future cleanup).
- [ ] **Attach data-testid attributes** required by E2E specs:
  - In `EntityDetailTabs` (or wherever tabs render): each tab gets `data-testid="tab-${id}"` — for the wrapper agent, `tab-overview-reflection`, `tab-overview-gfpa`, `tab-metrics`, `tab-timeline`, `tab-logs`.
  - In `ConfigDrivenDetailRenderer` rendering of `DETAIL_VIEW_CONFIGS['reflection_only']`: the `tacticChosen` badge gets `data-testid="reflection-tactic-chosen"`; the `tacticRanking` table gets `data-testid="reflection-tactic-ranking"`; the `candidatesPresented` list gets `data-testid="reflection-candidates-list"`.
  - In the GFPA Overview tab content: ensure the existing generation/ranking sub-blocks have `data-testid="gfpa-generation-section"` and `data-testid="gfpa-ranking-section"` (add if missing — verify by grep first).
  - In `EntityMetricsTab`'s rendered `MetricGrid`: add `data-testid="invocation-metrics-grid"` to the grid container — required by E2E spec assertion on the Metrics tab. Verify whether this testid already exists; if not, attach it as part of this phase.
- [ ] Run lint, tsc, build, unit

### Phase 10: UI — Timeline 3-phase Bar
Extend `InvocationTimelineTab.tsx` to render reflection alongside generation+ranking.

- [ ] In `evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx`:
  - Add `REFLECTION_COLOR = '#f59e0b'` (amber) constant
  - Read `execution_detail.reflection` (optional)
  - Update `phaseTotalMs` math to include reflection
  - Render reflection bar at `startMs=0`, generation at `reflectionDurationMs ?? 0`, ranking at `(reflectionDurationMs ?? 0) + (generationDurationMs ?? 0)`
  - Update comparison sub-bar offset (currently uses `generationDurationMs` as baseline)
  - Historic-row fallback: if `reflection.durationMs` missing, skip reflection bar
- [ ] **Attach data-testid attributes** required by E2E specs:
  - Reflection bar: `data-testid="timeline-reflection-bar"`
  - Generation bar: `data-testid="timeline-generation-bar"`
  - Ranking bar: `data-testid="timeline-ranking-bar"`
  - Each bar's `aria-label` includes phase name and duration (e.g., `Reflection 1.8s`)
  - Existing `data-testid="timeline-phase-bars"` wrapper preserved
- [ ] Run lint, tsc, build, unit

### Phase 11: UI — Strategy Wizard
Surface `useReflection` and `reflectionTopN` in `strategies/new/page.tsx`.

- [ ] In `src/app/admin/evolution/strategies/new/page.tsx`:
  - Add `useReflection?: boolean` and `reflectionTopN?: number` to `IterationRow` interface
  - Add `useReflection?: boolean` and `reflectionTopN?: number` to `IterationConfigPayload`
  - In per-iteration JSX (after sourceMode/qualityCutoff block, ~line 902): add checkbox + number input (1-10, default 3), gated on `it.agentType === 'generate'`
  - Mutual exclusivity UI: when `useReflection=true`, disable/hide tactic-guidance editor (and vice versa). Wizard validation message if both attempted.
  - Update `toIterationConfigsPayload` to conditionally emit `useReflection` and `reflectionTopN` only when `useReflection=true`
- [ ] In `evolution/src/components/evolution/DispatchPlanView.tsx`: optional reflection-cost sub-line in `$/Agent` column when reflection is enabled
- [ ] **Attach data-testid attributes** required by E2E specs:
  - Iteration row container: `data-testid="iteration-row-${idx}"` — ADD if not present (verify by grep first; required by E2E tab-2 wizard spec)
  - Reflection checkbox: `data-testid="use-reflection-checkbox-${idx}"` where `idx` is iteration index
  - Reflection topN input: `data-testid="reflection-topn-input-${idx}"` — when `useReflection=false`, render the input as `disabled` (NOT hidden) to keep the testid stable for E2E
  - Mutual-exclusivity error message: `data-testid="reflection-mutex-error"`
- [ ] **Audit existing wizard testids for consistency**: grep `strategies/new/page.tsx` for `data-testid="tactic-guidance-editor"` (currently un-indexed). If the new reflection controls use indexed testids (`-${idx}`) but the existing tactic-guidance editor is un-indexed, either (a) update the existing testid to `tactic-guidance-editor-${idx}` and audit existing wizard E2E specs that depend on it, or (b) align reflection controls to un-indexed testids. Pick (a) for consistency since iterations are now reorderable and per-iteration selection requires indexed testids. Update any failing existing E2E selectors as part of this phase.
- [ ] Run lint, tsc, build, unit

### Phase 12: Documentation Updates
- [ ] Update `evolution/docs/architecture.md` — add wrapper agent to the agent table; describe reflection-then-generate execution flow
- [ ] Update `evolution/docs/agents/overview.md` — document the new agent class, reflection prompt, parser, attribution dimension override
- [ ] Update `evolution/docs/cost_optimization.md` — add `reflection_cost` metric, `'reflection'` AgentName, calibration phase
- [ ] Update `evolution/docs/data_model.md` — describe new `reflectAndGenerateFromPreviousArticleExecutionDetailSchema`, ranking shape
- [ ] Update `evolution/docs/strategies_and_experiments.md` — `useReflection` + `reflectionTopN` IterationConfig fields, mutual exclusivity with generationGuidance
- [ ] Update `evolution/docs/visualization.md` — new Reflection Overview tab, 3-phase Timeline bar, wizard reflection controls
- [ ] Update `evolution/docs/metrics.md` — registry-driven attribution dispatch, `total_reflection_cost` propagation
- [ ] Update `evolution/docs/logging.md` — invocation-scoped logger now active for all agents
- [ ] Update `evolution/docs/reference.md` — new file index entries (reflectAndGenerateFromPreviousArticle.ts, tacticReflectionActions.ts), new tab list, kill-switch reference (none introduced)
- [ ] Update `docs/feature_deep_dives/multi_iteration_strategies.md` — `useReflection` field, dispatch implications, mutual exclusivity
- [ ] Update `docs/feature_deep_dives/evolution_metrics.md` — reflection_cost metric, registry-driven attribution

## Testing

### Unit Tests
- [ ] `evolution/src/lib/schemas.test.ts` — `useReflection` only valid for generate; `reflectionTopN` only valid when `useReflection=true`; mutual exclusivity with `generationGuidance`; range 1-10
- [ ] `evolution/src/lib/core/tactics/getTacticSummary.test.ts` — known tactic returns formatted summary; unknown returns null; output ≤ ~200 chars
- [ ] `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.test.ts`:
  - happy path: reflection → parse → tacticChosen → inner GFPA executes → variant produced
  - reflection LLM throws → invocation marked failed, `reflection.candidatesPresented` preserved
  - parser fails (malformed output) → `ReflectionParseError` thrown, invocation failed
  - parser yields invalid tactic name → `ReflectionParseError` thrown
  - cost attribution: `scope.getOwnSpent() === reflectionCost + generationCost + rankingCost`
  - top-N output preserved in `tacticRanking[]`
- [ ] `evolution/src/lib/core/agents/parseReflectionRanking.test.ts` — priority chain (exact / fuzzy / multi-line); empty output → throw
- [ ] `evolution/src/services/tacticReflectionActions.test.ts` — cold-start (zero variants) returns `Map<string, null>`; with data returns mean ELO delta; respects test-content filter
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — when `useReflection=true`, dispatches wrapper agent; tacticCandidates shuffled deterministically; existing tests unchanged when `useReflection=false`
- [ ] `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` — `useReflection=true` produces different config_hash than `useReflection=false`
- [ ] `evolution/src/lib/pipeline/infra/estimateCosts.test.ts` — `estimateReflectionCost` produces sane output; `estimateAgentCost` includes reflection when enabled
- [ ] `evolution/src/lib/metrics/experimentMetrics.test.ts` — registry-driven attribution: GFPA-only fixture produces identical output pre/post migration; mixed agents produce separate `eloAttrDelta` rows
- [ ] `evolution/src/lib/core/Agent.test.ts` — invocation-scoped logger created when invocationId set; falls back to ctx.logger when invocationId is null
- [ ] `evolution/src/lib/shared/seededRandom.test.ts` — confirm shuffle determinism via `deriveSeed(seed, 'iter${i}', 'reflect_shuffle${execOrder}')`

### Property-Based Tests (mirror existing `*.property.test.ts` pattern)
- [ ] `evolution/src/lib/core/agents/parseReflectionRanking.property.test.ts` — fast-check generators: random permutations of valid tactic names, mixed casing, occasional Levenshtein-1 typos. Property: parser always returns a list whose every entry passes `isValidTactic`. Empty/garbled input → throws `ReflectionParseError`.
- [ ] `evolution/src/lib/shared/seededRandom.property.test.ts` (or extend existing) — property: `deriveSeed(seed, 'iter${i}', 'reflect_shuffle${execOrder}')` followed by `SeededRandom.shuffle(ALL_SYSTEM_TACTICS)` produces identical 24-element ordering across N invocations with same `(seed, i, execOrder)`. Different seeds → different orderings (statistically).

### Mock LLM Extension
- [ ] Verify/extend `createV2MockLlm` in `evolution/src/testing/v2MockLlm.ts` to support the `'reflection'` agent label. The mock today branches on labels including `'ranking'` and `'evolution'`; reflection calls (`llm.complete(prompt, 'reflection', ...)`) need a `labelResponses['reflection']` entry. If the mock already passes through unknown labels via a default response queue, document this; otherwise add a `'reflection'` branch and a helper to set up structured ranked-output responses for reflection tests.

### Critical-invariant unit tests (added per iter-2 review)
- [ ] **Hash collision symmetry test** in `evolution/src/lib/pipeline/setup/findOrCreateStrategy.test.ts` (in addition to the regression test): assert `hashStrategyConfig({useReflection: undefined, ...})` === `hashStrategyConfig({useReflection: false, ...})` === `hashStrategyConfig({...without useReflection key})`. Three configurations, all should produce identical hashes. Same for `reflectionTopN: undefined` vs absent. This validates the canonicalization rule from Phase 1.
- [ ] **Kill-switch dispatch test** in `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts`: with a strategy whose iteration has `useReflection: true`, set `process.env.EVOLUTION_REFLECTION_ENABLED = 'false'` for the test scope (via `vi.stubEnv` or equivalent), run the iteration, assert: the dispatched agent has `name === 'generate_from_previous_article'` (vanilla GFPA), NOT `'reflect_and_generate_from_previous_article'`. Restore env in `afterEach`.
- [ ] **Reservation no-leak test** in `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.test.ts`: mock the LLM to throw on the reflection call. Use a real `V2CostTracker` with a known budget. Assert: after the wrapper's execute() throws, `costTracker.getAvailableBudget()` returns the EXPECTED remaining budget (i.e., reservation was released, not stuck). This proves `release()` auto-cleanup in `createEvolutionLLMClient`'s catch path works as the plan claims.
- [ ] **Cost-attribution invariant test** in `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.test.ts`: with mocked LLM responses for reflection + generation + ranking, after wrapper's `.run()` completes successfully, assert TWO things in unison: (a) `merged.totalCost === reflectionCost + generationCost + rankingCost`, AND (b) the invocation row's `cost_usd` field (read from DB or mock) equals `merged.totalCost`. This locks in the "totalCost matches cost_usd" invariant from Phase 6.

### Integration Tests
- [ ] `src/__tests__/integration/evolution-reflection-agent.integration.test.ts` — full pipeline run with reflection-enabled iteration. **Test contract**:
  - Uses **real Supabase staging instance** (consistent with existing `*.integration.test.ts` patterns — see `evolution/src/__tests__/integration/`). Each test cleans up its own runs/strategies via `cleanupEvolutionData`.
  - Uses **structured-output mock LLM** via `createV2MockLlm`. Mock LLM responses must match the parser contract:
    ```
    1. Tactic: lexical_simplify
       Reasoning: <text>
    
    2. Tactic: structural_transform
       Reasoning: <text>
    
    3. Tactic: grounding_enhance
       Reasoning: <text>
    ```
  - **Test cases**:
    - **Happy path**: run with `useReflection: true, reflectionTopN: 3`. Mock LLM returns valid ranked output. Assertions: invocation row created with `agent_name = 'reflect_and_generate_from_previous_article'`; `execution_detail` validates against `reflectAndGenerateFromPreviousArticleExecutionDetailSchema`; variant produced with `agent_name = 'lexical_simplify'` (the chosen tactic); `cost_usd` includes reflection + generation + ranking; `evolution_metrics` rows include `reflection_cost`, `generation_cost`, `ranking_cost` for this run; `eloAttrDelta:reflect_and_generate_from_previous_article:lexical_simplify` row emitted post-finalization.
    - **Reflection LLM throws**: mock LLM rejects on first call with a thrown error. Assertions: invocation row marked `success=false`; `error_message` populated; `execution_detail.reflection.candidatesPresented` populated; no variant produced.
    - **Parser failure (malformed output)**: mock LLM returns string `"I think you should use compression."`. Assertions: invocation row `success=false`; `execution_detail.reflection.rawResponse = <that string>`; `execution_detail.reflection.parseError` populated.
    - **Parser failure (zero valid names)**: mock LLM returns `"1. Tactic: not_a_real_tactic\n   Reasoning: ..."`. Same assertions as above.
    - **Inner GFPA budget throw mid-generation**: budget cap set such that reflection succeeds but generation throws `BudgetExceededError`. Assertions: invocation `success=false`; `execution_detail.reflection.{candidatesPresented, tacticRanking, tacticChosen}` populated; `execution_detail.totalCost = reflectionCost`.
  - **Finalization trigger**: each test must explicitly invoke the run finalization path (which calls `computeEloAttributionMetrics`) before asserting `eloAttrDelta:*` rows. Either: (a) call `claimAndExecuteRun(...)` end-to-end and wait for `run.status === 'completed'`, or (b) directly call `persistRunResults` / `computeRunMetrics` after the iteration dispatch completes. Do NOT assume the aggregator runs implicitly — without an explicit finalization step, the assertions silently fail. Document the chosen pattern in the test file.
  - **Cleanup**: each test deletes the run + strategy + variants in afterEach via `cleanupEvolutionData` (helper at `evolution/src/testing/evolution-test-helpers.ts:89`).

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts` (extend existing) — strategy wizard reflection controls. **Concrete assertions**:
  - Step 2 iteration row: `data-testid="iteration-row-0"` contains `data-testid="use-reflection-checkbox-0"` (checkbox).
  - Checkbox unchecked → `data-testid="reflection-topn-input-0"` is not visible (or `disabled`).
  - Click checkbox → topN input becomes visible with default value `"3"`.
  - When `data-testid="tactic-guidance-editor-0"` is open AND user attempts to check reflection box → wizard shows error message `data-testid="reflection-mutex-error"` ("Tactic guidance and reflection cannot both be set"); checkbox remains unchecked.
  - Inverse: when reflection checkbox is checked, the "Add tactic guidance" button shows tooltip / disabled state.
  - Save → `config_hash` of returned strategy differs from a non-reflection strategy with otherwise identical config (assert via API call after save).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-invocation-detail.spec.ts` (new spec) — invocation detail page for a reflection-enabled run. **Concrete assertions**:
  - Tab list contains exactly 5 tabs in order: `data-testid="tab-overview-reflection"`, `tab-overview-gfpa`, `tab-metrics`, `tab-timeline`, `tab-logs`.
  - Click `tab-overview-reflection` → page contains `data-testid="reflection-tactic-chosen"` (badge with tactic name) and `data-testid="reflection-tactic-ranking"` (table with N rows where N = reflectionTopN).
  - Click `tab-overview-gfpa` → page contains `data-testid="gfpa-generation-section"` and `data-testid="gfpa-ranking-section"` (existing GFPA structure unchanged).
  - Click `tab-metrics` → page contains `data-testid="invocation-metrics-grid"` with format_rejection_rate, total_comparisons, etc. (verify identical to GFPA invocation Metrics tab).
  - Click `tab-timeline` → page contains exactly 3 colored phase bars: `data-testid="timeline-reflection-bar"` (amber), `timeline-generation-bar` (blue), `timeline-ranking-bar` (purple). Reflection bar's `aria-label` includes a duration value.
  - Click `tab-logs` → page contains at least one log row with `entity_type='invocation'` for this invocation. Filters work (level, phase).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts` (extend) — full pipeline E2E with a reflection-enabled strategy: create strategy → start experiment → wait for run to complete → assert variant produced under expected tactic name.

### Manual Verification
- [ ] In wizard at `/admin/evolution/strategies/new`: Step 1 set models + budget → Step 2 add a single generate iteration → check "Use reflection" → expect topN input to appear with default 3 → save → confirm strategy created with new fields in DB
- [ ] At `/admin/evolution/start-experiment`: pick the new strategy → start experiment → wait for first run to complete (expect ~1-2 minutes for a small budget run)
- [ ] At `/admin/evolution/runs/<run_id>` → Variants tab: confirm variants tagged with tactics chosen by reflection (variety in `agent_name` column)
- [ ] Click any variant's "Invocation" link → invocation detail page → 5 tabs visible → click Reflection Overview → confirm: tacticChosen badge, ranked tactics table with reasoning text, candidates list shows 24 tactics
- [ ] Click GFPA Overview tab → looks identical to a vanilla GFPA invocation page
- [ ] Click Metrics tab → MetricGrid shows the same metrics today's GFPA Metrics tab shows
- [ ] Click Timeline tab → 3 colored bars (amber, blue, purple); hover for tooltips
- [ ] Click Logs tab → confirm log rows are populated (post framework logger fix); filter by phase=reflection to see only reflection-call logs
- [ ] Open `/admin/evolution/runs/<run_id>` Metrics tab → confirm `StrategyEffectivenessChart` shows a bar for `reflect_and_generate_from_previous_article / lexical_simplify` (or whichever tactic the LLM picked) separate from any vanilla GFPA bars
- [ ] Query DB: `SELECT * FROM evolution_metrics WHERE run_id = '<run_id>' AND metric_name LIKE 'reflection%'` — confirm `reflection_cost` row present with sensible value (~$0.0005)
- [ ] **Rollback verification**: set `EVOLUTION_REFLECTION_ENABLED=false` env var → restart server → re-run the same strategy → verify the wrapper agent is NOT instantiated (invocation rows show `agent_name='generate_from_previous_article'`); strategy with `useReflection: true` falls back to vanilla GFPA dispatch silently

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Strategy wizard reflection controls (checkbox + topN input + mutual exclusivity with generationGuidance editor)
- [ ] Invocation detail page tabs (Reflection Overview, GFPA Overview, Metrics, Timeline, Logs) for the new agent
- [ ] Timeline tab 3-phase bar (amber + blue + purple)
- [ ] LogsTab populated for the new agent (and retroactively for GFPA, post framework fix)

### B) Automated Tests
- [ ] `npm run test:unit -- --testPathPattern="evolution"`
- [ ] `npm run test:integration -- --testPathPattern="evolution-reflection-agent"`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-strategy-wizard.spec.ts`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-invocation-detail.spec.ts`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-run-pipeline.spec.ts`
- [ ] Lint, tsc, build clean

## Documentation Updates
See Phase 12 above. Summary:
- [ ] `evolution/docs/architecture.md` — wrapper agent, execution flow
- [ ] `evolution/docs/agents/overview.md` — new agent class, prompt, parser, attribution
- [ ] `evolution/docs/cost_optimization.md` — `reflection_cost`, `'reflection'` AgentName
- [ ] `evolution/docs/data_model.md` — new ExecutionDetail schema
- [ ] `evolution/docs/strategies_and_experiments.md` — `useReflection`, `reflectionTopN`
- [ ] `evolution/docs/visualization.md` — new tab, 3-phase Timeline, wizard
- [ ] `evolution/docs/metrics.md` — registry-driven attribution
- [ ] `evolution/docs/logging.md` — invocation-scoped logger
- [ ] `evolution/docs/reference.md` — file index update
- [ ] `docs/feature_deep_dives/multi_iteration_strategies.md`
- [ ] `docs/feature_deep_dives/evolution_metrics.md`

## Review & Discussion

### Iteration 1 (3/3 agents scored 3/5) — 16 critical gaps fixed
Initial review surfaced foundational issues across all three lenses:
- **Security**: Phase 4 SQL targeting `is_test_content` on the wrong table; missing wrapper try/catch around inner GFPA; missing explicit `totalCost` recompute in merge; missing mutual exclusivity in Phase 8 attribution dispatch.
- **Architecture**: AgentContext lacked `experimentId`/`strategyId`; metrics→agentRegistry import would create a circular dependency; Phase 1 missed the `'reflection'` branch in the `createEvolutionLLMClient` calibration ladder; Phase 7's `dispatchOneAgent` closure refactor wasn't accounted for in top-up loop reuse.
- **Testing**: Fixture migration step missing; backward-compat hash regression test missing; Phase 2 log-dashboard regression missing; no kill-switch env var; integration test contract under-specified; schema refinement matrix incomplete; hash collision rule for `useReflection: undefined`/`false` unspecified; E2E specs lacked concrete `data-testid` selectors.

### Iteration 2 (3/3 agents scored 3/5) — 18 critical gaps fixed
Revisions introduced new precision but exposed deeper issues:
- **Security**: `updateInvocation` overwriting `execution_detail: null` when omitted (verified at `trackInvocations.ts:74`) — Phase 2 now includes a partial-update fix; `updateInvocation` signature corrected; Phase 8 backward-compat test reframed (current GFPA writes `tactic` not `strategy` so old aggregator may emit zero rows); explicit `costBeforeReflection` capture added.
- **Architecture**: `STATIC_METRIC_NAMES` needed all three reflection metric names; `agentExecutionDetailSchema` discriminated union needed the new schema; Phase 2 missed 5th call site at `claimAndExecuteRun.ts:291` (seedCtx); `db` is already on AgentContext (Phase 2 audit corrected); Phase 7 closure code-sketch fixed (`Object.values()` for Record, no spurious await on sync `resolveParent`).
- **Testing**: Phases 9/10/11 now include explicit "attach data-testid" sub-steps; wizard testid alignment audit added; `createV2MockLlm` extension item added; Phase 8 backward-compat reframed and unknown-agent negative-case test added; hash collision symmetry test, kill-switch dispatch test, reservation no-leak test, and cost-attribution invariant test all added. (Testing agent's claim that `cleanupEvolutionData` doesn't exist was verified incorrect — helper exists at `evolution/src/testing/evolution-test-helpers.ts:89`.)

### Iteration 3 (3/3 agents scored 4/5) — 6 critical gaps fixed
Down to mechanical issues:
- **Security**: Operator-precedence bug in 3 cost-delta sites — fixed with explicit parentheses.
- **Architecture**: `ATTRIBUTION_EXTRACTORS` registration-ordering risk in worker contexts — fixed with eager-import barrel and registry self-test; `ALL_TACTIC_NAMES` undefined — fixed by adding export to `tactics/index.ts`.
- **Testing**: Missing `data-testid="iteration-row-${idx}"` and `data-testid="invocation-metrics-grid"` attach steps — added to Phases 9 and 11; integration test missing finalization trigger — added; `error_message` partial-update fix lacked symmetric unit test — added.

### Iteration 4 — ✅ CONSENSUS (3/3 agents scored 5/5)
All blockers resolved. Plan is ready for execution. Remaining items called out by reviewers were minor polish (cosmetic phrasing, optional defense-in-depth, unused error class) and do not block.
