# Content Editing Agents

Two complementary agents apply critique-driven edits at different scopes: whole-article (IterativeEditingAgent) and per-section (SectionDecompositionAgent). Both run in COMPETITION phase and use diff-based judging with bias mitigation.

## Shared Design Pattern

Both editing agents follow the same core pattern:
- **Information barrier**: The editor knows the specific weakness being targeted (dimension name, score, examples). The judge sees ONLY a CriticMarkup diff with no context about edit intent — the improvement must be detectable from the diff alone.
- **Direction reversal bias mitigation**: Every edit is judged twice with reversed presentation, using `compareWithDiff()` from [Rating & Comparison — Diff-Based Comparison](../rating_and_comparison.md#diff-based-comparison-diffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisontsdiffcomparisonts).
- **Format validation**: All edited text validated via [format rules](./overview.md#format-validation) before entering the pool.

## Iterative Editing Agent (Whole-Article)

The IterativeEditingAgent surgically improves the top-ranked variant through a critique-driven edit loop. Unlike agents that generate new variants from scratch, this agent edits the existing best variant and gates each edit through a blind LLM-as-judge.

Budget cap: 5% ([details](../reference.md#budget-caps)). **Note:** Previously documented as 10% — the actual value in `config.ts` is `iterativeEditing: 0.05` (5%).

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

### Direction Reversal Truth Table

To combat LLM position/framing bias, every edit is judged twice:
1. **Forward pass**: Shows diff as `original → edited` (deletions and insertions)
2. **Reverse pass**: Shows diff as `edited → original` (inverted deletions/insertions)

| Forward | Reverse | Result | Reasoning |
|---------|---------|--------|-----------|
| ACCEPT  | REJECT  | ACCEPT | Consistent — edit improves article |
| REJECT  | ACCEPT  | REJECT | Consistent — edit harms article |
| ACCEPT  | ACCEPT  | UNSURE | Framing bias — judge always accepts |
| REJECT  | REJECT  | UNSURE | Framing bias — judge always rejects |
| UNSURE  | any     | UNSURE | Insufficient signal |

### CriticMarkup Diff Module

`diffComparison.ts` is separate from `comparison.ts` to avoid ESM contamination — `unified` and `remark-parse` are ESM-only packages. Uses dynamic `import()` following the pattern in `aiSuggestion.ts`.

The diff pipeline:
1. Parse both texts to MDAST (Markdown Abstract Syntax Tree) via `unified` + `remark-parse`
2. Generate CriticMarkup diff via `RenderCriticMarkupFromMDAstDiff` (existing utility)
3. Build blind judge prompt containing only the annotated diff
4. Run 2-pass direction reversal and combine verdicts

### Step-Aware Editing for Outline Variants

When the top variant is an `OutlineVariant` (from [OutlineGenerationAgent](./generation.md#outlinegenerationagent)), the agent adds step-based edit targets before dimension-based targets:

```typescript
if (isOutlineVariant(variant) && variant.weakestStep) {
  targets.unshift({
    dimension: `step:${variant.weakestStep}`,
    description: `Re-generate the ${variant.weakestStep} step`,
    score: stepScore,
  });
}
```

The `step:` prefix triggers step-specific prompts:
- `step:outline` → "Create a better section outline with improved structure, coverage, and logical flow"
- `step:expand` → "Expand the outline sections into better prose with stronger examples"
- `step:polish` → "Polish the text for better readability, transitions, flow, and coherence"

Step-targeted edits produce plain `TextVariation` results (not `OutlineVariant`) since re-scoring steps would require additional LLM calls.

### Agent-Level Config

```typescript
{
  maxCycles: 3,                  // Max edit→judge cycles per execution
  maxConsecutiveRejections: 3,   // Stop after N consecutive judge rejections
  qualityThreshold: 8,           // Stop if all rubric dimensions >= this score
}
```

### Interaction with ReflectionAgent

- Uses `getCritiqueForVariant()` to find the rubric critique for the top variant
- Reads `dimensionScores`, `badExamples`, and `notes` to select edit targets
- Also runs its own inline critique after accepted edits (duplicates the ReflectionAgent prompt since `buildCritiquePrompt` is module-private in `reflectionAgent.ts`)

## Section Decomposition Agent (Hierarchical)

The `SectionDecompositionAgent` decomposes long articles into H2 sections, applies targeted edits to each section independently in parallel, and stitches the results back into a single article variant. It runs after IterativeEditingAgent and adds the stitched variant to the main pool.

Budget cap: 10% ([details](../reference.md#budget-caps)).

### Parse → Filter → Parallel Edit → Stitch

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

1. **canExecute**: Pool has rated variants with critiques AND top variant has >= 2 H2 sections
2. Get top variant by ordinal + its critique from `state.allCritiques`
3. Parse into sections via `parseArticleIntoSections()`
4. Filter eligible sections (skip preamble, skip sections < 100 chars)
5. Reserve budget once upfront via `costTracker.reserveBudget()`
6. Run `Promise.allSettled` of `runSectionEdit()` on eligible sections (parallel)
7. Build replacement map from accepted edits
8. `stitchWithReplacements()` → validate full article format → `state.addToPool()`

### Section Parser

Regex-based splitting at `## ` (H2) boundaries with code block protection:
- Strips fenced code blocks before splitting to prevent false `## ` matches inside code
- Uses lookahead regex `/^(?=## )/m` to preserve headings in output
- Round-trip invariant: `stitchSections(parseArticleIntoSections(md)) === md`

### Section Edit Runner

A standalone function (NOT re-entering IterativeEditingAgent) that follows the same critique→edit→judge pattern but operates on section text:
- Takes a section, full article context, weakness descriptor, and LLM client
- Builds a section-scoped prompt: full article for context, section text as edit target
- Validates edited section via `validateSectionFormat()` (relaxed rules: no H1 required)
- Judges via `compareWithDiff()` — blind diff-based comparison with direction-reversal bias mitigation
- Max 2 cycles per section (smaller scope than full article's 3)

### Budget Reservation Pattern

Budget is reserved ONCE upfront before the `Promise.allSettled` fan-out, not per-section. This prevents parallel section edits from each independently passing budget checks and collectively exceeding the cap.

## Comparison Table

| Aspect | Iterative Editing | Section Decomposition |
|--------|------------------|----------------------|
| Scope | Whole article | Per H2 section |
| Parallelism | Sequential cycles | `Promise.allSettled` fan-out |
| Max cycles | 3 | 2 per section |
| Budget reservation | Per-edit | Once upfront |
| Budget cap | 5% | 10% |
| Input requirement | Top variant + critique | Top variant with >= 2 H2 sections + critique |
| Output | `critique_edit_{dimension}` variants | `section_edited_*` variant |
| Format validation | Full rules | Relaxed (no H1 for sections) |

## Key Files

### Iterative Editing
| File | Purpose |
|------|---------|
| `evolution/src/lib/agents/iterativeEditingAgent.ts` | Core agent: execute loop, edit target selection, open review, inline critique |
| `evolution/src/lib/diffComparison.ts` | CriticMarkup diff generation and 2-pass direction reversal judge |

### Section Decomposition
| File | Purpose |
|------|---------|
| `evolution/src/lib/agents/sectionDecompositionAgent.ts` | Orchestrates parse→parallel-edit→stitch flow |
| `evolution/src/lib/section/sectionParser.ts` | `parseArticleIntoSections()` — regex split at H2 with code block stripping |
| `evolution/src/lib/section/sectionStitcher.ts` | `stitchSections()`, `stitchWithReplacements()` — reassembly with selective replacement |
| `evolution/src/lib/section/sectionFormatValidator.ts` | Relaxed format validator (no H1, H2 heading required, no bullets/lists/tables) |
| `evolution/src/lib/section/sectionEditRunner.ts` | Per-section critique→edit→judge loop using `compareWithDiff()` |
| `evolution/src/lib/section/types.ts` | `ArticleSection`, `ParsedArticle`, `SectionVariation`, `SectionEvolutionState` |

## Testing

### Iterative Editing
- `iterativeEditingAgent.test.ts` — 21 unit tests: accept/reject/bias/budget/format/canExecute
- `diffComparison.test.ts` — 15 unit tests: verdict parsing, truth table, integration

### Section Decomposition
- 22 unit tests for parser + stitcher: round-trip fidelity, code blocks, edge cases
- 10 unit tests for section format validator
- 5 unit tests for section edit runner with mocked `compareWithDiff`
- 9 unit tests for agent: `canExecute` boundaries, budget reservation, budget failure, missing critique
- Integration: `npx tsx evolution/scripts/run-evolution-local.ts --file evolution/docs/sample_content/api_design_sections.md --mock --full --iterations 3`

## Related Documentation

- [Architecture](../architecture.md) — Pipeline phases and COMPETITION agent sequence
- [Rating & Comparison](../rating_and_comparison.md) — Diff-based comparison method details
- [Agent Overview](./overview.md) — Agent framework and format validation
- [Generation Agents](./generation.md) — OutlineVariant and step-targeted mutation
- [Tree Search Agent](./tree_search.md) — Alternative revision approach (mutually exclusive with IterativeEditing)
- [Reference](../reference.md) — Feature flags, budget caps, configuration
