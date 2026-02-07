# Iterative Editing Agent Research

## Problem Statement

The evolution pipeline generates many variants and ranks them competitively via Elo, but no agent performs **targeted, critique-driven editing** of the current best variant. The ReflectionAgent produces per-dimension scores (clarity, structure, engagement, precision, coherence) and the MetaReviewAgent synthesizes strategy-level feedback — but no agent reads those critiques and makes *surgical edits* to fix the identified weaknesses. The GenerationAgent creates from scratch, the EvolutionAgent mutates genetically, and the DebateAgent synthesizes from two parents. None take a single variant and iteratively refine it based on specific dimensional feedback.

## High Level Summary

### Current Architecture

The pipeline uses a **PoolSupervisor** managing two phases:
- **EXPANSION** (iterations 0–N): Build diverse pool via GenerationAgent + CalibrationRanker + ProximityAgent
- **COMPETITION** (iterations N+1 to max): Refine pool via GenerationAgent (1 variant/iter) + ReflectionAgent + DebateAgent + EvolutionAgent + Tournament + ProximityAgent + MetaReviewAgent

Agents plug in via the `PipelineAgent` interface (`name`, `execute()`, `canExecute()`). The `PipelineAgents` interface in `core/pipeline.ts` defines named slots (some optional). The supervisor's `PhaseConfig` has boolean flags (`runGeneration`, `runReflection`, etc.) controlling which agents run per phase. Adding a new agent requires:
1. Implement `PipelineAgent`
2. Add optional field to `PipelineAgents`
3. Add `runXxx` flag to `PhaseConfig`
4. Update supervisor's `getPhaseConfig()` to return the flag
5. Conditionally invoke in `executeFullPipeline` iteration loop

### How Variants Are Currently Improved

| Agent | Input | Output | Editing Style |
|-------|-------|--------|---------------|
| **GenerationAgent** | Original text + meta-feedback | 3 variants (structural_transform, lexical_simplify, grounding_enhance) | From scratch — ignores current best |
| **EvolutionAgent** | Top 2 parents by Elo + meta-feedback | Mutate clarity, mutate structure, crossover, creative exploration | Genetic — broad mutations, not targeted |
| **DebateAgent** | Top 2 non-baseline variants + reflection critiques | 1 debate_synthesis variant | Adversarial synthesis — combines two parents |
| **ReflectionAgent** | Top 3 variants | Per-dimension scores + examples + notes → `state.allCritiques` | **Analysis only — no editing** |
| **MetaReviewAgent** | Entire pool + Elo + diversity | `state.metaFeedback` (weaknesses, priorities, strategies) | **Analysis only — no editing** |

**Gap**: No agent takes the specific dimensional critique of a variant (e.g., "clarity: 5/10, 'The phrase X is vague'") and produces a targeted edit addressing *that specific weakness*.

### Existing Editing Pattern Outside Pipeline

`editExplanationPrompt()` in `src/lib/prompts.ts` provides a single-pass targeted editing pattern:
- Takes existing content + topic + rules
- "Make only necessary changes to improve clarity, accuracy, or adherence to rules"
- "Preserve the overall structure and flow"
- "Only modify sections that need improvement"

This is the closest existing pattern to what an iterative editing agent would do, but it's not critique-driven.

### Content Quality Evaluation System

`src/lib/services/contentQualityEval.ts` provides 8-dimension rubric scoring (0–1 scale):
- clarity, structure, engagement, conciseness, coherence, specificity, point_of_view, overall
- Each dimension has calibrated criteria with anchor examples
- Used for post-evolution quality comparison (before/after)

The ReflectionAgent uses 5 of these dimensions (clarity, structure, engagement, precision, coherence) with 1–10 scores.

### Key Infrastructure Available

- **ReflectionAgent output**: `state.allCritiques` contains per-variant, per-dimension scores, good examples, bad examples, and notes. Helper functions: `getCritiqueForVariant()`, `getWeakestDimension()`, `getImprovementSuggestions()`
- **MetaFeedback**: `state.metaFeedback` contains `recurringWeaknesses`, `priorityImprovements`, `successfulStrategies`, `patternsToAvoid`
- **Format enforcement**: `FORMAT_RULES` constant injected into all generation prompts; `validateFormat()` validates output
- **LLM client**: Budget-enforced with per-agent caps and reservation system
- **Cost tracker**: Supports adding new agent names with configurable budget percentage
- **Feature flags**: `core/featureFlags.ts` pattern for toggling agents on/off

### Five Approaches Considered

