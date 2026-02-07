# Outline Based Generation Editing Plan

## Process Reward Models (Step-Level Feedback)

**Current approach**: Score the final text variant as a whole.

**New approach**: Decompose generation into steps (outline → expand → polish → verify) and score *each step* independently. A variant might have excellent structure (step 1 score: 0.95) but weak examples (step 3 score: 0.4).

**Why it matters**: Instead of randomly mutating the whole text, you can surgically target weak steps. "Step 3 is weak, only mutate that." This produces 40-60% faster convergence because mutations are focused, not random.

---

## Background

The evolution pipeline currently generates full article text in a single monolithic LLM call via GenerationAgent (3 strategies: structural_transform, lexical_simplify, grounding_enhance). Quality feedback comes from ReflectionAgent scoring 5 dimensions on the final text, and IterativeEditingAgent surgically editing the weakest dimension. This whole-text approach means mutations are untargeted — even when the structure is excellent, the entire text gets regenerated from scratch.

The initial article generation pipeline (`returnExplanation.ts`) also uses a single-shot prompt: query → title → full content in one call. There is no intermediate outline, no section-by-section expansion, and no step-level quality scoring anywhere in the system.

## Problem

The current pipeline wastes budget by re-generating entire articles when only specific aspects are weak. A variant with great structure but weak examples gets fully regenerated via `structural_transform` or `lexical_simplify` — strategies that may damage the strong structure while not even addressing the weak examples. The ReflectionAgent's 5-dimensional critique identifies *what* is weak (e.g., precision: 4/10) but not *which generation step* produced the weakness.

Without decomposed generation, the system cannot: (1) reuse strong intermediate outputs across variants, (2) target mutations to specific generation steps, or (3) measure which step in the generation process most needs improvement. This leads to slower convergence, wasted LLM budget on regenerating already-good content, and inability to diagnose systemic generation failures.

## Options Considered

### Option A: New OutlineGenerationAgent (Minimal — Recommended)

Add a single new agent that generates an outline first, then expands section-by-section. Each step scored independently. Plugs into existing pipeline alongside GenerationAgent.

- **Pros**: Minimal changes, uses existing AgentBase framework, optional (can be feature-flagged), doesn't break existing strategies
- **Cons**: Two generation paths to maintain, outline format needs new validation

### Option B: Replace GenerationAgent with Multi-Step Pipeline

Replace the monolithic GenerationAgent with a 4-step internal pipeline: outline → expand → polish → verify. All variants go through this process.

- **Pros**: Uniform approach, all variants benefit from step-level scoring
- **Cons**: Breaking change, higher risk, harder to A/B test against current approach, may slow down EXPANSION phase

### Option C: Outline as Intermediate Representation Only

Generate outlines but don't persist them — use them only as internal scaffolding during generation. No step-level scoring.

- **Pros**: Simpler, no new data structures
- **Cons**: Loses the key benefit (step-level feedback), can't target mutations to steps

### Decision: Option A

Option A provides the core PRM benefits while being safe to ship incrementally. The new agent runs alongside existing agents — if outlines produce better variants, they'll win in the tournament. We can measure effectiveness via the existing Elo system before deciding whether to make it the default.

## Rollback Strategy

**Feature flag gating**: `evolution_outline_generation_enabled` defaults to `false`. All outline code is completely inert when the flag is off. Rollback = set flag to `false` in the database. No code deploy needed.

**Backward-compatible serialization**: `OutlineVariant` extends `TextVariation` with optional step fields. Old checkpoints load normally — `steps` defaults to `[]`, `weakestStep` defaults to `null`. A `isOutlineVariant(v: TextVariation)` type guard checks for the presence of the `steps` array.

**Budget isolation**: Outline agent has its own budget cap key (`outlineGeneration: 0.10`). If disabled, its budget redistributes to other agents automatically (existing CostTracker behavior).

---

## Prompt Injection Mitigation

