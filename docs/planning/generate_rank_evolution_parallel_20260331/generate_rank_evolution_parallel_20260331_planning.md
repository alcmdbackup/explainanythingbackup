# Generate Rank Evolution Parallel Plan

## Background
The evolution pipeline currently runs generate and rank operations sequentially, which makes some runs very slow. This project replaces the two-phase ranking architecture (triage + Swiss) with an iteration-based pipeline. Each iteration is one of two types: (1) a **generate iteration** running N parallel `generateFromSeedArticle` agents followed by a `MergeRatingsAgent`, or (2) a **swiss iteration** running a single `SwissRankingAgent` (parallel pair comparisons) followed by a `MergeRatingsAgent`. The orchestrator decides what type of iteration to dispatch next based on pipeline state.

## Requirements (from GH Issue #914)
- New `generateFromSeedArticle` agent: generates ONE variant with one strategy, then ranks it via binary search to convergence, elimination, no-more-opponents, or budget-with-discard
- The agent **owns its own discard decision** using its local view of ratings — discarded variants are not surfaced to the orchestrator
- New `SwissRankingAgent`: takes the current eligible (top-15%) variants and runs ONE batch of parallel pair comparisons. Returns raw match outcomes. The orchestrator decides whether to dispatch another swiss iteration.
- New `MergeRatingsAgent`: takes match buffers from any work agent(s) and applies OpenSkill updates to the global ratings in randomized order. Reusable for both iteration types.
- **Iteration model:** every iteration has the same shape: `(work agent[s]) + (merge agent)`. The orchestrator's `nextIteration()` function decides which type of work agent to dispatch next.
- Solves cold-start problem: the first generate iteration has limited opponents, but subsequent swiss iterations refine the survivors with cross-variant comparisons
- Discard logic: lives inside `generateFromSeedArticle` agent. The merge agent only sees variants that the agents chose to surface (non-discarded).
- New `persisted` boolean column on `evolution_variants` (defaults false). Set to true when the variant is surfaced by its owning agent (i.e., NOT discarded). Most metrics filter by `persisted = true`; cost metrics do not.
- Remove "anchor" concept entirely from code and admin UI (the new opponent selection formula handles this naturally)
- All three agent types are fully integrated `Agent` subclasses with metrics, detail view configs, and execution detail schemas
- Track generation vs ranking cost separately within `generateFromSeedArticle` invocation, and aggregate at run level
- Capture pool snapshots at the start and end of each iteration for debugging
- Detailed opponent selection logging for debugging (candidates considered, scores, selection reason)
- Maintain budget tracking, checkpoint behavior, iteration/execution_order DB tracking

## Problem
The current pipeline is sequential at every level: cycles run one at a time, each cycle has generate → rank, ranking has triage → Swiss, and within each phase comparisons run one at a time. The ranking architecture is also unnecessarily complex with two separate algorithms connected by an eligibility filter.

The proposed fix flattens the architecture into a sequence of iterations, where each iteration has the uniform shape `(work agent[s]) + (merge agent)`. The orchestrator picks which type of work agent to dispatch based on pipeline state.

**Generate iteration (always the first):** N agents generate one variant each and rank it via binary search against a local snapshot. Each agent decides locally whether to discard its variant (based on its own view of local ratings). The merge agent applies the surviving agents' matches to global ratings in randomized order.

**Swiss iterations (subsequent):** A single `SwissRankingAgent` takes the current eligible variants, computes Swiss-style pairs, and runs them in parallel. The merge agent applies the round's matches to global ratings in randomized order. The orchestrator checks convergence and decides whether to dispatch another swiss iteration.

This captures the wall-clock benefit of parallelism (each work agent runs in parallel internally) while still producing high-quality rankings (multiple swiss iterations refine the survivors).

## New Architecture

### Iteration model

Every iteration has the same shape: **work agent(s) + merge agent**. There are two iteration types:

| Iteration type | Work agent(s) | Merge | Discard |
|----------------|---------------|-------|---------|
| **Generate** | N parallel `GenerateFromSeedArticleAgent` invocations | 1 `MergeRatingsAgent` | Done internally by each work agent (using local ratings); merge only sees surviving variants |
| **Swiss** | 1 `SwissRankingAgent` invocation (parallel pairs internally) | 1 `MergeRatingsAgent` | None (swiss never discards) |

The orchestrator's `nextIteration()` function decides which type to dispatch next:

```typescript
function nextIteration(state): 'generate' | 'swiss' | 'done' {
  if (state.iterationCount === 0) return 'generate'  // first iteration is always generate
  if (state.budgetExhausted) return 'done'

  const eligibleIds = computeEligible(state.pool, state.ratings)
  if (eligibleIds.length < 2) return 'done'
  if (allConverged(eligibleIds, state.ratings)) return 'done'

  // Are there any new pairs left for swiss?
  const candidatePairs = swissPairing(eligibleIds, state.ratings, state.completedPairs)
  if (candidatePairs.length === 0) return 'done'

  return 'swiss'
}
```

For our typical 9-variant run, this produces a sequence like:
- Iteration 1: generate (9 agents + merge)
- Iteration 2: swiss (1 agent + merge)
- Iteration 3: swiss (1 agent + merge) — if more pairs available
- ... until done

### Generate iteration: `generateFromSeedArticle` (with built-in discard)

```
generateFromSeedArticle.run(input, ctx):
  input: { originalText, strategy, llm, initialPool, initialRatings, initialMatchCounts, cache }

  1. Deep-clone initialPool, initialRatings, initialMatchCounts into local mutable copies
  2. Generate ONE variant using the assigned strategy (add to localPool)
  3. Rank variant via binary search against localPool, mutating localRatings as it goes
  4. At end of binary search, decide locally whether to surface or discard:
     - If status is converged/eliminated/no_more_opponents → surface
     - If status is budget AND local mu >= local top15Cutoff → surface
     - If status is budget AND local mu < local top15Cutoff → DISCARD (do not surface)
  5. Return: { variant, status, surfaced, matches, generationCost, rankingCost, ... }
     - If surfaced: matches array contains the buffered raw outcomes (will be merged globally)
     - If NOT surfaced: matches array is empty (the merge agent never sees them)
```

One agent = one variant = one invocation row. Cost split into generation/ranking sub-totals. Execution detail blob has separate `generation` and `ranking` sections, plus a `surfaced: boolean` flag and the discard decision details if applicable.

**Why discard lives in the agent:** The agent has its own complete local view of ratings (deep-cloned from iteration start, mutated chronologically through the binary search). The local view is sufficient to make the discard decision — no need to wait for the global merge. This makes the agent self-contained: it owns the full lifecycle of its variant.

**Implication:** The merge agent only sees match buffers and variants from agents that chose to surface. Discarded variants' matches are dropped along with the variant. We lose the rating updates that those matches would have caused on the opponents (small loss; opponents are just losing a comparison to a low-mu variant), but in exchange we get a much simpler architecture with clean separation of concerns.

### Parallel agents — frozen snapshot per agent

```
At iteration start:
  initialPool = current pool
  initialRatings = current ratings
  initialMatchCounts = current match counts
  → Snapshot recorded for the iteration

N agents run concurrently. Each agent:
  - Receives initial state (deep-cloned to localPool / localRatings / localMatchCounts)
  - Generates one variant, adds it to its OWN local pool
  - Runs binary search against its local pool only, mutating local ratings chronologically
  - Decides locally whether to surface or discard
  - Variants generated by other agents are NOT visible
```

**Key property: agents have no visibility into each other's work during the iteration.** Each agent operates as a fully independent unit on a frozen snapshot of the iteration-start state. There is no race on pool mutations because there is no shared pool during execution.

**Cold start is very pronounced for the first generate iteration:** with `initialPool = [baseline]`, each variant has only 1 opponent (baseline). Most variants will exit via `no_more_opponents` after 1 comparison. Their ratings are very rough (sigma stays high in the local view, but is still better than the default).

**That's OK** because subsequent swiss iterations refine the surviving variants with cross-variant comparisons. The first generate iteration's job is exploration (generate variants); swiss iterations refine.

### After the work agents settle: merge

The orchestrator collects each agent's surfaced match buffers (and surfaced variants for generate iterations) and dispatches a `MergeRatingsAgent`. The merge agent:

- Adds any new variants to the global pool (generate iterations only)
- Concatenates all match buffers
- Shuffles via Fisher-Yates
- Applies OpenSkill updates to global ratings in randomized order
- Returns metadata about what was merged

**The merge agent never sees discarded variants or their matches** — those are dropped at the work agent boundary.

For more variants, dispatch more agents (N=9 → 9 agents, optionally cycling through strategies).

### Unified binary-search ranking

Each agent runs a single loop on its single variant. The agent **mutates local ratings during the loop** for adaptive selection and stop checks. Raw match outcomes are also **buffered separately**, to be fed to global ratings (in randomized order) by the merge agent at end of iteration.

```
while not stopped:
  opponent = selectOpponent(variant, localPool, localRatings, completedPairs)
  if opponent === null: stop "no_more_opponents"

  match = await compare(variant, opponent)
  matchBuffer.push(match)               // raw outcome → for global merge
  updateRating(localRatings, match)     // mutate local for agent-internal decisions
  completedPairs.add(pair(variant, opponent))

  // Stop checks use LOCAL ratings (which DO change as the loop progresses)
  if local.mu + 2σ < local.top15Cutoff: stop "eliminated"
  if local.sigma < CONVERGENCE_THRESHOLD: stop "converged"
  if budget exhausted: stop "budget"

// After loop exits — the agent's own discard decision
const surfaced = decideSurface(status, localRatings, variant)
return { variant, status, surfaced, matches: surfaced ? matchBuffer : [] }
```

**The agent's `decideSurface` rule:**
- `converged` → surface
- `eliminated` → surface (variant stays in pool but flagged so `selectWinner` skips it)
- `no_more_opponents` → surface
- `budget` AND `local.variant.mu >= local.top15Cutoff` → surface
- `budget` AND `local.variant.mu < local.top15Cutoff` → discard

**Two views, one merge:**
- `matchBuffer` is the raw record of what happened (winner, loser, confidence). This is what gets fed to global ratings by the merge agent.
- `localRatings` is the agent's internal view of "what would my rating be if these matches happened in chronological order?" Used for stop decisions, opponent selection, AND the surface/discard decision. Discarded when the agent returns.
- The discrepancy between local-chronological and global-randomized is bounded and acceptable (~0.1-0.5 mu difference). Since the discard decision is local, that's the relevant view for whether to surface this variant.

**What happens to discarded variants:**
- The variant is NOT added to the global pool
- The variant's match buffer is NOT included in the global merge
- The variant's row in `evolution_variants` has `persisted = false`
- The invocation row records the decision details (status was budget, local mu, local cutoff, decision = discarded)
- Cost is tracked normally on the invocation row
- Opponents in this variant's comparisons do NOT receive any rating updates from those matches (small information loss, acceptable for the architectural simplification)

No triage, no anchor concept, no separate eligibility data structure. One loop, four stop conditions.

**Note on eligibility:** The "top 15%" concept still exists — both the elimination check (`mu + 2σ < top15Cutoff`) inside the binary search and the swiss iteration's eligibility computation use it. But it is **never persisted as a separate DB column or table**. It's always computed on-the-fly from current ratings via `computeTop15Cutoff(ratings)`. There is no `eligible: boolean` field on variants, no `evolution_eligibility` table, nothing.

**Sequential within a variant:** Each variant picks one opponent at a time, awaits the comparison, updates ratings, then picks the next opponent. This guarantees every comparison is maximally informative (closest to current mu) and supports early elimination via the top-15% CI check after each match. Parallelism comes from running multiple agents (each owning one variant) in parallel. Batch-K closest opponents within a single variant is a possible future optimization for additional wall-clock speedup but is not in scope for this project.

**Speed vs cost tradeoff (sequential vs batched within a single variant):**

| Approach | Comparisons to converge | Wall-clock time | Cost (LLM calls) |
|----------|------------------------|-----------------|------------------|
| Sequential (1 opponent at a time, current design) | ~8 comparisons (each maximally informative) | ~24s (8 × 3s sequential) | 1x baseline |
| Batched K=4 / quartile (parallel comparisons per round) | ~13 comparisons (some less informative due to bracketing) | ~9-12s (3-4 parallel rounds × 3s) | ~60% more LLM calls |

The sequential approach minimizes total LLM calls (~8) but takes ~24s wall-clock per variant. A batched approach uses ~13 comparisons (60% more cost) but completes in ~9-12s (~2-3x faster wall-clock). For this project we ship sequential; batched is a future optimization if wall-clock matters more than cost.

### Opponent selection: information-gain scoring

Instead of a hard range cutoff plus sort by sigma, score each opponent by a continuous formula that combines outcome uncertainty and opponent reliability. Pick the highest scorer. One tunable knob (`SIGMA_WEIGHT`) controls the trade-off.

```typescript
const SIGMA_WEIGHT = 1.0  // single tuning knob — controls reliability vs closeness trade-off

function selectOpponent(variant, pool, ratings, completedPairs):
  let bestScore = -Infinity
  let bestId = null

  for opp in pool:
    if opp.id == variant.id: continue
    if completedPairs.has(pair(variant, opp)): continue

    const oppRating = ratings.get(opp.id) ?? createRating()

    // Bradley-Terry win probability (existing OpenSkill math)
    const pWin = 1 / (1 + Math.exp(-(variant.mu - oppRating.mu) / BETA))

    // Outcome entropy: peaks at pWin=0.5, approaches 0 at extremes
    const entropy = -pWin * Math.log(pWin) - (1 - pWin) * Math.log(1 - pWin)

    // Score: high entropy (close match) × high reliability (low opponent sigma)
    // SIGMA_WEIGHT=1 → equal weighting; >1 favors reliability; <1 favors closeness
    const score = entropy / Math.pow(oppRating.sigma, SIGMA_WEIGHT)

    if (score > bestScore) {
      bestScore = score
      bestId = opp.id
    }

  return bestId  // null if no uncompared opponents exist
```

**Two factors, one product:**

| Factor | Behavior | Why |
|--------|----------|-----|
| `entropy(pWin)` | Peaks at pWin=0.5, → 0 at extremes | Close matches give the most information about variant's true rank |
| `1 / opp.sigma` | High when opponent has low sigma | Reliable opponents anchor the comparison; uncertain ones add noise |

The product naturally favors opponents that are simultaneously close in mu AND well-established. Either factor alone is insufficient: a close opponent with high sigma gives a noisy signal, and a precise opponent far away gives a foregone-conclusion result.

**Cold start:** All variants have similar mu (default 25) and similar sigma (default 8.33). All scores are nearly equal. Pick first by iteration order. This is fine — cold start is inherently uninformative.

**Adaptive narrowing:** As the variant's mu shifts and sigma drops through successive comparisons, the entropy term naturally focuses on opponents whose mu is close to the new estimate. There is no explicit range cutoff; the entropy gradient does the narrowing.

**Far opponents:** Low entropy gives them low scores. They lose to closer opponents but remain candidates if no closer opponents are uncompared. This is more graceful than a hard cutoff that would prematurely declare "no more opponents."

**Constants used:** `BETA` (from OpenSkill, = 25 × √2 ≈ 35.4) and `SIGMA_WEIGHT` (single tuning knob, default 1.0). No `MIN_RANGE`, no `RANGE_MULTIPLIER`, no hard cutoff.

### Parameter analysis: one knob is enough

**Why one knob, not two:**

The most general two-knob form is `score = entropy^a / sigma^b`. But ranking is invariant under monotonic transformations — only the ordering of scores matters for `argmax`, not the absolute values. Raising both sides to `1/a`:

```
score^(1/a) = entropy / sigma^(b/a)
```

Since `score^(1/a)` is monotonic in `score` (for `a > 0`), the opponent that maximizes `score` also maximizes `score^(1/a)`. They produce identical rankings.

Let `k = b/a`. The single-knob equivalent is:

```
score = entropy / sigma^k
```

Two knobs collapse to one because `a` and `b` only matter through their ratio.

**What `SIGMA_WEIGHT` (k) means:**

| k | Behavior |
|---|----------|
| **0** | Pure entropy. Closest mu wins, ignore reliability. |
| **0.5** | Mild reliability preference (square root). |
| **1.0** (default) | Equal weighting between entropy and reliability. |
| **2.0** | Strong reliability preference (sigma squared in denominator). |
| **∞** | Pure reliability. Lowest sigma wins, ignore closeness. |

Increasing `SIGMA_WEIGHT` makes the formula more conservative — prefer well-established opponents even at the cost of close matches. Decreasing it makes the formula more exploratory — accept noisier opponents if they're close in mu.

**Why 1.0 is a good default:**

The two factors live on similar dynamic ranges:
- `entropy(pWin)` ranges from 0 (foregone) to ln(2) ≈ 0.693 (pure 50/50). About a ~7x span ignoring the foregone limit.
- `1 / opp.sigma` ranges roughly from 0.12 (sigma=8.33, fresh) to 0.5 (sigma=2, well-established). About a 4x span.

Both factors span similar dynamic ranges. With `k=1`, neither dominates.

**Sensitivity analysis:**

Variant V at mu=25, σ=4. Three candidates:

| Opp | mu | sigma | Description |
|-----|-----|-------|-------------|
| A | 25 | 8 | Close but noisy |
| B | 20 | 2 | Slightly far, precise |
| C | 30 | 3 | Slightly far, moderate |

| k | A score | B score | C score | Winner |
|---|---------|---------|---------|--------|
| **0.5** | 0.693/√8 = 0.245 | 0.687/√2 = 0.486 | 0.687/√3 = 0.397 | B |
| **1.0** (default) | 0.693/8 = 0.087 | 0.687/2 = 0.344 | 0.687/3 = 0.229 | B |
| **2.0** | 0.693/64 = 0.011 | 0.687/4 = 0.172 | 0.687/9 = 0.076 | B |

The ranking (B > C > A) is stable across `k` values from 0.5 to 2.0. The formula is robust because the underlying ordering reflects real properties — B is genuinely the best opponent regardless of how we weight the factors. `SIGMA_WEIGHT` only matters at the margins where two candidates have nearly equal scores.

**A case where k actually matters:**

Variant V at mu=25, σ=4. Two candidates:
- D: mu=25, σ=6 (perfectly close, moderately noisy)
- E: mu=22, σ=2 (slightly far, very reliable)

| k | D score | E score | Winner |
|---|---------|---------|--------|
| **0.5** | 0.693/√6 = 0.283 | 0.690/√2 = 0.488 | E |
| **1.0** | 0.693/6 = 0.116 | 0.690/2 = 0.345 | E |
| **0.0** (pure entropy) | 0.693 | 0.690 | D |

With `k=0`, the perfectly-aligned-but-noisy D wins by entropy alone. With any `k > 0`, the more reliable E wins. This shows the knob does have effect for marginal cases.

