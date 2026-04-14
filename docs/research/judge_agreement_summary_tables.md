# Judge Agreement Summary Tables

Empirical judge model agreement results across different temperatures and variant elo gaps. Extracted from `judging_accuracy_20260412.md` and kept as a standalone reference.

Source branch: `feat/estimate_match_noise_evolution_20260411` (April 2026).

---

## Methodology

**Script:** `evolution/scripts/judge-agreement-test.ts`

- **Variants:** All from run `140f7bce` (Federal Reserve articles).
- **Per experiment:** 4 temperatures (0, 0.3, 0.7, 1.0) × 10 comparisons × 2 LLM calls (forward + reverse) = 80 LLM calls per model per pair.
- **Pipeline temperature at time of research:** 1.0 (OpenAI default) — the pipeline never passed a temperature parameter to judge calls.
- **Confidence scoring:** From `aggregateWinners()` after 2-pass A/B reversal (forward prompt + reversed prompt).
  - Both passes agree on winner: `1.0`
  - One pass TIE, one pass picks winner: `0.7`
  - Passes disagree (A vs B): `0.5` (forced TIE)
  - One pass returns null: `0.3`
  - Both null: `0.0`

### Variant Definitions

| Variant | ID | mu | Elo | Strategy | Description |
|---------|----|----|-----|----------|-------------|
| A | `4d3ced31-1872-431d-b9bd-abc709dd4784` | 43.9 | 1503 | grounding_enhance | Run winner |
| B | `2f25e2b0-75ff-47f8-87eb-683a2c4c4122` | 18.7 | 1099 | lexical_simplify | Mid-range |
| C | `39d3275f-c898-4cdd-9d4c-ccdea7f02360` | 18.75 | 1100 | baseline | Near-identical to D |
| D | `2f25e2b0-75ff-47f8-87eb-683a2c4c4122` | 18.66 | 1099 | lexical_simplify | Same row as B |

### Variant Content Sizes (used in input token estimates)

| Variant | Character count | Approximate tokens |
|---------|----------------:|-------------------:|
| A | 7,293 | ~1,823 |
| B | 5,567 | ~1,391 |
| C | 8,314 | ~2,078 |

---

## Table 1: Large Elo Gap (A vs B, 25 mu / 404 Elo)

| Model | Cost (in/out per 1M) | Median latency | Temp 0.0 | Temp 0.3 | Temp 0.7 | Temp 1.0 |
|-------|---------------------|---------------|----------|----------|----------|----------|
| gpt-4.1-nano | $0.10 / $0.40 | 0.5s | 90% agree, 0.95 conf | 80% agree, 0.90 conf | 50% agree, 0.75 conf | 60% agree, 0.80 conf |
| gpt-4.1-mini | $0.40 / $1.60 | 0.4s | 100% agree, 1.00 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf |
| deepseek-chat | $0.28 / $0.42 | 1.6s | 100% agree, 1.00 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf |
| gpt-oss-20b | $0.03 / $0.14 | 5.6s | 100% agree, 1.00 conf | 90% agree, 0.95 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf |

*Latency is median wall-clock time per comparison (2 parallel LLM calls — forward + reverse).*

### Key Findings — Large Gap

1. **gpt-4.1-nano is uniquely noisy.** Its forward pass flips to Variant B 10-50% of the time depending on temperature. The other three models almost never flip.

2. **Temperature only matters for nano.** For mini, deepseek, and oss-20b, even temp=1.0 produces near-perfect agreement on this wide-gap pair.

3. **No position bias detected.** For all models, both forward and reverse passes consistently prefer Variant A regardless of which position it appears in.

4. **All models agree: Variant A wins.** Every model's modal result is A at every temperature. The disagreement is only about *how consistently* they pick A.

---

## Table 2: Close Pair (C vs D, 0.09 mu / 1.4 Elo)

Variant C (baseline, mu=18.75) vs Variant D (lexical_simplify, mu=18.66). Near-identical Elo ratings — the pipeline itself barely distinguished them.

