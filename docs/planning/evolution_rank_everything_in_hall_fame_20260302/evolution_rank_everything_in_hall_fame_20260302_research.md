# Evolution Rank Everything in Hall of Fame Research

## Problem Statement
The evolution system has two separate OpenSkill rating systems — one within each pipeline run (ephemeral) and one in the Hall of Fame (persistent, cross-run). The goal is to consolidate into a single pool ("Arena") where all content is ranked. New variants get pushed into the Arena and rated against existing entries using the existing CalibrationRanker/Tournament agents — no separate comparison step needed.

## Requirements
- ONE central pool for ranking (rename "Hall of Fame" to "Arena")
- New variants ranked against existing pool entries from the start of a pipeline run
- Cost-effective — no separate anchor algorithm, no extra LLM comparison steps
- Maximum simplicity — existing agents (CalibrationRanker, Tournament) handle all comparisons

## High Level Summary

### The Two Rating Systems Today

**System 1 — Within-Run Ratings** (ephemeral, per-run):
- Every variant gets `{mu=25, sigma=8.333}` when added to the pool
- CalibrationRanker (EXPANSION) does stratified pairwise comparisons for new entrants
- Tournament (COMPETITION) does Swiss-style pairing for maximum info gain per comparison
- Ratings drive: parent selection, stopping conditions, winner selection, agent behavior guards
- At finalization: `elo_score` persisted to `evolution_variants`, top 2 fed to HoF
- Within-run ratings are disconnected from the global HoF scale

**System 2 — Hall of Fame Ratings** (persistent, cross-run):
- Entries added via: pipeline auto-feed (top 2), manual add, oneshot generation, CLI scripts
- Swiss-style pairwise comparisons between entries in same topic
- Separate `evolution_hall_of_fame_elo` table with own `{mu, sigma, ordinal, elo_rating, match_count}`
- Auto-rerank triggers 1 round of gpt-4.1-nano comparisons on insertion
- Separate lifecycle — within-run ratings seed starting position but HoF runs independently

### Key Insight: The Arena IS the Pool

The breakthrough realization: **we don't need two systems or a separate anchor algorithm.** Load Arena entries into `state.pool` at pipeline start with their existing `{mu, sigma}`. CalibrationRanker already does stratified opponent selection (top/mid/bottom quartile). Tournament already does Swiss pairing. These agents naturally compare new variants against Arena entries — no special treatment needed.

This eliminates:
- The "anchor selection" algorithm — CalibrationRanker already does this
- The "auto-rerank" step at finalization — comparisons already happened during the run
- The "write-back" step — elo_score comes directly from Arena-scale ratings
- The "two-layer model" — one pool, one scale

### Evolution of Thinking

1. **Initial plan (two-layer with write-back):** Keep within-run ratings separate. At finalization, feed top-3 to HoF with anchor seeding (3 LLM comparisons), Swiss refinement, then write HoF ordinal back to elo_score. Complex.

2. **Challenged assumption:** "Why can't newly generated variants be ranked against the Hall of Fame pool?" — The "within-run ratings MUST stay" claim was overstated. Agents need `{mu, sigma}` per variant, but don't care where those ratings came from. If Arena entries are in the pool, agents use them naturally.

3. **Final design (single pool):** Load Arena entries at start → agents compare naturally → persist back at end. No anchors, no auto-rerank, no write-back. Maximum simplicity.

### Blast Radius

- ~35 production source files depend on within-run ratings (but ZERO changes needed to agents)
- ~35 test files test rating behavior (most unchanged)
- 4 DB tables for Arena (existing HoF tables, renamed in this PR)
- Architecture change touches ~11 files
- Rename touches ~50 files but is mechanical find-replace (same PR)

### Rename Scope (Hall of Fame → Arena)

Full mapping done. Key counts:
- ~20 production source files with "hall_of_fame" / "HallOfFame" references
- ~18 test files
- 4 live DB tables to rename
- 1 URL route directory (`/admin/quality/hall-of-fame` → `/admin/quality/arena`)
- 13 files to physically rename
- 7 indexes (1 was already dropped) + all FK/CHECK constraints to rename
- Rename done in same PR as architecture changes

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/hall_of_fame.md — HoF architecture, 3 workflows, Swiss-style comparison, prompt bank
- evolution/docs/evolution/rating_and_comparison.md — OpenSkill math, Swiss tournament, bias mitigation, calibration
- evolution/docs/evolution/data_model.md — Core primitives, explanation vs variant, strategy system
- evolution/docs/evolution/visualization.md — EloTab, EloSparkline, VariantsTab, run detail pages
- evolution/docs/evolution/README.md — Two rating systems overview, config validation
- docs/feature_deep_dives/article_detail_view.md — Elo attribution, article/variant detail pages
- evolution/docs/evolution/cost_optimization.md — Cost tracking, elo_per_dollar metrics
- evolution/docs/evolution/reference.md — Config, budget caps, DB schema, all key files