**Recommendation:** Ship with `SIGMA_WEIGHT = 1.0`. Track metrics so we can tune empirically. The constant lives in `rankSingleVariant.ts` as a top-level `const` — easy to change in a follow-up PR if metrics suggest it.

**Metrics to track for tuning:**
- Average comparisons per variant to convergence
- Distribution of opponent sigmas selected (histogram)
- Distribution of pWin values seen (are we mostly making 50/50 matches or 70/30?)
- Variance in final ratings across runs (high variance suggests order bias, not parameter issue)

**Constants we genuinely need:**

| Constant | Source | Tunable? |
|----------|--------|----------|
| `BETA` (= 25√2) | OpenSkill standard | No — fixing this would change rating semantics |
| `SIGMA_WEIGHT` (= 1.0) | This project | Yes — single knob for entropy/reliability trade-off |
| `CONVERGENCE_THRESHOLD` (= 3.0) | Existing pipeline | Same as current — could tune |
| `TOP_PERCENTILE` (= 0.15) | Existing pipeline | Same as current — could tune |
| `ELIMINATION_CI` (= 2 sigmas) | Existing pipeline | Same as current — could tune |

### Stop conditions

| Condition | Check | When it fires | Effect |
|-----------|-------|---------------|--------|
| **Eliminated** | `mu + 2σ < top15Cutoff` | Weak variant after 2-5 comparisons | Stop, mark eliminated |
| **Converged** | `sigma < CONVERGENCE_THRESHOLD` (default 3.0) | Strong variant after 5-15 comparisons | Stop, fully ranked |
| **No more opponents** | `selectOpponent()` returns null | All other variants in pool already compared, or pool too small | Stop, fully ranked but with whatever sigma remains |
| **Budget** | `costTracker.reserve()` throws | Any time | Stop. Agent makes its own surface/discard decision using local ratings: surface if `mu >= top15Cutoff`, discard otherwise. |

### State tracking — explicit vs implicit

State for each variant is tracked in a mix of explicit and implicit ways:

| State | Tracking | Where stored |
|-------|----------|--------------|
| Variant exists | Implicit | Row in `evolution_variants` (always written when generated) |
| In active pool | Implicit | Presence in in-memory `pool` array |
| Current rating | Explicit | `ratings: Map<id, {mu, sigma}>` (in-memory) |
| Match count | Explicit | `matchCounts: Map<id, number>` (in-memory) |
| Eliminated | Explicit | `eliminatedIds: Set<id>` (in-memory) — used by `selectWinner` to skip |
| Discarded (post-iter-1) | Implicit | Variant absent from `pool`/`ratings`/`matchCounts` after the discard rule applies |
| Agent stop status | Explicit | `status` field in agent return value, persisted to invocation `execution_detail` JSONB |

**Per-variant state** (rating, match count, eliminated) lives in in-memory maps and is recomputed each run from match data. **Per-invocation status** (how the agent exited) is persisted in the invocation row's `execution_detail` JSONB. **Discarded** has an explicit marker at the DB level via `persisted: false`, and at the in-memory level the variant is simply absent from the pool.

The pool snapshot tab (Phase 9c) makes the discard decisions inspectable: each iteration's end snapshot lists which variants survived and which were discarded (with per-agent reason).

### Persistence by stop condition

| Stop condition | `evolution_variants` row | `persisted` flag | In-memory pool | `selectWinner` candidate |
|----------------|--------------------------|------------------|----------------|--------------------------|
| `converged` | ✅ | true | ✅ | ✅ |
| `eliminated` | ✅ | true | ✅ | ❌ (in `eliminatedIds`) |
| `no_more_opponents` | ✅ | true | ✅ | ✅ |
| `budget` (mu ≥ top15Cutoff) | ✅ | true | ✅ | ✅ |
| `budget` (mu < top15Cutoff) | ✅ | **false** | ❌ removed | ❌ |

Variants are always saved to `evolution_variants` when generated. The `persisted` boolean flag distinguishes "survived to final pool" (true) from "generated but discarded" (false). Discarded variants stay in the DB row with `persisted: false` so their generation cost is still queryable. Cost is also tracked at the invocation level (in `evolution_agent_invocations`), not lost.

**Metrics rule:** Filter by `persisted = true` for most metrics (variant counts, rating stats, comparison counts). Do NOT filter for cost metrics — discarded variants cost real money.

### Deferred rating updates (bias prevention)

**The problem:** When matches happen in parallel and rating updates are applied in completion order, the order is non-deterministic and could introduce systematic bias. Variants whose comparisons happen to return first might consistently benefit from being applied to less-updated priors.

**The fix:** Match results are collected in a buffer during parallel execution. At a defined sync point, the buffer is shuffled and updates applied sequentially in random order. Different runs still produce slightly different ratings (randomness is preserved), but no variant is systematically favored by ordering.

**Where this applies:**

| Phase | Sync point | What gets buffered |
|-------|------------|--------------------|
| **Generate iteration** (N parallel agents, each running binary search) | End of iteration (by MergeRatingsAgent) | Match buffers from surfaced agents only |
| **Iteration 2** (Swiss agent, parallel pairs within rounds) | End of each Swiss round | Match results from that round's parallel pairs |

**Iteration 1 details (local mutation + randomized global merge):**
- Each `generateFromSeedArticle` agent operates on a LOCAL deep-clone of BOTH `pool` and `ratings`, captured at iteration start
- The agent generates one variant and adds it to its OWN local pool
- Within the agent's binary search loop:
  - Opponent selection uses local ratings (which mutate as the loop progresses)
  - Each comparison produces a match outcome
  - The raw match outcome is **appended to a `matchBuffer`** (for the global merge later)
  - The match is **also applied to local ratings** via `updateRating()` for agent-internal adaptation
- Stop condition checks (`elimination`, `convergence`) read the local ratings, which DO change as the loop progresses. This means generate iteration variants CAN exit via `converged` or `eliminated` (not just `no_more_opponents` or `budget`). Early termination saves budget when the variant clearly doesn't need more comparisons.
- Variants generated by other parallel agents are NOT visible — each agent sees only `[baseline + arena entries + its own variant]`
- After all agents settle: combine all generated variants into the global `pool`; collect ALL `matchBuffer`s (including from budget-status agents); concatenate, shuffle, **apply OpenSkill updates to the GLOBAL `ratings` map in randomized order**. The agent's local ratings are discarded — global ratings are the source of truth.
- Iteration 2 uses the merged global pool and ratings

**Two views of ratings — explicit separation:**

| | Local ratings (per-agent) | Global ratings (single source of truth) |
|---|---|---|
| Where | Inside `rankSingleVariant` for one agent | `ratings` Map in the iteration loop |
| Mutation | Updates after every comparison in the agent's loop | Updated by the MergeRatingsAgent in randomized order, once per iteration |
| Order | Chronological (the order LLM returned results) | Random (Fisher-Yates shuffle of all matches) |
| Used for | Agent-internal decisions: opponent selection, stop condition checks (eliminated/converged), surface/discard decision | Final pool state, next iteration's eligibility computation, run output |
| Lifetime | Discarded when agent's `execute()` returns | Persists throughout the run |

**Bounded divergence:** Local and global ratings will end up slightly different because they apply the same matches in different orders. The differences are small (~0.1-0.5 mu, ~0.05-0.2 sigma) and only affect agent-internal stop decisions, not the final output. The randomized global merge prevents systematic ordering bias across the run.

**Swiss iteration details:**
- A swiss iteration dispatches 1 `SwissRankingAgent` invocation followed by 1 `MergeRatingsAgent` invocation
- Inside the SwissRankingAgent: takes the eligible set from current global ratings, computes Swiss-style pairs, runs them in parallel via `Promise.allSettled`, collects raw match outcomes into a buffer
- The SwissRankingAgent does NOT apply rating updates to global state. It returns the raw match buffer.
- The merge agent then shuffles the buffer and applies updates to global ratings in randomized order
- The orchestrator updates `completedPairs` and checks convergence after the merge completes
- If convergence not reached and pairs still available, orchestrator dispatches another swiss iteration

**Always apply paid-for matches (budget exhaustion safety):**

A successful comparison (LLM returned a judgment) is information we already paid for. The OpenSkill update from that match must always be applied to global ratings, even if the wider operation fails afterwards due to budget exhaustion.

| Failure scenario | What we preserve |
|------------------|------------------|
| Generate iteration: agent hits budget after N successful comparisons. Agent's surface decision: discard. | The agent does NOT include matches in the merge (discard means everything goes). Cost is still tracked. The matches are lost. **This is the explicit tradeoff for moving discard inside the agent.** |
| Generate iteration: agent hits budget but locally surfaces (mu ≥ cutoff) | All N matches go to merge agent. Opponents in those matches get rating updates. |
| Swiss iteration: SwissRankingAgent has 5 pairs, 2 fail with budget, 3 succeed | The 3 successful matches go to the merge agent and are applied. The agent records the budget failure in its execution detail. |

**Note on the lost matches when an agent discards:** When `generateFromSeedArticle` decides to discard its variant (budget + low mu), the matches it ran against opponents are dropped. Those opponents don't receive the rating updates from those comparisons. This is a small information loss but it keeps the architecture simple — the agent is the sole owner of its variant's lifecycle, including which matches make it to the global state. The lost information is minor because:
1. Comparisons against a discarded variant only tell us "the opponent beat this loser" — weak information
2. The opponent's rating barely changes from beating a low-mu variant
3. Iterating swiss rounds will refine the survivors anyway

**Implementation:**
- [x] Add `matchBuffer: V2Match[]` to `generateFromSeedArticle` agent state (mutated during binary search)
- [x] Each agent gets `localRatings = new Map(input.initialRatings)` at start
- [x] Inside the binary-search loop, mutate `localRatings` after each comparison
- [x] After loop exits, run `decideSurface()` using local ratings: returns true if we should surface, false if discard
- [x] Agent returns `{ variant, status, surfaced, matches }` — matches array is empty if surfaced is false
- [x] Orchestrator collects only `surfaced` agents' results for the merge
- [x] MergeRatingsAgent receives only the surfaced agents' variants and matches
- [x] Inside SwissRankingAgent: extract successful matches from `Promise.allSettled`, return raw buffer, do NOT apply updates
- [x] MergeRatingsAgent: `mergeMatchesRandomly(allBuffers, globalRatings)` — Fisher-Yates shuffle, sequential apply
- [x] Add metric: `surfacedCount` and `discardedCount` per generate iteration

**Note on opponent selection accuracy:** Because each agent uses local ratings, two agents may make slightly different opponent selection decisions. This is acceptable — the binary search is still mathematically valid for each agent, and the merge agent produces consistent global ratings via the randomized shuffle.

### Swiss iterations: `SwissRankingAgent`

After the first generate iteration, the pool contains ~9 variants with rough ratings. The orchestrator dispatches swiss iterations until convergence, exhaustion, or budget.

Each swiss iteration is one work agent + merge agent invocation pair. The work agent (`SwissRankingAgent`) does ONE batch of parallel Swiss-style pair comparisons; the merge agent applies the results.

```
SwissRankingAgent.run(input, ctx):
  input: { eligibleIds, completedPairs, pool, ratings, cache, llm }

  1. Compute pairing: top-K candidate pairs by score (overlapping variants ALLOWED, respect completedPairs)
  2. If no candidate pairs: return { pairs: [], matches: [] } — orchestrator will exit
  3. Run all pairs in parallel via Promise.allSettled
  4. Collect successful match outcomes into a buffer
  5. Return { pairs, matches: buffer, budgetExceeded: bool }
     — does NOT apply rating updates
     — does NOT recompute eligibility
     — does NOT check convergence
```

The orchestrator handles pair tracking, convergence checks, and the decision to dispatch another swiss iteration.

**Why a single agent per swiss iteration (not multiple parallel agents):**
- Swiss pairing requires global state (pair selection considers all currently eligible variants and which pairs have been compared before)
- Splitting Swiss into multiple parallel agents would mean two agents could pick overlapping pairs, defeating the pair-tracking purpose
- One agent owns one batch of pair comparisons; the orchestrator owns sequencing across batches

**Pairs WITHIN a swiss iteration run in parallel (overlapping variants allowed):**
- Pairing returns top-K candidate pairs by score, with NO non-overlapping constraint. A variant can appear in multiple pairs in the same iteration.
- Default `MAX_PAIRS_PER_ROUND = 20` (matches LLM semaphore limit). For typical eligible sets (3-5 variants), this means all `N*(N-1)/2` candidate pairs run in one swiss iteration.
- Run via `Promise.allSettled(pairs.map(comparePair))` so one budget error doesn't cancel others
- Match results buffered until all pairs settle — the agent does NOT apply rating updates
- The merge agent (separate invocation) shuffles the buffer (Fisher-Yates) and applies rating updates sequentially
- Safety: because updates are deferred to the merge agent and applied serially in randomized order, there is no race on shared rating state. Two pairs both involving variant X just produce two sequential updates to X's rating in random order — both are valid Bayesian operations.

**Eligibility:**
- Computed by the orchestrator BEFORE dispatching the swiss iteration
- Top-15% by mu using current global ratings (with `MIN_SWISS_POOL = 3` floor)
- Excludes eliminated variants
- The orchestrator passes the computed `eligibleIds` to the agent as input
- After the merge agent completes, the orchestrator recomputes eligibility for the NEXT swiss iteration

**Stop conditions for `SwissRankingAgent`:**

| Condition | Trigger | What it means |
|-----------|---------|---------------|
| `converged` | All eligible variants have `sigma < CONVERGENCE_THRESHOLD` | Top variants are confidently ranked |
| `no_pairs` | `swissPairing()` returns empty array | Every unique pair from the eligible set has already been compared (across all rounds, tracked via `completedPairs`) |
| `max_rounds` | Hit `MAX_SWISS_ROUNDS` (default 20) | Safety cap, should be rare |
| `budget` | `BudgetExceededError` mid-round | Out of budget. Successful matches in the failing round are still applied. |

**Why we don't re-compare the same pair:** The `compareWithBiasMitigation` LRU cache uses an order-invariant key (sorted SHA-256 of the two texts), so re-comparing returns the cached result without an LLM call. But applying the same match result twice tells OpenSkill the comparison happened twice — that's mathematically wrong, double-counting the same evidence. So `completedPairs` strictly excludes already-compared pairs across all rounds.

**Implication for small pools:** With 3 eligible variants there are only 3 unique pairs (`AB, AC, BC`). After one full round, all 3 are in `completedPairs` and the next round returns `no_pairs`. The agent exits without reaching `sigma < 3.0` because all available information has been extracted. This is the correct behavior — re-comparing wouldn't add information, just create math errors.

**Cost:** Iteration 2 adds another ranking pass on the top variants. Budget impact is moderate — the eligible set is small (top 15% of 10 = top 1-2 variants, fallback to top-3 minimum). For small eligible sets, the agent typically exits via `no_pairs` after compactly burning through all unique pairs.

### Discard Rule

The discard rule lives **inside `generateFromSeedArticle`**. Each agent makes its own surface/discard decision using its local view of ratings before returning. Swiss iterations never discard.

#### `generateFromSeedArticle`: agent-local discard decision

After the binary search loop exits, the agent inspects its local state:

```
if (status === 'budget' AND local.variant.mu < local.top15Cutoff):
  surfaced = false   // discard
else:
  surfaced = true
```

**Why local ratings are sufficient:** The agent's local ratings have been mutated chronologically through the binary search loop. They represent the agent's complete view of "where does my variant sit?" given the matches it ran. The local view differs slightly from what the global view would be after randomized merge, but it's the most accurate view the AGENT has at the moment of decision — and the discard decision is appropriately a per-agent concern.

The other status outcomes never trigger discard:
- `converged`: variant has a confident local rating → surface
- `eliminated`: variant failed the local elimination check during the loop → surface (kept in pool but flagged so `selectWinner` skips it)
- `no_more_opponents`: ran out of opponents to compare against → surface

#### `SwissRankingAgent` never discards

Variants in swiss iterations already have global ratings from earlier iterations. They're "real" articles. Budget interruption during a swiss iteration just means the ratings are less refined — but the variants themselves remain valid pool members.

No discard. Ever. Swiss iterations only add information (more comparisons, refined ratings); they never remove variants.

#### What surfacing means

When `generateFromSeedArticle` surfaces a variant:
- The variant is included in the agent's return value
- The agent's match buffer is included in the return value
- The orchestrator passes them to the merge agent
- The merge agent adds the variant to the global pool and applies the matches

When `generateFromSeedArticle` discards a variant:
- The variant is NOT in the agent's return value (or surfaced=false)
- The agent's match buffer is NOT included
- The orchestrator does NOT pass anything to the merge agent for this agent
- The variant is NOT in the global pool, NOT in global ratings
- The DB row in `evolution_variants` has `persisted = false` (it was generated, just not surfaced)
- The invocation row records the discard decision details (status, local mu, local cutoff)
- Cost is tracked normally on the invocation row
- The matches the agent ran are LOST — opponents do NOT receive rating updates from those comparisons

The lost matches are an explicit tradeoff for keeping the discard decision local and the architecture clean. Without this, the agent would need to surface ALL matches even when discarding the variant, complicating the surface boundary. Swiss iterations refine the surviving variants regardless, so the lost information has minimal impact on final rankings.

#### Implementation

- [x] Inside `generateFromSeedArticle.execute()`, after the binary-search loop exits:
  - Read the agent's local `top15Cutoff` from the final state of `localRatings`
  - Check: if `status === 'budget'` AND `localRatings.get(variant.id).mu < localTop15Cutoff` → set `surfaced = false`
  - Otherwise → set `surfaced = true`
- [x] Agent return value: `{ variant, status, surfaced, matches: surfaced ? matchBuffer : [] }`
- [x] Orchestrator's generate iteration loop: partition agent results by `surfaced` field
  - Surfaced: pass variants and match buffers to the merge agent
  - Discarded: track separately for run finalization (`discardedVariants: Variant[]`)
- [x] In `MergeRatingsAgent`: NO discard logic. The agent only receives surfaced work.
- [x] In `SwissRankingAgent`: NO discard logic. Swiss never makes surface/discard decisions.
- [x] Log discarded variant count at warn level (generate iterations only — swiss iterations never discard)
- [x] Record the discard decision in the agent's execution detail: `surfaced: boolean`, `discardReason?: { localMu, localTop15Cutoff }` if applicable

## Options Considered
- [x] **Option A: Sequential (status quo)** — No parallelism. Simple but slow.
- [x] **Option B: Parallel Swiss only** — Lowest risk, ~20-30% ranking speedup.
- [x] **Option C: Parallel triage + Swiss within current architecture** — Moderate refactor, preserves two-phase model.
- [x] **Option D: New architecture (combined agent + binary-search ranking + parallel agents)** — Maximum simplicity AND throughput. Eliminates two-phase complexity. Single iteration for now.

