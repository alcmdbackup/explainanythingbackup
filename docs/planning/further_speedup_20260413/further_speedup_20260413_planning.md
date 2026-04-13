# Further Speedup Plan

## Background
This project encompasses several improvements to the evolution pipeline: recovering and documenting research from a crashed branch about judging accuracy, adding timeline visualization for generate_from_seed_article invocations, debugging slow Qwen judge model performance, clarifying the budget buffer parameter naming, and configuring thinking mode for the OSS 20B model to improve speed.

## Requirements (from GH Issue #965)
- Pull in the research and planning documents from branch feat/estimate_match_noise_evolution_20260411 - some progress on this branch was lost when my minicomputer crashed. Compare that implementation to the implementation of feat/improve_setup_judging_20260412, which was recreated from memory and then merged, so see if there are any notable differences.
- Also, please copy in the research doc from feat/estimate_match_noise_evolution_20260411, take the key findings and populate them in a docs/research/judging_accuracy_20260412.md for future reference on judges
- Help me add a "timeline" view, similar to what we have for a run, for the invocations of generate_from_seed_article, so I can see why it is taking a certain amount of time to finish
- Debug why judge model for QWEN is so slow. Verify that it was the model called on Run 4133123e-c9fa-4c52-9289-26dcfb95ce61 in staging. See why it isn't faster than OSS 20B. Test both those models side-by-side locally using a script, and see how their response times compare.
- Check for me how our Budget Buffer After Parallel (0-1) value is used. Rename if needed to make it more clear.
- Use web docs to disable thinking mode or put it into "low" thinking mode for OSS 20B model, wherever it is used. Run tests to verify this makes a difference.
- **[ADDED]** Add Qwen 2.5 7B to the model registry (including max temperature), and set it as the new default judge model.

## Problem
The current default judge model (Qwen3 8B) has thinking mode enabled by default via OpenRouter, generating ~900 reasoning tokens per call and making judge calls take 8-13s each. This bottlenecks evolution runs. Meanwhile we lack visibility into WHY individual generate_from_seed_article invocations are slow (no per-phase / per-comparison timing). The budget buffer config parameters have misleading names. And the research that motivated the current judge model selection was lost in a minicomputer crash before being pushed.

## Options Considered — Judge Model Replacement

Based on empirical data in `docs/research/judge_agreement_summary_tables.md`:

- [x] **Option A: Keep Qwen3 8B, disable thinking mode** — requires threading `reasoning: { effort: 'none' }` through OpenRouter calls, plus a `parseWinner()` fix for `"Your answer: B"` responses. Latency drops from ~9s → ~1s. Cost drops ~50%. But still needs parser fix.
- [x] **Option B: Switch to Qwen 2.5 7B (Recommended)** — 100% decisive on BOTH pairs at ALL temperatures. ~1.7s median latency. ~3 output tokens per call. No thinking mode to disable. No parser issues. **$0.000270/comparison** (vs $0.000704 for Qwen3-on or $0.002716 for gpt-4.1-mini).
- [ ] **Option C: Use gpt-oss-20b with reasoning=low** — cheapest input pricing ($0.03/M) but weak on close pairs (0-70% decisive depending on temp). Inconsistent.
- [ ] **Option D: Use gpt-4.1-mini or deepseek-chat** — proven 100% decisive at all conditions, but 5-10x more expensive than Qwen 2.5 7B.

**Decision: Option B (Qwen 2.5 7B as new default judge).**

## Options Considered — Budget Buffer Rename

- [ ] **Option A: `budgetReservedForRanking` / `budgetReservedForSwiss`** — describes purpose (what budget is reserved for the next phase).
- [ ] **Option B: `parallelBudgetCeiling` / `sequentialBudgetCeiling`** — describes mechanism (ceiling on what each phase can spend).
- [x] **Option C: `minBudgetAfter*` with dual units (Chosen)** — rename `budgetBufferAfter*` → `minBudgetAfter*`, and support two unit modes:
  - `minBudgetAfterParallelFraction` — 0-1 of total budget
  - `minBudgetAfterParallelAgentMultiple` — N × estimated agent cost
  - `minBudgetAfterSequentialFraction` — 0-1 of total budget
  - `minBudgetAfterSequentialAgentMultiple` — N × actual avg cost per agent (runtime feedback)

### Budget Floor — Dual-Unit Design

Each phase's floor can be specified in either of two mutually-exclusive units. Exactly one field per phase may be set. Parallel and sequential must use the same unit mode (enforced via Zod refine).

