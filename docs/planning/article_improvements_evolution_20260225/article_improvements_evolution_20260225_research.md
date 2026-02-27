# Article Improvements Evolution Research

## Problem Statement
The evolution pipeline generates, competes, and refines article variants but lacks a detailed article-level view showing the full history of an article through the evolution process. Users need to understand how articles are tracked on revision (whether new articles are created or old ones updated in-place), and need a comprehensive article detail view showing creation date, Elo rating, agent operations, match history, and other metadata.

## Requirements (from GH Issue #571)
I want 2 things - to know how articles are tracked on revision. Is a new article created, or is old one simply updated in place? Also, I want a detailed article view the shows the article and its associated history, like when it was created, its elo, which agents operated on it, its matches, etc.

Additional: How is lineage tracked? How is Elo boost from an agent calculated — is it by looking at Elo difference between new vs. old?

---

## Foundational Findings

These findings apply to both features — they describe how the evolution pipeline works today.

### How Articles Are Tracked on Revision

**Variants are NEW rows; the original article is currently NEVER updated.**

The evolution pipeline uses an **append-only pool** model during runs. Each agent creates new `TextVariation` objects (with unique UUIDs) that get added to the pool — original variants are never modified or removed. At pipeline completion:

1. **`persistVariants()`** writes all variants to `evolution_variants` table, marking the top-ranked one with `is_winner = true`
2. **`feedHallOfFame()`** copies the top 2 variants into `evolution_hall_of_fame_entries`
3. **The `explanations.content` column is NOT updated** — there is no `applyWinnerAction` in the codebase

The original design included an `apply_evolution_winner` RPC and a `content_history` table for rollback, but **both were dropped** in migration `20260221000002_evolution_table_rename.sql` as dead code.

### How Lineage Is Tracked

Lineage is tracked via `TextVariation.parentIds: string[]` — each variant stores an array of parent IDs:
- **Single parent**: Mutation, iterative editing, tree search, section decomposition
- **Two parents**: Crossover (EvolutionAgent), debate synthesis (DebateAgent)
- **No parents**: GenerationAgent variants (created from scratch using strategies)

**Storage:**
- **Checkpoints** (primary): Full `parentIds[]` preserved in `evolution_checkpoints.state_snapshot` JSONB
- **DB table** (secondary): `evolution_variants.parent_variant_id` stores only the **first parent** — multi-parent lineage is lost in DB persistence

### Rating System

- OpenSkill (Weng-Lin Bayesian): each variant has `{mu, sigma}` pair
- `ordinal = mu - 3*sigma` (conservative estimate penalizing uncertainty)
- `eloScale = 1200 + ordinal * (400 / 25)` — maps to 0-3000 display range
- New variants start at `mu=25, sigma=8.333` → Elo 1200
- Sigma shrinks with more matches (convergence when all < 3.0)
- **Within-run** (`state.ratings` Map): Persists across iterations — NOT reset between iterations
- **Hall of Fame** (`evolution_hall_of_fame_elo` table): Initialized from pipeline's final rating, then evolves independently. Two systems never cross-pollinate.

### Data Available Per Variant

From `evolution_variants` table:
- `id` (UUID), `run_id` (FK), `explanation_id` (FK, nullable)
- `variant_content` (TEXT), `elo_score` (NUMERIC)
- `generation` (INT — version/depth), `parent_variant_id` (UUID, first parent only)
- `agent_name` (TEXT — actually the strategy name), `match_count` (INT)
- `is_winner` (BOOLEAN), `created_at` (TIMESTAMP)

From checkpoints (richer data):
- Full `parentIds[]` (multi-parent lineage)
- `strategy` (actual strategy name vs agent_name in DB)
- `iterationBorn`, `costUsd`

### Data Available Per Agent Invocation

