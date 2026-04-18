# More Generation Tactics Evolution Research

## Problem Statement
Add 16 new generation strategies to the evolution pipeline beyond the current 3 implemented core strategies. Formalize strategy definitions with a proper enum/registry (currently just a Record<string, StrategyDef> dict). Wire up the existing but unused generationGuidance weighted random selection feature. Update cost estimation, UI palette, and tests for all new strategies.

## Requirements (from GH Issue #TBD)

### New Generation Strategies (16 total)

**Depth & Knowledge Strategies:**
- analogy_bridge — Inject analogies and metaphors connecting unfamiliar concepts to everyday experience
- expert_deepdive — Add technical depth: mechanisms, edge cases, caveats, nuances
- historical_context — Weave in origin stories, key figures, timeline of discovery
- counterpoint_integrate — Identify strongest objections/misconceptions and address them

**Audience-Shift Strategies:**
- pedagogy_scaffold — Restructure using teaching techniques: prerequisites, sequencing, check-understanding transitions
- curiosity_hook — Maximize questions-before-answers: open loops, puzzles, delayed resolutions
- practitioner_orient — Shift from "what X is" to "how to use X": decision frameworks, pitfalls

**Structural Innovation Strategies:**
- zoom_lens — Alternate macro (big picture) and micro (specific detail) throughout
- progressive_disclosure — Layer information: complete-but-simple first, then deepen each section
- contrast_frame — Explain via comparison: what it is vs. isn't, before vs. after, alternatives

**Quality & Precision Strategies:**
- precision_tighten — Eliminate hedge words, vague quantifiers, weasel phrases; replace with specific claims
- coherence_thread — Ensure every paragraph's last sentence connects to next paragraph's first
- sensory_concretize — Replace abstract verbs/nouns with vivid, specific language (word-level, not examples)

**Meta/Experimental Strategies:**
- compression_distill — Produce shorter version preserving all key information
- expansion_elaborate — Triple depth of thinnest section while keeping others stable
- first_principles — Rewrite assuming zero domain knowledge; derive everything from basics

### Infrastructure Changes:
- Create a formal strategy registry/enum replacing the current string-based `Record<string, StrategyDef>`
- Wire up the existing but unused `generationGuidance` weighted random selection in dispatch
- Update cost estimation (EMPIRICAL_OUTPUT_CHARS) for new strategies
- Update UI palette (STRATEGY_PALETTE) with colors for new strategies
- Update GENERATION_STRATEGIES array in strategies page
- Update test fixtures and documentation

## High Level Summary

### Research Rounds Completed
- **Round 1 (4 agents):** Current strategy system — STRATEGY_DEFS, dispatch loop, cost estimation, schemas
- **Round 2 (4 agents):** Prompt patterns, sample content analysis, registry design patterns, test infrastructure
- **Round 3 (4 agents):** Evolve strategies (unimplemented), hardcoded strategy references, generationGuidance gap, UI strategy picker
- **Round 4 (4 agents):** Weighted selection implementation, format validation risks, GenerationGuidanceField UI, buildRunContext flow

### Current Strategy System Architecture

**Strategy Definition:** Strategies are defined as a `Record<string, StrategyDef>` in `generateFromSeedArticle.ts` (lines 31-44). Each StrategyDef has two fields:
- `preamble` — role/context for the LLM (e.g., "You are an expert writing editor...")
- `instructions` — specific transformation task

**Only 3 of 8 documented strategies are implemented:**
1. `structural_transform` — Aggressively restructures text organization
2. `lexical_simplify` — Simplifies language and shortens sentences
3. `grounding_enhance` — Makes abstract text concrete with examples

The 5 "extended" strategies (engagement_amplify, style_polish, argument_fortify, narrative_weave, tone_transform) exist in UI arrays and cost estimation but have NO prompt definitions in `STRATEGY_DEFS`.

**Strategy Selection:** Round-robin via `strategies[i % strategies.length]` at dispatch. The `generationGuidance` weighted selection feature is fully schema-defined and stored in config but NEVER consumed in the dispatch loop.

