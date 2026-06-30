# Brainstorm New Agents With Reflection Plan

## Background
Build a single prototype agent — `self_critique_revise` — that lets an LLM **reflect freely on how to improve an article** (anything from minor edits to structural rework) and write a plan that drives `GenerateFromPreviousArticleAgent` (GFPA). Recent analyses (2026-06-28) show the criteria-family agents (`criteria_and_generate`, `single_pass_criteria`, `iterative_editing`) lead density (`%var>seed` 76-81%) while vanilla `generate` lags at 64%. The original hypothesis was that the criteria-family's edge comes from a structured "list 2-3 specific weaknesses → customPrompt → regenerate" pattern. **The broader hypothesis we're now testing**: the edge actually comes from the two-step *reflect-then-execute* shape — having the LLM read the article and write a plan before regenerating — not from the specific "enumerated weaknesses" content. By giving the LLM full latitude over scope (minor edits, targeted rewrites, structural reworks, mode shifts), we let it pick the *kind* of change that best fits the article instead of forcing the surgical-edits posture the criteria-family bakes in.

This project was originally scoped to three reflection-driven prototypes (`reflect_and_localize`, `reflect_and_rewrite_diff`, `self_critique_revise`); **on 2026-06-30 the scope was reduced to just `self_critique_revise`** to ship a focused validation, and **the design was broadened** the same day to remove the criteria-family-style "2-3 weaknesses" constraint in favor of free-form reflection. The other two designs remain captured in `_research.md` as deferred follow-ups.

## Requirements (from GH Issue #1324, revised 2026-06-30)
Build a prototype `self_critique_revise` evolution agent with rigorous tests (including at least one end-to-end test) that:
- Reflects freely on the parent article — LLM has full latitude over the kind of change (minor edits, targeted rewrites, structural rework, mode shifts, anything else it judges appropriate)
- Writes a structured plan (`changeKind` + `summary` + `plan`) that drives GFPA
- Reuses existing wrapper patterns from `SinglePassEvaluateCriteriaAndGenerateAgent`
- Works as a drop-in iteration type in any strategy
- No `evolution_criteria` table dependency — operator setup is zero

## Problem
The criteria-family agents lead density on recent evolution analyses (76-81% `%var>seed`) but: (1) require an operator to pre-populate `evolution_criteria` rows per topic, (2) lock the agent into a surgical-edits posture via the customPrompt's Length / Redundancy / Flow guardrails, and (3) the static criteria can't capture article-specific weaknesses — the table is generic; the article is not. We need an agent with the same wrapper shape as `single_pass_criteria` but where the "what to change" signal is self-generated AND the *scope* of change is the LLM's call (not pre-constrained to surgical edits).

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
- `buildSelfCritiquePrompt(parentText, parentElo?): string` — asks LLM to reflect freely on how to improve the article (any scope from minor edits to structural rework). Conditionally includes a high-Elo context note when `parentElo > SELF_CRITIQUE_HIGH_ELO_THRESHOLD = 1300`.
- `parseSelfCritique(response): {changeKind, summary, plan}` — tolerant parser for the 3-field reflection output. Throws when any required field is missing or empty.
- `buildSelfCritiqueCustomPromptFromReflection(reflection): {preamble, instructions}` — much simpler than the criteria-family equivalent; just embeds the reflection's `summary` + `plan`. No Length / Redundancy / Flow guardrails (those constrained scope; we no longer want to).
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

