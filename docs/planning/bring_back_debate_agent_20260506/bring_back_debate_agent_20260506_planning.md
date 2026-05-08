# Bring Back Debate Agent Plan

## Background
we want to introduce a debate agent which takes two agents, debates their relative pros/cons including specific examples, and figures out a way to merge them into one final output based on the feedback.

V1 DebateAgent (introduced 2026-02-04 via PR #319, deleted 2026-03-16 via PR #716 in the V1 mass-deletion) ran a 3-turn structured debate (Advocate A → Advocate B rebuttal → Judge JSON synthesis) over the top-2 variants in a pool, then synthesized a new variant from the judge's verdict via a 4th LLM call. V1 implementation aligned with Google DeepMind's "AI Co-Scientist" paper (arxiv 2502.18864) — the existing V2 pipeline mirrors AI Co-Scientist's agent set, with `simulated_scientific_debate` being the explicit gap. The orphan V1 schema, fixture, and DETAIL_VIEW_CONFIGS entry survive in the V2 codebase, lowering revival cost. V2 revival shape: a Shape-A wrapper agent with 4 LLM calls, modeled on `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` (combined pre-stage + delegate to inner GFPA via `.execute()` with `customPrompt`) and `IterativeEditingAgent` (multi-LLM-call cost snapshots).

## Requirements (from GH Issue #NNN)
Let's follow our existing agent framework. Re-use existing agent patterns wherever possible. Come up with wireframes for how invocation details will look, and then run it by the user.

## Problem
The V2 evolution pipeline has 7 live agents (GFPA, ReflectAndGenerate, EvaluateCriteria, IterativeEditing, SwissRanking, MergeRatings, CreateSeedArticle) and a 24-tactic registry, but no agent that performs structured cross-variant adversarial reasoning. Existing wrappers (Reflect, Criteria) treat each parent as roughly trustworthy and revise from a single-variant perspective; no agent forces explicit comparison between two parents and synthesizes their strengths via judged dialectic. For prose-quality tasks where strengths split across variants (one is clearer, the other more engaging), the current pipeline relies on Swiss tournaments to settle ranking — but never produces a child variant that actually merges those strengths. DebateAgent fills this gap: 4 LLM calls (Advocate A + Advocate B + Judge + Synthesis-via-GFPA) per invocation, ~$0.005-0.012 per invocation at cheap-default tier, gated per-iteration over the top-2 of the iteration-start pool snapshot.

## Locked decisions (lifted from `debate_agent_revival_brief.md` §1)

1. **Per-iteration dispatch (not per-parent).** One `DebateAgent.run()` per iteration; agent reads `input.initialPool` + `input.initialRatings`, selects top-2 internally.
2. **Synthesis delegates to inner GFPA via `.execute()` (NOT `.run()`)** with `customPrompt` derived from judge verdict. Reuses GFPA's tactic registry, FORMAT_RULES validation, and ranking. Load-bearing invariant I1.
3. **Critique context from `evolution_arena_comparisons` history** (last 3 wins + last 3 losses per parent). Replaces V1's deleted ReflectionAgent helper.
4. **`detailType` literal: `'debate_then_generate_from_previous_article'`** (snake_case wrapper convention).
5. **`iterationAgentType` value: `'debate_and_generate'`** (matches `reflect_and_generate` / `criteria_and_generate` naming).
6. **Two AgentName labels** (`debate_judge`, `debate_synthesis`) both map to ONE metric `'debate_cost'`. (Was four labels under V1 / Option A's 4-call shape; collapsed to two when Option C was locked in Decision §17 — `debate_judge` covers the combined analyze+judge call, `debate_synthesis` covers the inner-GFPA synthesis call. Both must tag `debate_cost` so live metrics align with `EstPerAgentValue.debate` per Phase 1.10. Ranking calls keep the existing `'ranking'` AgentName → `ranking_cost` → `EstPerAgentValue.rank`.)
7. **`mu` → `elo`** in `variantA`/`variantB` shape (V2 rating convention).
8. **Per-invocation budget cap $0.40** with abort threshold `0.9 × cap`.
9. **Marker tactic `'debate_synthesis'`** registered in `tactics/index.ts` color map (rose `#fda4af`) + `MARKER_TACTICS`.
10. **Forward-only migrations; deploy migration FIRST, code SECOND.** `startupAssertions.ts` enforces ordering ONLY for the calibration phase enum (it queries `evolution_cost_calibration_phase_allowed` CHECK and matches against TS phase strings). It does NOT enforce ordering for the Phase 1.15 `parent_variant_ids` column swap or the Phase 1.18 RPC rewrite. Phase 1.7 extends `startupAssertions.ts` with a NEW assertion: query `information_schema.columns` for (a) `evolution_variants.parent_variant_ids` exists, (b) `evolution_variants.parent_variant_id` does NOT exist (post-Phase-1.15 invariant); throw `MissingMigrationError` referencing Phase 1.15's filename if either check fails. Both assertions run unconditionally at agent-registry init, gated by neither feature flag.
11. **Kill-switch `EVOLUTION_DEBATE_ENABLED`** default `'true'` (string-contract: `process.env.X !== 'false'`).
12. **Top-2 selection deterministic tiebreak**: lower `variant.id` wins on Elo tie.
13. **Judge `winner='tie'` runs synthesis but result does not enter pool** (`surfaced=false`).
14. **Synthesis identical-to-parent does not surface** — Jaccard ≥ 0.85 hard gate.
15. **Single materialized variant per invocation.** Mirrors IterativeEditing's contract.
16. **Pool snapshot semantics: agent reads `input.initialPool` + `input.initialRatings`** and selects top-2 internally.
17. **Algorithm shape: Option C (2 LLM calls).** ONE combined "analyze + judge" call producing structured `{prosA, consA, prosB, consB, winner, reasoning, strengthsFromA, strengthsFromB, improvements}`, THEN delegate to inner GFPA `.execute()` with `customPrompt` built from the verdict. Mirrors `evaluate_criteria_then_generate` shape exactly; reduces per-invocation cost ~50% vs the V1 4-call shape; preserves separate-call resilience (bad synthesis can fail without losing the verdict).
18. **Reuse existing strategy-level `judgeModel` and `generationModel`; do NOT add per-debate model overrides.** Debate's combined analyze+judge LLM call uses the strategy's existing `judgeModel` (same as SwissRanking). Debate's synthesis call goes through inner GFPA which already uses `generationModel`. No `debateAdvocateModel`, no `debateJudgeModel`, no `debateSynthesisModel` fields. The only debate-specific config knob is **`debateJudgeReasoningEffort`** (`'none' | 'low' | 'medium' | 'high'`) at both `StrategyConfig` and `IterationConfig` levels with cascade `iter → strategy → registry default`. Justification: SwissRanking and DebateAgent share `judgeModel` but have different cost profiles (Swiss = 10-40 cheap pairwise calls per iter; Debate = 1 judge call per iter where verdict quality matters more). The reasoning-effort override lets operators enable thinking mode on debate's judge call without enabling it for Swiss's per-pair judge calls. Plumbing already exists at `callLLM()` in `src/lib/services/llms.ts:394-407` via the `reasoningEffort` param — DebateAgent reads the resolved config and passes it through.
19. **Forced structured pros/cons output even when thinking mode is on.** The combined analyze+judge prompt ALWAYS asks for structured `{prosA, consA, prosB, consB, winner, ...}` regardless of `debateAdvocateReasoningEffort`. Reasoning models produce hidden reasoning tokens BEFORE the structured output (per Anthropic extended-thinking + OpenAI o-series API contracts), so forcing structured output downstream of thinking does not degrade thinking quality. **Reasoning trace becomes a supplement to — not a substitute for — structured pros/cons.** The Debate Overview tab always shows pros/cons; the reasoning trace block renders conditionally only when the SDK surfaces a trace (Anthropic extended-thinking returns verbatim; OpenAI o-series does not surface the raw trace). Two consequences: (a) Tab 1 layout is uniform across thinking modes — no "Variant A" vs "Variant B" UI fork; (b) A/B test in Phase 8 compares thinking-on-vs-off on **same structured output shape**, isolating the lift to reasoning quality alone.
20. **Multi-parent lineage via single `parent_variant_ids: uuid[]` column** (replaces the single-FK `parent_variant_id`). Generalizes to N parents — no schema migration needed for future 3+ parent agents (ensemble, tournament-of-K, etc.). By convention, `parent_variant_ids[0]` is the primary/canonical parent (e.g., judge's winner for debate); `parent_variant_ids[1..N]` are additional parents. The legacy `parent_variant_id` column is **dropped** in the same migration after backfill — no dual-shape storage, no transition period. Eliminates the in-memory vs DB asymmetry (`Variant.parentIds: string[]` and `evolution_variants.parent_variant_ids: uuid[]` are now the same shape). App-layer enforces referential integrity (DB-level FKs on array elements aren't supported by PostgreSQL; mirrors the existing pattern in `evolution_arena_comparisons.entry_a/b` which dropped DB FKs in migration `20260409000001` and rely on `VariantEntity.ts` for cleanup). DebateAgent emits `Variant.parentIds = [winner.id, loser.id]` — order load-bearing because `parentIds[0]` = canonical primary. Existing single-parent agents (GFPA, Reflect, Criteria, IterativeEditing) emit `parentIds = [parent.id]` (1-element array). Synthesis text input to inner GFPA is the **winner's text** (semantically: synthesis revises the winner using the loser's strengths). `execution_detail.debate.{variantA, variantB}` redundantly captures both `{id, elo}` for direct rendering without joining. The existing `get_variant_full_chain(variant_id)` RPC is rewritten in-place (same name, new body) to walk `parent_variant_ids` via `unnest()` recursively, returning `parent_index: int` per ancestor row (0 = primary, 1+ = additional parents). One walker handles all cases; no separate DAG RPC needed.

## Models that support thinking mode (as of 2026-05-06)

Empirical judge-task data sourced from `docs/research/judge_agreement_summary_tables.md` (Tables 3+4) and registry config from `src/config/modelRegistry.ts`.

| Model | `defaultReasoningEffort` | Behavior on judge tasks (close + large pair) |
|---|---|---|
| `gpt-oss-20b` | `'low'` (mandatory; min effective) | low: ~80 reasoning tok, ~1.2s, 100% large-gap decisive but 0-70% close-pair (inverse-temp curve). default (medium): 800-3000 reasoning tok, 6-16s. Cheap input ($0.03/1M) but output dominates when thinking is on. |
| `qwen/qwen3-8b` | `'none'` (toggleable) | ON: ~900-1000 reasoning tok, 9-13s, **100% decisive on both large + close pairs at all temps**. OFF: ~5 tok, ~1s; quality matches ON but `parseWinner()` bug currently drops confidence to 0.30 on reverse-pass `"Your answer: B"` outputs (one-line regex fix recovers full confidence). |
| `o3-mini` | _(not set)_ | In registry. Routes via OpenAI `reasoning_effort` param (`src/lib/services/llms.ts:407`). Empirical judge-task data not in research docs. Pricing not yet wired (`reasoningPer1M` missing). |

**Configured but NOT thinking-mode-enabled** in current registry (would require a one-line registry update to expose):
- `gpt-5-nano` / `gpt-5-mini` / `gpt-5.2` / `gpt-5.2-pro` — OpenAI GPT-5 series supports `reasoning_effort` at API level; registry just needs `defaultReasoningEffort` field added.
- `claude-sonnet-4-20250514` — Sonnet 4 supports extended thinking via Anthropic SDK's `thinking` param; needs integration in `createEvolutionLLMClient.ts`.
- `deepseek-chat` — non-reasoning. DeepSeek's reasoning model `deepseek-reasoner` is not in the registry.
- `o1` / `o1-mini` / `o1-preview` — pricing fallbacks exist but not in `MODEL_REGISTRY` (so not selectable in strategy wizard).

**v1 default for DebateAgent**: thinking mode defaults to OFF (i.e., `reasoningEffort` not passed; the registry's `defaultReasoningEffort` applies — which for most models is `undefined` or `'low'`/`'none'`). Phase 8 A/B test is what determines whether thinking ON becomes the default for debate.

## Options Considered

- [x] **Option A (CHOSEN): Wrapper agent following `evaluateCriteriaThenGenerateFromPreviousArticle` template.** New `agentType: 'debate_and_generate'` (Shape A). 4 LLM calls per invocation: Advocate A → Advocate B → Judge → Synthesis-via-inner-GFPA. Synthesis delegates to inner GFPA `.execute()` with `customPrompt` built from judge verdict + marker tactic. Reuses GFPA's FORMAT_RULES validation, ranking, and surfacing logic for free.
- [x] **Option B: Inline 4-LLM-call agent.** All 4 calls (including synthesis) inside `DebateAgent.execute()` — no inner GFPA delegation. Rejected: would re-implement FORMAT_RULES injection, format-validate retry logic, and ranking that GFPA already has.
- [x] **Option C: Per-parent dispatch.** N parallel `DebateAgent.run()` invocations per iteration, each pairing one parent with another. Rejected: forces coordination problem (which parent gets paired with which?), inflates pool size super-linearly, mismatches the user's "one variant per debate" intent.

## Phased Execution Plan

### Phase 1 — Schema + types + cost calibration + lineage migration (~3 days)

- [x] **1.1** Extend `iterationAgentTypeEnum` at `schemas.ts:478` with `'debate_and_generate'`. Update `canBeFirstIteration` (false), `isVariantProducingAgentType` (true), `producesNewVariants` (true).
- [x] **1.2** Replace `debateExecutionDetailSchema` at `schemas.ts:1092-1112` with V2 Option-C shape: `detailType: 'debate_then_generate_from_previous_article'`, `tactic: 'debate_synthesis'`, `variantA/variantB: { id, elo }` with `mu→elo` preprocess, `debate: { combined: { prosA, consA, prosB, consB, winner, reasoning, strengthsFromA, strengthsFromB, improvements, cost, durationMs, rawResponse?, parseError?, reasoningEffortResolved?, reasoningTokens?, reasoningTrace?, reasoningTraceFormat? }, failurePoint? }`, `generation` and `ranking` sub-objects (reused from GFPA shape), `totalCost`, `surfaced`, `discardReason`. The `reasoningTrace?: string` field captures the model's thinking trace text. `reasoningTraceFormat?: z.enum(['verbatim', 'summary', 'unavailable']).optional()` flags the shape because providers differ — VERIFIED via web search 2026-05: (a) OpenRouter `reasoning_details[]` returns verbatim trace for qwen/qwen3-8b + gpt-oss-20b; (b) OpenAI o-series + GPT-5 returns summary only via `reasoning: { summary: 'auto' }` opt-in (raw extraction prohibited by AUP); (c) Anthropic Claude Sonnet 4 returns summary in `thinking` content blocks (Claude 3.7 returned verbatim; Sonnet 4 does NOT). `reasoningTokens` is always populated from `usage.completion_tokens_details.reasoning_tokens` regardless of trace surfacing. `reasoningEffortResolved` records the cascade-resolved effort used at runtime (per Decision §18) for audit. UI in Phase 4 reads `reasoningTraceFormat` to label the trace block correctly so operators don't conflate provider summaries with raw deliberation.
- [x] **1.3** Update `agentExecutionDetailSchema` discriminated union to point at the new `detailType` literal. Mirror `mergeRatingsExecutionDetailSchema.iterationType` and `iterationSnapshotSchema.iterationType` enum extensions to include `'debate'`.
- [x] **1.4** Add **2** new `AgentName` literals to `agentNames.ts` `AGENT_NAMES`:
  - `'debate_judge'` — covers the combined analyze+judge LLM call (Option C); maps to `'debate_cost'` in `COST_METRIC_BY_AGENT`.
  - `'debate_synthesis'` — wraps the synthesis call (the inner GFPA `.execute()` invocation); maps to `'debate_cost'` in `COST_METRIC_BY_AGENT`. The wrapper layer must explicitly tag the GFPA call's cost-tracker scope with this AgentName so the cost flows to `debate_cost`, NOT `generation_cost`.
  - **Why TWO labels**: Phase 1.10 specifies that synthesis cost rolls into the `EstPerAgentValue.debate` peer field (NOT `gen`). For live metrics to align with `EstPerAgentValue.debate`, the synthesis call must be tagged under a `debate_*` AgentName that maps to `debate_cost`. The earlier draft tried to reuse the existing `'generation'` AgentName (mirroring EvaluateCriteria), but EvaluateCriteria's case is different: its inner-GFPA synthesis cost flows to `generation_cost` AND its `EstPerAgentValue.gen` field, so live metrics align there. For debate, we want synthesis cost in `EstPerAgentValue.debate` — so we MUST tag it with a debate-specific AgentName.
  - Ranking calls (Swiss-style pairwise comparisons inside inner GFPA's `tacticRanking`) use the existing `'ranking'` AgentName → `ranking_cost` metric → `EstPerAgentValue.rank` field. NO change needed; this aligns naturally.
  - **Implementation mechanism for Phase 2.1** — **CONCRETE: not `withAgentName` (no such API)**. Verified against `evolution/src/lib/pipeline/infra/trackBudget.ts:26-43` (`reserve` / `recordSpend` / `release` all take `phase: AgentName` per call — there is no scoped override). The override mechanism is an **`EvolutionLLMClient` proxy** injected via `input.llm` (NOT `ctx.llm`). **CRITICAL injection-point note**: `AgentContext` has NO `llm` field — `Agent.run()` at `evolution/src/lib/core/Agent.ts:96-119` reads `ctx.rawProvider`, wraps it in a per-invocation cost-tracking client, and injects the result as `effectiveInput.llm`. Every existing wrapper agent reads `input.llm` for its own LLM calls (`generateFromPreviousArticle.ts:162` `const llm = input.llm!`; `IterativeEditingAgent.ts:133` `const llm = input.llm`; `evaluateCriteriaThenGenerateFromPreviousArticle.ts:379` `const llm = input.llm!`). DebateAgent must follow the same pattern: read its own `input.llm` for the combined judge call, build the proxy from `input.llm`, and pass it to inner GFPA via `innerInput.llm = synthesisLlmProxy`. Concrete shape:
    ```ts
    // In DebateAgent.execute(input, ctx):
    const llm = input.llm!;  // injected by Agent.run() via rawProvider
    if (!llm) throw new Error('DebateAgent: input.llm is required (set usesLLM=true and provide ctx.rawProvider)');

    // Combined judge call uses 'debate_judge' AgentName directly:
    const rawJudgeText = await llm.complete(judgePrompt, 'debate_judge', { model: judgeModel, reasoningEffort });

    // ... parse + budget gate ...

    // Synthesis-LLM proxy rewrites 'generation' → 'debate_synthesis' so the inner GFPA's
    // `input.llm!.complete(prompt, 'generation', ...)` cost lands in debate_cost / EstPerAgentValue.debate.
    // Other AgentNames pass through untouched (ranking → ranking_cost, etc.).
    // NOTE: `EvolutionLLMClient` types agentName as `LlmCallAgentName` (re-export of AgentName
    // from agentNames.ts). Use that exact type for the rewritten variable to satisfy the interface
    // signature precisely.
    import type { AgentName as LlmCallAgentName } from '../../core/agentNames';
    const synthesisLlmProxy: EvolutionLLMClient = {
      complete: (prompt, agentName, opts) => {
        const rewritten: LlmCallAgentName = agentName === 'generation' ? 'debate_synthesis' : agentName;
        return llm.complete(prompt, rewritten, opts);
      },
      completeStructured: (prompt, schema, schemaName, agentName, opts) => {
        const rewritten: LlmCallAgentName = agentName === 'generation' ? 'debate_synthesis' : agentName;
        return llm.completeStructured(prompt, schema, schemaName, rewritten, opts);
      },
    };

    const innerInput: GfpaInput = {
      ...gfpaInput,
      llm: synthesisLlmProxy,  // INJECTION POINT: input.llm, NOT ctx.llm
    };
    return innerGfpa.execute(innerInput, ctx);
    ```
    The proxy MUST cover both `complete` AND `completeStructured` (per `EvolutionLLMClient` interface at `evolution/src/lib/types.ts:592-606`) — GFPA may call either. Type the proxy as `EvolutionLLMClient` (NOT `LLMClient` — the latter doesn't exist in this codebase). This proxy approach mirrors no existing wrapper agent (IterativeEditing tags AgentNames directly via its own `complete()` calls; it does NOT delegate to an inner agent), so this is a NEW pattern introduced by DebateAgent. Document the proxy in Phase 2.1's header comment block as **load-bearing invariant I4**: "the synthesis-LLM-proxy must (a) be injected via `innerInput.llm` (NOT `ctx`), (b) wrap BOTH `complete` and `completeStructured`, and (c) rewrite `'generation' → 'debate_synthesis'` while passing through all other AgentNames; without I4 the synthesis cost flows to `generation_cost` and `EstPerAgentValue.gen` instead of `EstPerAgentValue.debate`, breaking the cost-attribution contract." Phase 2.6 unit test "Cost attribution: synthesis cost flows to debate_cost not generation_cost" must exercise the REAL `createEvolutionLLMClient` cost-write path (NOT a mocked `input.llm.complete`) so the proxy's effect on `costTracker.recordSpend(agentName, ...)` is visible — without that integration, a mocked llm could silently false-pass.
  - **createEvolutionLLMClient.ts phase switch extension**: the calibrated-row lookup at `createEvolutionLLMClient.ts:104-110` is a hardcoded switch over AgentName values; extend it to include `debate_judge` and `debate_synthesis`:
    ```ts
    const phase = agentName === 'generation' ? 'generation'
      : agentName === 'ranking' ? 'ranking'
      : agentName === 'reflection' ? 'reflection'
      : agentName === 'seed_title' ? 'seed_title'
      : agentName === 'seed_article' ? 'seed_article'
      : agentName === 'evaluate_and_suggest' ? 'evaluate_and_suggest'
      : agentName === 'debate_judge' ? 'debate_judge'        // NEW
      : agentName === 'debate_synthesis' ? 'debate_synthesis' // NEW
      : null;
    ```
    Without this, calibration lookups for the 2 new phases return null and fall back to `OUTPUT_TOKEN_ESTIMATES` defaults — which means cost reservations are based on stale defaults rather than calibrated empirical data. Phase 1.4's calibration migration (1.6a, 2 new phases) is wired to this switch.
  - **OUTPUT_TOKEN_ESTIMATES extension**: add `debate_judge: 800` (combined call returns 9-field structured JSON; ~600-1000 output tokens typical) and `debate_synthesis: 2000` (full synthesized variant; matches `generation: 2000`) to the `OUTPUT_TOKEN_ESTIMATES` map at `createEvolutionLLMClient.ts:33`.
  - (Was 4 labels under Option A's 4-call shape; collapsed to 2 when Option C was locked in Decision §17 — combined+synthesis, not advocate-A/B/judge/synthesis.)
- [x] **1.5** Add 3 entries to `STATIC_METRIC_NAMES` in `metrics/types.ts`: `'debate_cost'` (live), `'total_debate_cost'`, `'avg_debate_cost_per_run'` (propagation). Add propagation defs (sum + avg) in `metrics/registry.ts`.
- [x] **1.6a** Migration: `<timestamp>_evolution_cost_calibration_debate_phase.sql` — DROP+RECREATE the named CHECK constraint `evolution_cost_calibration_phase_allowed` adding **2** new phase strings: `'debate_judge'` and `'debate_synthesis'` (matches the 2 AgentName labels from Phase 1.4; both flow to `debate_cost` metric but each gets its own calibration phase row so estimator tokens-per-call coefficients can diverge by purpose). Forward-only.
- [x] **1.6b** Migration: `<timestamp+1s>_seed_debate_synthesis_marker_tactic.sql` — INSERT one row into `evolution_tactics` for the `'debate_synthesis'` marker tactic.
- [x] **1.7** Update `startupAssertions.ts` to include the **2** new phases (`'debate_judge'`, `'debate_synthesis'`) in both `TS_PHASES_REFRESH_CALIBRATION` and `TS_PHASES_CALIBRATION_LOADER` Sets. Cite new migration in `MIGRATION_FILES`.
- [x] **1.8** Sync `evolution/scripts/refreshCostCalibration.ts` Phase enum + `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts` `CalibrationRow['phase']` literal union with the **2** new phases (`'debate_judge'`, `'debate_synthesis'`).
- [x] **1.9** Add `estimateDebateCost(...)` helper in `evolution/src/lib/pipeline/infra/estimateCosts.ts` (peer to `estimateIterativeEditingCost`). Returns `{ expected, upperBound, expectedSynthesis, upperBoundSynthesis }`. See brief §6 for the full helper signature + token estimates.
- [x] **1.10** Add `debate: number` field to `EstPerAgentValue` in `projectDispatchPlan.ts:97-112`. Synthesis cost rolls into `debate` peer field, NOT `gen` (per attribution decision in brief §5).
- [x] **1.11** Register marker tactic `'debate_synthesis'` in `tactics/index.ts:127` color map (`#fda4af` rose) + `MARKER_TACTICS` array.
- [x] **1.12** Define `EVOLUTION_DEBATE_ENABLED` env var. Document in `evolution/docs/reference.md` Kill Switches table.
- [x] **1.13** Custom errors: `DebateLLMError`, `DebateParseError` in `evolution/src/lib/core/agents/debate/errors.ts`.
- [x] **1.14** Add ONE thinking-mode config knob at TWO levels with cascade + capability validation (per Decision §18):
  - **Strategy-level** in `strategyConfigBaseSchema`:
    - `debateJudgeReasoningEffort?: z.enum(['none', 'low', 'medium', 'high']).optional()` — strategy-wide default for the debate judge LLM call. Distinct from any reasoning effort applied to Swiss's per-pair judge calls (Swiss does NOT read this field).
  - **Iteration-level** in `iterationConfigSchema` (override):
    - `debateJudgeReasoningEffort?: z.enum(['none', 'low', 'medium', 'high']).optional()` — overrides strategy-level if set.
  - **Cross-field refinement** (NEW — guards against misconfiguration): **CRITICAL — schema layering and existing-refine preservation**: `strategyConfigSchema` at `evolution/src/lib/schemas.ts:692` is `z.preprocess(preprocessBudgetFloor, strategyConfigBaseSchema)`. The base schema `strategyConfigBaseSchema` at `schemas.ts:606` already has **9 chained `.refine()` calls** (budgetPercent sum-to-100, first-iteration agentType validation, swiss-precedence ordering, mergeRatings positioning, etc.) — these MUST be preserved. The new check is **APPENDED** to the existing chain, not replacing it. Concrete shape — note the `// PRESERVE ALL 9 EXISTING .refine() CALLS` marker:
    ```ts
    // Edit schemas.ts:606-692 — append .superRefine AFTER the existing 9 .refine() calls,
    // BEFORE the export of strategyConfigSchema.
    const strategyConfigBaseSchema = z.object({ /* ALL existing fields including new debateJudgeReasoningEffort */ })
      .refine(/* PRESERVE: existing .refine #1 — budgetPercent sums to 100 */)
      .refine(/* PRESERVE: existing .refine #2 — first iteration agentType */)
      .refine(/* PRESERVE: existing .refine #3 — swiss precedence */)
      .refine(/* PRESERVE: existing .refine #4 */)
      .refine(/* PRESERVE: existing .refine #5 */)
      .refine(/* PRESERVE: existing .refine #6 */)
      .refine(/* PRESERVE: existing .refine #7 */)
      .refine(/* PRESERVE: existing .refine #8 */)
      .refine(/* PRESERVE: existing .refine #9 */)
      .superRefine((cfg, ctx) => {
        // NEW — debate reasoning-effort capability check
        for (const [iterIdx, iterCfg] of cfg.iterationConfigs.entries()) {
          const effortSetOnIter = iterCfg.debateJudgeReasoningEffort !== undefined;
          const effortSetOnStrategy = cfg.debateJudgeReasoningEffort !== undefined;
          if (!effortSetOnIter && !effortSetOnStrategy) continue;
          if (!getModelInfo(cfg.judgeModel)?.supportsReasoning) {
            const reasoningModels = Object.entries(MODEL_REGISTRY)
              .filter(([, m]) => m.supportsReasoning).map(([id]) => id).join(', ');
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: effortSetOnIter ? ['iterationConfigs', iterIdx, 'debateJudgeReasoningEffort'] : ['debateJudgeReasoningEffort'],
              message: `Strategy's judgeModel (${cfg.judgeModel}) does not support reasoning effort. Either pick a reasoning-capable model or unset debateJudgeReasoningEffort. Reasoning-capable models: ${reasoningModels}.`,
            });
          }
        }
      });
    export const strategyConfigSchema = z.preprocess(preprocessBudgetFloor, strategyConfigBaseSchema);
    ```
    Note on `.superRefine` vs `.refine` and ZodEffects: technically `.superRefine` IS callable on the result of `.refine()` (which is a `ZodEffects`) — Zod composes them. The earlier draft's framing about "ZodEffects vs ZodObject" was imprecise. The actual load-bearing constraint is (a) keep the new check INSIDE the preprocess wrapper, not OUTSIDE, so `preprocessBudgetFloor` runs before validation, and (b) preserve all 9 existing refines. Phase 4.7's iteration-level Zod refinements (per-iteration field rejections) live separately on `iterationConfigSchema`, not here.
    The path field points at the offending field directly (iteration-scoped or strategy-scoped) so wizard validation surfaces the error at the correct UI control. The model list is computed dynamically from the registry so it stays current.
  - **Cascade resolver** (helper `resolveDebateJudgeReasoningEffort(iterCfg, strategyCfg, judgeModel)` in `evolution/src/lib/pipeline/loop/debateDispatch.ts`):
    1. Use `iterCfg.debateJudgeReasoningEffort` if defined
    2. Else use `strategyCfg.debateJudgeReasoningEffort` if defined
    3. Else fall through to `getModelDefaultReasoningEffort(strategyCfg.judgeModel)` from `src/config/modelRegistry.ts`
    4. Else → undefined → `callLLM` skips the `reasoningEffort` param
    5. **Defensive guard** (NEW — failsafe for legacy data / direct-write paths that bypassed Zod): if the cascade-resolved effort is non-undefined BUT `getModelInfo(judgeModel)?.supportsReasoning !== true`, log warn (`{ judgeModel, requestedEffort, droppedReason: 'model_does_not_support_reasoning' }`), increment operational metric `debate_reasoning_effort_dropped`, and return undefined. Prevents runtime API errors when a user-set value sneaks through Zod validation.
  - **Wizard UI** (Phase 4.6): per-iteration "Judge reasoning effort" dropdown is conditionally enabled based on `getModelInfo(strategyCfg.judgeModel)?.supportsReasoning`. Active when true; disabled when false with help-text chip "{modelId} doesn't support reasoning. Pick a reasoning-capable model to enable thinking." Step 1 model-change handler shows confirm dialog when switching `judgeModel` from a reasoning-capable to non-capable model AND any iteration has `debateJudgeReasoningEffort` set.
  - **Explicitly NOT added**: `debateAdvocateModel`, `debateJudgeModel`, `debateSynthesisModel`. Debate uses strategy's existing `judgeModel` for the analyze+judge call and `generationModel` for the inner GFPA synthesis call.
- [x] **1.15** Multi-parent lineage migration (Decision §20) — split into TWO migrations to bound the lock window. The naive single-transaction approach (ADD + UPDATE + DROP COLUMN + DROP INDEX + CREATE GIN INDEX) would acquire `ACCESS EXCLUSIVE` lock on `evolution_variants` for the full duration, blocking concurrent reads from admin pages, in-progress `runIterationLoop` invocations, and dispatch planners. Production has active runs — unacceptable.
  - **Migration 1.15a** `<ts>_evolution_variants_parent_ids_array_add.sql` (compatible with concurrent reads):
    ```sql
    -- Add new column with default empty array; ALTER TABLE ADD COLUMN with non-volatile DEFAULT
    -- is metadata-only in Postgres 11+, no row rewrite, ACCESS EXCLUSIVE held only briefly.
    ALTER TABLE evolution_variants
      ADD COLUMN parent_variant_ids uuid[] NOT NULL DEFAULT '{}';

    -- NO BACKFILL inside this migration. Backfill is run as a SEPARATE Node script
    -- (evolution/scripts/backfill-parent-array.ts, added in Phase 1.15a-script below)
    -- AFTER this migration applies. Rationale: keeping backfill out of the migration
    -- file lets each batch run in its own short transaction (ROW EXCLUSIVE only) so
    -- concurrent reads from runIterationLoop / admin pages / dispatch planners
    -- continue uninterrupted. Embedding backfill as a DO-block inside the migration
    -- file would hold ACCESS EXCLUSIVE for the full UPDATE sweep on multi-million rows.

    -- GIN index built CONCURRENTLY (no exclusive lock; takes longer but doesn't block).
    -- CRITICAL: CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
    -- Supabase migration runner wraps each .sql file in BEGIN/COMMIT by default;
    -- override with the `-- supabase: no-transaction` directive at the top of THIS
    -- migration file (see existing pattern in supabase/migrations/20260326000003_add_arena_pivot_index.sql).
    -- Without the directive, the migration FAILS with "CREATE INDEX CONCURRENTLY cannot
    -- run inside a transaction block". Verify in staging by inspecting migration logs
    -- after first apply; if the directive is wrong, drop the partially-built index
    -- (DROP INDEX CONCURRENTLY IF EXISTS idx_evolution_variants_parent_variant_ids)
    -- before retrying. Concurrently-built index is empty until backfill runs (which
    -- is fine — the index just covers writes; a sequential scan handles pre-backfill reads).
    CREATE INDEX CONCURRENTLY idx_evolution_variants_parent_variant_ids
      ON evolution_variants USING GIN (parent_variant_ids);

    COMMENT ON COLUMN evolution_variants.parent_variant_ids IS
      'Array of parent variant IDs. parent_variant_ids[0] is the canonical primary parent by convention (e.g. judge''s winner for debate). Empty array for root/seed variants. App-layer enforces referential integrity (no DB-level FK on array elements — PostgreSQL does not support that). See bring_back_debate_agent_20260506 Decision §20 and data_model.md.';
    ```
    Forward-only. After 1.15a applies, both columns coexist and dual-write is required (Phase 3.8 writes BOTH `parent_variant_id = parentIds[0]` AND `parent_variant_ids = parentIds` until 1.15b lands).
  - **Migration 1.15a-script** `evolution/scripts/backfill-parent-array.ts` — Node script run AFTER 1.15a applies. Loops in batches of 1000:
    ```ts
    // Pseudocode — actual implementation uses Supabase admin client
    while (true) {
      const { data: batch } = await db.from('evolution_variants')
        .select('id, parent_variant_id')
        .not('parent_variant_id', 'is', null)
        .eq('parent_variant_ids', '{}')   // only unbackfilled rows
        .limit(1000);
      if (!batch || batch.length === 0) break;
      await db.from('evolution_variants').upsert(
        batch.map(r => ({ id: r.id, parent_variant_ids: [r.parent_variant_id] })),
        { onConflict: 'id' }
      );
      console.log(`Backfilled ${batch.length} rows; total so far: ${cumulativeCount}`);
    }
    // Final assertion: zero rows where parent_variant_id IS NOT NULL AND parent_variant_ids = '{}'
    ```
    Each upsert acquires ROW EXCLUSIVE only — concurrent reads continue. Runtime estimate: ~1-2 minutes for 100k rows; ~30 minutes for 5M rows.
    **Header comment block** (top of file) must declare the script idempotent: "Safe to re-run after Ctrl-C, OOM, or partial failure — the WHERE filter (`parent_variant_id IS NOT NULL AND parent_variant_ids = '{}'`) only selects unbackfilled rows; already-backfilled rows are skipped on resume. Operator playbook step 2 explicitly notes this so on-call can resume without fear of double-write." Also note in the header that the Supabase JS client may not reliably accept `'{}'` as an empty-array equality literal — if the `.eq('parent_variant_ids', '{}')` filter produces no rows when seed data has empty arrays, fall back to a raw SQL filter via `db.rpc('count_unbackfilled_parents')` or `db.from(...).select('id').filter('parent_variant_ids', 'eq', '{}')`. Verify in staging.
  - **Migration 1.15a-rollback** `evolution/scripts/repair-parent-array.ts` (NEW, ships alongside the backfill script for completeness even though normally unused): if `verify-parent-array-backfill.ts` fails after a backfill, this script repairs divergent rows. Loops in batches of 1000:
    ```ts
    // For rows where parent_variant_ids[0] !== parent_variant_id (impossible if backfill is correct,
    // but defensive against partial failures or future-agent buggy writes):
    while (true) {
      const { data: divergent } = await db.rpc('find_divergent_parent_arrays', { batch_size: 1000 });
      if (!divergent || divergent.length === 0) break;
      await db.from('evolution_variants').upsert(
        divergent.map(r => ({ id: r.id, parent_variant_ids: [r.parent_variant_id] })),
        { onConflict: 'id' }
      );
    }
    ```
    Where `find_divergent_parent_arrays(batch_size int)` is a one-off RPC defined in 1.15a-script's migration:
    ```sql
    -- Returns rows where the legacy parent_variant_id and array head disagree.
    -- ONLY callable during the 1.15a → 1.15b dual-write window; the SQL relies on the legacy column.
    CREATE OR REPLACE FUNCTION find_divergent_parent_arrays(batch_size int DEFAULT 1000)
    RETURNS TABLE(id uuid, parent_variant_id uuid)
    LANGUAGE sql STABLE
    AS $$
      SELECT id, parent_variant_id FROM evolution_variants
      WHERE parent_variant_id IS NOT NULL
        AND (parent_variant_ids = '{}' OR parent_variant_ids[1] IS DISTINCT FROM parent_variant_id)
      LIMIT batch_size;
    $$;
    ```
    The repair script is idempotent and converges to consistent state. After 1.15b applies and the legacy column is dropped, both `repair-parent-array.ts` and `find_divergent_parent_arrays` become dead code — drop them in a follow-up cleanup PR.
  - **Migration 1.15a-verify** `evolution/scripts/verify-parent-array-backfill.ts` — gates 1.15b deployment. Asserts:
    - Zero rows where `parent_variant_id IS NOT NULL AND parent_variant_ids = '{}'`
    - For all rows where both fields are set: `parent_variant_ids[0] = parent_variant_id`
    - GIN index `idx_evolution_variants_parent_variant_ids` is `valid` per `pg_index.indisvalid`
    Exits 0 on success; exits 1 with diagnostic counts on failure. CI runs this before 1.15b.
  - **Migration 1.15b** `<ts+1d>_evolution_variants_parent_id_drop.sql` (applied AFTER all code in Phase 3.8 + 3.9 is deployed and stable for at least 1 day, confirmed via `evolution/scripts/verify-parent-array-backfill.ts` showing 0 rows where `parent_variant_id IS NOT NULL AND array_length(parent_variant_ids, 1) IS NULL`):
    ```sql
    -- Fail fast rather than hang behind a long-running transaction in production.
    -- Without these, ACCESS EXCLUSIVE on evolution_variants can queue indefinitely
    -- behind an active runIterationLoop transaction; with them, the migration aborts
    -- cleanly and the operator retries during a quieter window.
    SET LOCAL lock_timeout = '5s';
    SET LOCAL statement_timeout = '30s';

    DROP INDEX IF EXISTS idx_evolution_variants_parent_variant_id;
    ALTER TABLE evolution_variants DROP COLUMN parent_variant_id;
    ```
    Brief `ACCESS EXCLUSIVE` lock (millisecond range — DROP COLUMN with no row data to rewrite is a metadata operation in Postgres 11+). With `lock_timeout = '5s'` the migration will fail-fast instead of hanging if a long-running transaction holds a conflicting lock at the moment of deploy. Operator playbook: if 1.15b fails with `LOCK_TIMEOUT`, identify and resolve the holding transaction (likely a stuck pipeline run), then retry the migration. Document this in 1.15b's migration header comment block.
  - The Phase 3.8 persistence layer must dual-write during the 1.15a → 1.15b window: `parent_variant_id: v.parentIds[0] ?? null` AND `parent_variant_ids: v.parentIds.slice(0, 10)`. After 1.15b applies (and types regenerate), drop the old write.
  - Test in staging first; verify backfill batching with realistic row count + duration in migration header comment.
- [x] **1.16** Update Zod schemas for `evolution_variants` in `evolution/src/lib/schemas.ts`. **TWO-STEP sequencing aligned with 1.15a → 1.15b dual-write window**:
  - **Step 1.16a (lands with 1.15a)**: ADD the new field alongside the old; keep BOTH valid:
    - `evolutionVariantsInsertSchema`: ADD `parent_variant_ids: z.array(z.string().uuid()).default([])`. KEEP `parent_variant_id: z.string().uuid().nullable().optional()` so dual-write inserts pass validation.
    - `evolutionVariantsFullDbSchema`: same — both fields present.
    - Document the dual-shape contract in a `// Comment:` block: "DUAL-WRITE WINDOW (between 1.15a and 1.15b): both parent_variant_id (legacy single-FK) and parent_variant_ids (new array) are required by inserts. Phase 3.8's dual-write enforces consistency: parent_variant_id = parentIds[0] ?? null, parent_variant_ids = parentIds. After 1.15b applies, Step 1.16b drops the legacy field."
  - **Step 1.16b (lands with 1.15b — the post-24h drop migration)**: REMOVE the legacy field:
    - `evolutionVariantsInsertSchema`: DROP `parent_variant_id`. Keep only `parent_variant_ids`.
    - `evolutionVariantsFullDbSchema`: DROP `parent_variant_id`. Keep only `parent_variant_ids`.
    - Update comment block to: "Array of parent IDs. parent_variant_ids[0] = canonical primary parent by convention (e.g. judge's winner for debate). Empty array for root variants. Matches in-memory Variant.parentIds shape directly."
  - **Why two steps**: if Step 1.16 replaces the field outright at the same time as 1.15a, the dual-write path in Phase 3.8 (which writes BOTH columns to keep the legacy column populated until 1.15b drops it) would fail Zod validation because the legacy field would be unknown. The two-step sequencing keeps both fields legal during the window and tightens to the array-only shape after the column is gone.
  - Phase 1.21 gating: 1.16a is a Phase-1 task; 1.16b is queued as a follow-up commit landing with Phase 1.15b's drop migration (typically 24+ hours after 1.15a and the rest of Phase 1 is shipped).
- [x] **1.17** Regenerate `src/lib/database.types.ts` via `npm run db:types` — **TWICE** across the dual-write window:
  - **1.17a (after 1.15a applies)**: regeneration adds `parent_variant_ids: string[]` (or `string[] | null` depending on generator) ALONGSIDE the existing `parent_variant_id: string | null`. Both fields appear in `Database['public']['Tables']['evolution_variants']['Row']`. Phase 3.8's dual-write code reads/writes both. Commit this regenerated file in the PR that lands 1.15a + 1.16a.
  - **1.17b (after 1.15b applies)**: regeneration DROPS the now-removed `parent_variant_id` column. Only `parent_variant_ids` remains. Commit this regenerated file in the follow-up PR that lands 1.15b + 1.16b. Without 1.17b, TypeScript would still believe `parent_variant_id` exists, allowing stale code to compile against a deleted column at runtime.
  - **Commit-and-CI guidance**:
  - **Local dev**: developer running `npm run db:types` after applying 1.15a locally MUST commit the regenerated file in the same PR as the migration. The branch's CI pipeline runs `npm run db:types -- --check` (or equivalent diff-against-remote) and fails if the committed types diverge from what regeneration produces against the migration-applied DB. CI does NOT auto-commit — local dev is responsible.
  - **CI parity** — explicit ownership pinned as sub-tasks:
    - [ ] **1.17-CI** Verify presence of `db-types-check` job in `.github/workflows/ci.yml`. If MISSING (likely — this repo's CI does not currently run a types-diff check), the **debate-feature owner** adds the job as part of this phase: applies all migrations to a throwaway Postgres, runs `npm run db:types`, then `git diff --exit-code src/lib/database.types.ts`. Non-empty diff → CI fails with a "regenerate database.types.ts" error message pointing the developer at this task. The CI-job creation is gated by Phase 1.21.
    - [ ] **1.17-CI-test** Smoke-test the new CI job by deliberately committing a stale `database.types.ts` and verifying the job fails; revert before merge.
  - **Why no auto-commit**: auto-committing generated files from CI is an established anti-pattern in this repo (creates PR loops; obscures diff review). Developer commits manually after running migration locally; CI verifies.
  - **Phase 1.21 gate** confirms 1.17 is complete only when the diff-check passes.
- [x] **1.18** Rewrite RPC `get_variant_full_chain(variant_id uuid)` in-place (same function name, new body). Migration timestamp **MUST sort AFTER Phase 1.15a's `<ts>_evolution_variants_parent_ids_array_add.sql`** because the new RPC body queries `parent_variant_ids` (which doesn't exist until 1.15a applies) and **MUST sort BEFORE 1.15b's `<ts+1d>_evolution_variants_parent_id_drop.sql`**. Concrete ordering for the Phase-1 migration filenames (forward-only):
  1. `<base_ts>_evolution_cost_calibration_debate_phase.sql` (Phase 1.6a)
  2. `<base_ts+1s>_seed_debate_synthesis_marker_tactic.sql` (Phase 1.6b)
  3. `<base_ts+2s>_evolution_variants_parent_ids_array_add.sql` (Phase 1.15a — adds column + GIN index)
  4. `<base_ts+3s>_evolution_variants_find_divergent_parent_arrays_rpc.sql` (Phase 1.15a-rollback — `find_divergent_parent_arrays` RPC; ships alongside 1.15a so the repair-parent-array.ts script has its RPC dependency present from the start of the dual-write window. Dropped post-1.15b in a follow-up cleanup migration since the RPC references the legacy column.)
  5. `<base_ts+4s>_evolution_variants_lineage_walker_array.sql` (Phase 1.18 — RPC rewrite, queries new column)
  6. `<base_ts+1d>_evolution_variants_parent_id_drop.sql` (Phase 1.15b — drops old column, applied 24+ hours after 5 once dual-write is verified)
  7. `<base_ts+1d+1s>_evolution_variants_drop_find_divergent_rpc.sql` (post-1.15b cleanup — drops `find_divergent_parent_arrays` RPC since legacy column is gone)

  Rename below to use the actual `<base_ts+3s>` timestamp prefix:
  Migration `<base_ts+3s>_evolution_variants_lineage_walker_array.sql`:
  ```sql
  -- Walks parent_variant_ids array recursively via unnest(). Returns one row
  -- per (variant, parent) tuple, ordered root→child. parent_index field
  -- captures position in the parent array (0 = primary, 1+ = additional).
  -- Cycle detection via array-path. Hop cap 20 to match iterationConfigs.max.
  CREATE OR REPLACE FUNCTION get_variant_full_chain(p_variant_id uuid)
  RETURNS TABLE(
    variant_id uuid,
    parent_id uuid,
    parent_index int,        -- 0 = primary; 1+ = additional parents
    depth int,
    cycle_detected boolean
  )
  LANGUAGE sql STABLE
  AS $$
    WITH RECURSIVE chain AS (
      SELECT id AS variant_id, NULL::uuid AS parent_id, NULL::int AS parent_index,
             0 AS depth, false AS cycle_detected, ARRAY[id] AS path
      FROM evolution_variants WHERE id = p_variant_id
      UNION ALL
      SELECT child.variant_id, parent_uuid AS parent_id, parent_idx::int AS parent_index,
             child.depth + 1, parent_uuid = ANY(child.path) AS cycle_detected,
             child.path || parent_uuid
      FROM chain child
      JOIN evolution_variants v ON v.id = child.variant_id
      LEFT JOIN LATERAL unnest(v.parent_variant_ids) WITH ORDINALITY AS p(parent_uuid, parent_idx) ON true
      WHERE child.depth < 20
        AND parent_uuid IS NOT NULL
        AND NOT child.cycle_detected
    )
    SELECT variant_id, parent_id, parent_index, depth, cycle_detected
    FROM chain WHERE parent_id IS NOT NULL ORDER BY depth, parent_index;
  $$;
  ```
  Old single-FK behavior covered by the new walker (single-parent variants still produce a chain — just with `parent_index = 0` everywhere). All existing callers continue working without query changes; new multi-parent ancestry shows up as additional rows with `parent_index > 0`. NO separate `get_variant_full_dag` RPC — one walker handles all cases.

  **Backfill ordering — RPC must NOT deploy before backfill completes.** If 1.18's RPC body deploys at base_ts+3s (right after 1.15a at base_ts+2s), but 1.15a-script (the row backfill) runs asynchronously afterward, then between RPC deploy and backfill completion the RPC returns EMPTY chains for unbackfilled rows (because their `parent_variant_ids = '{}'`). Two correctness options:

  - **Option (a) — DEFERRED RPC DEPLOY (chosen)**: 1.18 migration is queued in the same migration directory as 1.15a/1.15b but its `<base_ts+3s>` filename is overridden to `<post_backfill_ts>` — applied by the operator AFTER `verify-parent-array-backfill.ts` exits 0. Migration runner sequences by filename, so giving 1.18 a later timestamp delays its deploy until backfill is verified. Document this dependency in 1.18's migration header comment block: `-- DEPENDS ON: backfill-parent-array.ts having completed; gate via verify-parent-array-backfill.ts before applying.`

  - **Option (b) — RPC FALLBACK** (rejected): make 1.18's RPC body read `COALESCE(parent_variant_ids, ARRAY[parent_variant_id])` so unbackfilled rows still produce single-parent chains during the window. Rejected because (i) it requires writing to RPC body knowing both columns exist, but post-1.15b the legacy column is gone and RPC body would need a follow-up edit; (ii) creates two valid RPC bodies in code review history; (iii) Option (a) is operationally simpler.

  **Operator playbook for the deploy sequence**:
  1. Apply 1.15a (`<base_ts+2s>`) → column added, GIN index built (empty).
  2. Run `evolution/scripts/backfill-parent-array.ts`.
  3. Run `evolution/scripts/verify-parent-array-backfill.ts` → must exit 0.
  4. Apply 1.18 (`<post_backfill_ts>`) → RPC rewritten; lineage queries return correct rows for all variants.
  5. Wait 24+ hours; verify dual-write code in Phase 3.8 is consistently writing both columns.
  6. Apply 1.15b (`<post_backfill_ts + 1d>`) → legacy column dropped.
  7. Apply Step 1.16b (Zod schema) + 1.17b (regenerated types) — code-only PRs that follow 1.15b.
- [x] **1.19** Add explicit `supportsReasoning: boolean` field to `ModelInfo` in `src/config/modelRegistry.ts` (REQUIRED, not optional — every entry must declare yes/no). Update all ~12 registry entries: `gpt-oss-20b`, `qwen/qwen3-8b`, `o3-mini` get `supportsReasoning: true`; everything else (`gpt-4.1-*`, `gpt-5-*`, `gpt-4o-*`, `claude-sonnet-4-*`, `deepseek-chat`, `LOCAL_*`) gets `supportsReasoning: false`. Add helper `modelSupportsReasoning(modelId): boolean` exported from `modelRegistry.ts`. Add startup consistency check: `defaultReasoningEffort` may only be set when `supportsReasoning === true`; throw at module init otherwise. Replaces all `defaultReasoningEffort !== undefined` proxy checks throughout the codebase (Phase 1.14 cross-field refinement, Phase 2.5 cascade resolver, Phase 4.6 wizard UX) with direct `supportsReasoning` reads. Update the 2 existing call sites of `getModelDefaultReasoningEffort()` in `src/lib/services/llms.ts:398` to keep working unchanged — that helper is a separate concern (returns the EFFORT level, not the capability boolean).
- [x] **1.20** **Reasoning trace extraction in `callLLM`** (`src/lib/services/llms.ts`). Currently extracts `reasoningTokens` count only (line ~487). Add per-provider trace-text extraction returning `{ reasoningTrace?: string; reasoningTraceFormat?: 'verbatim' | 'summary' | 'unavailable' }` in `LLMUsageMetadata`:
  - **OpenRouter models** (provider==='openrouter'): when `effectiveReasoningEffort` is set, ensure request includes `reasoning: { effort, ... }` AND default `include_reasoning: true` to surface trace. Parse `response.choices[0].message.reasoning_details[]`; concatenate text fields; mark `'verbatim'`. If reasoning was set but `reasoning_details` is missing or empty, mark `'unavailable'` (some OpenRouter providers silently drop — flag observability metric `llm_reasoning_trace_silently_dropped` with `{model, provider}` for audit).
  - **OpenAI direct** (provider==='openai') for o-series + GPT-5 series: when `effectiveReasoningEffort` is set, opt in to summaries via `reasoning: { summary: 'auto' }` on the request. Parse `response.output[]` for the reasoning item, then `firstReasoningItem.summary[0].text`. Mark `'summary'`. **DO NOT attempt raw chain-of-thought extraction** — OpenAI AUP explicitly prohibits and may result in suspension. **API-path note**: this extraction shape applies to the OpenAI **Responses API** (`/v1/responses`) used for o-series. For Chat Completions API (`/v1/chat/completions`) calls, the response field path differs (`response.choices[0].message.reasoning`-shaped depending on SDK version) — verify which API client path `callLLM` uses for each model and gate the extraction on the API client. Add a unit-test fixture per API path in `src/lib/services/llms.test.ts` so a future SDK version bump is caught by the test rather than silently breaking trace extraction.
  - **Anthropic direct** (provider==='anthropic'): **NOTE — currently dead code in v1**. The Anthropic branch is wired but UNREACHABLE in v1 because every `claude-*` registry entry has `supportsReasoning: false` (Phase 1.19), so the cascade resolver returns `undefined` and `effectiveReasoningEffort` never fires. Branch is implemented future-ready: when ops decides to flip `claude-sonnet-4-20250514` to `supportsReasoning: true` in a follow-up PR, the extraction Just Works without further callLLM changes. Until then, the branch is documented but exercised only by unit-test mocks (NOT integration tests). When live: request `thinking: { type: 'enabled', budget_tokens: <derived from effort> }`; parse `response.content[]` for blocks where `type === 'thinking'`; extract `thinking` field. Mark `'summary'` (Sonnet 4 returns summary, NOT verbatim — Claude 3.7 was different but isn't in registry). The `signature` field is encrypted and not human-readable; ignore. **Defensive throw-guard**: at the top of the Anthropic branch, assert `Object.values(MODEL_REGISTRY).some(m => m.provider === 'anthropic' && m.supportsReasoning)` — if NO `claude-*` entry has `supportsReasoning: true`, this branch should NEVER fire. If it does (regression — e.g., upstream change accidentally routes a request here without flipping the registry), throw `new Error('Anthropic reasoning extraction reached but no claude-* model has supportsReasoning=true; verify Phase 1.19 registry update before relying on this branch')`. Catches activation-without-test-coverage at runtime.
  - **Other providers** (DeepSeek non-reasoner, Local): no-op. Trace-text fields stay undefined.
  - DebateAgent reads these from `LLMUsageMetadata` and persists into `execution_detail.debate.combined.{reasoningTrace, reasoningTraceFormat, reasoningTokens}`.
  - **Three-state semantics** (resolves the ambiguity reviewers flagged):
    - `reasoningTokens === 0` AND `reasoningTraceFormat === undefined`: thinking was NOT requested (effort was none / model doesn't support reasoning / cascade returned undefined). UI renders a collapsed gray bar "Reasoning Trace — not surfaced (effort=none)".
    - `reasoningTokens > 0` AND `reasoningTraceFormat === 'verbatim' | 'summary'`: thinking happened AND trace was extracted. UI renders the trace block with format-aware label.
    - `reasoningTokens > 0` AND `reasoningTraceFormat === 'unavailable'`: thinking happened (token count proves it) BUT provider did not surface text. UI renders "Thinking happened ({reasoningTokens} tokens) but provider did not return trace text"; observability metric `llm_reasoning_trace_silently_dropped` is incremented at the callLLM layer with `{model, provider}` for audit.
    - The `'unavailable'` value is RESERVED for case 3 only — never used as a no-thinking-happened sentinel. This invariant is asserted in unit tests.
  - Unit tests in `src/lib/services/llms.test.ts`: 5 cases — OpenRouter verbatim path, OpenAI summary path, Anthropic summary path (mocked-only since dead in v1), "unavailable" silent-drop path (reasoningTokens > 0, no trace), and "no thinking requested" path (reasoningTokens === 0, traceFormat undefined). Mocked SDK responses for each shape.
- [x] **1.21** Phase 1 acceptance gates — each must pass independently before Phase 2 begins:
  - [ ] **1.21.a** Lint clean (`npm run lint`).
  - [ ] **1.21.b** `tsc --noEmit` clean.
  - [ ] **1.21.c** `npm run build` succeeds.
  - [ ] **1.21.d** Unit tests pass (`npm run test:unit -- --testPathPattern="schemas|modelRegistry|debate"`).
  - [ ] **1.21.e** Schema-test diff: `evolution/src/lib/schemas.test.ts` round-trip for the new `debate_then_generate_from_previous_article` detailType is green; this is the specific gate for Phase 1.2 (schema definition).
  - [ ] **1.21.f** Migration ordering: 1.15a + 1.18 + 1.6a + 1.6b applied to staging successfully (verified via `verify-parent-array-backfill.ts` exits 0 + RPC returns expected rows). This is the gate for Phase 1.17a (regenerate types AFTER migration runs).
  - [ ] **1.21.g** `MODEL_REGISTRY` carries `supportsReasoning: boolean` on every entry (Phase 1.19); `modelRegistry.test.ts` typed-test passes. This is the gate for Phase 1.14's cross-field refinement (refinement reads `supportsReasoning`).
  - [ ] **1.21.h** `db-types-check` CI job (Phase 1.17-CI) is committed and the smoke-test from Phase 1.17-CI-test passes (sample stale-types commit fails CI as expected, then is reverted before merge).

### Phase 2 — DebateAgent class + helpers + unit tests (~3 days)

- [x] **2.1** Create `evolution/src/lib/core/agents/debate/DebateAgent.ts`:
  - Class `extends Agent<DebateInput, DebateOutput, DebateExecutionDetail>`
  - Header comment block declaring load-bearing invariants I1 / I2 / I3 verbatim (mirror Decisions §13 from `bring_back_editing_agents_evolution_20260430`)
  - `usesLLM = true`, `name = 'debate_then_generate_from_previous_article'`
  - `getAttributionDimension(detail) → 'debate_synthesis'`
  - **Option C 2-phase** `execute(input, ctx)` body. **CRITICAL — read `input.llm`, NOT `ctx.llm`** (mirrors GFPA/IterativeEditing/EvaluateCriteria; `Agent.run()` injects the cost-tracking client into `effectiveInput.llm` per `Agent.ts:96-119`):
    1. `const llm = input.llm!;` — guard with `if (!llm) throw new Error('DebateAgent: input.llm is required')`
    2. `costBeforeCombinedCall = ctx.costTracker.getOwnSpent?.() ?? 0` snapshot
    3. ONE combined "analyze+judge" LLM call: `llm.completeStructured(prompt, debateVerdictSchema, 'debate-verdict', 'debate_judge', { model: judgeModel, reasoningEffort })` — cost recorded under `debate_judge` AgentName per Phase 1.4; `reasoningEffort` resolved via `resolveDebateJudgeReasoningEffort` cascade per task 1.14.
    4. Parse structured output (Phase 2.3 parser).
    5. **PRE-SYNTHESIS BUDGET GATE** (per Decision §8): if `ctx.costTracker.getOwnSpent?.() ?? 0 >= 0.9 * COST_CAP` (where `COST_CAP = 0.40`), throw with `failurePoint='budget'` BEFORE invoking inner GFPA — partial detail captures the verdict but no synthesis.
    6. `costBeforeGfpaCall = ctx.costTracker.getOwnSpent?.() ?? 0`
    7. Construct **synthesis LLM-client proxy** (concrete shape in Phase 1.4) wrapping `input.llm` (NOT `ctx`): rewrites `agentName === 'generation' → 'debate_synthesis'` for BOTH `complete` and `completeStructured`.
    8. Build `innerInput` with `parentText = winner.text` (per Decision §20: synthesis revises the winner using the loser's strengths), `customPrompt` derived from verdict, AND `llm: synthesisLlmProxy` — this is the load-bearing injection point.
    9. `await innerGfpa.execute(innerInput, ctx)` (NOT `.run()` — invariant I1). GFPA's call uses strategy's `generationModel` per its existing contract — no override. The proxy makes synthesis cost flow to `debate_cost` metric / `EstPerAgentValue.debate` field, NOT `generation_cost` / `EstPerAgentValue.gen`.
  - **Load-bearing invariant I4** (NEW, document in header comment block verbatim): "The synthesis-LLM-proxy must (a) be injected via `innerInput.llm` (NOT `ctx`), (b) wrap BOTH `complete` and `completeStructured` of `EvolutionLLMClient`, and (c) rewrite `'generation' → 'debate_synthesis'` while passing through all other AgentNames (especially `'ranking'` so Swiss-style pairwise comparisons inside GFPA still tag `ranking_cost`). Without I4 the synthesis cost flows to `generation_cost` and `EstPerAgentValue.gen` instead of `EstPerAgentValue.debate`, silently breaking the cost-attribution contract."
  - **Multi-parent variant emission** (Decision §20): the synthesis variant returned in `AgentOutput.newVariants[0]` has `parentIds = [winner.id, loser.id]` — `parentIds[0]` is the judge's winner (canonical primary), `parentIds[1]` is the loser. Both are pool variants present in `iterationStartPool`. Order is load-bearing because `persistRunResults.ts` writes `parent_variant_ids: v.parentIds` directly (Phase 3.8) — `parentIds[0]` → `parent_variant_ids[0]` (the canonical primary). NO arrangement other than `[winner, loser]`.
  - Partial-detail-on-throw at every failure point (gate, selection, combined_call, parse, judge_tie, synthesis, synthesis_empty, synthesis_no_op, budget)
- [x] **2.2** Prompt builders in `evolution/src/lib/core/agents/debate/promptBuilders.ts`:
  - `buildCombinedAnalyzeAndJudgePrompt(parentA, parentB, critiqueContextA, critiqueContextB)` — one prompt asking for structured `{prosA, consA, prosB, consB, winner, reasoning, strengthsFromA, strengthsFromB, improvements}`. **Prompt is identical regardless of `reasoningEffort`** (per Decision §19) — reasoning models think first, then write structured output; forcing structured output downstream of thinking is safe. Synthesizes V1's three Advocate-A / Advocate-B / Judge prompts into one. Critique context blocks for each parent included.
  - `buildSynthesisCustomPrompt(judgeVerdict)` — returns `{ preamble, instructions }` shape per GFPA's `customPrompt` API; embed `strengthsFromA` / `strengthsFromB` / `improvements` lists from verdict.
- [x] **2.3** Parser `parseCombinedAnalyzeAndJudge(rawResponse)` — JSON parse + validate all 9 required fields (winner enum, arrays for pros/cons/strengths/improvements, string for reasoning). Throws `DebateParseError` with `rawResponse` field on failure. **Independent of reasoning trace** — parser only sees the structured-output portion; reasoning trace is captured separately at the LLM client layer (per `callLLM`'s usage metadata when `reasoningTokens > 0`).
- [x] **2.4** Critique-context helper `buildCritiqueContext(variantId, db, k=3)` in `evolution/src/lib/core/agents/debate/critiqueContext.ts`:
  - **CORRECTION** (originally specified `strategy_id = current` filter — but `evolution_arena_comparisons` has NO `strategy_id` column; verified against `src/lib/database.types.ts:385-419` which lists exactly: `id, prompt_id, entry_a, entry_b, winner, confidence, run_id, status, created_at`). Strategy scope is implicit because each `variant_id` is unique to one `run_id` which is unique to one `strategy_id` — so filtering by variant ID alone already strategy-scopes the result.
  - Fetch:
    - Last K wins: `SELECT * FROM evolution_arena_comparisons WHERE (entry_a = :variantId AND winner = 'A') OR (entry_b = :variantId AND winner = 'B') AND created_at >= now() - interval '14 days' ORDER BY created_at DESC LIMIT :k`
    - Last K losses: same shape but with the winner conditions inverted
    - Skip rows where `winner = 'tie'` (Decision §13: ties don't count as either) — add to WHERE: `AND winner IN ('A', 'B')`
  - Optional but recommended: also LEFT JOIN to `evolution_runs` on `run_id` and add `WHERE evolution_runs.strategy_id = :strategyId` IF the agent has `strategyId` in context (cheap defense-in-depth against cross-strategy arena rows that shouldn't exist but might if a prior bug allowed). The `strategyId` is available on `AgentContext` via the existing context plumbing.
  - Format as text block "Past wins: [...]; Past losses: [...]" or "No prior match data" fallback when zero rows returned in the 14-day window.
  - Test (extending Phase 2.6): assert query selects only rows where `entry_a` OR `entry_b` matches the target variant; assert ties are excluded; assert 14-day window is respected; assert empty result returns the fallback string verbatim.
- [x] **2.5** Dispatch helper `evolution/src/lib/pipeline/loop/debateDispatch.ts` (mirror `editingDispatch.ts`):
  - `resolveDebateDispatchRuntime(args)` — selects top-2 non-arena non-seed variants from pool by Elo desc with deterministic id-tiebreak
  - `resolveDebateDispatchPlanner(args)` — projects `willDispatch: boolean` for wizard preview
  - `resolveDebateEnabled(env)` — reads `EVOLUTION_DEBATE_ENABLED` (default `'true'`)
- [x] **2.6** Unit tests in `evolution/src/lib/core/agents/debate/DebateAgent.test.ts` (~24 cases per brief §test plan, ~600 LOC):
  - `agent.name`, `usesLLM`, `detailViewConfig` parity
  - Happy path (4 LLM calls, judge parses, synthesis emitted, surfaced=true)
  - Gate fail (pool < 2 non-arena rated), top-2 selection tiebreak, critique-context build + fallback
  - Cost snapshots: per-purpose split sums to `getOwnSpent()`
  - Each failure mode: partial detail written before re-throw, correct `failurePoint`
  - Judge `winner='tie'` → surfaced=false on emitted variant
  - Inner GFPA called via `.execute()` not `.run()` (I1 invariant)
  - Cost attribution: synthesis cost flows to `debate_cost` not `generation_cost`. **Test must exercise the REAL `createEvolutionLLMClient` cost-write path** (NOT a mocked `input.llm.complete`) so the proxy's effect on `costTracker.recordSpend(agentName, ...)` is observable. Specifically: construct a real `EvolutionLLMClient` via `createEvolutionLLMClient({ rawProvider: stubbedRawProvider, costTracker: realCostTracker, ... })`, run the agent, then assert `realCostTracker.getPhaseCosts()` has `debate_judge > 0` AND `debate_synthesis > 0` AND `generation === undefined` (or 0). Without this REAL-client integration, a mocked `input.llm` would silently false-pass the proxy contract per I4.
  - Synthesis identical-to-parent → surfaced=false, failurePoint='synthesis_no_op' (cheap normalized-string-equality check against BOTH parents — Jaccard ≥ 0.85 vs A or B)
  - Per-invocation budget cap fires before synthesis → failurePoint='budget'
  - **Multi-parent emission test**: assert `result.newVariants[0].parentIds.length === 2` AND `parentIds[0] === winner.id` AND `parentIds[1] === loser.id`, for BOTH winner=A and winner=B test cases. Both position assertions are required — checking length + position 0 alone wouldn't catch a regression that wrote `[winner, winner]` or `[winner, undefined]`.
- [x] **2.7** Schema tests: extend `schemas.test.ts` with debate cases (round-trip, discriminated union, partial-detail rows, refines).
- [x] **2.8** Dispatch-helper tests: new `debateDispatch.test.ts` (~11 cases).
- [x] **2.9** Cost-estimator tests: extend `estimateCosts.test.ts` with `estimateDebateCost` cases.
- [x] **2.10** Invariants test `DebateAgent.invariants.test.ts` mirroring `IterativeEditingAgent.invariants.test.ts` — assert `.run(` not present in `execute()` body, cost snapshots before each helper call, partial detail at every throw site.

### Phase 3 — Pipeline integration + dispatch site + multi-parent persistence (~2 days)

- [x] **3.1** Register `DebateAgent` in `agentRegistry.ts` as static import (B054 invariant — no dynamic `await import()`).
- [x] **3.2** Add new `else if (iterType === 'debate_and_generate')` dispatch branch in `runIterationLoop.ts` between iterative_editing branch (~line 944) and swiss branch. ~80 LOC. See brief §10 (Round 2D output) for the full code skeleton.
- [x] **3.3** Mirror env kill-switch read in `strategyPreviewActions.ts:285` peer to `reflectionEnabled`. Update mirror comment at line 215 for `EstPerAgentValue` keys to include `debate`.
- [x] **3.4** Update `MergeRatingsInput.iterationType` enum to add `'debate'` (NOT `'debate_and_generate'` — merge agent uses simpler iteration-type tags per existing convention).
- [x] **3.5** Cost-estimator branch in `projectDispatchPlan.ts` for `'debate_and_generate'` agentType.
- [x] **3.6** Integration test `evolution-debate-agent.integration.test.ts` (mirror `evolution-iterative-editing-agent.integration.test.ts`):
  - Real Postgres, mocked LLM responses. **2 stubbed completions for the wrapper layer** (per Option C: ONE combined analyze+judge call → ONE inner-GFPA synthesis call; was 4 stubs under the original Option A 4-call shape). **Plus N stubbed ranking-judge completions** for the inner GFPA's Swiss-style `tacticRanking` invocations (number depends on `numTacticsToTry × ratingsPerTactic` for the test strategy; mock as a flexible matcher, not a fixed count).
  - Strategy: 1 generate + 1 debate iteration. Generate iteration produces ≥2 pool variants so debate has top-2 to select from.
  - Verify:
    - Variant lands with `agent_name = 'debate_then_generate_from_previous_article'` (the wrapper's name field, NOT `'generation'`)
    - `arena_comparisons` rows from synthesis ranking exist with `parent_a_id`/`parent_b_id` referencing pool variants
    - `debate_cost` metric > 0 in `evolution_metrics` for the iteration
    - Iteration snapshot has `iterationType: 'debate'`
    - **Multi-parent assertion** (Decision §20): the synthesized variant's DB row has `parent_variant_ids = [winner.id, loser.id]` in that EXACT order (`parentIds[0]` is the canonical primary). Read the row via Supabase client; assert `row.parent_variant_ids.length === 2 && row.parent_variant_ids[0] === <judge's-winner-from-execution-detail> && row.parent_variant_ids[1] === <the other parent>`. Cross-check against `execution_detail.debate.combined.winner` to confirm the judge's verdict matches the persisted lineage.
    - **Old column gone** (post-1.15b): assert `parent_variant_id` column does NOT exist by querying `information_schema.columns`. Skip this assertion if integration test runs in the 1.15a→1.15b window where dual-write is active.
- [x] **3.7** Integration test `strategy-preview-debate-dispatch.integration.test.ts`:
  - Preview returns `EstPerAgentValue` with `debate` field populated
  - With `EVOLUTION_DEBATE_ENABLED='false'` → preview returns `debate=0`
- [x] **3.8a (lands with 1.15a + 1.16a + 1.17a — DUAL-WRITE)**: Persistence layer dual-write (Decision §20). Update `evolution/src/lib/pipeline/finalize/persistRunResults.ts` (search for `parent_variant_id: v.parentIds[0]` — that's the existing flatten site):
  - REPLACE the single-FK assignment with **dual-write**:
    ```ts
    parent_variant_id: v.parentIds[0] ?? null,           // KEEP (legacy column, dropped in 1.15b)
    parent_variant_ids: v.parentIds.slice(0, MAX_PARENT_IDS),  // NEW (array column, primary going forward)
    ```
    where `MAX_PARENT_IDS = 10` is exported from a shared constants module so future agents and tests reference one source of truth.
  - Defensive truncation cap: if `v.parentIds.length > MAX_PARENT_IDS`, also `console.warn({ variantId, droppedCount: v.parentIds.length - MAX_PARENT_IDS })` for diagnosability.
  - Empty arrays for root/seed variants are valid (`parentIds: []` → DB row stores `parent_variant_id = null`, `parent_variant_ids = '{}'::uuid[]`).
  - **Consistency invariant during dual-write**: `parent_variant_id` always equals `parent_variant_ids[0] ?? null`. Add a defensive assertion gated by `process.env.NODE_ENV !== 'production'`: in dev/test, throw on inconsistency to catch regressions immediately; in production, log a `console.error` with structured context (`{variantId, parentVariantId, parentVariantIds}`) and emit operational metric `dual_write_inconsistency_count` instead of throwing — keeps writes flowing rather than killing the iteration loop. Concrete shape:
    ```ts
    const head = parentVariantIds[0] ?? null;
    if (parentVariantId !== head) {
      const msg = `Dual-write inconsistency: parent_variant_id=${parentVariantId}, parent_variant_ids[0]=${head}`;
      if (process.env.NODE_ENV !== 'production') throw new Error(msg);
      logger?.error(msg, { variantId: v.id, parentVariantId, parentVariantIds });
      metrics?.increment('dual_write_inconsistency_count');
    }
    ```
  - Update unit test in `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`:
    - `parentIds=[a, b]` → DB row has `parent_variant_id = 'a'` AND `parent_variant_ids = ['a', 'b']`
    - `parentIds=[a]` → DB row has `parent_variant_id = 'a'` AND `parent_variant_ids = ['a']`
    - `parentIds=[]` → DB row has `parent_variant_id = null` AND `parent_variant_ids = []`
    - `parentIds=[a, b, c, ..., 11+]` → console.warn fires; DB row has `parent_variant_id = 'a'` AND `parent_variant_ids` first 10 elements
- [x] **3.8b (lands with 1.15b + 1.16b + 1.17b — POST-DROP)**: Drop the legacy write path now that the column is gone. Edit `persistRunResults.ts`:
  - REMOVE the `parent_variant_id: v.parentIds[0] ?? null` line entirely.
  - REMOVE the dev-mode dual-write consistency assertion.
  - Keep `parent_variant_ids: v.parentIds.slice(0, MAX_PARENT_IDS)` as the only assignment.
  - Update unit test: drop the dual-column assertions; keep only `parent_variant_ids` assertions.
  - This task is queued as a follow-up commit landing with the post-1.15b PR (typically 24+ hours after Phase 3.8a ships).
- [x] **3.9** **Audit + update all `parent_variant_id` call sites** to use `parent_variant_ids` array. Concrete scope per `grep -rn "parent_variant_id" evolution/ src/ supabase/migrations/ | grep -v "parent_variant_ids"` run on 2026-05-06: **152 hits across 43 files**. The full file list (all 43) is enumerated below; each must be audited individually. The audit produces a checklist: every grep hit either (a) updated, (b) explicitly justified as unrelated (e.g., string literals in test descriptions, comments mentioning V1 history, deleted-old-migration filenames), OR (c) intentionally retained during the 1.15a→1.15b dual-write window. TypeScript will catch any missed reads in `database.types.ts`-typed code AFTER 1.17 regenerates types; raw SQL needs manual review.

  **Source code (must be updated):**
  - `evolution/src/lib/schemas.ts` — covered by Phase 1.16
  - `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — covered by Phase 3.8
  - `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts` — covered by Phase 3.8
  - `evolution/src/lib/pipeline/finalize/lineageCtesafety.integration.test.ts` — update lineage walks to use `parent_variant_ids`; assert `parent_index` returned by RPC
  - `evolution/src/lib/pipeline/finalize/variantInvocationLink.integration.test.ts` — update fixture inserts
  - `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — audit parent-id references (likely log strings or fixture queries)
  - `evolution/src/lib/pipeline/loop/resolveParent.ts` — replace single-id resolution with `parentIds[0]` (canonical primary) reads from in-memory variants
  - `evolution/src/lib/pipeline/loop/poolSourcing.integration.test.ts` — update fixture inserts and assertions
  - `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts` — emits `parentIds = [parent.id]` (1-element array) instead of single `parent_variant_id` field; audit the agent's variant-emission path
  - `evolution/src/lib/metrics/attributionPipeline.integration.test.ts` — update lineage queries
  - `evolution/src/lib/metrics/computations/criteriaMetrics.ts` and `criteriaMetrics.test.ts` — replace `WHERE parent_variant_id = X` with `WHERE X = ANY(parent_variant_ids)`
  - `evolution/src/lib/metrics/experimentMetrics.ts` — same WHERE-clause update pattern
  - `evolution/src/services/arenaActions.ts` and `arenaActions.test.ts`
  - `evolution/src/services/evolutionActions.ts` and `evolutionActions.test.ts`
  - `evolution/src/services/evolutionVisualizationActions.ts` and `evolutionVisualizationActions.test.ts` — covered by Phase 4.9 (`getLineageData` returns `(child, parent, parent_index)` triples)
  - `evolution/src/services/invocationActions.ts`
  - `evolution/src/services/variantDetailActions.ts` and `variantDetailActions.test.ts` — covered by Phase 4.9 (`VariantDetailContent` reads `parent_variant_ids: string[]`)
  - `evolution/src/components/evolution/tabs/VariantsTab.tsx` — table column rendering; replace single-parent-id link with chip-list (1 chip if length=1, multi-chip with primary/additional labels otherwise)
  - `evolution/src/__tests__/integration/evolution-iterative-editing-agent.integration.test.ts` — update lineage assertions
  - `evolution/src/__tests__/integration/evolution-variant-criteria-roundtrip.integration.test.ts` — update fixture inserts and assertions
  - `src/app/admin/evolution/arena/arenaBudgetFilter.test.ts` and `[topicId]/page.tsx`
  - `src/app/admin/evolution/invocations/[invocationId]/InvocationDetailContent.tsx`
  - `src/app/admin/evolution/variants/page.tsx`
  - `src/__tests__/integration/attributionFinalization.integration.test.ts`
  - `src/__tests__/e2e/helpers/evolution-test-data-factory.ts` — replace `parent_variant_id` fixture sets with `parent_variant_ids` arrays
  - `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` — update lineage assertions in existing E2E so it doesn't break post-migration
  - `src/lib/database.types.ts` — auto-regenerated by Phase 1.17

  **Generated/auto-regenerated (no manual edit):**
  - `src/lib/database.types.ts` — regenerated by 1.17 (`npm run db:types`)

  **Migrations — DO NOT EDIT (forward-only contract):**
  - `supabase/migrations/20260418000001_variants_parent_variant_id_index.sql` — historical; superseded by 1.15a's GIN index
  - `supabase/migrations/20260418000002_variants_get_full_chain_rpc.sql` — historical; superseded by Phase 1.18 in-place rewrite
  - The Phase 1.15b drop migration has its own filename; new code created in this project goes through Phase 1 migration filenames per the timestamp ordering in 1.18.

  **Documentation (must be updated; NOT enforced by TypeScript):**
  - `evolution/docs/agents/overview.md` — covered by Phase 5.2
  - `evolution/docs/architecture.md` — covered by Phase 5.3
  - `evolution/docs/curriculum.md` — audit and update lineage references
  - `evolution/docs/data_model.md` — covered by Phase 5.7 + 5.11 (Multi-parent subsection)
  - `evolution/docs/editing_agents.md` — audit (mostly comparison context with debate)
  - `evolution/docs/entities.md` — audit (Variant entity description)
  - `evolution/docs/strategies_and_experiments.md` — covered by Phase 5.5
  - `evolution/docs/variant_lineage.md` — full rewrite for array semantics; this is the canonical lineage doc
  - `evolution/docs/planning/multi_iteration_strategy_support_evolution_20260415/...` — historical planning doc; leave untouched (frozen artifact)

  **Audit deliverable** (gate for marking 3.9 done):
  - [ ] **3.9-snapshot** Capture initial grep snapshot now: `grep -rn "parent_variant_id" evolution/ src/ supabase/migrations/ | grep -v "parent_variant_ids" > docs/planning/bring_back_debate_agent_20260506/parent_variant_id_audit_snapshot.txt`. Commit the snapshot file as the baseline (152 hits / 43 files at 2026-05-06 capture).
  - [ ] **3.9-deliverable** Produce `docs/planning/bring_back_debate_agent_20260506/parent_variant_id_audit.md` with one row per grep hit and the action taken (update / justified-as-unrelated / dual-write / deferred-to-1.15b). Owner: debate-feature owner. The audit doc is the gate for marking 3.9 done.
  - [ ] **3.9-rerun** AFTER Phase 1.17a regenerates `database.types.ts`, re-run the grep (TypeScript will surface call-sites that became visible only post-regeneration; raw SQL still needs manual review). Append a "Post-1.17a re-run" section to the audit doc listing any new/changed call-sites and the action taken. Without this re-run, call-sites that were typed `string | null` (legacy) and only flip to `string[]` after regeneration may be silently missed.

### Phase 4 — UI: invocation-detail page + wizard + multi-parent lineage (~2 days; partially parallelizable with Phase 3)

- [x] **4.1** Replace orphan config at `detailViewConfigs.ts:380-397` with full V2 config. **CRITICAL — KEY RENAME**: the orphan V1 entry is keyed `'debate'` in the `DETAIL_VIEW_CONFIGS` map; the V2 wrapper uses snake_case detailType `'debate_then_generate_from_previous_article'` (Decision §4) and the map key MUST match the detailType literal exactly because `entities.test.ts` parity test asserts `Object.keys(DETAIL_VIEW_CONFIGS) === detailType union of agentExecutionDetailSchema`. So: DELETE the `'debate'` key; ADD a NEW `'debate_then_generate_from_previous_article'` key. Do NOT keep the old key as an alias — the parity test will reject it. 5-tab layout: variantA/B object cards + analysis pros/cons table + reasoning trace block (FORMAT-AWARE — see below) + judgeVerdict object + costBreakdown object on `overview-debate`; generation + ranking + ranking.comparisons + discardReason on `overview-synthesis`. Reasoning trace block label is dynamic based on `execution_detail.debate.combined.reasoningTraceFormat`:
  - `'verbatim'` → header "Reasoning Trace (verbatim — model's raw deliberation)"; trace text rendered in collapsible block
  - `'summary'` → header "Reasoning Summary (provider-summarized — raw chain-of-thought not exposed by this provider)"; summary text rendered in collapsible block; tooltip explains why (OpenAI AUP, Anthropic Claude 4 default)
  - `'unavailable'` → "Thinking happened ({reasoningTokens} tokens) but provider did not return trace text"
  - When `reasoningTokens === 0` (no thinking effort applied) → collapsed gray bar "Reasoning Trace — not surfaced (effort=none)"
  Implementing format-aware label may need a small `DetailFieldDef` extension — either a new `'conditional-text-block'` field type or a customRenderer hook. Decide between cellClassName-style approach vs. a dedicated `reasoning-trace` field type during 4.1.
- [x] **4.2** Mirror config in `DebateAgent.detailViewConfig` field — assert parity in `entities.test.ts` parity test (mirror IterativeEditing parity test).
- [x] **4.3** Add `'debate_then_generate_from_previous_article'` branch to `buildTabs` in `InvocationDetailContent.tsx` returning 5 tabs: `overview-debate` / `overview-synthesis` / `metrics` / `timeline` / `logs`.
- [x] **4.4** Add 2 keyFilter rules in `InvocationExecutionDetail.tsx` for `overview-debate` and `overview-synthesis` tabs (per brief §3b).
- [x] **4.5** Reuse the standardized `evolution/src/components/evolution/tabs/InvocationTimelineTab.tsx` component (shared with reflect_and_generate, evaluate_criteria_then_generate, iterative_editing, vanilla GFPA — no new component built). Add **1** color constant: `DEBATE_COLOR='#f472b6'` (rose) for the combined analyze+judge segment. Synthesis reuses existing `GENERATION_COLOR='#3b82f6'` (blue). Ranking reuses existing `RANKING_COLOR='#8b5cf6'` (purple) and `COMPARISON_COLOR='#a78bfa'` (lighter purple) for sub-bars. Add `extractDebatePhases(invocation)` function returning `PhaseSegment[]` with three top-level segments (Combined, Synthesis, Ranking) plus N comparison sub-bars within Ranking. Wire into the main render switch in the existing component. (Was 4 color constants under the original Option A advocate-A/advocate-B/judge split; collapsed to 1 when Option C combined them into one LLM call.)
- [x] **4.6** Strategy wizard Step 2: support new `agentType: 'debate_and_generate'`. NO new model dropdowns (per Decision §18). Render an info chip explaining the model wiring: "Uses strategy Judge model for analyze+judge / Generation model for synthesis." Add a per-iteration "Judge reasoning effort" dropdown (`debateJudgeReasoningEffort`):
  - **Conditional enable** based on `getModelInfo(strategyCfg.judgeModel)?.supportsReasoning`:
    - `true` → dropdown ACTIVE; default-option label reads `Inherit ({registryDefault})` where `registryDefault` is the registry's `defaultReasoningEffort` for the chosen judgeModel (e.g. `Inherit (low)` for `gpt-oss-20b`)
    - `false` → dropdown DISABLED; default-option label reads `Not supported by {judgeModel}`; help-text chip beneath: `"Pick a reasoning-capable model ({comma-separated list of supportsReasoning: true models}) to enable thinking."` The model list is read from the registry at render time so it stays current.
  - **Step 1 model-change handler**: when user changes `judgeModel` to a model with `supportsReasoning: false` AND any iteration in `iterationConfigs[]` has `debateJudgeReasoningEffort` set, show a confirm dialog: `"Switching judgeModel to {newModel} (no reasoning support) will clear debateJudgeReasoningEffort on N iteration(s). Continue?"` Confirm → strip the field on save (Zod cross-field refinement from Phase 1.14 would otherwise reject the save). Cancel → revert the model change.
  - Optional strategy-level default for `debateJudgeReasoningEffort` under Step 1's "Show advanced" — power-user only.
  - Per-iteration cost projection shows debate-cost line item via the `debate` peer field on `EstPerAgentValue`.
- [x] **4.7** Wizard rejects multiple per-iteration fields for debate iterations via a Zod refinement (`iterationConfigSchema.superRefine`). For each iterCfg where `agentType === 'debate_and_generate'`, REJECT presence of any of these fields with a clear error message pointing at the offending key:
  - `generationGuidance` — debate generates its own synthesis prompt from judge verdict; user-provided guidance has no insertion point.
  - `reflectionGuidance` — debate is not a reflection agent; field is irrelevant.
  - `evaluationCriteria` — debate is not an evaluate-criteria agent; field is irrelevant.
  - `editingGuidance` — debate is not an editing agent; field is irrelevant.
  - `numVariants` — debate produces exactly ONE synthesized variant (Decision §15); rejecting any value other than 1 (or omission, which defaults to 1).
  - `sourceMode` — debate selects parents internally (top-2 from pool snapshot); user cannot override.
  - `qualityCutoff` — debate's selection is Elo-based with deterministic tiebreak (Decision §12); user-provided cutoff has no semantics here.
  - `tacticPalette` / `tacticOverride` — debate uses the marker tactic `'debate_synthesis'` (Decision §9); user-provided tactic selection is rejected.
  - The corresponding mirror in the wizard UI (Step 2 form) hides these fields when `agentType === 'debate_and_generate'` is selected; the Zod refinement is the defensive backstop for direct-API or YAML-strategy creation paths.
  - Test: extend `schemas.test.ts` with one rejection case per field, asserting Zod issue's `path` points at the offending key and `message` mentions `'not supported for debate_and_generate'`.
- [x] **4.8** UI integration test for new tab layout (mirror `evolution-evaluate-criteria-ui.integration.test.tsx`). Coverage:
  - 5-tab layout renders for `detailType: 'debate_then_generate_from_previous_article'`.
  - **Wizard form-hide assertion** (mirrors Phase 4.7 Zod backstop): render Step 2 wizard with `agentType: 'debate_and_generate'` selected; assert that the following form controls are ABSENT from the DOM: `generationGuidance` textarea, `reflectionGuidance` textarea, `evaluationCriteria` textarea, `editingGuidance` textarea, `numVariants` numeric input, `sourceMode` dropdown, `qualityCutoff` numeric input, `tacticPalette` chip group. Switch `agentType` to `generate_from_previous_article` and assert each control reappears.
  - Wizard model-change confirm dialog: switch `judgeModel` from `qwen/qwen3-8b` (supportsReasoning=true) to `gpt-4.1-nano` (false) when an iteration has `debateJudgeReasoningEffort='medium'` set; assert dialog appears with the expected copy; click Cancel → reverts; click Confirm → strips field on save.
  - Reasoning-effort dropdown conditional state: render with reasoning-capable model → assert dropdown enabled; with non-capable → assert disabled with help-text chip.
- [x] **4.9** **Array-based lineage UI updates** (Decision §20):
  - **`evolution/src/components/evolution/visualizations/LineageGraph.tsx`** (D3 DAG): update edge construction to iterate each variant's `parent_variant_ids` array. For each `(child, parent, parent_index)` tuple, emit one edge. Render `parent_index === 0` edges as solid (primary), `parent_index >= 1` as dashed (additional). Update `LineageData.edges[]` type to include `parent_index: number`. Update server action `evolutionVisualizationActions.getLineageData(...)` to call `unnest()` over `parent_variant_ids` (or use the `get_variant_full_chain` RPC's new `parent_index` field directly). Render legend chip: "solid → primary parent / dashed → additional parents (debate, future multi-parent agents)".
  - **`src/app/admin/evolution/variants/[variantId]/VariantDetailContent.tsx`**: parent-variant section reads `parent_variant_ids: string[]` and renders one chip per element. When `parent_variant_ids.length === 1`, render a single "Parent variant" link as today. When `parent_variant_ids.length >= 2`, render a list with `parent_variant_ids[0]` labeled "Primary parent" and the rest labeled "Additional parent" (or, for debate variants specifically, "Judge's winner" + "Counterpart" using `execution_detail.debate.judge.verdict.winner` to confirm which is which). When `parent_variant_ids.length === 0`, render "(root variant)".
  - **`evolution/src/components/evolution/tabs/LineageTab.tsx`** (run-level lineage view): no signature change — `get_variant_full_chain` RPC's new body returns `parent_index` alongside the existing fields, so multi-parent edges flow through naturally. Tab just iterates the rows as before; `parent_index > 0` rows render as additional dashed edges.
  - **`evolution/src/components/evolution/visualizations/VariantCard.tsx`** (lineage graph node tooltip): show full `parent_variant_ids` list in the tooltip; primary highlighted, additional listed below.
  - **`evolution/src/components/evolution/VariantParentBadge.tsx`** (if it exists): render from `parent_variant_ids[0]` for the "primary parent" badge. When `parent_variant_ids.length > 1`, append a `+N more` chip linking to the variant detail page's full lineage section.
  - Test: render `LineageGraph` with a fixture containing (a) a single-parent variant and (b) a debate variant with `parent_variant_ids = [winner_id, loser_id]`. Assert that the debate variant has 2 incoming edges (one solid `parent_index=0`, one dashed `parent_index=1`) and the single-parent variant has 1 solid edge.

### Phase 5 — E2E + docs + finalize (~1 day)

- [x] **5.1** Create E2E spec `admin-evolution-debate.spec.ts` (mirror `admin-evolution-iterative-editing.spec.ts`). Tag `@evolution`, `setTimeout(360_000)`. Real or mocked LLM calls per existing E2E patterns. Coverage requirements:
  - **Wizard flow**: create a debate strategy via the wizard; verify the per-iteration "Judge reasoning effort" dropdown is enabled when `judgeModel` supports reasoning (test with `qwen/qwen3-8b`) AND disabled with help-text chip when it doesn't (test with `gpt-4.1-nano`). Verify the model-change confirm dialog fires when switching from a reasoning-capable to non-capable model with effort set. Verify NO `debateAdvocateModel` / `debateJudgeModel` / `debateSynthesisModel` dropdowns are present in the UI.
  - **Run completion**: run the strategy through ≥1 debate iteration; assert the variant lands with `agent_name = 'debate_then_generate_from_previous_article'`.
  - **5-tab layout**: assert all 5 tabs render — `overview-debate` / `overview-synthesis` / `metrics` / `timeline` / `logs`. Click each and verify content loads without error.
  - **Pros/cons rendering**: on the `overview-debate` tab, assert the analysis pros/cons table renders 4 sections (prosA, consA, prosB, consB) and is non-empty.
  - **Reasoning trace UI — three states** (Phase 1.20 + Phase 4.1):
    - Run trace-state-1 (cohort A) with `debateJudgeReasoningEffort: undefined` (or non-reasoning judge model) → assert the reasoning trace block renders the collapsed gray bar "Reasoning Trace — not surfaced (effort=none)".
    - Run trace-state-2 with `judgeModel: 'qwen/qwen3-8b'` + `debateJudgeReasoningEffort: 'medium'` → assert the trace block renders with header "Reasoning Trace (verbatim — model's raw deliberation)" and is expandable.
    - Run trace-state-3 with a mocked OpenAI o3-mini response (force `reasoningTraceFormat = 'summary'`) → assert header "Reasoning Summary (provider-summarized — raw chain-of-thought not exposed by this provider)" and tooltip explains why. Mock plumbing extends `src/__tests__/e2e/helpers/api-mocks.ts` (existing) with a new helper `mockLLMReasoningTrace(page, { provider, format, reasoningTokens, traceText })` that intercepts the OpenAI/OpenRouter HTTP route and returns the provider-specific response shape. The helper's body mirrors the unit-test fixture shapes from Phase 1.20's `src/lib/services/llms.test.ts` — keep them in sync via a shared fixture file `src/__tests__/fixtures/reasoningTraceFixtures.ts` (NEW) so unit and E2E tests cannot drift.
    - Run trace-state-4 with mocked OpenRouter response with `reasoningTokens > 0` but missing `reasoning_details` → assert "unavailable" rendering "Thinking happened (N tokens) but provider did not return trace text". Use the same `mockLLMReasoningTrace(page, { provider: 'openrouter', format: 'unavailable', reasoningTokens: 800, traceText: undefined })` helper.

    **Naming note**: trace-state-1..4 are intentionally distinct from Phase 8's A/B-experiment cohorts (which use letters A/B/C/D for judge-model variants, NOT reasoning-trace UI states). The numerical naming here keeps the 4 trace-rendering states unambiguous when both phases are read together.
  - **Multi-parent lineage UI** (Decision §20 + Phase 4.9):
    - Navigate to the synthesized variant's detail page. Assert the parent-variant section shows TWO chips: one labeled "Primary parent" (or "Judge's winner") linking to `parent_variant_ids[0]`, one labeled "Additional parent" (or "Counterpart") linking to `parent_variant_ids[1]`.
    - Navigate to the run-level lineage tab. Assert the LineageGraph renders the debate variant with TWO incoming edges — one solid (parent_index=0) from winner, one dashed (parent_index=1) from loser. Click the legend chip; assert it explains "solid → primary / dashed → additional".
    - Navigate to a single-parent variant (from the seed-generation iteration) and assert it has exactly 1 solid edge.
  - **Timeline**: assert `InvocationTimelineTab` renders 3 top-level segments (rose Combined, blue Synthesis, purple Ranking) plus N comparison sub-bars within Ranking. Assert color-constants match Phase 4.5 (`DEBATE_COLOR='#f472b6'`, `GENERATION_COLOR='#3b82f6'`, `RANKING_COLOR='#8b5cf6'`).
  - **Kill-switch flip**: set `EVOLUTION_DEBATE_ENABLED='false'` mid-test; verify the next iteration is NOT a debate iteration (preview returns `debate=0`); flip back to `'true'`; verify next iteration is debate again. (Skip this sub-case if E2E env doesn't allow runtime env mutation; cover via integration test instead.)
- [x] **5.2** Update `evolution/docs/agents/overview.md` — add `DebateThenGenerateFromPreviousArticleAgent` section mirroring `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` section. **Cross-reference invariant I4** in this section: include a callout box "Wrapper-agent LLM-client proxy (I4)" that pins the invariant text verbatim ("the synthesis-LLM-proxy must (a) be injected via `innerInput.llm` (NOT `ctx`), (b) wrap BOTH `complete` and `completeStructured`, and (c) rewrite `'generation' → 'debate_synthesis'` while passing through all other AgentNames"). This makes I4 discoverable to future authors who might add another wrapper that delegates LLM calls. Cross-link to `bring_back_debate_agent_20260506` Decision §17 + Phase 1.4.
- [x] **5.3** Update `evolution/docs/architecture.md` — add debate to the iteration-type list. Add a brief subsection "Wrapper-agent LLM-client proxy (I4)" to the agent-invariants table that mentions DebateAgent introduces I4 + cross-references `evolution/docs/agents/overview.md`'s detailed callout (per Phase 5.2). This keeps the architecture doc the canonical invariant catalog (alongside I1/I2/I3).
- [x] **5.4** Update `evolution/docs/reference.md` — add `EVOLUTION_DEBATE_ENABLED` env var to Kill Switches table.
- [x] **5.5** Update `evolution/docs/strategies_and_experiments.md` — document the debate model wiring (uses strategy `judgeModel` for the combined analyze+judge call, strategy `generationModel` for the inner GFPA synthesis call — NO debate-specific model overrides per Decision §18) and the per-iteration `debateJudgeReasoningEffort` knob (with cascade rules iter → strategy → registry default per Decision §18 + Phase 1.14). Explicitly note that the previously-planned `debateAdvocateModel` / `debateJudgeModel` / `debateSynthesisModel` fields were rejected during planning and do NOT exist; if this doc has any pre-existing references to them, delete those references.
- [x] **5.6** Update `evolution/docs/cost_optimization.md` — document `debate_cost` metric + per-purpose cost split.
- [x] **5.7** Update `evolution/docs/data_model.md` — note new agent name + new metric names.
- [x] **5.8** Update `evolution/docs/visualization.md` — document the 5-tab debate invocation page.
- [x] **5.9** Update `historical_agent_evolution_survey_20260504_research.md` — change DebateAgent's status from "revive-later" to "RESURRECTED".
- [x] **5.10** Update `.github/workflows/ci.yml` evolution-integration job env block — add `EVOLUTION_DEBATE_ENABLED: 'true'`.
- [x] **5.11** Update `evolution/docs/data_model.md` "Lineage" section:
  - **REMOVE** the existing Warning about "Second parent silently dropped at finalize" — obsolete after Decision §20.
  - **REMOVE** the in-memory-vs-DB asymmetry note ("In-memory parentIds[] vs DB parent_variant_id single FK") — also obsolete; the shapes now match.
  - Add a "Multi-parent variants" subsection documenting `parent_variant_ids: uuid[]` semantics, the `parentIds[0] = canonical primary` convention, the `get_variant_full_chain` RPC's new `parent_index` return field, and the absence of DB-level FK enforcement on array elements (cross-reference `evolution_arena_comparisons.entry_a/b` for the same pattern in migration `20260409000001`).
  - Note that DebateAgent is the second multi-parent agent (V1 EvolutionAgent's crossover was the first; that lineage data is unrecoverable since V1 was deleted in `4f03d4f6`, but the schema now accommodates any future multi-parent agent without further migration).
  - Document the migration-deploy ordering: migration runs FIRST (backfills `parent_variant_ids` from `parent_variant_id`, then drops the old column atomically), THEN `database.types.ts` regenerates, THEN code referencing the array column rolls out.
  - Cross-reference `bring_back_debate_agent_20260506` Decision §20.
- [x] **5.12** Run `/finalize`.

### Phase 6 — Pre-merge staging calibration (~3-5 days)

- [ ] **6.1** Run 30 shadow-deploy strategies in staging covering debate-strategy mixes.
- [ ] **6.2** Measure actual per-invocation cost distribution (p50, p95, p99). Compare against `estimateDebateCost`'s upper-bound. Tighten estimator if delta >10%.
- [ ] **6.3** Measure operational health metric baselines. Each threshold is overridable at runtime via env var (so ops can tune without redeploying); env vars read by the alerting cron in `evolution/scripts/alertOnDebateHealth.ts` (new) and documented in `evolution/docs/reference.md` Kill Switches section. Defaults below are starting points pending Phase 6.1 staging data:
  - `debate_format_validate_failure_rate` — env `EVOLUTION_DEBATE_FMT_FAIL_THRESHOLD` (default `0.25`); alert if observed > threshold
  - `debate_judge_parse_failure_rate` — env `EVOLUTION_DEBATE_PARSE_FAIL_THRESHOLD` (default `0.10`); alert if observed > threshold
  - `debate_winner_distribution` (A-share) — env `EVOLUTION_DEBATE_WINNER_BIAS_THRESHOLD` (default `0.65`); alert if A-share > threshold
  - `debate_surfaced_rate` — env `EVOLUTION_DEBATE_SURFACED_MIN_THRESHOLD` (default `0.50`); alert if observed < threshold (note: lower-bound, not upper)
  - `debate_synthesis_no_op_rate` — env `EVOLUTION_DEBATE_NOOP_THRESHOLD` (default `0.15`); alert if observed > threshold
  - `debate_reasoning_effort_dropped` count — env `EVOLUTION_DEBATE_REASONING_DROP_THRESHOLD` (default `5` per day); alert if observed > threshold (catches misconfigured strategy/iteration combos slipping past Zod validation)
  - `llm_reasoning_trace_silently_dropped` count (Phase 1.20) — env `EVOLUTION_DEBATE_TRACE_DROP_THRESHOLD` (default `10` per day); alert if observed > threshold (catches OpenRouter providers that silently drop traces)
  - Each env var follows the existing string-contract convention. **Important footgun**: `Number(process.env.X) || <default>` returns the default for `'0'` (because `Number('0') === 0` is falsy), `'NaN'` (because `Number('NaN') === NaN` is falsy), and empty string. Use this safer parse: `const v = Number(process.env.X); return Number.isFinite(v) ? v : default`. Document the helper as `parseFloatEnvOrDefault(envName, defaultValue)` in `evolution/scripts/alertOnDebateHealth.ts` and unit-test it.
  - **Env-override unit test** in `evolution/scripts/alertOnDebateHealth.test.ts` (NEW): one case per threshold proving (a) absence of env var → uses default, (b) valid number → uses parsed value, (c) `'0'` → returns 0 (NOT default), (d) `'NaN'` / `'abc'` / `''` → returns default with warn log. Without this test, any of the 7 env vars could silently revert to default in production due to the footgun above.
  - Document defaults in `evolution/docs/reference.md` table alongside `EVOLUTION_DEBATE_ENABLED`.
- [ ] **6.3a** Create `evolution/scripts/alertOnDebateHealth.ts` (NEW) — single-purpose alerting cron script that runs every 15 minutes (configurable via `EVOLUTION_DEBATE_ALERT_INTERVAL_MINUTES`, default `15`). Reads the metrics from `evolution_metrics`; compares against the env-overridable thresholds from 6.3; posts to Slack via existing webhook on breach. Includes the calibration-staleness check from Phase 7.3. Owner: debate-feature owner. Wired into the production cron infrastructure (existing pattern: see `evolution/scripts/refreshCostCalibration.ts` deployment).
- [ ] **6.4** Verify `debate_cost` metric writes correctly. Cross-check `evolution_metrics` row count against invocation count (1:1).
- [ ] **6.5** E2E spec passes against staging. Acceptance: ALL sub-cases of Phase 5.1 must pass EXCEPT the kill-switch flip (which 5.1 marks as conditionally skippable when E2E env doesn't allow runtime env mutation — explicitly note in Phase 6.5 acceptance criteria that the kill-switch sub-case is OPTIONAL for 6.5 gating but REQUIRED for 6.5 if covered by integration test instead).
- [ ] **6.5b** **Operator-playbook rehearsal** (NEW). Scripted dry-run in staging that walks the full 7-step deploy sequence end-to-end:
  1. Apply 1.15a (column add + GIN index).
  2. Run `evolution/scripts/backfill-parent-array.ts` against staging dataset; capture wall-clock duration + row count.
  3. Run `evolution/scripts/verify-parent-array-backfill.ts`; assert exit 0.
  4. Apply 1.18 (RPC rewrite).
  5. Wait 24h+ in staging clock-time (or shorter via env override `STAGING_DUAL_WRITE_GATE_MINUTES` for CI compression). Verify dual-write code in Phase 3.8a is consistently writing both columns by sampling 100 random `evolution_variants` rows and asserting `parent_variant_id = parent_variant_ids[0] OR (parent_variant_id IS NULL AND parent_variant_ids = '{}')`.
  6. Apply 1.15b (drop legacy column).
  7. Apply Step 1.16b + 1.17b (Zod schema + types regeneration).
  - Capture timing data + log output to `docs/planning/bring_back_debate_agent_20260506/staging_rehearsal_<timestamp>.md` for production-deploy reference. **Compressed-gate caveat**: when `--compress-gate-minutes` is used, the rehearsal script MUST emit a prominent warning in its summary report: `COMPRESSED_GATE: this rehearsal does NOT validate 24h-soak bugs (e.g., long-running transactions, scheduled job interactions, replication-lag edge cases). Production deploy MUST observe the full 24h+ window between step 4 and step 6 — compressed-rehearsal pass does NOT substitute for full-soak pass.` Reviewers must not conflate compressed-rehearsal success with production-readiness for the dual-write soak window.
  - **Owner**: debate-feature owner runs the rehearsal; oncall engineer reviews timing + signs off before production deploy.
  - **Acceptance**: rehearsal passes if every step succeeds AND total wall-clock for steps 1–4 is within 2× the production-row-count estimate.
  - Implementation: a Node script `evolution/scripts/rehearse-debate-deploy.ts` that takes args `--env=staging --compress-gate-minutes=5` and orchestrates the steps. Output: structured JSON log + human-readable timing report.
- [ ] **6.6** Recovery playbook if 6.1-6.5 fails. Decision tree:
  - **6.6.a — Cost overrun** (Phase 6.2 actual >upper-bound by >10%): tighten `estimateDebateCost` coefficients in `evolution/src/lib/pipeline/infra/estimateCosts.ts`, re-run staging cohort, retry 6.2. Not a merge blocker if estimator agrees with measurement after tightening.
  - **6.6.b — Operational threshold breach** (Phase 6.3 metric outside alert range): map breach to root-cause class:
    - `format_validate_failure_rate > 25%` → prompt-tuning issue. Iterate `buildCombinedAnalyzeAndJudgePrompt` in Phase 2.2; re-run cohort. NOT a merge blocker once <25%.
    - `judge_parse_failure_rate > 10%` → parser robustness gap (likely the model wraps JSON in fenced code blocks). Tighten `parseCombinedAnalyzeAndJudge` (Phase 2.3) with markdown-fence stripping; re-run.
    - `winner_distribution A-share > 65%` → judge bias OR top-2 selection bias. Investigate via per-pair Elo-delta histogram; if bias is judge-side, switch judge model cohort; if selection-side, audit the deterministic tiebreak (Decision §12).
    - `surfaced_rate < 50%` → too many synthesis no-ops or judge ties. Tune Jaccard threshold (Decision §14) or revisit prompt; re-run.
    - `synthesis_no_op_rate > 15%` → synthesis is paraphrasing one parent. Tune Jaccard or strengthen the synthesis prompt's "combine strengths" framing.
  - **6.6.c — Cost-attribution metric divergence** (`debate_cost` ≠ sum of debate_judge + debate_synthesis phase rows): I4 invariant violated in production. **MERGE BLOCKER**. Verify proxy is wired via `input.llm` per Phase 1.4; re-run integration test in Phase 3.6 with real `createEvolutionLLMClient`.
  - **6.6.d — Lineage data corruption** (Phase 6.5b rehearsal fails): backfill script wrote inconsistent `parent_variant_ids[0] !== parent_variant_id` rows. Run `evolution/scripts/repair-parent-array.ts` (built per Phase 1.15a-rollback below); verify via `verify-parent-array-backfill.ts`; do NOT proceed to 1.15b until verify exits 0.
  - **6.6.e — Multi-failure cascade** (any 2 of the above fire simultaneously): full revert. Flip `EVOLUTION_DEBATE_ENABLED='false'`, leave 1.15a/1.15a-script applied (forward-only contract), file a follow-up project to address root cause, do NOT merge until follow-up resolves.
  - **Owner**: oncall engineer triages the breach; debate-feature owner decides 6.6.a/b/c/d remediation; team lead approves merge gate after recovery passes.

### Phase 7 — Post-merge monitoring (first 2 weeks, low-touch)

- [ ] **7.1** Watch dashboards: cost-per-invocation distribution, surfaced rate, format-validate failure rate.
- [ ] **7.2** If any operational-health threshold breached: flip `EVOLUTION_DEBATE_ENABLED='false'` and investigate.
- [ ] **7.3** Refresh calibration table (`refreshCostCalibration.ts`) after 1 week of production data. **Automated freshness gate** (NEW):
  - Extend the alert cron from Phase 6.3 (`evolution/scripts/alertOnDebateHealth.ts`) with a `calibration_staleness` check: query `evolution_cost_calibration` for the max(updated_at) of rows where phase IN ('debate_judge', 'debate_synthesis'). Threshold env var `EVOLUTION_DEBATE_CALIBRATION_MAX_STALE_DAYS` (default `14`); alert if max(updated_at) is older than threshold.
  - Owner: oncall engineer flips the kill switch `EVOLUTION_DEBATE_ENABLED='false'` if staleness alert fires AND the calibration is observably wrong (per Phase 6.2 cost-distribution drift); debate-feature owner runs `refreshCostCalibration.ts` to repopulate.
  - Re-arm reminder: cron also posts a weekly Slack reminder to the debate-feature owner during the first 4 weeks post-merge (configurable via `EVOLUTION_DEBATE_CALIBRATION_REMINDER_WEEKS`, default `4`).

### Phase 8 — Thinking-mode A/B experiment (post-launch, optional)

Determines whether thinking-mode lifts judge quality on debate's combined analyze+judge call enough to justify the cost. Only run AFTER Phase 6 staging confirms Option C structured-output works.

- [ ] **8.1** Pre-flight: confirm `parseWinner()` reverse-pass bug for `qwen3-off` is fixed (per research doc note — this would unlock the cheapest thinking-capable judge).
- [ ] **8.2** Optional infra-prep: add `defaultReasoningEffort` field to `gpt-5-nano` / `gpt-5-mini` registry entries if you want to include them in the A/B (one-line change per model). Skip if scope-bounded to existing thinking-capable models.
- [ ] **8.3** Pick judge-model cohorts (strategy-level `judgeModel` swapped per cohort; `debateJudgeReasoningEffort` overridden per cohort to enable thinking on the debate call only):
  - **Cohort A (control)**: strategy `judgeModel: 'qwen-2.5-7b-instruct'`, no `debateJudgeReasoningEffort` override — non-thinking baseline. From research doc: $0.000270/comparison is the standout best-value non-thinking judge.
  - **Cohort B**: strategy `judgeModel: 'qwen/qwen3-8b'`, iteration `debateJudgeReasoningEffort: 'medium'` — empirical 100% decisive on both gap pairs at $0.000704/comparison; the best-quality thinking-capable judge in the registry.
  - **Cohort C**: strategy `judgeModel: 'gpt-oss-20b'`, iteration `debateJudgeReasoningEffort: 'low'` — fast (~1.2s) but only 0-70% decisive on close pairs. Tests whether speed-vs-quality tradeoff inverts on the debate use case.
  - **Cohort D (optional)**: strategy `judgeModel: 'gpt-5-nano'`, iteration `debateJudgeReasoningEffort: 'low'` — gated on Phase 8.2 registry update.
- [ ] **8.4** Run 50-strategy A/B in staging across all cohorts. Same parents, same iteration budget, same strategy-level `generationModel` (synthesis stays non-thinking — only the analyze+judge call varies; per Decision §18 there is no `debateSynthesisModel` field, synthesis goes through inner GFPA which uses strategy's `generationModel`).
- [ ] **8.5** Compare on:
  - Synthesis variant Elo lift over both parents (mean + p25/p75)
  - p95 cost per invocation
  - p95 wall-clock latency per invocation (thinking models 5-13× slower)
  - Judge tie-rate (proxy for "model couldn't decide")
  - Judge winner-distribution bias (A vs B share — should be ~uniform)
  - Synthesis identical-to-parent rate (proxy for verdict-degeneracy)
- [ ] **8.6** Decision rule:
  - If Cohort B/C/D shows ≥10% Elo lift over Cohort A at ≤2× cost AND p95 latency ≤25s → ship thinking-mode as new default for debate (set `defaultReasoningEffort` on the strategy wizard's recommended judge model).
  - If lift is marginal (<10%) → keep thinking-mode as opt-in `debateJudgeReasoningEffort` knob only; don't change defaults.
  - If lift is negative → remove thinking-mode wiring or keep gated behind feature flag.
- [ ] **8.7** Document findings in a follow-up research doc `docs/research/debate_thinking_mode_<date>.md` mirroring `judge_agreement_summary_tables.md` structure. If thinking-mode wins, file v1.1 PR adjusting defaults.

## Testing

### Unit Tests
- [x] `evolution/src/lib/core/agents/debate/DebateAgent.test.ts` — ~24 cases (~600 LOC); includes the multi-parent emission test (Decision §20: `parentIds = [winner.id, loser.id]` for both winner=A and winner=B branches)
- [x] `evolution/src/lib/core/agents/debate/DebateAgent.invariants.test.ts` — invariant tests (no nested `.run(`, cost snapshots, partial-detail-on-throw)
- [x] `evolution/src/lib/pipeline/loop/debateDispatch.test.ts` — ~11 cases
- [x] `evolution/src/lib/schemas.test.ts` — extend with ~12 debate schema cases:
  - `debateJudgeReasoningEffort` valid only when `agentType==='debate_and_generate'`; rejects values outside `'none'|'low'|'medium'|'high'`
  - Rejects unknown `debateAdvocateModel` / `debateJudgeModel` / `debateSynthesisModel` fields per Decision §18
  - **Cross-field refinement test** (NEW per Phase 1.14): strategy with `judgeModel: 'gpt-4.1-nano'` (supportsReasoning=false) + iteration with `debateJudgeReasoningEffort: 'medium'` → Zod parse FAILS with error path `['judgeModel']` and message containing `"does not support reasoning effort"`
  - Cross-field refinement test (positive): strategy with `judgeModel: 'qwen/qwen3-8b'` (supportsReasoning=true) + iteration with `debateJudgeReasoningEffort: 'medium'` → Zod parse SUCCEEDS
  - Cross-field refinement test (strategy-level): strategy with `judgeModel: 'gpt-4.1-nano'` + strategy-level `debateJudgeReasoningEffort: 'low'` → Zod parse FAILS (catches strategy-level setter, not just iteration-level)
  - Cross-field refinement test (no reasoning effort set anywhere): strategy with `judgeModel: 'gpt-4.1-nano'` + NO `debateJudgeReasoningEffort` anywhere → Zod parse SUCCEEDS (refinement only fires when effort is explicitly set)
  - PLUS new `evolution_variants` schema cases for `parent_variant_ids` array shape (accepts string[], rejects single string, accepts empty array).
- [x] **`modelRegistry.test.ts` extension** (Phase 1.19): assert every entry in `MODEL_REGISTRY` has `supportsReasoning: boolean` (typed-test will catch missing field at compile time; runtime test asserts boolean type). Assert startup-consistency: every entry where `defaultReasoningEffort !== undefined` ALSO has `supportsReasoning: true`. Assert `modelSupportsReasoning(...)` helper returns the right value for known reasoning + non-reasoning models.
- [x] **Cascade resolver defensive-guard test** (Phase 2.5): construct `iterCfg.debateJudgeReasoningEffort='medium'` + `judgeModel='gpt-4.1-nano'` (supportsReasoning=false). Assert `resolveDebateJudgeReasoningEffort()` returns `undefined`, logs warn with `droppedReason: 'model_does_not_support_reasoning'`, and increments the operational metric counter.
- [x] `evolution/src/lib/pipeline/infra/estimateCosts.test.ts` — extend with ~4 `estimateDebateCost` cases
- [ ] `evolution/scripts/alertOnDebateHealth.test.ts` (NEW per Phase 6.3a) — env-var override path (4 cases per threshold: absent, valid, '0', 'NaN'); `parseFloatEnvOrDefault` helper unit cases. Run via `npm run test:unit -- --testPathPattern="alertOnDebateHealth"`.
- [x] `evolution/src/lib/core/entities.test.ts` — DETAIL_VIEW_CONFIGS parity test for debate config
- [x] DebateAgent unit test: `reasoningEffort` from `IterationConfig` is threaded through to `callLLM()` for the combined analyze+judge call (mock `callLLM` and assert it's called with the configured effort).
- [x] **Persistence array test** in `evolution/src/lib/pipeline/finalize/persistRunResults.test.ts`:
  - `parentIds=[a, b]` → DB row has `parent_variant_ids = ['a', 'b']`
  - `parentIds=[a]` → DB row has `parent_variant_ids = ['a']`
  - `parentIds=[]` → DB row has `parent_variant_ids = []` (root/seed variant)
  - `parentIds=[a, b, c, ..., 11+]` → console.warn fires with `{droppedCount}` field; DB row has first 10 elements only
- [ ] **Migration backfill test** in `evolution/src/lib/pipeline/migrations.test.ts` (or wherever migration tests live): apply 1.15a → run `backfill-parent-array.ts` → run `verify-parent-array-backfill.ts` → apply 1.18 → apply 1.15b. Assert at each stage:
  - **After 1.15a**: both columns coexist; new `parent_variant_ids` defaults to `'{}'`; GIN index `idx_evolution_variants_parent_variant_ids` exists and is `valid` per `pg_index.indisvalid`.
  - **After backfill script**: rows with `parent_variant_id IS NOT NULL` have `parent_variant_ids = ARRAY[old_parent_variant_id]`; rows with `parent_variant_id IS NULL` have `parent_variant_ids = []`; verify script exits 0.
  - **After 1.18 RPC rewrite**: `get_variant_full_chain(known_id)` returns expected `parent_index` rows.
  - **After 1.15b**: old `parent_variant_id` column is gone; `idx_evolution_variants_parent_variant_id` is gone; GIN index still present.
- [ ] **Backfill script unit/integration test** in `evolution/scripts/backfill-parent-array.test.ts` (NEW): exercise the Node script directly:
  - Idempotency: run twice on same data; assert second run is a no-op (zero rows updated).
  - Partial-failure resume: simulate Ctrl-C between batches by stopping after N rows; restart; assert resume completes the remaining rows.
  - Edge cases: empty table, all-root-variants, all-single-parent-variants, mixed.
  - Performance smoke: 10k row fixture should complete within a CI-tolerable budget (target < 30s; alert in test on regression).
- [ ] **Verify script test** in `evolution/scripts/verify-parent-array-backfill.test.ts` (NEW):
  - Asserts exit 0 when invariant holds (`parent_variant_id IS NOT NULL → parent_variant_ids[0] = parent_variant_id` for all rows).
  - Asserts exit 1 + diagnostic output when invariant violated (e.g., row with `parent_variant_id = X` but `parent_variant_ids = []`).
  - Asserts exit 1 when GIN index is `indisvalid = false` (forced by mocking `pg_index` row).
- [x] **Dual-write Zod schema test** in `evolution/src/lib/schemas.test.ts` (Phase 1.16a window):
  - `evolutionVariantsInsertSchema.parse({ parent_variant_id: uuid, parent_variant_ids: [uuid] })` → SUCCESS (both fields valid during dual-write window).
  - `.parse({ parent_variant_id: uuid })` → SUCCESS (parent_variant_ids defaults to `[]`).
  - `.parse({ parent_variant_ids: [uuid] })` → SUCCESS (parent_variant_id is optional/nullable).
  - `.parse({})` → SUCCESS (both fields optional during the window; root variant case).
  - **After 1.16b lands** (post-drop): `.parse({ parent_variant_id: uuid })` → FAILURE (unknown field rejected); only `.parse({ parent_variant_ids: [uuid] })` is valid.
- [x] **LineageGraph array test** in `evolution/src/components/evolution/visualizations/LineageGraph.test.tsx`: render with a fixture containing (a) a single-parent variant with `parent_variant_ids = [parentId]` and (b) a debate variant with `parent_variant_ids = [winnerId, loserId]`. Assert:
  - Single-parent variant: 1 solid edge (parent_index=0) lands on it
  - Debate variant: 2 edges land — one solid (parent_index=0, primary), one dashed (parent_index=1, additional)
- [ ] **`get_variant_full_chain` RPC test** in `evolution/src/lib/pipeline/lineage/getVariantFullChain.test.ts` (new or extended): given a chain `seed → A`, `seed → B`, `A+B → debate_synthesis`, calling `get_variant_full_chain(debate_synthesis.id)` returns 4 rows: `(debate_synthesis, A, parent_index=0)`, `(debate_synthesis, B, parent_index=1)`, `(A, seed, parent_index=0)`, `(B, seed, parent_index=0)`. Cycle detection test: artificially create a cycle (variant references itself in its own `parent_variant_ids`); RPC returns `cycle_detected=true` and does NOT infinite-loop.

### Integration Tests
- [x] `src/__tests__/integration/evolution-debate-agent.integration.test.ts`
- [x] `src/__tests__/integration/strategy-preview-debate-dispatch.integration.test.ts`

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-debate.spec.ts`

### Manual Verification
- [ ] Real LLM run produces coherent advocate transcripts (not generic templates)
- [ ] Judge verdicts are reasoned (winner justified by reasoning, not arbitrary)
- [ ] Synthesis variants combine strengths of both parents (not paraphrase of one)
- [ ] Cost dashboard shows `debate_cost` distinct from `generation_cost`
- [ ] Invocation page renders cleanly with partial-detail rows (advocate_a only, judge_parse fail, synthesis_empty)
- [ ] Kill-switch flip takes effect on next iteration without restart

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] `admin-evolution-debate.spec.ts` E2E spec — strategy wizard creates debate strategy, run completes, 5-tab invocation page renders, transcript + verdict visible, timeline shows rose/blue/purple segments

### B) Automated Tests
- [x] `npm run test:unit -- --testPathPattern="debate"` — all debate unit tests pass
- [x] `npm run test:integration -- --testPathPattern="debate"` — integration tests pass
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-debate.spec.ts`
- [x] `tsc --noEmit` — typecheck clean
- [x] `npm run build` — build succeeds
- [x] Lint clean

## Documentation Updates
- [x] `evolution/docs/agents/overview.md` — new `DebateThenGenerateFromPreviousArticleAgent` section
- [x] `evolution/docs/architecture.md` — debate added to iteration-type list
- [x] `evolution/docs/reference.md` — `EVOLUTION_DEBATE_ENABLED` Kill Switches entry
- [x] `evolution/docs/strategies_and_experiments.md` — debate model fields
- [x] `evolution/docs/cost_optimization.md` — `debate_cost` metric + per-purpose split
- [x] `evolution/docs/data_model.md` — new agent name + metric names
- [x] `evolution/docs/visualization.md` — 5-tab debate invocation page
- [ ] `historical_agent_evolution_survey_20260504_research.md` — flip DebateAgent status to RESURRECTED

## Review & Discussion
_Populated by /plan-review with agent scores, reasoning, and gap resolutions._

---

## Pending: Wireframes for invocation details (per requirements)

Wireframes for the invocation-detail page (5-tab layout — Debate Overview / Synthesis / Metrics / Timeline / Logs) were drafted as part of the design brief at `docs/planning/historical_agent_evolution_survey_20260504/debate_agent_revival_brief.md` §3. Per project requirements, the wireframes must be presented to the user for review before Phase 4 (UI) work begins. The wireframes will be presented inline after this plan is committed and reviewed.