**Prompt Construction Flow:**
1. Strategy name → `STRATEGY_DEFS[strategy]` lookup
2. Returns `{preamble, instructions}` or null (unknown strategy)
3. `buildEvolutionPrompt(preamble, 'Original Text', text, instructions)` assembles full prompt
4. FORMAT_RULES injected at end of every prompt
5. Final line: "Output ONLY the improved text, no explanations."

### Files That Hardcode Strategy Names (7 locations)

| File | What | Action Needed |
|------|------|---------------|
| `evolution/src/lib/core/agents/generateFromSeedArticle.ts` | `STRATEGY_DEFS` dict (3 entries) | Add 16 new StrategyDef entries |
| `evolution/src/lib/schemas.ts` | `DEFAULT_GENERATE_STRATEGIES` array | Decide if expand beyond 3 |
| `evolution/src/lib/pipeline/infra/estimateCosts.ts` | `EMPIRICAL_OUTPUT_CHARS` dict | Add 16 entries (use DEFAULT_OUTPUT_CHARS=9197 initially) |
| `src/app/admin/evolution/strategies/page.tsx` | `GENERATION_STRATEGIES` array (8 entries) | Add 16 new names |
| `evolution/src/components/evolution/visualizations/VariantCard.tsx` | `STRATEGY_PALETTE` color map | Add 16 color entries |
| `evolution/src/testing/executionDetailFixtures.ts` | Test fixtures | Add fixture entries |
| `evolution/docs/agents/overview.md` | Strategy documentation | Add descriptions |

### generationGuidance Gap

The gap is at `runIterationLoop.ts` lines 474-481. Config carries `generationGuidance` from DB → `buildRunContext` → `EvolutionConfig` → `resolvedConfig`, but the dispatch loop uses `strategies[i % strategies.length]` (round-robin) and never reads `generationGuidance`. Insertion point: replace modulo selection with weighted random using `deriveSeed()` for reproducibility.

### Key Architectural Insights

1. **No evolve.ts exists** — mutate_clarity, crossover etc. are documented but unimplemented. Only generation strategies are active.
2. **Strategies are just strings** — no validation against STRATEGY_DEFS at setup time; fails at generation time
3. **Format validation is free** — regex/string parsing, no LLM calls. Strategy-specific failure rates unknown.
4. **Cost estimation graceful fallback** — unknown strategies use DEFAULT_OUTPUT_CHARS (9197 chars)
5. **DB tracking works via `Variant.strategy`** → `evolution_variants.agent_name` column
6. **run_summary.strategyEffectiveness** computes per-strategy avgElo ± SE via Welford's algorithm
7. **Dashboard visibility**: strategy effectiveness on run Metrics tab, lineage graph color-codes by strategy

## Prompt Engineering Patterns

### Template for New Strategy Prompts
All existing preambles follow: `"You are an expert [ROLE]. [DIRECTIVE VERB + MODALITY]."` (1 sentence)
All instructions follow: `[Action verbs] → [Strategy-specific guidance] → [Core constraint: preserve meaning] → [Output directive]`

FORMAT_RULES are injected automatically by `buildEvolutionPrompt()` — no need to repeat in instructions. However, high-risk strategies should add explicit anti-list/anti-table guidance in their instructions.

### Format Validation Risk Tiers

| Tier | Strategies | Risk | Mitigation |
|------|-----------|------|------------|
| CRITICAL | compression_distill | Lost headings, short paragraphs | "MUST retain all ## headings; compress via pruning paragraphs, not structure" |
| HIGH | pedagogy_scaffold, practitioner_orient, counterpoint_integrate | Numbered steps, bullet objections, decision tables | "Use narrative transitions, not enumeration" |
| MEDIUM | expansion_elaborate, zoom_lens, progressive_disclosure, contrast_frame, curiosity_hook | Accidental lists when elaborating/comparing | "Embed sequences in paragraph prose" |
| LOW | analogy_bridge, expert_deepdive, historical_context, precision_tighten, coherence_thread, sensory_concretize, first_principles | Naturally paragraph-focused | Standard FORMAT_RULES sufficient |

