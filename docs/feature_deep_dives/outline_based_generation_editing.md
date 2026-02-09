# Outline-Based Generation & Editing

## Overview

The OutlineGenerationAgent decomposes article generation into scored steps (outline → expand → polish → verify) instead of producing text in a single monolithic LLM call. Each step is independently scored by a judge LLM, producing a Process Reward Model (PRM) signal that identifies exactly which generation step is weakest. This enables step-targeted mutations: instead of regenerating the entire article, the pipeline can surgically re-run only the weak step.

The agent runs alongside the existing GenerationAgent in the COMPETITION phase. Outline-based variants compete directly against monolithic variants via the Elo rating system. Gated by the `evolution_outline_generation_enabled` feature flag (default: `false`).

## How It Works

### 6-Call Pipeline

```
Original Text
     │
     ▼
1. Outline (generationModel)
     │ → Section headings + 1-2 sentence summaries
     ▼
2. Score Outline (judgeModel)
     │ → 0-1 float (structure, coverage, logical flow)
     ▼
3. Expand (generationModel)
     │ → Full prose from outline sections
     ▼
4. Score Expansion (judgeModel)
     │ → 0-1 float (detail, examples, grounding)
     ▼
5. Polish (generationModel)
     │ → Refined text (transitions, flow, coherence)
     ▼
6. Score Polish (judgeModel)
     │ → 0-1 float (readability, coherence)
     ▼
7. Verify (no LLM call)
     │ → Format check + length check
     ▼
OutlineVariant added to pool
  .text = polished text (final output)
  .outline = intermediate outline from step 1
  .steps = [{name, input, output, score, costUsd}, ...]
  .weakestStep = step with lowest score
  .strategy = 'outline_generation'
```

### Score Parsing

All step scores use `parseStepScore(rawOutput)`:
- Parses `parseFloat(raw)`, clamps to `[0, 1]`
- Non-numeric output (e.g., "This is excellent!") defaults to `0.5`
- `Infinity`/`NaN` → `0.5`

### Error Handling & Partial Failures

| Step | Failure Behavior |
|------|------------------|
| Outline returns empty | Agent returns `success: false`, no variant added |
| Expand returns empty | Falls back to outline text as variant `.text` |
| Polish returns empty | Falls back to expanded text as variant `.text` |
| Score returns non-numeric | Defaults to `0.5` for that step |
| Budget exceeded mid-pipeline | Partial variant created from completed steps |
| Generic LLM error after outline | Partial variant created from outline text |

### Cost Tracking

Cost is tracked per-step using sequential snapshots from `CostTracker.getAgentCost()`:

```typescript
const costBefore = costTracker.getAgentCost('outlineGeneration');
// ... outline gen + score ...
const costAfterOutline = costTracker.getAgentCost('outlineGeneration');
const outlineStepCost = costAfterOutline - costBefore;
// ... expand gen + score ...
const costAfterExpand = costTracker.getAgentCost('outlineGeneration');
const expandStepCost = costAfterExpand - costAfterOutline;
```

This prevents cost bleed between steps — each step's `costUsd` reflects exactly the LLM calls made during that step.

## Key Types

```typescript
type GenerationStepName = 'outline' | 'expand' | 'polish' | 'verify';

interface GenerationStep {
  name: GenerationStepName;
  input: string;
  output: string;
  score: number;    // 0-1, from step-level judge
  costUsd: number;
}

interface OutlineVariant extends TextVariation {
  steps: GenerationStep[];
  outline: string;
  weakestStep: GenerationStepName | null;
}
```

`isOutlineVariant(v: TextVariation): v is OutlineVariant` — type guard checking for non-empty `steps` array with `name` field.

## Step-Targeted Mutation

When the IterativeEditingAgent encounters an OutlineVariant, it adds step-based targets before dimension-based targets:

```typescript
// In pickEditTarget():
if (isOutlineVariant(variant) && variant.weakestStep) {
  targets.unshift({
    dimension: `step:${variant.weakestStep}`,
    description: `Re-generate the ${variant.weakestStep} step`,
    score: stepScore,
  });
}
```

The `step:` prefix in `dimension` triggers a step-specific edit prompt in `buildEditPrompt()`.

The EvolutionAgent also supports outline mutation via `mutate_outline` strategy in `evolvePool.ts`, which mutates the outline and re-expands.

## Pipeline Integration

### Phase Configuration

- **EXPANSION**: `runOutlineGeneration: false` — outline agent does not run
- **COMPETITION**: `runOutlineGeneration: true` — outline agent runs (if feature flag enabled)

Pipeline checks: `config.runOutlineGeneration && agents.outlineGeneration && featureFlags.outlineGenerationEnabled !== false`

