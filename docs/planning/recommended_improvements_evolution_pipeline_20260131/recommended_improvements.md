# Evolution Module Performance Improvements

## 1. Parallelize LLM Calls with `asyncio` (3-5x throughput)

Every LLM call in the system is sequential — one API round-trip at a time. But many calls within each agent are fully independent.

**Where parallelism is free:**

- **GenerationAgent** (`generation_agent.py:209`): Loops over 3 strategies sequentially. These are completely independent — all read from the same `original_text` and produce separate variants.
- **CalibrationRanker** (`calibration_ranker.py:305-358`): For each new entrant, runs 5 opponents × 2 calls = 10 serial LLM calls. All 5 opponent matchups are independent. With 3 new entrants per iteration, that's 30 serial calls that could run as ~6 parallel batches.
- **Tournament** (`tournament.py:372-403`): Swiss pairings within a round are independent — all pairs in `_run_tournament_round` could run concurrently.

**Implementation approach:** Make `LLMClient.complete()` async, add an `acomplete()` method, and use `asyncio.gather()` within each agent. The `LLMClient` already uses the OpenAI SDK which has a native async client (`AsyncOpenAI`). The tenacity retry decorator works with async functions via `@retry` on async defs. The pipeline entry point would need `asyncio.run()` at the top level.

## 2. Tiered Model Routing (5-10x cost reduction on comparisons)

A single `LLMClient` with one model handles everything — both full text generation and simple A/B comparison judgments. Comparison tasks only need a model to output "A", "B", or "TIE" — a trivially simple task that a cheap model handles perfectly.

**Current cost profile:**

- If using `claude-haiku-3.5`: $0.80/M input for comparisons
- If using `gemini-3-flash`: $0.10/M input — 8x cheaper
- If using `deepseek-v3`: $0.14/M input — 5.7x cheaper

**Where to route cheap:** All pairwise comparisons (calibration, tournament, pairwise ranker), format validation calls.

**Where to keep quality:** Generation (structural_transform, lexical_simplify, grounding_enhance), Evolution (crossover, mutation), Reflection (dimensional critique).

**Implementation:** Add a `model` parameter to `LLMClient.complete()` or create two client instances — one `quality_llm` and one `judge_llm` — and pass the appropriate one to each agent.

## 3. Conditional Position-Bias Mitigation (~40% fewer comparison calls)

Every single comparison runs twice — once as A-vs-B, once as B-vs-A. This doubles every comparison call.

**The insight:** Position bias matters most for close matches. For clearly dominant variants, the second call is wasted — both orderings will agree.

**Strategy:**

- Run the first comparison. If the model responds with high internal certainty (e.g., structured comparison returns `CONFIDENCE: high`), skip the reverse call.
- Only run the reverse for `CONFIDENCE: medium/low` responses.
- For calibration of new entrants against bottom-quartile opponents, skip bias mitigation entirely — these are throwaway matches for rough calibration.

**Impact:** ~40% reduction in comparison LLM calls. Combined with tiered routing (#2), this dramatically cuts the cost floor.

## 4. Agent-Level Parallelism Within Iterations (2x iteration throughput)

Agents run in a fixed sequence: Generation → Reflection → Evolution → Calibration → Proximity → Meta-review. But several of these are independent.

**Concrete parallel schedule:**

```
Step 1: Generation (produces new variants)
Step 2: [Reflection, Evolution, Proximity] in parallel
Step 3: Calibration (needs new entrants from Step 1 + Step 2)
Step 4: Meta-review (pure analysis, no LLM)
```

This collapses 6 sequential agent runs into 4 steps, with Step 2 running 3 agents concurrently.

## 5. LLM Response Cache with Content Hashing (eliminates redundant calls)

There is zero caching of LLM results. But the same variant texts persist across iterations and get re-compared — a variant born in iteration 2 might get re-matched in calibration in iteration 5 against the same opponent.

**Implementation:** Hash-based cache keyed on `(sorted_text_pair_hash, comparison_type)`. Store results in a dict (or SQLite for crash resilience). The embedding cache in `ProximityAgent` already demonstrates this pattern — extend it to LLM comparison results. Caching is safe because texts are immutable once created (append-only pool).

## 6. Reduce Calibration Opponents for Low-Signal Matches

`CalibrationRanker` matches each new entrant against 5 opponents with 2 calls each = 10 calls per entrant. With 3 new entrants per iteration, that's 30 calls — often the most expensive agent per iteration.

**Improvement: Adaptive opponent count.**

- First match against the median-Elo opponent. If the new variant wins or loses decisively (confidence = 1.0), reduce to 3 opponents total.
- Only use 5 opponents for variants that produce mixed/close results.
- In EXPANSION phase, use 3 opponents max — rough calibration is fine, precision comes in COMPETITION.

This would cut calibration calls from 30 to ~12-18 per iteration.

## 7. OpenAI Batch API for Non-Urgent Comparisons (50% cost reduction)

The OpenAI Batch API offers a 50% discount on all calls, with 24-hour turnaround. For evolution runs that aren't latency-sensitive:

- Queue all comparison calls (calibration + tournament) as batch requests.
- Process generation calls synchronously (results needed immediately for the next step).
- Poll for batch completion between iterations.

**Trade-off:** Adds latency per iteration (minutes instead of seconds for comparisons), but halves the API cost. Best for overnight runs.

## Summary: Combined Impact

| Improvement | Throughput | Cost | Effort |
|---|---|---|---|
| 1. Async LLM calls | 3-5x faster | Same | Medium |
| 2. Tiered model routing | Same | 5-10x cheaper comparisons | Low |
| 3. Conditional bias mitigation | 1.4x faster | 40% fewer calls | Low |
| 4. Agent-level parallelism | 2x faster iterations | Same | Medium |
| 5. Comparison result cache | Variable | Eliminates repeated calls | Low |
| 6. Adaptive calibration | 1.5-2x faster calibration | 40-60% fewer calibration calls | Low |
| 7. Batch API | Slower per-iter, same total | 50% cheaper | Medium |

**Recommended priority:** Start with #2 (tiered routing) and #3 (conditional bias mitigation) — both are low-effort, high-impact, and don't require architectural changes. Then tackle #1 (async) which is the biggest throughput win but requires touching every agent.