| Model | Cost (in/out per 1M) | Median latency | Temp 0.0 | Temp 0.3 | Temp 0.7 | Temp 1.0 |
|-------|---------------------|---------------|----------|----------|----------|----------|
| gpt-4.1-nano | $0.10 / $0.40 | 0.4s | 100% TIE, 0.50 conf | 100% TIE, 0.50 conf | 100% TIE, 0.50 conf | 100% TIE, 0.50 conf |
| gpt-4.1-mini | $0.40 / $1.60 | 0.3s | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf |
| deepseek-chat | $0.28 / $0.42 | 1.8s | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf |
| gpt-oss-20b | $0.03 / $0.14 | 8.9s | 80% TIE, 0.60 conf | 70% TIE, 0.65 conf | 70% TIE, 0.65 conf | 80% TIE, 0.60 conf |

### Key Findings — Close Pair

1. **gpt-4.1-nano produces 100% TIEs** at all temperatures. Both forward and reverse passes always pick whichever variant is in Position Second (`fwd=B, rev=B` on every call). This is **pure position bias** — with no quality gap to override it, nano defaults to "second text wins" every time.

2. **gpt-4.1-mini and deepseek-chat still produce 100% decisive results**, consistently picking Variant C (the baseline). Even on a 1.4-Elo gap, these models detect a quality difference that nano cannot. Temperature has no effect.

3. **gpt-oss-20b is noisy on close pairs.** It produces 70-80% TIEs, with occasional decisive C or D wins. The forward pass flips between C and D, while the reverse pass mostly picks the second-position text. This is a mix of position bias and genuine difficulty distinguishing close variants.

4. **Position bias emerges when quality signals are weak.** On the large-gap pair, no model showed position bias. On the close pair, both nano (100%) and oss-20b (~75%) default to position-based judgments. Mini and deepseek are resilient.

### What This Means for the Pipeline

The default judge at the time of this research (gpt-4.1-nano at temp=1.0) on close pairs:
- Produces **zero decisive matches** (100% TIEs at confidence 0.5)
- All TIEs come from pure position bias, not genuine quality assessment
- These TIEs still move ratings via `updateDraw()`, but provide no directional signal
- The pipeline spends comparison budget getting zero useful information

gpt-4.1-mini at the same temperature produces **100% decisive matches** with **confidence 1.0** on the same pair, at 4x the per-token cost but dramatically better signal quality.

---

## Overall Decisiveness Summary

| Scenario | gpt-4.1-nano | gpt-4.1-mini | deepseek-chat | gpt-oss-20b |
|----------|-------------|-------------|---------------|-------------|
| Large gap (25 mu), temp=0 | 90% decisive | 100% decisive | 100% decisive | 100% decisive |
| Large gap (25 mu), temp=1 | 60% decisive | 100% decisive | 100% decisive | 100% decisive |
| Close pair (0.09 mu), temp=0 | 0% decisive | 100% decisive | 100% decisive | 20% decisive |
| Close pair (0.09 mu), temp=1 | 0% decisive | 100% decisive | 100% decisive | 20% decisive |

**gpt-4.1-nano is unsuitable as a judge for close comparisons.** It defaults to position bias when it can't detect a quality difference. gpt-4.1-mini and deepseek-chat are far more capable judges — they detect quality differences that nano and oss-20b miss entirely.

---

---

## Follow-Up Tests: Qwen3 8B, GPT-OSS-20B (thinking mode), Qwen 2.5 7B

**Script:** `evolution/scripts/test-judge-models-v2.ts`

Conducted April 2026 on same variant pairs with the same methodology (10 calls × 4 temps × 2 LLM calls per comparison). Tracks output tokens including reasoning tokens.

### Additional Models Tested

| Model | Pricing (in/out per 1M) | Notes |
|-------|:----------------------:|-------|
| `qwen/qwen3-8b` (thinking ON) | $0.05 / $0.40 | Default OpenRouter behavior |
| `qwen/qwen3-8b` (thinking OFF) | $0.05 / $0.40 | `reasoning: { effort: 'none' }` |
| `openai/gpt-oss-20b` (default) | $0.03 / $0.14 | Default reasoning (medium), mandatory |
| `openai/gpt-oss-20b` (low) | $0.03 / $0.14 | `reasoning: { effort: 'low' }` |
| `qwen/qwen-2.5-7b-instruct` | $0.04 / $0.10 | No thinking mode |

