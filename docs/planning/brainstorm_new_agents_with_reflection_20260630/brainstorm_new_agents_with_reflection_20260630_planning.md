# Brainstorm New Agents With Reflection Plan

## Background
Build a single prototype agent — `self_critique_revise` — that adapts the proven "reflection-as-selection" pattern to a new use case: instead of requiring an operator to populate `evolution_criteria` rows per topic, the agent self-generates 2-3 article-specific weaknesses on every parent and feeds those as a `customPrompt` to `GenerateFromPreviousArticleAgent` (GFPA). Recent analyses (2026-06-28) show the criteria-family agents (`criteria_and_generate`, `single_pass_criteria`, `iterative_editing`) lead density (`%var>seed` 76-81%) while vanilla `generate` lags at 64%. The hypothesis: the criteria-family's edge comes from the *structure* "list weaknesses → customPrompt → regenerate", not from the specific criteria-table content. If true, self-generated critique should match or beat the criteria-family without operator setup — becoming the default cheap-and-flexible agent for any new topic.

This project was originally scoped to three reflection-driven prototypes (`reflect_and_localize`, `reflect_and_rewrite_diff`, `self_critique_revise`); **on 2026-06-30 the scope was reduced to just `self_critique_revise`** to ship a focused validation. The other two designs remain captured in `_research.md` as deferred follow-ups.

## Requirements (from GH Issue #1324, revised 2026-06-30)
Build a prototype `self_critique_revise` evolution agent with rigorous tests (including at least one end-to-end test) that:
- Self-generates 2-3 article-specific weaknesses on every parent (no `evolution_criteria` table dependency)
- Feeds those weaknesses as a `customPrompt` to GFPA
- Reuses existing wrapper patterns from `SinglePassEvaluateCriteriaAndGenerateAgent`
- Works as a drop-in iteration type in any strategy

## Problem
The criteria-family agents lead density on recent evolution analyses (76-81% `%var>seed`) but require an operator to pre-populate `evolution_criteria` rows per topic before the agent can run. This is friction every time we onboard a new topic. The static criteria also can't capture article-specific weaknesses — the table is generic; the article is not. We need an agent with the same shape as `single_pass_criteria` but with the "what's wrong" signal self-generated from the LLM reading the actual parent article.

## Architecture Analysis

### What we are reusing
The agent is a wrapper over `GenerateFromPreviousArticleAgent`, structurally identical to `SinglePassEvaluateCriteriaAndGenerateAgent`. ~70% of the code is mechanical copy from `singlePassEvaluateCriteriaAndGenerate.ts`; the novel code is one prompt builder, one parser, one customPrompt builder (near-clone), and one Zod schema.

**Direct reuse from `SinglePassEvaluateCriteriaAndGenerateAgent`:**
- The `Agent.run()` template method (base in `evolution/src/lib/core/Agent.ts`)
- The `costBeforeCombined = ctx.costTracker.getOwnSpent?.() ?? 0` snapshot pattern (`singlePassEvaluateCriteriaAndGenerate.ts:172`)
- The custom-error class shape (`EvaluateAndSuggestLLMError`, `EvaluateAndSuggestParseError`)
- The partial-detail-before-rethrow pattern on every throw path (~6 sites in the existing file)
- The inner GFPA dispatch via `.execute()` not `.run()` (line 315)
- The `buildSinglePassCustomPromptFromSuggestions` template (lines 60-107)
- The `SINGLE_PASS_HIGH_ELO_THRESHOLD = 1300` constant + high-Elo guidance block — verbatim reuse
- The `lengthCapHit` telemetry computation (line 346)
- The `registerAttributionExtractor` registration at the file's tail

**Novel code:**
- `buildSelfCritiquePrompt(parentText): string` — asks LLM to list 2-3 issues with example passages + fixes
- `parseSelfCritique(response, parentText): {issues, droppedIssueCount}` — tolerant parser with soft `examplePassage ∈ parentText` check
- `buildSelfCritiqueCustomPromptFromIssues(issues, opts?: {highEloParent?}): {preamble, instructions}` — near-clone of `buildSinglePassCustomPromptFromSuggestions`
- `selfCritiqueReviseExecutionDetailSchema` in `schemas.ts`
- `SelfCritiqueReviseAgent extends Agent<...>` class

### Shared scaffolding the agent leverages