**Resolution timing (lazy):**
- **Parallel floor** uses the initial `estimateAgentCost()` (no runtime data available yet before batch dispatch)
- **Sequential floor** uses `actualAvgCostPerAgent` if the parallel batch has completed, falling back to the initial estimate

**UI design:**
- **One mode dropdown at the top** controlling both phases: "Fraction of budget" | "Multiple of agent cost"
- **Two numeric inputs**: "Min budget after parallel" and "Min budget after sequential"
- When mode = "Multiple of agent cost":
  - Single cost-preview header: estimated per-agent cost from `estimateAgentCost()`
  - Per-input floor computation: `value × estimate = $X.XX floor` shown inline
  - Preview assumptions chip: seed chars, representative strategy, pool size, max comparisons
- Submit writes exactly one field per phase (the one matching the dropdown); the other unit's field is omitted
- Load detects which field is populated and restores the dropdown accordingly
- Mode switch clears both input values (a fraction value ≠ an agent-multiple value); show subtle warning
- Per-input client-side validation:
  - Fraction mode: 0-1 range
  - Agent-multiple mode: ≥ 0
  - Sequential ≤ parallel (same mode, enforced by dropdown coupling)
- Submit button disabled while any error is present

**Backward compat (Zod preprocess):**
- `budgetBufferAfterParallel: X` auto-maps to `minBudgetAfterParallelFraction: X`
- Same for sequential
- Old field is removed from output after transformation

## Phased Execution Plan

### Phase 1: Judge Model Upgrade (Qwen 2.5 7B) — IN PROGRESS

- [ ] Research Qwen 2.5 7B max temperature via web (OpenRouter/Qwen docs)
- [ ] Add `qwen-2.5-7b-instruct` entry to `src/config/modelRegistry.ts` MODEL_REGISTRY
  - Provider: openrouter
  - API model ID: `qwen/qwen-2.5-7b-instruct`
  - Input pricing: $0.04/M
  - Output pricing: $0.10/M
  - maxTemperature: TBD from research
  - supportsEvolution: true
- [ ] Update `DEFAULT_JUDGE_MODEL` in `modelRegistry.ts` from `qwen/qwen3-8b` to `qwen-2.5-7b-instruct`
- [ ] Add registry tests in `src/config/modelRegistry.test.ts`
- [ ] Verify `allowedLLMModelSchema` and `LLM_PRICING` pick up the new entry (both derive from registry)
- [ ] Test end-to-end via local evolution run
- [ ] Update `evolution/docs/cost_optimization.md` with new default + pricing
- [ ] Update `evolution/docs/strategies_and_experiments.md` with new default

### Phase 2: `parseWinner()` Fix (for future Qwen3-off support)

- [ ] Add **scoped** fallback pattern to `evolution/src/lib/shared/computeRatings.ts:parseWinner()`:
  - Pattern: `/^\s*your answer\s*:\s*\*{0,2}\s*([AB])\s*\*{0,2}/im` — requires the literal "Your answer:" prefix, not a blanket last-token scan
  - Must NOT introduce a generic "last A/B token" fallback (regression risk on natural-language responses like "A is better than B")
- [ ] Add unit tests in `computeRatings.test.ts` covering new patterns:
  - `"Your answer: B"` → `"B"`
  - `"Your answer: **B**\n\nText B is..."` → `"B"`
  - `"Your answer: A"` → `"A"`
  - `"your answer: b"` (lowercase) → `"B"`
  - `"Your answer:  A  "` (extra whitespace) → `"A"`
  - `"Your answer: B\r\n"` (CRLF line ending) → `"B"`
- [ ] Add **regression tests** — existing inputs that must continue to return the same result:
  - `"A"` → `"A"`
  - `"TIE"` → `"TIE"`
  - `"Text A is better"` → `"A"`
  - `"Text A is better than Text B"` → `"A"` (winner phrasing)
  - `"A is better than B"` → null or `"A"` (document current behavior, confirm unchanged)
  - `"Neither A nor B is good"` → null (confirm no false match)
  - `"Actually B makes more sense"` → null or `"B"` (document current behavior)
- [ ] Add negative tests confirming the new "Your answer:" pattern does NOT match:
  - `"Your answer depends on context"` (no colon-then-letter) → null
  - `"My answer is A"` (wrong prefix) → null

### Phase 3: Budget Floor Rename + Dual-Unit Support