From `evolution_agent_invocations`:
- `id` (UUID), `run_id` (FK), `iteration`, `agent_name`, `execution_order`
- `success` (BOOLEAN), `cost_usd` (incremental per-invocation), `skipped` (BOOLEAN)
- `execution_detail` (JSONB) containing:
  - `_diffMetrics`: `{variantsAdded, newVariantIds, matchesPlayed, eloChanges, critiquesAdded, debatesAdded, diversityScoreAfter, metaFeedbackPopulated}`
  - Agent-type-specific detail (e.g., tournament rounds, critique dimensions, edit results)

---

## Feature 1: Creator-Based Elo Attribution

### Problem: Current Attribution Is Misleading

The current `_diffMetrics.eloChanges` captures what changed during each agent's execution window:

- **Creating agents** (e.g., IterativeEditing) get `variantsAdded: 1` but `eloChanges: {}` (zero — new variant starts at default 1200, so delta = 0)
- **Ranking agents** (CalibrationRanker, Tournament) get all the Elo change credit even though they didn't create the variants

A variant created by IterativeEditing might become the winner, but all its Elo gains show under CalibrationRanker and Tournament.

### Proposed: Creator-Based Attribution Model

Attribute Elo changes to the agent that **created** each variant, using the variant's final Elo relative to its parent(s):

```
For variant V created by agent A:

1. NO PARENTS (generation from scratch):
   attribution = V.elo - 1200

2. ONE PARENT (editing/mutation/tree search):
   attribution = V.elo - parent.elo

3. TWO PARENTS (crossover/debate synthesis):
   attribution = V.elo - avg(parentA.elo, parentB.elo)

Key: V.elo and parent.elo are LIVE values from state.ratings,
     so attribution updates automatically as tournaments refine ratings.
```

This attribution is **dynamic** — it changes as tournaments run more matches:
- After Calibration iter 1: V=1280, parent=1350 → attribution = -70
- After Tournament iter 1: V=1310, parent=1340 → attribution = -30
- After Tournament iter 2: V=1380, parent=1340 → attribution = +40

The **final** attribution (at pipeline completion) is the most accurate.

### The Sigma Problem: Why Raw Elo Gain Is Misleading

Raw Elo gain (`V.elo - parent.elo`) uses ordinal-based Elo which **conflates skill and uncertainty**:

```
ordinal = mu - 3*sigma
eloScale = 1200 + ordinal * 16
```

A fresh variant starts with `sigma=8.333` (high uncertainty). After 20+ matches, sigma drops to ~3.0. This means:
- A fresh variant's ordinal is penalized by `3 * 8.333 * 16 = 400 Elo points` of uncertainty
- A converged variant's penalty is only `3 * 3.0 * 16 = 144 Elo points`

When comparing a fresh variant to a converged parent, the Elo gain number absorbs **both** the real skill difference **and** the sigma gap.

### Solution: Confidence Intervals on Elo Gain

Show **gain ± CI** with statistical significance coloring.

**Core formulas using Gaussian error propagation on mu-space:**

```
For variant V with rating {mu_v, sigma_v} and parent(s):

1. NO PARENTS (generation from scratch):
   deltaMu    = mu_v - 25                    (25 = default mu)
   sigmaDelta = sigma_v

2. ONE PARENT with rating {mu_p, sigma_p}:
   deltaMu    = mu_v - mu_p
   sigmaDelta = sqrt(sigma_v² + sigma_p²)

3. TWO PARENTS with ratings {mu_p0, sigma_p0}, {mu_p1, sigma_p1}:
   deltaMu    = mu_v - (mu_p0 + mu_p1) / 2
   sigmaDelta = sqrt(sigma_v² + (sigma_p0² + sigma_p1²) / 4)
```

**Converting to Elo scale:**
```
gain = deltaMu × 16         (where 16 = 400/25 = ELO_SCALE)
CI   = 1.96 × sigmaDelta × 16   (95% confidence)
```

**Z-score for statistical significance:**
```
zScore = deltaMu / sigmaDelta    (how many standard deviations from zero)
```

### Implementation