All LLM calls in the outline pipeline use the existing `EvolutionLLMClient` which wraps model calls. To mitigate prompt injection from user-provided `originalText`:

1. **Delimiter fencing**: Wrap `originalText` in markdown section delimiters (`## Original Text\n{text}`) in all prompts, matching the actual pattern in `generationAgent.ts` (line 28) and `iterativeEditingAgent.ts`.
2. **Score validation**: All step scores are parsed with `parseFloat()` + clamp to `[0, 1]`. If the LLM returns non-numeric output for scoring, the step score defaults to `0.5` (neutral) and a warning is logged.
3. **Step output validation**: Each step uses step-specific length thresholds: outline output must be 5-30% of input length (outlines are summaries), expand output must be 70-150% of originalText length, polish output must be 80-120% of expand output length. Failed validation triggers a retry (max 1 retry) before falling back.

---

## Error Handling & Partial Failures

Each step in the outline pipeline can fail independently. The strategy:

1. **Outline step fails**: Fall back to monolithic generation (delegate to `GenerationAgent` strategy). Log warning.
2. **Expand step fails**: Use the raw outline as the variant text (low quality but recoverable). Score will be low, variant will lose in tournament.
3. **Polish step fails**: Use the expanded (unpolished) text as the variant. Still a valid variant.
4. **Score step fails**: Default to `0.5` for that step's score. Log warning. Variant still enters pool.
5. **Budget exceeded mid-pipeline**: Abort and return whatever partial variant exists. Set `costUsd` on the variant for accurate attribution.

**Cost tracking for failures**: Cost tracking is **automatic** via `EvolutionLLMClient.complete()`, which records costs internally via the `callLLM` callback (see `llmClient.ts`). The agent does NOT manually call `costTracker.recordSpend()` — this would cause double-counting. Instead, the agent simply calls `llmClient.complete()` for each step. Even if a step fails, any LLM cost incurred before the failure is automatically recorded. The agent accumulates `costUsd` locally (summing `cost` from each `complete()` response) only for setting `OutlineVariant.costUsd` on the final variant for per-variant attribution.

**Score validation consistency**: All 3 score steps use an identical `parseStepScore(rawOutput: string): number` helper that applies: `const parsed = parseFloat(rawOutput); return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.5;`. This ensures consistent validation across all score steps.

All failures are logged via `EvolutionLogger` and do not crash the pipeline.

---

## Phased Execution Plan

### Phase 1: Step Types & Scoring Infrastructure

**Goal**: Define the generation steps, their scoring interface, and the data structures to persist step-level scores.

**Files to modify**:
- `src/lib/evolution/types.ts` — Add `GenerationStep`, `OutlineVariant` interfaces and `isOutlineVariant()` type guard

**Note**: All types go in the existing `types.ts` file per established pattern. No separate `outlineTypes.ts` file — existing agents (GenerationAgent, EvolutionAgent, etc.) all define their types in `types.ts`.

**Key types**:
```typescript
type GenerationStepName = 'outline' | 'expand' | 'polish' | 'verify';

interface GenerationStep {
  name: GenerationStepName;
  input: string;    // input to this step
  output: string;   // output of this step
  score: number;    // 0-1, from step-level judge (default 0.5 on parse failure)
  costUsd: number;  // LLM cost for this step
}

/** Extends TextVariation — all existing TextVariation fields preserved for pool compatibility. */
interface OutlineVariant extends TextVariation {
  steps: GenerationStep[];        // ordered step history
  outline: string;                // the outline text (section headings + summaries)
  weakestStep: GenerationStepName | null;  // cached for mutation targeting
}

/** Type guard for runtime checks — pool contains both TextVariation and OutlineVariant. */
function isOutlineVariant(v: TextVariation): v is OutlineVariant {
  const candidate = v as OutlineVariant;
  return Array.isArray(candidate.steps) && candidate.steps.length > 0 && 'name' in candidate.steps[0];
}
```