#### 3a. Schema Changes (`evolution/src/lib/schemas.ts`)
- [ ] Add four new optional fields to `strategyConfigSchema`:
  - `minBudgetAfterParallelFraction?: number` (0-1)
  - `minBudgetAfterParallelAgentMultiple?: number` (positive number)
  - `minBudgetAfterSequentialFraction?: number` (0-1)
  - `minBudgetAfterSequentialAgentMultiple?: number` (positive number)
- [ ] Add Zod `preprocess` with **explicit precedence rules**:
  - If both legacy `budgetBufferAfterParallel` AND new `minBudgetAfterParallelFraction` are present → **new field wins**, drop legacy
  - If only legacy is present → copy legacy value to new field, drop legacy
  - Same logic for sequential
  - Always drop legacy fields from output (never return them to callers)
- [ ] Remove `budgetBufferAfterParallel` / `budgetBufferAfterSequential` from output schema
- [ ] Add refines (all must tolerate "unset on either side"):
  - Exactly one of parallel fraction/agentMultiple may be set (both unset is allowed)
  - Exactly one of sequential fraction/agentMultiple may be set (both unset is allowed)
  - Parallel and sequential must use same unit mode — **BUT** only enforced when BOTH phases have a value set. If sequential is fully unset (both fields null), any parallel mode is allowed. Same for parallel unset.
  - When both phase floors are set with same unit: `parallelValue >= sequentialValue`
- [ ] Add unit tests for every refine edge case:
  - Legacy field auto-migrates correctly
  - Legacy + new field present → new wins
  - Same mode violation rejected with clear message
  - Same-mode-unset-one-side passes
  - Both phases empty → valid (no floor)
  - Parallel fraction 0.4 + sequential fraction 0.5 → rejected (ordering)

#### 3b. Pipeline Logic (`runIterationLoop.ts`)
- [ ] Replace `parallelFloor = totalBudget * (cfg.budgetBufferAfterParallel ?? 0)` with lazy resolver:
  ```typescript
  function resolveParallelFloor(initialAgentCost: number): number {
    if (cfg.minBudgetAfterParallelFraction != null) return totalBudget * cfg.minBudgetAfterParallelFraction;
    if (cfg.minBudgetAfterParallelAgentMultiple != null) {
      // Defensive: guard against NaN / zero / negative agent cost
      if (!Number.isFinite(initialAgentCost) || initialAgentCost <= 0) return 0;
      return initialAgentCost * cfg.minBudgetAfterParallelAgentMultiple;
    }
    return 0;
  }
  ```
- [ ] Same for sequential, using `actualAvgCostPerAgent` only when `Number.isFinite(actualAvgCostPerAgent) && actualAvgCostPerAgent > 0`, else fall back to `initialAgentCost`
- [ ] Update existing call sites to use the resolvers

#### 3c. UI Changes

**UI Architecture Decision:**
The Budget Floors section is NOT expressible via the existing flat `FieldDef[]` FormDialog pattern (requires shared state across inputs, debounced server action, computed preview text). Use **one `type: 'custom'` FieldDef** that renders the entire Budget Floors composite section internally. This keeps existing FieldDef pattern intact for all other strategy fields.

- [ ] Create server action `estimateAgentCostPreviewAction` in **new file** `evolution/src/services/strategyPreviewActions.ts` (NOT in `costAnalytics.ts` — that file is for DB-backed analytics; this action is pure):
  - **IMPORTS and calls** the existing `estimateAgentCost()` from `evolution/src/lib/pipeline/infra/estimateCosts.ts` — must NOT reimplement the logic
  - Wrapped in `adminAction` for auth — admin-only access, same as all other evolution admin actions
  - Input: `{ generationModel, judgeModel, numVariants, maxComparisonsPerVariant, seedArticleChars? }`
  - Input validation via Zod:
    - `generationModel`, `judgeModel` must be from `allowedLLMModelSchema`
    - `numVariants` integer, 1-100
    - `maxComparisonsPerVariant` integer, 1-50
    - `seedArticleChars` integer, 100-100000, default 5000
  - Default strategy to `grounding_enhance` (most expensive of the 3 core strategies)
  - Default `poolSize` to `1` (single baseline at parallel dispatch time)
  - Returns `{ estimatedAgentCostUsd, assumptions: { seedChars, strategy, poolSize, maxComparisons } }`
  - Add assertion test: confirms server action imports `estimateAgentCost` (not reimplements)
