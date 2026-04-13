# Judge Model Accuracy & Match Noise Research

Research conducted on branch `feat/estimate_match_noise_evolution_20260411` (April 2026). Original source: `docs/planning/estimate_match_noise_evolution_20260411/estimate_match_noise_evolution_20260411_research.md`.

## Problem Statement

Within OpenSkill, sigma updates depend upon a "beta" factor which accounts for match noise. This project aimed to better understand what beta does and how it influences sigma updates, and to empirically estimate how often different judge models agree on rating comparisons over groups of variants — comparing models vs themselves and models vs different models, and exploring how temperature affects results.

---

## Finding 1: Two Different Beta Values

### OpenSkill Internal Beta (used for rating updates)

**Value:** beta = sigma / 2 = (25/3) / 2 ≈ **4.167**

**Source:** `node_modules/openskill/dist/constants.js:4`
```javascript
const { beta = sigma / 2 } = options;
```

**How it's invoked:** `computeRatings.ts:38` calls `osRate([[winner], [loser]], { rank: [1, 2] })` — only `rank` is passed, **no beta override**. So openskill uses its default beta for all rating math.

**Role in the Bradley-Terry-Full model** (`node_modules/openskill/dist/models/bradley-terry-full.js:85-91`):

```
c_iq = sqrt(σ_i² + σ_q² + 2β²)        // Combined uncertainty
p_iq = 1 / (1 + exp((μ_q - μ_i) / c_iq))  // Win probability

// Omega (mu update direction/magnitude):
ω += (σ_i² / c_iq) × (score - p_iq)

// Delta (sigma reduction factor):
δ += γ × (σ_i² / c_iq²) × p_iq × (1 - p_iq)

// Final updates:
μ_new = μ + (σ² / Σσ²) × ω
σ_new = σ × sqrt(max(1 - (σ² / Σσ²) × δ, ε))
```

**How beta affects sigma updates:**
- Beta appears as **2β²** in c_iq, which is the denominator for both omega and delta
- **Larger beta → larger c_iq → smaller δ → slower sigma decrease**
- **Larger beta → flatter win probability → smaller ω → smaller mu shifts**
- Beta acts as a "noise floor" — it represents assumed randomness in match outcomes
- With beta = 4.167 and two fresh players (σ = 8.333 each): c = sqrt(69.4 + 69.4 + 34.7) ≈ 13.17
- The 2β² term (34.7) is about 20% of the total c² (173.5)

### Pipeline BETA (used for opponent selection only)

**Value:** BETA = DEFAULT_SIGMA × √2 ≈ **11.785**

**Source:** `evolution/src/lib/pipeline/loop/rankSingleVariant.ts:26`
```typescript
export const BETA = DEFAULT_SIGMA * Math.SQRT2;
```

Also duplicated in `evolution/src/lib/pipeline/loop/swissPairing.ts:16`.

**Usage:** Only in Bradley-Terry win probability for **opponent selection scoring**, NOT for rating updates:
```typescript
const pWin = 1 / (1 + Math.exp(-(variantRating.mu - oppRating.mu) / BETA));
```

This larger beta makes the pairing sigmoid flatter, meaning the system treats more pairs as "informative" (uncertain outcomes worth comparing). It does NOT affect how ratings actually change — that's controlled by openskill's internal beta.

### Summary of Beta Duality

| Beta | Value | Where | Purpose |
|------|-------|-------|---------|
| openskill internal | ≈ 4.167 | `osRate()` internals | Actual mu/sigma updates |
| Pipeline BETA | ≈ 11.785 | `rankSingleVariant.ts`, `swissPairing.ts` | Opponent selection, pairing scores |

---

## Finding 2: Sigma Update Mechanics

### How Many Matches to Converge?

With openskill defaults (beta ≈ 4.167, sigma_start = 8.333):
- **Convergence threshold:** σ < 4.5 (DEFAULT_CONVERGENCE_SIGMA, raised from 3.0)
- **Estimated matches to converge:** ~18 (per doc comment at `computeRatings.ts:24-26`)
- Previous threshold of 3.0 required ~59 comparisons

### What Controls Convergence Speed?