**Serialization compatibility**: `SerializedPipelineState.pool` is typed as `TextVariation[]`. Since `OutlineVariant extends TextVariation`, outline variants serialize naturally into the pool array. The extra fields (`steps`, `outline`, `weakestStep`) are preserved as JSON. On deserialization, use `isOutlineVariant()` to distinguish them. Old checkpoints without outline variants load normally — no migration needed.

**Tests**:
- Unit tests for `isOutlineVariant()` type guard (true for OutlineVariant, false for plain TextVariation)
- Serialization round-trip: create OutlineVariant → serialize to JSON → deserialize → verify steps preserved
- Backward compat: deserialize old checkpoint (no outline variants) → verify no errors

### Phase 2: Outline Generation Agent

**Goal**: Implement `OutlineGenerationAgent` that produces variants via outline → expand → polish, with per-step scoring.

**Files to create**:
- `src/lib/evolution/agents/outlineGenerationAgent.ts` — New agent extending `AgentBase` (from `./base.ts`)
- `src/lib/evolution/agents/outlineGenerationAgent.test.ts` — Unit tests

**Agent interface** (following existing pattern from `AgentBase`):
```typescript
class OutlineGenerationAgent extends AgentBase {
  readonly name = 'outlineGeneration';

  execute(ctx: ExecutionContext): Promise<AgentResult>;
  estimateCost(payload: AgentPayload): number;
  canExecute(state: PipelineState): boolean;
}
```

**`estimateCost()` implementation** (following token-based pattern from GenerationAgent):
```typescript
estimateCost(payload: AgentPayload): number {
  const textTokens = Math.ceil(payload.originalText.length / 4);
  const promptOverhead = 200;
  const inputTokens = textTokens + promptOverhead;
  const outputTokens = textTokens;
  const costPerCall = (inputTokens / 1_000_000) * 0.0004 + (outputTokens / 1_000_000) * 0.0016;
  // 6 LLM calls: outline + score + expand + score + polish + score
  return costPerCall * 6;
}
```

**`canExecute()` implementation**: Returns `true` when feature flag `outlineGenerationEnabled` is `true` AND `state.originalText.length > 0` (matching existing GenerationAgent pattern). Budget enforcement is handled separately by `CostTracker.reserveBudget()` during `execute()`, which throws `BudgetExceededError` if the agent's cap is exhausted. This follows the existing pattern — no existing agent checks budget in `canExecute()` because `AgentBase.canExecute(state)` has no access to `CostTracker`.

**Agent execution flow**:
1. **Outline step**: LLM generates section outline (headings + 1-2 sentence summaries per section) from `originalText`. Input wrapped in `## Original Text` markdown section delimiter.
2. **Score outline**: LLM judges outline quality (structure, coverage, logical flow) → parse float, clamp to [0,1], default 0.5 on failure.
3. **Expand step**: LLM expands all sections into full prose, guided by outline.
4. **Score expansion**: LLM judges expansion quality (detail, examples, grounding) → same parsing.
5. **Polish step**: LLM polishes full text (transitions, flow, consistency).
6. **Score polish**: LLM judges polish quality (readability, coherence) → same parsing.
7. **Verify step** (no LLM call): Format check via existing `formatValidator.ts` + length check + outline adherence check (all sections present).
8. Compute `weakestStep` = step with lowest score. Create `OutlineVariant` with all steps recorded. **Critical**: Set `variant.text = polishedText` (the final output of step 5). The `outline` field stores the intermediate outline from step 1. Tournament/calibration agents compare variants by `.text`, so it must contain the final polished text. Set `strategy: 'outline_generation'`, add to pool.

**Prompt functions** (defined inline in `outlineGenerationAgent.ts`, following existing pattern — GenerationAgent, IterativeEditingAgent, EvolutionAgent all keep prompts inline):
- `buildOutlinePrompt(originalText: string): string`
- `buildOutlineScorePrompt(outline: string, originalText: string): string`
- `buildExpandPrompt(outline: string, originalText: string): string`
- `buildExpansionScorePrompt(expandedText: string, outline: string): string`
- `buildPolishPrompt(expandedText: string, outline: string): string`
- `buildPolishScorePrompt(polishedText: string, expandedText: string): string`

