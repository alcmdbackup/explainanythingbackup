# Clean Up Evolution Docs Strategy And Update Plan

## Background

The evolution pipeline documentation spans 9 files (2,006 lines) in `docs/feature_deep_dives/`. The largest file (`evolution_pipeline.md`, 599 lines) acts as a "master summary" that duplicates content from all 8 other docs. Configuration, feature flags, budget caps, Key Files tables, and database tables are each restated in 3-5 docs. The goal is to create a dedicated `docs/evolution/` folder and reorganize so each doc is mutually exclusive — a single source of truth for its topic.

## Problem

1. **Redundancy**: Config values, feature flags, agent descriptions, Key Files tables, and database tables are copy-pasted across multiple docs instead of cross-referenced
2. **evolution_pipeline.md is a monolith**: At 599 lines (30% of all content, ~40% unique / 30% duplicated / 30% reference), it summarizes everything from the other 8 docs, making it unclear where the "real" documentation lives
3. **No clear hierarchy**: All 9 docs sit flat in `docs/feature_deep_dives/` alongside 24 unrelated docs, with no visual grouping
4. **Cross-references are fragile**: 29 internal links use relative paths (`./filename.md`) that will break if files move
5. **5 agents are undocumented**: ReflectionAgent, DebateAgent, EvolutionAgent, ProximityAgent, MetaReviewAgent have no standalone docs
6. **Budget cap error**: `iterative_editing_agent.md` claims 10% budget but code says 5% (`config.ts:iterativeEditing: 0.05`)
7. **2 orphan docs**: `evolution_framework.md` and `evolution_pipeline_visualization.md` have no Related Documentation section

## Decision

**Option B** — New `docs/evolution/` folder with reorganized content. Confirmed by code structure validation: all 13 proposed docs map cleanly to actual code files under `src/lib/evolution/`, `src/lib/services/`, `src/components/evolution/`, and `scripts/`.

## Proposed New Structure

```
docs/evolution/
├── README.md                      # Index/entry point with reading order
├── architecture.md                # Pipeline orchestration, phases, stopping conditions, checkpoint/resume
│                                  # Source: evolution_pipeline.md lines 1-23, 48-49, 100-125, 178-277
│                                  # Code: pipeline.ts, supervisor.ts, pool.ts, diversityTracker.ts, validation.ts
├── data_model.md                  # Prompts, strategies, runs, dimensional queries
│                                  # Source: evolution_framework.md (intact, 75 lines)
│                                  # Code: types.ts, state.ts, comparisonCache.ts, jsonParser.ts
├── rating_and_comparison.md       # OpenSkill, bias mitigation, Swiss tournament, calibration, comparison methods
│                                  # Source: evolution_pipeline.md lines 27-46, 161-169
│                                  # Code: rating.ts, tournament.ts, comparison.ts, diffComparison.ts
├── agents/
│   ├── overview.md                # AgentBase, ExecutionContext, agent interaction table, format validation
│   │                              # Source: evolution_pipeline.md lines 127-159, 279-303
│   │                              # Code: base.ts, calibrationRanker.ts, pairwiseRanker.ts, formatRules.ts, formatValidator.ts
│   ├── generation.md              # GenerationAgent + OutlineGenerationAgent
│   │                              # Source: outline_based_generation_editing.md (229 lines, minus duplicated config)
│   │                              # Code: generationAgent.ts, outlineGenerationAgent.ts
│   ├── editing.md                 # IterativeEditingAgent + SectionDecompositionAgent (merged)
│   │                              # Source: iterative_editing_agent.md + hierarchical_decomposition_agent.md
│   │                              # Code: iterativeEditingAgent.ts, sectionDecompositionAgent.ts, section/*
│   ├── tree_search.md             # TreeSearchAgent beam search
│   │                              # Source: tree_of_thought_revisions.md (90 lines, minus duplicated config)
│   │                              # Code: treeSearchAgent.ts, treeOfThought/*
│   └── support.md                 # ReflectionAgent, DebateAgent, EvolutionAgent, ProximityAgent, MetaReviewAgent
│                                  # Source: NEW — written from source code analysis + evolution_pipeline.md summaries
│                                  # Code: reflectionAgent.ts, debateAgent.ts, evolvePool.ts, proximityAgent.ts, metaReviewAgent.ts
├── hall_of_fame.md                # Hall of Fame, Elo K-32, prompt bank, 3 workflows
│                                  # Source: comparison_infrastructure.md (237 lines, intact)
│                                  # Code: strategyConfig.ts, promptRegistryActions.ts, hallOfFameActions.ts
├── cost_optimization.md           # Cost tracking, adaptive allocation, Pareto, batch experiments
│                                  # Source: elo_budget_optimization.md (294 lines, intact)
│                                  # Code: costTracker.ts, costEstimator.ts, adaptiveAllocation.ts
├── visualization.md               # Dashboard, 6 tabs, 8 server actions, components
│                                  # Source: evolution_pipeline_visualization.md (124 lines, intact + add Related Docs)
│                                  # Code: evolutionActions.ts, evolutionVisualizationActions.ts, 13+ components
└── reference.md                   # Single source of truth for cross-cutting concerns
                                   # Source: evolution_pipeline.md lines 170-176, 205-216, 304-561
                                   # Code: config.ts, llmClient.ts, logger.ts, featureFlags.ts
```

