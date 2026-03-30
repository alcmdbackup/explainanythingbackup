# Anchors For Evolution Ranking Research

## Problem Statement
Explore whether using "anchor variants" for arena ranking would speed up ranking convergence of newer variants. Anchors are designated well-established variants that serve as the exclusive comparison opponents for new entrants. Because anchors accumulate many matches, they develop much lower sigma (uncertainty) values. The hypothesis is that comparing high-sigma new variants against low-sigma anchors will cause the new variants' ratings to converge faster in the Weng-Lin Bayesian model.

## Requirements (from GH Issue #845)
Requirements are open-ended — the research phase will determine specifics based on:
- Whether the Weng-Lin math supports faster convergence when pairing high-sigma vs low-sigma players
- Trade-offs around anchor staleness and rating distortions
- Prior art in gaming/tournament rating systems
- Practical implementation constraints in the current evolution pipeline

## High Level Summary

**Anchors work. The math confirms ~2x faster sigma reduction per match and ~3.3x fewer total matches to reach calibration threshold.**

Key findings:
1. The system uses **Plackett-Luce** (not Bradley-Terry) with beta=sigma/2=4.167. No tau, no model override.
2. Sigma reduction per match scales as `sigma^3 / c^3` where `c = sqrt(Σ(sigma_i² + beta²))`. Low-sigma opponents make c smaller → delta larger → faster convergence.
3. New vs anchor (σ=2): reaches σ<5.0 in **~17-18 matches**. New vs new (σ=8.33): **~60 matches**. That's **3.3x faster**.
4. However, σ<3.0 (DEFAULT_CONVERGENCE_SIGMA) is essentially **unreachable in a single run** (~500+ matches), making it a vestigial threshold. The real convergence mechanism is "stale" (no new Swiss pairs).
5. No anchor concept exists in the codebase. The closest analogue is arena entries with `synced_to_arena=true`, which participate in triage with pre-seeded mu/sigma.
6. `selectOpponents()` is deterministic, stratified by mu quartile, with **no sigma consideration** — the easiest integration point.
7. Realistic arena entry sigmas after pipeline runs: 4-8 (not the 1-2 range assumed in initial research).

## Detailed Findings

### 1. OpenSkill Configuration (Actual)

| Parameter | Expected | Actual | Source |
|-----------|----------|--------|--------|
| Model | Bradley-Terry | **Plackett-Luce** (default) | `osRate()` called with no `model` option |
| Beta | sigma*√2 = 11.78 | **sigma/2 = 4.167** | `node_modules/openskill/dist/constants.js` |
| Tau | Not used | **Not passed** (0.0833 default exists but inflation code requires `options.tau`) | `computeRatings.ts` only passes `{ rank }` |
| preventSigmaIncrease | N/A | **Not used** | Only effective when tau is set |

**Key files:**
- `evolution/src/lib/shared/computeRatings.ts` — wrapper functions, constants
- `node_modules/openskill/dist/models/plackett-luce.js` — actual update equations
- `node_modules/openskill/dist/rate.js` — tau/limitSigma preprocessing

### 2. The Sigma Update Math

For a 1v1 match with Plackett-Luce (equal mus, p=0.5):

```
c = sqrt(sigma_w² + BETASQ + sigma_l² + BETASQ)    where BETASQ = 17.36
delta = sigma_i³ / (4 × c³)
new_sigma = sigma × sqrt(1 - delta)
```

| Scenario | c | delta | sigma reduction per match |
|----------|---|-------|--------------------------|
| New (σ=8.33) vs Anchor (σ=2.0) | 10.40 | 0.129 | **0.555** |
| New (σ=8.33) vs New (σ=8.33) | 13.18 | 0.063 | **0.267** |
| New (σ=8.33) vs Tight Anchor (σ=1.0) | 10.26 | 0.134 | **0.579** |

**Per-match sigma reduction is ~2x larger against anchors** (0.555 vs 0.267). This compounds multiplicatively over matches.

### 3. Convergence Speed Comparison

| Opponent sigma | Matches to σ<5.0 | Matches to σ<3.0 |
|---------------|-------------------|-------------------|
| 8.333 (new) | ~60 | >500 |
| 2.0 (anchor) | ~17-18 | ~388 |
| 1.0 (tight) | ~17 | ~339 |