**Approach A: New IterativeEditingAgent in COMPETITION phase**
- Runs after ReflectionAgent, before Tournament
- Takes top-1 variant + its dimensional critique → makes targeted edits → adds to pool
- Variant competes via Elo like everything else
- Pros: Minimal infra changes, leverages existing Elo competition, feature-flaggable
- Cons: Only 1 edit per iteration, competes with evolutionary variants

**Approach B: REFINEMENT phase (third phase after COMPETITION)**
- After COMPETITION converges, new phase begins
- Focused edit→critique→edit loop on winner only, no competition
- Pros: Dedicated focus, clear quality trajectory
- Cons: New phase complicates supervisor, new stopping conditions needed, extends run time/budget

**Approach C: Replace EvolutionAgent with IterativeEditingAgent**
- Same pipeline slot, critique-driven editing instead of genetic mutation
- Pros: Clean swap, no new infrastructure
- Cons: Loses diversity benefits (creative exploration, crossover)

**Approach D: Add `critique_edit` strategy to EvolutionAgent**
- 4th strategy alongside mutate_clarity, mutate_structure, crossover
- Pros: Smallest code change
- Cons: Mixes metaphors (genetic + critique-driven), limited to 1 variant competing with 3 others

**Approach E: Post-pipeline standalone editing loop**
- Separate from evolution pipeline entirely, runs after winner selection
- Uses contentQualityEval for scoring, custom editing prompt for refinement
- Pros: Simple, independent, no pipeline changes
- Cons: Doesn't benefit from pipeline infrastructure (Elo, budget, checkpoints)

### Recommendation

**Approach A** fits best because:
1. Follows the established agent pattern exactly (implement `PipelineAgent`, add to `PipelineAgents`)
2. Leverages ReflectionAgent output that's already being computed but underutilized
3. Edited variants compete fairly — if targeted edits work, they naturally rise in Elo
4. Feature-flaggable via existing pattern
5. Budget-controlled via existing `budgetCaps` mechanism
6. Checkpointed automatically via existing persistence
7. Minimal changes to supervisor (one new flag in `PhaseConfig`)

---

## Detailed Design: ReflectionAgent Interaction

### Execution Order in COMPETITION Phase

Current order:
```
Generation → Reflection → Debate → Evolution → Tournament → Proximity → MetaReview
```

With IterativeEditingAgent:
```
Generation → Reflection → IterativeEditing → Debate → Evolution → Tournament → Proximity → MetaReview
```

Editing runs right after Reflection to consume fresh critiques, and before Tournament so the edited variant gets ranked in the same iteration.

### Data Flow

```
ReflectionAgent                           IterativeEditingAgent
  reads: top 3 variants by Elo             reads: state.allCritiques (from Reflection)
  writes: state.allCritiques                       top 1 variant by Elo
          state.dimensionScores             writes: state.pool (adds edited variant, if accepted)
```

### Iterative Feedback Loop Across Iterations

`state.allCritiques` is overwritten each iteration by ReflectionAgent (always critiques the current top 3). This naturally creates an iterative editing cycle:

```
Iteration N:   Reflection critiques variant A → Editing fixes A's weakest dimension → A' enters pool
Iteration N+1: Reflection critiques A' (now top) → Editing fixes A''s weakest dimension → A'' enters pool
Iteration N+2: Reflection critiques A'' → Editing fixes next weakness → A''' enters pool
```

No cross-iteration state needed — the overwrite-per-iteration behavior means the editing agent always works from the freshest dimensional assessment.

### Existing Helper Functions (Currently Unused)

ReflectionAgent exports three helpers designed for downstream consumption:

| Helper | Signature | Returns |
|--------|-----------|---------|
| `getCritiqueForVariant(variationId, state)` | `(string, PipelineState) → Critique \| null` | Full critique for a specific variant |
| `getWeakestDimension(critique)` | `(Critique) → string \| null` | Name of lowest-scoring dimension |
| `getImprovementSuggestions(critique)` | `(Critique) → string[]` | Suggestions from dimensions scoring <7 |

These are the natural building blocks for the editing agent.

### Differentiation from Other Agents

| Agent | How it uses critiques | What it produces |
|-------|----------------------|------------------|
| **DebateAgent** | Critiques as *context for advocate arguments* (broad comparison) | Synthesis of two variants |
| **EvolutionAgent** | Only `metaFeedback.priorityImprovements` (generic guidance) | Genetic mutations/crossover |
| **IterativeEditingAgent** | Actual dimensional scores + bad examples (surgical) | Targeted fix of specific weakness |

