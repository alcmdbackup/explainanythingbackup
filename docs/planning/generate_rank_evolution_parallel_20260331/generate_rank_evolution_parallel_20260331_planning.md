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

**Note on eligibility:** The "top 15%" concept still exists — both the elimination check (`mu + 2σ < top15Cutoff`) inside the binary search and the iter 2 SwissRankingAgent's eligible-variants computation use it. But it is **never persisted as a separate DB column or table**. It's always computed on-the-fly from current ratings via `computeTop15Cutoff(ratings)`. There is no `eligible: boolean` field on variants, no `evolution_eligibility` table, nothing.

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
| **Budget** | `costTracker.reserve()` throws | Any time | Stop, final disposition decided after iter 1 merge by checking `mu < top15Cutoff` |

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

**Per-variant state** (rating, match count, eliminated) lives in in-memory maps and is recomputed each run from match data. **Per-invocation status** (how the agent exited) is persisted in the invocation row's `execution_detail` JSONB. **Discarded** has no explicit marker — the variant is just absent from the in-memory pool after iter 1 finishes.

The pool snapshot tab (Phase 8c) makes the implicit "discarded" state inspectable: the iter 2 snapshot lists which variants survived iter 1 and which were removed (with reason).

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
| **Iteration 1** (parallel agents, each running binary search) | End of iteration 1 (after all agents complete) | All match results from all agents |
| **Iteration 2** (Swiss agent, parallel pairs within rounds) | End of each Swiss round | Match results from that round's parallel pairs |

**Iteration 1 details (local mutation + randomized global merge):**
- Each `generateFromSeedArticle` agent operates on a LOCAL deep-clone of BOTH `pool` and `ratings`, captured at iteration start
- The agent generates one variant and adds it to its OWN local pool
- Within the agent's binary search loop:
  - Opponent selection uses local ratings (which mutate as the loop progresses)
  - Each comparison produces a match outcome
  - The raw match outcome is **appended to a `matchBuffer`** (for the global merge later)
  - The match is **also applied to local ratings** via `updateRating()` for agent-internal adaptation
- Stop condition checks (`elimination`, `convergence`) read the local ratings, which DO change as the loop progresses. This means iter 1 variants CAN exit via `converged` or `eliminated` (not just `no_more_opponents` or `budget`). Early termination saves budget when the variant clearly doesn't need more comparisons.
- Variants generated by other parallel agents are NOT visible — each agent sees only `[baseline + arena entries + its own variant]`
- After all agents settle: combine all generated variants into the global `pool`; collect ALL `matchBuffer`s (including from budget-status agents); concatenate, shuffle, **apply OpenSkill updates to the GLOBAL `ratings` map in randomized order**. The agent's local ratings are discarded — global ratings are the source of truth.
- Iteration 2 uses the merged global pool and ratings

**Two views of ratings — explicit separation:**

| | Local ratings (per-agent) | Global ratings (single source of truth) |
|---|---|---|
| Where | Inside `rankSingleVariant` for one agent | `ratings` Map in the iteration loop |
| Mutation | Updates after every comparison in the agent's loop | Updated once, in randomized order, at end of iter 1 |
| Order | Chronological (the order LLM returned results) | Random (Fisher-Yates shuffle of all matches) |
| Used for | Agent-internal decisions: opponent selection, stop condition checks (eliminated/converged) | Final pool state, discard rule, iter 2 input, run output |
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
- [ ] Add `matchBuffer: V2Match[]` to `generateFromSeedArticle` agent state (mutated during binary search)
- [ ] Each agent gets `localRatings = new Map(input.initialRatings)` at start
- [ ] Inside the binary-search loop, mutate `localRatings` after each comparison
- [ ] After loop exits, run `decideSurface()` using local ratings: returns true if we should surface, false if discard
- [ ] Agent returns `{ variant, status, surfaced, matches }` — matches array is empty if surfaced is false
- [ ] Orchestrator collects only `surfaced` agents' results for the merge
- [ ] MergeRatingsAgent receives only the surfaced agents' variants and matches
- [ ] Inside SwissRankingAgent: extract successful matches from `Promise.allSettled`, return raw buffer, do NOT apply updates
- [ ] MergeRatingsAgent: `mergeMatchesRandomly(allBuffers, globalRatings)` — Fisher-Yates shuffle, sequential apply
- [ ] Add metric: `surfacedCount` and `discardedCount` per generate iteration

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

- [ ] In iteration 1 loop: after end-of-iter-1 merge, iterate over all `'budget'`-status agent results
- [ ] For each, look up the variant's current global rating
- [ ] Compute current `top15Cutoff` from global ratings
- [ ] If `mu < top15Cutoff` (use bare mu, not mu+2σ): add to `discardedVariantIds`
- [ ] Otherwise: keep the variant (no action needed)
- [ ] After all checks: remove `discardedVariantIds` from `pool`, `ratings`, `matchCounts`
- [ ] In SwissRankingAgent: NO discard logic. Apply rating updates as normal, even on budget interruption.
- [ ] Log discarded variant count at warn level (iter 1 only)

## Options Considered
- [ ] **Option A: Sequential (status quo)** — No parallelism. Simple but slow.
- [ ] **Option B: Parallel Swiss only** — Lowest risk, ~20-30% ranking speedup.
- [ ] **Option C: Parallel triage + Swiss within current architecture** — Moderate refactor, preserves two-phase model.
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
    // merge at end of iter 1. The local ratings are discarded.
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

