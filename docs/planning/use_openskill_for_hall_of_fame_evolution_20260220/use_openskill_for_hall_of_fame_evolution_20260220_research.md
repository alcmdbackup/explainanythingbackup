# Use OpenSkill for Hall of Fame Evolution Research

## Problem Statement
Replace the K-32 Elo rating system in the Hall of Fame with OpenSkill Bayesian ratings (mu/sigma) already used within evolution runs, unifying the rating approach across the system.

## Requirements (from GH Issue #487)
- Migrate evolution_hall_of_fame_elo table from Elo (rating/K-factor) to OpenSkill (mu/sigma/ordinal)
- Update hallOfFameActions.ts comparison logic
- Update all UI components showing Elo ratings
- Update CLI scripts
- Deprecate Elo calculation code
- Update elo_per_dollar to ordinal_per_dollar
- Maintain backward compat for existing data

## High Level Summary

The Hall of Fame currently uses a **separate Elo K-32 rating system** while the evolution pipeline uses **OpenSkill (Weng-Lin Bayesian)**. The Elo code is duplicated across 4+ files with identical `computeEloUpdate()` and `computeEloPerDollar()` functions. The migration involves:

1. **Database**: Add `mu`, `sigma`, `ordinal` columns to `evolution_hall_of_fame_elo`; deprecate `elo_rating`
2. **Server Actions**: Replace `computeEloUpdate()` with OpenSkill's `updateRating()`/`updateDraw()` from `core/rating.ts`
3. **UI**: ~15 components reference "Elo" across 6+ pages
4. **CLI**: 4 scripts duplicate the Elo math; migrate to shared `core/rating.ts`
5. **Tests**: 9+ test files assert Elo behavior

The existing `core/rating.ts` already has all needed OpenSkill functions plus backward-compat helpers (`eloToRating`, `ordinalToEloScale`), making migration feasible.

---

## Current Elo Implementation: Server Actions

### File: `evolution/src/services/hallOfFameActions.ts`

**Constants** (lines 34-35):
- `INITIAL_ELO = 1200`
- `ELO_K = 32`

**Core Functions**:
- `computeEloUpdate(ratingA, ratingB, scoreA, k)` (lines 37-45): Standard Elo formula with K=32, expected score via `1/(1+10^((rB-rA)/400))`, floor at 0
- `computeEloPerDollar(eloRating, totalCostUsd)` (lines 47-50): `(elo - 1200) / cost`, null if cost is 0/null

**Initialization** (lines 188-194, 744-752):
- New entries get `elo_rating: 1200, match_count: 0, elo_per_dollar: computed`

**Comparison Update** (lines 341-500 `runHallOfFameComparisonInternal`):
- Swiss-style pairing by descending Elo
- Score: `0.5 + 0.5 * confidence` for winner, `0.5 - 0.5 * confidence` for loser, `0.5` for tie
- In-memory Elo map updated, then upserted to DB
- Rounded to 2 decimals: `Math.round(elo.rating * 100) / 100`

**Types** (lines 76-86):
```typescript
interface HallOfFameEloEntry {
  id: string; entry_id: string; elo_rating: number;
  elo_per_dollar: number | null; match_count: number;
  generation_method: HallOfFameGenerationMethod;
  model: string; total_cost_usd: number | null; created_at: string;
}
```

---

## Current Elo Implementation: CLI Scripts

### Duplicated Elo Code (identical constants/formulas in each):
1. `evolution/scripts/run-hall-of-fame-comparison.ts` (lines 96-115)
2. `evolution/scripts/run-prompt-bank-comparisons.ts` (lines 56-75)
3. `evolution/scripts/lib/hallOfFameUtils.ts` (lines 23-28)

### OpenSkill → Elo Conversion (already exists):
4. `evolution/scripts/run-evolution-local.ts` (line 32): `import { getOrdinal, ordinalToEloScale }`
5. `evolution/scripts/run-batch.ts` (line 30): same imports

---

## Database Schema