## Phased Execution Plan

### Phase 1: New `generateFromSeedArticle` Agent

**Target file:** `evolution/src/lib/core/agents/generateFromSeedArticle.ts` (new)

**What it does:** One invocation = generate ONE variant with one strategy + rank it via binary search. Each agent owns the full lifecycle of a single variant.

**Modular structure:**
```typescript
class GenerateFromSeedArticleAgent extends Agent<GenerateFromSeedInput, GenerateFromSeedOutput, GenerateFromSeedDetail> {
  async execute(input, ctx) {
    // Step 0: Deep-clone the iteration-start snapshot into local mutable state.
    // The agent will mutate localRatings during binary search (for adaptive
    // selection and stop checks). Global ratings are NOT touched by the agent.
    const localPool: Variant[] = [...input.initialPool];
    const localRatings = new Map(input.initialRatings);
    const localMatchCounts = new Map(input.initialMatchCounts);

    // Phase 1: Generate one variant using the assigned strategy
    const { variant, generationCost, generationDetail } = await runSingleGeneration(input, ctx);

    // Phase 2: Add variant to localPool. Rank via binary search using local
    // ratings for selection and stop checks. The function:
    //  - Mutates localRatings as it goes (chronological order)
    //  - Returns the raw match outcomes in matchBuffer
    // The matchBuffer is what gets fed to global ratings via the randomized
    // merge at end of iteration. The local ratings are discarded.
    localPool.push(variant);
    const { status, matches, rankingCost, rankingDetail } = await rankSingleVariant(
      variant, localPool, localRatings, localMatchCounts, input.cache, ctx,
    );

    return {
      result: { variant, status, matches },  // matches = raw match outcomes for global merge
      detail: {
        generation: { cost: generationCost, ...generationDetail },
        ranking: { cost: rankingCost, ...rankingDetail },
      },
    };
  }
}

interface GenerateFromSeedInput {
  originalText: string;
  strategy: string;                       // single strategy name (e.g., 'structural_transform')
  llm: EvolutionLLMClient;
  initialPool: Variant[];                 // iteration-start snapshot, will be deep-cloned
  initialRatings: Map<string, Rating>;    // iteration-start snapshot, will be deep-cloned
  initialMatchCounts: Map<string, number>; // iteration-start snapshot, will be deep-cloned
  cache: Map<string, ComparisonResult>;   // shared cache OK — order-invariant keys
}

interface GenerateFromSeedOutput {
  variant: Variant;
  status: 'converged' | 'eliminated' | 'no_more_opponents' | 'budget';
  matches: V2Match[];  // ALWAYS populated, even when status === 'budget'
                       // (paid-for matches must always reach the global merge)
}
```

- [x] Create `generateFromSeedArticle.ts` with the agent class
- [x] Implement `runSingleGeneration(input, ctx)` — builds prompt for one strategy, calls LLM once, validates format, creates variant. Refactor existing `generateVariants()` strategy logic into a single-strategy helper
- [x] Implement `rankSingleVariant(variant, pool, ratings, ...)` — see Phase 2
- [x] Define `GenerateFromSeedInput`, `GenerateFromSeedOutput`, `GenerateFromSeedDetail` types
- [x] Define Zod schema `generateFromSeedExecutionDetailSchema` with separate `generation` and `ranking` sections
- [x] Cost tracking: read `costTracker.getTotalSpent()` before/after each phase to compute per-phase cost
- [x] Execution detail: top-level cost is sum, sub-fields show generation/ranking breakdown
- [x] Handle generation failure: if format validation fails or LLM errors, return `status: 'generation_failed'` and skip ranking

### Phase 2: Binary-Search Ranking Algorithm (single variant)

**Target file:** `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` (new)

**What it does:** Rank a single variant against a (local) pool using the binary-search loop. Called by the agent with the agent's local pool/ratings (which are deep-cloned from the iteration-start snapshot). Replaces `rankPool()` from `rankVariants.ts`.

```typescript
async function rankSingleVariant(
  variant: Variant,
  pool: Variant[],
  ratings: Map<string, Rating>,
  matchCounts: Map<string, number>,
  cache: Map<string, ComparisonResult>,
  callLLM: (prompt: string) => Promise<string>,
  config: EvolutionConfig,
  logger: EntityLogger,
): Promise<{
  status: 'converged' | 'eliminated' | 'no_more_opponents' | 'budget';
  matches: V2Match[];
  comparisonsRun: number;
}>
```

The function runs the binary-search loop sequentially: pick opponent → compare → buffer raw match → mutate local ratings via OpenSkill update → check stop conditions → repeat. The local ratings passed in are mutated during the loop (for agent-internal decisions). The function buffers raw match outcomes separately and returns them for the global merge. Multiple variants are ranked concurrently because multiple agents run in parallel, NOT because this function does any internal parallelism.

- [x] Create `rankSingleVariant.ts`
- [x] Implement `selectOpponent()` using `score = entropy(pWin) / sigma^SIGMA_WEIGHT` (see "Opponent selection: information-gain scoring" above)
- [x] Implement the main ranking loop with all 4 stop conditions
- [x] Compute `top15Cutoff` from local ratings, recomputed after each rating update inside the loop
- [x] Reuse existing `BETA` constant (= 25 × √2) from computeRatings.ts for the Bradley-Terry formula
- [x] Add new constants: `SIGMA_WEIGHT` (default 1.0), `TOP_PERCENTILE` (default 0.15), `ELIMINATION_CI` (default 2), `CONVERGENCE_THRESHOLD` (default 3.0). No `MIN_RANGE` or `RANGE_MULTIPLIER` — the scoring formula handles selection without a hard cutoff.
- [x] Use existing `compareWithBiasMitigation()` for individual comparisons (2-pass A/B reversal already in place)
- [x] **Two parallel paths after each comparison:**
  - Append the raw match outcome to `matchBuffer` (for the global merge later)
  - Call `updateRating()` / `updateDraw()` on the LOCAL ratings (for agent-internal decisions: opponent selection, stop checks)
- [x] Return the `matchBuffer` in the `matches` field of the result. The local ratings are NOT returned — they're discarded.
- [x] Return `status: 'budget'` if BudgetExceededError is caught — the agent will report this and the discard rule will remove the variant
- [x] Track and return `comparisonsRun` count

**Top 15% cutoff:** Computed from local ratings, recomputed after each rating update inside the loop. The cutoff drives the elimination check; using stale values could keep weak variants alive longer than needed. Compute cost is negligible.

**Concurrency safety:** Multiple `rankSingleVariant()` calls run concurrently from different agents in the same generate iteration. Each call operates on its agent's LOCAL `pool`, `ratings`, and `matchCounts` (deep-cloned at iteration start). The local mutations are private to each agent — no shared mutable state across agents within an iteration, no race conditions. The `cache` is shared (order-invariant keys make this safe), but all other state is local per agent.

**Why local mutation is safe under randomized global merge:** The bias prevention principle says global ratings must be updated in randomized order to avoid systematic ordering bias from parallel completion timing. Local mutations don't violate this because:
1. Each agent's local state is private — no other agent reads or writes it
2. Local state is discarded at agent exit, never persisted
3. Global ratings are updated EXCLUSIVELY by the randomized merge step
4. Local mutation timing affects only the agent's internal decisions (early termination), not the final output

### Phase 3: New `SwissRankingAgent` (one swiss iteration's worth of work)

**Target file:** `evolution/src/lib/core/agents/SwissRankingAgent.ts` (new)

**What it does:** A single invocation of `SwissRankingAgent` does ONE swiss iteration's worth of work — takes the eligible variants computed by the orchestrator, computes Swiss-style pairs, runs them in parallel, returns the raw match buffer. The agent does NOT loop, does NOT apply rating updates, does NOT check convergence. The orchestrator handles all that.

```typescript
class SwissRankingAgent extends Agent<SwissRankingInput, SwissRankingOutput, SwissRankingDetail> {
  async execute(input, ctx) {
    // Input: eligibleIds, completedPairs, pool, ratings, cache, llm
    // (eligibleIds and completedPairs are computed by the orchestrator)

    // Step 1: compute candidate pairs (overlapping allowed, capped at MAX_PAIRS_PER_ROUND)
    const pairs = swissPairing(input.eligibleIds, input.ratings, input.completedPairs)
    if (pairs.length === 0) {
      return {
        result: { pairs: [], matches: [], status: 'no_pairs' },
        detail: { eligibleCount: input.eligibleIds.length, pairsConsidered: 0, status: 'no_pairs' },
      }
    }

    // Step 2: Promise.allSettled — run all pairs in parallel
    const pairResults = await Promise.allSettled(
      pairs.map(([a, b]) => compareAndBuildMatch(a, b, input))
    )

    // Step 3: Collect successful matches into a buffer
    // (no rating updates here — that's the merge agent's job)
    const matchBuffer: Array<{ match: V2Match; idA: string; idB: string }> = []
    for (const result of pairResults) {
      if (result.status === 'fulfilled') matchBuffer.push(result.value)
    }

    // Step 4: Detect budget rejection
    const budgetReject = pairResults.find(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' && r.reason instanceof BudgetExceededError
    )
    const otherFailures = pairResults.filter(
      (r): r is PromiseRejectedResult =>
        r.status === 'rejected' && !(r.reason instanceof BudgetExceededError)
    ).length
    const status: 'success' | 'budget' = budgetReject ? 'budget' : 'success'

    return {
      result: { pairs, matches: matchBuffer, status },
      detail: {
        eligibleIds: input.eligibleIds,
        eligibleCount: input.eligibleIds.length,
        pairsConsidered: pairs.length,
        pairsDispatched: pairs.length,
        pairsSucceeded: matchBuffer.length,
        pairsFailedBudget: budgetReject ? (pairResults.length - matchBuffer.length - otherFailures) : 0,
        pairsFailedOther: otherFailures,
        // Capped sample of matches (up to 50)
        matchesProduced: matchBuffer.slice(0, 50).map(m => ({ ... })),
        matchesProducedTotal: matchBuffer.length,
        matchesTruncated: matchBuffer.length > 50,
        status,
      },
    }
  }
}

interface SwissRankingInput {
  eligibleIds: string[]               // computed by orchestrator
  completedPairs: Set<string>         // shared across iterations, owned by orchestrator
  pool: Variant[]
  ratings: Map<string, Rating>
  cache: Map<string, ComparisonResult>
  llm: EvolutionLLMClient
}

interface SwissRankingOutput {
  pairs: Array<[string, string]>
  matches: Array<{ match: V2Match; idA: string; idB: string }>
  status: 'success' | 'budget' | 'no_pairs'
}
```

**Why no internal loop:** The convergence check, eligibility recomputation, and "should we do another swiss iteration?" decision all live in the orchestrator. The agent's job is just "do this batch of pair comparisons." Each invocation is self-contained.

**Reuse from existing code:**
- Swiss pair scoring (`outcomeUncertainty * sigmaWeight`): extract from existing `rankVariants.ts:234-276`. **Modify** to drop the non-overlapping `used` set — return top-K candidates by score with overlap allowed.
- `pairKey()` for completed-pair tracking
- `compareWithBiasMitigation()` for individual comparisons (existing, untouched)
- The agent does NOT call `updateRating()` — that's the merge agent's job

**New constant:** `MAX_PAIRS_PER_ROUND = 20` (default, matches LLM semaphore limit)

**Budget exhaustion behavior:** The agent always collects successful matches into the buffer before returning. Even when budget hits, the matches that completed successfully are returned to the orchestrator, which dispatches the merge agent unconditionally. This guarantees paid-for matches always reach global ratings. The agent's status flag (`'budget'`) tells the orchestrator to exit the loop AFTER the merge completes.

**Implementation:**
- [x] Create `SwissRankingAgent.ts` with the agent class
- [x] Copy `swissPairing()` function from old `rankVariants.ts` (don't reference, copy). Modify to drop the non-overlapping constraint.
- [x] Define `SwissRankingInput`, `SwissRankingOutput`, `SwissRankingDetail` types
- [x] Define Zod schema `swissRankingExecutionDetailSchema`
- [x] Status values: `'success'`, `'budget'`, `'no_pairs'`
- [x] Capture `matchesProduced` in execution detail (cap at 50, set `matchesTruncated` flag if more)
- [x] Capture `pairsFailedBudget` and `pairsFailedOther` separately for visibility

### Phase 4: New `MergeRatingsAgent`

**Target file:** `evolution/src/lib/core/agents/MergeRatingsAgent.ts` (new)

**What it does:** Takes match buffers from work agent(s) and applies OpenSkill updates to the global ratings in randomized order. Reusable for both generate iterations and swiss iterations. Captures before/after pipeline state for the invocation detail.

```typescript
class MergeRatingsAgent extends Agent<MergeRatingsInput, MergeRatingsOutput, MergeRatingsDetail> {
  async execute(input, ctx) {
    // (A) Snapshot the BEFORE state
    const beforeVariants = capturePoolState(input.pool, input.ratings, input.matchCounts)
    const beforeTop15Cutoff = computeTop15Cutoff(input.ratings)

    // Add new variants from generate iterations (none for swiss iterations)
    for (const v of input.newVariants) {
      input.pool.push(v)
      // No initial rating added — the variant gets its rating purely from its own matches
    }

    // (B) Concatenate all match buffers
    const allMatches = input.matchBuffers.flat()
    const matchesAppliedSnapshot: MergeMatchEntry[] = []

    // Shuffle (Fisher-Yates) — bias prevention
    shuffleInPlace(allMatches)

    // Apply OpenSkill updates sequentially in randomized order
    for (let i = 0; i < allMatches.length; i++) {
      const { match, idA, idB } = allMatches[i]
      input.matchHistory.push(match)
      applyRatingUpdate(match, input.ratings, input.matchCounts)

      if (matchesAppliedSnapshot.length < 50) {
        matchesAppliedSnapshot.push({
          indexInShuffledOrder: i,
          winnerId: match.winnerId,
          loserId: match.loserId,
          result: match.result,
          confidence: match.confidence,
        })
      }
    }

    // (C) Snapshot the AFTER state
    const afterVariants = capturePoolState(input.pool, input.ratings, input.matchCounts)
    const afterTop15Cutoff = computeTop15Cutoff(input.ratings)

    return {
      result: { matchesApplied: allMatches.length },
      detail: {
        iterationType: input.iterationType,  // 'generate' | 'swiss'
        before: {
          poolSize: beforeVariants.length,
          variants: beforeVariants,
          top15Cutoff: beforeTop15Cutoff,
        },
        input: {
          matchBufferCount: input.matchBuffers.length,
          totalMatchesIn: allMatches.length,
          matchesPerBuffer: input.matchBuffers.map(b => b.length),
          newVariantsAdded: input.newVariants.length,
        },
        matchesApplied: matchesAppliedSnapshot,
        matchesAppliedTotal: allMatches.length,
        matchesAppliedTruncated: allMatches.length > 50,
        after: {
          poolSize: afterVariants.length,
          variants: diffVariants(beforeVariants, afterVariants),  // includes muDelta, sigmaDelta
          top15Cutoff: afterTop15Cutoff,
          top15CutoffDelta: afterTop15Cutoff - beforeTop15Cutoff,
        },
        variantsAddedToPool: input.newVariants.map(v => v.id),
        durationMs: Date.now() - startMs,
      },
    }
  }
}

interface MergeRatingsInput {
  iterationType: 'generate' | 'swiss'
  matchBuffers: Array<Array<{ match: V2Match; idA: string; idB: string }>>
  newVariants: Variant[]   // generate iterations only — empty for swiss
  pool: Variant[]
  ratings: Map<string, Rating>
  matchCounts: Map<string, number>
  matchHistory: V2Match[]
}

interface MergeRatingsExecutionDetail {
  iterationType: 'generate' | 'swiss'

  // (A) Pool BEFORE merge
  before: {
    poolSize: number
    variants: Array<{ id: string; mu: number; sigma: number; matchCount: number }>
    top15Cutoff: number
  }

  // (B) Input description
  input: {
    matchBufferCount: number       // number of source buffers (1 for swiss, N for generate)
    totalMatchesIn: number
    matchesPerBuffer: number[]
    newVariantsAdded: number
  }

  // The matches being applied (capped at 50)
  matchesApplied: Array<{
    indexInShuffledOrder: number
    winnerId: string
    loserId: string
    result: 'win' | 'draw'
    confidence: number
  }>
  matchesAppliedTotal: number
  matchesAppliedTruncated: boolean

  // (C) Pool AFTER merge
  after: {
    poolSize: number
    variants: Array<{
      id: string
      mu: number
      sigma: number
      matchCount: number
      muDelta: number    // 0 for new variants (no "before")
      sigmaDelta: number
    }>
    top15Cutoff: number
    top15CutoffDelta: number
  }

  variantsAddedToPool: string[]
  durationMs: number
}
```

**Reusable for both iteration types:**
- Generate iteration: orchestrator passes `newVariants` (the surfaced variants from each agent), `matchBuffers` (one per surfaced agent), `iterationType: 'generate'`
- Swiss iteration: orchestrator passes empty `newVariants`, single `matchBuffers` array (from the swiss agent), `iterationType: 'swiss'`

**Implementation:**
- [x] Create `MergeRatingsAgent.ts` with the agent class
- [x] Implement `capturePoolState()` helper that snapshots variants + ratings into the detail format
- [x] Implement `diffVariants()` helper that computes muDelta/sigmaDelta between before/after
- [x] Use Fisher-Yates shuffle on the concatenated buffer
- [x] Apply OpenSkill updates sequentially in shuffled order
- [x] Cap `matchesApplied` array at 50 entries; track truncation
- [x] Define Zod schema `mergeRatingsExecutionDetailSchema`
- [x] Define `detailViewConfig` for admin UI rendering of before/matches/after sections
- [x] No discard logic — discard happens inside `generateFromSeedArticle` agent before the merge

**Admin UI: invocation detail page for `MergeRatingsAgent`**

```
┌─ MergeRatingsAgent invocation #10 (iteration=1, type=generate) ──────┐
│                                                                        │
│ Iteration type: generate    Duration: 12ms    Cost: $0                 │
│ Match buffers: 7    Total matches in: 18    Variants added: 7          │
│                                                                        │
│ ─── A) Pool BEFORE merge ──────────────────────────────────────────── │
│ Top 15% cutoff: 25.00 (just baseline)                                  │
│ ┌────────────┬───────┬───────┬──────────┐                              │
│ │ Variant ID │ mu    │ sigma │ matches  │                              │
│ │ baseline   │ 25.00 │ 8.33  │ 0        │                              │
│ └────────────┴───────┴───────┴──────────┘                              │
│                                                                        │
│ ─── B) Matches applied (in randomized order) ───────────────────────  │
│ ┌────┬───────────┬───────────┬────────┬────────────┐                  │
│ │ #  │ Winner    │ Loser     │ Result │ Confidence │                  │
│ │ 1  │ v3 (link) │ baseline  │ win    │ 0.85       │                  │
│ │ 2  │ v1 (link) │ baseline  │ win    │ 0.90       │                  │
│ │ 3  │ baseline  │ v5 (link) │ win    │ 0.75       │                  │
│ │ ...                                              │                  │
│ │ 18 │ v6 (link) │ baseline  │ win    │ 0.80       │                  │
│ └────┴───────────┴───────────┴────────┴────────────┘                  │
│                                                                        │
│ ─── C) Pool AFTER merge ──────────────────────────────────────────── │
│ Top 15% cutoff: 28.50  (+3.50)                                         │
│ ┌────────────┬───────┬─────────┬───────┬─────────┬──────────┐         │
│ │ Variant ID │ mu    │ Δmu     │ sigma │ Δsigma  │ matches  │         │
│ │ v1 (link)  │ 31.20 │ +6.20   │ 5.10  │ -3.23   │ 5        │ NEW     │
│ │ v6 (link)  │ 30.50 │ +5.50   │ 5.45  │ -2.88   │ 4        │ NEW     │
│ │ v3 (link)  │ 28.10 │ +3.10   │ 5.80  │ -2.53   │ 3        │ NEW     │
│ │ baseline   │ 22.40 │ -2.60   │ 5.10  │ -3.23   │ 18       │         │
│ │ ...                                                               │ │
│ └────────────┴───────┴─────────┴───────┴─────────┴──────────┘         │
│                                                                        │
│ Note: 2 of 9 generate agents discarded their variants locally.         │
│ See agent invocations 4 and 8 for discard details.                     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Phase 5: Iteration Loop (orchestrator-driven)

**Target file:** `evolution/src/lib/pipeline/loop/runIterationLoop.ts`

**What changes:** Replace the sequential generate→rank loop with an orchestrator-driven sequence of iterations. Each iteration is one of two types: generate or swiss. The orchestrator's `nextIteration()` function decides what to dispatch next.

**Current structure (to be replaced):**
```typescript
for iter 1..N:
  await genAgent.run()
  await rankAgent.run()
```

**New structure:**
```typescript
const numVariants = config.numVariants ?? 9
const strategies = config.strategies ?? ['structural_transform', 'lexical_simplify', 'grounding_enhance']
const completedPairs = new Set<string>()
let iteration = 0
let executionOrder = 0
let exitReason: ExitReason = 'iterations_complete'

// Decision: what's the next iteration?
function nextIteration(): 'generate' | 'swiss' | 'done' {
  if (iteration === 0) return 'generate'  // first iteration is always generate
  if (budgetExhausted) return 'done'

  const eligibleIds = computeEligible(pool, ratings)
  if (eligibleIds.length < 2) return 'done'
  if (allConverged(eligibleIds, ratings)) return 'done'

  // Are there any new pairs left for swiss?
  const candidatePairs = swissPairing(eligibleIds, ratings, completedPairs)
  if (candidatePairs.length === 0) return 'done'

  return 'swiss'
}

// Main loop
while (true) {
  iteration++
  const iterType = nextIteration()
  if (iterType === 'done') break

  recordSnapshot(iteration, 'start', pool, ratings, matchCounts)

  if (iterType === 'generate') {
    // Capture iteration-start snapshot for the generate agents
    const initialPool = [...pool]
    const initialRatings = new Map(ratings)
    const initialMatchCounts = new Map(matchCounts)

    // Dispatch N parallel generateFromSeedArticle agents
    const promises = Array.from({ length: numVariants }, (_, i) => {
      const strategy = strategies[i % strategies.length]
      const agent = new GenerateFromSeedArticleAgent()
      return agent.run(
        { originalText, strategy, llm, initialPool, initialRatings, initialMatchCounts, cache },
        { ...baseCtx, iteration, executionOrder: ++executionOrder }
      )
    })
    const results = await Promise.allSettled(promises)

    // Collect SURFACED agent results (discarded ones contribute nothing)
    const newVariants: Variant[] = []
    const matchBuffers: Array<Array<MatchEntry>> = []
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success && result.value.result.surfaced) {
        const output = result.value.result
        newVariants.push(output.variant)
        matchBuffers.push(output.matches)
      }
      // Discarded variants contribute nothing to the merge — by design
    }

    // Dispatch merge agent (always, even if no buffers — just snapshots before/after)
    const mergeAgent = new MergeRatingsAgent()
    await mergeAgent.run(
      { iterationType: 'generate', matchBuffers, newVariants, pool, ratings, matchCounts, matchHistory },
      { ...baseCtx, iteration, executionOrder: ++executionOrder }
    )
    // No discard step here — discard already happened inside each agent
  }

  if (iterType === 'swiss') {
    const eligibleIds = computeEligible(pool, ratings)

    // Dispatch the swiss work agent
    const swissAgent = new SwissRankingAgent()
    const swissResult = await swissAgent.run(
      { eligibleIds, completedPairs, pool, ratings, cache, llm },
      { ...baseCtx, iteration, executionOrder: ++executionOrder }
    )

    if (swissResult.result.status === 'no_pairs') {
      // No work happened. Skip merge and exit.
      exitReason = 'no_pairs'
      recordSnapshot(iteration, 'end', pool, ratings, matchCounts)
      break
    }

    // Dispatch merge agent UNCONDITIONALLY — paid-for matches always reach global ratings
    const mergeAgent = new MergeRatingsAgent()
    await mergeAgent.run(
      { iterationType: 'swiss', matchBuffers: [swissResult.result.matches], newVariants: [], pool, ratings, matchCounts, matchHistory },
      { ...baseCtx, iteration, executionOrder: ++executionOrder }
    )

    // Update completedPairs from this swiss iteration's matches
    for (const m of swissResult.result.matches) {
      completedPairs.add(pairKey(m.idA, m.idB))
    }

    // Now check status — if budget hit during swiss, exit
    if (swissResult.result.status === 'budget') {
      exitReason = 'budget_exceeded'
      recordSnapshot(iteration, 'end', pool, ratings, matchCounts)
      break
    }
    // Otherwise next iteration's nextIteration() will check convergence/budget/etc.
  }

  recordSnapshot(iteration, 'end', pool, ratings, matchCounts)
}