### Budget

Budget cap: `outlineGeneration: 0.10` (10% of total). Budget allocations adjusted to maintain total of 1.00:
- `generation`: 0.25 → 0.20
- `evolution`: 0.15 → 0.10
- `outlineGeneration`: 0.10 (new)

### Feature Flag

| Flag | Default | Effect |
|------|---------|--------|
| `evolution_outline_generation_enabled` | `false` | When `true`, OutlineGenerationAgent runs in COMPETITION phase |

### Strategy Mapping

```typescript
STRATEGY_TO_AGENT: {
  outline_generation: 'outlineGeneration',
  mutate_outline: 'outlineGeneration',
}
```

### Agent Registration

All 4 pipeline callsites construct `OutlineGenerationAgent`:
- `src/lib/services/evolutionActions.ts` (admin trigger)
- `src/app/api/cron/evolution-runner/route.ts` (cron runner)
- `scripts/evolution-runner.ts` (batch runner)
- `scripts/run-batch.ts` (batch experiments)

## CLI Usage

```bash
# Enable outline generation in local CLI
npx tsx scripts/run-evolution-local.ts \
  --file article.md --full --outline --iterations 5

# With bank checkpoints
npx tsx scripts/run-evolution-local.ts \
  --prompt "Explain photosynthesis" --bank --outline --bank-checkpoints "3,5,10"
```

The `--outline` flag adds `OutlineGenerationAgent` to the agent list and enables `runOutlineGeneration` in COMPETITION phase config.

### Hall of Fame Metadata

When an outline variant wins, Hall of Fame entries include:
```json
{
  "outline_mode": true,
  "outline": "## Section 1\nSummary...",
  "weakest_step": "expand",
  "steps": [
    {"name": "outline", "score": 0.9, "costUsd": 0.01},
    {"name": "expand", "score": 0.4, "costUsd": 0.02}
  ]
}
```

## Visualization

OutlineVariants display a step score bar chart in the Variants tab (`StepScoreBar.tsx`):
- Horizontal bars for each step (outline, expand, polish, verify)
- Color-coded: green (>= 0.8), yellow (0.5-0.8), red (< 0.5)
- Weakest step highlighted with error color
- Only shown for variants with step data (`isOutlineVariant`)

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/evolution/agents/outlineGenerationAgent.ts` | 6-call pipeline agent extending AgentBase |
| `src/lib/evolution/types.ts` | `GenerationStep`, `OutlineVariant`, `isOutlineVariant()`, `parseStepScore()` |
| `src/lib/evolution/agents/iterativeEditingAgent.ts` | Step-aware `pickEditTarget()` and `buildEditPrompt()` |
| `src/lib/evolution/agents/evolvePool.ts` | `mutate_outline` strategy, `buildMutateOutlinePrompt()` |
| `src/lib/evolution/core/pipeline.ts` | `outlineGeneration` in PipelineAgents, STRATEGY_TO_AGENT mapping |
| `src/lib/evolution/core/supervisor.ts` | `runOutlineGeneration` in PhaseConfig |
| `src/lib/evolution/core/featureFlags.ts` | `outlineGenerationEnabled` flag |
| `src/lib/evolution/config.ts` | Budget cap: `outlineGeneration: 0.10` |
| `src/components/evolution/StepScoreBar.tsx` | Step score visualization component |
| `src/lib/services/evolutionVisualizationActions.ts` | `getEvolutionRunStepScoresAction` |
| `scripts/run-evolution-local.ts` | `--outline` CLI flag |
| `src/config/promptBankConfig.ts` | `evolution_deepseek_outline` method |

## Testing

- `outlineGenerationAgent.test.ts` — 16 tests: full pipeline, 6-call ordering, model routing, score parsing, error handling, cost attribution, canExecute, estimateCost
- `outlineTypes.test.ts` — 21 tests: type guards, serialization round-trip, parseStepScore edge cases
- `iterativeEditingAgent.test.ts` — Step-targeted edit tests
- `evolvePool.test.ts` — Outline mutation tests
- `StepScoreBar.test.tsx` — 10 component tests
- `run-evolution-local.test.ts` — CLI outline flag tests
- `run-prompt-bank.test.ts` — Outline method config tests

## Related Documentation

- [Evolution Pipeline](./evolution_pipeline.md) — Full pipeline architecture
- [Iterative Editing Agent](./iterative_editing_agent.md) — Step-aware editing details
- [Evolution Pipeline Visualization](./evolution_pipeline_visualization.md) — Step score UI
- [Comparison Infrastructure](./comparison_infrastructure.md) — Hall of Fame outline methods
