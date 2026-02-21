# Clean Up Evolution Docs Strategy And Update Research

**Date**: 2026-02-09
**Git Commit**: c9dd696
**Branch**: chore/clean_up_evolution_docs_strategy_and_update_20260209

## Problem Statement

The user wants to create an entirely separate docs folder for evolution content, then reorganize and consolidate the 9 evolution-related docs so files are more mutually exclusive instead of overlapping.

## High Level Summary

The evolution documentation currently spans 9 files totaling ~2,006 lines in `docs/feature_deep_dives/`. These files have significant content overlap — especially in configuration, feature flags, budget caps, Key Files tables, and database tables. The largest file (`evolution_pipeline.md` at 599 lines) acts as a "master doc" that summarizes content from all 8 other files, creating a situation where every piece of information exists in at least 2 places.

The analysis reveals clean **natural topic boundaries** that could form the basis of a reorganized docs folder. The 9 docs currently serve 5 distinct layers: execution, data model, quality analysis, cost optimization, and visualization — plus 4 agent-specific docs that detail individual editing strategies.

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/docs_overall/instructions_for_updating.md

### Evolution Docs (all 9)
- docs/feature_deep_dives/evolution_pipeline.md (599 lines)
- docs/feature_deep_dives/evolution_framework.md (75 lines)
- docs/feature_deep_dives/comparison_infrastructure.md (237 lines)
- docs/feature_deep_dives/elo_budget_optimization.md (294 lines)
- docs/feature_deep_dives/evolution_pipeline_visualization.md (124 lines)
- docs/feature_deep_dives/outline_based_generation_editing.md (229 lines)
- docs/feature_deep_dives/hierarchical_decomposition_agent.md (98 lines)
- docs/feature_deep_dives/iterative_editing_agent.md (141 lines)
- docs/feature_deep_dives/tree_of_thought_revisions.md (90 lines)

### Support Docs
- .claude/doc-mapping.json (346 lines, 16 evolution-related mapping entries)

## Code Files Read
- .claude/doc-mapping.json (current code-to-doc mapping configuration)

---

## Detailed Findings

### 1. Current File Size & Proportion

| File | Lines | % of Total |
|------|-------|-----------|
| evolution_pipeline.md | 599 | 30% |
| elo_budget_optimization.md | 294 | 15% |
| comparison_infrastructure.md | 237 | 12% |
| outline_based_generation_editing.md | 229 | 11% |
| iterative_editing_agent.md | 141 | 7% |
| evolution_pipeline_visualization.md | 124 | 6% |
| hierarchical_decomposition_agent.md | 98 | 5% |
| tree_of_thought_revisions.md | 90 | 4% |
| evolution_framework.md | 75 | 4% |
| **Total** | **2,006** | **100%** |

`evolution_pipeline.md` is nearly as large as all other docs combined. It contains summary-level coverage of almost everything in the other 8 docs.

### 2. Content Overlap Map

The heaviest overlap categories, ranked by redundancy:

**A. Configuration (DEFAULT_EVOLUTION_CONFIG)**
- evolution_pipeline.md: Full config block (lines 344-375)
- elo_budget_optimization.md: References same values in optimization context
- outline_based_generation_editing.md: Budget cap adjustment details
- Individual agent docs: Each repeats their own budget cap percentage

**B. Feature Flags**
- evolution_pipeline.md: Master table of 8 flags (lines 380-395)
- outline_based_generation_editing.md: Repeats `outline_generation_enabled`
- tree_of_thought_revisions.md: Repeats `tree_search_enabled`
- hierarchical_decomposition_agent.md: Repeats `section_decomposition_enabled`
- iterative_editing_agent.md: Repeats `iterative_editing_enabled`

**C. Key Files Tables**
Most-repeated file entries across docs:
- `evolution_runs` table: mentioned in 5 docs
- `evolution_variants` table: mentioned in 5 docs
- `src/lib/evolution/core/pipeline.ts`: mentioned in 4 docs
- `src/lib/evolution/types.ts`: mentioned in 3 docs
- `src/lib/evolution/config.ts`: mentioned in 3 docs
- `src/lib/evolution/comparison.ts`: mentioned in 3 docs
- `scripts/run-evolution-local.ts`: mentioned in 3 docs