## Code Files Read

### Core Rating System
- `evolution/src/lib/core/rating.ts` — OpenSkill wrapper (createRating, updateRating, updateDraw, getOrdinal, ordinalToEloScale)
- `evolution/src/lib/core/state.ts` — PipelineState.addToPool preserves pre-seeded ratings (line 64: `if (!this.ratings.has(id))`)
- `evolution/src/lib/core/pipeline.ts` — finalizePipelineRun calls: persistVariants → autoLinkPrompt → feedHallOfFame
- `evolution/src/lib/core/supervisor.ts` — ordinalHistory tracking, plateau detection
- `evolution/src/lib/core/persistence.ts` — persistVariants writes elo_score at line 76
- `evolution/src/lib/core/pool.ts` — getCalibrationOpponents uses quartile-stratified selection
- `evolution/src/lib/core/hallOfFameIntegration.ts` — feedHallOfFame, upsertEloRatings, triggerAutoReRank, resolveTopicId
- `evolution/src/lib/core/eloAttribution.ts` — computeEloAttribution, aggregateByAgent
- `evolution/src/lib/index.ts` — preparePipelineRun() constructs state (line 156)

### Agents (confirmed zero changes needed)
- `evolution/src/lib/agents/calibrationRanker.ts` — stratified opponent selection works on ANY pool member
- `evolution/src/lib/agents/tournament.ts` — Swiss pairing works on ANY pool member
- `evolution/src/lib/agents/evolvePool.ts` — parent selection by ordinal
- `evolution/src/lib/agents/treeSearchAgent.ts` — root selection by highest mu with sigma > threshold
- `evolution/src/lib/agents/metaReviewAgent.ts` — rankings for strategy analysis
- `evolution/src/lib/treeOfThought/evaluator.ts` — local OpenSkill ratings (separate from state.ratings)

### Hall of Fame / Arena
- `evolution/src/services/hallOfFameActions.ts` — 14 server actions, manual comparison workflow, leaderboard
- `evolution/scripts/lib/hallOfFameUtils.ts` — CLI insertion utilities
- `evolution/src/config/promptBankConfig.ts` — 5 prompts x 6 methods config

## Key Findings

### Round 1: Sigma Decay & Convergence

1. **3 comparisons barely move sigma** — From 8.333 to ~7.1 after 3 matches. Need ~11 for sigma < 5.0, ~40 for sigma < 3.0. The `eloToRating` heuristic (`matchCount>=4 → sigma=5.0`) is 3x too optimistic.

2. **Close matches are most informative** — Alternating W/L against opponents with similar mu produces fastest convergence. One-sided streaks cause mu drift that reduces information per match.

3. **Opponent sigma matters modestly** — Well-calibrated anchor (sigma=2) vs uncertain opponent (sigma=8.333): only ~0.39 sigma units difference after 3 matches.

### Round 1: HoF Scale & Mechanics

4. **Topics are small** — 5-20 entries typically. No converged anchors exist in practice (most entries have match_count < 5).

5. **CalibrationRanker IS anchor-based** — `getCalibrationOpponents` uses quartile-stratified selection (2 top, 2 mid, 1 bottom). This is exactly the "anchor selection" that was proposed as a new algorithm. It already exists.

6. **Swiss and calibration compose naturally** — CalibrationRanker = fast initial placement. Tournament = local refinement. They already work together within a run.

### Round 1: Literature

7. **Chess/Glicko/TrueSkill: 10-15 calibration matches recommended.** USCF: 25 for "established." Halo/CS2/Valorant: 5-10 placement matches. Loading Arena entries into the pool gives new variants many more comparison partners than 3 anchors would.

8. **PAIRS paper: 30% savings with anchor-based binary search.** But our approach is even simpler — no binary search, just use existing CalibrationRanker/Tournament agents.

### Round 2: Implementation