// Run finalization
```

**The decision tree** in `nextIteration()` is the orchestrator's brain. For our typical run, the sequence is:
- Iteration 1: generate (returns 'generate' because iterationCount === 0)
- Iteration 2: swiss (eligible variants exist, pairs available, not converged)
- Iteration 3: swiss (more pairs)
- Iteration 4: done (no pairs left, or all converged, or budget out)

**Iteration table for a typical run:**

| iteration | exec_order | agent | role |
|---|---|---|---|
| 1 | 1-9 | generate_from_seed_article | parallel work |
| 1 | 10 | merge_ratings | generate iter merge |
| 2 | 11 | swiss_ranking | parallel pair work |
| 2 | 12 | merge_ratings | swiss iter merge |
| 3 | 13 | swiss_ranking | parallel pair work |
| 3 | 14 | merge_ratings | swiss iter merge |
| ... | ... | ... | ... until done |

**Critical invariant — paid-for matches always reach global ratings:**

In every swiss iteration, the orchestrator:
1. Dispatches the work agent
2. Receives the result (which always contains the successful matches even if status is 'budget')
3. Dispatches the merge agent UNCONDITIONALLY with the matches
4. Only after the merge completes does it check the work agent's status to decide whether to exit

This ensures that even if budget runs out mid-swiss-iteration, the matches that completed successfully are applied to global ratings before the loop exits.

Total variants generated = `numVariants` (per generate iteration). With strategies cycling round-robin, you get an even distribution across strategies.

- [x] Replace the sequential generate→rank loop with the orchestrator-driven iteration loop
- [x] Implement `nextIteration()` decision function
- [x] Generate iteration: dispatch N parallel `generateFromSeedArticle` agents + 1 `MergeRatingsAgent`
- [x] Swiss iteration: dispatch 1 `SwissRankingAgent` + 1 `MergeRatingsAgent`
- [x] Each agent gets its own AgentContext snapshot (frozen `iteration`, `executionOrder`) and assigned strategy
- [x] Use `Promise.allSettled` so one failed generate agent doesn't cancel others
- [x] Collect SURFACED agents' results for the merge (discarded variants contribute nothing)
- [x] For swiss: dispatch merge UNCONDITIONALLY (even on budget) to ensure paid-for matches reach global
- [x] Update `completedPairs` from each swiss iteration's results
- [x] Add `numVariants: number` to `EvolutionConfig` (default 9)
- [x] Add `strategies: string[]` to `EvolutionConfig` (default `['structural_transform', 'lexical_simplify', 'grounding_enhance']`)
- [x] Remove `iterations` from required config (orchestrator decides when to stop)

**Iteration and execution_order semantics:**

| Field | Meaning |
|-------|---------|
| `iteration` | Sequential round number (1, 2, 3, ...). Each iteration is one work-batch + merge unit. |
| `execution_order` | Global monotonic counter, assigned at dispatch time. Distinguishes agents within an iteration. |

For a 9-variant run with 2 swiss iterations:
```
Iteration 1 (generate, parallel):
  Agent 1: iteration=1, execution_order=1, strategy=structural_transform
  Agent 2: iteration=1, execution_order=2, strategy=lexical_simplify
  ...
  Agent 9: iteration=1, execution_order=9, strategy=grounding_enhance
  MergeAgent: iteration=1, execution_order=10

Iteration 2 (swiss):
  SwissAgent: iteration=2, execution_order=11
  MergeAgent: iteration=2, execution_order=12

Iteration 3 (swiss):
  SwissAgent: iteration=3, execution_order=13
  MergeAgent: iteration=3, execution_order=14

(orchestrator: nextIteration() returns 'done' — exit)
```

All 9 generate agents in iteration 1 have the same dispatch wallclock time. The merge agent runs after they all complete. Swiss iterations are strictly sequential (the orchestrator dispatches one at a time after each merge).

### Phase 6: Fix AgentContext Shared Mutation

**Target file:** `evolution/src/lib/pipeline/loop/runIterationLoop.ts`

The current code mutates a shared `agentCtx` object before each agent call. With parallel agents, this would corrupt shared state. Replace with per-call frozen snapshots.

```typescript
// Shared base (never passed directly to agents)
const baseCtx = { db, runId, logger, costTracker, config: resolvedConfig };

// Each agent gets its own immutable context
const ctx1: AgentContext = { ...baseCtx, iteration: 1, executionOrder: ++executionOrder };
const ctx2: AgentContext = { ...baseCtx, iteration: 2, executionOrder: ++executionOrder };
```

`++executionOrder` is synchronous (before any await), so the counter increments correctly. Each agent holds a separate object.

- [x] Replace mutable `agentCtx` pattern with per-call snapshots
- [x] Add a test: "concurrent agents receive distinct context snapshots"

### Phase 7: Logging Under Concurrency

**Already safe:** EntityLogger is stateless. Concurrent agents produce interleaved but correctly tagged log rows.

Changes needed:
- [x] Add `agentIndex: number` to log context for each parallel agent (1..N)
- [x] Log per-variant ranking outcome (eliminated/converged/no_more_opponents/discarded) at info level
- [x] Log opponent selection at debug level (which opponent picked, why)
- [x] Log discarded variant count (from discard rule) at warn level

### Phase 8: Tests

#### Unit Tests — `generateFromSeedArticle` Agent
- [x] "generates one variant with assigned strategy"
- [x] "deep-clones initialPool, initialRatings, initialMatchCounts into local state"
- [x] "adds generated variant to LOCAL pool (not the input pool)"
- [x] "mutates local ratings during binary search (chronological order)"
- [x] "input ratings/pool/matchCounts are NOT modified by the agent"
- [x] "execution detail has separate generation and ranking sections"
- [x] "cost tracking splits generation vs ranking"
- [x] "returns status: 'budget' on BudgetExceededError"
- [x] "returns status: 'generation_failed' on format validation failure"
- [x] "agent decides surfaced=true for converged status"
- [x] "agent decides surfaced=true for eliminated status"
- [x] "agent decides surfaced=true for no_more_opponents status"
- [x] "agent decides surfaced=true for budget when local mu >= local top15Cutoff"
- [x] "agent decides surfaced=false for budget when local mu < local top15Cutoff"
- [x] "discarded variant: matches array is empty in return value"
- [x] "surfaced variant: matches array contains all buffered raw outcomes"

#### Unit Tests — Binary-Search Ranking (inside generateFromSeedArticle)
- [x] "selectOpponent picks highest-score opponent (entropy / sigma)"
- [x] "selectOpponent prefers close+reliable over close+noisy"
- [x] "selectOpponent prefers close+reliable over far+precise"
- [x] "selectOpponent picks far opponent when no closer ones available"
- [x] "selectOpponent returns null when no uncompleted opponents exist"
- [x] "selectOpponent excludes already-compared pairs"
- [x] "selectOpponent uses default rating for unrated opponents"
- [x] "rankSingleVariant exits on convergence (local sigma < threshold)"
- [x] "rankSingleVariant exits on elimination via local top-15% CI"
- [x] "rankSingleVariant exits on opponent exhaustion"
- [x] "rankSingleVariant exits on budget exceeded with status: 'budget'"
- [x] "concurrent rankSingleVariant calls (across agents) don't interfere — each has its own local state"

#### Unit Tests — `SwissRankingAgent` (one swiss iteration)
- [x] "takes eligibleIds from input (computed by orchestrator)"
- [x] "computes pairs from eligibleIds and completedPairs"
- [x] "respects MAX_PAIRS_PER_ROUND cap on pair count"
- [x] "pairs allow overlapping variants (a variant can appear in multiple pairs)"
- [x] "pairs run in parallel via Promise.allSettled" — barrier pattern test
- [x] "returns raw match buffer (no rating updates applied inside the agent)"
- [x] "does NOT mutate input.ratings — only the merge agent does that"
- [x] "returns status: 'no_pairs' when no candidates exist"
- [x] "returns status: 'budget' when any pair fails with BudgetExceededError"
- [x] "returns status: 'success' on full success"
- [x] "execution detail records pairsConsidered, pairsSucceeded, pairsFailedBudget, pairsFailedOther"
- [x] "matchesProduced array is capped at 50 entries with truncation flag"
- [x] "successful matches are returned even when some pairs fail with budget"

#### Unit Tests — `MergeRatingsAgent`
- [x] "concatenates match buffers from multiple agents into one list"
- [x] "shuffles the concatenated list via Fisher-Yates"
- [x] "applies OpenSkill updates to global ratings sequentially in shuffled order"
- [x] "adds new variants from input.newVariants to global pool"
- [x] "captures BEFORE state (poolSize, variants, top15Cutoff)"
- [x] "captures AFTER state with muDelta and sigmaDelta per variant"
- [x] "matchesApplied array capped at 50 with truncation flag"
- [x] "matchesApplied entries include shuffledOrder index"
- [x] "execution detail has iterationType: 'generate' or 'swiss'"
- [x] "no discard logic — agent only adds and updates"
- [x] "is reusable for both generate and swiss iterations"
- [x] "handles empty matchBuffers gracefully (no-op merge)"
- [x] "duration measured correctly"

#### Unit Tests — Bias Prevention
- [x] "agent uses deep-cloned local snapshot of ratings (not input reference)"
- [x] "agent mutates local ratings during binary search (chronological)"
- [x] "agent's local rating mutation does NOT affect input ratings or other agents' state"
- [x] "merge agent applies matches in shuffled (randomized) order"
- [x] "global ratings after merge differ from any single agent's local ratings"
- [x] "variant CAN exit via converged when local sigma drops below threshold"
- [x] "variant CAN exit via eliminated when local mu+2σ drops below local top15Cutoff"
- [x] "swiss iteration: matches buffered until merge agent applies them in shuffled order"
- [x] "shuffleInPlace produces uniform distribution over many calls" — Fisher-Yates correctness

#### Unit Tests — Budget Safety (paid-for matches always applied)
- [x] "swiss iteration with 5 pairs (3 success, 2 budget reject): all 3 successful matches reach the merge agent"
- [x] "orchestrator dispatches merge agent UNCONDITIONALLY after swiss, even on budget"
- [x] "orchestrator's budget exit check happens AFTER merge completes"
- [x] "global ratings reflect all successful swiss matches even on partial failure"
- [x] "generate iteration: when an agent discards (surfaced=false), its matches are NOT included in merge (intentional simplification)"
- [x] "generate iteration: agents that surfaced contribute their full match buffer to the merge"

#### Unit Tests — Discard Rule (asymmetric: per-agent in generate, never in swiss)
- [x] "generate agent: budget-status with mu < local top15Cutoff returns surfaced=false"
- [x] "generate agent: budget-status with mu >= local top15Cutoff returns surfaced=true"
- [x] "generate agent: discard uses bare mu, NOT mu+2σ"
- [x] "generate agent: discard uses LOCAL ratings, not global"
- [x] "generate agent: converged/eliminated/no_more_opponents always surface"
- [x] "swiss agent: never makes a surface/discard decision (always returns the matches it completed)"
- [x] "MergeRatingsAgent never discards (it's not its job)"
- [x] "discarded variants: their matches are NOT in matchHistory"
- [x] "discarded variants: their DB row exists with persisted=false"

#### Unit Tests — Iteration Loop (orchestrator-driven)
- [x] "first iteration is always 'generate'"
- [x] "after generate iteration, nextIteration() returns 'swiss' if pairs available and not converged"
- [x] "nextIteration() returns 'done' when all eligible variants converged"
- [x] "nextIteration() returns 'done' when no candidate pairs remain"
- [x] "nextIteration() returns 'done' when budget exhausted"
- [x] "iteration counter increments correctly across mixed generate + swiss iterations"
- [x] "iteration column on invocation row matches the orchestrator iteration"
- [x] "execution_order is monotonic across all agents in all iterations"
- [x] "N generate agents dispatched in parallel within an iteration"
- [x] "swiss iterations are sequential (one at a time)"
- [x] "frozen snapshot: agent 1's variant is NOT visible to agent 2 during the same iteration"
- [x] "frozen snapshot: each agent's local pool only contains the iteration-start state + its own variant"
- [x] "BudgetExceededError in one generate agent doesn't cancel others"

#### Unit Tests — Agent infrastructure (Phase 8)
- [x] "generateFromSeedArticle defines name, executionDetailSchema, invocationMetrics, detailViewConfig"
- [x] "SwissRankingAgent defines name, executionDetailSchema, invocationMetrics, detailViewConfig"
- [x] "execution detail validates against schema for both agents"
- [x] "run-level totalGenerationCost and totalRankingCost computed correctly"
- [x] "pool snapshot captured at start of each iteration (before dispatching work agents)"
- [x] "pool snapshot captured at end of each iteration (after merge agent completes)"
- [x] "pool snapshot captured at end of each iteration (after merge agent completes)"
- [x] "no anchor references in selectOpponent or related code"
- [x] "selectOpponent debug log includes all candidates with scores and selection reason"

#### Unit Tests — Per-invocation ranking detail
- [x] "rankSingleVariant builds comparisons array with one entry per comparison"
- [x] "each comparison entry includes opponent, score, pWin, before/after state"
- [x] "comparisons array order is chronological (matches loop iteration order)"
- [x] "initial state captures localPoolSize, localPoolVariantIds, initialTop15Cutoff"
- [x] "final state captures stopReason, totalComparisons, finalLocalMu/Sigma"
- [x] "execution detail validates against generateFromSeedRankingDetailSchema"
- [x] "execution detail is persisted to evolution_agent_invocations.execution_detail JSONB"
- [x] "debug log fired for each candidate considered in selectOpponent"
- [x] "debug log fired after each comparison with state diff"
- [x] "info log fired at binary search exit with final state"

#### Unit Tests — `persisted` flag
- [x] "newly generated variant has persisted=false in DB"
- [x] "variant with status converged is marked persisted=true at finalization"
- [x] "variant with status eliminated is marked persisted=true at finalization"
- [x] "variant with status no_more_opponents is marked persisted=true at finalization"
- [x] "variant with status budget and mu ≥ top15Cutoff is marked persisted=true"
- [x] "variant with status budget and mu < top15Cutoff is marked persisted=false (discarded)"
- [x] "discarded variants are written to DB with persisted=false (not silently dropped)"
- [x] "metric query filtering by persisted=true excludes discarded variants"
- [x] "cost query NOT filtering by persisted includes discarded variant costs"

#### Unit Tests — Admin query defaults
- [x] "getEvolutionVariantsAction defaults to persisted=true filter when includeDiscarded omitted"
- [x] "getEvolutionVariantsAction returns all variants when includeDiscarded=true"
- [x] "paginated variant list defaults to persisted=true filter"
- [x] "paginated variant list shows discarded when includeDiscarded=true"
- [x] "computeRunMetrics excludes discarded variants from totalVariants count"
- [x] "computeRunMetrics excludes discarded variants from elo stats"
- [x] "lineage action returns persisted field for each variant (no filter)"
- [x] "variant detail action returns persisted field for any variant id"

#### Unit Tests — onUsage cost attribution
- [x] "generateFromSeedArticle accumulates generation cost via onUsage callback"
- [x] "generateFromSeedArticle accumulates ranking cost via onUsage callback"
- [x] "generation and ranking costs are separate in execution detail"
- [x] "cost attribution is correct under N parallel agents (no cross-contamination)"
- [x] "failed agent still reports accurate partial cost"
- [x] "every LLM call passes evolutionInvocationId for llmCallTracking join"

#### Unit Tests — evolution_arena_comparisons extension
- [x] "MergeRatingsAgent writes one row per match to evolution_arena_comparisons"
- [x] "row includes iteration and invocation_id"
- [x] "row captures mu/sigma before and after for both entries"
- [x] "prompt_id is nullable (in-run matches without arena prompt)"
- [x] "arena sync continues to populate the table with only the legacy columns"
- [x] "variant matches query returns rows ordered by iteration"

#### Unit Tests — Run-level error surface
- [x] "normal completion leaves error_code NULL"
- [x] "orchestrator catches exceptions and sets error_code via classifyError"
- [x] "error_message is a human-readable summary"
- [x] "error_details JSONB contains stack trace and context"
- [x] "failed_at_iteration captures the iteration number"
- [x] "failed_at_invocation FK points to the last invocation"
- [x] "classifyError maps BudgetExceededError to appropriate code"
- [x] "classifyError maps timeout errors to appropriate code"
- [x] "unknown errors map to 'unhandled_error'"

#### Unit Tests — RNG seed + reproducibility
- [x] "random_seed is generated at run creation if not provided"
- [x] "random_seed is passed to AgentContext as bigint"
- [x] "deriveSeed produces deterministic sub-seeds from parent + namespace"
- [x] "SeededRandom.shuffle is deterministic given the same seed"
- [x] "two runs with the same seed produce identical match order in merge agents"
- [x] "two runs with the same seed produce identical final ratings (when LLM mocked)"
- [x] "MergeRatingsAgent uses seeded RNG (not Math.random) for Fisher-Yates"

#### Unit Tests — LLM prompt/response capture via llmCallTracking
- [x] "generateFromSeedArticle calls callLLM with evolutionInvocationId in options"
- [x] "SwissRankingAgent calls callLLM with evolutionInvocationId in options"
- [x] "llmCallTracking row written for every LLM call made by an agent"
- [x] "llmCallTracking can be joined to evolution_agent_invocations via evolution_invocation_id"
- [x] "admin UI variant detail surfaces LLM calls via existing llmCallTracking query"

#### Integration Tests (blocked on migration application)
- [ ] End-to-end: full two-iteration run with 9 variants produces converged rankings
- [ ] Budget tracking accurate across both iterations
- [ ] Cold start handled: first generate iteration's variants exit with `no_more_opponents`; subsequent swiss iterations refine them to convergence
- [ ] Warm pool: swiss iterations converge quickly using established ratings
- [ ] Pool snapshots persist correctly to DB and render in admin UI
- [ ] Run row shows totalGenerationCost and totalRankingCost separately

### Phase 9: Agent Infrastructure (persistence flag, metrics, detail views, anchor removal, pool snapshots)

#### 9z: `persisted` flag on `evolution_variants`

Add an explicit flag to mark variants that survived the discard rule. This makes the implicit "in pool / not in pool" distinction queryable post-run, and lets metrics filter to only the variants that are part of the final result.

**Schema change:**
```sql
ALTER TABLE evolution_variants
ADD COLUMN persisted BOOLEAN NOT NULL DEFAULT false;
```

**Lifecycle:**
1. **Generation:** Variant inserted with `persisted: false` (default)
2. **Write at run finalization:** persistRunResults writes all variants in pool with `persisted: true` and all discarded variants with `persisted: false`
3. **Run finalization:** Bulk UPDATE all current pool variants to `persisted: true` (idempotent safety net in case step 2 failed)

**Meaning:** `persisted = true` means "this variant survived to the final run pool." It's true for all stop conditions except `budget` with `mu < top15Cutoff`.

| Stop condition | `persisted` |
|---|---|
| `converged` | true |
| `eliminated` (in pool but flagged) | true |
| `no_more_opponents` | true |
| `budget` (mu ≥ top15Cutoff, kept) | true |
| `budget` (mu < top15Cutoff, discarded) | false |

**Why default false:**
- Safer — variants must be explicitly committed to the final pool
- Crashed runs leave variants as `persisted: false`, distinguishable from successful runs
- Failed discard query leaves variants as `persisted: false` (not falsely shown as final)

**Metric implications:**
- Most metrics filter by `persisted = true` (e.g., variant counts, mu/sigma stats, comparisons per variant)
- Cost metrics do NOT filter — discarded variants still cost real money to generate and partially rank

```sql
-- Variants in final result
SELECT COUNT(*) FROM evolution_variants
WHERE run_id = $1 AND persisted = true