| Surface | Existing pattern we copy | New code |
|---|---|---|
| Agent class | `Agent.run()` template method | `name` field + `execute()` body (~150 LOC, ~70% mechanical copy) |
| Cost snapshot | `costBeforeCombined` (`singlePassEvaluateCriteriaAndGenerate.ts:172`) | Same line, renamed `costBeforeCritique` |
| Custom errors | `EvaluateAndSuggestLLMError` + `EvaluateAndSuggestParseError` | `SelfCritiqueLLMError`, `SelfCritiqueParseError` |
| Partial-detail-before-rethrow | every throw path persists partial detail via `updateInvocation` | Mechanical copy |
| Inner dispatch | `await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx)` | Same call |
| Schema | `evolution/src/lib/schemas.ts:2154` (singlePass schema as template) | New `selfCritiqueReviseExecutionDetailSchema` |
| AgentName label | `evolution/src/lib/core/agentNames.ts` | One new label `self_critique`, mapped to new umbrella `self_critique_cost` |
| Cost metric | `METRIC_CATALOG` (`evaluation_cost` line 53 as template) | `self_critique_cost` + `total_self_critique_cost` + `avg_self_critique_cost_per_run` |
| Cost calibration | DB CHECK `evolution_cost_calibration_phase_allowed` | One migration adding `'self_critique'` |
| Iteration enum | `iterationConfigSchema.agentType` | One new entry `'self_critique_revise'` + `.superRefine` (no special fields like `criteriaIds` — much simpler than criteria agents) |
| Dispatch branch | `runIterationLoop.ts:361` conjunction | One enum value added + one dispatch branch in `dispatchOneAgent` |
| Cost projector | `estimateAgentCost(...)` in `projectDispatchPlan.ts` | New `useSelfCritique: boolean` flag adding ~$0.0005 to the estimate |
| Attribution extractor | `registerAttributionExtractor(...)` | Returns literal `'self_critique'` (single bucket — see Attribution decision below) |
| Tactic registry | `evolution/src/lib/core/tactics/generateTactics.ts` | One marker tactic `self_critique_driven` |
| Detail view | `DETAIL_VIEW_CONFIGS` in `detailViewConfigs.ts` | Per-agent field config |
| Kill switch | env var pattern like `EVOLUTION_SINGLE_PASS_CRITERIA_ENABLED` | `EVOLUTION_SELF_CRITIQUE_ENABLED` (default `'true'`) |

### Algorithm summary

1. **Self-critique LLM call** (`AgentName: 'self_critique'`). Prompt: read article, list 2-3 specific weaknesses, each with verbatim example passage + concrete fix.
2. **Parse with `parseSelfCritique`** — tolerant. Returns `{issues, droppedIssueCount}` with `1 ≤ issues.length ≤ 5` (cap with warn at >5). Drops entries missing `examplePassage` or `fix`. Soft-checks `examplePassage` substring-appears in `parentText` (case + whitespace normalized); sets `exampleMatchedParent: boolean`, warn-logs on miss, does NOT throw. Throws `SelfCritiqueParseError` if zero valid issues survive.
3. **Build customPrompt** via `buildSelfCritiqueCustomPromptFromIssues` — near-clone of `buildSinglePassCustomPromptFromSuggestions`. Three diffs from the original: numbered `Issue/Example/Fix` blocks instead of `Criterion` blocks; same Length/Redundancy/Flow soft directives verbatim; same high-Elo guidance block verbatim (gated by `SELF_CRITIQUE_HIGH_ELO_THRESHOLD = 1300`).
4. **Delegate to `GenerateFromPreviousArticleAgent.execute()`** with `tactic: 'self_critique_driven'` (new marker tactic) and the customPrompt. NO `criteriaSetUsed` / `weakestCriteriaIds` — those are criteria-family fields.
5. **Merge detail** — wrap GFPA's `generation` + `ranking` sub-objects under our `critique` sub-object. Recompute `totalCost = critiqueCost + gfpaDetail.totalCost`.
6. **Forward GFPA's `failure` signal** (D1 invariant) — hard-fails (402, format-rejection, unknown tactic) flow up so the wrapper invocation gets `success=false` with the right error code.
7. **Compute `lengthCapHit`** post-hoc — `generated.textLength / parentText.length > 1.10`. Observational only; doesn't gate the variant.

### Schema shape