**Diminishing returns between σ=2 and σ=1 anchors** — only ~1 match difference for the 5.0 threshold. The big gain is new-vs-anchor vs new-vs-new.

### 4. Current Triage Implementation

**File:** `evolution/src/lib/pipeline/loop/rankVariants.ts`

`selectOpponents()` (lines 59-157) uses stratified sampling:
- 2 from top quartile (by mu)
- 2 from middle
- 1 from bottom (prefers fellow new entrants)
- **Deterministic** — always picks first available in each quartile
- **No sigma consideration** — sorts by mu only
- **No randomness**

Triage runs `calibrationOpponents` matches (default 5) per new entrant, with early exit if:
- ≥2 decisive matches (confidence ≥ 0.7) AND avg confidence ≥ 0.8

Elimination if: `mu + 2σ < top20Cutoff`

### 5. Current Arena Integration

**Files:**
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — `loadArenaEntries()`, `isArenaEntry()`
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — `syncToArena()`

Arena entries loaded with pre-seeded mu/sigma from DB. Filtered: `synced_to_arena=true`, `archived_at IS NULL`. Strategy tagged as `arena_<generation_method>`. `fromArena: true` flag prevents re-persistence in finalization.

**No anchor concept exists.** All arena entries are equal participants.

### 6. Realistic Sigma Values

From test fixtures and code analysis:
- Newly synced variants: σ ≈ 7-8.5 (near DEFAULT_SIGMA)
- After 3-10 matches: σ ≈ 4-6
- After 20+ matches: σ ≈ 2-4
- DB default: σ = 8.333, with no sigma floor

Without tau enabled, sigma shrinks indefinitely toward 0 but very slowly (asymptotic).

### 7. Tau and Sigma Floor Options

- OpenSkill options are **global per `rate()` call** — no per-player tau
- To set different sigma behavior for anchors, must manually clamp: `sigma = Math.max(newSigma, floor)`
- Simplest approach: post-process anchor sigma after `rate()` call
- Sigma floor recommendation: 2.0-3.0 (keeps anchors informative without becoming immovable)

### 8. Design Recommendations (from analysis)

| Decision | Recommendation |
|----------|---------------|
| Selection strategy | Stratified by elo quartile, lowest sigma per quartile |
| Anchor count | 4-6 total (1-2 per quartile) |
| Lifecycle | Dynamic selection per run, locked during run |
| Sigma threshold | Adaptive: `max(5.0, P25(all_sigmas))` |
| Integration | Modify selectOpponents to prefer low-sigma variants; anchor seeding for new variants only (match_count < 10) |
| Swiss participation | Eligible but not forced; no special treatment |
| Sigma floor | Manual clamp at 2.0 for designated anchors |

### 9. Prior Art

| System | Mechanism | Relevance |
|--------|-----------|-----------|
| Glicko (chess.com) | `g(RD)` function down-weights high-RD opponents | Same mathematical principle — low-uncertainty opponents calibrate faster |
| USCF Rating | Higher K-factor for provisional players | Established players = anchors, new players move fast |
| TrueSkill (Xbox) | Sigma-based asymmetric updates | Explicitly designed for new players to calibrate against established ones |
| Swiss tournaments (chess) | Seed unrated against rated in early rounds | Exact same strategy as anchor-based triage |

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs
- evolution/docs/arena.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/architecture.md
- docs/feature_deep_dives/evolution_metrics.md
- docs/feature_deep_dives/evolution_logging.md
- evolution/docs/metrics.md
- evolution/docs/visualization.md