**D. Agent Descriptions**
- evolution_pipeline.md has a 20-row Agent Interaction Pattern table (lines 283-296) that summarizes what each agent reads/writes
- Each agent doc then re-describes this in more detail
- Both evolution_pipeline.md and outline_based_generation_editing.md describe the step-targeted edit mechanism

**E. Database Tables**
- evolution_pipeline.md: Lists 8+ tables (lines 480-490)
- evolution_framework.md: Repeats `evolution_strategy_configs`, `evolution_runs`
- comparison_infrastructure.md: Repeats `hall_of_fame_*` 4 tables
- elo_budget_optimization.md: Repeats `evolution_run_agent_metrics`

**F. Bias Mitigation**
- evolution_pipeline.md: Position bias (A/B reversal)
- iterative_editing_agent.md: Direction-reversal (CriticMarkup diff)
- comparison_infrastructure.md: Order-invariant SHA-256 caching
- All three describe related but distinct bias mitigation mechanisms

### 3. Natural Topic Boundaries (What Each Doc Uniquely Owns)

| Doc | Unique Ownership |
|-----|-----------------|
| **evolution_pipeline.md** | Pipeline orchestration, agent framework (AgentBase), OpenSkill rating internals, phase transitions (EXPANSION→COMPETITION), checkpoint/resume, stopping conditions, format enforcement, run summary schema |
| **evolution_framework.md** | Data model primitives (Prompt, Strategy, Run, Article), dimensional query system, strategy hash dedup, version-on-edit, NOT NULL enforcement, prompt/strategy registries |
| **comparison_infrastructure.md** | Hall of Fame system, K-32 Elo rating (distinct from OpenSkill), multi-provider LLM support, 3 workflows (1-shot/evolution/comparison), prompt bank config, admin UI for topics/leaderboard |
| **elo_budget_optimization.md** | Cost estimation, adaptive allocation, Pareto frontier, batch experiment planning, strategy identity (hash/label), optimization dashboard |
| **evolution_pipeline_visualization.md** | Admin dashboard UI, 6 tab components, 8 visualization server actions, auto-refresh polling, D3+React hybrid, checkpoint-based lineage rendering |
| **outline_based_generation_editing.md** | 6-call pipeline (outline→score→expand→score→polish→score), step-level scoring, OutlineVariant type, step-targeted mutation, partial failure handling |
| **hierarchical_decomposition_agent.md** | Section-level decomposition, H2 parsing, parallel section edits, stitching, section format validator |
| **iterative_editing_agent.md** | Critique-driven linear editing, information barrier, direction-reversal bias, CriticMarkup diff judge, step-aware editing for outline variants |
| **tree_of_thought_revisions.md** | Beam search (K=3, B=3, D=3), revision action diversity, beam collapse mitigation, ancestry diversity slot |

### 4. Cross-Reference Graph

```
evolution_pipeline.md (HUB — 6 outbound links)
  ├── → outline_based_generation_editing.md (3 refs)
  ├── → testing_setup.md (external)
  ├── → admin_panel.md (external)
  ├── → metrics_analytics.md (external)
  ├── → request_tracing_observability.md (external)
  └── → search_generation_pipeline.md (external)

iterative_editing_agent.md (5 outbound links — most connected agent doc)
  ├── → evolution_pipeline.md
  ├── → hierarchical_decomposition_agent.md
  ├── → comparison_infrastructure.md
  ├── → outline_based_generation_editing.md
  └── → tree_of_thought_revisions.md

ORPHAN DOCS (no outbound Related Documentation section):
  - evolution_framework.md
  - evolution_pipeline_visualization.md
```

### 5. External Docs Referencing Evolution

These non-evolution docs contain evolution references and would need link updates if docs move:

| External Doc | Evolution References | Needs Link Update? |
|--------------|---------------------|-------------------|
| **architecture.md** | Lines 101-103: Feature index links to evolution_framework.md, evolution_pipeline_visualization.md, comparison_infrastructure.md. Lines 154-160: Hall of Fame table descriptions | YES — must update links |
| **admin_panel.md** | Lines 160-175: Lists 7 evolution admin routes, EvolutionSidebar component | YES — must update links |
| **testing_setup.md** | Lines 21, 105-107, 353-360: Evolution integration tests, evolution-test-helpers.ts | YES — must update links |
| **environments.md** | Lines 145-152: evolution-batch.yml workflow. Lines 189, 278: DEEPSEEK_API_KEY | YES — references workflow |
| **getting_started.md** | Line 16: Links to feature_deep_dives/ (generic) | Minimal — just a directory reference |
| **instructions_for_updating.md** | Lines 29-30: "All 17 files should be updated" count | YES — file count changes |