```ts
{
  detailType: 'self_critique_revise',
  tactic: 'self_critique_driven',
  critique: {
    issues: [{
      text: string,                     // ≤ 200 chars — one-sentence weakness description
      examplePassage: string,            // ≤ 300 chars — verbatim quote from article
      fix: string,                       // ≤ 300 chars — concrete fix direction
      exampleMatchedParent?: boolean,
    }],
    issueCount: int,                     // = issues.length
    droppedIssueCount?: int,             // entries the parser rejected (missing example or fix)
    rawResponse?: string,
    parseError?: string,
    durationMs?: int,
    cost?: number,
  },
  generation?: {...},                    // reused from GFPA
  ranking?: {...},                       // reused from GFPA
  totalCost: number,                     // = critiqueCost + gfpaDetail.totalCost
  surfaced: boolean,
  discardReason?: {...},
  guardrails: {
    lengthCapHit: boolean,              // generated.textLength / parentText.length > 1.10
  },
}
```

### Attribution dimension
**Literal `'self_critique'` single bucket** for the prototype. The per-issue forensics live in `execution_detail.critique.issues[]` for SQL slicing. If staging shows that one TYPE of issue consistently drives improvement (e.g. "hedge words", "missing examples"), we revisit and classify into a small enum. Premature classification would be guessing.

### Cost stack
| Step | Estimate |
|---|---|
| Self-critique LLM call | ~$0.0005 (parent in, ~400 toks out — 3 issues × ~130 toks) |
| GFPA generate | Same as vanilla generate (~$0.002) |
| GFPA ranking | Same as vanilla generate (~$0.002) |
| **Total per variant** | **~$0.005** |

~1× GFPA cost + ~10% self-critique premium. Closely matches `single_pass_criteria`'s observed staging cost (~$0.004/variant in 2026-06-28 data: $0.964 spent across 10 runs producing 241 ranked variants).

### What we will NOT build (out of scope)
- **No new judge mode.** Article-mode comparisons only.
- **No rubric-judging integration.** Holistic-judge-compatible only; `judgeRubricId` integration deferred.
- **No new entity tables.** Everything fits in existing tables.
- **No DB migration except the cost-calibration phase enum extension.** Mechanical, same shape as past migrations.
- **No issue-categorization enum at attribution level.** Single-bucket attribution; per-issue forensics via execution_detail.
- **No multi-cycle loop.** Single critique → single regenerate.
- **No deferred `reflect_and_localize` or `reflect_and_rewrite_diff` work.** These remain in `_research.md` as deferred follow-ups; if the prototype succeeds, they re-enter scope as a follow-up project.

## Options Considered (rescoping decision, 2026-06-30)

- [x] **Option A: All three reflection-driven prototypes.** — Original scope. Pro: comprehensive validation of the reflection-as-selection-onto-editing pattern. Con: 3× implementation cost, scattered staging signal, longer time to first result. **Reduced** to the highest-confidence prototype.
- [x] **Option B: Agent 3 only (`self_critique_revise`).** — Pro: simplest of the three (~70% mechanical copy from singlePass), tests the cleanest hypothesis (criteria-family edge without operator setup), fastest to staging signal, single A/B vs vanilla `generate` + `reflect_and_generate` gives a clean read. Con: leaves the location-targeted (Agent 1) and edit-style (Agent 2) hypotheses untested. **CHOSEN** — focused validation first; the others stay in `_research.md` for follow-up if Agent 3 succeeds.
- [ ] **Option C: Agent 3 + Agent 1 (drop Agent 2).** — Pro: covers regenerate-style + location-targeted. Con: Agent 1 still has design risk (parallel blind rewrites) that's better validated alone. **Rejected** for prototype.

## Phased Execution Plan

### Phase 0: Final research polish
- [ ] Read `evolution/docs/cost_optimization.md` (cost calibration table + V2CostTracker semantics)
- [ ] Read `evolution/docs/metrics.md` (METRIC_CATALOG + propagation)
- [ ] Read `src/__tests__/integration/evolution-pipeline.integration.test.ts` or whichever singlePass-related integration test exists for the test pattern
- [ ] Decide: critique model = generation model? **Default decision: reuse `generationModel` (consistent with all existing wrapper agents); revisit after staging signal.**

