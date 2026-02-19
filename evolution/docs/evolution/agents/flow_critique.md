# Flow Critique Agent

Standalone flow evaluation pass that scores each pool variant on 5 prose-flow dimensions (0-5 scale), producing structured critiques consumed by IterativeEditingAgent and cross-scale weakness targeting.

## Overview

Unlike other agents that extend `AgentBase`, flow critique is implemented as a standalone function (`runFlowCritiques` in `pipeline.ts`) because ReflectionAgent overwrites `state.dimensionScores` with each critique's scores. The flow critique function appends `Critique` objects to `state.allCritiques` only, preserving quality scores while writing flow scores to `dimensionScores` with a `flow:` prefix.

## Flow Dimensions

| Dimension | What It Measures |
|-----------|-----------------|
| `local_cohesion` | Sentence-to-sentence glue — does each sentence follow logically from the previous? |
| `global_coherence` | Paragraph arc — does the article's argument build in a sensible order? |
| `transition_quality` | Transitions connect paragraphs — are there explicit bridges between ideas? |
| `rhythm_variety` | Sentence rhythm — do sentence lengths and structures vary, or is the prose monotone? |
| `redundancy` | Redundancy — is information repeated unnecessarily or do ideas advance with each sentence? |

## How It Works

1. **Variant selection**: Critiques all pool variants that don't already have a flow critique (filtered by `scale === '0-5'` in `allCritiques`)
2. **LLM call**: Sends each variant text through `buildFlowCritiquePrompt()` which asks the LLM to score each dimension 0-5 and cite friction sentences
3. **Parsing**: `parseFlowCritiqueResponse()` extracts JSON with scores (clamped to [0, 5]) and friction sentence arrays
4. **Storage**: Results stored as `Critique` objects in `state.allCritiques` with `scale: '0-5'` and dimension scores written to `state.dimensionScores[variantId]['flow:<dim>']`
5. **Checkpoint**: A `flowCritique` checkpoint is persisted after the pass completes

## Flow Comparison Mode

The `PairwiseRanker` includes a flow comparison mode (internal `comparePairFlow()`, exposed via public `compareFlowWithBiasMitigation()`) that runs alongside quality comparison during tournament/calibration:

- Uses `buildFlowComparisonPrompt()` to compare two texts on the same 5 flow dimensions
- Returns per-dimension A/B/TIE scores, friction spots for each text, overall winner, and confidence
- Winner is derived from dimension majority when not explicit in LLM response

## Cross-Scale Weakness Targeting

`getWeakestDimensionAcrossCritiques()` in `flowRubric.ts` finds the single weakest dimension across both quality (1-10 scale) and flow (0-5 scale) critiques:

- Normalizes both scales to [0, 1] using `normalizeScore()` before comparison
- Falls back to quality-only when flow critique is absent
- Used by IterativeEditingAgent to target the weakest dimension for focused editing

## Config & Cost

- Budget cap: 5% ([details](../reference.md#budget-caps))
- Feature flag: `evolution_flow_critique_enabled` (default: `false`). See [Reference — Feature Flags](../reference.md#feature-flags).
- Phase: COMPETITION only
- Runs after quality critique (ReflectionAgent), before editing agents
- Runs **sequentially** (`parallel: false` in `runCritiqueBatch`), unlike ReflectionAgent which runs in parallel
- Parse failures are non-fatal — the pipeline continues without flow scores

## Key Files

| File | Purpose |
|------|---------|
| `evolution/src/lib/flowRubric.ts` | Flow dimensions, prompt builders, parsers, score normalization, cross-scale targeting |
| `evolution/src/lib/core/pipeline.ts` | `runFlowCritiques()` standalone function and pipeline integration |
| `evolution/src/lib/agents/pairwiseRanker.ts` | Flow comparison mode via `compareFlowWithBiasMitigation()` (public); `comparePairFlow()` is private |
| `evolution/src/lib/core/featureFlags.ts` | `flowCritiqueEnabled` flag definition |

## Related Documentation

- [Agent Overview](./overview.md) — Agent interaction patterns
- [Support Agents](./support.md) — ReflectionAgent (quality critique counterpart)
- [Editing Agents](./editing.md) — IterativeEditingAgent consumes flow critiques
- [Rating & Comparison](../rating_and_comparison.md) — Flow comparison in pairwise ranking
- [Reference](../reference.md) — Feature flags, budget caps