### Qwen3 8B `parseWinner()` Caveat

Qwen3 8B with thinking OFF returns `"Your answer: B"` on reverse-pass calls instead of a bare `"B"`. The existing `parseWinner()` cannot parse this format, returning `null`, which drops the 2-pass confidence to `0.30`. Actual judgments are consistent with thinking-ON — a parser fix would restore full `1.00` confidence.

---

### Table 3: Large Elo Gap (A vs B, 25 mu / 404 Elo) — Follow-Up Models

| Model config | Temp | Decisive | Avg Conf | Med wall | Med fwd | Avg output tokens | Avg reasoning tokens |
|-------------|:----:|:--------:|:--------:|:--------:|:-------:|:-----------------:|:--------------------:|
| qwen3-on | 0.0 | 10/10 (100%) | 1.00 | 9,159 ms | 8,034 ms | 892 | 881 |
| qwen3-on | 0.3 | 10/10 (100%) | 1.00 | 9,272 ms | 8,715 ms | 936 | 924 |
| qwen3-on | 0.7 | 10/10 (100%) | 1.00 | 8,898 ms | 8,898 ms | 907 | 895 |
| qwen3-on | 1.0 | 10/10 (100%) | 1.00 | 8,818 ms | 8,072 ms | 981 | 969 |
| qwen3-off | 0.0 | 10/10 (100%) | 0.30* | 1,187 ms | 894 ms | 5 | 0 |
| qwen3-off | 0.3 | 10/10 (100%) | 0.30* | 1,135 ms | 1,135 ms | 5 | 0 |
| qwen3-off | 0.7 | 10/10 (100%) | 0.30* | 1,196 ms | 950 ms | 5 | 0 |
| qwen3-off | 1.0 | 10/10 (100%) | 0.30* | 1,094 ms | 920 ms | 5 | 0 |
| oss20b-default | 0.0 | 10/10 (100%) | 1.00 | 15,991 ms | 7,429 ms | 2,575 | 2,995 |
| oss20b-default | 0.3 | 10/10 (100%) | 1.00 | 6,840 ms | 6,840 ms | 1,526 | 1,714 |
| oss20b-default | 0.7 | 10/10 (100%) | 1.00 | 5,983 ms | 5,469 ms | 1,026 | 1,157 |
| oss20b-default | 1.0 | 10/10 (100%) | 1.00 | 7,204 ms | 7,204 ms | 827 | 921 |
| oss20b-low | 0.0 | 10/10 (100%) | 1.00 | 1,108 ms | 1,108 ms | 94 | 81 |
| oss20b-low | 0.3 | 10/10 (100%) | 1.00 | 1,290 ms | 1,290 ms | 96 | 83 |
| oss20b-low | 0.7 | 10/10 (100%) | 1.00 | 1,296 ms | 1,296 ms | 94 | 82 |
| oss20b-low | 1.0 | 10/10 (100%) | 1.00 | 1,395 ms | 1,395 ms | 92 | 81 |
| qwen25-7b | 0.0 | 10/10 (100%) | 1.00 | 1,605 ms | 782 ms | 3 | 0 |
| qwen25-7b | 0.3 | 10/10 (100%) | 1.00 | 1,774 ms | 1,774 ms | 3 | 0 |
| qwen25-7b | 0.7 | 10/10 (100%) | 1.00 | 1,816 ms | 846 ms | 3 | 0 |
| qwen25-7b | 1.0 | 10/10 (100%) | 1.00 | 1,908 ms | 1,698 ms | 15 | 0 |

\* Qwen3-off confidence = 0.30 due to `parseWinner()` bug on `"Your answer: B"` responses. Actual decisiveness is 100% (winner is correct on all 10 calls).

Output tokens are **total across both calls** in a comparison (forward + reverse).

---