### canExecute Guard

```typescript
canExecute(state: PipelineState): boolean {
  if (!state.allCritiques || state.allCritiques.length === 0) return false;
  const top = state.getTopByElo(1)[0];
  if (!top) return false;
  return getCritiqueForVariant(top.id, state) !== undefined;
}
```

Gracefully skips if ReflectionAgent was disabled, failed, or didn't critique the top variant.

---

## Detailed Design: Self-Gated Editing with LLM-as-Judge

### Problem with Ungated Editing

If the editing agent blindly adds every edit to the pool, bad edits pollute the pool. They'll eventually sink in Elo, but that wastes tournament budget ranking variants that should never have entered. Worse, a "targeted fix" for clarity could regress structure — the editing agent wouldn't know.

### Solution: Diff-Based LLM-as-Judge Gate

Instead of showing the judge two full articles and asking "which is better?", we generate a **diff** showing exactly what changed, and ask the judge to evaluate whether the changes should be accepted or rejected. This is more efficient and more precise for targeted edits where only a small portion of the text changes.

**Critical design constraints**:

1. **Blind**: The judge does not know which dimension was targeted, what the critique said, or why the changes were made. It sees only the diff and surrounding context.
2. **Holistic**: The judge evaluates whether the changes improve the article *as a whole* — not just the targeted dimension. If improving clarity harmed structure, the changes should be rejected.
3. **Independent**: The judge call is a completely separate LLM invocation from the editing call. Different prompt, different purpose, no shared context.

### Why Diff > Full Article Comparison

| Aspect | Full Article (A vs B) | Diff-Based |
|--------|----------------------|------------|
| Judge reads | Two complete articles (99% identical for targeted edits) | Only the changes + surrounding context |
| Focus | Diffuse — judge must spot subtle changes in a sea of identical text | Precise — judge evaluates exactly what changed |
| Cost | Higher token count (2× full article) | Lower token count (diff is much shorter) |
| Regression detection | Judge may not notice a subtle regression buried in unchanged text | Judge sees every change explicitly — nothing hidden |
| Bias | Positional bias (A vs B ordering) | Direction bias (accept vs reject framing) |

### Existing Diff Infrastructure

The codebase already has production diff infrastructure:

- **`diff` npm package** (`^8.0.2`) — installed, used in article bank and evolution compare UI
- **`RenderCriticMarkupFromMDAstDiff()`** in `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` — sophisticated multi-pass diff (paragraph → sentence → word) producing CriticMarkup: `{--deleted--}`, `{++inserted++}`, `{~~before~>after~~}`
- **`diffWordsWithSpace()`** — simpler word-level diff, used in admin UI components

For the LLM judge, `RenderCriticMarkupFromMDAstDiff()` is ideal: it produces a single document with changes marked inline using CriticMarkup, preserving full context around each change. LLMs understand CriticMarkup well.

### Diff Comparison Prompt

```
You are an expert writing evaluator. The following article contains proposed changes
marked with CriticMarkup notation:

- {--deleted text--} = text that would be removed
- {++inserted text++} = text that would be added
- {~~old text~>new text~~} = text that would be replaced

## Article with Proposed Changes
[CriticMarkup diff output]

## Evaluation Criteria
Consider whether the proposed changes, taken as a whole:
- Improve or harm clarity and readability
- Improve or harm structure and flow
- Improve or harm engagement and impact
- Improve or harm grammar and style
- Improve or harm overall effectiveness

## Instructions
Respond with ONLY one of these exact answers:
- "ACCEPT" if the changes improve the article overall
- "REJECT" if the changes harm the article overall
- "UNSURE" if the changes are neutral or have mixed effects
```

### Bias Mitigation via Direction Reversal

Like the existing A/B comparison, the diff judge runs **two passes** — but instead of swapping text positions, it reverses the **diff direction**:

- **Pass 1**: Diff from original → edited (deletions are original text, insertions are edited text)
  - "Should these changes be accepted?"
- **Pass 2**: Diff from edited → original (the reverse — what was inserted becomes deleted, vice versa)
  - "Should these changes be accepted?"

**Interpreting the two passes:**

