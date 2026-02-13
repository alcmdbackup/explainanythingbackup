# Generation Agents

GenerationAgent (3-strategy monolithic generation) and OutlineGenerationAgent (6-call pipeline with per-step scoring).

## GenerationAgent

Creates 3 new text variants per iteration using three parallel strategies: `structural_transform`, `lexical_simplify`, `grounding_enhance`. Runs in both EXPANSION and COMPETITION phases.

- Reads `originalText` and `metaFeedback` from state
- Writes new variants to the pool via `addToPool()`
- All 3 strategy calls run concurrently via `Promise.allSettled()`
- Consumes `MetaFeedback` from MetaReviewAgent (if available) to steer prompt construction
- Budget cap: 20% ([details](../reference.md#budget-caps))

## OutlineGenerationAgent

Decomposes article generation into scored steps instead of producing text in a single monolithic LLM call. Each step is independently scored by a judge LLM, producing a Process Reward Model (PRM) signal that identifies exactly which generation step is weakest. This enables step-targeted mutations: instead of regenerating the entire article, the pipeline can surgically re-run only the weak step.

The agent runs alongside GenerationAgent in the COMPETITION phase. Outline-based variants compete directly against monolithic variants via the OpenSkill rating system. Gated by `evolution_outline_generation_enabled` feature flag (default: `false`). Budget cap: 10% ([details](../reference.md#budget-caps)).

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

When the IterativeEditingAgent encounters an OutlineVariant, it adds step-based targets before dimension-based targets. The `step:` prefix in `dimension` triggers a step-specific edit prompt in `buildEditPrompt()`. See [Editing Agents — Step-Aware Editing](./editing.md#step-aware-editing-for-outline-variants).

The EvolutionAgent also supports outline mutation via `mutate_outline` strategy in `evolvePool.ts`, which mutates the outline and re-expands. See [Support Agents — EvolutionAgent](./support.md#evolutionagent-evolvepool).

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
| `src/lib/evolution/agents/generationAgent.ts` | 3-strategy parallel generation agent |
| `src/lib/evolution/agents/outlineGenerationAgent.ts` | 6-call pipeline agent extending AgentBase |
| `src/lib/evolution/types.ts` | `GenerationStep`, `OutlineVariant`, `isOutlineVariant()`, `parseStepScore()` |
| `src/lib/evolution/agents/evolvePool.ts` | `mutate_outline` strategy, `buildMutateOutlinePrompt()` |
| `src/components/evolution/StepScoreBar.tsx` | Step score visualization component |
| `src/lib/services/evolutionVisualizationActions.ts` | `getEvolutionRunStepScoresAction` |

## Testing

- `outlineGenerationAgent.test.ts` — 16 tests: full pipeline, 6-call ordering, model routing, score parsing, error handling, cost attribution, canExecute, estimateCost
- `outlineTypes.test.ts` — 21 tests: type guards, serialization round-trip, parseStepScore edge cases
- `iterativeEditingAgent.test.ts` — Step-targeted edit tests
- `evolvePool.test.ts` — Outline mutation tests
- `StepScoreBar.test.tsx` — 10 component tests
- `run-evolution-local.test.ts` — CLI outline flag tests
- `run-prompt-bank.test.ts` — Outline method config tests

## Related Documentation

- [Architecture](../architecture.md) — Pipeline phases and how generation fits into EXPANSION/COMPETITION
- [Editing Agents](./editing.md) — Step-aware editing for OutlineVariants
- [Support Agents](./support.md) — EvolutionAgent outline mutation
- [Visualization](../visualization.md) — Step score UI components
- [Hall of Fame](../hall_of_fame.md) — Outline methods in prompt bank
- [Reference](../reference.md) — Feature flags, budget caps, configuration