### Table 4: Close Pair (C vs D, 0.09 mu / 1.4 Elo) — Follow-Up Models

| Model config | Temp | Decisive | Avg Conf | Med wall | Med fwd | Avg output tokens | Avg reasoning tokens |
|-------------|:----:|:--------:|:--------:|:--------:|:-------:|:-----------------:|:--------------------:|
| qwen3-on | 0.0 | 10/10 (100%) | 1.00 | 11,742 ms | 8,075 ms | 994 | 982 |
| qwen3-on | 0.3 | 10/10 (100%) | 1.00 | 10,512 ms | 7,152 ms | 1,041 | 1,029 |
| qwen3-on | 0.7 | 10/10 (100%) | 1.00 | 13,119 ms | 10,207 ms | 1,077 | 1,065 |
| qwen3-on | 1.0 | 10/10 (100%) | 1.00 | 9,768 ms | 7,804 ms | 1,036 | 1,024 |
| qwen3-off | 0.0 | 10/10 (100%) | 0.30* | 1,118 ms | 862 ms | 5 | 0 |
| qwen3-off | 0.3 | 9/10 (90%) | 0.27* | 1,287 ms | 934 ms | 6 | 0 |
| qwen3-off | 0.7 | 9/10 (90%) | 0.27* | 984 ms | 888 ms | 5 | 0 |
| qwen3-off | 1.0 | 10/10 (100%) | 0.30* | 1,125 ms | 852 ms | 18 | 0 |
| oss20b-default | 0.0 | 1/10 (10%) | 0.55 | 9,158 ms | 9,158 ms | 1,066 | 1,211 |
| oss20b-default | 0.3 | 2/10 (20%) | 0.60 | 13,510 ms | 9,167 ms | 1,876 | 2,136 |
| oss20b-default | 0.7 | 4/10 (40%) | 0.70 | 10,821 ms | 10,821 ms | 1,428 | 1,591 |
| oss20b-default | 1.0 | 2/10 (20%) | 0.60 | 5,858 ms | 5,713 ms | 1,066 | 1,208 |
| oss20b-low | 0.0 | 0/10 (0%) | 0.50 | 2,404 ms | 2,404 ms | 113 | 106 |
| oss20b-low | 0.3 | 1/10 (10%) | 0.55 | 2,440 ms | 2,440 ms | 120 | 112 |
| oss20b-low | 0.7 | 5/10 (50%) | 0.75 | 2,364 ms | 2,364 ms | 118 | 109 |
| oss20b-low | 1.0 | 7/10 (70%) | 0.85 | 3,147 ms | 3,147 ms | 100 | 91 |
| qwen25-7b | 0.0 | 10/10 (100%) | 1.00 | 1,661 ms | 1,572 ms | 3 | 0 |
| qwen25-7b | 0.3 | 10/10 (100%) | 1.00 | 1,663 ms | 1,663 ms | 3 | 0 |
| qwen25-7b | 0.7 | 10/10 (100%) | 1.00 | 1,496 ms | 1,496 ms | 3 | 0 |
| qwen25-7b | 1.0 | 10/10 (100%) | 0.93 | 1,649 ms | 500 ms | 3 | 0 |

\* Qwen3-off confidence artificially low due to `parseWinner()` bug. Actual winner correct in all 9/10 or 10/10 decisive calls.

> **Oddity observed in Qwen3-off on close pair at temp 0.3 and 0.7:** 1 call in each temp produced a TIE because both forward and reverse passes picked the same variant (both chose `B` in-position, indicating position bias breakthrough under the parser constraints). Quality still aligns with thinking-ON (winner: A / C-baseline).

---

### Key Findings — Follow-Up Models

1. **Qwen 2.5 7B is the standout.** 100% decisive on BOTH pairs at ALL temperatures, with only ~3 output tokens, median latency ~1.7s, and no reasoning tokens. Matches gpt-4.1-mini and deepseek-chat quality at lower cost than both.

2. **Qwen3 8B thinking mode is expensive and slow.** Generates ~900-1,000 reasoning tokens per comparison (~98% of total output tokens). Median wall time 9-13s vs ~1s with thinking off. Quality is identical to thinking-off (100% decisive both pairs).