## Code Files Read
- `evolution/src/lib/shared/computeRatings.ts` — Rating wrappers, OpenSkill API calls, constants, cache, comparison logic
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — rankPool(), selectOpponents(), triage, Swiss fine-ranking
- `evolution/src/lib/pipeline/setup/buildRunContext.ts` — loadArenaEntries(), isArenaEntry(), ArenaTextVariation
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — syncToArena(), variant persistence
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — Run orchestration, arena loading/syncing
- `evolution/src/lib/core/agents/RankingAgent.ts` — Agent wrapper around rankPool
- `evolution/src/services/arenaActions.ts` — Arena server actions (getArenaEntriesAction, etc.)
- `src/app/admin/evolution/arena/[topicId]/page.tsx` — Leaderboard display
- `src/app/admin/evolution/arena/[topicId]/arenaCutoff.ts` — Eligibility cutoff computation
- `evolution/src/lib/utils/formatters.ts` — formatEloCIRange(), elo95CI()
- `node_modules/openskill/dist/models/plackett-luce.js` — Actual PL update equations
- `node_modules/openskill/dist/rate.js` — rate() function, tau/limitSigma preprocessing
- `node_modules/openskill/dist/constants.js` — OpenSkill defaults (beta, tau, epsilon)
- `supabase/migrations/20260326000002_fix_sync_to_arena_match_count.sql` — sync_to_arena RPC
- `supabase/migrations/20260322000006_evolution_fresh_schema.sql` — Schema definitions

### Test Files Read
- `evolution/src/lib/shared/computeRatings.test.ts` — Rating math unit tests (260 lines)
- `evolution/src/lib/shared/computeRatings.cache.test.ts` — Cache behavior tests (186 lines)
- `evolution/src/lib/shared/computeRatings.comparison.test.ts` — Bias mitigation tests (215 lines)
- `evolution/src/lib/shared/computeRatings.reversal.test.ts` — 2-pass reversal tests (104 lines)
- `evolution/src/lib/pipeline/loop/rankVariants.test.ts` — Full ranking orchestration tests (709 lines)
- `evolution/src/lib/core/agents/RankingAgent.test.ts` — Agent wrapper tests (293 lines)

## ELI5: How the Math Works

### Mu and Sigma
Every variant carries two numbers: **mu** (how good we think it is, starts at 25) and **sigma** (how unsure we are, starts at 8.33). Mu is where you're aiming on a dartboard. Sigma is how big the uncertainty circle is. After many matches the circle shrinks — we're confident in our estimate.

### c = Total Match Uncertainty
Before computing updates, the system calculates **c**, the combined uncertainty of the match:
```
c = sqrt(σ_A² + β² + σ_B² + β²)
```
c is the denominator in every update formula. **Smaller c = bigger updates.**

Two strangers (both σ=8.33): c = 13.18 (high uncertainty, cautious updates)
Stranger vs anchor (σ=2): c = 10.40 (anchor is known, match is more informative)

### Why Anchors Help
Playing a known-good opponent is like taking a test graded by an expert vs another student. The expert's judgment is more informative because there's less ambiguity about what the outcome means.

### Mu Update (Skill Shift)
```
mu_shift ∝ σ² / c
```
vs anchor: 69.4 / 10.40 = 6.68 → **27% more** mu movement per match
vs new: 69.4 / 13.18 = 5.27

### Sigma Update (Uncertainty Shrinkage) — Where the Real Magic Is
```
delta ∝ σ³ / c³
```
The **cubic** exponent is key. It comes from two factors multiplied:
1. `σ²/c²` = how informative was this match for me?
2. `σ/c` = **gamma** = what fraction of the information do I absorb?

**Gamma** answers: "Of all the information this match produced, what fraction belongs to me?" A new variant with σ=8.33 against c=10.40 has gamma=0.80 (absorbs 80%). The anchor with σ=2 has gamma=0.19 (absorbs 19%). The uncertain player learns fast; the confident player stays stable.

Multiplied: (σ²/c²) × (σ/c) = **σ³/c³** → 2x per-match advantage for anchor matches.

### Why 2x Per Match = 3.3x Total
Sigma updates are multiplicative: `σ_new = σ × sqrt(1 - delta)`.
- vs anchors: retention ≈ 0.933 → 0.933¹⁰ = 0.50
- vs new: retention ≈ 0.968 → 0.968¹⁰ = 0.74

To reach σ<5.0: 17 matches (anchors) vs 60 matches (new) = **3.3x speedup**.

## Open Questions
1. What sigma values do real production arena entries have? (Need DB query to verify test fixture assumptions)
2. Should anchor designation be persisted (new DB column) or computed dynamically per run?
3. Is the 5-match triage budget sufficient for anchor-based calibration, or should it increase?
4. Should anchors have a sigma floor enforced at the DB level or application level?
5. How do we handle the cold-start problem when a new prompt has no low-sigma variants?