**LLM model**: Uses `config.generationModel` (same as GenerationAgent) for generation steps, `config.judgeModel` for scoring steps — matching existing separation between generation and judging.

**Budget**: 6 LLM calls per variant (3 generation + 3 scoring). Budget cap fraction: `outlineGeneration: 0.10` in config. This reduces existing `generation` from `0.25` to `0.20` (still generous for 3 monolithic strategies) and `evolution` from `0.15` to `0.10`. Total remains `1.00`.

**Tests** (using existing mock pattern from `calibrationRanker.test.ts` — queue-based `mockImplementation`):
- Mock LLM client using queue-based approach: `const responses = [...]; let i = 0; complete: jest.fn().mockImplementation(() => Promise.resolve(responses[i++]))`
- Test `execute()` full flow: verify 6 LLM calls made, OutlineVariant returned with correct steps/scores
- Test `canExecute()`: returns false when flag off, true when flag on + originalText present (budget enforcement is separate via CostTracker)
- Test `estimateCost()`: verify token-based calculation matches expected value
- Test error handling: LLM returns empty string → fallback behavior
- Test score parsing: LLM returns "0.8/1" → parsed to 0.8; returns "great" → defaults to 0.5

### Phase 3: Step-Targeted Mutation

**Goal**: When the IterativeEditingAgent or EvolutionAgent encounters an OutlineVariant, target mutations to the weakest step instead of the whole text.

**Files to modify**:
- `src/lib/evolution/agents/iterativeEditingAgent.ts` — Add step-aware branch in `pickEditTarget()`
- `src/lib/evolution/agents/evolvePool.ts` — Add step-aware mutation strategy

**How step-targeting integrates with existing `pickEditTarget()`**:

The current `pickEditTarget(critique, openReview)` builds an `EditTarget[]` array from `Critique.dimensionScores` (dimensions scoring below `qualityThreshold`, sorted weakest-first). It returns `EditTarget { dimension?, description, score?, badExamples?, notes? }`.

**Signature change**: Add a third parameter `variant: TextVariation` to `pickEditTarget()`. The caller at line 81 (`iterativeEditingAgent.ts`) already has access to the current variant (`current`), so the call becomes `pickEditTarget(currentCritique, openReview, current)`.

For OutlineVariants, we add a **new code path before the existing logic**:

```typescript
// NEW: If the variant is an OutlineVariant, add step-based targets first
if (isOutlineVariant(variant) && variant.weakestStep) {
  const stepScore = variant.steps.find(s => s.name === variant.weakestStep)?.score ?? 0;
  const stepTarget: EditTarget = {
    dimension: `step:${variant.weakestStep}`,
    description: `Re-generate the ${variant.weakestStep} step (score: ${stepScore})`,
    score: stepScore,
  };
  targets.unshift(stepTarget); // highest priority
}
// EXISTING: Then add dimension-based targets from Critique as fallback
```

The `dimension` field uses a `step:` prefix to distinguish step-based targets from dimension-based targets.

**`buildEditPrompt()` step-detection logic**: Add a branch at the top of `buildEditPrompt()`:

```typescript
function buildEditPrompt(text: string, target: EditTarget): string {
  // NEW: Step-targeted prompt for OutlineVariants
  if (target.dimension?.startsWith('step:')) {
    const stepName = target.dimension.slice(5); // 'outline', 'expand', or 'polish'
    return `You are a writing expert. The ${stepName} step of this article scored ${target.score}/1.

## Task
Re-generate ONLY the ${stepName} step to improve quality. Keep all other aspects unchanged.

## Original Text
${text}