- [ ] Update `src/app/admin/evolution/strategies/page.tsx` form:
  - **Single mode dropdown** at top of Budget Floors section: "Fraction of budget" | "Multiple of agent cost"
  - **Two input boxes** below: "Min budget after parallel" and "Min budget after sequential"
  - Both inputs share the current dropdown mode (dropdown value applies to both)
  - When mode = "Multiple of agent cost":
    - Render single cost preview header: "Estimated cost per generateFromSeedArticle: ~$X.XXXX"
    - Show assumption chip: "Based on: 5,000-char seed • grounding_enhance • pool=1 • 15 cmp"
    - Each input displays inline: `= ~$Y.YY floor` next to the value
    - Sequential floor preview tagged with "⚠ will adjust at runtime"
  - Mode dropdown change clears both input values; show subtle warning "Changing modes will reset values"
  - Per-input client-side validation:
    - Fraction mode: 0-1 range
    - Agent-multiple mode: ≥ 0
  - Cross-field validation on change:
    - Sequential value must be ≤ parallel value (show error on sequential input)
  - Submit button disabled while any error is present
  - Live preview uses debounced (300ms) server action call to `estimateAgentCostPreviewAction`
- [ ] On submit, write exactly one field per phase (matching dropdown); omit the other unit's field
- [ ] On load, detect which field is populated and restore dropdown accordingly:
  - Any `*Fraction` set → mode = "Fraction of budget"
  - Any `*AgentMultiple` set → mode = "Multiple of agent cost"
  - Nothing set → default to "Fraction of budget"
- [ ] **Composite field serialization (explicit)**:
  - `formInitial` must derive composite shape `budgetFloors: { mode, parallelValue, sequentialValue }` from the loaded config's 4 optional schema fields. Logic:
    ```typescript
    function deriveBudgetFloorsFormValue(cfg: StrategyConfig) {
      if (cfg.minBudgetAfterParallelAgentMultiple != null || cfg.minBudgetAfterSequentialAgentMultiple != null) {
        return { mode: 'agentMultiple', parallelValue: cfg.minBudgetAfterParallelAgentMultiple ?? null, sequentialValue: cfg.minBudgetAfterSequentialAgentMultiple ?? null };
      }
      return { mode: 'fraction', parallelValue: cfg.minBudgetAfterParallelFraction ?? null, sequentialValue: cfg.minBudgetAfterSequentialFraction ?? null };
    }
    ```
  - `handleFormSubmit` must expand composite back into the correct 2 of 4 schema fields:
    ```typescript
    function expandBudgetFloorsToConfig(v: { mode, parallelValue, sequentialValue }) {
      if (v.mode === 'fraction') {
        return { minBudgetAfterParallelFraction: v.parallelValue ?? undefined, minBudgetAfterSequentialFraction: v.sequentialValue ?? undefined };
      }
      return { minBudgetAfterParallelAgentMultiple: v.parallelValue ?? undefined, minBudgetAfterSequentialAgentMultiple: v.sequentialValue ?? undefined };
    }
    ```
  - Unit-test both functions with round-trip assertions (load→save→load should be identity for all mode combos)
- [ ] **Expand edit-mode fieldset**: currently `src/app/admin/evolution/strategies/page.tsx` edit dialog uses `createFields.slice(0, 2)` (name + description only). Update to include the new Budget Floors custom field so existing strategies can be edited. Verify no other edit-mode fields break from this change.
- [ ] Update `StrategyConfigDisplay.tsx` to render both units correctly:
  - If fraction set: "40% of budget ($0.400 of $1.00)"
  - If agentMultiple set: "2× agent cost (resolved at runtime)"

#### 3d. Tests
- [ ] Unit tests in `evolution/src/lib/schemas.test.ts`:
  - Legacy field auto-migration (old `budgetBufferAfterParallel: 0.4` → `minBudgetAfterParallelFraction: 0.4`)
  - Legacy + new both present → new wins, legacy dropped
  - Both-unit rejection per phase (error message asserted)
  - Same-mode-required across phases (error message asserted)
  - Same-mode constraint with one side unset → passes
  - Ordering constraint for same-mode values
  - Parallel unset + sequential set → valid
  - Empty config → valid (no floor)
- [ ] Unit tests for `resolveParallelFloor` / `resolveSequentialFloor`:
  - NaN / zero / negative `initialAgentCost` → returns 0
  - Sequential falls back to initial when `actualAvgCostPerAgent` is null/zero/NaN
- [ ] Unit tests for `estimateAgentCostPreviewAction`:
  - Returns `estimatedAgentCostUsd` and `assumptions` object
  - Admin auth enforced (non-admin rejected)
  - Input validation rejects out-of-range `numVariants`, `maxComparisonsPerVariant`, etc.
  - Assertion: calls `estimateAgentCost` (uses `jest.spyOn`)