```typescript
const ELO_SCALE = 400 / 25;  // 16

function computeEloGainCI(
  variant: Rating,
  parents: Rating[],
  confidenceLevel: number = 0.95,
): { gain: number; ci: number; zScore: number } {
  const z = confidenceLevel === 0.95 ? 1.96 : confidenceLevel === 0.68 ? 1.0 : 1.96;

  let deltaMu: number;
  let sigmaDelta: number;

  if (parents.length === 0) {
    deltaMu = variant.mu - 25;
    sigmaDelta = variant.sigma;
  } else if (parents.length === 1) {
    deltaMu = variant.mu - parents[0].mu;
    sigmaDelta = Math.sqrt(variant.sigma ** 2 + parents[0].sigma ** 2);
  } else {
    const avgMu = (parents[0].mu + parents[1].mu) / 2;
    deltaMu = variant.mu - avgMu;
    sigmaDelta = Math.sqrt(
      variant.sigma ** 2 + (parents[0].sigma ** 2 + parents[1].sigma ** 2) / 4
    );
  }

  const gain = deltaMu * ELO_SCALE;
  const ci = z * sigmaDelta * ELO_SCALE;
  const zScore = sigmaDelta > 0 ? deltaMu / sigmaDelta : 0;

  return { gain, ci, zScore };
}
```

### Display Format: Compact with Color (Chosen)

Show Elo gain ± CI in a single line, color-coded by z-score significance:

```
IterativeEditing:  +45 ± 111              (grey — z=0.4, noise)
GenerationAgent:   +120 ± 78              (yellow — z=1.5, likely real)
DebateAgent:       +85 ± 32               (green — z=2.7, significant)
EvolutionAgent:    -40 ± 18               (red — z=-2.2, significant decline)
```

**Z-score color thresholds:**

| |z| range | Color | Meaning |
|-----------|-------|---------|
| < 1.0 | Grey | Within noise — not significant |
| 1.0 – 2.0 | Yellow/Amber | Likely real, but not conclusive |
| ≥ 2.0 | Green (positive) / Red (negative) | Statistically significant at ~95% confidence |

### Concrete Example: CI Narrowing Over Tournament Iterations

Starting state: IterativeEditing creates variant V from parent P.
- V: `mu=25, sigma=8.33`, P: `mu=27, sigma=4.0`
- `deltaMu = -2`, `sigmaDelta = sqrt(69.4 + 16) = 9.24`
- **Display: -32 ± 290 Elo (grey, z=-0.22)** — too uncertain to conclude anything

After Calibration (5 matches for V):
- V: `mu=26.5, sigma=5.8`, P: `mu=27.2, sigma=3.8`
- `deltaMu = -0.7`, `sigmaDelta = sqrt(33.6 + 14.4) = 6.93`
- **Display: -11 ± 218 Elo (grey, z=-0.10)** — still noisy but narrowing

After Tournament iter 1 (15 matches for V):
- V: `mu=28.1, sigma=3.5`, P: `mu=26.8, sigma=3.2`
- `deltaMu = 1.3`, `sigmaDelta = sqrt(12.25 + 10.24) = 4.74`
- **Display: +21 ± 149 Elo (grey, z=0.27)** — trending positive, still uncertain

After Tournament iter 2 (30+ matches for V):
- V: `mu=29.0, sigma=2.8`, P: `mu=26.5, sigma=2.9`
- `deltaMu = 2.5`, `sigmaDelta = sqrt(7.84 + 8.41) = 4.03`
- **Display: +40 ± 126 Elo (grey, z=0.62)** — positive but wide CI

After Tournament iter 3 (50+ matches, both converged):
- V: `mu=29.5, sigma=2.2`, P: `mu=26.3, sigma=2.1`
- `deltaMu = 3.2`, `sigmaDelta = sqrt(4.84 + 4.41) = 3.04`
- **Display: +51 ± 95 Elo (yellow, z=1.05)** — likely real improvement

### Agent Taxonomy — Complete Reference

#### Variant-Creating Agents

