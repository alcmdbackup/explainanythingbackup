# Brainstorm New Agents With Reflection Plan

## Background
Build prototypes for three new evolution-pipeline agents that adapt the proven "reflection-as-selection" pattern to editing — cheaply and flexibly, without paragraph_recombine's per-slot arena-topic / sync_to_arena / per-slot-ranking overhead. Recent analyses (2026-06-24, 2026-06-27, **2026-06-28**) show `reflect_and_generate` leads on every metric (P(best) 96%, median +165 Elo, 94% `%var>seed`); the propose/approve (3-4×) and iterative_editing (5×) cost stacks did not win on ceiling OR density. The shared lesson: **reflection is best used as a small selection signal, then templated execution does the labor.** This project builds three agents that apply that pattern to editing tasks the current pipeline either can't do, can't do cheaply, or can't do flexibly.

## Requirements (from GH Issue #1324)
Build prototypes for the first 3 agents listed in `_research.md`:
1. **Reflect-and-localize** — reflection picks a paragraph + directive → single short-output rewrite → splice + rank
2. **Reflect-then-Mode-B-rewrite** — reflection picks a focus area (section/heading) → Mode B (rewrite-then-diff) constrained to that area → approver → apply + rank
3. **Self-critique-then-revise** — eval call lists 2-3 article-specific weaknesses (no criteria table) → customPrompt fed to GFPA regenerate + rank

Each prototype needs rigorous tests including at least one end-to-end test, must work properly, and must reuse existing patterns for agents.

## Problem
The pipeline has rich infrastructure for reflection-as-selection (`reflect_and_generate`) and for expensive multi-cycle editing (`iterative_editing`, `proposer_approver`, `paragraph_recombine_with_coherence_pass`), but no cheap, flexible *editing* path driven by reflection. Operators who want "reflect → edit a targeted spot → rank" must either pay 3-5× GFPA cost on the existing editing agents or accept the heavy paragraph_recombine infrastructure (per-slot arena topics + `sync_to_arena` extensions + per-slot ranking + merge step). We need three drop-in agents that close this gap at near-GFPA cost.

## Architecture Analysis

### What we are reusing (and why we can prototype quickly)
Every existing wrapper agent — `ReflectAndGenerateFromPreviousArticleAgent`, `EvaluateCriteriaThenGenerateFromPreviousArticleAgent`, `SinglePassEvaluateCriteriaAndGenerateAgent`, `ProposerApproverCriteriaGenerateAgent`, `IterativeEditingRewriteAgent` (which is just `IterativeEditingAgent` + one flag flip) — follows the same template:
- Extends `Agent<TInput, TOutput, TDetail>` (base in `evolution/src/lib/core/Agent.ts`).
- Declares: `name`, `executionDetailSchema`, `getAttributionDimension`, `invocationMetrics`, `detailViewConfig`.
- `execute()` body: snapshot `costBefore*` → make small "decide what to do" LLM call → on any throw, persist partial detail via `updateInvocation` BEFORE re-throwing → call the inner workhorse via `.execute()` (NOT `.run()` — load-bearing for cost-scope unity) → merge details + recompute `totalCost`.
- Registers an attribution extractor for tactic-leaderboard attribution.

The three new agents fit this template exactly. The only *new* code per agent is: one prompt builder, one parser, one Zod schema, and the body of `execute()`. Everything else (cost tracking, invocation row, partial-detail persistence, ranking, attribution, METRIC_CATALOG registration, dispatch wiring) is mechanical copy of an existing agent.

### Shared scaffolding the three agents will all leverage