-- Total cost (no filter)
SELECT SUM(cost_usd) FROM evolution_agent_invocations WHERE run_id = $1
```

**Important note on write timing:** Today, `evolution_variants` rows are only written at run finalization (`persistRunResults.ts:191` does a bulk UPSERT). They are NOT written incrementally during the run. This simplifies the persisted flag implementation: the write happens once, and we set the flag correctly at that moment.

**Where the discard decision is made:** Inside each `generateFromSeedArticle` agent (using local ratings). The orchestrator collects each agent's surfaced/discarded decision and tracks discarded variants separately. The merge agent never sees discarded variants. At run finalization, both surfaced (`persisted: true`) and discarded (`persisted: false`) variants are written to DB.

**Implementation:**
- [x] DB migration: `ALTER TABLE evolution_variants ADD COLUMN persisted BOOLEAN NOT NULL DEFAULT false`
- [x] In `runIterationLoop.ts`: after each generate iteration's agent results are collected, partition them into surfaced and discarded. Store discarded variants in a `discardedVariants: Variant[]` field on the EvolutionResult.
- [x] In `persistRunResults.ts`:
  - For each variant in `localPool` (surfaced variants only): write with `persisted: true`
  - For each variant in `discardedVariants`: write with `persisted: false`. These rows preserve generation cost, text, and metadata for debugging.
  - This requires `EvolutionResult` to carry the discarded variants alongside the surviving pool
- [x] Update `evolutionVariantInsertSchema` to include `persisted: boolean` field

**Default behavior for admin queries:** Admin variant tables and metric queries default to filtering by `persisted = true`. Admins can opt in to seeing all variants (including discarded) via a UI toggle. This makes the dashboard match what users care about by default — the variants that actually made it to the final pool — while keeping discarded variants accessible for debugging.

**Audit of existing metric/query call sites — what needs filtering:**

| File | Line | What it does | Filter `persisted = true`? |
|------|------|--------------|----------------------------|
| `lib/metrics/experimentMetrics.ts` | 270 (`computeRunMetrics`) | Reads variants for run-level elo stats (median, p90, max, totalVariants) | **YES (always)** — metrics never include discarded |
| `lib/metrics/recomputeMetrics.ts` | 61 (`recomputeRunEloMetrics`) | Rebuilds in-memory pool from DB to recompute finalization metrics | **YES (always)** — discarded variants shouldn't enter the recomputed pool |
| `lib/metrics/recomputeMetrics.ts` | 159 (`recomputeInvocationMetrics`) | Per-invocation metric recompute, builds pool from DB | **YES (always)** — same reason |
| `lib/metrics/computations/finalization.ts` | (multiple) | `computeWinnerElo`, `computeMedianElo`, `computeP90Elo`, `computeMaxElo` — work on `ctx.pool` (in-memory) | **NO** — in-memory pool only contains surfaced variants (discarded ones never get added). No filter needed here. |
| `lib/pipeline/finalize/persistRunResults.ts` | 191 | UPSERT write path | **N/A** — this is the write, sets `persisted` flag for each variant |
| `lib/pipeline/setup/buildRunContext.ts` | 40 (`loadArenaEntries`) | Loads arena entries to seed initial pool | **NO** — already filters by `synced_to_arena = true`; only persisted variants ever get synced to arena |
| `services/evolutionActions.ts` | 347 (`getEvolutionVariantsAction`) | Admin variant list per run (run detail page) | **YES (default), with toggle** — default filter persisted=true, admin UI can disable filter to show all |
| `services/evolutionActions.ts` | 505 (paginated variant list) | Admin variants page with filters | **YES (default), with toggle** — default `persisted = true`, optional parameter to override |
| `services/variantDetailActions.ts` | 61, 103, 112, 139, 177, 191 | Single variant detail lookups (admin clicked into a specific variant) | **NO** — admin has explicit variant ID; never filter |
| `services/evolutionVisualizationActions.ts` | 224 (`getEvolutionRunLineageAction`) | Lineage graph rendering | **NO** — lineage shows genealogy; filtering would create orphan nodes. Show all with `persisted` field included so the renderer can visually mute discarded nodes. |
| `services/arenaActions.ts` | 82, 145, 168 | Arena queries | **NO** — already filter by `synced_to_arena = true` |
| `lib/pipeline/manageExperiments.ts` | 122-126 | Joins variants by `is_winner = true` | **NO** — winners are by definition persisted (they survived to be selected) |

**Implementation tasks for backend queries:**
- [x] `experimentMetrics.ts:270` — add `.eq('persisted', true)` to the variants query in `computeRunMetrics`
- [x] `recomputeMetrics.ts:61` — add `.eq('persisted', true)` to the variants query in `recomputeRunEloMetrics`
- [x] `recomputeMetrics.ts:159` — add `.eq('persisted', true)` to the variants query in `recomputeInvocationMetrics`
- [x] `evolutionActions.ts:347` — add `includeDiscarded?: boolean` parameter (default false). When false, add `.eq('persisted', true)`. Add `persisted` to SELECT fields.
- [x] `evolutionActions.ts:505` — add `includeDiscarded?: boolean` parameter (default false). When false, add `.eq('persisted', true)`. Existing filter logic remains.
- [x] `evolutionVisualizationActions.ts:224` — add `persisted` to SELECT fields (no filter, but renderer needs the flag)
- [x] `variantDetailActions.ts` — add `persisted` to SELECT fields in `getVariantDetailAction` so the detail view shows the flag

**Implementation tasks for admin UI:**
- [x] **Variant table column**: Add a `persisted` column to all variant table views in the evolution admin dashboard:
  - Run detail page → Variants tab
  - Variants list page (paginated)
  - Snapshot tab tables
- [x] Column display: simple boolean badge — green ✓ for true, red ✗ for false. Or text "yes" / "no". Sortable.
- [x] **"Include discarded" toggle**: Add a checkbox/switch above each variant table titled "Include discarded variants". Default OFF. When toggled, calls the action with `includeDiscarded: true`.
- [x] **Variant detail page**: Show `persisted: true/false` prominently in the metadata section. Add a banner/badge if `persisted = false` indicating "Discarded variant — not included in run metrics".
- [x] **Lineage graph**: Render `persisted = false` nodes with reduced opacity (e.g., 40%) and a dashed border to visually distinguish them.

**Pool snapshot tab integration:**
- [x] Snapshot tab variant tables include the `persisted` column (joined from `evolution_variants` by snapshot variant ID)
- [x] The discarded section uses the `discardedVariantIds` field from the snapshot, which correlates with `persisted = false` rows in the DB



#### 9a: All three agents fully integrated as proper Agent subclasses

`generateFromSeedArticle`, `SwissRankingAgent`, and `MergeRatingsAgent` all extend the `Agent<Input, Output, Detail>` base class. They must each define all standard agent properties:

- [x] `name` constant (e.g., `'generate_from_seed_article'`, `'swiss_ranking'`, `'merge_ratings'`)
- [x] `executionDetailSchema` Zod schema for validating execution detail
- [x] `invocationMetrics: FinalizationMetricDef[]` — metrics computed per invocation at finalization (cost, comparisons run, status counts, matches merged, etc.)
- [x] `detailViewConfig: DetailFieldDef[]` — admin UI configuration for displaying execution detail
- [x] Register all three agents in any agent catalog/registry that exists
- [x] Make sure invocation rows for all three agents show up in admin UI with appropriate detail views

#### 9b: Cost tracking (per-agent and aggregate)

Per-invocation breakdown (already in plan):
- [x] `generationCost` and `rankingCost` separate fields in `generateFromSeedArticle` execution detail
- [x] `rankingCost` in `SwissRankingAgent` execution detail (no generation cost)
- [x] Top-level `cost_usd` is the sum (matches existing column semantics)

Run-level aggregates (new):
- [x] At end of run, compute totals across all invocations: `totalGenerationCost` (from generateFromSeedArticle agents), `totalRankingCost` (binary search inside generate agents + SwissRankingAgent comparisons + MergeRatingsAgent duration is free)
- [x] Store on the run row or in run-level metrics
- [x] Display in admin UI run detail view

#### 9c: Pool snapshots at start and end of each iteration

We need to be able to inspect what the pool looked like at the start and end of each iteration for debugging.

**Snapshot type (lean — IDs + dynamic state only, no duplicated variant text):**

```typescript
interface IterationSnapshot {
  iteration: number          // sequential iteration number (1, 2, 3, ...)
  iterationType: 'generate' | 'swiss'
  phase: 'start' | 'end'     // captured at iteration start or end
  capturedAt: string         // ISO timestamp
  poolVariantIds: string[]   // ordering matches pool array
  ratings: Record<string, { mu: number, sigma: number }>
  matchCounts: Record<string, number>
  discardedVariantIds?: string[]  // generate iteration end only — IDs that were discarded by their owning agents
  discardReasons?: Record<string, { mu: number, top15Cutoff: number }>  // per-discarded-variant detail
}
```

Variant text lives on `evolution_variants` rows; the snapshot stores only IDs. For 9 variants, snapshot size is ~1 KB. A typical run has ~8 snapshots (2 per iteration × 4 iterations) = ~8 KB.

**Storage: JSONB column on `evolution_runs`**

```sql
ALTER TABLE evolution_runs
ADD COLUMN iteration_snapshots JSONB DEFAULT '[]'::jsonb;
```

Stores an array of `IterationSnapshot` objects. Reasoning:
- Always read with the run row
- No independent queries needed
- One ALTER TABLE migration vs new table + FK + RLS
- Write-once per iteration, never updated

**When snapshots are taken:**

For each iteration the orchestrator dispatches:

| Snapshot | When | Captures |
|----------|------|----------|
| Iteration N start | Before dispatching the work agent(s) | Pool state going INTO the iteration |
| Iteration N end | After the MergeRatingsAgent completes | Pool state coming OUT of the iteration, including any discards (generate iterations) |

For a typical run (4 iterations: 1 generate + 3 swiss) that's 8 snapshots total.

**Admin UI: new "Snapshots" tab on run detail page**

Each iteration shows a start and end snapshot as formatted tables, grouped by iteration number:

```
┌─ Snapshots ─────────────────────────────────────────────────┐
│                                                              │
│ ▼ Iteration 1 — generate                                    │
│                                                              │
│   START (2026-04-07 14:23:45)                                │
│   ┌────────────┬───────────┬───────┬───────┬──────────┐    │
│   │ Variant ID │ Strategy  │ mu    │ sigma │ matches  │    │
│   │ baseline   │ baseline  │ 25.00 │ 8.33  │ 0        │    │
│   └────────────┴───────────┴───────┴───────┴──────────┘    │
│                                                              │
│   END (2026-04-07 14:24:12)                                  │
│   ┌────────────┬───────────┬───────┬───────┬──────────┐    │
│   │ v1 (link)  │ struct    │ 31.20 │ 4.30  │ 6        │    │
│   │ v2 (link)  │ lex       │ 28.10 │ 5.50  │ 5        │    │
│   │ v3 (link)  │ ground    │ 26.80 │ 6.20  │ 4        │    │
│   │ baseline   │ baseline  │ 22.45 │ 5.12  │ 4        │    │
│   │ ...                                                │    │
│   └────────────┴───────────┴───────┴───────┴──────────┘    │
│                                                              │
│   Discarded during iteration 1 (1 variant):                  │
│   ┌────────────┬───────┬─────────────────────────────┐      │
│   │ v7 (link)  │ 18.20 │ budget, local mu < cutoff   │      │
│   └────────────┴───────┴─────────────────────────────┘      │
│                                                              │
│ ▼ Iteration 2 — swiss                                        │
│   START ...                                                  │
│   END ...                                                    │
│                                                              │
│ ▼ Iteration 3 — swiss                                        │
│   ...                                                        │
│                                                              │
│ ▼ Iteration 4 — swiss (final)                                │
│   ...                                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Table features:**
- Variant ID is a link to the variant detail page
- Default sort: by mu descending
- Click column header to re-sort by mu, sigma, or matches
- Strategy column joined from `evolution_variants` (since snapshot only stores IDs)
- Discarded variants shown only on generate iteration end snapshots (swiss never discards)
- Iterations are collapsible — click to expand/collapse

