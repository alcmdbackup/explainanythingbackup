# Make Competition More Efficient Research

## Problem Statement
Optimize the evolution pipeline's competition phase to reduce LLM comparison calls. The pipeline currently runs pairwise comparisons on all variants equally, including underperformers. Since we only care about finding the best articles, variants with Elo below 1200 (the starting baseline) can be deprioritized or excluded from further comparisons to save cost and improve throughput.

## Requirements (from GH Issue #406)
1. We only care about finding the **top articles** — certainly those with rating above baseline (1200), and really only the **top 5 articles**. Focus competition resources on accurately ranking those; others can be roughly correct.
2. **Unify on OpenSkill** for everything, including Hall of Fame (currently Elo K-32). One rating system across within-run and cross-run comparisons.
3. Leverage OpenSkill's sigma (uncertainty) to allocate comparison budget: high-sigma top variants get more matches, low-ranked variants get fewer or none.
4. Variants below baseline rating can be deprioritized or excluded from further pairwise comparisons to save LLM calls.

## High Level Summary

The system currently uses **two separate rating systems**: OpenSkill (within-run) and Elo K-32 (Hall of Fame). Unifying on OpenSkill enables sigma-based budget allocation — spending comparisons where uncertainty is highest among top variants rather than uniformly across the pool.

Key finding: `rating.ts` already has `eloToRating()` and `ordinalToEloScale()` backward-compat helpers, making migration incremental — store mu/sigma internally, display on familiar Elo scale.

Estimated impact: **30-50% fewer comparison LLM calls** by combining below-baseline filtering with sigma-based convergence for top variants.

---

## Current State: Two Rating Systems

### 1. Within-Run: OpenSkill (Weng-Lin Bayesian)
**File**: `src/lib/evolution/core/rating.ts` (81 lines)
**Library**: `openskill` v4.1.0

| Function | Purpose |
|----------|---------|
| `createRating()` | Returns `{mu: 25, sigma: 8.333}` |
| `updateRating(winner, loser)` | Decisive match update via `osRate` |
| `updateDraw(a, b)` | Draw update (tied rank) |
| `getOrdinal(r)` | Conservative estimate: `mu - 3*sigma` (fresh ≈ 0) |
| `isConverged(r)` | `sigma < 3.0` |
| `eloToRating(elo, matchCount)` | **Already exists** — Elo → OpenSkill |
| `ordinalToEloScale(ord)` | **Already exists** — ordinal → Elo display scale |

Key properties:
- Fresh ordinal ≈ 0 maps to Elo 1200 via `ordinalToEloScale()`
- Sigma naturally decays with more matches → uncertainty metric is built-in
- Convergence detection is sigma-based, not iteration-count-based

### 2. Cross-Run: Elo K-32 (Hall of Fame)
**File**: `src/lib/services/hallOfFameActions.ts`

| Constant | Value |
|----------|-------|
| `INITIAL_ELO` | 1200 |
| `ELO_K` | 32 |

Inline functions:
- `computeEloUpdate(ratingA, ratingB, scoreA)` — standard Elo with confidence-weighted scoring
- `computeEloPerDollar(elo, cost)` — `(elo - 1200) / cost`

**DB table** `evolution_hall_of_fame_elo`:
- `elo_rating` NUMERIC(8,2) — single number, CHECK [0, 3000]
- `elo_per_dollar` NUMERIC(12,2)
- `match_count` INT
- Indexed on `(topic_id, elo_rating DESC)` for leaderboard

---

## Within-Run: How Competition Resources Are Currently Spent

### Budget Allocation (from config.ts)
```
calibration: 15%   ← new entrant comparisons
tournament:  20%   ← Swiss-style ranking rounds
(total comparison budget: ~35% of run cost)
```

### EXPANSION Phase (iterations 0-N)
- GenerationAgent: 3 new variants/iteration (parallel, 3 LLM calls)
- CalibrationRanker: 3 opponents per entrant × 2 LLM calls each = **~18 LLM calls/iteration**
  - Stratified selection: 2 top, 2 mid, 1 bottom quartile (for 5 opponents)
  - Adaptive early exit: 2 opponents first, skip remainder if all decisive

### COMPETITION Phase (iterations N+1 to max)
- Tournament: Swiss pairing with info-theoretic scoring
  - `swissPairing()` scores pairs by: `outcomeUncertainty × sigmaWeight × topKBoost`
  - topKBoost: 1.5x when both in top ⅓
  - Convergence: all sigmas < 3.0 for 5 consecutive rounds
  - Budget-pressure adaptive: 15-40 max comparisons depending on budget state
  - **~20-40 comparisons × 2 LLM calls = 40-80 LLM calls**
- CalibrationRanker: 5 opponents per new entrant from other agents

### Total: ~100-150 comparison LLM calls per run

---

## Where "Compare All Equally" Currently Lives

### No below-baseline filtering anywhere:
1. **tournament.ts:73-77**: `swissPairing()` considers ALL pool variants for pairing
2. **pool.ts:27**: `getCalibrationOpponents()` selects from ALL existing variants (minus co-entrants)
3. **calibrationRanker.ts:122**: Opponents selected from full pool
4. **tournament.ts:278-286**: Rating updates don't check ordinal rank