- [ ] Create `generateFromSeedArticle.ts` with the agent class
- [ ] Implement `runSingleGeneration(input, ctx)` — builds prompt for one strategy, calls LLM once, validates format, creates variant. Refactor existing `generateVariants()` strategy logic into a single-strategy helper
- [ ] Implement `rankSingleVariant(variant, pool, ratings, ...)` — see Phase 2
- [ ] Define `GenerateFromSeedInput`, `GenerateFromSeedOutput`, `GenerateFromSeedDetail` types
- [ ] Define Zod schema `generateFromSeedExecutionDetailSchema` with separate `generation` and `ranking` sections
- [ ] Cost tracking: read `costTracker.getTotalSpent()` before/after each phase to compute per-phase cost
- [ ] Execution detail: top-level cost is sum, sub-fields show generation/ranking breakdown
- [ ] Handle generation failure: if format validation fails or LLM errors, return `status: 'generation_failed'` and skip ranking

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

- [ ] Create `rankSingleVariant.ts`
- [ ] Implement `selectOpponent()` using `score = entropy(pWin) / sigma^SIGMA_WEIGHT` (see "Opponent selection: information-gain scoring" above)
- [ ] Implement the main ranking loop with all 4 stop conditions
- [ ] Compute `top15Cutoff` from local ratings, recomputed after each rating update inside the loop
- [ ] Reuse existing `BETA` constant (= 25 × √2) from computeRatings.ts for the Bradley-Terry formula
- [ ] Add new constants: `SIGMA_WEIGHT` (default 1.0), `TOP_PERCENTILE` (default 0.15), `ELIMINATION_CI` (default 2), `CONVERGENCE_THRESHOLD` (default 3.0). No `MIN_RANGE` or `RANGE_MULTIPLIER` — the scoring formula handles selection without a hard cutoff.
- [ ] Use existing `compareWithBiasMitigation()` for individual comparisons (2-pass A/B reversal already in place)
- [ ] **Two parallel paths after each comparison:**
  - Append the raw match outcome to `matchBuffer` (for the global merge later)
  - Call `updateRating()` / `updateDraw()` on the LOCAL ratings (for agent-internal decisions: opponent selection, stop checks)
- [ ] Return the `matchBuffer` in the `matches` field of the result. The local ratings are NOT returned — they're discarded.
- [ ] Return `status: 'budget'` if BudgetExceededError is caught — the agent will report this and the discard rule will remove the variant
- [ ] Track and return `comparisonsRun` count

**Top 15% cutoff:** Computed from local ratings, recomputed after each rating update inside the loop. The cutoff drives the elimination check; using stale values could keep weak variants alive longer than needed. Compute cost is negligible.