## Content Migration Map

| Current File | → New File(s) | What Moves | Lines |
|---|---|---|---|
| evolution_pipeline.md (599) | **Split into 5**: architecture.md, rating_and_comparison.md, agents/overview.md, reference.md + feeds agents/support.md | Orchestration → architecture. Rating/bias → rating_and_comparison. Agent table → agents/overview. Config/flags/DB/files/CLI/deploy → reference. Agent summaries → agents/support | ~240 unique, ~180 duplicated (removed), ~179 reference |
| evolution_framework.md (75) | data_model.md | All content moves intact. Add Related Documentation section | 75 |
| outline_based_generation_editing.md (229) | agents/generation.md | Agent logic moves. Remove duplicated: feature flag (3 mentions), budget cap (2 mentions), phase config, STRATEGY_TO_AGENT mapping. Replace with links to reference.md | ~200 (after dedup) |
| iterative_editing_agent.md (141) | agents/editing.md Part I | Unique content: edit loop, information barrier, truth table, CriticMarkup diff, step-aware editing. Remove duplicated flag/budget/phase. **Fix budget cap: 0.05 not 0.10** | ~120 (after dedup) |
| hierarchical_decomposition_agent.md (98) | agents/editing.md Part II | Unique content: section parser, stitcher, parallel edit, format validator. Remove duplicated flag/budget | ~80 (after dedup) |
| tree_of_thought_revisions.md (90) | agents/tree_search.md | Unique content: beam search, revision actions, collapse mitigation, 2-stage eval. Remove duplicated flag/budget/mutual-exclusivity | ~75 (after dedup) |
| comparison_infrastructure.md (237) | hall_of_fame.md | Renamed, content intact. No significant duplication found | 237 |
| elo_budget_optimization.md (294) | cost_optimization.md | Renamed, content intact. No significant duplication found | 294 |
| evolution_pipeline_visualization.md (124) | visualization.md | Renamed, content intact. Add Related Documentation section (currently orphan) | ~130 |
| *(new content)* | agents/support.md | Written from source code: ReflectionAgent, DebateAgent, EvolutionAgent/evolvePool, ProximityAgent, MetaReviewAgent | ~200-250 new |

## Deduplication Rules

Each cross-cutting concept has ONE authoritative location. All other docs link to it.