| Surface | Existing pattern we copy | New code each agent needs |
|---|---|---|
| Agent class | `Agent.run()` template method (`evolution/src/lib/core/Agent.ts`) | `name` field + `execute()` body |
| Cost snapshot | `costBeforeReflection = ctx.costTracker.getOwnSpent?.() ?? 0` (`reflectAndGenerateFromPreviousArticle.ts:281`) | Same line, renamed by agent |
| Custom errors | `ReflectionLLMError` + `ReflectionParseError` (`reflectAndGenerateFromPreviousArticle.ts:40-52`) | Same pattern, agent-specific names |
| Partial-detail-before-rethrow | every throw path → build `partial: ExecutionDetail` → `updateInvocation(ctx.db, ctx.invocationId, {cost_usd, success:false, execution_detail: partial})` → re-throw (`reflectAndGenerateFromPreviousArticle.ts:303-330` and 5 sibling sites) | Mechanical copy |
| Inner dispatch | `await new GenerateFromPreviousArticleAgent().execute(innerInput, ctx)` (NOT `.run()`) (`reflectAndGenerateFromPreviousArticle.ts:414`) | Same call for agents 1 + 3; agent 2 dispatches `runEditingCycle` instead |
| Schema | `evolution/src/lib/schemas.ts` lines 2015 (reflect_and_generate) + 2154 (single_pass) | New `<agent>ExecutionDetailSchema` per agent — `executionDetailBaseSchema.extend({...})` |
| AgentName labels + cost routing | `evolution/src/lib/core/agentNames.ts` (`AGENT_NAMES` array + `COST_METRIC_BY_AGENT` map) | New labels per agent, mapped to a new umbrella cost metric per agent |
| Cost metric | `METRIC_CATALOG` in `evolution/src/lib/core/metricCatalog.ts` (`reflection_cost` line 26; `evaluation_cost` line 53) | Three new umbrella metrics + their `total_*` and `avg_*_per_run` propagated counterparts |
| Cost calibration | DB CHECK constraint `evolution_cost_calibration_phase_allowed` (extended for each new label in past migrations, e.g. `20260527000004` for `paragraph_rewrite`) | One migration extending the CHECK with the new labels |
| Iteration enum | `iterationConfigSchema.agentType` in `evolution/src/lib/schemas.ts` | Three new enum entries + Zod `.superRefine` rules (no swiss before, sourceMode allowed, etc.) |
| Dispatch branch | `runIterationLoop.ts:361` (`if (iterType === 'generate' || iterType === 'reflect_and_generate' || ...)`) | Extend the conjunction; copy the dispatch shape for each agent |
| Cost projector | `estimateAgentCost(...)` in `evolution/src/lib/pipeline/loop/projectDispatchPlan.ts` | New per-agent estimator that accounts for the reflection / eval LLM call + the inner workhorse cost |
| Attribution extractor | `registerAttributionExtractor(...)` (called from each agent file's tail) | Per-agent extractor selecting the right dimension off detail |
| Tactic registry / marker | `evolution_tactics` synced from `evolution/src/lib/core/tactics/generateTactics.ts` via `syncSystemTactics.ts` (kept in DB for entity UUIDs) | One marker tactic per agent — `reflect_localize`, `reflect_rewrite_diff`, `self_critique_driven` |
| Detail view | `DETAIL_VIEW_CONFIGS` in `evolution/src/lib/core/detailViewConfigs.ts` | Per-agent field config (mechanical copy of reflect/single_pass) |
| Kill switch | env var `EVOLUTION_REFLECTION_ENABLED` style | One env var per agent: `EVOLUTION_REFLECT_LOCALIZE_ENABLED`, `EVOLUTION_REFLECT_REWRITE_DIFF_ENABLED`, `EVOLUTION_SELF_CRITIQUE_ENABLED` (all default `'true'`) |

### Agent 1: `ReflectAndLocalizeAgent` (`reflect_and_localize`) — multi-target
**Hypothesis.** A small reflection call that picks ONE-TO-N paragraphs (each with its own directive) lets us run several focused edits in a single dispatch at near-GFPA cost — no full-article rewrite, no markup parser, no approver loop. Letting the reflector pick multiple paragraphs in one pass gives it a holistic view ("the intro needs tightening AND the conclusion needs an example") that single-paragraph dispatch can't express without multiple iterations.

**Algorithm (per parent variant):**
1. Reflection LLM call (`AgentName: 'localize_reflection'`). Prompt feeds parent text + numbered paragraph list (parsed via `extractParagraphsWithRanges` from `evolution/src/lib/shared/paragraphSlots.ts` — already exists for paragraph_recombine). Asks LLM to pick **between 1 and `localizeMaxTargets`** paragraphs (default 3, range 1-5; per-iteration knob), each with one directive from a small enum (`tighten` | `clarify` | `expand` | `add_example` | `strengthen_transition` | `replace_filler`) + a one-sentence rationale per target.
2. Parse via `parseLocalizeReflection` — tolerant, throws `LocalizeReflectionParseError` on zero valid output. Returns `{targets: [{paragraphIndex, directive, rationale}, ...]}` with `1 ≤ length ≤ localizeMaxTargets`. Validates each `paragraphIndex` is in-range, each `directive` is in enum, drops duplicate paragraph picks (keeps first), truncates if the LLM returned more than `localizeMaxTargets` (logs warn).
3. **Parallel targeted rewrite LLM calls** (`AgentName: 'localize_rewrite'`). For each surviving target, in parallel via `Promise.allSettled`: prompt is `buildParagraphRewritePrompt` (already exists for paragraph_recombine) seeded with that target's directive and that paragraph's text only. Each rewrite is BLIND to the others (acceptable for prototype — matches legacy paragraph_recombine's parallel-slot behavior).
4. For each target independently, validate via `validateParagraphRewrite` (already exists — length cap ±20%, no bullets/lists/tables/H1, ≥1 sentence-ending punctuation). On invalid OR on LLM-call failure, fall back to the original paragraph for THAT SLOT only (partial application — other targets still apply). Record `validationPassed=false` and `error` in detail.
5. If ALL targets fell back, emit `surfaced=false, discardReason: {reason: 'all_targets_invalid'}`. Otherwise: splice all successful rewrites in one pass via `assembleRecombinedArticle` (already exists — right-to-left byte-offset preserving splice, designed for the N-slot case). `validateFormat` the whole article.
6. Rank via `rankNewVariant` against the iteration-start pool snapshot (article mode, same as GFPA). ONE article-level ranking pass — NOT per-slot. Surface/discard decision identical to GFPA.
7. Emit variant with `parent_variant_ids = [parentVariantId]` (single primary parent — D4 invariant). Tactic = `reflect_localize`. `execution_detail` carries reflection sub-object (with all targets) + per-target rewrite results array + one article-level ranking sub-object.

**What it deliberately doesn't do:**
- NO `upsertSlotTopic` / no per-slot arena topic.
- NO `sync_to_arena` payload extension for per-slot.
- NO `persistSlotMatches`.
- NO **per-slot ranking** — ONE article-level ranking pass at the end.
- NO per-slot AgentCostScope nesting, NO per-slot LLM-client proxy.
- NO multi-cycle loop, NO approver, NO mirror-approver, NO CriticMarkup parser.
- NO sequential context-aware mode (parallel rewrites are BLIND to each other — acceptable for prototype).

It uses paragraph_recombine's **text-manipulation utilities** (`extractParagraphsWithRanges`, `validateParagraphRewrite`, `assembleRecombinedArticle`, `buildParagraphRewritePrompt`) WITHOUT the **infrastructure overhead** the user asked us to avoid. This is the cleanest fit.

**Cost stack** (at default `localizeMaxTargets = 3`, typical N=2-3 picked):
- Reflection: ~$0.0005 (small input, ~200 output toks: N targets each with index + directive + rationale)
- Rewrites (N parallel): ~N × $0.0008 each (input full article, output one paragraph ~250 toks vs GFPA's full ~1000) — so ~$0.0016-0.0024 at N=2-3
- Ranking: same as GFPA (~$0.002 with default `maxComparisonsPerVariant=15` and a small pool)
- **Total estimate ~$0.004-0.005 per variant at N=2-3** — close to GFPA's $0.0048 staging median. **~0.9-1.1× GFPA cost.** Lower N drops it; higher N (cap 5) tops out around ~$0.007.

**Attribution dimension:** the **first chosen target's directive** (e.g., `eloAttrDelta:reflect_and_localize:tighten`) — matches the criteria-agent convention of using the primary weakness. Tail directives still recorded on detail for inspection.

**New schema fields** (`reflectAndLocalizeExecutionDetailSchema`):
```ts
{
  detailType: 'reflect_and_localize',
  tactic: 'reflect_localize',
  reflection: {
    paragraphCount: int,         // total paragraphs presented to LLM
    maxTargetsRequested: int,     // = localizeMaxTargets from config
    targets: array of {            // 1 ≤ length ≤ localizeMaxTargets
      paragraphIndex: int,          // 0-based, the chosen slot
      directive: enum,              // tighten | clarify | expand | add_example | strengthen_transition | replace_filler
      rationale: string,
    },
    droppedDuplicates?: int,      // count of duplicate paragraph picks the parser collapsed
    rawResponse?: string,         // on parse failure
    parseError?: string,
    durationMs?: int,
    cost?: number,
  },
  rewrites: array of {            // same length + order as reflection.targets; entries for failed targets carry validationPassed=false
    paragraphIndex: int,
    directive: enum,
    originalParagraphLength: int,
    newParagraphLength: int,
    validationPassed: boolean,
    formatIssues?: string[],       // when validation failed
    error?: string,                 // when the rewrite LLM call threw or returned empty
    durationMs?: int,
    cost?: number,
  },
  rewriteSummary: {
    requested: int,                // = reflection.targets.length
    succeeded: int,
    failed: int,                    // requested - succeeded
    totalRewriteCost: number,
  },
  ranking?: {...},                // reused rankNewVariantDetailInnerSchema, identical to GFPA's — ONE article-level rank, not per-slot
  totalCost: number,
  surfaced: boolean,
  discardReason?: {...}           // localElo / localTop15Cutoff, plus {reason: 'all_targets_invalid'} when every target failed
}
```

**New per-iteration knob:** `localizeMaxTargets?: number` (range 1-5, default 3) on `iterationConfigSchema`. Zod `.superRefine` rejects it when `agentType !== 'reflect_and_localize'`. Participates in the strategy `config_hash` via `canonicalizeIterationConfig` (defaults fold).

### Agent 2: `ReflectAndRewriteDiffAgent` (`reflect_and_rewrite_diff`) — general focus
**Hypothesis.** Reflection picks a *general focus* of one of four kinds — a **criterion** (e.g. tone, clarity, voice), an **area** (e.g. intro, conclusion, a specific heading, or "whole_article"), a **general weakness** (e.g. "examples are too abstract throughout"), or **feedback** (e.g. "needs more concrete data points") — then Mode B (rewrite-then-diff) does a single intent-scoped cycle → approver decides → mechanical apply. This grafts `reflect_and_generate`'s selection onto `iterative_editing_rewrite` Mode B's cheap-diff substrate, and pairs naturally with Agent 1: **Agent 1 = *location-specific* edits (pick paragraphs), Agent 2 = *theme-specific* edits (pick a quality dimension, an area, a recurring weakness, or feedback).** Avoids multi-cycle compounding (the 5× cost in default iterative_editing) and the Mode A foot-gun.

**Algorithm:**
1. Reflection LLM call (`AgentName: 'reflect_rewrite_diff_reflection'`). Prompt feeds parent text + a brief explanation of the four focus types + the list of headings (extracted from H1/H2/H3 lines so the LLM can name an area precisely if it picks `focusType: 'area'`). Asks the LLM to pick the SINGLE most-impactful focus. Structured output:
   - `focusType: 'criterion' | 'area' | 'general_weakness' | 'feedback'`
   - `focus`: the actual content. For `criterion`: a single name like `"tone"`, `"clarity"`, `"voice"`, `"precision"`, `"flow"`, `"depth"`, `"engagement"` (free-form, but the prompt suggests these). For `area`: a heading text from the presented list, or one of the sentinels `"intro"` / `"conclusion"` / `"whole_article"`. For `general_weakness`: a brief description of the recurring pattern (e.g. "examples are too abstract throughout"). For `feedback`: a brief actionable note (e.g. "needs more concrete data points"). Free-form string, capped to 200 chars.
   - `editIntent`: what to actually DO about the focus — the executable directive the proposer will follow (e.g. "shift from formal academic to conversational without losing precision", "add a concrete hook", "replace 2-3 abstract examples with concrete ones"). Free-form, capped to 500 chars.
   - `rationale`: one-sentence justification.
2. Parse via `parseRewriteDiffReflection` — tolerant, structured. Throws `RewriteDiffReflectionParseError` on zero valid output. Validates `focusType` is in enum, `focus` and `editIntent` are non-empty + within length caps. When `focusType === 'area'` AND `focus` is a heading-text candidate, soft-checks that the heading actually appears in the article — logs a warn if not but DOES NOT throw (the proposer can still attempt the edit).
3. Build a scope-aware Mode B proposer prompt by extending `proposerPromptRewrite.ts` (the existing Mode B proposer prompt for `iterative_editing_rewrite`) with a SCOPE BLOCK that branches on `focusType`. The proposer's `## Rationale + ## Rewrite` output shape is unchanged; only the system-prompt scope framing differs:
   - `focusType=criterion`: *"This article needs improvement on the '<focus>' criterion. Apply this intent across the article: <editIntent>. Preserve substantive content and structure; change only what serves this criterion."*
   - `focusType=area`: *"Edit ONLY the area '<focus>'. Edit intent: <editIntent>. Leave the rest of the article byte-equal where possible."*
   - `focusType=general_weakness`: *"The article has a recurring weakness: <focus>. Apply this targeted fix: <editIntent>. Minimize collateral changes — touch only what addresses the weakness."*
   - `focusType=feedback`: *"Apply this targeted feedback: <focus>. Specifically: <editIntent>. Minimize collateral changes — make the smallest set of edits that fully addresses the feedback."*
   All four variants share a closing instruction: *"Output the full article via `## Rationale` and `## Rewrite` blocks. The diff engine derives minimal edits from your rewrite — making fewer changes produces fewer derived edits."*
4. Call `runEditingCycle` (the shared helper already extracted from `IterativeEditingAgent`) ONCE with `rewriteMode: { coalesceAndCap: false }` (Mode B path) + the new system prompt. This drives proposer → `splitRationaleAndRewrite` → `computeMarkupFromRewrite` (mechanical diff) → `validateEditGroups` → approver call → `applyAcceptedGroups`. All of this code already exists; the only addition is the system-prompt override.
5. If `cycleResult.appliedCount === 0` → emit `surfaced=false` with reason `'no_edits_applied'`. Otherwise the new article text becomes the variant.
6. Rank via `rankNewVariant` against the iteration-start pool (article mode). Same surface/discard as GFPA.
7. Emit variant with `parent_variant_ids = [parentVariantId]`. Tactic = `reflect_rewrite_diff`.

**What it doesn't do:**
- NO multi-cycle loop (single cycle by design).
- NO CriticMarkup-from-the-LLM (Mode B = diff derived mechanically).
- NO mirror-approver (one pass is enough for a small targeted change).
- NO paragraph_recombine infrastructure.
- NO **strict scope enforcement at the splice level** — Mode B's mechanical diff is what bounds edit breadth; the scope block is a *behavioral hint* to the proposer, not a hard wall. For `focusType=criterion` / `general_weakness` / `feedback` the proposer is explicitly invited to touch multiple places.

**Cost stack:**
- Reflection: ~$0.0005 (focusType + focus + editIntent + rationale ~ 200 toks)
- Proposer (Mode B): output is full-article — total ~1.4× article (same as today's `iterative_editing_rewrite` per cycle)
- Approver: input-heavy, output ~50 toks per accepted/rejected group. Slightly more derived groups expected for whole-article focus (criterion / general_weakness / feedback) than for narrowly-scoped area focus, but approver decisions stay cheap per group.
- Ranking: same as GFPA
- **Total estimate ~$0.012-0.020 per variant.** **~2.5-3× GFPA cost** — still ~40-50% cheaper than today's `iterative_editing_rewrite` (3 cycles default).

**Attribution dimension:** the `focusType` (4 categories) — clean 4-bucket grouping on the tactic leaderboard. The `focus` itself is recorded on detail for inspection, so a follow-up SQL slice can break out e.g. `criterion:tone` vs `criterion:clarity` without bloating the leaderboard buckets. (`eloAttrDelta:reflect_and_rewrite_diff:criterion`, `eloAttrDelta:reflect_and_rewrite_diff:area`, etc.)

**New schema fields:**
```ts
{
  detailType: 'reflect_and_rewrite_diff',
  tactic: 'reflect_rewrite_diff',
  reflection: {
    focusType: enum,             // criterion | area | general_weakness | feedback
    focus: string,                // ≤ 200 chars
    editIntent: string,            // ≤ 500 chars
    rationale: string,
    headingsPresented: string[],  // for forensic display (audit what the LLM saw when picking 'area')
    areaHeadingMatched?: boolean,  // when focusType='area' AND focus is a heading text, did it match the article? (soft check)
    rawResponse?: string,
    parseError?: string,
    durationMs?: int,
    cost?: number,
  },
  cycle: {
    proposeCostUsd: number,
    approveCostUsd: number,
    proposerMode: 'rewrite',           // always Mode B
    rationale?: string,                  // from cycleResult.modeBContext
    rewriteText?: string,
    appliedCount: int,
    approverGroups: int,
    stopReason: 'applied' | 'no_edits_proposed' | 'all_edits_rejected' | 'drift_major' | 'budget',
    durationMs?: int,
  },
  ranking?: {...},
  totalCost: number,
  surfaced: boolean,
  discardReason?: {...}
}
```

### Agent 3: `SelfCritiqueReviseAgent` (`self_critique_revise`)
**Hypothesis.** Today's criteria-style agents (76-81% `%var>seed`) hinge on a `evolution_criteria` table that operators must populate per topic — a friction tax. A self-generated critique (the LLM reads its own article and lists 2-3 specific weaknesses) lifts the criteria-agent shape *without the table*, working out-of-the-box on any topic.

**Algorithm:**
1. Self-critique LLM call (`AgentName: 'self_critique'`). Prompt asks the LLM to read the article and list 2-3 specific concrete weaknesses, formatted as:
   ```
   Issue 1: <specific weakness>
     Example: "<short verbatim quote from the article>"
     Fix: <concrete improvement direction>

   Issue 2: ...
   ```
2. Parse via `parseSelfCritique` — tolerant, structured `{issues: [{text, examplePassage, fix}]}`. Throws on zero valid output.
3. Build a customPrompt that closely mirrors `buildSinglePassCustomPromptFromSuggestions` (lines 60-107 of `singlePassEvaluateCriteriaAndGenerate.ts`) — same Length/Redundancy/Flow soft directives + meta-commentary ban. Differences:
   - No "Criterion:" frame (no criteria table); each issue rendered as `Issue N: <text>\n  Example: "..."\n  Fix: <text>`.
   - High-Elo guidance block reused verbatim (parent Elo > `SELF_CRITIQUE_HIGH_ELO_THRESHOLD = 1300`).
4. Delegate to `new GenerateFromPreviousArticleAgent().execute(innerInput, ctx)` with `tactic: 'self_critique_driven'` (new marker tactic) and the customPrompt.
5. Forward GFPA's `failure` signal (D1 invariant) so hard-fail variants get recorded `success=false`.
6. Compute `lengthCapHit` post-hoc (same observational telemetry as single_pass — flag if generated text > 1.10× parent).

**What it doesn't do:**
- NO dependency on `evolution_criteria` rows — works for any prompt without operator setup.
- NO CriticMarkup, NO approver, NO edit groups — same as single_pass.
- NO paragraph_recombine infrastructure.

**Cost stack:** (near-clone of single_pass)
- Self-critique: ~$0.0005 (article in, 2-3 issues out ~300 toks)
- GFPA generate: same as vanilla generate (full article rewrite)
- Ranking: same as GFPA
- **Total estimate ~$0.005-0.007 per variant.** **~1.5-2× GFPA cost** — closely matches `single_pass_criteria` (was $0.0964/10runs ÷ ~30var = ~$0.003/variant in 2026-06-28 analysis).

**Attribution dimension:** the first issue's category if classifiable; otherwise the first ~80 chars of the first issue's text (truncated). Falls back to `'self_critique'` literal if neither is available. (Pragmatic — the leaderboard will mostly group under the agent name and use the dimension as a sub-filter.)

**New schema fields:**
```ts
{
  detailType: 'self_critique_revise',
  tactic: 'self_critique_driven',
  critique: {
    issues: [{
      text: string,
      examplePassage: string,
      fix: string,
    }],
    rawResponse?: string,
    parseError?: string,
    durationMs?: int,
    cost?: number,
  },
  generation?: {...},   // reused from GFPA
  ranking?: {...},        // reused from GFPA
  totalCost: number,
  surfaced: boolean,
  discardReason?: {...},
  guardrails: {
    lengthCapHit: boolean,
  },
}
```

### Dispatch wiring (`runIterationLoop.ts`)
All three agents are "variant-producing" — same parallel-batch + top-up + merge shape as `generate` / `reflect_and_generate` / `criteria_and_generate`. We extend the existing big conjunction at line 361:

```ts
if (iterType === 'generate' || iterType === 'reflect_and_generate'
    || iterType === 'criteria_and_generate' || iterType === 'single_pass_evaluate_criteria_and_generate'
    || iterType === 'proposer_approver_criteria_generate'
    || iterType === 'reflect_and_localize'           // NEW
    || iterType === 'reflect_and_rewrite_diff'        // NEW
    || iterType === 'self_critique_revise') {         // NEW
  // ... existing parallel-batch + top-up + merge logic ...
}
```

Inside `dispatchOneAgent`, add three new branches mirroring the `criteria_and_generate` branch (around line 531) — each constructs its agent class with the right `input` shape and calls `.run(...)`. No changes to merge agent, snapshot, or per-iteration budget tracking.

**Sourcemode handling.** All three agents accept `sourceMode: 'seed' | 'pool'` + `qualityCutoff` exactly like `generate` / `reflect_and_generate`. First-iteration must be one of these (already enforced by `iterationConfigSchema.superRefine`).

### Cost projector (`projectDispatchPlan.ts`)
Extend `estimateAgentCost(...)` to include:
- `useReflectLocalize: boolean` → adds `localize_reflection` + `localize_rewrite` cost estimate (similar to `useReflection`)
- `useReflectRewriteDiff: boolean` → adds `reflect_rewrite_diff_reflection` + `propose` + `approve` cost estimate
- `useSelfCritique: boolean` → adds `self_critique` cost estimate (similar to `useCriteria`)

Each estimate uses `OUTPUT_TOKEN_ESTIMATES.<label>` extended with the new labels and reads from the cost-calibration loader so empirical numbers replace constants once we have data.

### What we will NOT build in this prototype (explicitly out of scope)
- **No new judge mode.** Article-mode comparisons only (paragraph mode is paragraph_recombine territory). If editing-mode comparison rubrics matter, we add them after the first staging signal.
- **No rubric-judging integration.** The new agents are holistic-judge-compatible only; `judgeRubricId` integration deferred.
- **No coordinator replan / multi-iteration scope tracking.** Reflection happens ONCE per parent per dispatch.
- **No new entity tables.** Everything fits in `evolution_variants` + `evolution_agent_invocations` + `evolution_metrics` + `evolution_arena_comparisons`.
- **No DB migration except the cost-calibration phase enum extension.** That migration is mechanical (the same shape as `20260527000004_evolution_cost_calibration_paragraph_recombine_phase.sql`).

## Options Considered

- [ ] **Option A: Implement all 3 agents in parallel branches (max throughput).** — Pro: parallel work. Con: schema + dispatch loop edits would touch the same files and conflict. **Rejected** for prototype work.
- [ ] **Option B: Implement all 3 agents sequentially (clean diffs).** — Pro: smallest blast radius, easiest review, copy-improve as each one lands. Con: slower. **CHOSEN** — matches the user's "prototype" framing.
- [ ] **Option C: Build only agent 1 as full prototype + sketch agents 2 + 3.** — Pro: ships fastest. Con: user explicitly asked for all 3 with rigorous tests. **Rejected** — under-delivers.

## Phased Execution Plan

### Phase 0: Final research polish + decision lock-in
- [ ] Read `evolution/docs/cost_optimization.md` (cost calibration table + V2CostTracker semantics) — needed for the projector extensions
- [ ] Read `evolution/docs/metrics.md` (METRIC_CATALOG + propagation) — needed for the strategy/experiment-level cost rollups
- [ ] Read `evolution/src/lib/core/agents/editing/runEditingCycle.ts` — confirm `rewriteMode: { coalesceAndCap: false }` semantics and whether we need to pass a system-prompt override or build it before the call
- [ ] Read `evolution/src/lib/core/agents/editing/proposerPromptRewrite.ts` — to copy/extend for the focus-area scope block in agent 2
- [ ] Read `src/__tests__/integration/evolution-pipeline.integration.test.ts` (or equivalent) to lock in the integration test pattern
- [ ] Decide: reflection model = generation model (current default for all wrappers) OR separate `reflectionModel` strategy field? **Default decision: reuse `generationModel` for now; revisit after staging signal.**

### Phase 1: Shared scaffolding (foundation for all 3 agents)
- [ ] Extend `iterationConfigSchema.agentType` enum in `evolution/src/lib/schemas.ts` to include `'reflect_and_localize'`, `'reflect_and_rewrite_diff'`, `'self_critique_revise'`. Add `.superRefine` rules: each is variant-producing; first-iter allowed for all 3; mutex with `criteriaIds` / `generationGuidance` follows the existing pattern.
- [ ] Add new per-iteration knob `localizeMaxTargets?: number` (z.number().int().min(1).max(5)) to `iterationConfigSchema`. `.superRefine`: rejected when `agentType !== 'reflect_and_localize'`. Include in `canonicalizeIterationConfig` for config_hash participation (default `3` folded).
- [ ] Add three new umbrella cost metrics to `METRIC_CATALOG` in `evolution/src/lib/core/metricCatalog.ts`: `localize_cost`, `reflect_rewrite_diff_cost`, `self_critique_cost`. Plus `total_*` + `avg_*_per_run` propagated counterparts (six metrics total).
- [ ] Extend `AGENT_NAMES` in `evolution/src/lib/core/agentNames.ts` with the new labels: `localize_reflection`, `localize_rewrite`, `reflect_rewrite_diff_reflection`, `reflect_rewrite_diff_propose`, `reflect_rewrite_diff_review`, `self_critique`. Add `COST_METRIC_BY_AGENT` entries mapping each to the right umbrella (`reflection_cost` for reflection-style; new umbrellas for the rewrite/critique).
- [ ] Add `OUTPUT_TOKEN_ESTIMATES` entries for the new labels in `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` (or wherever the registry lives).
- [ ] Create migration `evolution/supabase/migrations/<ts>_new_reflection_agent_phases.sql` extending the `evolution_cost_calibration_phase_allowed` CHECK with the 6 new phase strings. Mirror `20260527000004` shape.
- [ ] Register three new marker tactics in `evolution/src/lib/core/tactics/generateTactics.ts`: `reflect_localize`, `reflect_rewrite_diff`, `self_critique_driven`. Run `evolution/scripts/syncSystemTactics.ts` against staging (manual).
- [ ] Add `evolution/src/lib/core/startupAssertions.ts` updates (extend `assertCostCalibrationPhaseEnumsMatch` if needed — likely no-op since the existing assertion is data-driven).
- [ ] Unit tests for: `iterationConfigSchema` accepts each new enum value + rejects bad combos; `COST_METRIC_BY_AGENT` is a complete mapping; new tactics resolve via `isValidTactic`.

### Phase 2: Agent 1 — `ReflectAndLocalizeAgent` (multi-target)
- [ ] Add `reflectAndLocalizeExecutionDetailSchema` to `evolution/src/lib/schemas.ts` with `reflection.targets: array`, `rewrites: array`, `rewriteSummary` sub-object (see Architecture Analysis section above for full shape).
- [ ] Create `evolution/src/lib/core/agents/reflectAndLocalize.ts`:
  - Custom errors: `LocalizeReflectionLLMError`, `LocalizeReflectionParseError`, `LocalizeRewriteLLMError`.
  - `buildLocalizeReflectionPrompt(parentText, numberedParagraphs, directives, maxTargets): string` — instructs LLM to pick 1-N paragraphs, each with its own directive + rationale.
  - `parseLocalizeReflection(response, paragraphCount, maxTargets): {targets, droppedDuplicates}` — tolerant parser. Returns `targets: Array<{paragraphIndex, directive, rationale}>` with `1 ≤ length ≤ maxTargets`. Drops duplicate paragraph picks (keeps first, increments `droppedDuplicates`). Truncates if LLM returned > maxTargets (logs warn). Throws `LocalizeReflectionParseError` on zero valid targets after filtering.
  - Class `ReflectAndLocalizeAgent extends Agent<...>` with `execute()` body following `reflectAndGenerateFromPreviousArticle.ts` template. Body shape:
    1. Reflection call + parse → `targets`
    2. `Promise.allSettled(targets.map(rewriteOne))` — each rewrite catches LLM errors + validation failures and records per-target `validationPassed` + `error`
    3. Build `successfulRewrites: Array<{paragraphIndex, newText}>` from settled results that passed validation
    4. If `successfulRewrites.length === 0` → emit `surfaced=false, discardReason: {reason: 'all_targets_invalid'}` (no throw)
    5. Splice via `assembleRecombinedArticle(parentText, slots, slotWinnerTexts)` — `slots` from the same `extractParagraphsWithRanges` call used for the reflection prompt, `slotWinnerTexts[i]` = new text for picked paragraphs, original text for unpicked
    6. `validateFormat` the recombined article
    7. `rankNewVariant` against pool snapshot — ONE call, article-mode
    8. Merge detail + emit
  - Attribution extractor registration (extract `detail.reflection.targets[0]?.directive`).
- [ ] Add `DETAIL_VIEW_CONFIGS.reflect_and_localize` entry in `evolution/src/lib/core/detailViewConfigs.ts` — render `reflection.targets` as a table (paragraph#, directive, rationale) + `rewrites` as a table (paragraph#, directive, originalLen, newLen, validationPassed) + `rewriteSummary` summary card.
- [ ] Unit tests `reflectAndLocalize.test.ts`:
  - Prompt builder includes paragraph list with 1-based numbering, lists allowed directives, states min=1 max=N
  - Parser: 1 target ✓, N targets ✓, N+1 targets → truncated + warn, duplicates → kept-first + droppedDuplicates count, unknown directive → entry dropped, out-of-range paragraphIndex → entry dropped, all-invalid → throws, empty → throws, whitespace variation tolerated
  - `execute()` happy path (mocked LLM via `v2MockLlm`, N=3): reflection + 3 parallel rewrites + splice + rank — variant produced, all rewrites recorded, `rewriteSummary.succeeded=3`, ranking ran
  - `execute()` partial-success path: N=3, one rewrite invalid — variant produced with 2 changes, `rewriteSummary.succeeded=2`, the failed entry has `validationPassed=false`
  - `execute()` all-targets-invalid path: N=3, all rewrites invalid → `surfaced=false`, `discardReason.reason='all_targets_invalid'`, no throw
  - `execute()` reflection-fail path — partial detail persisted before throw
  - `execute()` rewrite-LLM-throws-for-one path — that target's `error` field populated, other targets succeed (Promise.allSettled isolates)
- [ ] Property test `reflectAndLocalize.property.test.ts` — fuzz parser with `fast-check`:
  - Valid generated input (1-N targets with in-range indexes + valid directives) → returns `targets.length` matching generated count
  - Random text → either parses something valid or throws (never returns invalid state)
- [ ] Invariant tests `reflectAndLocalize.invariants.test.ts`:
  - Rewrites called via raw `llm.complete`, NOT through any nested Agent.run() (no cost-scope split)
  - `costBeforeReflection` captured before any LLM call
  - `costBeforeRewrites` captured after reflection but before parallel rewrites
  - Every throw path persists partial detail via `updateInvocation` (reflection-fail, parser-fail)
  - All-targets-invalid path does NOT throw (returns `surfaced=false` AgentOutput) — distinguish from throw paths
  - Detail schema validates produced detail object on all 5 happy/partial/fail paths
- [ ] Integration test in `src/__tests__/integration/evolution-reflect-localize.integration.test.ts`:
  - Seed test prompt + strategy (1×reflect_and_localize iteration, `localizeMaxTargets=2`, mocked LLM via `v2MockLlm` returning a 2-target reflection + 2 valid rewrites)
  - Trigger pipeline via `claimAndExecuteRun`
  - Assert: ≥1 invocation row with `agent_name='reflect_and_localize'`, 1 variant produced + ranked, `localize_cost` metric > 0, `parent_variant_ids[0]` = seed variant id, invocation's `execution_detail.rewriteSummary.succeeded === 2`

### Phase 3: Agent 2 — `ReflectAndRewriteDiffAgent` (general focus)
- [ ] Add `reflectAndRewriteDiffExecutionDetailSchema` to schemas.ts with `reflection.focusType` enum (`'criterion' | 'area' | 'general_weakness' | 'feedback'`), `reflection.focus`, `reflection.editIntent`, `reflection.headingsPresented`, `reflection.areaHeadingMatched?` (see Architecture Analysis section).
- [ ] Create `evolution/src/lib/core/agents/reflectAndRewriteDiff.ts`:
  - Custom errors: `RewriteDiffReflectionLLMError`, `RewriteDiffReflectionParseError`.
  - `buildRewriteDiffReflectionPrompt(parentText, headings): string` — feeds article text + heading list + explanation of the 4 focusTypes with examples of each. Asks LLM to pick exactly one. Output format: `focusType: <enum>\nfocus: <text>\neditIntent: <text>\nrationale: <text>` (one block).
  - `parseRewriteDiffReflection(response, headings): {focusType, focus, editIntent, rationale, areaHeadingMatched?}` — tolerant. Validates `focusType` is in enum. Non-empty `focus` + `editIntent` strings, truncated to 200 + 500 chars. When `focusType === 'area'` AND `focus` is not one of `intro` / `conclusion` / `whole_article`, soft-checks `focus` appears in `headings` (returns `areaHeadingMatched: boolean`, warn-logs on false but does NOT throw — proposer can still attempt).
  - `buildScopeBlock(focusType, focus, editIntent): string` — 4-way switch returning the focus-specific scope language (criterion / area / general_weakness / feedback) — see Algorithm step 3 above.
  - `buildModeBProposerSystemPromptWithScope(scopeBlock): string` — extends the existing Mode B system prompt from `proposerPromptRewrite.ts` with the scope block prepended.
  - Class `ReflectAndRewriteDiffAgent extends Agent<...>` with `execute()`:
    1. reflection call + parse (passes headings extracted from parent)
    2. Build scopeBlock + system-prompt override
    3. `await runEditingCycle({...input, rewriteMode: {coalesceAndCap: false}, systemPromptOverride})` — EXACTLY ONE cycle, no loop
    4. If `cycle.appliedCount === 0` → emit `surfaced=false, discardReason.reason='no_edits_applied'` (no throw)
    5. Otherwise rank `cycle.newText` via `rankNewVariant` (article mode)
    6. Merge detail + emit
  - Attribution extractor (extracts `detail.reflection.focusType` → one of 4 buckets).
- [ ] Add `DETAIL_VIEW_CONFIGS.reflect_and_rewrite_diff` — render focusType + focus + editIntent prominently, headingsPresented as collapsed list, areaHeadingMatched badge when focusType=area, cycle sub-object using existing iterative-editing cycle config.
- [ ] Extend `proposerPromptRewrite.ts` (or add a sibling) to accept the scope-block prepend. Keep the existing Mode B path byte-identical for `IterativeEditingRewriteAgent` (no scope override → existing prompt).
- [ ] Unit tests `reflectAndRewriteDiff.test.ts`:
  - Prompt builder includes all 4 focusType explanations with examples
  - Parser: valid `criterion` block ✓, valid `area` (heading match) ✓, valid `area` (heading miss → `areaHeadingMatched: false` + warn), valid `general_weakness` ✓, valid `feedback` ✓, unknown focusType → throws, empty focus → throws, empty editIntent → throws, focus > 200 chars → truncated, editIntent > 500 chars → truncated, whitespace variation tolerated
  - `buildScopeBlock` returns the correct language for each focusType (assert on key phrase from each branch)
  - `buildModeBProposerSystemPromptWithScope` prepends scope block to the existing Mode B system prompt without breaking the `## Rationale / ## Rewrite` instructions
  - `execute()` happy path per focusType (4 sub-tests, mocked LLM): reflection picks each focusType → runEditingCycle called with Mode B + correct scope override → variant produced + ranked
  - `execute()` reflection-fail path — partial detail persisted before throw
  - `execute()` no-edits-applied path → `surfaced=false, discardReason.reason='no_edits_applied'`, no throw
- [ ] Property test `reflectAndRewriteDiff.property.test.ts` — fuzz parser:
  - Valid generated input per focusType → returns matching focusType + non-empty focus + non-empty editIntent
  - Random strings → either parses validly or throws (no invalid state returned)
- [ ] Invariant tests `reflectAndRewriteDiff.invariants.test.ts`:
  - `runEditingCycle` called EXACTLY ONCE (no loop, no `for (cycle of cycles)`)
  - `runEditingCycle` called with `rewriteMode: {coalesceAndCap: false}` (Mode B path confirmed)
  - System-prompt override is the scope-wrapped prompt, NOT the bare Mode B prompt
  - `costBeforeReflection` snapshot captured before any LLM call
  - Every throw path persists partial detail via `updateInvocation`
  - Detail schema validates produced detail object on all paths
- [ ] Integration test in `src/__tests__/integration/evolution-reflect-rewrite-diff.integration.test.ts`:
  - Seed test prompt + strategy (1×generate, 1×reflect_and_rewrite_diff, mocked LLM scripted to return `focusType: 'criterion', focus: 'tone'` reflection then a valid Mode B rewrite that touches 2-3 spans)
  - Trigger pipeline via `claimAndExecuteRun`
  - Assert: ≥1 invocation with `agent_name='reflect_and_rewrite_diff'`, variant produced + ranked, `reflect_rewrite_diff_cost` metric > 0, parent points at the generated variant, `execution_detail.reflection.focusType === 'criterion'`, `execution_detail.cycle.appliedCount > 0`

### Phase 4: Agent 3 — `SelfCritiqueReviseAgent`
- [ ] Add `selfCritiqueReviseExecutionDetailSchema` to schemas.ts.
- [ ] Create `evolution/src/lib/core/agents/selfCritiqueRevise.ts`:
  - Custom errors
  - `buildSelfCritiquePrompt(parentText): string`
  - `parseSelfCritique(response): {issues: [{text, examplePassage, fix}]}` with tolerant parser
  - `buildSelfCritiqueCustomPromptFromIssues(issues, opts?: {highEloParent?}): {preamble, instructions}` — near-clone of `buildSinglePassCustomPromptFromSuggestions` (lines 60-107 of singlePass); reuse `SINGLE_PASS_HIGH_ELO_THRESHOLD = 1300`.
  - Class `SelfCritiqueReviseAgent extends Agent<...>` (near-clone of `SinglePassEvaluateCriteriaAndGenerateAgent`):
    1. self_critique LLM call + parse
    2. Build customPrompt
    3. Delegate to `new GenerateFromPreviousArticleAgent().execute(innerInput, ctx)` with `tactic: 'self_critique_driven'`
    4. Forward `gfpaOutput.failure`
  - Attribution extractor
- [ ] Add `DETAIL_VIEW_CONFIGS.self_critique_revise`.
- [ ] Unit tests `selfCritiqueRevise.test.ts` + property test + invariants test. Specific:
  - Inner GFPA dispatched via `.execute()` not `.run()`
  - High-Elo guidance fires when parent Elo > 1300, NOT when ≤ 1300
  - `lengthCapHit` telemetry: `true` when generated > 1.10× parent, `false` otherwise
- [ ] Integration test similar to agent 1.

### Phase 5: Dispatch wiring (`runIterationLoop.ts`)
- [ ] Extend the variant-producing conjunction at `runIterationLoop.ts:361` to include the 3 new agent types.
- [ ] Add three new branches in `dispatchOneAgent` (around line 531) — each constructs its agent class with the right input. Pattern: mirror the existing `criteria_and_generate` branch.
- [ ] Extend `estimateAgentCost(...)` in `projectDispatchPlan.ts` to accept `useReflectLocalize` / `useReflectRewriteDiff` / `useSelfCritique` flags, with cost estimates that route through the new `OUTPUT_TOKEN_ESTIMATES` entries.
- [ ] Wire kill-switch env reads at iteration entry (single env-var check per agent type).
- [ ] Unit tests for the dispatch branch (`runIterationLoop.test.ts`):
  - Dispatches correct agent class for each new iter type
  - Honors `sourceMode` / `qualityCutoff` like generate
  - Kill switch short-circuits with warn log + zero dispatch when env var is `'false'`

### Phase 6: Wizard UI (one option per agent in the dropdown)
- [ ] In `src/app/admin/evolution/strategies/new/page.tsx` extend the `agent-type-select-<i>` `<option>` list to include the 3 new types (display labels: "Reflect + Localize Edit", "Reflect + Rewrite (Mode B Diff)", "Self-Critique + Revise").
- [ ] First-iteration dropdown: all 3 enabled (all can start on empty pool — operate on seed).
- [ ] No new per-iteration controls beyond `sourceMode` + `qualityCutoff` (already standard).
- [ ] Wizard E2E test (the lightweight kind in `admin-evolution-iterative-editing.spec.ts:360+`): each new option appears in the dropdown, selecting it sets the agent type, no unrelated controls appear.

### Phase 7: End-to-end tests (one per agent, real LLM, `@evolution` tag)
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-reflect-localize-pipeline.spec.ts` — mirror `admin-evolution-iterative-editing.spec.ts` structure:
  - `beforeAll`: acquire pipeline lock; seed strategy with `1×reflect_and_localize` iteration + budget `$0.05`; seed prompt + experiment + run; trigger via `/api/evolution/run`; poll for `completed`.
  - Test 1: at least one invocation with `agent_name='reflect_and_localize'` exists.
  - Test 2: at least one variant exists with `parent_variant_ids` pointing at the seed.
  - Test 3: `localize_cost` metric on the run > 0.
  - Test 4: `subagent:ranking.cost` metric on the run > 0 (ranking ran).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-reflect-rewrite-diff-pipeline.spec.ts` — analogous; iteration plan `[1×generate, 1×reflect_and_rewrite_diff]` so there's a parent variant to edit (or `1×reflect_and_rewrite_diff` from seed if we accept seed editing).
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-self-critique-pipeline.spec.ts` — analogous; iteration plan `[1×self_critique_revise]` from seed.
- [ ] All 3 specs `@evolution` tagged so they run on PRs that touch `evolution/` + nightly. `pipeline-lock` acquired in `beforeAll`, released in `afterAll` (per the existing pattern).
- [ ] Each spec asserts `evolution_runs.status='completed'` within 300s (matches the existing editing spec budget).

### Phase 8: Final verification
- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] `npm run test` (full unit suite)
- [ ] `npm run test:esm`
- [ ] `npm run test:integration` (full integration suite)
- [ ] `npm run test:e2e:critical` (smoke check)
- [ ] `npm run test:e2e:evolution` (3 new specs + existing)
- [ ] `npm run test:hooks`
- [ ] `npm run migration:verify` (Docker postgres on the new cost-calibration migration)
- [ ] `npm run test:gate` (writes `.claude/test-pass.json` for HEAD, unlocking the PR gate)
- [ ] Smoke-test on staging: run each new agent against `federal_reserve_2` with $0.05 budget via `npm run query:staging` to insert a run row + admin trigger.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/reflectAndLocalize.test.ts` — prompt builder, parser, execute() happy + failure paths
- [ ] `evolution/src/lib/core/agents/reflectAndLocalize.invariants.test.ts` — `.execute()` not `.run()`, cost snapshot, partial-detail persistence
- [ ] `evolution/src/lib/core/agents/reflectAndLocalize.property.test.ts` — fast-check fuzzing on parser
- [ ] `evolution/src/lib/core/agents/reflectAndRewriteDiff.test.ts` — analogous
- [ ] `evolution/src/lib/core/agents/reflectAndRewriteDiff.invariants.test.ts` — analogous + `runEditingCycle` called with Mode B
- [ ] `evolution/src/lib/core/agents/reflectAndRewriteDiff.property.test.ts` — analogous
- [ ] `evolution/src/lib/core/agents/selfCritiqueRevise.test.ts` — analogous + high-Elo guidance + lengthCapHit telemetry
- [ ] `evolution/src/lib/core/agents/selfCritiqueRevise.invariants.test.ts` — analogous
- [ ] `evolution/src/lib/core/agents/selfCritiqueRevise.property.test.ts` — analogous
- [ ] `evolution/src/lib/schemas.test.ts` — new enum values, refinement rules
- [ ] `evolution/src/lib/core/agentNames.test.ts` — new labels routed correctly
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — dispatch branches for the 3 new types

### Integration Tests
- [ ] `src/__tests__/integration/evolution-reflect-localize.integration.test.ts` — full pipeline with mocked LLM, variant produced, cost metric written
- [ ] `src/__tests__/integration/evolution-reflect-rewrite-diff.integration.test.ts` — analogous
- [ ] `src/__tests__/integration/evolution-self-critique.integration.test.ts` — analogous

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-reflect-localize-pipeline.spec.ts` — real LLM, `@evolution`, asserts variants + cost + ranking
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-reflect-rewrite-diff-pipeline.spec.ts` — analogous
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-self-critique-pipeline.spec.ts` — analogous
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts` extension — add a wizard test that the 3 new options appear in the agent-type dropdown (lightweight addition to the existing wizard describe block)

### Manual Verification
- [ ] On staging, run each agent against `federal_reserve_2` ($0.05 budget) and visually inspect the invocation detail page for the agent (reflection-rationale + chosen-paragraph for agent 1; focus-area + cycle.appliedCount for agent 2; issues list + chosen-tactic for agent 3).
- [ ] Confirm tactic leaderboard at `/admin/evolution/tactics` shows the three new marker tactics with attribution dimensions.
- [ ] Confirm strategy wizard dropdown surfaces the three new agent types under their intended display names.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Strategy wizard dropdown shows the 3 new agent-type options (covered by extending `admin-evolution-iterative-editing.spec.ts`'s wizard describe block)

### B) Automated Tests
- [ ] `npm run test -- --testPathPattern 'reflectAndLocalize|reflectAndRewriteDiff|selfCritiqueRevise'`
- [ ] `npm run test:integration -- --testPathPattern 'evolution-reflect-localize|evolution-reflect-rewrite-diff|evolution-self-critique'`
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-reflect-localize-pipeline.spec.ts src/__tests__/e2e/specs/09-admin/admin-evolution-reflect-rewrite-diff-pipeline.spec.ts src/__tests__/e2e/specs/09-admin/admin-evolution-self-critique-pipeline.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `evolution/docs/agents/overview.md` — add a section per new agent (mirror the existing `ReflectAndGenerateFromPreviousArticleAgent` / `SinglePassEvaluateCriteriaAndGenerateAgent` sections).
- [ ] `evolution/docs/strategies_and_experiments.md` — extend `IterationConfig.agentType` documentation table with the 3 new types.
- [ ] `evolution/docs/multi_iteration_strategies.md` — extend the iterationConfigSchema enum documentation.
- [ ] `evolution/docs/metrics.md` — add the 3 new umbrella cost metrics + their propagated counterparts to the registry section.
- [ ] `evolution/docs/reference.md` — env var section: add 3 new kill switches.
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — no change (no judge changes).
- [ ] `docs/feature_deep_dives/iterative_planning_agent.md` — no change.
- [ ] `docs/feature_deep_dives/style_fingerprint.md` — no change.

## Review & Discussion
_This section will be populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration._