### Table: `evolution_hall_of_fame_elo`
**Migration**: `20260201000001_article_bank.sql` (lines 61-75)

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK |
| `topic_id` | UUID FK | NOT NULL, CASCADE |
| `entry_id` | UUID FK | NOT NULL, CASCADE |
| `elo_rating` | NUMERIC(8,2) | NOT NULL DEFAULT 1200, CHECK 0-3000 |
| `elo_per_dollar` | NUMERIC(12,2) | nullable |
| `match_count` | INT | NOT NULL DEFAULT 0 |
| `updated_at` | TIMESTAMP | NOT NULL DEFAULT NOW() |

**Unique**: `(topic_id, entry_id)`
**Index**: `(topic_id, elo_rating DESC)` for leaderboard

### Related Elo-scale columns (OUT OF SCOPE — already OpenSkill-derived):
These columns store OpenSkill ordinals mapped to 0-3000 Elo display scale via `ordinalToEloScale()`.
They do NOT use Elo K-32 math — they're backward-compat display columns. Renaming is optional.
- `evolution_variants.elo_score` — ordinal mapped to Elo scale at persist time
- `evolution_run_agent_metrics.avg_elo` NUMERIC(8,2) — average of variant elo_scores
- `evolution_run_agent_metrics.elo_gain` NUMERIC(8,2) — avg_elo - 1200
- `evolution_run_agent_metrics.elo_per_dollar` NUMERIC(12,2) — (avg_elo - 1200) / cost
- `evolution_strategy_configs.avg_final_elo` NUMERIC(8,2) — from metricsWriter.ts
- `evolution_strategy_configs.avg_elo_per_dollar` NUMERIC(12,2) — from `update_strategy_config_aggregates` RPC
- `evolution_strategy_configs.best_final_elo` / `worst_final_elo` / `stddev_final_elo`
- `update_strategy_config_aggregates()` RPC — hardcoded `- 1200` baseline (valid for both Elo and ordinal→Elo scale)

### Key Distinction: Two categories of "Elo" in the codebase
1. **Real Elo K-32 math** (IN SCOPE): Only in `evolution_hall_of_fame_elo` table + `hallOfFameActions.ts` + 3 CLI scripts
2. **Elo-scale display** (OUT OF SCOPE): All other tables store OpenSkill ordinals converted to 0-3000 range via `ordinalToEloScale()` — the underlying rating system is already OpenSkill

---

## Existing OpenSkill System (Target)

### File: `evolution/src/lib/core/rating.ts`

**Type**: `Rating = { mu: number; sigma: number }`
**Defaults**: `mu=25, sigma=25/3 ≈ 8.333`
**Convergence**: `sigma < 3.0`

**Functions (already exist)**:
| Function | Purpose |
|----------|---------|
| `createRating()` | Fresh rating {mu:25, sigma:8.333} |
| `updateRating(winner, loser)` | Decisive match update |
| `updateDraw(a, b)` | Draw update |
| `getOrdinal(r)` | mu - 3σ (conservative estimate) |
| `isConverged(r, threshold?)` | sigma < threshold |
| `eloToRating(elo, matchCount)` | Legacy Elo → OpenSkill |
| `ordinalToEloScale(ord)` | Ordinal → 0-3000 Elo scale |

**Mapping formulas**:
- Elo → Rating: `mu = 25 + (elo-1200) * (25/400)`, sigma based on matchCount
- Ordinal → Elo: `1200 + ordinal * (400/25)`, clamped [0, 3000]

---

## UI Components Referencing Elo

### Hall of Fame Pages
| Component | File | Elo Fields |
|-----------|------|------------|
| CrossTopicSummary | `hall-of-fame/page.tsx:46-88` | avg_elo, avg_elo_per_dollar |
| PromptBankSummary | `hall-of-fame/page.tsx:108-183` | avgElo, bestMethod by Elo |
| Topics Table | `hall-of-fame/page.tsx:557-624` | elo_min, elo_max range |
| CostEloScatter | `hall-of-fame/[topicId]/page.tsx:32-95` | elo Y-axis, median Elo reference line |
| Leaderboard | `hall-of-fame/[topicId]/page.tsx:715-836` | elo_rating, elo_per_dollar columns |
| AddFromRunDialog | `hall-of-fame/[topicId]/page.tsx:351-534` | winner.elo_score display |