| Concept | Owner | Other docs say... |
|---|---|---|
| DEFAULT_EVOLUTION_CONFIG | reference.md | "See [Configuration](./reference.md#configuration)" |
| Feature flags table | reference.md | "See [Feature Flags](./reference.md#feature-flags)" |
| Budget caps per agent | reference.md | "Budget cap: 5% ([details](./reference.md#budget-caps))" |
| Database tables | reference.md | "See [Database Schema](./reference.md#database-schema)" |
| Key Files index | reference.md | Agent docs list ONLY their own files, not shared infrastructure |
| CLI commands | reference.md | Agent/feature docs reference `--flag` but CLI overview in reference |
| Format validation rules | agents/overview.md | Agent docs say "validated via [format rules](./agents/overview.md#format-validation)" |
| OpenSkill rating math | rating_and_comparison.md | Other docs say "rated via OpenSkill ([details](./rating_and_comparison.md))" |
| Comparison methods (bias mitigation, diff comparison) | rating_and_comparison.md | Agent docs say "judged via [bias-mitigated comparison](./rating_and_comparison.md#comparison-methods)" |
| Elo (K-32) for Hall of Fame | hall_of_fame.md | "Elo ranking per [Hall of Fame](./hall_of_fame.md#elo-rating-system)" |

## agents/editing.md Merge Structure

```markdown
# Content Editing Agents

## Overview
Two complementary agents apply critique-driven edits at different scopes.

## Shared Design Pattern
- Information barrier (editor knows weakness; judge sees only diff)
- Direction reversal bias mitigation (forward + reverse passes)
- Diff-based judging via compareWithDiff()

## Iterative Editing Agent (Whole-Article)
### Evaluate → Edit → Judge Loop
[Diagram from iterative_editing_agent.md]
### Direction Reversal Truth Table
[5-outcome table: ACCEPT/REJECT/UNSURE]
### CriticMarkup Diff Module
[ESM dynamic import, MDAST parsing]
### Step-Aware Editing for Outline Variants
[step: prefix targeting from outline_based_generation_editing.md interaction]
### Agent-Level Config
maxCycles=3, maxConsecutiveRejections=3, qualityThreshold=8
Budget cap: 5% (see reference.md) — NOTE: was incorrectly documented as 10%

## Section Decomposition Agent (Hierarchical)
### Parse → Filter → Parallel Edit → Stitch
[Diagram from hierarchical_decomposition_agent.md]
### Section Parser
[Regex split at H2, code block protection, round-trip invariant]
### Section Edit Runner
[Per-section critique→edit→judge, max 2 cycles, relaxed format validator]
### Budget Reservation Pattern
[Single upfront reservation before Promise.allSettled]

## Comparison Table
| Aspect | Iterative Editing | Section Decomposition |
| Scope | Whole article | Per H2 section |
| Parallelism | Sequential cycles | Promise.allSettled fan-out |
| Max cycles | 3 | 2 per section |
| Budget reservation | Per-edit | Once upfront |
| Budget cap | 5% | 10% |
```

## agents/support.md Content Outline

Written from source code analysis (5 currently undocumented agents):

```markdown
# Support Agents

## ReflectionAgent
- 5 fixed dimensions (clarity, structure, engagement, precision, coherence)
- Parallel LLM critiques of top 3 variants (~$0.024/run)
- 3 utility functions: getCritiqueForVariant, getWeakestDimension, getImprovementSuggestions

## DebateAgent
- 4-call flow: Advocate A → Advocate B → Judge (JSON verdict) → Synthesis variant
- Requires 2+ rated non-baseline variants
- Consumes ReflectionAgent critiques via formatCritiqueContext()
- Inspired by Google DeepMind AI Co-Scientist (arxiv 2502.18864)

## EvolutionAgent (evolvePool)
- 3 strategies: mutate_clarity, mutate_structure, crossover
- Creative exploration: 30% random OR diversity < 0.5
- Outline mutation: 2-call (mutate outline + expand) for OutlineVariants
- Stagnation detection: top-3 unchanged for 2 iterations
- Dominant strategy tracking: >1.5× average count

## ProximityAgent
- Sparse pairwise cosine similarity matrix
- diversityScore = 1 - mean(top-10 similarities)
- Embedding cache, two modes (test: MD5, production: character-based)
- Cost: ~$0.0001/embedding

## MetaReviewAgent
- Pure computation — no LLM calls, $0 cost
- 4 analyses: strategy performance, bottom-quartile weaknesses, failure detection (delta < -3), priority rules
- Produces MetaFeedback consumed by GenerationAgent and EvolutionAgent next iteration
- Priority thresholds: diversity < 0.3, ordinal range < 6 or > 30, stagnation
```