### 6. doc-mapping.json Evolution Entries

The current `.claude/doc-mapping.json` has 16 entries mapping code files to evolution docs. Key patterns:

- `src/lib/services/evolution*.ts` → 5 docs (pipeline, visualization, comparison, iterative, elo)
- `src/lib/evolution/**` → 5 docs (pipeline, framework, comparison, iterative, elo)
- `src/lib/services/promptRegistryActions.ts` → evolution_framework.md
- `src/lib/services/strategyRegistryActions.ts` → evolution_framework.md
- `src/lib/evolution/agents/*outline*.ts` → outline_based_generation_editing.md
- `src/lib/evolution/treeOfThought*.ts` → tree_of_thought_revisions.md
- `src/components/evolution/**` → 3 docs (visualization, comparison, elo)
- `scripts/evolution*.ts` → 2 docs (pipeline, elo)

All paths would need updating to the new docs folder location.

### 7. Two Separate Rating Systems

A notable finding: the codebase uses **two distinct rating systems** that are documented in different places:

1. **OpenSkill (Bayesian)**: Used within the evolution pipeline for variant ranking. `mu=25, sigma=8.333`, ordinal = `mu - 3*sigma`. Documented in `evolution_pipeline.md`.
2. **Elo (K-factor 32)**: Used in the Hall of Fame for cross-method comparison. Initial rating 1200. Documented in `comparison_infrastructure.md`.

These are **separate systems** — OpenSkill rates variants within a single run, Elo rates articles across the Hall of Fame. This distinction is not clearly documented anywhere.

### 8. Documentation Clusters

The 9 docs naturally form 3 clusters:

**Cluster A: Core Pipeline (tightly coupled)**
- evolution_pipeline.md (orchestration)
- evolution_framework.md (data model)
- elo_budget_optimization.md (cost analysis)
- evolution_pipeline_visualization.md (UI)

**Cluster B: Editing Agents (peer alternatives)**
- iterative_editing_agent.md (linear critique-edit-judge)
- hierarchical_decomposition_agent.md (parallel section edits)
- tree_of_thought_revisions.md (beam search exploration)
- outline_based_generation_editing.md (step-level generation)

**Cluster C: Quality Infrastructure (cross-cutting)**
- comparison_infrastructure.md (Hall of Fame + Prompt Bank)

---

## Open Questions