- [ ] **Integration test** in new file `evolution/src/__tests__/integration/budget-floor-migration.integration.test.ts`:
  - Seed `evolution_strategies` row with legacy `config.budgetBufferAfterParallel: 0.4`
  - Read via `getStrategyDetailAction`, confirm preprocess maps to `minBudgetAfterParallelFraction: 0.4`
  - Seed a row with BOTH legacy and new field — confirm new wins
  - Snapshot 3+ real staging strategies into `__fixtures__/staging-strategies-2026-04-13.json` (checked in) — DO NOT re-fetch from staging at test time (CI must not depend on DB access)
  - Test parses each fixture through new schema, asserts all succeed
- [ ] Update `evolution-cost-estimation.integration.test.ts` fixtures to test both modes
- [ ] Update `admin-evolution-budget-dispatch.spec.ts` E2E for dropdown UX

#### 3e. Call-Site Audit & Rollback

**Deprecation strategy (not immediate removal):**
- [ ] **Phase 3 keeps legacy fields in OUTPUT schema for one release cycle** as deprecated aliases:
  - Output schema emits BOTH `minBudgetAfter*Fraction` (new primary) AND `budgetBufferAfter*` (legacy alias, populated from new)
  - Legacy alias marked `@deprecated` in schema comment
  - Only fraction-mode values can populate the legacy alias (agent-multiple mode has no legacy equivalent — legacy alias stays undefined in that case)
  - A follow-up PR (project `remove_legacy_budget_buffer_YYYYMMDD`) removes the aliases after one release
  - This enables true rollback: revert the new-field READ logic and the system still works off legacy-alias outputs
- [ ] **Call-site audit** — comprehensive grep patterns, not just the simple one:
  - `git grep -En 'budgetBufferAfter(Parallel|Sequential)'` — dot access and bare names
  - `git grep -En "['\"]budgetBufferAfter" -- '*.ts' '*.tsx' '*.json' '*.md'` — string literals, bracket access, JSON fixtures
  - `git grep -En 'bufferKey|bufferField|buffer_after'` — plausible indirect references
  - Include `__snapshots__/`, `*.json`, `docs/`, `evolution/docs/`, `.github/workflows/` in the search
  - Check test fixtures and snapshot files explicitly
- [ ] **Database impact scan** before merge:
  - Run on staging: `SELECT count(*) FROM evolution_strategies WHERE config ? 'budgetBufferAfterParallel' OR config ? 'budgetBufferAfterSequential'`
  - Run same query on prod (read-only) via `npm run query:prod`
  - Document row counts in PR description for reviewer context
- [ ] **Sub-PR split** (revised for coupling safety):
  - **Sub-PR 1 (combined 3a+3b)**: schema preprocess + pipeline resolver + legacy-alias output. Both read paths (new and legacy) work after this PR lands. No runtime behavior change.
  - **Sub-PR 2 (3c+3d)**: UI changes + tests. No schema changes.
  - **Rationale**: splitting 3a away from 3b would create a window where schema accepts new fields but pipeline still reads old field → silent 0-floor regression. Combined they are safe.
- [ ] **Rollback procedure** documented in each PR description:
  - If Sub-PR 1 fails post-merge: `git revert` the commit. Legacy field semantics return. No DB migration needed.
  - If Sub-PR 2 fails post-merge: `git revert`. Schema still works because Sub-PR 1 kept legacy aliases.

#### 3f. Docs
- [ ] Update `evolution/docs/cost_optimization.md`:
  - Rename section "Budget-Aware Dispatch"
  - Document dual-unit option with examples
  - Note lazy-resolution timing (parallel uses initial, sequential uses runtime)
- [ ] Update `evolution/docs/strategies_and_experiments.md` StrategyConfig table

### Phase 4: Timeline View for Invocations

**Architecture decisions:**
1. The new `InvocationTimelineTab` is NOT config-driven — it reads `execution_detail` directly. This is intentional (bespoke visualization). The config-driven Overview tab remains, so `detailViewConfigs.ts` must ALSO be updated to surface the new `durationMs` fields.
2. All new `durationMs` fields MUST be `.optional()` in Zod schemas — historical invocations (written before Phase 4) have no timing data and must still validate.
3. `InvocationBar` from `TimelineTab.tsx` is NOT parameterized for non-invocation data. Options:
   - **(A) Extract `<GanttBar>` primitive first** and have both TimelineTab and InvocationTimelineTab consume it
   - **(B) Duplicate positioning math** in the new component (simpler, some copy-paste)
   - **Choice: (A)** — extract `<GanttBar>` to `evolution/src/components/evolution/visualizations/GanttBar.tsx`, refactor TimelineTab to use it, then use it in InvocationTimelineTab. This is explicit scope, not implicit "reuse".