## Phased Execution Plan

### Phase 1: Create folder structure and reference.md
1. Create `docs/evolution/` and `docs/evolution/agents/`
2. Write `reference.md` by extracting cross-cutting content from `evolution_pipeline.md`:
   - Configuration block (lines 340-378)
   - Feature flags table (lines 380-395) — all 8 flags + cron flag
   - Budget caps table — from `budgetCaps` object. **Fix iterativeEditing to 0.05**
   - Budget enforcement (lines 170-176) — CostTracker, FIFO reservation, pause behavior
   - Format enforcement (lines 205-216) — FORMAT_VALIDATION_MODE env var
   - Edge cases & guards (lines 321-339)
   - EvolutionRunSummary schema (lines 304-320)
   - Database tables (lines 480-491) — 8 evolution + 4 hall of fame tables
   - Key Files master index (lines 397-478) — core, shared, agents, integration
   - CLI commands (lines 506-540) — batch runner, local CLI, prompt-based seeding
   - Production deployment (lines 499-505) — migrations, monitoring
   - Observability (lines 492-497) — OpenTelemetry, logging, heartbeat
   - Testing (lines 547-561) — test file inventory
   - Tiered model routing (lines 36-37) — judgeModel vs generationModel
   - Usage examples (lines 53-96) — queuing, running, admin UI
3. Write `README.md` with index and reading order
4. Commit

### Phase 2: Migrate core docs
1. Create `architecture.md` from evolution_pipeline.md:
   - Overview + ASCII diagram (lines 1-23)
   - Two-Phase Pipeline (lines 100-121) — EXPANSION→COMPETITION transitions
   - Two Pipeline Modes (lines 122-125) — executeFullPipeline vs executeMinimalPipeline
   - Append-Only Pool rationale (lines 48-49)
   - Checkpoint/Resume/Error Recovery (lines 178-194) — includes error recovery table
   - Stopping Conditions (lines 196-204) — 4 conditions
   - Data Flow (lines 222-277) — full pipeline execution flow
   - Known implementation gaps (lines 105, 112) — supervisor strategy routing
2. Create `data_model.md` from evolution_framework.md (75 lines intact, add Related Documentation)
3. Create `rating_and_comparison.md` from evolution_pipeline.md:
   - OpenSkill Bayesian Rating (lines 27-28)
   - Swiss-Style Tournament (lines 30-31) — info-theoretic pairing
   - Stratified Opponent Selection (lines 33-34) — quartile-based
   - LLM Response Cache (lines 39-40) — ComparisonCache
   - Position Bias mitigation (lines 42-43) — concurrent Promise.all
   - Adaptive Calibration (lines 45-46) — batched parallelism with early exit
   - Rating Updates (lines 161-169) — updateRating, updateDraw, confidence-weighted
   - **New section: Comparison Methods** — comparison.ts (bias-mitigated pairwise) + diffComparison.ts (CriticMarkup diff-based)
4. Commit

### Phase 3: Migrate agent docs
1. Create `agents/overview.md`:
   - Agent Framework from evolution_pipeline.md (lines 127-159) — AgentBase, ExecutionContext, async parallelism
   - Agent Interaction Table (lines 279-303) — reads/writes per agent + state lifecycle notes
   - **Format Validation section** — formatRules.ts, formatValidator.ts, FORMAT_VALIDATION_MODE reference
   - **Ranking Agents section** — CalibrationRanker and Tournament (brief, linking to rating_and_comparison.md)
2. Create `agents/generation.md` from outline_based_generation_editing.md:
   - Keep: 6-call pipeline, score parsing, error handling table, cost tracking, types, step-targeted mutation, StepScoreBar, CLI --outline, Hall of Fame metadata, prompt bank method
   - Remove: feature flag mentions (lines 7, 141, 207), budget cap (lines 132, 208), phase config (lines 125-128), STRATEGY_TO_AGENT mapping (lines 145-150) → link to reference.md