## Instructions
${stepName === 'outline' ? 'Create a better section outline with improved structure, coverage, and logical flow.' :
  stepName === 'expand' ? 'Expand the outline sections into better prose with stronger examples, details, and grounding.' :
  'Polish the text for better readability, transitions, flow, and coherence.'}

Output ONLY the improved text, no explanations.`;
  }
  // EXISTING: dimension-based prompt logic unchanged
```

**Step-targeted edit behavior**:
- If `dimension` starts with `step:outline` → regenerate outline from originalText, then re-expand and re-polish (3 LLM calls)
- If `dimension` starts with `step:expand` → re-expand using existing outline, then re-polish (2 LLM calls)
- If `dimension` starts with `step:polish` → re-polish using existing expanded text (1 LLM call)

The edited variant is a new `OutlineVariant` with updated steps and recalculated `weakestStep`.

**EvolutionAgent changes** (`evolvePool.ts`):
- `buildMutationPrompt()` checks `isOutlineVariant(parent)`. If true, mutates the `outline` field first, then re-expands. Strategy name: `'mutate_outline'`.
- Add `'mutate_outline'` → `'outlineGeneration'` to `STRATEGY_TO_AGENT` map in `pipeline.ts` for cost attribution.

**Tests**:
- `pickEditTarget()` with OutlineVariant input → returns step-based EditTarget
- `pickEditTarget()` with regular TextVariation → unchanged behavior (regression test)
- `buildEditPrompt()` with `step:expand` dimension → generates expand-specific prompt
- EvolutionAgent mutation with OutlineVariant parent → produces new OutlineVariant with `mutate_outline` strategy

### Phase 4: Pipeline Integration & Feature Flag

**Goal**: Wire OutlineGenerationAgent into the pipeline supervisor and gate behind a feature flag.

**Files to modify**:
- `src/lib/evolution/core/pipeline.ts` — Add `outlineGeneration` to `PipelineAgents` interface and `STRATEGY_TO_AGENT` map
- `src/lib/evolution/core/supervisor.ts` — Add `runOutlineGeneration` to `PhaseConfig` interface, update `getPhaseConfig()` for both phases
- `src/lib/evolution/core/featureFlags.ts` — Add flag to `EvolutionFeatureFlags` interface and `FLAG_MAP`
- `src/lib/evolution/config.ts` — Add `outlineGeneration: 0.10` to `DEFAULT_EVOLUTION_CONFIG.budgetCaps`, adjust existing caps
- `src/lib/evolution/index.ts` — Export `OutlineGenerationAgent`, `OutlineVariant`, `GenerationStep`, `isOutlineVariant`

**Specific changes**:

1. **`pipeline.ts`** — Add to `PipelineAgents` interface:
```typescript
export interface PipelineAgents {
  // ... existing agents ...
  outlineGeneration?: PipelineAgent;  // optional, like iterativeEditing/debate
}
```
Add to `STRATEGY_TO_AGENT` map:
```typescript
outline_generation: 'outlineGeneration',
mutate_outline: 'outlineGeneration',
```
Add conditional execution: `if (config.runOutlineGeneration && agents.outlineGeneration) { await runAgent(...) }`

2. **`supervisor.ts`** — Add `runOutlineGeneration: boolean` to `PhaseConfig` interface (line 17-29). Update `getPhaseConfig()`:
  - EXPANSION phase: `runOutlineGeneration: false` (outline agent only runs in COMPETITION)
  - COMPETITION phase: `runOutlineGeneration: flags.outlineGenerationEnabled` (gated by feature flag)

3. **`featureFlags.ts`** — Add to `EvolutionFeatureFlags`:
```typescript
/** Whether the OutlineGenerationAgent runs in COMPETITION phase. */
outlineGenerationEnabled: boolean;
```
Add to `FLAG_MAP`:
```typescript
evolution_outline_generation_enabled: 'outlineGenerationEnabled',
```
Add to `DEFAULT_EVOLUTION_FLAGS`:
```typescript
outlineGenerationEnabled: false,
```