**Concurrency safety:** Multiple `rankSingleVariant()` calls run concurrently from different agents. Each call operates on its agent's LOCAL `pool`, `ratings`, and `matchCounts` (deep-cloned at iteration start). The local mutations are private to each agent — no shared mutable state across agents during iter 1, no race conditions. The `cache` is shared (order-invariant keys make this safe), but all other state is local per agent.

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
- [ ] Create `SwissRankingAgent.ts` with the agent class
- [ ] Copy `swissPairing()` function from old `rankVariants.ts` (don't reference, copy). Modify to drop the non-overlapping constraint.
- [ ] Define `SwissRankingInput`, `SwissRankingOutput`, `SwissRankingDetail` types
- [ ] Define Zod schema `swissRankingExecutionDetailSchema`
- [ ] Status values: `'success'`, `'budget'`, `'no_pairs'`
- [ ] Capture `matchesProduced` in execution detail (cap at 50, set `matchesTruncated` flag if more)
- [ ] Capture `pairsFailedBudget` and `pairsFailedOther` separately for visibility

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
- [ ] Create `MergeRatingsAgent.ts` with the agent class
- [ ] Implement `capturePoolState()` helper that snapshots variants + ratings into the detail format
- [ ] Implement `diffVariants()` helper that computes muDelta/sigmaDelta between before/after
- [ ] Use Fisher-Yates shuffle on the concatenated buffer
- [ ] Apply OpenSkill updates sequentially in shuffled order
- [ ] Cap `matchesApplied` array at 50 entries; track truncation
- [ ] Define Zod schema `mergeRatingsExecutionDetailSchema`
- [ ] Define `detailViewConfig` for admin UI rendering of before/matches/after sections
- [ ] No discard logic — discard happens inside `generateFromSeedArticle` agent before the merge

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

- [ ] Replace the sequential generate→rank loop with the orchestrator-driven iteration loop
- [ ] Implement `nextIteration()` decision function
- [ ] Generate iteration: dispatch N parallel `generateFromSeedArticle` agents + 1 `MergeRatingsAgent`
- [ ] Swiss iteration: dispatch 1 `SwissRankingAgent` + 1 `MergeRatingsAgent`
- [ ] Each agent gets its own AgentContext snapshot (frozen `iteration`, `executionOrder`) and assigned strategy
- [ ] Use `Promise.allSettled` so one failed generate agent doesn't cancel others
- [ ] Collect SURFACED agents' results for the merge (discarded variants contribute nothing)
- [ ] For swiss: dispatch merge UNCONDITIONALLY (even on budget) to ensure paid-for matches reach global
- [ ] Update `completedPairs` from each swiss iteration's results
- [ ] Add `numVariants: number` to `EvolutionConfig` (default 9)
- [ ] Add `strategies: string[]` to `EvolutionConfig` (default `['structural_transform', 'lexical_simplify', 'grounding_enhance']`)
- [ ] Remove `iterations` from required config (orchestrator decides when to stop)

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

- [ ] Replace mutable `agentCtx` pattern with per-call snapshots
- [ ] Add a test: "concurrent agents receive distinct context snapshots"

### Phase 7: Logging Under Concurrency

**Already safe:** EntityLogger is stateless. Concurrent agents produce interleaved but correctly tagged log rows.

Changes needed:
- [ ] Add `agentIndex: number` to log context for each parallel agent (1..N)
- [ ] Log per-variant ranking outcome (eliminated/converged/no_more_opponents/discarded) at info level
- [ ] Log opponent selection at debug level (which opponent picked, why)
- [ ] Log discarded variant count (from discard rule) at warn level

### Phase 8: Tests

#### Unit Tests — `generateFromSeedArticle` Agent
- [ ] "generates one variant with assigned strategy"
- [ ] "deep-clones initialPool, initialRatings, initialMatchCounts into local state"
- [ ] "adds generated variant to LOCAL pool (not the input pool)"
- [ ] "mutates local ratings during binary search (chronological order)"
- [ ] "input ratings/pool/matchCounts are NOT modified by the agent"
- [ ] "execution detail has separate generation and ranking sections"
- [ ] "cost tracking splits generation vs ranking"
- [ ] "returns status: 'budget' on BudgetExceededError"
- [ ] "returns status: 'generation_failed' on format validation failure"
- [ ] "agent decides surfaced=true for converged status"
- [ ] "agent decides surfaced=true for eliminated status"
- [ ] "agent decides surfaced=true for no_more_opponents status"
- [ ] "agent decides surfaced=true for budget when local mu >= local top15Cutoff"
- [ ] "agent decides surfaced=false for budget when local mu < local top15Cutoff"
- [ ] "discarded variant: matches array is empty in return value"
- [ ] "surfaced variant: matches array contains all buffered raw outcomes"

#### Unit Tests — Binary-Search Ranking (inside generateFromSeedArticle)
- [ ] "selectOpponent picks highest-score opponent (entropy / sigma)"
- [ ] "selectOpponent prefers close+reliable over close+noisy"
- [ ] "selectOpponent prefers close+reliable over far+precise"
- [ ] "selectOpponent picks far opponent when no closer ones available"
- [ ] "selectOpponent returns null when no uncompleted opponents exist"
- [ ] "selectOpponent excludes already-compared pairs"
- [ ] "selectOpponent uses default rating for unrated opponents"
- [ ] "rankSingleVariant exits on convergence (local sigma < threshold)"
- [ ] "rankSingleVariant exits on elimination via local top-15% CI"
- [ ] "rankSingleVariant exits on opponent exhaustion"
- [ ] "rankSingleVariant exits on budget exceeded with status: 'budget'"
- [ ] "concurrent rankSingleVariant calls (across agents) don't interfere — each has its own local state"

#### Unit Tests — `SwissRankingAgent` (one swiss iteration)
- [ ] "takes eligibleIds from input (computed by orchestrator)"
- [ ] "computes pairs from eligibleIds and completedPairs"
- [ ] "respects MAX_PAIRS_PER_ROUND cap on pair count"
- [ ] "pairs allow overlapping variants (a variant can appear in multiple pairs)"
- [ ] "pairs run in parallel via Promise.allSettled" — barrier pattern test
- [ ] "returns raw match buffer (no rating updates applied inside the agent)"
- [ ] "does NOT mutate input.ratings — only the merge agent does that"
- [ ] "returns status: 'no_pairs' when no candidates exist"
- [ ] "returns status: 'budget' when any pair fails with BudgetExceededError"
- [ ] "returns status: 'success' on full success"
- [ ] "execution detail records pairsConsidered, pairsSucceeded, pairsFailedBudget, pairsFailedOther"
- [ ] "matchesProduced array is capped at 50 entries with truncation flag"
- [ ] "successful matches are returned even when some pairs fail with budget"

#### Unit Tests — `MergeRatingsAgent`
- [ ] "concatenates match buffers from multiple agents into one list"
- [ ] "shuffles the concatenated list via Fisher-Yates"
- [ ] "applies OpenSkill updates to global ratings sequentially in shuffled order"
- [ ] "adds new variants from input.newVariants to global pool"
- [ ] "captures BEFORE state (poolSize, variants, top15Cutoff)"
- [ ] "captures AFTER state with muDelta and sigmaDelta per variant"
- [ ] "matchesApplied array capped at 50 with truncation flag"
- [ ] "matchesApplied entries include shuffledOrder index"
- [ ] "execution detail has iterationType: 'generate' or 'swiss'"
- [ ] "no discard logic — agent only adds and updates"
- [ ] "is reusable for both generate and swiss iterations"
- [ ] "handles empty matchBuffers gracefully (no-op merge)"
- [ ] "duration measured correctly"

#### Unit Tests — Bias Prevention
- [ ] "agent uses deep-cloned local snapshot of ratings (not input reference)"
- [ ] "agent mutates local ratings during binary search (chronological)"
- [ ] "agent's local rating mutation does NOT affect input ratings or other agents' state"
- [ ] "merge agent applies matches in shuffled (randomized) order"
- [ ] "global ratings after merge differ from any single agent's local ratings"
- [ ] "variant CAN exit via converged when local sigma drops below threshold"
- [ ] "variant CAN exit via eliminated when local mu+2σ drops below local top15Cutoff"
- [ ] "swiss iteration: matches buffered until merge agent applies them in shuffled order"
- [ ] "shuffleInPlace produces uniform distribution over many calls" — Fisher-Yates correctness

#### Unit Tests — Budget Safety (paid-for matches always applied)
- [ ] "swiss iteration with 5 pairs (3 success, 2 budget reject): all 3 successful matches reach the merge agent"
- [ ] "orchestrator dispatches merge agent UNCONDITIONALLY after swiss, even on budget"
- [ ] "orchestrator's budget exit check happens AFTER merge completes"
- [ ] "global ratings reflect all successful swiss matches even on partial failure"
- [ ] "generate iteration: when an agent discards (surfaced=false), its matches are NOT included in merge (intentional simplification)"
- [ ] "generate iteration: agents that surfaced contribute their full match buffer to the merge"

#### Unit Tests — Discard Rule (asymmetric: per-agent in generate, never in swiss)
- [ ] "generate agent: budget-status with mu < local top15Cutoff returns surfaced=false"
- [ ] "generate agent: budget-status with mu >= local top15Cutoff returns surfaced=true"
- [ ] "generate agent: discard uses bare mu, NOT mu+2σ"
- [ ] "generate agent: discard uses LOCAL ratings, not global"
- [ ] "generate agent: converged/eliminated/no_more_opponents always surface"
- [ ] "swiss agent: never makes a surface/discard decision (always returns the matches it completed)"
- [ ] "MergeRatingsAgent never discards (it's not its job)"
- [ ] "discarded variants: their matches are NOT in matchHistory"
- [ ] "discarded variants: their DB row exists with persisted=false"

#### Unit Tests — Iteration Loop (orchestrator-driven)
- [ ] "first iteration is always 'generate'"
- [ ] "after generate iteration, nextIteration() returns 'swiss' if pairs available and not converged"
- [ ] "nextIteration() returns 'done' when all eligible variants converged"
- [ ] "nextIteration() returns 'done' when no candidate pairs remain"
- [ ] "nextIteration() returns 'done' when budget exhausted"
- [ ] "iteration counter increments correctly across mixed generate + swiss iterations"
- [ ] "iteration column on invocation row matches the orchestrator iteration"
- [ ] "execution_order is monotonic across all agents in all iterations"
- [ ] "N generate agents dispatched in parallel within an iteration"
- [ ] "swiss iterations are sequential (one at a time)"
- [ ] "frozen snapshot: agent 1's variant is NOT visible to agent 2 during the same iteration"
- [ ] "frozen snapshot: each agent's local pool only contains the iteration-start state + its own variant"
- [ ] "BudgetExceededError in one generate agent doesn't cancel others"

#### Unit Tests — Agent infrastructure (Phase 8)
- [ ] "generateFromSeedArticle defines name, executionDetailSchema, invocationMetrics, detailViewConfig"
- [ ] "SwissRankingAgent defines name, executionDetailSchema, invocationMetrics, detailViewConfig"
- [ ] "execution detail validates against schema for both agents"
- [ ] "run-level totalGenerationCost and totalRankingCost computed correctly"
- [ ] "pool snapshot captured at start of iteration 1 (after baseline)"
- [ ] "pool snapshot captured at end of iteration 1 / start of iteration 2 (after iter 1 discard rule)"
- [ ] "pool snapshot captured at end of iteration 2 (after Swiss completes, before run finalization)"
- [ ] "no anchor references in selectOpponent or related code"
- [ ] "selectOpponent debug log includes all candidates with scores and selection reason"

#### Unit Tests — Per-invocation ranking detail
- [ ] "rankSingleVariant builds comparisons array with one entry per comparison"
- [ ] "each comparison entry includes opponent, score, pWin, before/after state"
- [ ] "comparisons array order is chronological (matches loop iteration order)"
- [ ] "initial state captures localPoolSize, localPoolVariantIds, initialTop15Cutoff"
- [ ] "final state captures stopReason, totalComparisons, finalLocalMu/Sigma"
- [ ] "execution detail validates against generateFromSeedRankingDetailSchema"
- [ ] "execution detail is persisted to evolution_agent_invocations.execution_detail JSONB"
- [ ] "debug log fired for each candidate considered in selectOpponent"
- [ ] "debug log fired after each comparison with state diff"
- [ ] "info log fired at binary search exit with final state"

#### Unit Tests — `persisted` flag
- [ ] "newly generated variant has persisted=false in DB"
- [ ] "variant with status converged is marked persisted=true at finalization"
- [ ] "variant with status eliminated is marked persisted=true at finalization"
- [ ] "variant with status no_more_opponents is marked persisted=true at finalization"
- [ ] "variant with status budget and mu ≥ top15Cutoff is marked persisted=true"
- [ ] "variant with status budget and mu < top15Cutoff is marked persisted=false (discarded)"
- [ ] "discarded variants are written to DB with persisted=false (not silently dropped)"
- [ ] "metric query filtering by persisted=true excludes discarded variants"
- [ ] "cost query NOT filtering by persisted includes discarded variant costs"

#### Unit Tests — Admin query defaults
- [ ] "getEvolutionVariantsAction defaults to persisted=true filter when includeDiscarded omitted"
- [ ] "getEvolutionVariantsAction returns all variants when includeDiscarded=true"
- [ ] "paginated variant list defaults to persisted=true filter"
- [ ] "paginated variant list shows discarded when includeDiscarded=true"
- [ ] "computeRunMetrics excludes discarded variants from totalVariants count"
- [ ] "computeRunMetrics excludes discarded variants from elo stats"
- [ ] "lineage action returns persisted field for each variant (no filter)"
- [ ] "variant detail action returns persisted field for any variant id"

#### Integration Tests
- [ ] End-to-end: full two-iteration run with 9 variants produces converged rankings
- [ ] Budget tracking accurate across both iterations
- [ ] Cold start handled: iter 1 variants exit with `no_more_opponents` but iter 2 refines them to convergence
- [ ] Warm pool: iter 2 converges quickly using established ratings
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
2. **After iter 1 discard rule:** Bulk UPDATE surviving pool variants to `persisted: true`
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
- [ ] DB migration: `ALTER TABLE evolution_variants ADD COLUMN persisted BOOLEAN NOT NULL DEFAULT false`
- [ ] In `runIterationLoop.ts`: after each generate iteration's agent results are collected, partition them into surfaced and discarded. Store discarded variants in a `discardedVariants: Variant[]` field on the EvolutionResult.
- [ ] In `persistRunResults.ts`:
  - For each variant in `localPool` (surfaced variants only): write with `persisted: true`
  - For each variant in `discardedVariants`: write with `persisted: false`. These rows preserve generation cost, text, and metadata for debugging.
  - This requires `EvolutionResult` to carry the discarded variants alongside the surviving pool
- [ ] Update `evolutionVariantInsertSchema` to include `persisted: boolean` field

**Default behavior for admin queries:** Admin variant tables and metric queries default to filtering by `persisted = true`. Admins can opt in to seeing all variants (including discarded) via a UI toggle. This makes the dashboard match what users care about by default — the variants that actually made it to the final pool — while keeping discarded variants accessible for debugging.

**Audit of existing metric/query call sites — what needs filtering:**

| File | Line | What it does | Filter `persisted = true`? |
|------|------|--------------|----------------------------|
| `lib/metrics/experimentMetrics.ts` | 270 (`computeRunMetrics`) | Reads variants for run-level elo stats (median, p90, max, totalVariants) | **YES (always)** — metrics never include discarded |
| `lib/metrics/recomputeMetrics.ts` | 61 (`recomputeRunEloMetrics`) | Rebuilds in-memory pool from DB to recompute finalization metrics | **YES (always)** — discarded variants shouldn't enter the recomputed pool |
| `lib/metrics/recomputeMetrics.ts` | 159 (`recomputeInvocationMetrics`) | Per-invocation metric recompute, builds pool from DB | **YES (always)** — same reason |
| `lib/metrics/computations/finalization.ts` | (multiple) | `computeWinnerElo`, `computeMedianElo`, `computeP90Elo`, `computeMaxElo` — work on `ctx.pool` (in-memory) | **NO** — in-memory pool has already had discarded variants removed by the iter 1 loop. No filter needed here. |
| `lib/pipeline/finalize/persistRunResults.ts` | 191 | UPSERT write path | **N/A** — this is the write, sets `persisted` flag for each variant |
| `lib/pipeline/setup/buildRunContext.ts` | 40 (`loadArenaEntries`) | Loads arena entries to seed initial pool | **NO** — already filters by `synced_to_arena = true`; only persisted variants ever get synced to arena |
| `services/evolutionActions.ts` | 347 (`getEvolutionVariantsAction`) | Admin variant list per run (run detail page) | **YES (default), with toggle** — default filter persisted=true, admin UI can disable filter to show all |
| `services/evolutionActions.ts` | 505 (paginated variant list) | Admin variants page with filters | **YES (default), with toggle** — default `persisted = true`, optional parameter to override |
| `services/variantDetailActions.ts` | 61, 103, 112, 139, 177, 191 | Single variant detail lookups (admin clicked into a specific variant) | **NO** — admin has explicit variant ID; never filter |
| `services/evolutionVisualizationActions.ts` | 224 (`getEvolutionRunLineageAction`) | Lineage graph rendering | **NO** — lineage shows genealogy; filtering would create orphan nodes. Show all with `persisted` field included so the renderer can visually mute discarded nodes. |
| `services/arenaActions.ts` | 82, 145, 168 | Arena queries | **NO** — already filter by `synced_to_arena = true` |
| `lib/pipeline/manageExperiments.ts` | 122-126 | Joins variants by `is_winner = true` | **NO** — winners are by definition persisted (they survived to be selected) |

**Implementation tasks for backend queries:**
- [ ] `experimentMetrics.ts:270` — add `.eq('persisted', true)` to the variants query in `computeRunMetrics`
- [ ] `recomputeMetrics.ts:61` — add `.eq('persisted', true)` to the variants query in `recomputeRunEloMetrics`
- [ ] `recomputeMetrics.ts:159` — add `.eq('persisted', true)` to the variants query in `recomputeInvocationMetrics`
- [ ] `evolutionActions.ts:347` — add `includeDiscarded?: boolean` parameter (default false). When false, add `.eq('persisted', true)`. Add `persisted` to SELECT fields.
- [ ] `evolutionActions.ts:505` — add `includeDiscarded?: boolean` parameter (default false). When false, add `.eq('persisted', true)`. Existing filter logic remains.
- [ ] `evolutionVisualizationActions.ts:224` — add `persisted` to SELECT fields (no filter, but renderer needs the flag)
- [ ] `variantDetailActions.ts` — add `persisted` to SELECT fields in `getVariantDetailAction` so the detail view shows the flag

**Implementation tasks for admin UI:**
- [ ] **Variant table column**: Add a `persisted` column to all variant table views in the evolution admin dashboard:
  - Run detail page → Variants tab
  - Variants list page (paginated)
  - Snapshot tab tables
- [ ] Column display: simple boolean badge — green ✓ for true, red ✗ for false. Or text "yes" / "no". Sortable.
- [ ] **"Include discarded" toggle**: Add a checkbox/switch above each variant table titled "Include discarded variants". Default OFF. When toggled, calls the action with `includeDiscarded: true`.
- [ ] **Variant detail page**: Show `persisted: true/false` prominently in the metadata section. Add a banner/badge if `persisted = false` indicating "Discarded variant — not included in run metrics".
- [ ] **Lineage graph**: Render `persisted = false` nodes with reduced opacity (e.g., 40%) and a dashed border to visually distinguish them.

**Pool snapshot tab integration:**
- [ ] Snapshot tab variant tables include the `persisted` column (joined from `evolution_variants` by snapshot variant ID)
- [ ] The discarded section uses the `discardedVariantIds` field from the snapshot, which correlates with `persisted = false` rows in the DB



#### 9a: All three agents fully integrated as proper Agent subclasses

`generateFromSeedArticle`, `SwissRankingAgent`, and `MergeRatingsAgent` all extend the `Agent<Input, Output, Detail>` base class. They must each define all standard agent properties:

- [ ] `name` constant (e.g., `'generate_from_seed_article'`, `'swiss_ranking'`, `'merge_ratings'`)
- [ ] `executionDetailSchema` Zod schema for validating execution detail
- [ ] `invocationMetrics: FinalizationMetricDef[]` — metrics computed per invocation at finalization (cost, comparisons run, status counts, matches merged, etc.)
- [ ] `detailViewConfig: DetailFieldDef[]` — admin UI configuration for displaying execution detail
- [ ] Register all three agents in any agent catalog/registry that exists
- [ ] Make sure invocation rows for all three agents show up in admin UI with appropriate detail views

#### 9b: Cost tracking (per-agent and aggregate)

Per-invocation breakdown (already in plan):
- [ ] `generationCost` and `rankingCost` separate fields in `generateFromSeedArticle` execution detail
- [ ] `rankingCost` in `SwissRankingAgent` execution detail (no generation cost)
- [ ] Top-level `cost_usd` is the sum (matches existing column semantics)

Run-level aggregates (new):
- [ ] At end of run, compute totals across all invocations: `totalGenerationCost`, `totalRankingCost` (iter 1 binary search + iter 2 Swiss)
- [ ] Store on the run row or in run-level metrics
- [ ] Display in admin UI run detail view

#### 9c: Pool snapshots at start of each iteration

We need to be able to inspect what the pool looked like at the start of iter 1 and iter 2 for debugging.

**Snapshot type (lean — IDs + dynamic state only, no duplicated variant text):**

```typescript
interface IterationSnapshot {
  iteration: number          // 1 or 2
  phase: 'start' | 'end'     // captured at iteration start or end
  capturedAt: string         // ISO timestamp
  poolVariantIds: string[]   // ordering matches pool array
  ratings: Record<string, { mu: number, sigma: number }>
  matchCounts: Record<string, number>
  discardedVariantIds?: string[]  // iter 1 end only — IDs removed by iter 1 discard rule
}
```

Variant text lives on `evolution_variants` rows; the snapshot stores only IDs. For 9 variants, snapshot size is ~1 KB. Two snapshots per run = ~2 KB.

**Storage: JSONB column on `evolution_runs`**

```sql
ALTER TABLE evolution_runs
ADD COLUMN iteration_snapshots JSONB DEFAULT '[]'::jsonb;
```

Stores an array of `IterationSnapshot` objects (typically 2 entries). Reasoning:
- 1-2 snapshots per run, always read with the run row
- No independent queries needed
- One ALTER TABLE migration vs new table + FK + RLS
- Write-once per iteration, never updated

**When snapshots are taken:**

| Snapshot | When | Captures |
|----------|------|----------|
| Iter 1 start | Before dispatching iter 1 agents (just baseline + initial pool) | Initial state |
| Iter 1 end / Iter 2 start | After iter 1 merge + discard rule applies, before dispatching swiss agent | Post-iter-1 state, including which variants were discarded |
| Iter 2 end | After SwissRankingAgent completes, before run finalization | Final state with refined ratings |

The iter 1 end snapshot and iter 2 start snapshot are the same moment in time (no gap between them), so we only store one snapshot for that boundary. Total snapshots per run: **3 logical states, 3 stored snapshot rows** (iter 1 start, iter 1 end ≡ iter 2 start, iter 2 end). Or **2 stored snapshot rows** if we treat iter 1 end and iter 2 start as a single snapshot tagged with both labels.

Iter 2's start snapshot is the most useful for debugging cold start. Iter 2's end snapshot is the most useful for verifying refinement results.

**Admin UI: new "Snapshots" tab on run detail page**

Each iteration snapshot renders as a formatted table. The tab shows iteration 1 start, iteration 1 end (= iteration 2 start), and iteration 2 end:

```
┌─ Snapshots ─────────────────────────────────────────────────┐
│                                                              │
│ Iteration 1 — start (2026-04-06 14:23:45)                   │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Variant ID    │ Strategy   │ mu     │ sigma │ matches │  │
│ │ baseline      │ baseline   │ 25.00  │ 8.33  │ 0       │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ Iteration 1 — end / Iteration 2 — start (2026-04-06 14:24:12)│
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Variant ID    │ Strategy   │ mu     │ sigma │ matches │  │
│ │ v1 (link)     │ struct     │ 31.20  │ 4.30  │ 6       │  │
│ │ v2 (link)     │ lex        │ 28.10  │ 5.50  │ 5       │  │
│ │ v3 (link)     │ ground     │ 26.80  │ 6.20  │ 4       │  │
│ │ baseline      │ baseline   │ 22.45  │ 5.12  │ 4       │  │
│ │ ...                                                    │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ Discarded after iter 1 (1 variant):                          │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Variant ID    │ mu     │ Reason                       │  │
│ │ v7 (link)     │ 18.20  │ budget interrupted, mu < cutoff│  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
│ Iteration 2 — end (2026-04-06 14:26:48)                     │
│ ┌────────────────────────────────────────────────────────┐  │
│ │ Variant ID    │ Strategy   │ mu     │ sigma │ matches │  │
│ │ v1 (link)     │ struct     │ 33.10  │ 2.80  │ 11      │  │
│ │ v2 (link)     │ lex        │ 29.50  │ 2.95  │ 10      │  │
│ │ v3 (link)     │ ground     │ 27.20  │ 3.10  │ 9       │  │
│ │ baseline      │ baseline   │ 21.80  │ 4.50  │ 5       │  │
│ │ ...                                                    │  │
│ └────────────────────────────────────────────────────────┘  │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**Table features:**
- Variant ID is a link to the variant detail page
- Default sort: by mu descending
- Click column header to re-sort by mu, sigma, or matches
- Strategy column joined from `evolution_variants` (since snapshot only stores IDs)
- Discarded variants shown in a separate section below the iter 2 table with reason

**Implementation:**
- [ ] DB migration: `ALTER TABLE evolution_runs ADD COLUMN iteration_snapshots JSONB DEFAULT '[]'::jsonb`
- [ ] Define `iterationSnapshotSchema` Zod schema (includes `phase: 'start' | 'end'`)
- [ ] In `runIterationLoop.ts`: helper `recordSnapshot(iteration, phase, pool, ratings, matchCounts, options)` that builds the snapshot object and pushes to an in-memory array
- [ ] Call `recordSnapshot(1, 'start', ...)` before dispatching iter 1 agents
- [ ] Call `recordSnapshot(1, 'end', ..., { discardedVariantIds })` after iter 1 merge + discard rule (this is also iter 2 start)
- [ ] Call `recordSnapshot(2, 'end', ...)` after SwissRankingAgent completes
- [ ] Persist all snapshots to the run row at run finalization (single UPDATE, not per-iteration)
- [ ] Server action: `getRunSnapshotsAction(runId): Promise<IterationSnapshot[]>` — joins snapshot variant IDs to `evolution_variants` to fetch strategy and other display fields
- [ ] Frontend: new `<SnapshotsTab>` component, registered in run detail page tab list
- [ ] Build sortable table component (or reuse existing one if `EntityListPage` patterns apply)
- [ ] Variant IDs render as `<Link href="/admin/variants/[id]">` with truncated UUID display
- [ ] Discarded variants section: shown only on iter 2 snapshot if `discardedVariantIds` is non-empty

#### 9d: Remove "anchor" concept entirely

The current `rankVariants.ts` has an "anchor" concept used in stratified opponent selection (low-sigma variants designated as anchors). Our new opponent selection formula doesn't need this — the formula picks low-sigma opponents naturally.

- [ ] Search the codebase for `anchor` references in evolution code
- [ ] Remove anchor selection logic from any function we keep
- [ ] Remove anchor display elements from admin UI (likely in `LogsTab`, `RankingDetailView`, or similar)
- [ ] Remove any anchor-related fields from execution details (e.g., `lowSigmaOpponentsCount`)
- [ ] Remove anchor-related metrics
- [ ] Update doc references

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
- [ ] Define `generateFromSeedRankingDetailSchema` Zod schema with all fields above
- [ ] In `rankSingleVariant`, build the `comparisons` array as the loop runs (capture before/after state for each)
- [ ] Capture initial state (poolSize, top15Cutoff, variant ids) at loop start
- [ ] Capture final state (stopReason, totalComparisons, finalMu, finalSigma) at loop exit
- [ ] Return the detail object alongside the matchBuffer
- [ ] In `generateFromSeedArticle.execute()`, embed the ranking detail in `execution_detail.ranking`
- [ ] Add debug-level logs at the three points above (`Selecting opponent`, `Comparison complete`, `Binary search exit`)
- [ ] Use structured fields in log context (not concatenated strings) for filterable queries
- [ ] At high pool sizes (>50 candidates), sample candidate logging (e.g., top 10 by score) to avoid log bloat
- [ ] Update `detailViewConfig` so admin UI renders the comparisons array as a sortable table

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
- [ ] Add `numVariants` and `strategies` to run-level config logging
- [ ] Add per-agent fields to invocation execution detail: `strategy`, `status`, `comparisonsRun`
- [ ] Run-level aggregates: count of converged/eliminated/no_more_opponents/budget across all iter 1 agents
- [ ] Run-level aggregates: total Swiss comparisons, Swiss exit reason, Swiss rounds run (from iter 2 invocation detail)

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
- `evolution/src/lib/pipeline/loop/shuffleInPlace.ts` — Fisher-Yates helper for bias prevention

### Modified Files
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` — Orchestrator-driven iteration loop, `nextIteration()` decision, frozen snapshots per agent, pool snapshots, cost aggregation
- `evolution/src/lib/schemas.ts` — `generateFromSeedExecutionDetailSchema`, `swissRankingExecutionDetailSchema`, `mergeRatingsExecutionDetailSchema`, `numVariants` and `strategies` config fields
- `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — Update tests for iteration model
- `evolution/src/lib/pipeline/finalize/persistRunResults.ts` — Write surfaced and discarded variants with appropriate `persisted` flag
- Admin UI files referencing "anchor" — remove anchor display and metrics (search for `anchor` in `evolution/src/components/`)
- Admin UI variant table components — add `persisted` column and "Include discarded" toggle (run detail Variants tab, paginated variant list, snapshot tab)
- Admin UI variant detail page — add `persisted` badge/banner
- Admin UI lineage graph component — render `persisted = false` nodes with reduced opacity and dashed border
- Admin UI invocation detail page — custom detailViewConfig for each of the three new agent types (generateFromSeedArticle, SwissRankingAgent, MergeRatingsAgent)
- DB migration: add `iteration_snapshots` JSONB column to `evolution_runs`
- DB migration: add `persisted` BOOLEAN column to `evolution_variants` (default false)
- Backend services: update `getEvolutionVariantsAction`, paginated variants action, `getVariantDetailAction`, `getEvolutionRunLineageAction` to add `persisted` to selects and add `includeDiscarded` parameter where needed

### Files to Remove
- `evolution/src/lib/core/agents/GenerationAgent.ts` — Replaced by generateFromSeedArticle
- `evolution/src/lib/core/agents/RankingAgent.ts` — Replaced by SwissRankingAgent + MergeRatingsAgent
- `evolution/src/lib/pipeline/loop/rankVariants.ts` — Replaced by rankSingleVariant + swissPairing helpers
- `evolution/src/lib/pipeline/loop/generateVariants.ts` — Strategy logic moved into generateFromSeedArticle
- Their test files

## Testing

### Unit Tests
- [ ] `evolution/src/lib/core/agents/generateFromSeedArticle.test.ts` — Single-variant agent with local discard (16 tests)
- [ ] `evolution/src/lib/core/agents/SwissRankingAgent.test.ts` — One swiss iteration work agent (13 tests)
- [ ] `evolution/src/lib/core/agents/MergeRatingsAgent.test.ts` — Merge agent with before/after capture (13 tests)
- [ ] `evolution/src/lib/pipeline/loop/rankSingleVariant.test.ts` — Binary-search algorithm (12 tests)
- [ ] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts` — Orchestrator-driven iteration loop (13 tests)

### Integration Tests
- [ ] End-to-end pipeline test: full run with 9 variants, ~2-4 iterations
- [ ] Cold start integration test: first iter exits via no_more_opponents for most variants, swiss iters refine to convergence
- [ ] Budget exhaustion during swiss iteration: successful matches reach global ratings, orchestrator exits cleanly
- [ ] Budget exhaustion during generate iteration: surfaced agents contribute matches, discarded agents do not
- [ ] `nextIteration()` decision correctness: generate → swiss → swiss → done

### Manual Verification
- [ ] Run a local evolution pipeline, verify wall-clock time reduction
- [ ] Verify discarded variants don't appear in final result (persisted=false in DB)
- [ ] Verify budget tracking remains accurate across all agent types
- [ ] Check admin UI shows three new agent types with appropriate detail views
- [ ] Verify MergeRatingsAgent's before/matches/after display renders correctly
- [ ] Verify iteration count and execution_order are monotonic across all invocations

## Verification

### A) Automated Tests
- [ ] All new tests pass
- [ ] Existing tests for GenerationAgent/RankingAgent removed (replaced)
- [ ] `npm run test:unit` passes
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes

### B) Integration Verification
- [ ] Run `npm run test:integration` — evolution integration tests pass
- [ ] Run a real evolution pipeline locally and verify:
  - Multiple agents dispatched in parallel
  - Variants converge or get eliminated
  - Discarded variants absent from result
  - Budget tracking accurate
  - Cost breakdown shows generation vs ranking separately
  - Wall-clock time visibly reduced vs old architecture

## Documentation Updates
- [ ] `evolution/docs/architecture.md` — Replace generate→rank flow with two-iteration architecture (parallel iter 1 + Swiss iter 2)
- [ ] `evolution/docs/agents/overview.md` — Document `generateFromSeedArticle` and `SwissRankingAgent` agents
- [ ] `evolution/docs/rating_and_comparison.md` — Replace triage + Swiss with binary-search (iter 1) and Swiss refinement (iter 2), discard rule
- [ ] `evolution/docs/metrics.md` — New per-agent and per-iteration metrics
- [ ] `docs/feature_deep_dives/evolution_metrics.md` — New execution detail structure
- [ ] `evolution/docs/logging.md` — Interleaved log behavior under parallel agents

## Resolved Decisions
- `numVariants` default: **9**, configurable per experiment via `EvolutionConfig`
- Opponent selection: continuous scoring `entropy(pWin) / sigma^SIGMA_WEIGHT`. Single tunable knob `SIGMA_WEIGHT = 1.0`. No `MIN_RANGE`, no `RANGE_MULTIPLIER`. The two-knob form `entropy^a / sigma^b` collapses to one knob via the monotonic transformation `score^(1/a)`. See "Parameter analysis" section.
- **Iteration model:** orchestrator-driven. Each iteration is one work-batch + merge. First iteration is `generate`; subsequent iterations are `swiss` until convergence/exhaustion/budget. The orchestrator's `nextIteration()` function encodes this decision. Future iteration types (feedback generation, etc.) can be added without restructuring.
- **Three agent types:** `generateFromSeedArticle`, `SwissRankingAgent`, `MergeRatingsAgent`. Each is a proper Agent subclass with execution detail schema, metrics, and detail view config.
- **Discard lives in the generate agent**, not the merge agent. Each `generateFromSeedArticle` invocation makes its own surface/discard decision using its local ratings. The merge agent only sees surfaced work.
- **The "round" concept is eliminated.** Each iteration is one work+merge unit. What we previously called "Swiss rounds" are now just "swiss iterations."

## Open Questions
- Default for max iterations (safety cap on orchestrator loop): something like 20 to prevent runaway loops?
- Should we track per-iteration budget spend separately to detect budget spikes in specific iteration types?
- Is `CONVERGENCE_THRESHOLD = 3.0` actually achievable for typical small pools (3-5 eligible variants)? With 3 variants there are only 3 unique pairs — after compactly running them, we exit via `no_pairs` rather than `converged`. May need to accept this or relax the threshold.

## Review & Discussion
[Populated by /plan-review with agent scores, reasoning, and gap resolutions]
