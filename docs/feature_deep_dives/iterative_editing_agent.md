# Iterative Editing Agent

## Overview

The IterativeEditingAgent is a self-gating pipeline agent that surgically improves the top-ranked variant through a critique-driven edit loop. Unlike other agents that generate new variants from scratch, this agent edits the existing best variant and gates each edit through a blind LLM-as-judge using diff-based comparison with direction-reversal bias mitigation.

The core loop: **evaluate → edit → judge → accept/reject**. Only edits that pass the blind judge are added to the pool.

## How It Works

### Evaluate → Edit → Judge Loop

```
Top Variant → Open Review + Rubric Critique
                    │
                    ▼
              Pick Edit Target (weakest dimension or open suggestion)
                    │
                    ▼
              Generate Surgical Edit (LLM, knows the target)
                    │
                    ▼
              Validate Format (reject malformed output)
                    │
                    ▼
              Blind Diff Judge (LLM, sees ONLY CriticMarkup diff)
               ┌────┴────┐
               │         │
            ACCEPT     REJECT
               │         │
          Add to Pool   Skip, try next target
               │
          Re-evaluate (fresh critique + open review)
               │
          Loop (up to maxCycles)
```

### Information Barrier

The edit prompt knows the specific weakness being targeted (dimension name, score, examples). The judge prompt sees ONLY a CriticMarkup diff with no context about edit intent. This prevents the judge from rubber-stamping edits just because they address the stated goal — the improvement must be detectable from the diff alone.

### Direction Reversal Bias Mitigation

To combat LLM position/framing bias, every edit is judged twice:
1. **Forward pass**: Shows diff as `original → edited` (deletions and insertions)
2. **Reverse pass**: Shows diff as `edited → original` (inverted deletions/insertions)

The truth table:

| Forward | Reverse | Result | Reasoning |
|---------|---------|--------|-----------|
| ACCEPT  | REJECT  | ACCEPT | Consistent — edit improves article |
| REJECT  | ACCEPT  | REJECT | Consistent — edit harms article |
| ACCEPT  | ACCEPT  | UNSURE | Framing bias — judge always accepts |
| REJECT  | REJECT  | UNSURE | Framing bias — judge always rejects |
| UNSURE  | any     | UNSURE | Insufficient signal |

### Diff Comparison Module

`diffComparison.ts` is separate from `comparison.ts` to avoid ESM contamination — `unified` and `remark-parse` are ESM-only packages. Uses dynamic `import()` following the pattern in `aiSuggestion.ts`.

The diff pipeline:
1. Parse both texts to MDAST (Markdown Abstract Syntax Tree) via `unified` + `remark-parse`
2. Generate CriticMarkup diff via `RenderCriticMarkupFromMDAstDiff` (existing utility)
3. Build blind judge prompt containing only the annotated diff
4. Run 2-pass direction reversal and combine verdicts

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/evolution/agents/iterativeEditingAgent.ts` | Core agent: execute loop, edit target selection, open review, inline critique |
| `src/lib/evolution/diffComparison.ts` | CriticMarkup diff generation and 2-pass direction reversal judge |
| `src/lib/evolution/agents/iterativeEditingAgent.test.ts` | 21 unit tests covering accept/reject/bias/budget/format/canExecute |
| `src/lib/evolution/diffComparison.test.ts` | 15 unit tests covering verdict parsing, truth table, integration |

## Configuration

```typescript
{
  maxCycles: 3,                  // Max edit→judge cycles per execution
  maxConsecutiveRejections: 3,   // Stop after N consecutive judge rejections
  qualityThreshold: 8,           // Stop if all rubric dimensions >= this score
}
```

Budget cap: `iterativeEditing: 0.10` (10% of total run budget, from `config.ts`).

Feature flag: `evolution_iterative_editing_enabled` (default: `true`). When `false`, agent is skipped in COMPETITION phase.

## Pipeline Integration

- **Phase**: COMPETITION only (`runIterativeEditing: true` in COMPETITION, `false` in EXPANSION)
- **Execution order**: After ReflectionAgent, before DebateAgent
- **Preconditions** (`canExecute`): Requires critiques in state, Elo ratings populated, and a critique for the top variant
- **Consumes**: `allCritiques` (from ReflectionAgent), top variant by Elo
- **Produces**: `critique_edit_{dimension}` or `critique_edit_open` variants added to pool

## Interaction with ReflectionAgent

The IterativeEditingAgent depends on ReflectionAgent output:
- Uses `getCritiqueForVariant()` to find the rubric critique for the top variant
- Reads `dimensionScores`, `badExamples`, and `notes` to select edit targets
- Also runs its own inline critique after accepted edits (duplicates the ReflectionAgent prompt since `buildCritiquePrompt` is module-private in reflectionAgent.ts)

## Related Documentation

- [Evolution Pipeline](./evolution_pipeline.md) — Full pipeline architecture and agent interactions
- [Comparison Infrastructure](./comparison_infrastructure.md) — Pairwise comparison and bias mitigation patterns