3. Create `agents/editing.md` merging iterative_editing_agent.md + hierarchical_decomposition_agent.md:
   - Shared Design Pattern section (information barrier, direction reversal, diff judging)
   - Part I: Iterative Editing — edit loop, truth table, CriticMarkup diff, step-aware editing, agent config
   - Part II: Section Decomposition — section parser, parallel edit, stitcher, format validator
   - Comparison table
   - Remove all duplicated flags/budgets → link to reference.md
   - **Fix**: iterativeEditing budget is 0.05 (5%), not 0.10 as currently documented
4. Create `agents/tree_search.md` from tree_of_thought_revisions.md:
   - Keep: beam search algorithm, 5 revision action types, collapse mitigation, 2-stage evaluation, root selection, visualization, BeamSearchConfig (K=3, B=3, D=3), cost estimate
   - Remove: feature flag (line 42), budget cap (line 44), mutual exclusivity note (line 43) → link to reference.md
5. Create `agents/support.md` — NEW content from source code analysis:
   - ReflectionAgent: 5 dimensions, parallel critiques, utility functions, ~$0.024/run
   - DebateAgent: 4-call debate flow, judge verdict JSON, ReflectionAgent integration, AI Co-Scientist reference
   - EvolutionAgent: 3 strategies, creative exploration (30%/diversity<0.5), outline mutation, stagnation detection
   - ProximityAgent: sparse similarity matrix, diversity score formula, embedding cache
   - MetaReviewAgent: 4 analysis types, MetaFeedback struct, priority thresholds, $0 cost
6. Commit

### Phase 4: Migrate infrastructure docs
1. Create `hall_of_fame.md` from comparison_infrastructure.md (237 lines intact — no duplication found)
2. Create `cost_optimization.md` from elo_budget_optimization.md (294 lines intact — minimal duplication)
3. Create `visualization.md` from evolution_pipeline_visualization.md (124 lines intact + add Related Documentation section)
4. Commit

### Phase 5: Update external references

#### 5a. Update `docs/docs_overall/architecture.md`
1. Update 3 existing evolution links (lines 101-103):
   - Line 101: `evolution_framework.md` → `../evolution/data_model.md`
   - Line 102: `evolution_pipeline_visualization.md` → `../evolution/visualization.md`
   - Line 103: `comparison_infrastructure.md` → `../evolution/hall_of_fame.md`
2. Add an "Evolution System" callout in the Feature Documentation section (~line 98) linking to `docs/evolution/README.md` as the entry point for all evolution docs

#### 5b. Update `docs/docs_overall/getting_started.md`
1. Add `docs/evolution/` row to the Documentation Structure table (after `docs/feature_deep_dives/`) with description: "Evolution pipeline architecture, agents, rating, and cost optimization"
2. Update feature_deep_dives file count (line 16: "24 detailed feature implementation docs" → adjusted count after 9 files moved out)

#### 5c. Update `docs/docs_overall/instructions_for_updating.md`
1. Update file count (line 29: "All 17 files" → adjusted count for feature_deep_dives after 9 removed)
2. Add new section for `docs/evolution/` folder with update guidelines (13 files)
3. Note: `white_paper.md` is locked ("Do NOT Update") — no changes needed there

#### 5d. Update `docs/feature_deep_dives/admin_panel.md`
- Add links to evolution docs from route descriptions (lines 160-175)

#### 5e. Update `docs/feature_deep_dives/testing_setup.md`
- Add links to reference.md from evolution test references (lines 21, 99, 105-107, 353-363)

#### 5f. Update `docs/docs_overall/environments.md`
- Add links from evolution batch runner and DEEPSEEK_API_KEY references

#### 5g. Commit

### Phase 6: Update doc-mapping.json
1. Update all **19** evolution-related entries (not 16 — 3 additional decomposition entries) in `.claude/doc-mapping.json`:
   - Change `docs/feature_deep_dives/` → `docs/evolution/` prefix
   - Change old filenames to new filenames per migration map