1. **Beta (noise floor):** Higher beta → slower convergence (more matches needed)
2. **Opponent sigma:** Low-sigma opponents reduce the new variant's sigma faster (cubic scaling: information gain ∝ σ_opponent³ / c³). This is why triage prefers low-sigma anchors.
3. **Match outcome clarity:** Decisive wins (confidence 1.0) vs. draws (confidence < 0.3) affect mu but not sigma — sigma decreases regardless of outcome direction.

### Tau (Dynamic Factor)

The openskill library also has `tau = mu / 300 ≈ 0.083` which adds a small amount of sigma back before each rating update when enabled. The evolution pipeline does NOT pass `tau` to `osRate()`, so tau is computed but not applied (it requires `options.tau` to be truthy, and `{ rank: [1, 2] }` doesn't set it).

---

## Finding 3: Comparison System Architecture

### How Comparisons Work

1. `compareWithBiasMitigation()` in `computeRatings.ts:303` is the entry point
2. It uses `run2PassReversal()` — two parallel LLM calls with A/B positions swapped
3. Results are aggregated by `aggregateWinners()` into confidence scores:
   - Both agree: 1.0
   - One says TIE: 0.7
   - Disagree (A vs B): 0.5 (forced TIE)
   - Partial failure: 0.3
   - Total failure: 0.0

### Judge Model Configuration

- **Judge model** is set per-strategy in `evolution_strategies.config.judgeModel`
- **Default judge model:** `gpt-4.1-nano` (from schema default at the time of this research)
- Available models include: gpt-4.1-nano, gpt-4.1-mini, gpt-4.1, gpt-4o, gpt-4o-mini, deepseek-chat, claude-sonnet-4, etc.

### Temperature

- **Not configurable** at the time of this research. No temperature parameter was passed in judge LLM calls.
- `rankSingleVariant.ts` calls `llm.complete(prompt, 'ranking', { model: config.judgeModel })` — no temperature field
- `createEvolutionLLMClient.ts` does not inject a temperature override
- Each provider uses its own default (typically 1.0 for chat models, 0 for completion models)
- **This is a gap:** temperature likely affects judge agreement rates significantly

### Comparison Prompt

The prompt (`buildComparisonPrompt()` at `computeRatings.ts:206-229`) evaluates 5 criteria:
1. Clarity and readability
2. Structure and flow
3. Engagement and impact
4. Grammar and style
5. Overall effectiveness

Asks for exactly one of: "A", "B", or "TIE".

---

## Finding 4: Querying Recent Runs for Analysis

### SQL to get recent completed runs:
```sql
SELECT id, status, created_at, completed_at
FROM evolution_runs
WHERE status = 'completed'
ORDER BY created_at DESC LIMIT 10;
```

### SQL to get variants with content for a run:
```sql
SELECT id, variant_content, mu, sigma, elo_score, match_count, is_winner, agent_name
FROM evolution_variants
WHERE run_id = '<run-id>'
ORDER BY mu DESC;
```

### Access method:
```bash
npm run query:prod -- --json "SELECT ..." | jq '.'
npm run query:staging -- --json "SELECT ..." | jq '.'
```

---

## Empirical Judge Agreement Experiments

**Script:** `evolution/scripts/judge-agreement-test.ts`

All variants from run `140f7bce` (Federal Reserve articles). Each experiment: 4 temperatures (0, 0.3, 0.7, 1.0) × 10 comparisons × 2 LLM calls (forward + reverse) = 80 LLM calls per model per experiment.

**Current pipeline temperature at time of research:** **1.0 (OpenAI default)** — the pipeline never passes a temperature parameter to judge calls.

### Variant Definitions

| Variant | ID | mu | Elo | Strategy | Description |
|---------|----|----|-----|----------|-------------|
| A | `4d3ced31` | 43.9 | 1503 | grounding_enhance | Run winner |
| B | `2f25e2b0` | 18.7 | 1099 | lexical_simplify | Mid-range |
| C | `39d3275f` | 18.7 | 1100 | baseline | Near-identical to D |
| D | `2f25e2b0` | 18.7 | 1099 | lexical_simplify | Same as B |

---

### Large Elo Gap (A vs B, gap = 25 mu / 404 Elo)

#### Cross-Model Summary

| Model | Cost (in/out per 1M) | Median latency | Temp 0.0 | Temp 0.3 | Temp 0.7 | Temp 1.0 |
|-------|---------------------|---------------|----------|----------|----------|----------|
| gpt-4.1-nano | $0.10 / $0.40 | 0.5s | 90% agree, 0.95 conf | 80% agree, 0.90 conf | 50% agree, 0.75 conf | 60% agree, 0.80 conf |
| gpt-4.1-mini | $0.40 / $1.60 | 0.4s | 100% agree, 1.00 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf |
| deepseek-chat | $0.28 / $0.42 | 1.6s | 100% agree, 1.00 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf |
| gpt-oss-20b | $0.03 / $0.14 | 5.6s | 100% agree, 1.00 conf | 90% agree, 0.95 conf | 100% agree, 1.00 conf | 100% agree, 1.00 conf |

Latency is median wall-clock time per comparison (2 parallel LLM calls — forward + reverse).

#### Key Findings — Large Gap

1. **gpt-4.1-nano is uniquely noisy.** Its forward pass flips to Variant B 10-50% of the time depending on temperature. The other three models almost never flip.

2. **Temperature only matters for nano.** For mini, deepseek, and oss-20b, even temp=1.0 produces near-perfect agreement on this wide-gap pair.

3. **No position bias detected.** For all models, both forward and reverse passes consistently prefer Variant A regardless of which position it appears in.

4. **All models agree: Variant A wins.** Every model's modal result is A at every temperature. The disagreement is only about *how consistently* they pick A.

---

### Close Pair (C vs D, gap = 0.09 mu / 1.4 Elo)

Variant C (baseline, mu=18.75) vs Variant D (lexical_simplify, mu=18.66). Near-identical Elo ratings — the pipeline itself barely distinguished them.

#### Cross-Model Summary

| Model | Cost (in/out per 1M) | Median latency | Temp 0.0 | Temp 0.3 | Temp 0.7 | Temp 1.0 |
|-------|---------------------|---------------|----------|----------|----------|----------|
| gpt-4.1-nano | $0.10 / $0.40 | 0.4s | 100% TIE, 0.50 conf | 100% TIE, 0.50 conf | 100% TIE, 0.50 conf | 100% TIE, 0.50 conf |
| gpt-4.1-mini | $0.40 / $1.60 | 0.3s | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf |
| deepseek-chat | $0.28 / $0.42 | 1.8s | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf | 100% C wins, 1.00 conf |
| gpt-oss-20b | $0.03 / $0.14 | 8.9s | 80% TIE, 0.60 conf | 70% TIE, 0.65 conf | 70% TIE, 0.65 conf | 80% TIE, 0.60 conf |

#### Key Findings — Close Pair

1. **gpt-4.1-nano produces 100% TIEs** at all temperatures. Both forward and reverse passes always pick whichever variant is in Position Second (`fwd=B, rev=B` on every call). This is **pure position bias** — with no quality gap to override it, nano defaults to "second text wins" every time.

2. **gpt-4.1-mini and deepseek-chat still produce 100% decisive results**, consistently picking Variant C (the baseline). Even on a 1.4-Elo gap, these models detect a quality difference that nano cannot. Temperature has no effect.

3. **gpt-oss-20b is noisy on close pairs.** It produces 70-80% TIEs, with occasional decisive C or D wins. The forward pass flips between C and D, while the reverse pass mostly picks the second-position text. This is a mix of position bias and genuine difficulty distinguishing close variants.

4. **Position bias emerges when quality signals are weak.** On the large-gap pair, no model showed position bias. On the close pair, both nano (100%) and oss-20b (~75%) default to position-based judgments. Mini and deepseek are resilient.

#### What This Means for the Pipeline

The default judge at the time of this research (gpt-4.1-nano at temp=1.0) on close pairs:
- Produces **zero decisive matches** (100% TIEs at confidence 0.5)
- All TIEs come from pure position bias, not genuine quality assessment
- These TIEs still move ratings via `updateDraw()`, but provide no directional signal
- The pipeline spends comparison budget getting zero useful information

gpt-4.1-mini at the same temperature produces **100% decisive matches** with **confidence 1.0** on the same pair, at 4x the per-token cost but dramatically better signal quality.

---

### Overall Conclusions

| Scenario | gpt-4.1-nano | gpt-4.1-mini | deepseek-chat | gpt-oss-20b |
|----------|-------------|-------------|---------------|-------------|
| Large gap (25 mu), temp=0 | 90% decisive | 100% decisive | 100% decisive | 100% decisive |
| Large gap (25 mu), temp=1 | 60% decisive | 100% decisive | 100% decisive | 100% decisive |
| Close pair (0.09 mu), temp=0 | 0% decisive | 100% decisive | 100% decisive | 20% decisive |
| Close pair (0.09 mu), temp=1 | 0% decisive | 100% decisive | 100% decisive | 20% decisive |

**gpt-4.1-nano is unsuitable as a judge for close comparisons.** It defaults to position bias when it can't detect a quality difference. gpt-4.1-mini and deepseek-chat are far more capable judges — they detect quality differences that nano and oss-20b miss entirely.

---

## Connecting Experiments to OpenSkill Beta

### What Beta Means

Beta represents the **noise per match** — the standard deviation of performance variance in each comparison. In the Bradley-Terry model used by OpenSkill:

```
c = sqrt(σ_i² + σ_q² + 2β²)
P(i beats q) = 1 / (1 + exp(-(μ_i - μ_q) / c))
```

- **Higher beta** → larger c → flatter win probability curve → more matches needed to converge
- **Lower beta** → smaller c → steeper curve → fewer matches needed
- Beta = σ/2 ≈ 4.17 (default) means a 4.17-mu advantage gives ~76% win probability

For two fresh players (σ = 8.33), the default c = 13.2, where sigma² contributes 80% and beta² contributes 20%.

### What the Official Docs Say About Setting Beta

The default is **β = σ/2**, originally calibrated for Xbox Live multiplayer games. The official guidance is qualitative only:

- [TrueSkill docs](https://trueskill.org/): beta is "the distance which guarantees about 76% chance of winning"
- [OpenSkill docs](https://openskill.me/en/stable/api/openskill.models.weng_lin.bradley_terry_full.html): "lower this value if your game is heavily reliant on pure skill, or increase it if randomness plays a big factor"
- [TrueSkill 2 paper (Microsoft)](https://www.microsoft.com/en-us/research/wp-content/uploads/2018/03/trueskill2.pdf): beta "should be learned from data" but provides no concrete algorithm
- [Moserware](https://www.moserware.com/assets/computing-your-skill/The%20Math%20Behind%20TrueSkill.pdf): defines beta as "the standard deviation of performance" and notes Xbox used β² = (σ₀/2)²

**No source provides a method for empirical calibration.** The advice is "adjust up for luck-heavy, down for skill-heavy" without specifying how to measure where your system falls on that spectrum.

### Our Approach: Empirical Calibration

We measured the judge's agreement rate on a known-gap variant pair, then solved backwards for the implied beta:

1. Observe: on a pair with known mu gap, the forward pass picks the correct winner P% of the time
2. From the Bradley-Terry formula: `P = 1 / (1 + exp(-gap / c))`, solve for c
3. From `c² = σ_i² + σ_q² + 2β²`, solve for beta

This is the empirical calibration that the TrueSkill 2 paper says you *should* do but doesn't explain how. Our approach is straightforward and gives concrete numbers.

### Implied Beta from Our Data

We can work backwards from our observed judge agreement rates to compute what beta the system *should* use for each judge model. The logic: if a judge picks the correct winner with probability P on a known gap, we can solve for the c that produces that P, then extract beta from c.

**Script:** `evolution/scripts/beta-analysis.ts`

Using the large-gap pair (Variant A mu=43.9, σ=4.4 vs Variant B mu=18.7, σ=6.2, gap=25.3 mu):

| Judge config | Forward picks A | Implied c | Implied beta | vs default (4.17) |
|-------------|:-:|:-:|:-:|:-:|
| nano temp=1.0 | 60% | 62.3 | **43.7** | **10.5x** |
| nano temp=0 | 90% | 11.5 | **6.1** | **1.5x** |
| mini temp=1.0 | 100% (≥95%) | ≤8.6 | **≤2.8** | **≤0.7x** |
| deepseek temp=1.0 | 100% (≥95%) | ≤8.6 | **≤2.8** | **≤0.7x** |
| gpt-oss-20b temp=1.0 | 100% (≥95%) | ≤8.6 | **≤2.8** | **≤0.7x** |

Note: gpt-oss-20b is well-calibrated on the large-gap pair but produced only 20% decisive matches on the close pair — its effective beta is much higher for close-skill comparisons. Latency (5-9s) also makes it impractical as a primary judge.

### Interpretation

**The default beta (4.17) is well-calibrated for gpt-4.1-mini and deepseek-chat.** These models produce low-noise judgments where the implied beta is ≤2.8 — slightly below the default but in the same ballpark. The system's convergence assumptions are reasonable for these judges.

**The default beta is 10x too low for gpt-4.1-nano at temp=1.0.** The implied beta of 43.7 means nano's judgments are far noisier than OpenSkill assumes. Consequences:
- OpenSkill updates mu and sigma as if each match carries meaningful signal
- But 40% of matches are noise (wrong winner identification)
- Sigma decreases too fast relative to the actual information gained
- The system becomes **over-confident** — sigma converges before the rating is reliable

**Lowering nano's temperature to 0 brings it closer to calibration** (implied beta 6.1 vs default 4.17 — only 1.5x off). This is a much cheaper fix than changing the model.

### What Should We Do?

Three options, not mutually exclusive:

1. **Change the judge model** from nano to mini. The default beta is already well-calibrated for mini. Cost is 4x higher per token, but effective cost per *useful comparison* is lower because mini produces 100% decisive matches. No code changes to OpenSkill needed.

2. **Lower the judge temperature** to 0 for nano. Reduces implied beta from 43.7 to 6.1 — within 1.5x of default. Cheapest fix (no cost increase, just add `temperature: 0` to judge calls). Trade-off: slightly less diversity in edge-case judgments.

3. **Make beta configurable** and set it per judge model. Pass `{ beta: X }` to `osRate()` calls. This makes the rating system correctly model the actual noise of whatever judge is in use. Most principled fix but requires code changes.

### Important Caveat

Beta in OpenSkill is used for **rating updates** (how much mu/sigma change per match), not for **opponent selection** (which uses the separate pipeline BETA ≈ 11.8). Changing the openskill beta affects convergence speed but not which opponents get paired. Both could be tuned independently.

Also note: these implied beta values are computed from a single variant pair with 10 samples per temperature. More data points (different pairs, larger N) would give more precise estimates. The directional finding is clear, but the exact numbers should be treated as approximations.

---

## Beta's Impact on Convergence Speed

### Why Beta Should Be Near Zero for Our System

In traditional TrueSkill, beta models **performance variance** — a player might play well one game and poorly the next. The same player has variable performance across matches.

In our system, variants are **static text**. A piece of writing doesn't have a good day or a bad day. When we compare Variant A to Variant B, the texts are identical every time. The true performance variance is zero.

The only noise in our system comes from the **judge model**, not the variants. With a reliable judge (mini, deepseek), even that noise is near zero. Beta should reflect this: it should be close to 0.

### Simulation: Comparisons to Converge at Different Beta Values

**Script:** `evolution/scripts/beta-sigma-impact.ts`

Setup: fresh variant (mu=25, σ=8.33) wins every match against a well-calibrated opponent (mu=25, σ=3.0). Uses the real `osRate()` function from openskill with different beta values passed as a parameter. Convergence threshold: σ < 4.5.

| Beta | Comparisons to converge | Context |
|:----:|:-----------------------:|---------|
| **0.01** | **11** | Near-zero noise — correct for static text + reliable judge |
| 1 | 12 | Very low noise |
| 2 | 15 | Low noise |
| **4.17** | **35** | Default (calibrated for Xbox Live) |
| 6 | 81 | Nano temp=0 implied |
| 10 | 498 | High noise |
| 25 | >10,000 | Very high noise |
| **44** | **>10,000** | Nano temp=1 implied — effectively never converges |

**The pipeline caps at 15 comparisons per variant** (`maxComparisonsPerVariant` default). At the default beta of 4.17, variants need 35 comparisons to converge — more than double the cap. They never reach convergence.

With beta near 0, convergence takes 11 comparisons — well within the 15-comparison budget. This means variants would actually reach converged ratings within the existing ranking budget, without increasing the comparison cap or cost.

### Resolution

Set openskill beta to 0 (or near-zero) in our ranking code. This correctly models that text variants have zero performance variance — the only remaining noise is from the judge, which is already handled by the 2-pass reversal confidence scoring and draw thresholds.

---

## Alternative Judge Model Landscape

### All Non-Reasoning Models by Input Cost

| Model | Provider | Input $/1M | MMLU | Speed | Judge quality (tested?) |
|-------|----------|:----------:|:----:|:-----:|:------------------------|
| Mistral Nemo | Mistral | $0.02 | ~73% | Fast | Not tested — likely too weak |
| gpt-oss-20b | OpenRouter | $0.03 | ~85% | Slow (5-9s) | Tested — 20% decisive on close pairs, mandatory reasoning |
| Qwen 2.5 7B | SiliconFlow | $0.05 | ~75% | Fast | Not tested |
| Llama 3.1 8B | SiliconFlow | $0.06 | ~73% | Fast | Not tested |
| GLM-4 9B | SiliconFlow | $0.086 | ~72% | Fast | Not tested |
| **Gemini 2.5 Flash-Lite** | Google | **$0.10** | **~81%** | **Fast (~0.4s)** | **Not tested — most promising sub-$0.10** |
| gpt-4.1-nano | OpenAI | $0.10 | ~80%? | Very fast (0.4s) | Tested — 0% decisive on close pairs |
| gpt-5.4-nano | OpenAI | $0.20 | Unknown | Very fast | Not tested |
| Claude Haiku 3 | Anthropic | $0.25 | Unknown | Fast | Not tested |
| **DeepSeek-chat** | DeepSeek | **$0.28** | **~85%** | **Medium (1.6s)** | **Tested — 100% decisive at all temps** |
| Gemini 2.5 Flash | Google | $0.30 | ~88% | Fast | Not tested |
| **gpt-4.1-mini** | OpenAI | **$0.40** | **~87%?** | **Very fast (0.4s)** | **Tested — 100% decisive at all temps** |
| gpt-5.4-mini | OpenAI | $0.75 | Unknown | Fast | Not tested |
| Claude Haiku 3.5 | Anthropic | $0.80 | Unknown | Fast | Not tested |
| Claude Haiku 4.5 | Anthropic | $1.00 | Unknown | Fast | Not tested |
| Gemini 2.5 Flash-Lite (free) | Google | $0.00 | ~81% | Fast | Not tested — rate limited |

---

## Open Questions (from original research)

1. **Which fix to implement first?** Changing judge model (option 1) vs lowering temperature (option 2) vs making beta configurable (option 3). Options 1 and 2 are simple config changes; option 3 requires code changes but is the most principled.
2. **Cost-benefit analysis:** At 4x per-token cost but 100% decisive rate, is mini actually cheaper per useful comparison than nano? Need to estimate total comparison counts per run.
3. **Cross-model agreement:** All four models agree C > D when they produce decisive results. Need to test whether models ever *disagree* on which variant is better.
4. **More variant pairs:** Our implied beta is from one pair. Testing 5-10 pairs at different gap sizes would give a more robust estimate.

---

## Scripts Created During Research

| Script | Purpose |
|--------|---------|
| `evolution/scripts/judge-agreement-test.ts` | Empirical judge agreement test — 4 models × 4 temperatures × 10 comparisons × 2 variant pairs |
| `evolution/scripts/beta-analysis.ts` | Compute implied beta from observed judge agreement rates |
| `evolution/scripts/beta-sigma-impact.ts` | Simulate comparisons-to-converge at different beta values using real osRate() |
