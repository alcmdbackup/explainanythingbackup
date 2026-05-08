# Bring Back Debate Agent Research

## Problem Statement
we want to introduce a debate agent which takes two agents, debates their relative pros/cons including specific examples, and figures out a way to merge them into one final output based on the feedback.

## Requirements (from GH Issue #NNN)
Let's follow our existing agent framework. Re-use existing agent patterns wherever possible. Come up with wireframes for how invocation details will look, and then run it by the user.

## High Level Summary

The research base for this project was completed during the `historical_agent_evolution_survey_20260504` project (3 rounds × 4 parallel agents on the DebateAgent revival design). The synthesis output is at `docs/planning/historical_agent_evolution_survey_20260504/debate_agent_revival_brief.md` and is the primary input for this project's planning doc — the brief contains 16 locked decisions, the V2 algorithm (8-bullet), full invocation-detail UI sketch with ASCII wireframes, schema + integration spec with file touchpoints, top-5 risk register, cost projection (cheap/mixed/premium tiers), and a 7-phase execution plan.

**Key recap from the survey-phase research:**

V1 DebateAgent was introduced 2026-02-04 (PR #319, commit `8ae43a20b`, project `new_edit_operator_20260201`) and deleted 2026-03-16 (commit `4f03d4f6`, PR #716, V1 mass-deletion). The V1 implementation ran a 3-turn structured debate (Advocate A → Advocate B rebuttal → Judge JSON synthesis) over the top-2 variants in a pool, then synthesized a new variant from the judge's verdict via a 4th LLM call. The V1 algorithm aligns with Google DeepMind's "AI Co-Scientist" paper (arxiv 2502.18864) — the existing evolution pipeline mirrors AI Co-Scientist's agent set, with `simulated_scientific_debate` being the explicit gap.

V2 revival shape: a Shape-A wrapper agent with 4 LLM calls, modeled on `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` (combined pre-stage + delegate to inner GFPA via `.execute()` with `customPrompt`) and `IterativeEditingAgent` (multi-LLM-call cost snapshots).

Reusable artifacts that already exist in the codebase:
- **Orphan schema** at `evolution/src/lib/schemas.ts:1092-1112` — V1-shaped `debateExecutionDetailSchema` with variantA/B + transcript + judgeVerdict + failurePoint enum (REUSE-EXTENDED — add V2 wrapper fields)
- **Orphan DETAIL_VIEW_CONFIGS entry** at `evolution/src/lib/core/detailViewConfigs.ts:380-397` (REUSE-EXTENDED — add transcript table + judge verdict object + cost breakdown)
- **Orphan fixture** at `evolution/src/testing/executionDetailFixtures.ts:232-252` (REUSE-AS-IS for backward compat; add new V2 fixtures alongside)
- **Original planning artifacts** at `docs/planning/new_edit_operator_20260201/` (research, planning, progress — V1 verbatim prompts are GROUND TRUTH for the V2 prompts)

## V1 verbatim prompts (lifted from Round 1A research; ground truth for V2 builders)

### Advocate A
```
You are Advocate A in a structured debate about text quality. Your job is to argue why Variant A is the superior text.

## Variant A (you are advocating for this)
<<<CONTENT>>>
${variantA.text}
<<</CONTENT>>>

## Variant B (the competing variant)
<<<CONTENT>>>
${variantB.text}
<<</CONTENT>>>
${critiqueContext}
## Task
Make a compelling argument for why Variant A is the better text. Cover:
1. Specific strengths of Variant A (cite exact passages)
2. Specific weaknesses of Variant B compared to A
3. Which dimensions (clarity, structure, engagement, precision, coherence) A excels in

Be specific and evidence-based. Cite exact phrases from both texts.
```

### Advocate B (with rebuttal framing)
```
You are Advocate B in a structured debate about text quality. Advocate A has already argued for Variant A. Your job is to rebut their argument and argue why Variant B is superior.

## Variant A
<<<CONTENT>>>
${variantA.text}
<<</CONTENT>>>

## Variant B (you are advocating for this)
<<<CONTENT>>>
${variantB.text}
<<</CONTENT>>>

## Advocate A's Argument
${advocateAArgument}
${critiqueContext}
## Task
1. Rebut Advocate A's key claims with specific counter-evidence
2. Argue why Variant B is the better text overall
3. Identify strengths in Variant B that Advocate A overlooked or dismissed

Be specific and evidence-based. Cite exact phrases from both texts.
```

### Judge (JSON output spec)
```
You are the Judge in a structured debate about text quality. Two advocates have argued for competing text variants. Synthesize their arguments into a fair verdict with actionable improvement recommendations.

## Variant A
<<<CONTENT>>>
${variantA.text}
<<</CONTENT>>>

## Variant B
<<<CONTENT>>>
${variantB.text}
<<</CONTENT>>>

## Advocate A's Argument (for Variant A)
${advocateAArgument}

## Advocate B's Argument (for Variant B)
${advocateBArgument}

## Task
Produce a JSON verdict with these fields:
- "winner": "A" or "B" or "tie"
- "reasoning": 1-2 sentence summary of why
- "strengths_from_a": array of specific strengths to preserve from Variant A
- "strengths_from_b": array of specific strengths to preserve from Variant B
- "improvements": array of specific actionable improvements for the synthesis

Output ONLY valid JSON, no other text.
```

### Synthesis (delegated to inner GFPA via customPrompt in V2)
The V1 synthesis prompt embedded the judge's verdict directly. In V2 the synthesis call delegates to `GenerateFromPreviousArticleAgent.execute()` with `customPrompt` built from the verdict's `strengths_from_a` / `strengths_from_b` / `improvements` lists + `tactic: 'debate_synthesis'` (marker tactic). GFPA owns FORMAT_RULES injection, format-validate, and ranking — DebateAgent doesn't re-implement them.

## V1 dependencies that no longer exist in V2 (must replace)

- **V1 AgentBase shape** — V2 uses `Agent<TInput, TOutput, TDetail>` generic
- **V1 PipelineState** (`state.pool`, `state.allCritiques`, `state.metaFeedback`, `state.debateTranscripts`) — V2 has snapshot-based iteration model
- **V1 ReflectionAgent helpers** (`getCritiqueForVariant`, `getImprovementSuggestions`) — replaced by `evolution_arena_comparisons` history fetch
- **V1 cost-tracker** (`reserveBudget`, `getAgentCost`) — V2 uses per-invocation `AgentCostScope`
- **V1 actions** (ADD_TO_POOL etc.) — V2 returns `AgentOutput` with mutations
- **V1 `createTextVariation()` factory** — V2 uses `Variant` type directly
- **V1 `QUALITY_DIMENSIONS` constant** — V2 may keep dimensions inline in prompt or pass via config
- **V1 `MetaFeedback` injection in synthesis prompt** — V2 has no MetaFeedback equivalent; drop

## V2 templates to copy

| Template file | What to lift |
|---|---|
| `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` | Closest structural template — combined pre-stage + delegate to inner GFPA via `.execute()` with `customPrompt`. Lift: `execute()` body shape, header comment block (I1/I2/I3 invariants), `getAttributionDimension()`, custom errors. |
| `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` | Multi-LLM-call cost-snapshot pattern. Lift: `costBeforeXxxCall = ctx.costTracker.getOwnSpent?.() ?? 0` snapshot before each helper LLM call; per-purpose cost split persisted in `execution_detail`. |
| `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts` | First-shipped V2 wrapper template. Lift: `tacticRanking` parser pattern, `ReflectionParseError` / `ReflectionLLMError` custom error class shape. |
| `evolution/src/lib/pipeline/loop/editingDispatch.ts` | Dispatch-helper precedent. Lift: `resolveEditingDispatchRuntime` / `resolveEditingDispatchPlanner` / `resolveEditingEnabled` signature shape. |
| `docs/planning/bring_back_editing_agents_evolution_20260430/bring_back_editing_agents_evolution_20260430_planning.md` | Canonical V1→V2 revival project structure. Lift: Decisions §13/§14 invariants verbatim, Phase 1.5 migration pattern, Phase 7 staging cycle. |

## Documents Read

- `docs/planning/historical_agent_evolution_survey_20260504/debate_agent_revival_brief.md` — primary design synthesis
- `docs/planning/new_edit_operator_20260201/new_edit_operator_20260201_research.md` — V1 research foundation (AI Co-Scientist alignment, MAD literature, Multi-Persona pattern)
- `docs/planning/new_edit_operator_20260201/new_edit_operator_20260201_planning.md` — V1 phased execution plan
- `docs/planning/bring_back_editing_agents_evolution_20260430/bring_back_editing_agents_evolution_20260430_planning.md` — canonical V1→V2 revival template
- `docs/planning/evaluateCriteriaThenGenerateFromPreviousArticle_20260501/...` — closest structural template
- All evolution docs (architecture, agents/overview, data_model, arena, cost_optimization, curriculum, data_model, entities, logging, metrics, minicomputer_deployment, rating_and_comparison, reference, strategies_and_experiments, visualization)

## Code Files Read (during prior survey research)

V1 deleted-source pulls via `git show 4f03d4f6^:<path>`:
- `evolution/src/lib/agents/debateAgent.ts` (V1 main source, ~364 LOC)
- `evolution/src/lib/agents/debateAgent.test.ts` (V1 tests, ~389 LOC)
- `evolution/src/lib/agents/base.ts` (V1 AgentBase)
- `evolution/src/lib/agents/reflectionAgent.ts` (V1 critique helpers DebateAgent depended on)

Current V2 source files (canonical templates):
- `evolution/src/lib/core/Agent.ts` (base class with B-marker invariants)
- `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts`
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts`
- `evolution/src/lib/core/agents/reflectAndGenerateFromPreviousArticle.ts`
- `evolution/src/lib/core/agentRegistry.ts`
- `evolution/src/lib/core/agentNames.ts`
- `evolution/src/lib/schemas.ts:478` (iterationAgentTypeEnum)
- `evolution/src/lib/schemas.ts:1092-1112` (orphan debateExecutionDetailSchema)
- `evolution/src/lib/schemas.ts:1565-1583` (agentExecutionDetailSchema discriminated union)
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (dispatch site, ~lines 786-944 for iterative_editing precedent)
- `evolution/src/lib/pipeline/loop/editingDispatch.ts`
- `evolution/src/lib/core/detailViewConfigs.ts:380-397` (orphan debate config)
- `evolution/src/lib/core/entities/InvocationEntity.ts` (listFilters)
- `evolution/src/testing/executionDetailFixtures.ts:232-252` (orphan debate fixture)
- `evolution/src/lib/core/tactics/index.ts` (TACTIC_PALETTE, MARKER_TACTICS)
- `evolution/src/lib/metrics/types.ts` (STATIC_METRIC_NAMES)
- `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts`
- `evolution/src/lib/core/startupAssertions.ts`

Migrations:
- `supabase/migrations/20260414000001_evolution_cost_calibration.sql`
- `supabase/migrations/20260501204141_evolution_cost_calibration_reflection_phase.sql`
- `supabase/migrations/20260501204142_evolution_cost_calibration_editing_phases.sql`

Key historical commits:
- `8ae43a20b` (V1 introduction, 2026-02-18, PR #319)
- `4f03d4f6` (V1 mass-deletion via PR #716, 2026-03-16)
- `cad78cb5c` (GFSA → GFPA rename via PR #997, 2026-04-18)
- `56239ddc9` (ReflectAndGenerate via PR #1017, 2026-04-30)
- `b4729c14c` (IterativeEditing V2 revival via PR #1020, 2026-05-01)
- `881c020e7` (EvaluateCriteria via PR #1023, 2026-05-02)