### Phase 1: Shared scaffolding
- [ ] Extend `iterationConfigSchema.agentType` enum in `evolution/src/lib/schemas.ts` to include `'self_critique_revise'`. Add `.superRefine` rules: variant-producing; first-iter allowed; no criteria-table fields (`criteriaIds` / `weakestK` REJECTED on this agentType); standard `sourceMode` + `qualityCutoff` support.
- [ ] Add `self_critique_cost` umbrella metric to `METRIC_CATALOG` in `evolution/src/lib/core/metricCatalog.ts` + `total_self_critique_cost` + `avg_self_critique_cost_per_run` propagated counterparts.
- [ ] Extend `AGENT_NAMES` in `evolution/src/lib/core/agentNames.ts` with `'self_critique'`. Add `COST_METRIC_BY_AGENT` entry mapping `self_critique` → `self_critique_cost`.
- [ ] Add `OUTPUT_TOKEN_ESTIMATES['self_critique'] = 400` entry (wherever the registry lives — likely in `createEvolutionLLMClient.ts`).
- [ ] Create migration `evolution/supabase/migrations/<ts>_self_critique_phase.sql` extending `evolution_cost_calibration_phase_allowed` CHECK with `'self_critique'`. Mirror `20260527000004` shape.
- [ ] Register `self_critique_driven` marker tactic in `evolution/src/lib/core/tactics/generateTactics.ts`. Run `evolution/scripts/syncSystemTactics.ts` against staging.
- [ ] Unit tests: `iterationConfigSchema` accepts `'self_critique_revise'`, rejects `criteriaIds` on this agentType, `COST_METRIC_BY_AGENT` complete, `isValidTactic('self_critique_driven')` returns true.

### Phase 2: SelfCritiqueReviseAgent
- [ ] Add `selfCritiqueReviseExecutionDetailSchema` to `evolution/src/lib/schemas.ts` (use the singlePass schema at line 2154 as template; swap `weakestCriteriaIds` / `weakestCriteriaNames` / `evaluateAndSuggest` for the `critique` sub-object).
- [ ] Create `evolution/src/lib/core/agents/selfCritiqueRevise.ts`:
  - Custom errors: `SelfCritiqueLLMError`, `SelfCritiqueParseError`
  - Export `SELF_CRITIQUE_HIGH_ELO_THRESHOLD = 1300` constant (mirrors singlePass; see file for the empirical justification)
  - `buildSelfCritiquePrompt(parentText): string` — instructs LLM to list 2-3 specific weaknesses with verbatim examples + fixes
  - `parseSelfCritique(response, parentText): {issues, droppedIssueCount}` — tolerant parser. Returns `1 ≤ issues.length ≤ 5`. Drops entries missing `examplePassage` or `fix`. Soft-checks `examplePassage` substring-appears in `parentText` (case + whitespace normalized); sets `exampleMatchedParent: boolean`, warn-logs on miss, does NOT throw. Throws `SelfCritiqueParseError` if zero valid issues survive after filtering.
  - `buildSelfCritiqueCustomPromptFromIssues(issues, opts?: {highEloParent?}): {preamble, instructions}` — near-clone of `buildSinglePassCustomPromptFromSuggestions`. Three diffs: Issue/Example/Fix blocks instead of Criterion blocks; same Length/Redundancy/Flow directives verbatim; same high-Elo guidance verbatim.
  - `SelfCritiqueReviseAgent extends Agent<...>` class with `execute()`:
    1. self-critique LLM call + parse (`costBeforeCritique` snapshot, partial-detail-on-throw)
    2. Lookup parent Elo from `input.initialRatings.get(input.parentVariantId)?.elo` → `highEloParent` flag
    3. Build customPrompt
    4. `await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx)` with `tactic: 'self_critique_driven'` + customPrompt
    5. Compute `lengthCapHit` post-hoc
    6. Merge detail + forward `failure` signal
  - Attribution extractor: returns literal `'self_critique'`