### Evolution Run Pages
| Component | File | Elo Fields |
|-----------|------|------------|
| EloTab | `evolution/tabs/EloTab.tsx` | Elo history chart, baseline 1200 line |
| VariantsTab | `evolution/tabs/VariantsTab.tsx:139-162` | elo_score ranking, EloSparkline |
| EloSparkline | `evolution/EloSparkline.tsx` | Inline elo trajectory |

### Optimization & Strategy Pages
| Component | File | Elo Fields |
|-----------|------|------------|
| CostSummaryCards | `optimization/_components/CostSummaryCards.tsx:73-76` | avgEloPerDollar |
| AgentROILeaderboard | `optimization/_components/AgentROILeaderboard.tsx:58-60` | avgEloPerDollar |
| StrategyLeaderboard | `optimization/_components/StrategyLeaderboard.tsx:70` | avgEloPerDollar |
| Strategies Table | `strategies/page.tsx:990-1060` | avg_elo_per_dollar |
| Explorer | `explorer/page.tsx:1084` | elo_per_dollar |

### Sidebar Navigation
- `EvolutionSidebar.tsx:23`: "Elo Optimization" nav item

---

## Core Comparison Logic: Detailed Data Flow (hallOfFameActions.ts:341-500)

### Current Flow (Elo K-32):
```
1. Fetch entries + current elo_rating from evolution_hall_of_fame_elo
2. Build in-memory eloMap: Map<entryId, { rating: number, matchCount: number }>
3. Swiss-pair by sorting on rating (descending), pair adjacent
4. For each pair:
   a. compareWithBiasMitigation() → { winner: 'A'|'B'|null, confidence: 0-1 }
   b. Map to scoreA: winner='A' → 0.5+0.5*conf, 'B' → 0.5-0.5*conf, null → 0.5
   c. computeEloUpdate(ratingA, ratingB, scoreA) → [newA, newB]
   d. Update in-memory map
5. Persist: upsert elo_rating + elo_per_dollar + match_count
```

### After Migration (OpenSkill):
```
1. Fetch entries + current mu, sigma from evolution_hall_of_fame_elo
2. Build in-memory ratingMap: Map<entryId, { rating: Rating, matchCount: number }>
3. Swiss-pair by sorting on getOrdinal(rating) (descending), pair adjacent
4. For each pair:
   a. compareWithBiasMitigation() → { winner, confidence } (unchanged)
   b. If winner='A': updateRating(ratingA, ratingB) → [newA, newB]
      If winner='B': updateRating(ratingB, ratingA) → [newB, newA]
      If draw OR low confidence: updateDraw(ratingA, ratingB) → [newA, newB]
   c. Update in-memory map
5. Persist: upsert mu, sigma, ordinal=getOrdinal(r), elo_rating=ordinalToEloScale(ordinal),
   match_count, elo_per_dollar=(ordinalToEloScale(ordinal)-1200)/cost
```

### Key Behavioral Differences:
- **Confidence handling**: Elo uses confidence as a continuous weight (0.5±0.5*conf). OpenSkill is binary: decisive (updateRating) vs draw (updateDraw). Need to decide threshold.
- **New entries**: Elo starts at 1200 (fixed). OpenSkill starts at {mu:25, sigma:8.333} = high uncertainty → larger initial swings, rapid convergence.
- **Update magnitude**: Elo has fixed K=32 always. OpenSkill adjusts via sigma — uncertain entries (high sigma) swing more, established entries (low sigma) swing less.
- **Convergence**: Elo never converges. OpenSkill converges when sigma < 3.0 — entries can become "stable".

---