### Format Validation Rules (from enforceVariantFormat.ts)
1. **H1 title** — exactly one `# Title` on first non-empty line
2. **Section headings** — at least one `##` or `###`
3. **No bullets** — rejects `- `, `* `, `+ ` (after stripping code blocks + horizontal rules)
4. **No numbered lists** — rejects `1. `, `2) ` etc.
5. **No tables** — rejects `|...|` lines
6. **2+ sentences per paragraph** — 25% tolerance (up to 25% of paragraphs can be short)

## Registry Design (Recommended Pattern)

Based on codebase conventions (METRIC_CATALOG, agentNames.ts, entityRegistry.ts), the recommended pattern is:

```typescript
// evolution/src/lib/core/strategyRegistry.ts

export const STRATEGY_REGISTRY = {
  structural_transform: { name: 'structural_transform', label: 'Structural Transform', category: 'core', preamble: '...', instructions: '...' },
  // ... all 19+ entries
} as const satisfies Record<string, StrategyDef>;

export type StrategyName = keyof typeof STRATEGY_REGISTRY;
export const STRATEGY_NAMES = Object.keys(STRATEGY_REGISTRY) as StrategyName[];

export function getStrategy(name: string): StrategyDef | undefined { ... }
export function isValidStrategyName(name: string): name is StrategyName { ... }
```

This matches METRIC_CATALOG's `as const satisfies Record<...>` pattern and derives types from keys.

## Weighted Selection Implementation

### Current Gap
`generationGuidance` flows: DB → `buildRunContext.ts:258` → `EvolutionConfig` → `resolvedConfig` → NEVER CONSUMED. Dispatch at `runIterationLoop.ts:481` always uses `strategies[i % strategies.length]`.

### Implementation Plan
**Insertion point:** `runIterationLoop.ts` line 481, replace round-robin with conditional:

```typescript
const strategy = resolvedConfig.generationGuidance
  ? selectStrategyWeighted(resolvedConfig.generationGuidance, agentRng)
  : strategies[i % strategies.length]!;
```

**selectStrategyWeighted():** Normalize percentages → cumulative distribution → `rng.next()` picks bucket. Use `SeededRandom(deriveSeed(randomSeed, 'iter${iteration}', 'strategy${i}'))` for reproducibility.

### Validation Gap
`buildRunContext` does NOT validate strategy names against STRATEGY_DEFS. The registry should add validation after Zod parsing succeeds, before returning config.

## Sample Content Characteristics
- **api_design_sections.md:** ~9,200 chars, 6 sections, professional technical docs. Already well-structured — new strategies show moderate improvement.
- **filler_words.md:** ~1,800 chars, degraded version with heavy filler words. New strategies show **major improvement** — ideal test harness for strategy efficacy.

## Test Infrastructure Summary
- **58+ test files** with ~500+ assertions
- **Key test patterns:** Parametrized `it.each()` for strategy coverage, mock LLM with configurable responses, VALID_VARIANT_TEXT fixture
- **New tests needed:** ~60-75 new test cases (parametrized per strategy + integration + edge cases)
- **Existing test for unknown strategies:** Already verifies `generation_failed` status for unrecognized strategy names

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (all 17 evolution docs)
- evolution/docs/README.md
- evolution/docs/architecture.md
- evolution/docs/arena.md
- evolution/docs/data_model.md
- evolution/docs/strategies_and_experiments.md
- evolution/docs/cost_optimization.md
- evolution/docs/agents/overview.md
- evolution/docs/metrics.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/entities.md
- evolution/docs/logging.md
- evolution/docs/curriculum.md
- evolution/docs/minicomputer_deployment.md
- evolution/docs/visualization.md
- evolution/docs/reference.md
- evolution/docs/sample_content/api_design_sections.md
- evolution/docs/sample_content/filler_words.md