1. **Reflection LLM call** (`AgentName: 'self_critique'`). Prompt asks the LLM to read the article and reflect on how to improve it, with EXPLICIT freedom over scope:
   > *Reflect on how to improve this article. You have full latitude:*
   > - *Minor edits (tone shifts, hedge-word removal, transition smoothing)*
   > - *Targeted rewrites (rework specific paragraphs or sections)*
   > - *Structural rework (reorganize the article's argument or order)*
   > - *Mode shifts (e.g. abstract → concrete, theoretical → practical, dense → conversational)*
   > - *Anything else you judge would make the article stronger*
   
   Lookup parent Elo from `input.initialRatings.get(input.parentVariantId)?.elo`. If `parentElo > SELF_CRITIQUE_HIGH_ELO_THRESHOLD (1300)`, prepend a context note: *"This article currently has Elo {parentElo} in the pool. Aggressive restructuring of high-Elo articles has historically backfired — consider whether smaller targeted changes would land better before deciding on a major rework."* The reflector USES this context to scope its plan; the rewriter doesn't see this note.
   
   Required output format:
   ```
   ChangeKind: <short label for your approach (e.g. "tone shift to conversational",
     "structural rework into problem-solution form", "tighten throughout",
     "abstract → concrete examples")>
   Summary: <one or two sentences describing what should change and why>
   Plan: <your actual revision instructions — be specific. The rewriter follows these
     instructions exactly. This is where you do the analytical heavy lifting.>
   ```
2. **Parse with `parseSelfCritique`** — tolerant. Returns `{changeKind, summary, plan}`. Accepts whitespace and case variation around labels, markdown emphasis (`**ChangeKind:**`), reasoning preamble before the labels, and multi-line `Summary` + `Plan` blocks. Validates: `changeKind` non-empty (truncated to 120 chars), `summary` non-empty (truncated to 500 chars), `plan` non-empty (truncated to 4000 chars). **Throws `SelfCritiqueParseError`** if any required field is missing or empty after parsing — raw response preserved on the detail row.
3. **Build customPrompt** via `buildSelfCritiqueCustomPromptFromReflection` — minimal. Just embeds the reflection's `summary` + `plan`:
   ```
   You are an expert article reviser. Apply this revision plan to the article below.
   
   ## Approach
   {summary}
   
   ## Plan
   {plan}
   
   Apply the plan thoroughly. Stay true to the reflector's intent — don't add unrelated
   changes, don't water down the changes the plan calls for.
   ```
   NO Length / Redundancy / Flow soft directives — those were criteria-family constraints designed to force surgical edits; we explicitly DON'T want that here. NO high-Elo guidance block in the customPrompt — the reflector already saw the high-Elo context and accounted for it in the plan.
4. **Delegate to `GenerateFromPreviousArticleAgent.execute()`** with `tactic: 'self_critique_driven'` (new marker tactic) and the customPrompt. NO `criteriaSetUsed` / `weakestCriteriaIds` — those are criteria-family fields.
5. **Merge detail** — wrap GFPA's `generation` + `ranking` sub-objects under our `reflection` sub-object. Recompute `totalCost = reflectionCost + gfpaDetail.totalCost`.
6. **Forward GFPA's `failure` signal** (D1 invariant) — hard-fails (402, format-rejection, unknown tactic) flow up so the wrapper invocation gets `success=false` with the right error code.
7. **Compute `lengthCapHit`** post-hoc — `generated.textLength / parentText.length > 1.10`. Observational only; doesn't gate the variant. Useful as a signal of how often the plan calls for major expansions.

### Schema shape

```ts
{
  detailType: 'self_critique_revise',
  tactic: 'self_critique_driven',
  reflection: {
    changeKind: string,                  // ≤ 120 chars — LLM's own short label for its approach
    summary: string,                      // ≤ 500 chars — one to two sentences describing the change
    plan: string,                         // ≤ 4000 chars — full revision instructions for GFPA
    parentEloAtReflection?: number,      // recorded for forensics — what the reflector saw
    highEloContextShown?: boolean,        // true when parentElo > SELF_CRITIQUE_HIGH_ELO_THRESHOLD
    rawResponse?: string,                 // preserved on parse failure
    parseError?: string,
    durationMs?: int,
    cost?: number,
  },
  generation?: {...},                    // reused from GFPA
  ranking?: {...},                       // reused from GFPA
  totalCost: number,                     // = reflectionCost + gfpaDetail.totalCost
  surfaced: boolean,
  discardReason?: {...},
  guardrails: {
    lengthCapHit: boolean,              // generated.textLength / parentText.length > 1.10
  },
}
```

### Attribution dimension
**`changeKind` truncated to the first 60 chars** (with ellipsis on overflow). The LLM's self-chosen label captures the *kind* of change it decided to make, which is the most useful grouping for the tactic leaderboard. We'll get some cardinality noise (different LLM outputs for the same intent: "tone shift to conversational" vs "shift to conversational tone") but also surface interesting patterns — e.g. *does the agent win more when it picks "structural rework" vs "tighten throughout"?* Single-bucket `'self_critique'` was the safe call when the output was rigid; with free-form reflection, `changeKind` is the more informative dimension. Full `changeKind` + `summary` + `plan` still live on detail for SQL slicing if the leaderboard buckets get too noisy.

### Cost stack
| Step | Estimate |
|---|---|
| Reflection LLM call | ~$0.0008 (parent in, ~600 toks out — `changeKind` + `summary` + `plan`. Plan can be long for structural reworks) |
| GFPA generate | Same as vanilla generate (~$0.002) |
| GFPA ranking | Same as vanilla generate (~$0.002) |
| **Total per variant** | **~$0.005** |

~1× GFPA cost + ~15% reflection premium. Closely matches `single_pass_criteria`'s observed staging cost (~$0.004/variant in 2026-06-28 data). The reflection call is slightly larger than the original "list 2-3 issues" design (~600 toks vs ~400) because the `plan` field can be substantial; the GFPA call is unchanged.

### What we will NOT build (out of scope)
- **No new judge mode.** Article-mode comparisons only.
- **No rubric-judging integration.** Holistic-judge-compatible only; `judgeRubricId` integration deferred.
- **No new entity tables.** Everything fits in existing tables.
- **No DB migration except the cost-calibration phase enum extension.** Mechanical, same shape as past migrations.
- **No scope guardrails on the reflection.** The LLM picks any scope it judges right (minor edits ↔ structural rework). No Length / Redundancy / Flow soft directives in the customPrompt — those were criteria-family band-aids that constrained scope to surgical edits.
- **No `changeKind` enum** — free-form short label. We classify into buckets later only if cardinality becomes a leaderboard problem.
- **No multi-cycle loop.** Single reflection → single regenerate.
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
- [ ] Add `selfCritiqueReviseExecutionDetailSchema` to `evolution/src/lib/schemas.ts` (use the singlePass schema at line 2154 as template; replace `weakestCriteriaIds` / `weakestCriteriaNames` / `evaluateAndSuggest` with the `reflection` sub-object — fields: `changeKind` ≤ 120, `summary` ≤ 500, `plan` ≤ 4000, plus `parentEloAtReflection?` and `highEloContextShown?` for forensics).
- [ ] Create `evolution/src/lib/core/agents/selfCritiqueRevise.ts`:
  - Custom errors: `SelfCritiqueLLMError`, `SelfCritiqueParseError`
  - Export `SELF_CRITIQUE_HIGH_ELO_THRESHOLD = 1300` constant (empirical justification inherited from singlePass)
  - `buildSelfCritiquePrompt(parentText, parentElo?): string` — instructs LLM to reflect freely on how to improve the article, lists the scope options explicitly (minor edits / targeted rewrites / structural rework / mode shifts / anything else), conditionally prepends the high-Elo context note when `parentElo > SELF_CRITIQUE_HIGH_ELO_THRESHOLD`. Specifies the `ChangeKind: / Summary: / Plan:` output format.
  - `parseSelfCritique(response): {changeKind, summary, plan}` — tolerant parser. Accepts whitespace + case variation around labels, markdown emphasis around labels (e.g. `**ChangeKind:**`), reasoning preamble before the labels, and multi-line `Summary` + `Plan` blocks. Truncates `changeKind` to 120 chars, `summary` to 500, `plan` to 4000. **Throws `SelfCritiqueParseError`** if any of the three labeled fields is missing or empty after extraction.
  - `buildSelfCritiqueCustomPromptFromReflection({summary, plan}): {preamble, instructions}` — minimal embed of `summary` + `plan` per the Algorithm summary. NO Length / Redundancy / Flow soft directives. NO high-Elo guidance block in the customPrompt (the reflector already accounted for high-Elo context if applicable).
  - `SelfCritiqueReviseAgent extends Agent<...>` class with `execute()`:
    1. Lookup parent Elo from `input.initialRatings.get(input.parentVariantId)?.elo` → pass to prompt builder
    2. Reflection LLM call + parse (`costBeforeReflection` snapshot, partial-detail-on-throw)
    3. Build customPrompt from parsed reflection
    4. `await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx)` with `tactic: 'self_critique_driven'` + customPrompt
    5. Compute `lengthCapHit` post-hoc
    6. Merge detail + forward `failure` signal
  - Attribution extractor: returns `detail.reflection.changeKind` truncated to first 60 chars (with ellipsis on overflow); returns null when changeKind is missing/empty
- [ ] Add `DETAIL_VIEW_CONFIGS.self_critique_revise` in `evolution/src/lib/core/detailViewConfigs.ts` — render `reflection.changeKind` as a badge, `reflection.summary` as a prominent paragraph, `reflection.plan` as a collapsible code block, `reflection.parentEloAtReflection` + `highEloContextShown` as forensic chips, then GFPA's generation + ranking sub-objects + lengthCapHit indicator.
- [ ] Unit tests `selfCritiqueRevise.test.ts`:
  - Prompt builder includes all 5 scope options explicitly (minor edits, targeted rewrites, structural rework, mode shifts, "anything else"), includes the required output format with `ChangeKind:` / `Summary:` / `Plan:` labels, conditionally includes the high-Elo context note when `parentElo > 1300`, omits it otherwise
  - Parser happy paths: all three labels present and well-formed ✓; bold/italic emphasis on labels (`**ChangeKind:**`) ✓; reasoning preamble before labels ✓; multi-line `Summary` and `Plan` ✓; case variation (`changekind:`) ✓; whitespace variation ✓
  - Parser truncation: `changeKind` > 120 chars truncated; `summary` > 500 truncated; `plan` > 4000 truncated
  - Parser failure paths: missing `ChangeKind` → throws; missing `Summary` → throws; missing `Plan` → throws; empty value after any label → throws; empty response → throws; raw response preserved on throw
  - `buildSelfCritiqueCustomPromptFromReflection`: embeds `summary` + `plan` verbatim; does NOT include Length/Redundancy/Flow directives; does NOT include high-Elo guidance block
  - `execute()` happy path (mocked LLM via `v2MockLlm`): reflection + GFPA both succeed → variant produced + ranked, totalCost = reflectionCost + gfpaCost, `lengthCapHit` computed
  - `execute()` high-Elo parent path: parent Elo lookup returns 1450 → reflection prompt includes high-Elo context note; `reflection.parentEloAtReflection === 1450`; `reflection.highEloContextShown === true`
  - `execute()` low-Elo parent path: parent Elo lookup returns 1100 → reflection prompt does NOT include high-Elo context note; `reflection.highEloContextShown === false`
  - `execute()` reflection-LLM-throws path: partial detail persisted before re-throw (reflection sub-object populated with `cost` + `durationMs`)
  - `execute()` reflection-parse-fails path: partial detail persisted with `rawResponse` + `parseError`
  - `execute()` GFPA-throws path: partial detail persisted with full reflection sub-object + GFPA's `cost` so far
  - `execute()` GFPA-failure-forwarded path: GFPA's `failure: {code, message}` returned in the wrapper's output (D1 invariant)
  - `execute()` lengthCapHit telemetry: `true` when generated > 1.10× parent, `false` otherwise
  - Attribution extractor: returns `changeKind` truncated to 60 chars; returns null on empty
- [ ] Property test `selfCritiqueRevise.property.test.ts` — fuzz parser with `fast-check`:
  - Valid generated input (random `changeKind` / `summary` / `plan` text in correct format) → parses to the same three fields, lengths within caps
  - Generated input with one of the three labels missing → throws every time
  - Random text → either parses validly or throws (never invalid state returned)
- [ ] Invariant tests `selfCritiqueRevise.invariants.test.ts`:
  - Inner GFPA called via `.execute()` not `.run()` (no nested AgentCostScope)
  - `costBeforeReflection` snapshot captured before any LLM call
  - Every throw path persists partial detail via `updateInvocation`
  - GFPA `failure` forwarded (not swallowed)
  - `customPrompt` passed to GFPA does NOT contain the strings "Preserve the original word count" or "Preserve transitions between paragraphs" (regression guard — those would re-introduce the criteria-family scope constraint)
  - Detail schema validates produced detail object on all 5 paths (happy / reflection-throw / parser-throw / GFPA-throw / GFPA-failure-forward)
- [ ] Integration test `src/__tests__/integration/evolution-self-critique.integration.test.ts`:
  - Seed test prompt + strategy (1×self_critique_revise iteration, mocked LLM via `v2MockLlm` returning a well-formed 3-field reflection then a valid GFPA rewrite)
  - Trigger pipeline via `claimAndExecuteRun`
  - Assert: ≥1 invocation with `agent_name='self_critique_revise'`, variant produced + ranked, `self_critique_cost` metric > 0, `parent_variant_ids[0]` = seed variant id, `execution_detail.reflection.changeKind` non-empty, `execution_detail.reflection.summary` non-empty, `execution_detail.reflection.plan` non-empty, `execution_detail.guardrails.lengthCapHit` field present

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
  - Test 6: `execution_detail.reflection.{changeKind, summary, plan}` all populated with non-empty strings — real-LLM verification that the prompt elicits the expected 3-field shape from `deepseek-v4-flash`
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