#### 4a. Timing Instrumentation
- [ ] Add timing capture in `evolution/src/lib/core/agents/generateFromSeedArticle.ts`:
  - Generation phase `durationMs` (Date.now() delta around generation LLM call)
  - Ranking phase `durationMs` (Date.now() delta around rankNewVariant())
- [ ] Add timing capture in `evolution/src/lib/pipeline/loop/rankSingleVariant.ts`:
  - Per-comparison `durationMs` (around `compareWithBiasMitigation()`)
  - Forward/reverse LLM call durations — wrap the `Promise.all` in `run2PassReversal()` to capture each call's timing independently

#### 4b. Schema Extensions (`evolution/src/lib/schemas.ts`)
- [ ] Extend `generateFromSeedComparisonSchema`:
  - Add `durationMs?: z.number().int().min(0).optional()` (total wall-clock for the comparison)
  - Nest timing under `forwardCall: { durationMs?: number }` and `reverseCall: { durationMs?: number }` to match existing nesting style (e.g., `generation: { cost, promptLength }`)
- [ ] Extend `generation` object — add `durationMs?: z.number().int().min(0).optional()`
- [ ] Extend `ranking` object — add `durationMs?: z.number().int().min(0).optional()`
- [ ] **All new fields must be optional** — confirm historical `execution_detail` JSONB rows from staging DB parse successfully
- [ ] Add integration test loading 5 historical invocations (without timing) and confirming schema accepts them

#### 4c. Config-Driven Detail Renderer Update
- [ ] Update `evolution/src/lib/core/detailViewConfigs.ts` — extend the `generate_from_seed_article` config to surface:
  - `generation.durationMs` (formatter: 'duration')
  - `ranking.durationMs` (formatter: 'duration')
  - Per-comparison `durationMs` column in the comparisons table
- [ ] This ensures the Overview tab shows timing alongside cost, preserving the config-driven contract

#### 4d. `<GanttBar>` Primitive Extraction
- [ ] Create `evolution/src/components/evolution/visualizations/GanttBar.tsx`:
  - Props: `{ startMs, durationMs, totalMs, color, label?, href?, tooltip?, failed? }`
  - Positioning: computes `leftPct = (startMs / totalMs) * 100`, `widthPct = max(0.5, min(100-leftPct, durationMs/totalMs*100))`
  - No knowledge of invocation-specific data shapes
- [ ] Refactor existing `InvocationBar` in `TimelineTab.tsx` to compose `GanttBar`
- [ ] Verify run-level TimelineTab still renders identically (snapshot test)

#### 4e. InvocationTimelineTab Component
- [ ] Add `{ id: 'timeline', label: 'Timeline' }` tab to `InvocationDetailContent.tsx` (appears for `agent_name === 'generate_from_seed_article'` invocations only)
- [ ] Create `evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx`:
  - Reads `execution_detail` from the invocation prop
  - Two-segment phase bar (generation blue, ranking purple) using `<GanttBar>`
  - Below the phase bar: stacked per-comparison sub-bars within the ranking segment
  - **Running-invocation handling**: if `invocation.duration_ms` is null (still running), show "Invocation in progress" placeholder; if `ranking.durationMs` is null but `generation.durationMs` is set, show just the generation bar
  - **Missing-timing fallback**: if `execution_detail.ranking.comparisons[].durationMs` is undefined (pre-instrumentation invocation), compute each comparison's proportional share from total ranking duration and label: "Estimated from total (timing data unavailable)"
  - **Discarded-variant handling**: if `ranking` is null (variant was discarded), show only the generation segment with a "Discarded: reason" label
  - **Comparison count guard**: if more than 20 comparisons, group into buckets of ~5 with aggregate bars (prevents 30-segment illegibility for long binary searches)