| Agent | `name` | Parents | How it creates variants | Elo Attribution |
|-------|--------|---------|------------------------|-----------------|
| **GenerationAgent** | `generation` | `[]` (none) | 3 variants from scratch using `structural_transform`, `lexical_simplify`, `grounding_enhance` | `V.elo - 1200` |
| **OutlineGenerationAgent** | `outlineGeneration` | `[]` (none) | 1 variant via 6-call pipeline: outline→expand→polish | `V.elo - 1200` |
| **IterativeEditingAgent** | `iterativeEditing` | `[parent.id]` (1) | Critique→edit→judge cycles on top variant. Chains: each accepted edit becomes next `current` | `V.elo - parent.elo` |
| **SectionDecompositionAgent** | `sectionDecomposition` | `[top.id]` (1) | Splits top variant into H2 sections, edits each in parallel, stitches back | `V.elo - parent.elo` |
| **TreeSearchAgent** | `treeSearch` | `[root.id]` (1) | Beam search tree of revisions, adds only best leaf to pool | `V.elo - parent.elo` |
| **DebateAgent** | `debate` | `[A.id, B.id]` (2) | 3-turn debate between top 2 non-baseline variants → synthesis | `V.elo - avg(A.elo, B.elo)` |
| **EvolutionAgent** | `evolution` | Mixed — see sub-strategies | Genetic operations on top-performing parents | See below |

**EvolutionAgent sub-strategies:**

| Sub-strategy | Parents | Attribution |
|-------------|---------|-------------|
| `mutate_clarity` | `[parent.id]` (1) | `V.elo - parent.elo` |
| `mutate_structure` | `[parent.id]` (1) | `V.elo - parent.elo` |
| `crossover` | `[p0.id, p1.id]` (2) | `V.elo - avg(p0.elo, p1.elo)` |
| `creative_exploration` | `[parent.id]` (1) | `V.elo - parent.elo` |
| `mutate_outline` | `[parent.id]` (1) | `V.elo - parent.elo` |

#### Non-Creating Agents (ranking, analysis, monitoring)

| Agent | `name` | What it does | Elo Attribution |
|-------|--------|-------------|-----------------|
| **CalibrationRanker** | `calibration` | Pairwise comparisons for new entrants vs stratified opponents | N/A — work reflected via creating agents' live attribution |
| **Tournament** | `tournament` | Swiss-style tournament refining all ratings | N/A — same as above |
| **ReflectionAgent** | `reflection` | Critiques top 3 variants across 5 dimensions | N/A (provides critique data, no variants) |
| **ProximityAgent** | `proximity` | Computes diversity score via cosine similarity | N/A (monitoring only) |
| **MetaReviewAgent** | `metaReview` | Analyzes strategy performance, provides meta-feedback | N/A (computation only, no LLM calls) |
| **FlowCritiqueAgent** | `flowCritique` | Flow-level evaluation on 0-5 scale | N/A (critique only) |
| **PairwiseRanker** | `pairwise` | Full pairwise comparison (used by Tournament internally) | N/A (delegated from Tournament) |

#### Special Case: Baseline Variant

The original article is added as a variant with strategy `original_baseline`, no creating agent, no parents. Its final Elo relative to 1200 indicates whether the original was better or worse than average quality.

### Open Questions (Elo Attribution)

1. **Where to compute?** At pipeline completion (snapshot), or dynamically on each page load from stored ratings?
2. **How to handle chained edits?** IterativeEditing produces chains (A→B→C). Should C's attribution be `C.elo - A.elo` (root parent) or `C.elo - B.elo` (immediate parent)?

---

## Feature 2: Article Detail View

### Problem: No Article-Level Aggregation View Exists

Current views are run-centric, not article-centric:
- **Run detail** (`/admin/quality/evolution/run/[runId]`): 5 tabs (Timeline, Rating, Lineage, Variants, Logs) — all scoped to one run
- **Evolution management** (`/admin/quality/evolution`): Runs table with filters (status + date, no per-article filter)
- **Hall of Fame** (`/admin/quality/hall-of-fame/[topicId]`): Cross-method comparison per topic
- **Explorer** (`/admin/quality/explorer`): Has `getExplorerArticleDetailAction` but it's run-scoped (single variant lineage)
- **No page aggregates all evolution runs for a single article**

