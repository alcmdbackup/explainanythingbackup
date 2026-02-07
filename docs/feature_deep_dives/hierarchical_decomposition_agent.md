# Hierarchical Decomposition Agent

## Overview

The `SectionDecompositionAgent` decomposes long articles into H2 sections, applies targeted edits to each section independently in parallel, and stitches the results back into a single article variant. It runs in COMPETITION phase after `IterativeEditingAgent` and adds the stitched variant to the main pool where it competes via tournament like any other variant.

This complements whole-article editing (IterativeEditingAgent) with section-level granularity — improvements to one section can be accepted while other sections remain unchanged. The two approaches compete directly in the pool: holistic edits vs section-level edits, with the tournament selecting the better outcome.

## How It Works

```
Top Variant + Critique
        │
        ▼
  parseArticleIntoSections()
        │
        ▼
  ┌─────┬─────┬─────┐
  │ §1  │ §2  │ §3  │   Filter: skip preamble, skip <100 chars
  └──┬──┘──┬──┘──┬──┘
     │     │     │       Promise.allSettled (parallel)
     ▼     ▼     ▼
  runSectionEdit()        Per-section critique→edit→judge loop
     │     │     │
     ▼     ▼     ▼
  stitchWithReplacements()
        │
        ▼
  validateFormat() → addToPool()
```

### Agent Flow

1. **canExecute**: Pool has rated variants with critiques AND top variant has ≥2 H2 sections
2. Get top variant by ordinal + its critique from `state.allCritiques`
3. Parse into sections via `parseArticleIntoSections()`
4. Filter eligible sections (skip preamble, skip sections < 100 chars)
5. Reserve budget once upfront via `costTracker.reserveBudget()`
6. Run `Promise.allSettled` of `runSectionEdit()` on eligible sections (parallel)
7. Build replacement map from accepted edits
8. `stitchWithReplacements()` → validate full article format → `state.addToPool()`

### Section Edit Runner

A standalone function (NOT re-entering `IterativeEditingAgent`) that follows the same critique→edit→judge pattern but operates on section text:

- Takes a section, full article context, weakness descriptor, and LLM client
- Builds a section-scoped prompt: full article for context, section text as edit target, weakness from critique
- Validates edited section via `validateSectionFormat()` (relaxed rules: no H1 required for sections)
- Judges via `compareWithDiff()` — blind diff-based comparison with direction-reversal bias mitigation
- Max 2 cycles per section (smaller scope than full article's 3)

### Section Parser

Regex-based splitting at `## ` (H2) boundaries with code block protection:

- Strips fenced code blocks before splitting to prevent false `## ` matches inside code
- Uses lookahead regex `/^(?=## )/m` to preserve headings in output
- Round-trip invariant: `stitchSections(parseArticleIntoSections(md)) === md`

## Key Files

### Section Utilities (`src/lib/evolution/section/`)
| File | Purpose |
|------|---------|
| `types.ts` | `ArticleSection`, `ParsedArticle`, `SectionVariation`, `SectionEvolutionState` |
| `sectionParser.ts` | `parseArticleIntoSections()` — regex split at H2 boundaries with code block stripping |
| `sectionStitcher.ts` | `stitchSections()`, `stitchWithReplacements()` — reassembly with selective replacement |
| `sectionFormatValidator.ts` | `validateSectionFormat()` — relaxed rules for individual sections (no H1 required, H2 heading required, no bullets/lists/tables) |
| `sectionEditRunner.ts` | `runSectionEdit()` — standalone critique→edit→judge loop per section using `compareWithDiff()` |

### Agent (`src/lib/evolution/agents/`)
| File | Purpose |
|------|---------|
| `sectionDecompositionAgent.ts` | `SectionDecompositionAgent extends AgentBase` — orchestrates parse→parallel-edit→stitch flow |

## Configuration

- **Phase**: COMPETITION only (`runSectionDecomposition: true` in COMPETITION, `false` in EXPANSION)
- **Execution order**: After IterativeEditingAgent, before DebateAgent
- **Budget cap**: 10% of total budget (`budgetCaps.sectionDecomposition: 0.10`). On a $5 budget, that is $0.50 for all section work
- **Feature flag**: `evolution_section_decomposition_enabled` (default: `true`)
- **Budget reservation**: Called ONCE upfront before `Promise.allSettled` fan-out, not per-section

## Testing

- **22 unit tests** for parser + stitcher (Phase 1): round-trip fidelity, code blocks, edge cases
- **10 unit tests** for section format validator
- **5 unit tests** for section edit runner with mocked `compareWithDiff`
- **9 unit tests** for agent: `canExecute` boundaries, budget reservation, budget failure, missing critique
- **Integration**: `npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/api_design_sections.md --mock --full --iterations 3`

## Related Documentation

- [Evolution Pipeline](./evolution_pipeline.md) — Full pipeline architecture and agent interactions
- [Iterative Editing Agent](./iterative_editing_agent.md) — Whole-article editing (complementary approach)
- [Comparison Infrastructure](./comparison_infrastructure.md) — Diff-based comparison used for section judging
- [Elo Budget Optimization](./elo_budget_optimization.md) — Budget cap and cost attribution