#### 4f. Tests
- [ ] Unit test for `<GanttBar>` positioning math (snapshot)
- [ ] **Snapshot assertion** for existing TimelineTab after `<GanttBar>` refactor — axis ticks must still align with the 3 flanking columns (label w-32, duration w-14, cost w-16). Use a side-by-side comparison test.
- [ ] Unit tests for `InvocationTimelineTab` with **9 adversarial fixture scenarios**:
  1. **Happy path** — complete invocation with full timing (3 comparisons, all durations present)
  2. **Running invocation** — null duration_ms, partial execution_detail (generation only)
  3. **Pre-instrumentation historical** — no durationMs fields anywhere, proportional-share fallback engages
  4. **Discarded variant** — ranking is null, only generation segment rendered
  5. **Quick convergence** — 3-comparison binary search (early exit on converged)
  6. **Full budget** — 20+ comparisons triggering the bucket-aggregation guard (>20 → buckets of ~5)
  7. **Partial comparison timing** — `forwardCall.durationMs` present, `reverseCall.durationMs` missing (one call errored)
  8. **Invariant violation** — `generation.durationMs > invocation.duration_ms` (clock skew); should not crash, should clamp or show warning
  9. **Zero-ms comparison** — `durationMs: 0` (sub-ms or bad data); should render with minimum 0.5% width
- [ ] Playwright E2E: seed a test invocation row with timing fixtures, open the invocation detail page, assert Timeline tab renders with correct bar count/colors
  - E2E uses DB transaction / test schema for seed teardown; fixture seeded via existing test helper `seedEvolutionRun()` (or extend if missing)
  - Teardown confirmed via `afterEach` cleanup that deletes the seeded run

### Phase 5: OSS 20B Reasoning Config (Optional)

- [ ] Add `reasoningConfig` field to `ModelInfo` in `modelRegistry.ts`
- [ ] Add `reasoningEffort` to `CallLLMOptions` in `llms.ts`
- [ ] Thread `reasoning_effort` through `callOpenAIModel` → OpenAI SDK request
- [ ] Thread through `LLMProvider`, `createEvolutionLLMClient`, and `LLMCompletionOptions`
- [ ] Default OSS 20B to `reasoning: 'low'` when used

#### Reasoning Token Billing Correctness
- [ ] **Verify and test** that `calculateLLMCost()` in `src/config/llmPricing.ts` correctly bills reasoning tokens for OSS 20B calls:
  - OpenRouter returns `usage.completion_tokens_details.reasoning_tokens` separately
  - Some providers include reasoning tokens within `completion_tokens`, others don't — OSS 20B via OpenRouter includes them in `completion_tokens` per our empirical data (903 output = 881 reasoning + 12 answer)
  - Confirm no double-billing or under-billing — add an assertion test with a mocked OpenRouter response
- [ ] Add unit test: mocked OpenAI SDK client returns response with reasoning tokens, verify:
  - `reasoning_effort` parameter is present in request payload
  - `estimated_cost_usd` correctly reflects actual reasoning + completion tokens
  - `raw_api_response` captures reasoning token counts for observability

### Phase 6: Documentation & Finalize

- [ ] Update `evolution/docs/rating_and_comparison.md` — link to judging_accuracy research
- [ ] Run lint, tsc, build, unit tests
- [ ] Run integration tests
- [ ] Run critical E2E tests

## Testing

### Unit Tests
- [ ] `src/config/modelRegistry.test.ts` — Qwen 2.5 7B entry, pricing, maxTemp, default judge
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` — parseWinner cases for "Your answer: X"
- [ ] `evolution/src/lib/schemas.test.ts` — renamed budget buffer fields

### Integration Tests
- [ ] `src/__tests__/integration/evolution-cost-estimation.integration.test.ts` — renamed fields
- [ ] New: `evolution/src/__tests__/integration/judge-model-routing.integration.test.ts`:
  - **Mocks** `callOpenAIModel` — does NOT hit real OpenRouter
  - Asserts that when `judgeModel: 'qwen-2.5-7b-instruct'` is in strategy config, `callLLM` passes API model `qwen/qwen-2.5-7b-instruct` to the OpenRouter client
  - Asserts `isOpenRouterModel()` returns true for the new model ID
- [ ] New: `evolution/src/__tests__/integration/budget-floor-migration.integration.test.ts` (see Phase 3d for full details)

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-budget-dispatch.spec.ts` — renamed fields
- [ ] New: smoke test an evolution run using Qwen 2.5 7B as judge — **mocks the LLM layer** (no real OpenRouter calls in CI). Use existing `mockLLMProvider` test helper. Real-OpenRouter smoke is a manual/nightly step only.

### Manual Verification
- [ ] Run local evolution with `--model qwen-2.5-7b-instruct` and verify successful comparisons
- [ ] Verify admin UI shows new default judge in strategy creation dropdown
- [ ] View a generate_from_seed_article invocation detail page with new Timeline tab

## Verification