### Existing Pages and Navigation

| Page | URL | What It Shows |
|------|-----|---------------|
| Evolution Runs | `/admin/quality/evolution` | Runs table with status, cost, dates |
| Run Detail | `/admin/quality/evolution/run/[runId]` | 5 tabs: Timeline, Elo, Lineage, Variants, Logs |
| Run Compare | `/admin/quality/evolution/run/[runId]/compare` | Before/after diff of baseline vs winner |
| Explorer | `/admin/quality/explorer` | Cross-run analysis (3 units: Run/Article/Task) |
| Hall of Fame Topics | `/admin/quality/hall-of-fame` | Topic list with summary stats |
| Hall of Fame Detail | `/admin/quality/hall-of-fame/[topicId]` | Leaderboard, Cost vs Rating, Matches, Compare |
| Prompts | `/admin/quality/prompts` | Prompt registry |
| Strategies | `/admin/quality/strategies` | Strategy registry |
| Optimization | `/admin/quality/optimization` | Cost optimization analysis |

**Navigation pattern:** Breadcrumb-based (via `EvolutionBreadcrumb`), no global sidebar. URL builders in `evolutionUrls.ts`:
- `buildExplanationUrl(explanationId)` → `/results?explanation_id={id}` (public page)
- `buildRunUrl(runId)` → `/admin/quality/evolution/run/{runId}`
- `buildVariantUrl(runId, variantId)` → `/admin/quality/evolution/run/{runId}?tab=variants&variant={variantId}`

### Where Article/Variant References Currently Appear

| Location | What's Shown | Clickable? | Links To |
|----------|-------------|------------|----------|
| **Runs table** explanation column | `Explanation #{id}` | Yes | Public `/results?explanation_id={id}` |
| **Run detail** header | Same gold explanation link | Yes | Same public page |
| **Explorer ArticleTable** content column | 60-char text preview | **No — plain text** | N/A |
| **Explorer ArticleTable** run column | Run ID (8 chars) | Yes | Run detail page |
| **VariantsTab** row | Rank + short ID + expand toggle | Expand only | Inline expansion |
| **VariantsTab** "Why this score?" | Opens VariantDetailPanel inline | Expand | Shows dimensions, matches, parent lineage |
| **VariantDetailPanel** parent lineage | Parent short IDs | **Display only** | Not linked |
| **VariantDetailPanel** "Jump to agent" | Link text | Yes | `?tab=timeline&iteration=N&agent=STRATEGY` |
| **LineageTab** DAG nodes | Nodes sized by Elo, labeled with shortId | Select only | Local side panel (VariantCard) — no navigation |
| **TimelineTab** new variants | Short IDs created by agent | Yes | `?tab=variants&variant={id}` |
| **Hall of Fame** entries | Content preview + metadata | Expand | Inline; "Open Run Detail" for evolution entries |

### Two Concepts of "Article"

1. **Explanation-level** (`explanation_id`): The original article that evolution runs target. Multiple runs can target the same explanation.
2. **Variant-level** (`variant_id`): A specific version produced during a run. Each run produces many variants.

### Existing Server Actions That Could Feed Article Detail

- `getEvolutionRunsAction({ explanationId })` — all runs for an article
- `getEvolutionVariantsAction(runId)` — variants per run
- `getEvolutionRunTimelineAction(runId)` — per-agent per-iteration breakdown
- `getEvolutionRunEloHistoryAction(runId)` — Elo trajectories
- `getEvolutionRunLineageAction(runId)` — variant DAG
- `getEvolutionRunComparisonAction(runId)` — before/after diff
- `getEvolutionRunSummaryAction(runId)` — stop reason, ordinal/diversity history
- `getExplorerArticleDetailAction({runId, variantId})` — variant with 10-ancestor lineage chain

### Existing Detail Components (What They Show Today)