## Pipeline Integration

### File: `evolution/src/lib/core/hallOfFameIntegration.ts`

**`feedHallOfFame()`** (lines 106-221):
- Top 3 variants → `evolution_hall_of_fame_entries` with rank 1/2/3
- Elo initialized via `ordinalToEloScale(getOrdinal(rating))` — converts OpenSkill to Elo scale
- Auto-triggers 1 round of `runHallOfFameComparisonInternal()` for re-ranking

---

## Test Files

| File | Elo Tests | Key Assertions |
|------|-----------|----------------|
| `hallOfFameActions.test.ts` | 17 tests | Init at 1200, Elo updates, elo_per_dollar null cases, cross-topic summary, prompt bank method summary |
| `hallOfFameUtils.test.ts` | 5 tests | Init at 1200, elo_per_dollar null when cost=0 |
| `run-hall-of-fame-comparison.test.ts` | 9 tests | computeEloUpdate math, elo_per_dollar boundaries, round counting |
| `hallOfFame.test.ts` | 6 tests | feedHallOfFame top-3, auto re-ranking |
| `hallOfFameIntegration.test.ts` | 13 tests | findTopicByPrompt, linkPromptToRun, feedHallOfFame variants |
| `rating.test.ts` | 11 tests | eloToRating, ordinalToEloScale, round-trip preservation |
| `hall-of-fame-actions.integration.test.ts` | 9 tests | Real DB: init 1200, cascade deletes, concurrent upsert |
| `admin-hall-of-fame.spec.ts` | 14 E2E tests | Leaderboard columns, Elo comparison updates, scatter chart |
| `eloBudgetActions.test.ts` | 5 tests | Agent ROI leaderboard, Elo per dollar aggregation |

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/evolution/hall_of_fame.md
- evolution/docs/evolution/rating_and_comparison.md
- evolution/docs/evolution/data_model.md
- evolution/docs/evolution/architecture.md
- evolution/docs/evolution/README.md
- evolution/docs/evolution/cost_optimization.md
- evolution/docs/evolution/reference.md

## Code Files Read
- evolution/src/services/hallOfFameActions.ts — Elo math, 14 server actions, types
- evolution/src/lib/core/rating.ts — OpenSkill wrapper (target system)
- evolution/src/lib/core/hallOfFameIntegration.ts — Pipeline → HoF feeding
- evolution/src/lib/types.ts — Shared type definitions
- evolution/scripts/run-hall-of-fame-comparison.ts — CLI comparison with Elo
- evolution/scripts/run-prompt-bank-comparisons.ts — Batch comparison with Elo
- evolution/scripts/lib/hallOfFameUtils.ts — Shared Elo init
- evolution/scripts/run-evolution-local.ts — OpenSkill→Elo conversion
- evolution/scripts/run-batch.ts — Batch runner Elo output
- evolution/scripts/add-to-hall-of-fame.ts — Winner selection by elo_score
- supabase/migrations/20260201000001_article_bank.sql — Schema
- supabase/migrations/20260207000005_hall_of_fame_rank.sql — Rank column
- supabase/migrations/20260208000002_rename_article_bank_to_hall_of_fame.sql — Rename
- src/lib/schemas/schemas.ts — Zod schemas
- src/app/admin/quality/hall-of-fame/page.tsx — Topic list UI
- src/app/admin/quality/hall-of-fame/[topicId]/page.tsx — Topic detail UI
- evolution/src/components/evolution/tabs/EloTab.tsx — Elo history chart
- evolution/src/components/evolution/tabs/VariantsTab.tsx — Variant ranking
- evolution/src/components/evolution/EloSparkline.tsx — Inline sparkline
- src/app/admin/quality/optimization/_components/*.tsx — Dashboard components
- src/app/admin/quality/strategies/page.tsx — Strategy table
- src/app/admin/quality/explorer/page.tsx — Explorer results
- src/components/admin/EvolutionSidebar.tsx — Navigation
- All 9 test files listed above