## Code Files Read

### Round 1-2 (initialization + first research)
- evolution/src/lib/core/agents/generateFromSeedArticle.ts — FULL FILE: StrategyDef type, STRATEGY_DEFS (3 entries), buildPromptForStrategy, execute(), deepCloneRatings, detailViewConfig, invocationMetrics
- evolution/src/lib/pipeline/loop/runIterationLoop.ts — Lines 150-550: strategy resolution, budget-aware dispatch, parallel/sequential fallback, generationGuidance gap at line 481
- evolution/src/lib/pipeline/loop/buildPrompts.ts — buildEvolutionPrompt, feedbackSection helper
- evolution/src/lib/shared/enforceVariantFormat.ts — FULL FILE: FORMAT_RULES, validateFormat(), all rule functions, 25% tolerance, code block stripping
- evolution/src/lib/pipeline/infra/estimateCosts.ts — FULL FILE: EMPIRICAL_OUTPUT_CHARS, DEFAULT_OUTPUT_CHARS=9197, all 4 estimation functions
- evolution/src/lib/pipeline/setup/buildRunContext.ts — FULL FILE: strategy load from DB, Zod parsing, generationGuidance passthrough, validation gap
- evolution/src/lib/schemas.ts — Strategy-related sections: DEFAULT_GENERATE_STRATEGIES (line 430), generationGuidanceSchema (line 304), strategyConfigSchema (line 357), evolutionConfigSchema (line 437)
- evolution/src/lib/pipeline/finalize/persistRunResults.ts — buildRunSummary, strategyEffectiveness via Welford's, variant persistence
- evolution/src/lib/types.ts — Variant type, strategy field
- evolution/src/lib/pipeline/infra/types.ts — EvolutionConfig and StrategyConfig type definitions

### Round 3-4 (deep research)
- evolution/src/components/evolution/visualizations/VariantCard.tsx — STRATEGY_PALETTE (11 entries), color application via borderLeftColor
- evolution/src/components/evolution/visualizations/LineageGraph.tsx — Imports STRATEGY_PALETTE for node circle fills
- src/app/admin/evolution/strategies/page.tsx — GENERATION_STRATEGIES (8 entries), GenerationGuidanceField component, percentage validation, duplicate prevention
- src/app/admin/evolution/_components/ExperimentForm.tsx — Strategy picker in experiment wizard
- evolution/src/lib/shared/seededRandom.ts — FULL FILE: SeededRandom class (xorshift64*), deriveSeed() via SHA-256
- evolution/src/lib/core/entityRegistry.ts — Lazy-init singleton Record pattern
- evolution/src/lib/core/agentRegistry.ts — Agent class registry pattern
- evolution/src/lib/core/agentNames.ts — AgentName typed union + COST_METRIC_BY_AGENT lookup
- evolution/src/lib/core/metricCatalog.ts — METRIC_CATALOG `as const satisfies Record<...>` pattern
- evolution/src/lib/core/detailViewConfigs.ts — DETAIL_VIEW_CONFIGS Record<string, DetailFieldDef[]>
- evolution/src/testing/executionDetailFixtures.ts — 10 execution detail fixtures
- evolution/src/testing/v2MockLlm.ts — Mock LLM with label-based responses
- evolution/src/testing/evolution-test-helpers.ts — Factory helpers, VALID_VARIANT_TEXT
- evolution/src/lib/core/agents/generateFromSeedArticle.test.ts — 16 describe blocks, 20+ tests
- evolution/src/lib/pipeline/loop/runIterationLoop.test.ts — 18+ describe blocks, strategy cycling tests
- evolution/src/lib/schemas.test.ts — 70+ tests including generationGuidance validation
- evolution/docs/sample_content/api_design_sections.md — Sample well-structured article (~9,200 chars)
- evolution/docs/sample_content/filler_words.md — Sample degraded article (~1,800 chars)