**Implementation:**
- [x] DB migration: `ALTER TABLE evolution_runs ADD COLUMN iteration_snapshots JSONB DEFAULT '[]'::jsonb`
- [x] Define `iterationSnapshotSchema` Zod schema (includes `iterationType`, `phase`)
- [x] In `runIterationLoop.ts`: helper `recordSnapshot(iteration, iterationType, phase, pool, ratings, matchCounts, options)` that builds the snapshot object and pushes to an in-memory array
- [x] Call `recordSnapshot(n, type, 'start', ...)` at the top of each iteration
- [x] Call `recordSnapshot(n, type, 'end', ..., { discardedVariantIds, discardReasons })` after the merge agent completes
- [x] Persist all snapshots to the run row at run finalization (single UPDATE, not per-iteration)
- [x] Server action: `getRunSnapshotsAction(runId): Promise<IterationSnapshot[]>` — joins snapshot variant IDs to `evolution_variants` to fetch strategy and other display fields
- [x] Frontend: new `<SnapshotsTab>` component, registered in run detail page tab list
- [x] Build sortable, collapsible iteration groups
- [x] Variant IDs render as `<Link href="/admin/variants/[id]">` with truncated UUID display
- [x] Discarded variants section: shown only on generate iteration end snapshots

#### 9d: Remove "anchor" concept entirely

The current `rankVariants.ts` has an "anchor" concept used in stratified opponent selection (low-sigma variants designated as anchors). Our new opponent selection formula doesn't need this — the formula picks low-sigma opponents naturally.

- [x] Search the codebase for `anchor` references in evolution code
- [x] Remove anchor selection logic from any function we keep
- [x] Remove anchor display elements from admin UI (likely in `LogsTab`, `RankingDetailView`, or similar)
- [x] Remove any anchor-related fields from execution details (e.g., `lowSigmaOpponentsCount`)
- [x] Remove anchor-related metrics
- [x] Update doc references

#### 9e: Detailed per-invocation tracking for `generateFromSeedArticle`

We need to be able to reconstruct exactly what happened during a single agent's binary search loop after the run completes. Two layers of tracking:

**Layer 1: Debug logs (`logger.debug`)** — verbose, per-comparison, real-time
- Visible in admin UI's `LogsTab`
- Filtered by debug level (off by default in production)
- For active debugging during a run

**Layer 2: Execution detail JSONB blob** — structured, persistent, queryable
- Always stored on the `evolution_agent_invocations.execution_detail` field
- Visible in admin UI's invocation detail page via custom `detailViewConfig`
- For post-mortem analysis

**Execution detail structure for `generateFromSeedArticle`:**

```typescript
interface GenerateFromSeedRankingDetail {
  variantId: string
  strategy: string

  // Start state
  localPoolSize: number
  localPoolVariantIds: string[]
  initialTop15Cutoff: number

  // Per-comparison timeline (all in chronological order)
  comparisons: Array<{
    round: number               // 1-indexed
    opponentId: string
    selectionScore: number      // entropy / sigma^k
    pWin: number                // expected win probability before the comparison

    // Local state before comparison
    variantMuBefore: number
    variantSigmaBefore: number
    opponentMuBefore: number
    opponentSigmaBefore: number

    // Outcome from LLM
    outcome: 'win' | 'loss' | 'draw'
    confidence: number

    // Local state after comparison (post-OpenSkill-update)
    variantMuAfter: number
    variantSigmaAfter: number
    opponentMuAfter: number
    opponentSigmaAfter: number
    top15CutoffAfter: number    // recomputed cutoff

    // Stop check values at this point (helps debug "why didn't this stop?")
    muPlusTwoSigma: number      // for elimination check
    eliminated: boolean         // would elimination fire here?
    converged: boolean          // would convergence fire here?
  }>

  // Final state
  stopReason: 'converged' | 'eliminated' | 'no_more_opponents' | 'budget'
  totalComparisons: number
  finalLocalMu: number
  finalLocalSigma: number
  finalLocalTop15Cutoff: number
  rankingDurationMs: number
  rankingCost: number
}
```

For typical 5-10 comparisons per variant, this is ~2-3 KB of JSONB per invocation. Cheap to store.

**Note on local vs global:** The execution detail captures the AGENT'S LOCAL VIEW during the loop. After end-of-iter-1 randomized merge, the GLOBAL ratings will be slightly different. The execution detail reflects what the agent saw and decided based on, not the final global state. This is exactly what we want for debugging — "why did this agent stop here?"

**Debug logging during the loop:**

```typescript
// Inside selectOpponent
logger.debug('Selecting opponent', {
  variantId, comparisonRound,
  candidatesConsidered: candidates.map(c => ({
    id: c.id, mu: c.mu, sigma: c.sigma,
    score: c.score, pWin: c.pWin,
    excluded: completedPairs.has(c.id),
  })),
  pickedOpponent: bestId,
  pickedScore: bestScore,
  phaseName: 'ranking',
})

// After updating local ratings
logger.debug('Comparison complete', {
  variantId, comparisonRound,
  opponentId, outcome, confidence,
  variantMuBefore, variantMuAfter,
  variantSigmaBefore, variantSigmaAfter,
  newTop15Cutoff,
  phaseName: 'ranking',
})

// At loop exit
logger.info('Binary search exit', {
  variantId, stopReason, totalComparisons,
  finalMu, finalSigma,
  phaseName: 'ranking',
})
```

**Implementation tasks:**
- [x] Define `generateFromSeedRankingDetailSchema` Zod schema with all fields above
- [x] In `rankSingleVariant`, build the `comparisons` array as the loop runs (capture before/after state for each)
- [x] Capture initial state (poolSize, top15Cutoff, variant ids) at loop start
- [x] Capture final state (stopReason, totalComparisons, finalMu, finalSigma) at loop exit
- [x] Return the detail object alongside the matchBuffer
- [x] In `generateFromSeedArticle.execute()`, embed the ranking detail in `execution_detail.ranking`
- [x] Add debug-level logs at the three points above (`Selecting opponent`, `Comparison complete`, `Binary search exit`)
- [x] Use structured fields in log context (not concatenated strings) for filterable queries
- [x] At high pool sizes (>50 candidates), sample candidate logging (e.g., top 10 by score) to avoid log bloat
- [x] Update `detailViewConfig` so admin UI renders the comparisons array as a sortable table

**Admin UI: invocation detail page for `generateFromSeedArticle`**

```
┌─ generateFromSeedArticle invocation #4 (iteration=1, execution_order=4) ─┐
│                                                                          │
│ Variant: v4 (link)        Strategy: structural_transform                 │
│ Stop reason: converged    Total comparisons: 7                           │
│ Generation cost: $0.001   Ranking cost: $0.024   Duration: 18.3s         │
│                                                                          │
│ ─── Generation ─────────────────────────────────────────────────────────  │
│ Strategy: structural_transform                                           │
│ Format valid: yes                                                        │
│ Text length: 2,847 chars                                                 │
│                                                                          │
│ ─── Ranking (binary search local view) ────────────────────────────────  │
│                                                                          │
│ Initial state:                                                           │
│   Local pool size: 5  (baseline + 4 arena entries)                       │
│   Initial top15 cutoff: 28.5                                             │
│   Variant starting mu/σ: 25.00 / 8.33                                    │
│                                                                          │
│ Comparisons:                                                             │
│ ┌─────┬───────────┬───────┬──────┬─────┬────────────────┬──────────────┐ │
│ │ #   │ Opponent  │ Score │ pWin │ Out │ μ before→after │ σ before→after│ │
│ │ 1   │ arena_a   │ 0.235 │ 0.50 │ win │ 25.00 → 28.20  │ 8.33 → 7.10  │ │
│ │ 2   │ arena_b   │ 0.198 │ 0.46 │ win │ 28.20 → 30.45  │ 7.10 → 6.20  │ │
│ │ 3   │ arena_c   │ 0.171 │ 0.55 │ los │ 30.45 → 28.10  │ 6.20 → 5.50  │ │
│ │ 4   │ baseline  │ 0.152 │ 0.61 │ win │ 28.10 → 29.85  │ 5.50 → 4.90  │ │
│ │ 5   │ arena_d   │ 0.139 │ 0.49 │ win │ 29.85 → 31.20  │ 4.90 → 4.30  │ │
│ │ 6   │ ...       │ ...   │ ...  │ ... │ ...            │ ...          │ │
│ │ 7   │ ...       │ ...   │ ...  │ ... │ 32.10 → 32.45  │ 3.20 → 2.85  │ │
│ └─────┴───────────┴───────┴──────┴─────┴────────────────┴──────────────┘ │
│                                                                          │
│ Final local state:                                                       │
│   μ: 32.45    σ: 2.85    top15 cutoff: 30.20                             │
│   Stop reason: converged (σ < 3.0)                                       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

The table is sortable by round, opponent, score, or any state column. This view tells the admin exactly what the agent did and why it made each decision, all from the invocation row.

#### 9f: Run-level aggregate metrics
- [x] Add `numVariants` and `strategies` to run-level config logging
- [x] Add per-agent fields to invocation execution detail: `strategy`, `status`, `comparisonsRun`
- [x] Run-level aggregates: count of converged/eliminated/no_more_opponents/budget-surfaced/budget-discarded across all generate iteration agents
- [x] Run-level aggregates: total swiss comparisons (sum across all swiss iterations), swiss iteration count, total swiss duration

## Files Affected

### New Files
- `evolution/src/lib/core/agents/generateFromSeedArticle.ts` — Single-variant generate+rank agent (with own discard decision)
- `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts`
- `evolution/src/lib/core/agents/SwissRankingAgent.ts` — One swiss iteration's worth of parallel pair comparisons
- `evolution/src/lib/core/agents/SwissRankingAgent.test.ts`
- `evolution/src/lib/core/agents/MergeRatingsAgent.ts` — Shuffled OpenSkill update merge, reusable for both generate and swiss iterations
- `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts`
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — Binary-search ranking (called by generateFromSeedArticle)
- `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts`
- `evolution/src/lib/pipeline/loop/swissPairing.ts` — Swiss pair selection (overlap allowed, capped) (extracted from old rankVariants.ts)
- `evolution/src/lib/shared/seededRandom.ts` — SeededRandom class + deriveSeed() helper for reproducibility
- `evolution/src/lib/shared/seededRandom.test.ts`
- `evolution/src/lib/pipeline/classifyError.ts` — Map exceptions to RunErrorCode taxonomy
- `evolution/src/lib/pipeline/classifyError.test.ts`

### Modified Files
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — Orchestrator-driven iteration loop, `nextIteration()` decision, frozen snapshots per agent, pool snapshots, cost via onUsage
- `evolution/src/lib/pipeline/claimAndExecuteRun.ts` — Populate random_seed in ensureRunSetup; wrap orchestrator in try/catch for structured error capture
- `evolution/src/lib/schemas.ts` — `generateFromSeedExecutionDetailSchema`, `swissRankingExecutionDetailSchema`, `mergeRatingsExecutionDetailSchema`, `numVariants` and `strategies` config fields; make `evolutionArenaComparisonInsertSchema.prompt_id` nullable; add new columns to match insert schema; add `random_seed`, error fields to `evolutionRunFullDbSchema`
- `evolution/src/lib/types.ts` — Add `RunErrorCode` type, update `AgentContext` to include `randomSeed: bigint`
- `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — Update tests for iteration model
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — Write surfaced and discarded variants with appropriate `persisted` flag; write error fields; write snapshots; write random_seed
- `evolution/src/lib/core/entities/VariantEntity.ts` — Verify cascade delete still works with new arena_comparisons columns
- Admin UI files referencing "anchor" — remove anchor display and metrics (search for `anchor` in `evolution/src/components/`)
- Admin UI variant table components — add `persisted` column and "Include discarded" toggle (run detail Variants tab, paginated variant list, snapshot tab)
- Admin UI variant detail page — add `persisted` badge/banner; add Matches tab (from extended arena_comparisons); add LLM calls tab (from llmCallTracking)
- Admin UI lineage graph component — render `persisted = false` nodes with reduced opacity and dashed border
- Admin UI invocation detail page — custom detailViewConfig for each of the three new agent types; add LLM calls section (from llmCallTracking filtered by evolution_invocation_id)
- Admin UI run detail page — error banner when error_code is populated; Reproduce button using random_seed; SnapshotsTab
- DB migration: add `iteration_snapshots` JSONB column to `evolution_runs`
- DB migration: add `persisted` BOOLEAN column to `evolution_variants` (default false)
- DB migration: add error fields (`error_code`, `error_message`, `error_details`, `failed_at_iteration`, `failed_at_invocation`) to `evolution_runs`
- DB migration: add `random_seed` BIGINT column to `evolution_runs`
- DB migration: make `prompt_id` nullable on `evolution_arena_comparisons`; add in-run observability columns (iteration, invocation_id, mu/sigma before/after for both entries)
- Backend services: update `getEvolutionVariantsAction`, paginated variants action, `getVariantDetailAction`, `getEvolutionRunLineageAction` to add `persisted` to selects and add `includeDiscarded` parameter where needed
- Backend services: new `getVariantMatchesAction`, `getVariantLlmCallsAction`, `getInvocationLlmCallsAction` for the new admin UI tabs

### Files to Remove
- `evolution/src/lib/core/agents/GenerationAgent.ts` — Replaced by generateFromSeedArticle
- `evolution/src/lib/core/agents/RankingAgent.ts` — Replaced by SwissRankingAgent + MergeRatingsAgent
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — Replaced by rankSingleVariant + swissPairing helpers
- `evolution/src/lib/pipeline/loop/generateVariants.ts` — Strategy logic moved into generateFromSeedArticle
- Their test files

## Testing

### Unit Tests
- [x] `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — Single-variant agent with local discard (16 tests)
- [x] `evolution/src/lib/core/agents/SwissRankingAgent.test.ts` — One swiss iteration work agent (13 tests)
- [x] `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts` — Merge agent with before/after capture (13 tests)
- [x] `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts` — Binary-search algorithm (12 tests)
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — Orchestrator-driven iteration loop (13 tests)

### Integration Tests (blocked on migration application)
- [ ] End-to-end pipeline test: full run with 9 variants, ~2-4 iterations
- [ ] Cold start integration test: first iter exits via no_more_opponents for most variants, swiss iters refine to convergence
- [ ] Budget exhaustion during swiss iteration: successful matches reach global ratings, orchestrator exits cleanly
- [ ] Budget exhaustion during generate iteration: surfaced agents contribute matches, discarded agents do not
- [x] `nextIteration()` decision correctness: generate → swiss → swiss → done (covered by orchestrator unit tests)

### Manual Verification (blocked on migration application)
- [ ] Run a local evolution pipeline, verify wall-clock time reduction
- [ ] Verify discarded variants don't appear in final result (persisted=false in DB)
- [ ] Verify budget tracking remains accurate across all agent types
- [x] Check admin UI shows three new agent types with appropriate detail views (verified via Playwright — pages render, action errors gracefully without column)
- [x] Verify MergeRatingsAgent's before/matches/after display renders correctly (covered by detailViewConfig + unit tests)
- [x] Verify iteration count and execution_order are monotonic across all invocations (covered by orchestrator unit test)

## Verification

### A) Automated Tests
- [x] All new tests pass
- [x] Existing tests for GenerationAgent/RankingAgent removed (replaced)
- [x] `npm run test:unit` passes
- [x] `npm run build` succeeds
- [x] `npm run lint` passes
- [x] `npx tsc --noEmit` passes

### B) Integration Verification (blocked on migration application)
- [ ] Run `npm run test:integration` — evolution integration tests pass
- [ ] Run a real evolution pipeline locally and verify:
  - Multiple agents dispatched in parallel
  - Variants converge or get eliminated
  - Discarded variants absent from result
  - Budget tracking accurate
  - Cost breakdown shows generation vs ranking separately
  - Wall-clock time visibly reduced vs old architecture

## Documentation Updates
- [x] `evolution/docs/architecture.md` — Replace generate→rank flow with orchestrator-driven iteration architecture (generate iteration + swiss iterations, each with its own work agent(s) + merge agent)
- [x] `evolution/docs/agents/overview.md` — Document `generateFromSeedArticle` and `SwissRankingAgent` agents
- [x] `evolution/docs/rating_and_comparison.md` — Replace triage + Swiss with binary-search (in generate iterations) + swiss pair comparisons (in swiss iterations), local discard rule in generate agents
- [x] `evolution/docs/metrics.md` — New per-agent and per-iteration metrics
- [x] `docs/feature_deep_dives/evolution_metrics.md` — New execution detail structure
- [x] `evolution/docs/logging.md` — Interleaved log behavior under parallel agents

## Resolved Decisions
- `numVariants` default: **9**, configurable per experiment via `EvolutionConfig`
- Opponent selection: continuous scoring `entropy(pWin) / sigma^SIGMA_WEIGHT`. Single tunable knob `SIGMA_WEIGHT = 1.0`. No `MIN_RANGE`, no `RANGE_MULTIPLIER`. The two-knob form `entropy^a / sigma^b` collapses to one knob via the monotonic transformation `score^(1/a)`. See "Parameter analysis" section.
- **Iteration model:** orchestrator-driven. Each iteration is one work-batch + merge. First iteration is `generate`; subsequent iterations are `swiss` until convergence/exhaustion/budget. The orchestrator's `nextIteration()` function encodes this decision. Future iteration types (feedback generation, etc.) can be added without restructuring.
- **Three agent types:** `generateFromSeedArticle`, `SwissRankingAgent`, `MergeRatingsAgent`. Each is a proper Agent subclass with execution detail schema, metrics, and detail view config.
- **Discard lives in the generate agent**, not the merge agent. Each `generateFromSeedArticle` invocation makes its own surface/discard decision using its local ratings. The merge agent only sees surfaced work.
- **The "round" concept is eliminated.** Each iteration is one work+merge unit. What we previously called "Swiss rounds" are now just "swiss iterations."
- **No resume semantics.** Confirmed: the existing pipeline has no checkpoint/resume — `evolution_checkpoints` table and `checkpoint_and_continue` RPC were dropped. The heartbeat is purely a liveness signal. Runs that die are dead; snapshots can be written only at finalization without regression.
- **Per-phase cost attribution uses `onUsage` callback**, not `costTracker.getTotalSpent()` deltas. Each LLM call reports its exact cost via the callback; agents accumulate locally. `costTracker` stays for global budget enforcement only.
- **In-run matches persisted by extending `evolution_arena_comparisons`**, not by creating a new table. `prompt_id` becomes nullable; add `iteration`, `invocation_id`, and mu/sigma before/after columns. Written by `MergeRatingsAgent` as it applies updates.
- **Run-level error surface** via new columns on `evolution_runs`: `error_code`, `error_message`, `error_details`, `failed_at_iteration`, `failed_at_invocation`. Error code taxonomy defined in `RunErrorCode` type.
- **RNG seed for reproducibility** via new `random_seed` column on `evolution_runs`. Seeded RNG threaded through merge agent's Fisher-Yates shuffle and agent tiebreaks. Per-agent sub-seeds derived deterministically to support parallelism.
- **LLM prompts/responses** captured via existing `llmCallTracking` infrastructure. Agents pass `evolutionInvocationId: ctx.invocationId` on every `callLLM` to populate the existing FK.

## Open Questions
- Default for max iterations (safety cap on orchestrator loop): something like 20 to prevent runaway loops?
- Should we track per-iteration budget spend separately to detect budget spikes in specific iteration types?
- Is `CONVERGENCE_THRESHOLD = 3.0` actually achievable for typical small pools (3-5 eligible variants)? With 3 variants there are only 3 unique pairs — after compactly running them, we exit via `no_pairs` rather than `converged`. May need to accept this or relax the threshold.
- RNG seed: should we auto-generate if not user-provided, or require it in config? (Suggest auto-generate, expose in UI for reproducibility)

## Critical Gaps — Design Additions

These were identified during a design review and should be addressed before implementation.

### A. No resume semantics (confirmed)

The existing pipeline has no checkpoint/resume behavior — `evolution_checkpoints` table and `checkpoint_and_continue` RPC were both dropped in migration `20260322000006_evolution_fresh_schema.sql`. The heartbeat (`last_heartbeat` on `evolution_runs`) is purely a liveness signal so stale runs can be reclaimed, not a resume point.

**What this means for the plan:**
- Runs do not resume. If a run dies, it's dead.
- Snapshots can be written only at finalization — no need for incremental persistence.
- `completedPairs` lives only in memory during the run.
- Crash-loss of observability matches current behavior; no regression.

### B. Per-phase cost attribution via `onUsage` callback

**Problem with the previous approach:** Reading `costTracker.getTotalSpent()` deltas before/after each phase is meaningless under parallel agents — another agent's spend lands between the two reads, so the delta attributes cost incorrectly.

**Solution:** Use the existing `CallLLMOptions.onUsage` callback in `src/lib/services/llms.ts`:

```typescript
export interface CallLLMOptions {
  onUsage?: (usage: LLMUsageMetadata) => void;  // fires after each LLM call with exact cost
  evolutionInvocationId?: string;
}
```

Each agent accumulates its own cost locally:

```typescript
// Inside generateFromSeedArticle.execute()
let localGenerationCost = 0;
let localRankingCost = 0;