- [ ] Add `DETAIL_VIEW_CONFIGS.self_critique_revise` in `evolution/src/lib/core/detailViewConfigs.ts` — render critique.issues as a table (text / example / fix / exampleMatchedParent badge) + generation + ranking sub-objects + lengthCapHit indicator.
- [ ] Unit tests `selfCritiqueRevise.test.ts`:
  - Prompt builder includes "be specific to THIS article — not generic writing advice" + verbatim-quote instruction
  - Parser: 1 issue ✓, 3 issues ✓, 5 issues ✓, 6+ issues → truncated to 5 with warn, missing example → entry dropped, missing fix → entry dropped, example matches parent → `exampleMatchedParent=true`, example doesn't match → `exampleMatchedParent=false` + warn, all entries invalid → throws, empty response → throws, whitespace + smart-quote variation tolerated
  - `buildSelfCritiqueCustomPromptFromIssues`: includes all 3 directives verbatim (Length/Redundancy/Flow), high-Elo block fires when `highEloParent=true`, NOT when `false` or omitted
  - `execute()` happy path (mocked LLM via `v2MockLlm`): critique + GFPA both succeed → variant produced + ranked, totalCost includes critique + GFPA, `lengthCapHit` computed
  - `execute()` high-Elo parent path: customPrompt includes the surgical-edits-only block when parent Elo > 1300
  - `execute()` critique-LLM-throws path: partial detail persisted before re-throw (critique sub-object populated with `cost` + `durationMs`)
  - `execute()` critique-parse-fails path: partial detail persisted with `rawResponse` + `parseError`
  - `execute()` GFPA-throws path: partial detail persisted with full critique sub-object + GFPA's `cost` so far
  - `execute()` GFPA-failure-forwarded path: GFPA's `failure: {code, message}` returned in the wrapper's output (D1 invariant)
  - `execute()` lengthCapHit telemetry: `true` when generated > 1.10× parent, `false` otherwise
- [ ] Property test `selfCritiqueRevise.property.test.ts` — fuzz parser with `fast-check`:
  - Valid generated input (N issues with example + fix in correct format) → returns `issues.length === min(N, 5)`
  - Random text → either parses validly or throws (never invalid state)
- [ ] Invariant tests `selfCritiqueRevise.invariants.test.ts`:
  - Inner GFPA called via `.execute()` not `.run()` (no nested AgentCostScope)
  - `costBeforeCritique` snapshot before any LLM call
  - Every throw path persists partial detail via `updateInvocation`
  - GFPA `failure` forwarded (not swallowed)
  - Detail schema validates produced detail object on all 5 paths (happy / critique-throw / parser-throw / GFPA-throw / GFPA-failure-forward)
- [ ] Integration test `src/__tests__/integration/evolution-self-critique.integration.test.ts`:
  - Seed test prompt + strategy (1×self_critique_revise iteration, mocked LLM via `v2MockLlm` returning a 3-issue critique then a valid GFPA rewrite)
  - Trigger pipeline via `claimAndExecuteRun`
  - Assert: ≥1 invocation with `agent_name='self_critique_revise'`, variant produced + ranked, `self_critique_cost` metric > 0, `parent_variant_ids[0]` = seed variant id, `execution_detail.critique.issueCount === 3`, `execution_detail.critique.issues[0].exampleMatchedParent` field present (true or false), `execution_detail.guardrails.lengthCapHit` field present

### Phase 3: Dispatch wiring
- [ ] Extend the variant-producing conjunction at `runIterationLoop.ts:361` to include `'self_critique_revise'`.
- [ ] Add a new dispatch branch in `dispatchOneAgent` mirroring the `single_pass_evaluate_criteria_and_generate` branch — constructs `SelfCritiqueReviseAgent` and calls `.run({parentText, parentVariantId, initialPool, initialRatings, initialMatchCounts, cache, llm})`. NO criteria-related fields in the input.
- [ ] Extend `estimateAgentCost(...)` in `projectDispatchPlan.ts` to accept `useSelfCritique: boolean` flag, adding ~$0.0005 to the estimate per agent.
- [ ] Wire kill-switch env read (`EVOLUTION_SELF_CRITIQUE_ENABLED`) at iteration entry — short-circuits to zero dispatch on `'false'` with a warn log.
- [ ] Unit test `runIterationLoop.test.ts` (extension): dispatches `SelfCritiqueReviseAgent` for the new iter type, honors `sourceMode` + `qualityCutoff` like generate, kill switch zero-dispatches when env var is `'false'`.

### Phase 4: Wizard UI
- [ ] In `src/app/admin/evolution/strategies/new/page.tsx` extend the `agent-type-select-<i>` `<option>` list to include `'self_critique_revise'` (display label: **"Self-Critique + Revise"**).
- [ ] First-iteration dropdown: enabled (can run on empty pool — operates on seed).
- [ ] No new per-iteration controls — uses standard `sourceMode` + `qualityCutoff`.
- [ ] Wizard E2E (lightweight, in the existing wizard describe block in `admin-evolution-iterative-editing.spec.ts:360+` or similar): asserts the new option appears, can be selected, no unrelated controls render.