1. Should the new folder be `docs/evolution/` at the same level as `docs/feature_deep_dives/`, or a subfolder like `docs/feature_deep_dives/evolution/`?
2. Should `comparison_infrastructure.md` move to the evolution folder? It covers the Hall of Fame which is tightly coupled to evolution but conceptually could be a standalone quality system.
3. Should `evolution_pipeline.md` be split into smaller files (since it's 30% of all content and duplicates most other files), or kept as a single "overview" doc with cross-references?
4. How should the `doc-mapping.json` entries be updated — keep pointing to feature_deep_dives/ or update all 16 entries?
5. Should the external references (architecture.md, admin_panel.md, testing_setup.md, environments.md) be updated immediately or left with redirect notes?

---

## Deep-Dive Analysis (Round 2)

### 9. evolution_pipeline.md Section-by-Section Breakdown

The 599-line monolith breaks down into content that is **40% unique, 30% duplicated, 30% reference material**.

#### Unique Content (only in evolution_pipeline.md, ~240 lines)

| Section | Lines | Content |
|---------|-------|---------|
| Overview ASCII diagram | 3-23 | EXPANSION→COMPETITION phase transition with full agent roster |
| Swiss-Style Tournament details | 30-31 | Info-theoretic pairing: outcome uncertainty + sigma weighting + top-K boost |
| Stratified Opponent Selection | 33-34 | Quartile-based opponent tier allocation (2 top, 2 middle, 1 bottom) |
| Tiered Model Routing | 36-37 | judgeModel vs generationModel cost optimization (4x cheaper judge) |
| Position Bias concurrent execution | 42-43 | Promise.all for forward+reverse rounds (halves wall-clock time) |
| Adaptive Calibration | 45-46 | Batched parallelism with early exit (~40% LLM call reduction) |
| Append-Only Pool rationale | 48-49 | Why variants stay (future crossover utility) |
| Error Recovery paths table | 187-193 | Failure mode → pipeline behavior → recovery matrix |
| Format Enforcement | 205-216 | FORMAT_VALIDATION_MODE env var (reject/warn/off) |
| EvolutionRunSummary schema | 304-320 | Complete schema breakdown |
| Edge Cases & Guards | 321-339 | Min pool sizes, format edge cases, budget edge cases |
| Known implementation gaps | 105, 112 | Supervisor strategy routing not consumed by GenerationAgent |
| ordinalHistory clearing | 182 | Cleared on EXPANSION→COMPETITION transition |

#### Duplicated Content (~180 lines)

| Content | Lines | Duplicated In | Level |
|---------|-------|--------------|-------|
| OpenSkill rating system | 27-28 | comparison_infrastructure.md | HIGH |
| Position Bias reversal | 42-43 | iterative_editing_agent.md (deeper truth table there) | HIGH |
| OutlineGenerationAgent summary | 23, 113-115, 244 | outline_based_generation_editing.md (full detail) | HIGH |
| IterativeEditingAgent overview | 115 | iterative_editing_agent.md (full detail) | HIGH |
| Budget enforcement | 170-176 | elo_budget_optimization.md | HIGH |
| Feature flags | 381-395 | 4 agent docs each repeat their flag | MEDIUM |
| Agent interaction table | 279-296 | outline_based_generation_editing.md (partial) | MEDIUM |

#### Proposed Migration Targets

| Section | Lines | Target Doc |
|---------|-------|-----------|
| Overview + Two-Phase Pipeline + Two Modes + Stopping Conditions + Checkpoint/Resume + Data Flow + Append-Only Pool | 1-23, 48-49, 100-125, 178-204, 222-277 | architecture.md |
| OpenSkill + Tournament + Stratified Opponents + Position Bias + Adaptive Calibration + LLM Cache + Rating Updates | 27-46, 161-169 | rating_and_comparison.md |
| Agent Framework (AgentBase) + Agent Interaction Table + Async Parallelism | 127-159, 279-303 | agents/overview.md |
| Config + Feature Flags + Budget Enforcement + Database Tables + Key Files + CLI + Deployment + Testing + Observability + Edge Cases + Run Summary + Format Enforcement | 170-176, 205-216, 304-395, 397-561 | reference.md |

### 10. Agent Docs Deep Analysis

#### outline_based_generation_editing.md (229 lines) → agents/generation.md

**Unique content to preserve**: 6-call pipeline architecture, score parsing logic (`parseStepScore`), per-step error handling table, cost tracking per-step methodology, GenerationStep/OutlineVariant types, step-targeted mutation mechanism, StepScoreBar visualization, Hall of Fame metadata structure, CLI `--outline` flag, `evolution_deepseek_outline` prompt bank method.

**Duplicated (remove, link to reference.md)**:
- Feature flag `evolution_outline_generation_enabled` (lines 7, 141, 207)
- Budget cap `outlineGeneration: 0.10` (lines 132, 208)
- Phase config `runOutlineGeneration` (lines 125-128)
- STRATEGY_TO_AGENT mapping (lines 145-150)

#### iterative_editing_agent.md (141 lines) → agents/editing.md (Part I)

**Unique content to preserve**: Critique-driven edit loop, information barrier pattern, direction reversal truth table (5 outcomes), CriticMarkup diff module (ESM dynamic import), blind judge prompt construction, step-aware editing for OutlineVariants, agent-level config (maxCycles=3, maxConsecutiveRejections=3, qualityThreshold=8), variant naming convention (`critique_edit_{dimension}`).

**Duplicated (remove, link to reference.md)**:
- Feature flag `evolution_iterative_editing_enabled` (line 89)
- Phase config (line 93-94)
- Agent execution order (line 94)

**CRITICAL DISCREPANCY FOUND**: evolution_pipeline.md says `iterativeEditing: 0.05` (5%), but iterative_editing_agent.md says "10% of total run budget". Needs resolution.

#### hierarchical_decomposition_agent.md (98 lines) → agents/editing.md (Part II)

**Unique content to preserve**: Section decomposition flow (parse→filter→parallel-edit→stitch), `parseArticleIntoSections()` regex with code block protection, round-trip invariant (`stitchSections(parse(md)) === md`), relaxed section format validator (no H1), upfront budget reservation pattern, max 2 cycles per section (vs 3 for whole-article), section min length filter (<100 chars skip).

**Duplicated (remove, link to reference.md)**:
- Feature flag `evolution_section_decomposition_enabled` (line 82)
- Budget cap `sectionDecomposition: 0.10` (line 81)

#### tree_of_thought_revisions.md (90 lines) → agents/tree_search.md

**Unique content to preserve**: Beam search algorithm (re-critique, generate, Stage 1 filter, Stage 2 tournament), 5 revision action types, beam collapse mitigation (action-type diversity, ancestry diversity slot, pool injection rate limiting), hybrid two-stage evaluation, local OpenSkill ratings in sibling mini-tournament, root selection (highest μ with σ > convergence threshold), lineage/tree visualization, BeamSearchConfig (K=3, B=3, D=3), cost estimate (~$0.048/run, 27 candidates, ~90 comparisons).

**Duplicated (remove, link to reference.md)**:
- Feature flag `evolution_tree_search_enabled` (line 42)
- Budget cap `treeSearch: 0.10` (line 44)
- Mutual exclusivity note with IterativeEditingAgent (line 43)

#### Proposed Merge Structure for agents/editing.md

```
# Content Editing Agents

## Overview
Two complementary agents apply critique-driven edits at different scopes.

## Shared Design Pattern
- Information barrier (editor knows weakness; judge sees only diff)
- Direction reversal bias mitigation
- Diff-based judging via compareWithDiff()

## Agent 1: Iterative Editing (Whole-Article)
[All unique content from iterative_editing_agent.md]

## Agent 2: Section Decomposition (Hierarchical)
[All unique content from hierarchical_decomposition_agent.md]

## Comparison Table
| Aspect | Iterative | Section Decomposition |
| Scope | Whole article | Per H2 section |
| Parallelism | Sequential cycles | Promise.allSettled fan-out |
| Max cycles | 3 | 2 per section |
| Budget reservation | Per-edit | Once upfront |

## Configuration
[Combined, with links to reference.md]

## Testing
[Combined test counts]
```

### 11. Infrastructure Docs Deep Analysis

#### comparison_infrastructure.md (237 lines) → hall_of_fame.md

**Finding: No significant duplication** with evolution_pipeline.md. Content is entirely unique:
- Hall of Fame system (topics, entries, Elo), 3 workflows, 14 server actions, 4-table schema, Prompt Bank subsystem, admin UI, CLI scripts, multi-provider LLM support.
- The Elo K-32 system is **distinct from OpenSkill** — intentionally separate.
- **Action**: Rename, keep content intact. Update cross-reference links.

#### elo_budget_optimization.md (294 lines) → cost_optimization.md

**Finding: Minimal duplication**. Content is unique:
- Optimization loop, cost attribution (`getAllAgentCosts()`), cost estimation (5-min TTL, 50-sample baseline), strategy identity (SHA-256 hash), batch config (Cartesian product expansion), adaptive allocation (30-day lookback, 5% floor, 40% ceiling), 3-tab dashboard, 8 server actions, 5 database migrations, known limitations.
- The per-agent budget caps reference evolution_pipeline.md's values but don't duplicate the definition — they build adaptive allocation on top.
- **Action**: Rename, keep content intact. Update cross-reference links.

#### evolution_pipeline_visualization.md (124 lines) → visualization.md

**Finding: No duplication**. Content is entirely unique:
- 4 routes, 13 React components, 8 server actions, checkpoint-first architecture, D3+React hybrid, auto-polling (15s), step score visualization, 45 component tests.
- **Note**: This doc has NO "Related Documentation" section (orphan). Add links post-migration.
- **Action**: Rename, keep content intact. Add Related Documentation section.

#### evolution_framework.md (75 lines) → data_model.md

**Finding: No duplication**. Content is unique:
- Core primitives (Prompt, Strategy, Run, Article, Agent, Pipeline Type, Hall of Fame), dimensional model, data flow, strategy system (hash dedup, version-on-edit, 3 presets), NOT NULL enforcement protocol, 9 migrations.
- **Note**: Has NO markdown cross-reference links (orphan). Add links post-migration.
- **Action**: Rename, keep content intact. Add Related Documentation section.

### 12. External References — Exact Lines and Required Updates

#### architecture.md — 2 direct links to update

| Line | Current Link | New Link |
|------|-------------|----------|
| 101 | `../feature_deep_dives/evolution_framework.md` | `../evolution/data_model.md` |
| 102 | `../feature_deep_dives/evolution_pipeline_visualization.md` | `../evolution/visualization.md` |

#### admin_panel.md — 5 evolution route references (lines 160-175)

No direct markdown links to evolution docs, just route documentation. Optional enhancement: add links to evolution docs for context.

#### testing_setup.md — 4 evolution test references

| Line | Reference | Optional Enhancement |
|------|-----------|---------------------|
| 21 | "Evolution (4 files): Auto-skip when evolution DB tables not yet migrated" | Add link to reference.md |
| 99 | `evolution-test-helpers.ts` file listing | Add link to reference.md |
| 105-107 | 3 integration test file listings | Add link to reference.md |
| 353-363 | evolution-test-helpers.ts utility documentation | Add link to reference.md |

#### environments.md — 3 evolution references

| Line | Reference | Status |
|------|-----------|--------|
| 145-152 | Evolution batch runner workflow description | No direct links, descriptive text |
| 189 | `DEEPSEEK_API_KEY` env var "(evolution pipeline)" | No direct link |
| 278 | Same env var reference | No direct link |

#### getting_started.md — No direct evolution links

References `feature_deep_dives/` generically. Minimal update needed.

#### instructions_for_updating.md — File count reference

Lines 29-30 mention "All 17 files should be updated" — count changes with new structure.

### 13. doc-mapping.json — All 16 Evolution Entries

All 16 entries need `docs/feature_deep_dives/` → `docs/evolution/` path prefix updates. Additionally, filenames change per the reorganization:

| # | Pattern | Current Docs | New Docs |
|---|---------|-------------|----------|
| 1 | `src/lib/services/evolution*.ts` | evolution_pipeline, visualization, comparison_infrastructure, iterative_editing_agent, elo_budget | architecture, visualization, hall_of_fame, agents/editing, cost_optimization, reference |
| 2 | `src/lib/services/promptRegistryActions.ts` | evolution_framework | data_model |
| 3 | `src/lib/services/strategyRegistryActions.ts` | evolution_framework | data_model |
| 4 | `src/lib/services/unifiedExplorerActions.ts` | evolution_framework | data_model |
| 5 | `scripts/backfill-prompt-ids.ts` | evolution_framework | data_model |
| 6 | `src/lib/evolution/**` | evolution_pipeline, evolution_framework, comparison_infrastructure, iterative_editing_agent, elo_budget | architecture, data_model, hall_of_fame, agents/editing, cost_optimization, reference |
| 7 | `src/lib/services/articleBank*.ts` | comparison_infrastructure, elo_budget | hall_of_fame, cost_optimization |
| 8 | `scripts/*bank*.ts` | comparison_infrastructure, elo_budget | hall_of_fame, cost_optimization |
| 9 | `scripts/generate-article*.ts` | comparison_infrastructure, elo_budget | hall_of_fame, cost_optimization |
| 10 | `scripts/evolution*.ts` | evolution_pipeline, elo_budget | architecture, cost_optimization, reference |
| 11 | `scripts/run-evolution*.ts` | evolution_pipeline, elo_budget | architecture, cost_optimization, reference |
| 12 | `src/config/promptBankConfig.ts` | comparison_infrastructure, elo_budget | hall_of_fame, cost_optimization |
| 13 | `scripts/run-prompt-bank*.ts` | comparison_infrastructure, elo_budget | hall_of_fame, cost_optimization |
| 14 | `src/components/evolution/**` | visualization, comparison_infrastructure, elo_budget | visualization, hall_of_fame, cost_optimization |
| 15 | `src/lib/evolution/agents/*outline*.ts` | outline_based_generation_editing | agents/generation |
| 16 | `src/lib/evolution/treeOfThought*.ts` | tree_of_thought_revisions | agents/tree_search |

**Missing entries to add**:
- `src/lib/evolution/agents/*iterative*.ts` → agents/editing
- `src/lib/evolution/agents/*section*.ts` → agents/editing
- `src/lib/evolution/section/**` → agents/editing
- `src/lib/evolution/diffComparison.ts` → agents/editing
- `src/lib/evolution/agents/*treeSearch*.ts` → agents/tree_search
- `src/lib/evolution/agents/*debate*.ts` → agents/support
- `src/lib/evolution/agents/*reflect*.ts` → agents/support
- `src/lib/evolution/agents/*metaReview*.ts` → agents/support

### 14. Budget Cap Discrepancy — RESOLVED

**iterativeEditing budget**: evolution_pipeline.md line 367 specifies `0.05` (5%), but iterative_editing_agent.md line 87 says "10% of total run budget".

**Resolution**: Checked source code at `src/lib/evolution/config.ts` lines 21-32. The actual value is `iterativeEditing: 0.05` (5%). **iterative_editing_agent.md is INCORRECT** — it should say 5%, not 10%. All other budget caps match between docs and code. This needs to be fixed during migration.

### 15. Undocumented Support Agents — Content Analysis

Five agents have NO standalone documentation and need content for the new `agents/support.md`. Source code analysis reveals:

#### ReflectionAgent (`reflectionAgent.ts`)
- **What**: Critiques top 3 variants across 5 fixed dimensions (clarity, structure, engagement, precision, coherence)
- **Key details**: Parallel LLM calls via Promise.allSettled, JSON response parsing, 3 utility functions (`getCritiqueForVariant`, `getWeakestDimension`, `getImprovementSuggestions`)
- **Config**: `numToCritique = 3` (hardcoded), `CRITIQUE_DIMENSIONS` constant
- **Cost**: ~$0.024/run (3 × $0.008)
- **Docs needed**: Medium (2-3 sections)

#### DebateAgent (`debateAgent.ts`)
- **What**: 3-turn structured debate over top 2 non-baseline variants → synthesis variant
- **Key details**: Turn 1 (Advocate A) → Turn 2 (Advocate B rebuts) → Turn 3 (Judge synthesizes JSON verdict) → Turn 4 (LLM generates new variant). Consumes ReflectionAgent critiques via `formatCritiqueContext()`. Inspired by Google DeepMind AI Co-Scientist (arxiv 2502.18864).
- **Config**: Requires 2+ rated non-baseline variants, `countRatedNonBaseline()` guard
- **Docs needed**: Medium (3-4 paragraphs)

#### EvolutionAgent / evolvePool (`evolvePool.ts`)
- **What**: Genetic evolution creating children via mutation (clarity/structure), crossover, creative exploration, outline mutation
- **Key details**: `PoolManager.getEvolutionParents(2)`, 3 parallel strategy calls, creative exploration (30% random chance OR diversity < 0.5), dominant strategy tracking (`getDominantStrategies()` at >1.5× average count), stagnation detection (`isRatingStagnant()` top-3 unchanged for 2 iterations), outline mutation (2-call: mutate outline + expand)
- **Config**: `CREATIVE_RANDOM_CHANCE = 0.3`, `CREATIVE_DIVERSITY_THRESHOLD = 0.5`, `CREATIVE_STAGNATION_ITERATIONS = 2`
- **Docs needed**: Long (5-6 paragraphs) — most complex of the 5

#### ProximityAgent (`proximityAgent.ts`)
- **What**: Diversity/similarity scoring via sparse pairwise cosine similarity matrix
- **Key details**: Two embedding modes (test: MD5-based, production: character-based with OpenAI deferred), `diversityScore = 1 - mean(top-10 pairwise similarities)`, embedding cache, sparse adjacency matrix (only new vs existing)
- **Config**: `testMode` constructor option (default: false), pool.length >= 2 required
- **Cost**: ~$0.0001/embedding (OpenAI text-embedding-3-small)
- **Docs needed**: Medium (3-4 paragraphs)

#### MetaReviewAgent (`metaReviewAgent.ts`)
- **What**: Pure computation (no LLM calls, $0 cost) — analyzes strategy performance, produces meta-feedback consumed by GenerationAgent and EvolutionAgent
- **Key details**: 4 analysis functions: `_analyzeStrategies()` (above-avg ordinal detection), `_findWeaknesses()` (bottom-quartile patterns), `_findFailures()` (negative parent→child deltas, threshold < -3), `_prioritize()` (pool gap rules: diversity < 0.3, ordinal range < 6 or > 30, stagnation detection)
- **Output**: `MetaFeedback` struct with `recurringWeaknesses`, `priorityImprovements`, `successfulStrategies`, `patternsToAvoid`
- **Docs needed**: Medium-long (4-5 paragraphs)

**Total for agents/support.md**: ~1,500-2,000 words across 5 agent sections.

### 16. Missed Evolution References Audit

Beyond the known 6 external files, the audit found:

- **architecture.md**: 3 direct links (lines 101-103) — evolution_framework.md, evolution_pipeline_visualization.md, comparison_infrastructure.md. Previously only noted 2; line 103 for comparison_infrastructure.md was missed.
- **doc-mapping.json**: Actually has **19** pattern entries (not 16) — 3 additional entries for `src/lib/services/decomposition*.ts`, `src/lib/decomposition/**`, and `scripts/*decomposition*.ts` all mapping to `hierarchical_decomposition_agent.md`.
- **Test files**: E2E tests (`admin-hall-of-fame.spec.ts`, `admin-evolution-visualization.spec.ts`, `admin-elo-optimization.spec.ts`, `admin-evolution.spec.ts`) and integration tests (`hall-of-fame-actions.integration.test.ts`) reference Hall of Fame and evolution concepts in JSDoc comments but have no markdown doc links.
- **Source code**: `pipeline.ts` line 502 has comment referencing "hall of fame"; `evolution-dashboard/page.tsx` line 146 mentions "hall of fame" in UI text.
- **No missed external doc files** — the 6 previously identified are comprehensive.

### 17. Documentation Structure vs Code Layout Validation

**Result: All 13 proposed docs are fully justified by code.**

Code-to-doc alignment:

| Proposed Doc | Code Files | Count | Status |
|---|---|---|---|
| architecture.md | pipeline.ts, supervisor.ts, pool.ts, diversityTracker.ts, validation.ts, index.ts | 6 | ✅ |
| data_model.md | types.ts, state.ts, comparisonCache.ts, jsonParser.ts | 4 | ✅ |
| rating_and_comparison.md | rating.ts, tournament.ts, comparison.ts, diffComparison.ts | 4 | ✅ |
| agents/overview.md | base.ts, evolvePool.ts, calibrationRanker.ts, pairwiseRanker.ts, formatRules.ts, formatValidator.ts | 6 | ✅ |
| agents/generation.md | generationAgent.ts, outlineGenerationAgent.ts | 2 | ✅ |
| agents/editing.md | iterativeEditingAgent.ts, sectionDecompositionAgent.ts + section/* (5 files) | 7 | ✅ |
| agents/tree_search.md | treeSearchAgent.ts + treeOfThought/* (6 files) | 7 | ✅ |
| agents/support.md | reflectionAgent.ts, debateAgent.ts, proximityAgent.ts, metaReviewAgent.ts | 4 | ✅ |
| hall_of_fame.md | strategyConfig.ts, promptRegistryActions.ts, run-prompt-bank*, backfill-prompt-ids.ts | 4+ | ✅ |
| cost_optimization.md | costTracker.ts, costEstimator.ts, adaptiveAllocation.ts | 3 | ✅ |
| visualization.md | evolutionActions.ts, evolutionVisualizationActions.ts, 13+ components | 15+ | ✅ |
| reference.md | config.ts, llmClient.ts, logger.ts, featureFlags.ts, evolution-runner.ts, run-evolution-local.ts | 6 | ✅ |

**Minor recommendations**:
1. Make format validation (formatRules.ts, formatValidator.ts) more prominent in agents/overview.md
2. Expand rating_and_comparison.md to explicitly cover comparison.ts and diffComparison.ts as a "Comparison Methods" section
3. agents/overview.md should explicitly mention CalibrationRanker and Tournament as ranking agents (not just agent framework)

### 18. Updated doc-mapping.json Entry Count

The previous analysis identified 16 entries, but the actual count is **19 entries** with these 3 additional entries:
- `src/lib/services/decomposition*.ts` → `hierarchical_decomposition_agent.md` (→ `agents/editing.md`)
- `src/lib/decomposition/**` → `hierarchical_decomposition_agent.md` (→ `agents/editing.md`)
- `scripts/*decomposition*.ts` → `hierarchical_decomposition_agent.md` (→ `agents/editing.md`)