**VariantDetailPanel** (in VariantsTab, inline expand):
- Variant ID (ShortId: first 8 chars), Rating, Strategy, Generation, Cost
- Dimension Scores — bar chart of per-dimension ratings
- Match History — list of all matches (W/L vs other variants with confidence %)
- Parent Lineage — parent variant IDs (display only, not linked)
- Content Preview — first 1000 chars
- "Jump to agent" link

**ArticleDetailPanel** (in Explorer, inline expand):
- Metadata header: Agent name, generation, Elo score
- Content section: Full variant text (scrollable, max 16rem)
- Parent content: Full parent variant text if exists
- Lineage section: Ancestor chain as pill-style elements (Gen #, Agent, 20-char preview)

**LineageTab VariantCard** (side panel on node click):
- `shortId`, `elo`, `strategy`, `iterationBorn`, `isWinner`
- `treeDepth` and `revisionAction` for tree search variants

### Best Places to Link TO the Article Detail View

1. **Explorer ArticleTable** — make content preview clickable (currently plain text)
2. **VariantsTab** — add "Full View" link next to "Why this score?"
3. **Lineage DAG nodes** — click navigates instead of just showing side panel
4. **Run detail header** — add article detail link alongside the explanation link
5. **Hall of Fame entries** — add link for evolution-sourced entries
6. **Runs table** — add second link in explanation column (public results + admin article view)

### Open Questions (Article Detail View)

1. **Should the view be explanation-centric or variant-centric?** Explanation-level aggregates across all evolution runs for an article. Variant-level is a deep dive into one variant's history. Could support both.
2. **Should we implement `applyWinnerAction`?** The plan to write winning content back to `explanations` was abandoned. Should we revive it?
3. **Should the view link to existing run detail pages or inline the data?** Run detail already has rich tabs — duplicating is wasteful, but linking forces context-switching.
4. **Hall of Fame integration?** Show Hall of Fame entries/ratings for that article's variants?
5. **URL structure?** `/admin/quality/evolution/article/[explanationId]` for explanation-centric, or `/admin/quality/evolution/variant/[variantId]` for variant-centric?

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered in step 2.7)
- evolution/docs/evolution/architecture.md — Pipeline phases, agent selection, checkpoint/resume
- evolution/docs/evolution/README.md — Entry point, two rating systems overview
- evolution/docs/evolution/data_model.md — Core primitives, strategy system, migrations
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill, Swiss tournament, bias mitigation
- evolution/docs/evolution/hall_of_fame.md — Cross-method comparison, prompt bank
- evolution/docs/evolution/cost_optimization.md — Cost tracking, estimation, accuracy dashboard
- evolution/docs/evolution/visualization.md — Dashboard, timeline, lineage, agent detail views
- evolution/docs/evolution/reference.md — Config, flags, schema, key files, CLI
- evolution/docs/evolution/strategy_experiments.md — L8 factorial design

## Code Files Read

### Pipeline Core
- `evolution/src/lib/core/persistence.ts` — Checkpoint upsert, variant persistence (is_winner marking, first-parent-only in DB)
- `evolution/src/lib/core/pipelineUtilities.ts` — `captureBeforeState()`, `computeDiffMetrics()`, `BeforeStateSnapshot` interface, agent invocation lifecycle
- `evolution/src/lib/core/pipeline.ts` — Agent dispatch loop: `captureBeforeState` before execute, `computeDiffMetrics` after (lines 209-213, 582-586)
- `evolution/src/lib/core/rating.ts` — OpenSkill wrapper: `createRating`, `updateRating`, `getOrdinal`, `ordinalToEloScale`
- `evolution/src/lib/core/state.ts` — `PipelineStateImpl`, `addToPool()` (auto-creates default rating), `startNewIteration()` (ratings NOT cleared), serialization/deserialization
- `evolution/src/lib/core/textVariationFactory.ts` — `createTextVariation()` with `parentIds` defaults to `[]`
- `evolution/src/lib/core/hallOfFameIntegration.ts` — `feedHallOfFame()`, `upsertEloRatings()` (initializes HoF ratings from pipeline ratings), `triggerAutoReRank()`
- `evolution/src/lib/types.ts` — `TextVariation`, `DiffMetrics`, `PipelineState` interfaces