### Phase 5: End-to-end test
- [ ] Create `src/__tests__/e2e/specs/09-admin/admin-evolution-self-critique-pipeline.spec.ts` — mirror `admin-evolution-iterative-editing.spec.ts` structure:
  - `@evolution` tag, `pipeline-lock` guarded, 600s timeout
  - `beforeAll`: seed strategy (1×self_critique_revise iteration, $0.05 budget, `deepseek-v4-flash` for both gen + judge), seed prompt + experiment + run, trigger via `/api/evolution/run` with cookie auth, poll for `evolution_runs.status='completed'` (max 300s)
  - Test 1: ≥1 invocation with `agent_name='self_critique_revise'` exists, `execution_detail` validates against the schema
  - Test 2: ≥1 variant produced with `parent_variant_ids` pointing at the seed
  - Test 3: `self_critique_cost` metric on the run > 0
  - Test 4: `subagent:ranking.cost` metric on the run > 0 (ranking ran via GFPA)
  - Test 5: variant's `mu` deviated from default 25 (post-ranking sanity)
  - `afterAll`: release pipeline lock; cleanup via `trackEvolutionId`

### Phase 6: Final verification
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test` (full unit suite)
- [ ] `npm run test:esm`
- [ ] `npm run test:integration` (full integration suite)
- [ ] `npm run test:e2e:critical` (smoke)
- [ ] `npm run test:e2e:evolution` (new spec + existing)
- [ ] `npm run test:hooks`
- [ ] `npm run migration:verify` (Docker postgres on the new cost-calibration migration)
- [ ] `npm run test:gate` (writes `.claude/test-pass.json` for HEAD)
- [ ] Smoke-test on staging: run the agent against `federal_reserve_2` with $0.05 budget via the admin UI; visually inspect the invocation detail page (critique issues table + generation sub-object + ranking sub-object); confirm tactic leaderboard shows `self_critique_driven` marker; confirm strategy wizard dropdown surfaces "Self-Critique + Revise".

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/selfCritiqueRevise.test.ts` — prompt builder, parser, customPrompt builder, execute() happy + failure paths
- [ ] `evolution/src/lib/core/agents/selfCritiqueRevise.invariants.test.ts` — `.execute()` not `.run()`, cost snapshot, partial-detail persistence, failure-forwarding
- [ ] `evolution/src/lib/core/agents/selfCritiqueRevise.property.test.ts` — fast-check fuzzing on parser
- [ ] `evolution/src/lib/schemas.test.ts` (extension) — new enum value, refinement rules
- [ ] `evolution/src/lib/core/agentNames.test.ts` (extension) — `self_critique` label routed to `self_critique_cost`
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` (extension) — dispatch branch for the new type

### Integration Tests
- [ ] `src/__tests__/integration/evolution-self-critique.integration.test.ts` — full pipeline with mocked LLM, variant produced, cost metric written

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-self-critique-pipeline.spec.ts` — real LLM, `@evolution`, asserts variants + cost + ranking
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` (extension) — add a wizard test that the new option appears in the agent-type dropdown

### Manual Verification
- [ ] On staging, run the agent against `federal_reserve_2` ($0.05 budget) and visually inspect the invocation detail page (critique issues list + GFPA generation + ranking).
- [ ] Confirm tactic leaderboard at `/admin/evolution/tactics` shows the new `self_critique_driven` marker.
- [ ] Confirm strategy wizard dropdown surfaces "Self-Critique + Revise" under its display label.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Strategy wizard dropdown shows the new agent type option (covered by wizard test in Phase 4)

### B) Automated Tests
- [ ] `npm run test -- --testPathPattern 'selfCritiqueRevise'`
- [ ] `npm run test:integration -- --testPathPattern 'evolution-self-critique'`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-self-critique-pipeline.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/agents/overview.md` — add a `SelfCritiqueReviseAgent` section after the existing `SinglePassEvaluateCriteriaAndGenerateAgent` section
- [ ] `evolution/docs/criteria_agents.md` — add a cross-reference to `self_critique_revise` as the criteria-table-free sibling
- [ ] `evolution/docs/strategies_and_experiments.md` — extend `IterationConfig.agentType` documentation table with the new type
- [ ] `evolution/docs/multi_iteration_strategies.md` — extend the iterationConfigSchema enum documentation
- [ ] `evolution/docs/metrics.md` — add the new `self_critique_cost` umbrella metric + propagated counterparts to the registry section
- [ ] `evolution/docs/reference.md` — env var section: add `EVOLUTION_SELF_CRITIQUE_ENABLED` kill switch

## Review & Discussion
_This section will be populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