### Baseline treatment:
- `BASELINE_STRATEGY = 'original_baseline'` — identified but not special-cased in comparisons
- Only exclusion: `pool.ts:98` excludes baseline from evolution parent selection
- Gets same default rating as all other variants: `{mu: 25, sigma: 8.333}`

---

## Hall of Fame Elo Migration Scope

### What needs to change:

**Database** (1 migration):
- Add `mu` REAL, `sigma` REAL columns to `evolution_hall_of_fame_elo`
- Keep `elo_rating` as computed column from `ordinalToEloScale(mu - 3*sigma)` for backward compat
- Or: store mu/sigma and derive elo_rating in application code

**Server actions** (`hallOfFameActions.ts`, ~30 Elo references):
- Replace `computeEloUpdate()` with `updateRating()`/`updateDraw()` from `core/rating.ts`
- Replace `INITIAL_ELO = 1200` with `createRating()` → `{mu: 25, sigma: 8.333}`
- Replace Elo-based sorting with ordinal-based sorting
- Update `computeEloPerDollar()` to use ordinal scale
- Swiss pairing already exists — can upgrade to info-theoretic pairing from tournament.ts

**CLI scripts** (2 files):
- `scripts/run-hall-of-fame-comparison.ts` — uses inline Elo math
- `scripts/run-prompt-bank-comparisons.ts` — uses inline Elo math

**UI** (2 pages + components):
- `hall-of-fame/page.tsx` — displays elo_rating, elo_per_dollar
- `hall-of-fame/[topicId]/page.tsx` — leaderboard sorted by elo_rating
- Can continue displaying on Elo scale via `ordinalToEloScale()` — UI change is minimal

**Tests** (~100+ assertions across 8 test files):
- `hallOfFameActions.test.ts` — 31 unit tests reference Elo constants
- CLI test files reference Elo math

### Migration path: Incremental via existing helpers
The `eloToRating(elo, matchCount)` function already exists for one-time data migration:
```typescript
// Existing entries: convert their Elo to OpenSkill
const rating = eloToRating(existingElo, existingMatchCount);
// New entries: use createRating() directly
```

---

## Extension Points for Efficiency

### 1. Tournament Swiss Pairing — Top-K Focus
**File**: `agents/tournament.ts:73-113`
- Current `topKBoost` is 1.5x for top ⅓
- Can increase to 3-5x for top 5, and add `belowBaselinePenalty` of 0.1x
- Skip pairs where both variants are below baseline ordinal

### 2. Calibration Opponent Selection — Filter Low Rank
**File**: `core/pool.ts:27-93`
- Current: selects from all existing variants
- Proposed: filter opponents to only above-baseline + a few diverse low-ranked
- New entrants only compared against variants that matter

### 3. Sigma-Based Tournament Termination
**File**: `agents/tournament.ts:339-351`
- Current: all sigmas < 3.0 for 5 consecutive rounds
- Proposed: only check sigma convergence for **top 5** variants
- Low-ranked variants can have high sigma — we don't care about their precise ranking

### 4. Pool Pruning After EXPANSION
**File**: `core/pipeline.ts` (new step)
- After initial calibration, remove variants whose ordinal is significantly below baseline
- Reduces pool size → fewer pairs per tournament round

### 5. Hall of Fame — Sigma-Based Pairing
**File**: `hallOfFameActions.ts:398-470`
- Current: round-based Swiss pairing on Elo
- With OpenSkill: sigma tells you which entries need more matches
- Skip entries with low sigma (well-established rating) unless paired with high-sigma newcomers

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (discovered during initialization)
- docs/evolution/rating_and_comparison.md
- docs/evolution/hall_of_fame.md
- docs/evolution/cost_optimization.md
- docs/evolution/architecture.md
- docs/evolution/README.md

## Code Files Read
- `src/lib/evolution/core/rating.ts` — OpenSkill wrapper (81 lines)
- `src/lib/evolution/agents/tournament.ts` — Swiss tournament, swissPairing(), convergence
- `src/lib/evolution/agents/calibrationRanker.ts` — Stratified opponent selection, adaptive early exit
- `src/lib/evolution/core/pool.ts` — getCalibrationOpponents(), baseline exclusion
- `src/lib/evolution/comparison.ts` — compareWithBiasMitigation()
- `src/lib/evolution/core/comparisonCache.ts` — Order-invariant SHA-256 cache
- `src/lib/evolution/core/supervisor.ts` — PoolSupervisor, phase config, budget
- `src/lib/evolution/config.ts` — Default config, rating constants
- `src/lib/evolution/types.ts` — TextVariation, PipelineState, BASELINE_STRATEGY
- `src/lib/services/hallOfFameActions.ts` — 14 server actions, Elo math, comparison flow
- `supabase/migrations/20260201000001_article_bank.sql` — evolution_hall_of_fame_elo schema
- `supabase/migrations/20260208000002_rename_article_bank_to_hall_of_fame.sql` — Table renames
- `src/lib/evolution/agents/generationAgent.ts` — 3-strategy generation
- `src/config/promptBankConfig.ts` — Prompt bank config
- `scripts/run-hall-of-fame-comparison.ts` — CLI Elo comparisons
- `scripts/run-prompt-bank-comparisons.ts` — CLI batch comparisons