3. **Qwen3 8B thinking OFF matches thinking ON quality** — all 80 runs on A-vs-B picked A; 38/40 runs on C-vs-D picked C. The parser bug (`"Your answer: B"` → null) is the only downside. A one-line regex fix recovers full confidence.

4. **GPT-OSS-20B default (medium reasoning) has extreme latency variance** — 6-16s median wall time on large gap, up to 13.5s on close pair. Reasoning tokens vary widely (827-2,995 per comparison). Output cost is 73% of total cost at medium reasoning.

5. **GPT-OSS-20B with reasoning=low is fast but weak on close pairs** — 100% decisive on large gap at all temps (1.1-1.4s median wall), but only 0-70% decisive on close pair depending on temperature.

6. **GPT-OSS-20B shows inverse temperature behavior on close pair** — decisiveness *increases* with temperature (from 10% at temp=0 to 70% at temp=1.0 for reasoning=low). This is unusual and worth investigating — higher temperature normally adds noise, but here it seems to break position bias.

---

### Input vs Output Cost Split (per comparison, ~6,750 input tokens)

| Model config | Input cost | Output cost | Total cost | Input % | Output % |
|-------------|:----------:|:-----------:|:----------:|:-------:|:--------:|
| qwen3-on (avg all temps) | $0.000338 | $0.000366 | **$0.000704** | 48% | 52% |
| qwen3-off | $0.000338 | $0.000002 | **$0.000340** | 99.4% | 0.6% |
| oss20b-default (temp=0) | $0.000202 | $0.000361 | **$0.000563** | 36% | 64% |
| oss20b-default (temp=0.7) | $0.000202 | $0.000144 | **$0.000346** | 58% | 42% |
| oss20b-low | $0.000202 | $0.000013 | **$0.000215** | 94% | 6% |
| qwen25-7b | $0.000270 | $0.000000 | **$0.000270** | ~100% | 0% |
| gpt-4.1-mini (reference) | $0.002700 | $0.000016 | **$0.002716** | 99.4% | 0.6% |
| deepseek-chat (reference) | $0.001890 | $0.000004 | **$0.001894** | 99.8% | 0.2% |

**Key insight:** For thinking-mode configs (qwen3-on, oss20b-default), **output tokens drive 42-64% of cost**. Without thinking, input tokens drive 94-100% of cost. Disabling thinking halves the bill for Qwen3 and cuts OSS 20B cost by up to 62% (at temp=0).

---

### Cost Per Useful Comparison (decisive rate-adjusted)

| Model config | Cost/call | Large gap decisive | Close pair decisive (best temp) | **Cost per decisive comparison** |
|-------------|:---------:|:------------------:|:-------------------------------:|:-:|
| qwen25-7b | $0.000270 | 100% | 100% (all temps) | **$0.000270** |
| qwen3-off | $0.000340 | 100% | 90-100% | **$0.000340** |
| oss20b-low | $0.000215 | 100% | 70% (temp=1.0) | **$0.000307** (at temp=1.0) |
| qwen3-on | $0.000704 | 100% | 100% | **$0.000704** |
| oss20b-default | ~$0.000500 avg | 100% | 40% (temp=0.7) | **$0.001250** (close pair worst case) |
| gpt-4.1-mini | $0.002716 | 100% | 100% | **$0.002716** |
| deepseek-chat | $0.001894 | 100% | 100% | **$0.001894** |

**Best value judges (ranked):**
1. **qwen-2.5-7b-instruct** — $0.000270/comparison, 100%/100% decisive
2. **qwen3-off** (with parser fix) — $0.000340/comparison, 100%/~95% decisive
3. **oss20b-low at temp=1.0** — $0.000307/comparison, 100%/70% decisive
4. **qwen3-on** — $0.000704/comparison, 100%/100% decisive (but 30x slower than qwen25-7b)

---

## Related Documents

- [`judging_accuracy_20260412.md`](./judging_accuracy_20260412.md) — full research context, beta analysis, and OpenSkill calibration findings