### Server Actions
- `evolution/src/services/evolutionActions.ts` — No applyWinner/rollback actions exist
- `evolution/src/services/evolutionVisualizationActions.ts` — Timeline, lineage, variant detail, comparison actions
- `evolution/src/services/unifiedExplorerActions.ts` — Explorer article detail with lineage chain

### UI Components
- `evolution/src/components/evolution/tabs/TimelineTab.tsx` — Elo change display (color-coded, top 10)
- `evolution/src/components/evolution/tabs/VariantsTab.tsx` — Variant table with Elo sparklines, VariantDetailPanel (dimensions, matches, parent lineage)
- `evolution/src/components/evolution/tabs/EloTab.tsx` — Rating trajectory line chart (display only, not clickable)
- `evolution/src/components/evolution/tabs/LineageTab.tsx` — D3 DAG graph with VariantCard side panel on node click
- `src/app/admin/quality/evolution/page.tsx` — Main evolution page, runs table (RunsTable), variant panel
- `src/app/admin/quality/evolution/run/[runId]/page.tsx` — Run detail with 5 tabs, breadcrumb with explanation link
- `src/app/admin/quality/evolution/run/[runId]/compare/page.tsx` — Before/after baseline vs winner diff
- `src/app/admin/quality/explorer/page.tsx` — Explorer with ArticleTable (plain text preview), ArticleDetailPanel (content + parent + lineage chain)
- `src/app/admin/quality/hall-of-fame/page.tsx` — Topics list with method stats and prompt bank summary
- `src/app/admin/quality/hall-of-fame/[topicId]/page.tsx` — Leaderboard, Cost vs Rating scatter, Match History, Compare Text tabs
- `evolution/src/components/evolution/RunsTable.tsx` — Runs table with explanation link column, variant modal
- `evolution/src/lib/utils/evolutionUrls.ts` — URL builders: `buildExplanationUrl`, `buildRunUrl`, `buildVariantUrl`, `buildExplorerUrl`

### All 14 Agent Implementations (variant creation patterns)
- `evolution/src/lib/agents/generationAgent.ts` — `parentIds: []` (fresh generation, 3 strategies)
- `evolution/src/lib/agents/outlineGenerationAgent.ts` — `parentIds: []` (outline→expand→polish)
- `evolution/src/lib/agents/iterativeEditingAgent.ts` — `parentIds: [current.id]` (critique→edit→judge chains)
- `evolution/src/lib/agents/sectionDecompositionAgent.ts` — `parentIds: [top.id]` (H2 split→edit→stitch)
- `evolution/src/lib/agents/treeSearchAgent.ts` — `parentIds: [root.id]` (beam search best leaf)
- `evolution/src/lib/agents/debateAgent.ts` — `parentIds: [variantA.id, variantB.id]` (debate synthesis)
- `evolution/src/lib/agents/evolvePool.ts` — Mixed: `[parent.id]` for mutation/creative, `[p0.id, p1.id]` for crossover
- `evolution/src/lib/agents/calibrationRanker.ts` — No variants; rating updates via `updateRating`/`updateDraw`
- `evolution/src/lib/agents/tournament.ts` — No variants; Swiss pairing, rating updates, confidence thresholds
- `evolution/src/lib/agents/reflectionAgent.ts` — No variants; dimensional critique of top 3
- `evolution/src/lib/agents/proximityAgent.ts` — No variants; diversity score computation
- `evolution/src/lib/agents/metaReviewAgent.ts` — No variants; strategy performance analysis
- `evolution/src/lib/agents/pairwiseRanker.ts` — No variants; full pairwise comparison (used by Tournament)

### Migrations
- `supabase/migrations/20260221000002_evolution_table_rename.sql` — Dropped apply_evolution_winner RPC and content_history table
- `supabase/migrations/20260131000004_content_history.sql` — Original content_history table (now dropped)
- `supabase/migrations/20260215000002_apply_evolution_winner_rpc.sql` — Original RPC (now dropped)