9. **`addToPool` preserves pre-seeded ratings** — `state.ts:64`: `if (!this.ratings.has(variation.id)) { this.ratings.set(...)`. Pre-seeding `state.ratings` before `addToPool` works perfectly.

10. **Topic resolution can move to start** — `resolveTopicId` / `findTopicByPrompt` are already exported utilities. Call them before `insertBaselineVariant` instead of at finalization.

11. **`persistVariants` can filter by `fromArena` tag** — Arena entries loaded at pipeline start are tagged `fromArena: true` on the pool entry (NOT a special strategy). Excluded from `persistVariants()` with one filter line. *(Supersedes earlier idea of using `strategy: 'arena_entry'` — entries keep their original strategy.)*

12. **Checkpoint/resume handled automatically** — Arena entries serialize with the pool into checkpoint state. On resume, they're restored with ratings. No special handling.

### Round 2: Cost

13. **All scenarios negligible at gpt-4.1-nano** — Even the most expensive approach (top-5, full comparison) costs ~$0.08/run ($2.40/month). The single-pool approach is even cheaper: NO extra LLM calls at all — CalibrationRanker/Tournament comparisons happen regardless.

### Round 2: Agent Classification (what needs {mu, sigma})

14. **Tournament (MUST have {mu, sigma})** — Swiss pairing uses ordinal + sigma for info-theoretic scoring.
15. **TreeSearch (MUST have {mu, sigma})** — Root selection explicitly uses mu (not ordinal) and sigma for exploration filter.
16. **Supervisor (needs ordinal)** — Plateau detection tracks top ordinal across iterations.
17. **Evolution parent selection (needs ranking only)** — Any ordering signal works.

These agents don't care WHERE the ratings come from — they just need `state.ratings` to have values. Pre-seeding from Arena works perfectly.

### Round 3: Simplified Design

18. **No anchors needed** — CalibrationRanker already handles stratified opponent selection. Loading Arena entries into the pool gives it more opponents to select from, which is strictly better.

19. **No auto-rerank needed** — CalibrationRanker and Tournament already compare all pool entries (including Arena entries) during the pipeline run. At finalization, ratings are already correct.

20. **No write-back needed** — `elo_score` on `evolution_variants` comes from `state.ratings` via `persistVariants()`. Since state.ratings operates on the Arena scale (Arena entries pre-seeded), elo_score is already Arena-scale.

21. **Architecture change is ~11 files** — types.ts, arenaIntegration.ts, pipeline.ts, persistence.ts, index.ts, calibrationRanker.ts, run detail page, EloTab, schemas.ts, prompt-bank-comparisons.ts, arenaUtils.ts. Zero changes to agents (except CalibrationRanker sigma filter) or most services.

### Rename Scope

22. **~50 files for Hall of Fame → Arena rename** — 20 production, 18 test, 4 DB tables, 13 file renames, 1 directory rename. Done in same PR.

## Resolved Questions

1. **Scope**: ALL variants enter the Arena. Every variant created during a pipeline run is an Arena entry. Topics grow over time; CalibrationRanker's stratified selection and Tournament's maxComparisons cap handle larger pools naturally.

2. **Anchors**: Not needed. CalibrationRanker already does stratified opponent selection. Loading Arena entries into pool gives agents more comparison partners naturally.

3. **Auto-rerank**: Eliminated. Comparisons already happen during the pipeline run.

4. **elo_score on variants**: Snapshot of Arena-scale rating at time of persistence. Canonical rating lives in `evolution_arena_elo` and updates across pipeline executions.

5. **Naming**: "Hall of Fame" → "Arena". Rename in same PR as architecture changes.

6. **One system**: There is no "in-run" rating system. The pipeline operates directly on the Arena. Load entries at start, agents compare naturally, persist new entries and updated ratings at end.

7. **CalibrationRanker skip logic**: Based on sigma threshold (already calibrated = low sigma), NOT on a special strategy tag. No origin-based distinctions.

8. **Baselines**: Baselines are Arena entries too. They get persisted to `evolution_arena_entries` like everything else.

9. **Admin panel "Add to HoF" button**: Removed from run detail page. All variants auto-enter the Arena. The `addToArenaAction` stays for CLI/manual/oneshot use cases.

10. **Agent metrics (avg_elo, elo_per_dollar)**: These are per-run analytics rollups computed from Arena-scale ratings. Not a separate system. No changes needed.