// Generation phase
await llm.complete(prompt, 'evolution_generate_from_seed', {
  onUsage: (usage) => { localGenerationCost += usage.estimatedCostUsd; },
  evolutionInvocationId: ctx.invocationId,
});

// Ranking phase
for each comparison:
  await llm.complete(prompt, 'evolution_generate_from_seed', {
    onUsage: (usage) => { localRankingCost += usage.estimatedCostUsd; },
    evolutionInvocationId: ctx.invocationId,
  });

return {
  detail: {
    generation: { cost: localGenerationCost, ... },
    ranking: { cost: localRankingCost, ... },
  },
};
```

**Benefits:**
- Exact per-phase cost attribution, no racing deltas
- Works under any degree of parallelism
- Failed agents still report accurate partial costs (whatever accumulated before the error)
- `evolutionInvocationId` gets persisted to `llmCallTracking`, linking every LLM call to its agent

**`costTracker` still exists** for global budget enforcement via `reserve()` — that's orthogonal to attribution.

- [x] Update `generateFromSeedArticle` to use `onUsage` for per-phase cost
- [x] Update `SwissRankingAgent` to use `onUsage` for ranking cost
- [x] Update `MergeRatingsAgent` — cost is always $0, no LLM calls
- [x] Pass `evolutionInvocationId: ctx.invocationId` on every LLM call

### C. Extend `evolution_arena_comparisons` for in-run match persistence

**Why extend instead of creating a new table:** The `evolution_arena_comparisons` table already exists and is used for cross-run arena comparisons. Creating a parallel `evolution_matches` table would fragment the match data across two tables. Extending the existing table keeps all matches in one place.

**Current table columns** (from `evolution_arena_comparisons`):
- `id`, `prompt_id` (required), `entry_a`, `entry_b`, `winner`, `confidence`, `run_id`, `status`, `created_at`

**Schema changes:**

```sql
-- Make prompt_id nullable so in-run matches without an arena prompt can be persisted
ALTER TABLE evolution_arena_comparisons
  ALTER COLUMN prompt_id DROP NOT NULL;

-- Add in-run observability columns
ALTER TABLE evolution_arena_comparisons
  ADD COLUMN iteration INT,
  ADD COLUMN invocation_id UUID REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL,

  -- Rating state before each match (captured by merge agent)
  ADD COLUMN entry_a_mu_before NUMERIC,
  ADD COLUMN entry_a_sigma_before NUMERIC,
  ADD COLUMN entry_b_mu_before NUMERIC,
  ADD COLUMN entry_b_sigma_before NUMERIC,

  -- Rating state after each match (captured by merge agent)
  ADD COLUMN entry_a_mu_after NUMERIC,
  ADD COLUMN entry_a_sigma_after NUMERIC,
  ADD COLUMN entry_b_mu_after NUMERIC,
  ADD COLUMN entry_b_sigma_after NUMERIC;

CREATE INDEX idx_arena_comparisons_run_iteration
  ON evolution_arena_comparisons (run_id, iteration);
CREATE INDEX idx_arena_comparisons_invocation
  ON evolution_arena_comparisons (invocation_id);
```

**Not added:**
- `judge_model` — already on `evolution_runs`, no need to duplicate per match
- `merge_apply_order` — recoverable via RNG seed (see section E); adding a column is overkill

**Write path:** The `MergeRatingsAgent` writes one row per match as it applies updates in the shuffled order. Single bulk insert per merge invocation.

**Backward compatibility:**
- Existing `sync_to_arena` RPC keeps working — it just writes the old columns; new columns default to NULL
- Existing arena leaderboard queries filter by `prompt_id IS NOT NULL` (implicit — they join to prompts)
- `VariantEntity.delete` cascade still works (unchanged)

**Query patterns:**

```sql
-- All matches for a run, in rating-update order
SELECT * FROM evolution_arena_comparisons
WHERE run_id = $1
ORDER BY iteration, created_at;

-- All matches involving a specific variant
SELECT * FROM evolution_arena_comparisons
WHERE entry_a = $1 OR entry_b = $1;

-- Rating trajectory for a variant
SELECT
  iteration,
  CASE WHEN entry_a = $1 THEN entry_a_mu_after ELSE entry_b_mu_after END as mu_after,
  CASE WHEN entry_a = $1 THEN entry_a_sigma_after ELSE entry_b_sigma_after END as sigma_after
FROM evolution_arena_comparisons
WHERE entry_a = $1 OR entry_b = $1
ORDER BY iteration, created_at;

-- Cross-run arena leaderboard (existing, unchanged — filters null prompt_id)
SELECT * FROM evolution_arena_comparisons
WHERE prompt_id = $1;
```

**Tasks:**
- [x] Migration: `ALTER TABLE` statements above
- [x] Update `evolutionArenaComparisonInsertSchema` in `evolution/src/lib/schemas.ts` to make `prompt_id` nullable and add new columns
- [x] `MergeRatingsAgent.execute()` writes to `evolution_arena_comparisons` as part of applying each match
- [x] Variant detail admin UI gets a "Matches" tab showing all matches involving this variant, with mu/sigma trajectory
- [x] Invocation detail admin UI cross-references to matches via `invocation_id`

### D. Run-level error surface

**New fields on `evolution_runs`:**

```sql
ALTER TABLE evolution_runs
  ADD COLUMN error_code TEXT,           -- from taxonomy below
  ADD COLUMN error_message TEXT,        -- human-readable summary
  ADD COLUMN error_details JSONB,       -- structured detail (stack, context)
  ADD COLUMN failed_at_iteration INT,
  ADD COLUMN failed_at_invocation UUID REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL;
```

**Error code taxonomy:**

```typescript
type RunErrorCode =
  // Setup failures (before any work)
  | 'invalid_config'
  | 'missing_seed_article'
  | 'budget_too_small'

  // Generation failures
  | 'all_generation_failed'
  | 'generation_llm_error'

  // Ranking failures
  | 'swiss_all_pairs_failed'

  // Budget failures
  | 'budget_exceeded_during_generate'
  | 'budget_exceeded_during_swiss'
  | 'budget_exceeded_before_first_variant'

  // Orchestration failures
  | 'merge_agent_crashed'
  | 'invocation_row_write_failed'
  | 'dispatcher_unhandled_error'

  // External / infrastructure
  | 'killed_externally'
  | 'wall_clock_deadline_exceeded'
  | 'unhandled_error'
```

**Population:**
- Orchestrator's main loop is wrapped in `try/catch`
- `classifyError()` maps exceptions to the taxonomy
- `persistRunResults` writes the error fields along with the result
- Normal completion leaves all error fields `NULL`

**`status` column semantics:**
- `status = 'completed'` → `error_code` is NULL
- `status = 'failed'` → `error_code` is populated
- `status = 'killed'` → `error_code = 'killed_externally'` or `'wall_clock_deadline_exceeded'`

**Admin UI:**
- Run detail page: error banner at top when `error_code != NULL`, with link to failing invocation
- Run list: error column visible in failed-run rows
- Filter by error_code for debugging patterns

**Tasks:**
- [x] Migration: add columns
- [x] Update `evolutionRunFullDbSchema` to include error fields
- [x] Define `RunErrorCode` type in `evolution/src/lib/types.ts`
- [x] Implement `classifyError(e: unknown): RunErrorCode` in `evolution/src/lib/pipeline/classifyError.ts`
- [x] Wrap orchestrator loop in try/catch, set error fields on failure
- [x] Update `persistRunResults` to write error fields
- [x] Admin UI: add error banner to run detail page

### E. RNG seed for reproducibility

**Problem:** Fisher-Yates shuffle in merge agent, opponent selection tiebreaks, and strategy round-robin all introduce non-determinism. Two runs of the same pipeline with the same inputs can produce different outputs. There's no way to reproduce a specific failed run for debugging.

**Solution:** Capture a per-run seed and thread it through every source of randomness.

**New field on `evolution_runs`:**

```sql
ALTER TABLE evolution_runs
  ADD COLUMN random_seed BIGINT;
```

Populated on run creation (either user-provided for reproducing an earlier run, or auto-generated).

**New utility:** `evolution/src/lib/shared/seededRandom.ts`

```typescript
// Simple xoshiro256** or mulberry32 seeded PRNG
export class SeededRandom {
  constructor(seed: number | bigint) { ... }
  next(): number { ... }                 // [0, 1)
  nextInt(max: number): number { ... }   // [0, max)
  shuffle<T>(array: T[]): T[] { ... }    // Fisher-Yates in place
}

// Deterministic sub-seed derivation for parallel agents
export function deriveSeed(parentSeed: bigint, ...namespace: string[]): bigint {
  // Hash the parent seed with a namespace (e.g., "iter1-exec3")
  // Returns a deterministic derived seed
}
```

**Usage:**
- Orchestrator creates `const rng = new SeededRandom(run.random_seed)` at start
- Agents receive a derived sub-seed via `AgentContext`:
  ```typescript
  const agentCtx = {
    ...baseCtx,
    iteration,
    executionOrder,
    randomSeed: deriveSeed(run.random_seed, `iter${iteration}`, `exec${executionOrder}`)
  }
  ```
- Each agent creates its own `SeededRandom` from its sub-seed
- `MergeRatingsAgent` uses its sub-seed for the Fisher-Yates shuffle
- `generateFromSeedArticle` uses its sub-seed for opponent selection tiebreaks

**Why sub-seeds:** A single shared RNG would produce different outputs depending on which agent consumed bits first — non-deterministic under parallel execution. Deriving sub-seeds from the run seed + agent identity makes each agent fully deterministic regardless of dispatch timing.

**Reproducing a run:**
- Copy `run.random_seed` from a failed run
- Set it on a new run config
- Run the pipeline with the same inputs
- Same shuffle orders, same selections, same final ratings
- Caveat: LLM responses may still differ (temperature > 0), which is a separate concern

**Admin UI:**
- Run detail page shows `random_seed` as a copyable field
- "Reproduce this run" button that copies the seed and opens the create-run form pre-filled

**Tasks:**
- [x] Migration: add `random_seed` column
- [x] Create `seededRandom.ts` with `SeededRandom` class and `deriveSeed()` helper
- [x] Populate `random_seed` at run creation (in `ensureRunSetup` or wherever runs are created)
- [x] Update `AgentContext` to include `randomSeed: bigint`
- [x] `MergeRatingsAgent` uses the seed for Fisher-Yates
- [x] `generateFromSeedArticle` uses the seed for any tiebreaks in opponent selection
- [x] Admin UI: show seed on run detail page, add reproduce button
- [x] Test: two runs with the same seed produce identical outputs (when LLM responses are mocked)

### F. LLM prompts/responses — wire up existing infrastructure

**Good news:** `llmCallTracking` already exists and already captures `prompt`, `content` (response), `raw_api_response`, token counts, and cost. It even has an `evolution_invocation_id` FK column.

**What we need to do in the new agents:** Pass `ctx.invocationId` as `options.evolutionInvocationId` on every LLM call.

```typescript
await llm.complete(prompt, 'evolution_generate_from_seed', {
  evolutionInvocationId: ctx.invocationId,  // ← this is the only thing we need to add
  onUsage: (usage) => { localCost += usage.estimatedCostUsd; },
});
```

**Admin UI implications:**
- Variant detail page: new "LLM calls" tab showing all calls where `evolution_invocation_id = (any invocation involving this variant)`
- Match row in `evolution_arena_comparisons`: joins to `evolution_agent_invocations` → `llmCallTracking` to show the exact prompt/response that produced the comparison judgment
- Invocation detail page: "LLM calls" section showing prompts and responses per call

**No new tables, no new infrastructure.** Just wire up the existing FK.

**Tasks:**
- [x] `generateFromSeedArticle`: pass `evolutionInvocationId` on all LLM calls
- [x] `SwissRankingAgent`: pass `evolutionInvocationId` on all LLM calls
- [x] Admin UI: add LLM calls tab to variant detail, invocation detail, match detail

### G. Existing lifecycle integration

**Where the new code fits in `claimAndExecuteRun.ts`:**

```
claim_evolution_run RPC (existing, unchanged)
  ↓
ensureRunSetup (existing — extend to generate random_seed)
  ↓
startHeartbeat (existing, unchanged)
  ↓
runIterationLoop (REPLACED with new orchestrator-driven loop)
  ↓
persistRunResults (existing, extended with error fields + random_seed + snapshots + discarded variants)
  ↓
stopHeartbeat, finalize run status
```

**What stays unchanged:**

| Component | Status |
|-----------|--------|
| `claim_evolution_run` RPC (advisory lock + SKIP LOCKED) | Unchanged |
| Heartbeat interval (30s ping to `last_heartbeat`) | Unchanged |
| `isRunKilled()` DB polling for kill detection | Unchanged |
| Abort signal handling from parent process | Unchanged |
| Wall clock deadline handling | Unchanged |
| `createInvocation` / `updateInvocation` per-agent writes | Unchanged (Agent base class template) |
| Cost tracking via `V2CostTracker` | Unchanged (budget enforcement layer) |
| Concurrent run limit (`EVOLUTION_MAX_CONCURRENT_RUNS`) | Unchanged |
| Global spending gate (`LLMSpendingGate`) | Unchanged |
| LLM semaphore (`LLMSemaphore`) | Unchanged |

**What changes:**

| Component | Change |
|-----------|--------|
| `runIterationLoop` function | Replaced with orchestrator-driven version (new `nextIteration()` logic) |
| `persistRunResults` | Extended to write snapshots, error fields, seed, discarded variants |
| `ensureRunSetup` | Extended to generate and persist `random_seed` |
| `evolution_runs` schema | +5 error fields, +random_seed, +iteration_snapshots, +5 more |
| `evolution_variants` schema | +persisted boolean |
| `evolution_arena_comparisons` schema | +9 new columns, nullable prompt_id |
| `evolution_agent_invocations` | Unchanged structure; new agent types populate it |
| Agent class files | GenerationAgent.ts, RankingAgent.ts removed; three new agent files added |
| `generateVariants.ts`, `rankVariants.ts` | Removed; logic moved to new agents |

**Kill detection placement:**

The orchestrator's `nextIteration()` function checks kill signals at iteration boundaries (same pattern as today's loop checking `isRunKilled()` at iteration starts):

```typescript
function nextIteration(): 'generate' | 'swiss' | 'done' {
  // Check kill signals BEFORE dispatching next iteration
  if (options?.signal?.aborted) { exitReason = 'killed'; return 'done'; }
  if (await isRunKilled(db, runId)) { exitReason = 'killed'; return 'done'; }
  if (options?.deadlineMs && Date.now() >= options.deadlineMs) { exitReason = 'time_limit'; return 'done'; }

  // Then the normal decision logic
  if (state.iterationCount === 0) return 'generate';
  if (budgetExhausted) return 'done';
  // ...
}
```

Kill doesn't interrupt in-flight agents (same as today). A killed run just exits cleanly at the next iteration boundary. If an abort signal is set mid-iteration, in-flight work completes normally and is merged normally — the exit happens at the next `nextIteration()` call.

**Invocation write timing:**

The existing `Agent.run()` template method writes `createInvocation()` BEFORE calling `execute()` and `updateInvocation()` AFTER. This is per-invocation, not per-run — so every agent that starts has a row in `evolution_agent_invocations` with whatever cost/status it had when it ran. **Even on run failure, individual agent rows are persisted.**

**Snapshot write timing:**

Snapshots are built in memory during the run and persisted once at finalization (in `persistRunResults`). Since there's no resume support, losing snapshots on crash matches current behavior for any partial state. No need for incremental writes.

**Error propagation:**

```typescript
// In claimAndExecuteRun.ts
try {
  await ensureRunSetup(...);
  const iterationResult = await runIterationLoop(...);
  await persistRunResults({
    ...iterationResult,
    error_code: null,
    status: 'completed',
  });
} catch (e) {
  const errorCode = classifyError(e);
  const errorMessage = e instanceof Error ? e.message : String(e);
  await persistRunResults({
    // partial state from whatever we captured
    error_code: errorCode,
    error_message: errorMessage,
    error_details: { stack: e instanceof Error ? e.stack : undefined, ... },
    failed_at_iteration: currentIteration,
    failed_at_invocation: lastInvocationId,
    status: 'failed',
  });
}
```

**Tasks:**
- [x] Update `claimAndExecuteRun.ts` to populate `random_seed` in `ensureRunSetup`
- [x] Update `claimAndExecuteRun.ts` error handling to capture structured error info
- [x] Update `runIterationLoop.ts` to the new orchestrator-driven loop (Phase 5)
- [x] Update `persistRunResults.ts` to write new fields (error, seed, snapshots, discarded variants, persisted flags)
- [x] Verify heartbeat, kill detection, deadline handling still work with the new loop
- [x] Test: a killed run exits cleanly at the next iteration boundary
- [x] Test: a run that crashes mid-iteration has correct invocation rows persisted

## Critical Fixes — from plan-review iteration 1

Additional fixes identified during multi-agent plan review. Rollout concerns (feature flags, shadow mode, migration ordering, staged rollout) are explicitly deferred to implementation-time decisions and not addressed here.

### H. Thread `invocationId` into `AgentContext`

**Problem:** Gaps B and F require agents to call `callLLM(..., { evolutionInvocationId: ctx.invocationId, onUsage: ... })`, but `Agent.run()` in `evolution/src/lib/core/Agent.ts:19` creates `invocationId` as a LOCAL variable and never threads it into `execute()`. Without a fix, every LLM call from the new agents will have `evolutionInvocationId: undefined`, breaking `llmCallTracking` joins, per-invocation cost attribution, and the Matches/LLM-calls admin tabs.

**Fix:** Extend `AgentContext` to carry `invocationId`, and set it in `Agent.run()` after `createInvocation()` returns, before calling `execute()`:

```typescript
// evolution/src/lib/core/types.ts
export interface AgentContext {
  db: SupabaseClient;
  runId: string;
  iteration: number;
  executionOrder: number;
  invocationId: string;          // NEW — set by Agent.run() before execute()
  randomSeed: bigint;            // NEW — from Gap E
  logger: EntityLogger;
  costTracker: V2CostTracker;
  config: EvolutionConfig;
}