| Pass 1 | Pass 2 | Meaning | Result | Confidence |
|--------|--------|---------|--------|------------|
| ACCEPT | REJECT | Consistent: forward edit good, reverse edit bad → edit improves article | **ACCEPT** | 1.0 |
| REJECT | ACCEPT | Consistent: forward edit bad, reverse edit good → edit harms article | **REJECT** | 1.0 |
| ACCEPT | ACCEPT | Inconsistent: judge says yes to both directions → framing bias | **UNSURE** | 0.5 |
| REJECT | REJECT | Inconsistent: judge says no to both directions → framing bias | **UNSURE** | 0.5 |
| UNSURE | any | One pass uncertain | **UNSURE** | 0.3 |
| any | UNSURE | One pass uncertain | **UNSURE** | 0.3 |

This catches **accept bias** (judge rubber-stamps any change) and **reject bias** (judge rejects any change) — both result in UNSURE rather than a false positive/negative.

### New Comparison Function

```typescript
export interface DiffComparisonResult {
  verdict: 'ACCEPT' | 'REJECT' | 'UNSURE';
  confidence: number;
  changesFound: number;
}

export async function compareWithDiff(
  textBefore: string,
  textAfter: string,
  callLLM: (prompt: string) => Promise<string>,
  cache?: Map<string, DiffComparisonResult>,
): Promise<DiffComparisonResult>
```

Uses `RenderCriticMarkupFromMDAstDiff()` to generate the CriticMarkup diff, then runs the 2-pass direction reversal.

### Architectural Separation (Updated)

```
┌─────────────────────────┐     ┌─────────────────────────┐
│   EDITING PROMPT         │     │   DIFF JUDGE PROMPT      │
│                         │     │                         │
│ Knows: target dimension │     │ Knows: NOTHING about    │
│ Knows: critique details │     │   what was targeted     │
│ Knows: bad examples     │     │   why changes were made │
│ Knows: parent variant   │     │                         │
│                         │     │ Sees: CriticMarkup diff │
│ Goal: fix weakness      │     │   showing exact changes │
│ Model: generationModel  │     │   with full context     │
│                         │     │                         │
│                         │     │ Goal: do these changes  │
│                         │     │   improve the article   │
│                         │     │   OVERALL?              │
│                         │     │ Model: judgeModel       │
└────────┬────────────────┘     └────────┬────────────────┘
         │ produces edited text           │ evaluates diff blind
         │                               │
         └──────────── NO shared context ─┘
```

### Self-Gated Edit Loop with Re-Evaluation (Within One Agent Execution)

The agent runs a self-contained **evaluate → edit → re-evaluate → edit** cycle. After each accepted edit, it re-runs both rubric critique and open-ended review on the new text, so each successive edit targets the current weakest aspect — not a stale assessment from before the previous edit.

```
1. EVALUATE V₀ (initial assessment):
   a. Rubric critique: use existing ReflectionAgent output from state.allCritiques
      (already computed this iteration — no extra LLM call)
   b. Open-ended review: 1 generationModel call
      "Read this article. What 2-3 improvements would make it meaningfully better?"
   c. Combine both → pick highest-impact edit target

2. EDIT cycle 1:
   a. EDIT: Generate V₁ targeting chosen weakness (1 generationModel call)
   b. Validate format (validateFormat)
   c. JUDGE: compareWithDiff(V₀.text, V₁.text) (2 judgeModel calls)
      - Prompt includes: CriticMarkup diff showing exact changes + generic quality criteria
      - Prompt does NOT include: dimension name, critique, editing intent
   d. If verdict = ACCEPT → accept: current = V₁
   e. If verdict = REJECT or UNSURE → reject: current stays V₀

3. RE-EVALUATE current text (fresh assessment after edit):
   a. Rubric critique: inline call using same prompt as ReflectionAgent (1 generationModel call)
   b. Open-ended review: 1 generationModel call
   c. Check stopping conditions (see below)
   d. Combine both → pick next edit target

4. EDIT cycle 2:
   a. EDIT: Generate V₂ targeting new weakness (1 generationModel call)
   b. Validate format
   c. JUDGE: compareWithDiff(current.text, V₂.text) (2 judgeModel calls)
   d. Accept (ACCEPT) or reject (REJECT/UNSURE)

5. RE-EVALUATE again → stop or continue for cycle 3...

6. Add final accepted version to pool (or nothing if all edits rejected)
```

**Why re-evaluate after each edit:**
- Fixing clarity might reveal a structure issue that was previously masked
- Fixing structure might improve coherence as a side effect (no need to target it)
- Open-ended review on the new text catches emergent issues the rubric misses
- The agent targets the **actual** current weakest aspect, not a stale one