4. **`config.ts`** — Adjust `budgetCaps` (total remains 1.00):
```typescript
budgetCaps: {
  generation: 0.20,       // was 0.25, reduced to make room
  calibration: 0.15,      // unchanged
  tournament: 0.25,       // unchanged
  evolution: 0.10,        // was 0.15, reduced to make room
  reflection: 0.05,       // unchanged
  debate: 0.05,           // unchanged
  iterativeEditing: 0.10, // unchanged
  outlineGeneration: 0.10, // NEW
},
```

5. **`index.ts`** — Add exports:
```typescript
export { OutlineGenerationAgent } from './agents/outlineGenerationAgent';
export type { OutlineVariant, GenerationStep, GenerationStepName } from './types';
export { isOutlineVariant } from './types';
```

**Pipeline placement**: OutlineGenerationAgent runs in COMPETITION phase after GenerationAgent. Produces 1 outline-based variant per iteration (vs GenerationAgent's 3 monolithic variants). Direct Elo comparison.

**Agent registration**: Callers (e.g., `run-evolution-local.ts`, `executeFullPipeline`) pass `outlineGeneration: new OutlineGenerationAgent()` in the `PipelineAgents` object, following the same pattern as `iterativeEditing: new IterativeEditingAgent(config)`.

**Tests**:
- Integration test: pipeline with flag ON → outline agent runs, produces OutlineVariant in pool
- Integration test: pipeline with flag OFF → outline agent skipped, no OutlineVariant in pool
- Supervisor test: `getPhaseConfig()` returns `runOutlineGeneration: false` in EXPANSION, `true` in COMPETITION (when flag ON)
- `getAgentForStrategy('outline_generation')` → returns `'outlineGeneration'`; `getAgentForStrategy('mutate_outline')` → returns `'outlineGeneration'`
- Checkpoint round-trip: serialize state with OutlineVariant → deserialize → verify `isOutlineVariant()` returns true, steps intact
- Mixed pool test: pool contains both TextVariation and OutlineVariant → CalibrationRanker + Tournament compare them by `.text` field via Elo. Verify both types ranked without errors.
- Budget isolation: outline agent exceeding its 0.10 cap → `BudgetExceededError` thrown, other agents (generation, evolution) can still execute within their own caps

### Phase 5: Visualization & Observability

**Goal**: Surface step-level scores in the admin UI so operators can see which steps are bottlenecks.

**Files to modify**:
- `src/lib/services/evolutionVisualizationActions.ts` — Expose step scores in variant detail
- `src/components/evolution/tabs/VariantsTab.tsx` — Show step breakdown for outline variants
- `src/app/admin/quality/evolution/run/[runId]/compare` — Step-level comparison view

**UI additions**:
- Variant detail card shows step scores as horizontal bar chart (outline: 0.95, expand: 0.4, polish: 0.8)
- Color-coded: green (≥0.8), yellow (0.5-0.8), red (<0.5)
- Weakest step highlighted with "targeted for mutation" indicator
- Compare view shows which step improved between iterations

**Tests**: Component tests for step score display, visualization action tests.

### Phase 6: CLI & Article Bank Integration

**Goal**: Support outline-based generation in the local CLI runner and article bank.

**Files to modify**:
- `scripts/run-evolution-local.ts` — Add `--outline` flag to enable outline generation
- `scripts/lib/oneshotGenerator.ts` — Add outline-based oneshot generation mode
- `src/lib/services/articleBankActions.ts` — Store step metadata for outline variants
- `src/config/promptBankConfig.ts` — Add outline method to prompt bank

**Tests**: CLI flag parsing, outline oneshot generation, bank metadata storage.

## Testing

### LLM Mock Strategy

The outline agent makes 6 sequential LLM calls. Mock pattern follows the **queue-based approach** used in `calibrationRanker.test.ts` and `pairwiseRanker.test.ts` (NOT `.mockResolvedValueOnce` chaining):

```typescript
const responses = [
  'mock outline text',   // step 1: outline
  '0.85',                // step 2: score outline
  'mock expanded text',  // step 3: expand
  '0.7',                 // step 4: score expand
  'mock polished text',  // step 5: polish
  '0.9',                 // step 6: score polish
];
let callIndex = 0;
const mockLLM = {
  complete: jest.fn().mockImplementation(() => {
    const resp = responses[callIndex % responses.length];
    callIndex++;
    return Promise.resolve(resp);
  }),
};
```

Test files follow existing naming: `<agentName>.test.ts` alongside agent file.

### Unit Tests (per phase)
- **Phase 1**: `isOutlineVariant()` type guard (true for OutlineVariant, false for TextVariation), serialization round-trip, backward compat with old checkpoints
- **Phase 2**: OutlineGenerationAgent `execute()` with mock LLM (6 ordered calls), `canExecute()` (flag on/off, budget check), `estimateCost()` (token calculation), error handling (LLM empty response → fallback), score parsing (numeric → parse, non-numeric → 0.5 default)
- **Phase 3**: `pickEditTarget()` with OutlineVariant → step-based EditTarget; with TextVariation → unchanged (regression); `buildEditPrompt()` with `step:*` dimension → step-specific prompt
- **Phase 4**: Feature flag ON → agent runs; flag OFF → agent skipped; checkpoint round-trip with OutlineVariant; mixed pool (OutlineVariant + TextVariation) tournament ranking; budget cap enforcement
- **Phase 5**: Visualization component rendering, step score display
- **Phase 6**: CLI argument parsing, oneshot outline generation

### Integration Tests
- **Mixed pool evolution**: Full pipeline with both GenerationAgent and OutlineGenerationAgent producing variants that compete via Elo. Verify both variant types coexist in pool, CalibrationRanker compares them by `.text` field, Tournament ranks them. This is the first test of heterogeneous variant types in the pool — must explicitly verify no type errors when ranking agents access `variant.text` on both TextVariation and OutlineVariant.
- **Checkpoint/resume**: Serialize state containing OutlineVariants → resume from checkpoint → verify steps, scores, weakestStep all preserved. Also verify old checkpoints (no OutlineVariants) still load correctly (backward compat — follows existing pattern from `eloRatings` → `ratings` migration test in `state.test.ts`).
- **Feature flag toggle**: Start pipeline with flag ON → produce outline variants → toggle flag OFF mid-run → verify outline agent stops executing but existing outline variants remain in pool and can still be mutated by EvolutionAgent.
- **Budget isolation**: Create CostTracker with per-agent caps. Exhaust outlineGeneration cap (0.10). Verify generation agent can still reserve and spend within its own cap (0.20). Verify `BudgetExceededError` only thrown for outlineGeneration, not other agents.
- **Article bank**: Store and retrieve outline variant metadata.

### E2E Tests
- Admin UI: navigate to evolution run → click outline variant → verify step score breakdown visible (outline: X, expand: Y, polish: Z)
- Compare view: two iterations side-by-side → verify step-level changes highlighted

### Manual Verification on Stage
- Run evolution with `--outline` flag on a sample article
- Verify outline variants appear in admin UI with step scores
- Verify step-targeted mutations improve the weakest step (measure: weakest step score increases between iterations)
- Compare convergence speed: outline-enabled runs vs outline-disabled runs (target: 20%+ fewer iterations to reach Elo plateau)

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/feature_deep_dives/iterative_editing_agent.md` — Add step-aware editing section
- `docs/feature_deep_dives/evolution_pipeline.md` — Add OutlineGenerationAgent to agent table, COMPETITION phase config, new types
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` — Add step score visualization
- `docs/feature_deep_dives/comparison_infrastructure.md` — Add outline method to prompt bank docs
- `docs/feature_deep_dives/outline_based_generation_editing.md` — New deep dive (created during /initialize)