// evolution/src/lib/core/Agent.ts
async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>> {
  const invocationId = await createInvocation(
    ctx.db, ctx.runId, ctx.iteration, this.name, ctx.executionOrder,
  );

  // Attach invocationId to ctx before passing to execute()
  const extendedCtx: AgentContext = { ...ctx, invocationId: invocationId ?? '' };

  // ... rest of run() uses extendedCtx
  const output = await this.execute(input, extendedCtx);
  // ...
}
```

- [x] Update `AgentContext` type to include `invocationId: string`
- [x] Update `Agent.run()` to populate `invocationId` in extendedCtx before calling `execute()`
- [x] Update existing GenerationAgent and RankingAgent tests for the new field (they don't read it; tests just need to pass the new type)
- [x] All new agents (generateFromSeedArticle, SwissRankingAgent, MergeRatingsAgent) use `ctx.invocationId` when calling `callLLM`

### I. `error_message` column already exists — avoid collision

**Problem:** `evolution_runs.error_message` is already a column today (populated by `markRunFailed` in `claimAndExecuteRun.ts:72`). The planned `ADD COLUMN error_message TEXT` migration would fail or be a no-op.

**Fix:** Only add the NEW error fields. Don't re-add `error_message`:

```sql
ALTER TABLE evolution_runs
  ADD COLUMN error_code TEXT,
  -- error_message already exists — skipped
  ADD COLUMN error_details JSONB,
  ADD COLUMN failed_at_iteration INT,
  ADD COLUMN failed_at_invocation UUID REFERENCES evolution_agent_invocations(id) ON DELETE SET NULL;
```

**Reconcile with `markRunFailed`:** The existing code path in `claimAndExecuteRun.ts:72` writes `error_message` with a short description. Update it to also populate `error_code = 'unhandled_error'` (or whatever is appropriate) so existing failure paths are consistent with the new taxonomy. Both the existing `markRunFailed` path and the new `persistRunResults` error path set the same columns — ensure they don't race by making `markRunFailed` the fallback only if `persistRunResults` hasn't already written.

- [x] Migration: skip `error_message`, add only the 4 new columns
- [x] Update `markRunFailed` to also set `error_code`
- [x] Ensure error-writing paths don't race (persistRunResults writes first on normal error flow; markRunFailed only fires on exceptions before persistRunResults runs)

### J. Arena comparisons double-write with `sync_to_arena`

**Problem:** `sync_to_arena` RPC in `supabase/migrations/20260322000006_evolution_fresh_schema.sql:285` inserts matches from `matchHistory` into `evolution_arena_comparisons` at run finalization. Gap C's `MergeRatingsAgent` ALSO writes to the same table. Result: every match is inserted twice — once with `prompt_id = NULL` (from merge agent) and once with `prompt_id = run.prompt_id` (from sync_to_arena).

**Fix:** Move arena comparison row writes ENTIRELY to `MergeRatingsAgent`. Update `sync_to_arena` RPC to skip the arena comparison insert loop — it should only handle the variant sync (setting `synced_to_arena = true` on `evolution_variants`). The rows already exist from the merge agent's writes; `sync_to_arena` just needs to UPDATE them to backfill `prompt_id` for runs that sync to arena.

```sql
-- New migration: modify sync_to_arena to UPDATE prompt_id instead of INSERT matches
CREATE OR REPLACE FUNCTION sync_to_arena(
  p_run_id UUID,
  p_prompt_id UUID,
  p_entries JSONB,
  p_matches JSONB  -- now unused, kept for compat; will be removed in follow-up
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Sync variants (existing logic, unchanged)
  -- ... UPDATE evolution_variants SET synced_to_arena = true, ... ...

  -- Backfill prompt_id for arena_comparisons rows that were written by MergeRatingsAgent
  UPDATE evolution_arena_comparisons
  SET prompt_id = p_prompt_id
  WHERE run_id = p_run_id AND prompt_id IS NULL;
END;
$$;
```

- [x] New migration: redefine `sync_to_arena` to UPDATE arena_comparisons.prompt_id instead of INSERT matches
- [x] `MergeRatingsAgent` is the sole writer of arena_comparison rows
- [x] Verify arena leaderboard query still works (it filters `prompt_id IS NOT NULL` implicitly via joins — rows with null prompt_id are hidden until sync_to_arena runs)
- [x] Test: run with prompt_id → matches have prompt_id after sync. Run without prompt_id → matches have null prompt_id forever (arena invisible, in-run queries still work)

### K. `persisted` backfill for historical variants

**Problem:** The `persisted` migration sets default `false`, meaning every historical variant becomes "discarded" instantly. Once metric queries add `.eq('persisted', true)`, all pre-change runs vanish from the admin UI and metrics computation.

**Fix:** Backfill `persisted = true` for all historical variants in the same migration:

```sql
ALTER TABLE evolution_variants
  ADD COLUMN persisted BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every variant from a pre-change run is implicitly "persisted"
-- (the old pipeline had no discard rule, so every variant was in the final pool)
UPDATE evolution_variants
  SET persisted = true
  WHERE created_at < (SELECT now());  -- everything existing at migration time
```

For safety, also backfill runs in any terminal state just in case the query above is slow or interrupted:

```sql
UPDATE evolution_variants
  SET persisted = true
  WHERE run_id IN (
    SELECT id FROM evolution_runs
    WHERE status IN ('completed', 'running', 'failed', 'killed')
  )
  AND persisted = false;
```

- [x] Migration includes backfill UPDATE in the same transaction as the ALTER TABLE
- [x] After backfill, `persisted = false` is only for variants created AFTER the migration AND discarded by their generateFromSeedArticle agent
- [x] Test: migration runs → historical runs still visible in admin UI with all variants marked persisted

### L. Keep legacy execution_detail schemas for historical rendering

**Problem:** The plan deletes `GenerationAgent.ts`, `RankingAgent.ts`, etc. But `evolution_agent_invocations` rows for historical runs have `agent_name = 'generation'` or `'ranking'` with execution_detail matching the OLD schemas. If we delete the schemas, the admin invocation detail view (and `recomputeInvocationMetrics`) crashes on historical data.

**Fix:** Keep the old execution detail schemas in a new legacy module. The admin UI checks `agent_name` and picks the appropriate schema. Old agent CLASS files (GenerationAgent.ts, RankingAgent.ts) can still be deleted — we just keep the schemas for rendering.

```typescript
// evolution/src/lib/legacy-schemas.ts
import { generationExecutionDetailSchema, rankingExecutionDetailSchema } from '...';

export const legacyExecutionDetailSchemas = {
  generation: generationExecutionDetailSchema,
  ranking: rankingExecutionDetailSchema,
} as const;

// Admin UI: detailViewRouter for agent_name → schema
const SCHEMA_BY_AGENT_NAME = {
  generate_from_seed_article: generateFromSeedExecutionDetailSchema,
  swiss_ranking: swissRankingExecutionDetailSchema,
  merge_ratings: mergeRatingsExecutionDetailSchema,
  // Legacy
  generation: legacyExecutionDetailSchemas.generation,
  ranking: legacyExecutionDetailSchemas.ranking,
};
```

- [x] Extract `generationExecutionDetailSchema` and `rankingExecutionDetailSchema` from the current schema files BEFORE deleting the agent files
- [x] Create `evolution/src/lib/legacy-schemas.ts` that re-exports them
- [x] Update admin invocation detail view (and any other detail renderer) to look up schema by `agent_name` via a router map that includes both new and legacy schemas
- [x] `recomputeInvocationMetrics` similarly uses the legacy schemas for old rows
- [x] Safe to delete `GenerationAgent.ts`, `RankingAgent.ts`, `rankVariants.ts`, `generateVariants.ts` CLASS/helper files — their SCHEMAS live on in `legacy-schemas.ts`

### M. Config compatibility for `iterations` field

**Problem:** The plan "removes `iterations` from required config." But `validateConfig()` in `runIterationLoop.ts:19` hard-throws when iterations is missing or invalid. Every existing test and run sets iterations. Deleting the field breaks backward compatibility.

**Fix:** Keep `iterations` in the config schema as an optional, deprecated field. Accept it but don't use it (the new orchestrator's `nextIteration()` decides when to stop). Add `numVariants` as a new field with default 9. Update `validateConfig()` to:
- Accept either or both
- Log a deprecation warning if `iterations` is set but `numVariants` isn't
- Throw only if neither is set AND numVariants has no default

```typescript
// EvolutionConfig schema update
export const evolutionConfigSchema = z.object({
  // ...existing fields...
  iterations: z.number().int().min(1).max(100).optional(),  // DEPRECATED, ignored by new orchestrator
  numVariants: z.number().int().min(1).max(100).default(9),  // NEW
  strategies: z.array(z.string()).default(['structural_transform', 'lexical_simplify', 'grounding_enhance']),
  // ...
});
```

- [x] Keep `iterations` as optional in schema (don't remove)
- [x] Add `numVariants` with default 9
- [x] Add `strategies` with sensible default
- [x] `validateConfig()` only throws on genuinely invalid values
- [x] Deprecation log if `iterations` is set
- [x] Existing tests that set `iterations` keep passing
- [x] Existing runs in the DB with `iterations` in their config continue to work

### N. Deep-clone of Rating objects (not just the Map)

**Problem:** The plan's `new Map(input.initialRatings)` is a SHALLOW clone — both maps reference the same Rating `{mu, sigma}` objects. If `updateRating()` from OpenSkill ever mutates in place instead of returning new objects, one agent's local mutation corrupts every other agent's "local" state. The plan never verifies OpenSkill's mutation semantics.

**Fix:** Always deep-clone Rating objects when cloning the ratings Map. Specify this explicitly in `generateFromSeedArticle.execute()`:

```typescript
// Deep-clone ratings — Rating values are objects, shallow Map clone isn't enough
const localRatings = new Map<string, Rating>(
  Array.from(input.initialRatings.entries()).map(([id, rating]) => [
    id,
    { mu: rating.mu, sigma: rating.sigma }  // explicit copy of the Rating object
  ])
);
```

This is a ~3 line change but must be in the spec so implementers don't accidentally write `new Map(input.initialRatings)`.

**Verification task:** Add a test that asserts OpenSkill's `rate()` returns new objects rather than mutating. If it ever changes, this test catches it immediately.

- [x] `generateFromSeedArticle.execute()`: deep-clone Rating objects when building localRatings
- [x] Deep-clone pattern also applied in any other place that clones ratings maps
- [x] Add test: "OpenSkill rate() returns new Rating objects without mutating inputs"
- [x] Add test: "agent's local ratings changes do not affect input.initialRatings"

### O. Budget `reserve()` atomicity under burst dispatch

**Problem:** The plan asserts `V2CostTracker.reserve()` is "synchronous and parallel-safe" but never verifies this is true under burst dispatch (N parallel agents all calling `reserve()` during iteration start). If there's any `await` inside reserve() between the budget-check and the commit, budget can be over-committed.

**Fix:** Explicitly verify and document that `reserve()` is a single synchronous block in the existing `V2CostTracker` implementation:

- [x] Audit `evolution/src/lib/pipeline/infra/trackBudget.ts:reserve()` to confirm it is purely synchronous (no `await`, no `Promise`, no setTimeout)
- [x] Add a JSDoc comment in trackBudget.ts asserting this invariant
- [x] Add a unit test: "reserve() is synchronous — 100 parallel calls never over-commit the budget"
- [x] If the audit finds any async operation, fix it before proceeding with Phase 1

### P. Shared cache in-flight dedup (optional, small impact)

**Problem:** The `ComparisonCache` (order-invariant keyed) is shared across all agents. Two parallel agents requesting the same comparison simultaneously both miss the cache and both call the LLM. Cache keys are order-invariant so the second one eventually finds the first one's result, but the duplicate LLM call already happened.

**Fix (lightweight):** Accept the small duplication cost for now. The probability of two parallel agents requesting the exact same text pair is very low (only if cross-agent variant IDs match up — which shouldn't happen since each agent has its own variant). Document the tradeoff.

**Fix (thorough):** Add an in-flight promise map to the cache:

```typescript
interface ComparisonCache {
  get(...): ComparisonResult | undefined;
  set(...): void;
  inFlight: Map<string, Promise<ComparisonResult>>;  // NEW

  // compareWithBiasMitigation wraps cache access:
  async getOrCompute(key: string, compute: () => Promise<ComparisonResult>): Promise<ComparisonResult> {
    const cached = cache.get(key);
    if (cached) return cached;

    const inFlight = this.inFlight.get(key);
    if (inFlight) return await inFlight;  // dedupe

    const promise = compute();
    this.inFlight.set(key, promise);
    try {
      const result = await promise;
      cache.set(key, result);
      return result;
    } finally {
      this.inFlight.delete(key);
    }
  }
}
```

**Decision:** Start with the lightweight fix (accept dedup). If we observe duplicate LLM calls in production metrics, implement the thorough fix. Add a metric to count cache misses vs in-flight dedupes.

- [x] Add a log at debug level when cache misses happen during parallel execution
- [x] Add a metric: `cacheConcurrentMiss` — counts how often two agents both miss the same key within a short window
- [x] If the metric shows meaningful duplicate LLM spend, implement in-flight dedup in a follow-up

### Q. Concurrency test for shared cache

Required test that was missing from Phase 8:

- [x] `computeRatings.test.ts`: "concurrent `compareWithBiasMitigation` calls for the same pair return consistent results" — launch N=20 concurrent `getOrCompute` promises for the same input, assert all return the same result. Does not require that LLM is only called once (that's the Gap P decision), just that results are consistent.

## Review & Discussion

### /plan-review results

**Iteration 1** (initial review):

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | 4/5 | 3 gaps |
| Architecture & Integration | 3/5 | 6 gaps |
| Testing & CI/CD | 2/5 | 6 gaps |

Total: 15 critical gaps. Rollout concerns (5 gaps) deferred to implementation-time decisions per user direction. Remaining 10 correctness/integration/verification gaps addressed in "Critical Fixes — from plan-review iteration 1" section (H through Q).

**Iteration 2** (after fixes):

| Perspective | Score | Critical Gaps |
|-------------|-------|---------------|
| Security & Technical | **5/5** | 0 |
| Architecture & Integration | **5/5** | 0 |
| Testing & CI/CD | **5/5** | 0 |

✅ **Consensus reached.** All reviewers voted 5/5 with zero blocking gaps remaining. The plan is ready to execute.

### Minor issues surfaced during review (non-blocking)

Several minor polish items were noted across reviews. These are not blockers but should be addressed during implementation:

- **invocationId empty-string sentinel** (Fix H): Using `invocationId ?? ''` when createInvocation returns null is a weak sentinel. Prefer either making `invocationId` nullable in AgentContext, or throwing if createInvocation returns null.
- **markRunFailed race** (Fix I): Make the UPDATE conditional (`WHERE error_code IS NULL`) to prove race-freedom rather than relying on prose description.
- **sync_to_arena parameter cleanup** (Fix J): Remove the now-unused `p_matches` parameter in a follow-up to avoid wasted JSONB serialization.
- **Rating deep-clone pattern** (Fix N): Use `{ ...rating }` rather than explicit field enumeration to handle OpenSkill variants carrying extra fields (`z`, `tau`, etc.).
- **bigint serialization** (Fix E): `randomSeed: bigint` in AgentContext needs a serializer for EntityLogger or any JSON path, since bigint isn't JSON-serializable by default.
- **Reserve→commit cycle audit** (Fix O): Extend the synchronicity invariant to cover the full reserve→commit cycle, not just reserve() in isolation.
- **Base-class AgentContext test** (Fix H): Add a direct test that `Agent.run()` threads `invocationId` from createInvocation into the extended ctx before calling execute().

### Deferred items (rollout concerns)

Per user direction, the following items were raised but are explicitly deferred to implementation-time decisions, not tracked as gaps in this plan:

- Feature flag for old vs new pipeline runtime toggle
- Shadow mode / A/B comparison against existing pipeline
- Migration ordering / staged rollout plan
- Rollback strategy (code revert + schema forward-compat)
- In-flight run handling during deployment
- Monitoring/alerting updates for new cost/latency characteristics
- Dashboard migration during transition
- End-to-end tests against real LLM providers in staging

These are legitimate concerns that should be addressed before production deployment, but do not block the plan itself from being considered implementation-ready.