**Stopping conditions within the agent:**
1. **Max cycles reached** (default: 3)
2. **Quality threshold met**: All rubric dimensions ≥ 8 AND open review finds no major issues
3. **Consecutive rejections**: 3 edits rejected in a row by the judge → stop
4. **Budget exhausted**: BudgetExceededError from CostTracker

Key properties:
- **Information barrier**: The edit prompt knows the target; the judge prompt does not. Zero context shared between editing and judging calls.
- **Holistic regression detection**: The judge evaluates clarity AND structure AND engagement AND grammar AND overall effectiveness. An edit that fixes clarity but breaks structure will be caught.
- **Fresh evaluation per cycle**: Each edit is followed by re-critique, so the next edit addresses the current state — not stale feedback from before the previous edit.
- **Two feedback sources**: Rubric critique (structured, per-dimension scores) + open-ended review (freeform, catches issues outside the rubric)
- **Positional bias mitigated**: 2-pass reversal ensures the judge isn't biased by presentation order
- **No pool pollution**: Only edits that pass the blind holistic judge survive. If all edits are rejected, nothing enters the pool.

### Acceptance Policy

With the diff-based judge, the ternary outcome maps cleanly:

| Verdict | Meaning | Action |
|---------|---------|--------|
| **ACCEPT** | Both passes agree the edit improves the article | Accept edit, chain to next cycle |
| **REJECT** | Both passes agree the edit harms the article | Reject, increment consecutive rejections |
| **UNSURE** | Passes disagree (framing bias detected) or one pass uncertain | Reject — treat as insufficient evidence of improvement |

UNSURE is treated as rejection because the edit should demonstrably improve the article to enter the pool. Ambiguous edits waste tournament budget.

```typescript
// Acceptance logic
const result = await compareWithDiff(current.text, edited.text, callLLM, cache);
const accepted = result.verdict === 'ACCEPT';
```

### Cost Model

Per edit cycle (evaluate + edit + judge):
- 1 rubric critique (generationModel) ≈ $0.01 (skipped for cycle 1 — uses ReflectionAgent output)
- 1 open-ended review (generationModel) ≈ $0.01
- 1 edit generation (generationModel) ≈ $0.01
- 2 judge calls (judgeModel: `gpt-4.1-nano`) ≈ $0.001
- **Per cycle: ~$0.031** (cycle 1: ~$0.021 since rubric is free)

Per agent execution (assuming 2 cycles, both accepted):
- Cycle 1: $0.021 (open review + edit + judge; rubric reused from ReflectionAgent)
- Cycle 2: $0.031 (inline rubric + open review + edit + judge)
- **Total: ~$0.052 per pipeline iteration**

For comparison:
- EvolutionAgent: 3 generation calls ≈ $0.03
- DebateAgent: 4 sequential calls ≈ $0.04
- CalibrationRanker: 10+ judge calls ≈ $0.005

More expensive than other agents but produces higher-quality targeted edits with independent validation.

### Budget Cap

Suggested: 10% of total budget, with budget cap key `iterativeEditing: 0.10`.

At $5.00 total budget → $0.50 for iterative editing → ~9 pipeline iterations at $0.052/iter. Since COMPETITION typically runs 7–12 iterations, this is sufficient with some headroom for 3-cycle executions.

### Variant Metadata

Accepted edits create variants with:
```typescript
{
  id: crypto.randomUUID(),
  text: editedText,
  version: parentVariant.version + 1,
  parentIds: [parentVariant.id],
  strategy: 'critique_edit_<dimension>',  // e.g., 'critique_edit_clarity'
  createdAt: Date.now(),
  iterationBorn: state.iteration,
}
```

The strategy name encodes which dimension was targeted, enabling MetaReviewAgent to track editing effectiveness per dimension.

### Feature Flag

Add `evolution_iterative_editing_enabled` to the feature flags system:

| Flag | Default | Effect |
|------|---------|--------|
| `evolution_iterative_editing_enabled` | `true` | When `false`, IterativeEditingAgent skipped in COMPETITION |

### Comparison with Existing Gating Patterns

This gating pattern is **novel** in the pipeline — no other agent self-gates. But it follows a well-established pattern in LLM research:
- Constitutional AI: generate → judge → filter
- Best-of-N sampling: generate N → compare → keep best
- RLHF reward modeling: generate → score → select

The key difference is that our gate uses the *same* bias-mitigated comparison that the tournament uses, so the quality bar is consistent across the pipeline.

## Documents Read
- `docs/docs_overall/getting_started.md` — documentation structure and reading order
- `docs/docs_overall/architecture.md` — system design, data flow, tech stack
- `docs/docs_overall/project_workflow.md` — project workflow steps
- `docs/feature_deep_dives/evolution_pipeline.md` — full pipeline documentation
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — dashboard and visualization