2. Add **8 new entries** for currently unmapped agent files:
   - `src/lib/evolution/agents/*iterative*.ts` → `docs/evolution/agents/editing.md`
   - `src/lib/evolution/agents/*section*.ts` → `docs/evolution/agents/editing.md`
   - `src/lib/evolution/section/**` → `docs/evolution/agents/editing.md`
   - `src/lib/evolution/diffComparison.ts` → `docs/evolution/agents/editing.md`
   - `src/lib/evolution/agents/*treeSearch*.ts` → `docs/evolution/agents/tree_search.md`
   - `src/lib/evolution/agents/*debate*.ts` → `docs/evolution/agents/support.md`
   - `src/lib/evolution/agents/*reflect*.ts` → `docs/evolution/agents/support.md`
   - `src/lib/evolution/agents/*metaReview*.ts` → `docs/evolution/agents/support.md`
3. Verify patterns still match correctly
4. Commit

### Phase 7: Delete old files and verify
1. Remove all 9 evolution docs from `docs/feature_deep_dives/`
2. Final cross-reference check:
   - `grep -r "feature_deep_dives/evolution" docs/`
   - `grep -r "feature_deep_dives/comparison_infrastructure" docs/`
   - `grep -r "feature_deep_dives/elo_budget" docs/`
   - `grep -r "feature_deep_dives/iterative_editing" docs/`
   - `grep -r "feature_deep_dives/hierarchical_decomposition" docs/`
   - `grep -r "feature_deep_dives/outline_based" docs/`
   - `grep -r "feature_deep_dives/tree_of_thought" docs/`
3. Verify all new docs have Related Documentation sections (no orphans)
4. Commit

## Known Issues to Fix During Migration

1. **iterative_editing_agent.md line 87**: Budget cap is 0.05 (5%), not 0.10 (10%) — fix when creating agents/editing.md
2. **evolution_framework.md**: No Related Documentation section — add when creating data_model.md
3. **evolution_pipeline_visualization.md**: No Related Documentation section — add when creating visualization.md
4. **Two rating systems undocumented**: OpenSkill (pipeline) vs Elo K-32 (Hall of Fame) distinction should be explicit in rating_and_comparison.md

## Testing

- **No code changes** — this is a docs-only project
- **Manual verification**: Grep for broken cross-references (`grep -r "feature_deep_dives/evolution" docs/`)
- **doc-mapping.json validation**: Ensure all glob patterns resolve correctly
- **Link check**: Verify all `Related Documentation` links in new docs resolve
- **Orphan check**: Every new doc must have a Related Documentation section

## Documentation Updates

All 9 evolution docs will be moved/reorganized:
- `docs/feature_deep_dives/evolution_framework.md` → `docs/evolution/data_model.md`
- `docs/feature_deep_dives/evolution_pipeline.md` → Split into `architecture.md`, `rating_and_comparison.md`, `agents/overview.md`, `reference.md` + feeds `agents/support.md`
- `docs/feature_deep_dives/tree_of_thought_revisions.md` → `docs/evolution/agents/tree_search.md`
- `docs/feature_deep_dives/evolution_pipeline_visualization.md` → `docs/evolution/visualization.md`
- `docs/feature_deep_dives/elo_budget_optimization.md` → `docs/evolution/cost_optimization.md`
- `docs/feature_deep_dives/outline_based_generation_editing.md` → `docs/evolution/agents/generation.md`
- `docs/feature_deep_dives/hierarchical_decomposition_agent.md` → merged into `docs/evolution/agents/editing.md`
- `docs/feature_deep_dives/iterative_editing_agent.md` → merged into `docs/evolution/agents/editing.md`
- `docs/feature_deep_dives/comparison_infrastructure.md` → `docs/evolution/hall_of_fame.md`

External docs needing link updates:
- `docs/docs_overall/architecture.md` (3 links)
- `docs/docs_overall/getting_started.md`
- `docs/docs_overall/instructions_for_updating.md`
- `docs/docs_overall/environments.md`
- `docs/feature_deep_dives/admin_panel.md`
- `docs/feature_deep_dives/testing_setup.md`
- `.claude/doc-mapping.json` (19 existing entries + 8 new entries)