### A) Playwright Verification
- [ ] Admin UI strategy creation page shows Qwen 2.5 7B in judge model dropdown
- [ ] Invocation detail page has working Timeline tab

### B) Automated Tests
- [ ] `npm run test:unit` — all unit tests pass
- [ ] `npm run lint && npm run typecheck && npm run build`
- [ ] `npm run test:integration -- modelRegistry` — registry integration tests
- [ ] `npx playwright test admin-evolution-budget-dispatch.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/cost_optimization.md` — new default judge, pricing entry, budget buffer rename
- [ ] `evolution/docs/strategies_and_experiments.md` — new default judge
- [ ] `evolution/docs/rating_and_comparison.md` — link to judging_accuracy research
- [ ] `evolution/docs/visualization.md` — new Timeline tab on invocation detail
- [ ] `evolution/docs/agents/overview.md` — per-phase timing instrumentation (if worth documenting)

## Review & Discussion

### Empirical Data Supporting Decisions

From `docs/research/judge_agreement_summary_tables.md` (800 LLM calls tested):

**Why Qwen 2.5 7B as default:**
- 100% decisive on large gap (A-vs-B) at all 4 temperatures
- 100% decisive on close pair (C-vs-D) at all 4 temperatures (only temp=1.0 had slightly lower 0.93 conf)
- Median latency 1.5-1.9s across all conditions
- Average 3 output tokens per comparison (2 LLM calls)
- Zero reasoning tokens — no thinking mode overhead
- **$0.000270 per comparison** — cheapest judge tested with 100% decisiveness

**Cost comparison for 100-comparison run:**
| Judge | Cost |
|-------|-----:|
| qwen-2.5-7b-instruct | $0.027 |
| qwen3-off (with parser fix) | $0.034 |
| qwen3-on (current default) | $0.070 |
| gpt-4.1-nano | $0.068 |
| deepseek-chat | $0.189 |
| gpt-4.1-mini | $0.272 |

Switching from Qwen3 ON to Qwen 2.5 7B cuts judge cost by **~60%** AND speeds up evolution runs by **~4-5x** (by removing ~7s of thinking overhead per comparison).

---

### Plan Review Results

Reviewed via `/plan-review` multi-agent loop. Consensus reached in **3 iterations**.

| Iteration | Security/Technical | Architecture/Integration | Testing/CI | Critical Gaps |
|-----------|:------------------:|:-----------------------:|:----------:|:-------------:|
| 1 | 3/5 | 2/5 | 3/5 | 14 |
| 2 | 5/5 | 4/5 | 4/5 | 6 |
| 3 | **5/5** | **5/5** | **5/5** | **0** ✅ |

### Minor-Issue Backlog (Address During PR Review)

Not blocking execution but should be handled:

- **parseWinner word boundary** — add `(?![A-Za-z])` after the `[AB]` capture to guard against `"Your answer: Apple"` → `"A"` misclassification
- **Legacy alias agent-multiple gap** — agent-multiple mode strategies don't populate legacy aliases; any rollback after Sub-PR 2 loses the floor for those strategies. Mitigations:
  - Feature-flag agent-multiple UI submission until one release after Sub-PR 1 lands
  - Document this as a known rollback caveat in Sub-PR 2's description
  - Add pre-merge DB scan to confirm zero prod strategies use agent-multiple before the legacy-removal PR ships
- **Fixture sanitization** — when checking in `__fixtures__/staging-strategies-2026-04-13.json`, redact any names/descriptions that could be PII and document the selection criteria (which 3 rows, why)
- **Mock seam consistency** — document that LLM mocks stub at `callLLM` boundary; provider-routing tests stub one layer lower at `callOpenAIModel`
- **Preview request race condition** — `estimateAgentCostPreviewAction` debounced 300ms; UI should track request-id to discard out-of-order responses
- **Phase 5 reasoning billing edge cases** — test that `completion_tokens_details` absence (older provider responses) doesn't produce NaN cost
- **Axis-tick alignment** — consider Playwright visual regression for the TimelineTab refactor (Tailwind class snapshot won't catch pixel drift)
- **`npm run query:prod` DB scan** — label as manual pre-merge check in PR template, not a CI step
- **Composite FieldDef dirty state** — verify form-dirty/reset-to-initial behavior works in edit mode
- **invariant assertion** — in `deriveBudgetFloorsFormValue`, add an assertion that both fraction-mode fields and agent-multiple-mode fields aren't simultaneously set (shouldn't happen post-schema-refine but worth a defensive log)