## Code Files Read

### Agent Framework
- `src/lib/evolution/agents/base.ts` — AgentBase abstract class (execute, estimateCost, canExecute)
- `src/lib/evolution/types.ts` — TextVariation, PipelineState, AgentResult, ExecutionContext, Match, Critique, MetaFeedback, DebateTranscript, EvolutionLLMClient, CostTracker interfaces
- `src/lib/evolution/config.ts` — DEFAULT_EVOLUTION_CONFIG, resolveConfig, ELO_CONSTANTS, K_SCHEDULE
- `src/lib/evolution/index.ts` — public API exports

### Pipeline Orchestration
- `src/lib/evolution/core/pipeline.ts` — executeMinimalPipeline, executeFullPipeline, PipelineAgents interface, PhaseConfig, runAgent, persistCheckpoint
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor, detectPhase, beginIteration, getPhaseConfig, shouldStop, phase transition logic
- `src/lib/evolution/core/state.ts` — PipelineStateImpl, addToPool, getTopByElo, serializeState, deserializeState

### Content-Producing Agents
- `src/lib/evolution/agents/generationAgent.ts` — 3 strategies (structural_transform, lexical_simplify, grounding_enhance), prompt patterns, meta-feedback integration
- `src/lib/evolution/agents/evolvePool.ts` — mutation (clarity/structure), crossover, creative exploration, stagnation detection
- `src/lib/evolution/agents/reflectionAgent.ts` — 5-dimension critique (clarity, structure, engagement, precision, coherence), getCritiqueForVariant, getWeakestDimension, getImprovementSuggestions helpers
- `src/lib/evolution/agents/debateAgent.ts` — 4-turn debate (Advocate A, Advocate B, Judge, Synthesis), critique context integration

### Ranking & Comparison
- `src/lib/evolution/comparison.ts` — `compareWithBiasMitigation(textA, textB, callLLM, cache?) → ComparisonResult {winner, confidence, turns}`, `buildComparisonPrompt()`, `parseWinner()`, 2-pass A/B reversal, order-invariant SHA-256 caching
- `src/lib/evolution/agents/calibrationRanker.ts` — stratified opponents, batched calibration, early exit
- `src/lib/evolution/agents/tournament.ts` — Swiss-style pairing, information-gain scoring, budget pressure adaptation, multi-turn tiebreakers
- `src/lib/evolution/core/elo.ts` — Elo math, adaptive K-factor, confidence-weighted updates, draw handling

### Infrastructure
- `src/lib/evolution/core/llmClient.ts` — budget-enforced LLM wrapper, complete() and completeStructured(), token estimation
- `src/lib/evolution/core/costTracker.ts` — per-agent budget caps, reservation system, optimistic locking
- `src/lib/evolution/agents/formatRules.ts` — FORMAT_RULES constant (H1 title, section headings, no bullets/lists/tables, 2+ sentence paragraphs)
- `src/lib/evolution/agents/formatValidator.ts` — validateFormat() with reject/warn/off modes

### Feedback & Diversity
- `src/lib/evolution/agents/metaReviewAgent.ts` — pure-computation analysis: strategy effectiveness, weakness detection, priority improvements
- `src/lib/evolution/agents/proximityAgent.ts` — cosine similarity, sparse matrix, diversity score

### Diff Infrastructure
- `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` — `RenderCriticMarkupFromMDAstDiff()`, multi-pass diff (paragraph → sentence → word), CriticMarkup output (`{--del--}`, `{++ins++}`, `{~~old~>new~~}`)
- `package.json` — `diff: ^8.0.2`, `@types/diff: ^7.0.2` (already installed)
- `docs/feature_deep_dives/markdown_ast_diffing.md` — multi-pass algorithm docs

### Existing Editing Patterns
- `src/lib/prompts.ts` — editExplanationPrompt() (single-pass targeted editing), createExplanationPrompt(), createExplanationWithSourcesPrompt()
- `src/lib/services/returnExplanation.ts` — generateNewExplanation() orchestration, postprocessing pipeline
- `src/lib/services/contentQualityEval.ts` — 8-dimension rubric scoring, buildEvalPrompt()
- `src/lib/services/contentQualityCriteria.ts` — dimension criteria with anchor examples
- `src/lib/services/evolutionActions.ts` — applyWinnerAction, rollbackEvolutionAction, queue/trigger actions
