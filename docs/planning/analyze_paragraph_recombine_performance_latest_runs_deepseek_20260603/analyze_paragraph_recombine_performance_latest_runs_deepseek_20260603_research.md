# Analyze Paragraph Recombine Performance (Latest Runs, DeepSeek) Research

## Problem Statement
Analyze recent paragraph recombine invocation performance on stage using deepseek models — how the `paragraph_recombine` agent actually performed on the DEV/staging Supabase DB for runs whose generation model is a DeepSeek variant. Focus on concrete examples of where it **helped** vs **hurt**, with side-by-side paragraph comparisons, and on **match history / number of matches played**.

## Requirements (from GH Issue #1162)
make sure to look at examples of how it hurt or helped performance, including side by side paragraph comparison. Look at match history and # of matches played

## Method
Read-only SQL via `npm run query:staging` against DEV Supabase (`ifubinffdbyewoezcidz`). Inline reconnaissance to fix the dataset + schema, then a 5-round × 4-agent workflow (20 agents) to characterize cost/quality/matches, extract helped + hurt side-by-side examples, compare models, and adversarially verify every claim. All headline numbers were independently re-derived by a verification round and cross-checked against my own ground-truth queries.

## Dataset
**11 `paragraph_recombine` invocations, all 2026-06-03**, the only DeepSeek-generation paragraph_recombine runs on staging. (`deepseek-chat` strategies exist but ran no paragraph_recombine.) Judge = `qwen-2.5-7b-instruct` for all 11.

| Model | Invocations | Runs | Slots | Cost/inv (median) | Cost/slot |
|---|---|---|---|---|---|
| deepseek-v4-flash | 7 | 7 | 57 | $0.0137 | ~$0.0013 |
| deepseek-v4-pro | 4 | 4 | 33 | $0.0247 | ~$0.0030 |

This dataset uses `rewritesPerParagraph=6` (temp ladder 0.7/1.2/1.4/1.6/1.8/2.0), not the documented default of 3. Three of the cheap flash runs ran a truncated 3-rung ladder `[0.7, 1.2, 2.0]`.

## High Level Summary

**The agent helps at the per-slot level the large majority of the time, but per-slot wins do NOT reliably become article-level wins, and ~40% of generation spend is wasted on the high-temperature tail of the rewrite ladder.** Three nuances qualify the headline.

1. **Per-slot "helped" rate is high: 91% (flash) / 97% (pro)** of slots end with a rewrite outranking the original (`winnerIsOriginal=false`). The documented ~98%-draw freeze (per-slot Elo stuck at 1200) is **fully resolved** — draw rate is now ~47% (flash) / ~53% (pro), and decisive matches carry high confidence. The index-0 "tighten" `length_under` catastrophe (89–100% pre-fix) is **fixed** (15.6% drop).

2. **…but the article-level payoff is weak and model-divergent.** Stitching best-per-slot paragraphs back together rarely produces a run-winning article. flash recombined variants beat their parent on raw Elo in 6/7 runs but became `is_winner` only **1/7**; pro was net-neutral-to-negative (median Δ −1.8 Elo, eloAttrDelta −0.11, **0/4** winners) despite its 97% per-slot helped rate. **The per-slot judge and the article judge disagree — recombination is the leak.**

3. **…and the quality numbers carry real caveats.** (a) The qwen judge has a strong A-position skew (`winner='b'` in 0/1,204 of these matches; globally rare at 167/17,196), so the original — usually seated as the incumbent/entry_b reference — is structurally disadvantaged, which **partially inflates** the helped rate. It is not fatal (draws are ~48%, originals do win 5 flash slots, Elo genuinely separates), but it means helped rates are directional. (b) flash and pro share **zero** topic overlap, so "pro 97% > flash 91%" is confounded by topic difficulty and pool maturity. (c) n=11, one calendar day, one judge.

**Cost:** DeepSeek is 3–5× the documented gemini/qwen baseline ($0.0048): flash ~2.9×, pro ~5.2× per invocation (~3× / ~7× per slot). About half the gap is structural (6 rewrites vs 3); the rest is model-tier pricing. All 11 invocations **undershoot** their cost estimate (mean −34.75%), driven mainly by the rank stage being over-budgeted.

## Key Findings

### 1. Match history & # matches played (core deliverable)
- **1,204 total per-slot arena comparisons** (flash 930, pro 274). `execution_detail.slots[*].ranking.matchCount` == `comparisonCount` == actual `evolution_arena_comparisons` row count for every one of the 90 ranked slots — **zero drift**, all `status='completed'`.
- **Matches per slot:** flash median **20** (range 1–40); pro median **6** (range 3–20). flash runs deeper arenas (pool accumulates across invocations); pro spends its budget on generation, not arena depth. The 3 cheap flash runs collapse to ~2–3 matches/slot.
- **Draw rate:** flash 46.9% (436/930), pro 52.9% (145/274) — vs the documented ~98% pre-fix. Decisive matches: flash conf avg 0.98, pro 0.91. Only **1 slot in the whole dataset** sits at 0 matches (a pro slot where all 6 rewrites failed).
- **winnerSource (90 slots):** 69 `this_invocation`, 15 `prior_invocation`, 5 `original`, 1 null.
- **Persistence caveat (known class):** newly-created rewrite variants persist `arena_match_count` exactly (275/275). But **original-slot entries persist `arena_match_count=0` despite playing 199 matches** — the baseline entry's per-slot participation is never written back. Do NOT reconstruct slot match volume by summing persisted `arena_match_count`; use `execution_detail` / count `evolution_arena_comparisons` directly.

#### Draw-rate reference (all levels)
| Scope | Matches | Draw rate | Decisive (conf ≥ 0.6) |
|---|---|---|---|
| **Paragraph-level** (DeepSeek slots) | 1,204 | **48.3%** | 53.6% |
| ↳ deepseek-v4-flash | 930 | 46.9% | 55.2% |
| ↳ deepseek-v4-pro | 274 | 52.9% | 48.2% |
| **Article-level, general** (whole `evolution_arena_comparisons` table, `prompt_kind='article'`, all runs/models/time) | 15,211 | **45.9%** | 50.7% |
| Article-level, scoped to the 11 DeepSeek runs | 487 | 37.4% | — |
| **Recombined variant specifically** (within those runs) | 33 | **62–67%** | — |

Two takeaways: (a) at the aggregate level, whole articles (45.9% general) and single paragraphs (48.3%) are about equally hard for the qwen judge to separate — both roughly halved from the documented ~98% pre-fix paragraph freeze; (b) the signal in the article-leak finding is NOT the general article rate but that the **recombined article specifically draws far more (62–67%)** than both the general article rate (45.9%) and its own run-pool's rate (37.4%) — it is unusually hard to distinguish from its competitors, part of why per-slot gains don't register as article wins.

### 2. Helped vs hurt (per slot)
| | flash | pro |
|---|---|---|
| Slots | 57 | 33 |
| Helped (rewrite outranks original) | 52 (91.2%) | 32 (97.0%) |
| Original won (`winnerIsOriginal=true`) | 5 | 0 |
| Won by `prior_invocation` (no-op for this run's spend) | 15 | 0 |
| Decisive Elo separation (stricter "helped") | ~65% | ~97% |

The gap between "91% helped" and "~65% decisively helped" matters: ~26% of flash slots were won by a carried-over prior variant on thin evidence rather than a fresh decisive win.

### 3. Article-level outcome (the real bottleneck)
| Model | Recomb Elo > parent | `is_winner=true` | Median Elo Δ vs parent | eloAttrDelta (median) |
|---|---|---|---|---|
| flash | 6/7 | **1/7** | +71.3 | +4.46 |
| pro | 1/4 | **0/4** | −1.8 | −0.11 |

Per-slot success is decoupled from article success, especially for pro. This is the most important finding for "did it help performance": **locally yes, globally mostly no.**

### 4. Temperature ladder is top-heavy and wasteful on DeepSeek
- Overall rewrite drop rate **40.9%** (195/477). Dominant drop reason is now **`length_over` (74.9%)**, not `length_under`.
- Drop rate by rung: 0.7→15.6%, 1.2→20%, 1.4→14.5%, 1.6→31.9%, **1.8→71%, 2.0→90%**. At 2.0 only 6/90 attempts survive.
- **Winning-rewrite temperature:** 1.2 produced **68%** of all winning rewrites, 1.4 produced 13%, 1.8 produced 13%; **1.6 and 2.0 produced ZERO winners** across all 11 invocations (~160 attempts). The top two rungs are near-pure waste — trimming them would cut ~33% of generation cost while losing 0 historical winners.
- Index-0 @0.7 "tighten" works as designed: 83% succeed, all survivors tighter than original (avg ratio 0.89), no over-length; residual 15.6% drops are all `length_under`.

### 5. Judge (qwen-2.5-7b-instruct) is the quality bottleneck
- **A-position skew:** `winner='b'` in 0/1,204 of these matches (globally rare: 167 b-wins vs 9,087 a-wins). Not a pure write convention — in 213/928 of today's a-wins the winner had *lower* mu_before — but a strong structural skew that disadvantages the incumbent/original.
- **Quantized confidence:** essentially 3 states (0.50=draw, 0.70=weak A, 1.00=strong A); "avg confidence" is not a calibration signal.
- **pro draws MORE than flash** (52.9% vs 46.9%) despite presumably higher-quality rewrites — the cheap judge can't cash in pro's quality. Argues for a stronger judge before paying the pro premium.

### 6. Cost mechanics
- `cost_usd` == `execution_detail.totalCost` exactly; run-level `evolution_metrics.paragraph_recombine_cost` == SUM(`slots[*].spentUsd`) == rewrite+rank cost exactly.
- `totalCost` sits a consistent **~$0.0006–$0.0008 above** rewrite+rank (parent-level recombine/orchestration overhead not attributed to any slot).
- Cost split: pro is ~85% rewrite-dominated (pricey generation); flash is bimodal — large 9-slot runs are ~54% rank-cost (cheap generation, deep qwen arenas), small runs ~13–32% rank.
- **Reliability wart:** all 7 `llm_error` rewrites are concentrated in one pro invocation (`3c508095`), including slot 9 where all 6 rewrites returned empty → forced fallback to original (pure cost, zero benefit).

## Side-by-side examples (backing the intuition)

### HELPED — the winning move is "original + one concrete analogy," usually at temp 1.2
**f10c2e96 / slot 2 — `[para] 26ab2327.P3`** (winner `915a3a33`, temp 1.2): **9–0, avg conf 1.0**, original mu 25 → winner mu **39.43**.
- ORIGINAL: "…the twelve **regional Federal Reserve Banks** operate in their respective districts, carrying out the day-to-day operations… These banks supervise and regulate member banks…, provide essential financial services like processing payments, and contribute to monetary policy discussions through their research and analysis."
- WINNER: "…the twelve **regional Federal Reserve Banks** form the operational backbone of the central bank, each serving its own district through supervision and regulation…, provision of essential financial services such as payment processing, and active contribution to monetary policy debates via research and analysis… ensuring a degree of regional independence. For instance, the Federal Reserve Bank of…"
- Why: parallel triad + interpretive payoff ("regional independence") + a "For instance" example the original lacked.

**dfb4a14d / slot 8 — `[para] 26ab2327.P9`** (winner `27b69f2e`, temp 1.2): **8–0 at conf 1.0**, beat the next-best rewrite head-to-head.
- WINNER adds: "…ease broader financial conditions—**imagine a farmer buying up a bumper crop of apples to stabilize falling local market prices, much as the Fed enters the bond market to shore up financial conditions.**"

**515063a1 / slot 6 — `[para] 3e9caa51.P7`** (winner `4bad144a`, temp 1.2): added "**Just as a fire department might use not only water but also foam and hoses to battle an unprecedented blaze, the Fed deployed multiple tools…**" — the only conf-1.0 clean sweep in that run.

**46c02c9c / slot 3 — `[para] 3dff2794.P4`** (deepseek-v4-pro, winner `10cfce9c`): 20 matches/11 decisive, original mu 24.88 → 22.48, winner 25 → **31.68** (biggest pro lift). Added a "**pilot instrument flying in dense clouds**" analogy to dramatize "setting policy stance," zero info loss.

Other verified winners followed the identical fingerprint: thermostat, valve turning/closing, dominoes, branch-office/HQ, "span longer than half a career." The judge reliably rewards **one inserted concrete metaphor/example** (or clean concision) over flat exposition.

### HURT / NO-OP — four distinct failure modes
**A) Original literally wins (true regression avoided by fallback).** `515063a1` slot 5 (`[para] 3e9caa51.P6`): original `18a02b43` beat the lone surviving temp-0.7 rewrite **conf 1.0** (the temp-1.2 and temp-2.0 rewrites self-destructed). `c89fd322` slot 4: original `60748a1b` beat both survivors (one a confident draw). `a724e6ab` slot 6: original `d23cc798` won; the creative temp-1.2 "broccoli" analogy only drew (incl. a conf-0.5 coin-flip). Pattern: when the high-temp rungs die, only the conservative near-paraphrase remains and it can't beat the original.

**B) Prior-invocation entrenchment (no-op for this run's spend).** `6ebcb33e`/`f10c2e96` slot 3 (`[para] 26ab2327.P4`): all 6 fresh rewrites lost to `654973fe`, a thinly-tested (`match_count=3, sigma=7.24`) `paragraph_rewrite` champion from a **2026-05-31** run. Two separate invocations both failed to dethrone it — the run paid to generate rewrites that changed nothing. This is the dominant no-op mode (8/18 slots across two flash runs).

**C) Length-validator kills the reasonable alternative.** `dfb4a14d` slot 2: the temp-0.7 tighten rewrite was a clean compression at **685 chars — just under the floor → dropped `length_under`** — leaving a single uncontested candidate that "won" on a 6-match sliver. The validator repeatedly discards usable prose for being marginally short.

**D) High-temp word-salad / total dropout.** Temp 1.8/2.0 routinely produce runaway or incoherent text the validator must discard: `f10c2e96` slot 3 idx5@2.0 ballooned to **12,969 chars**; `6ebcb33e` slot 7 idx5@2.0 = **10,098 chars** of garbage; idx3@1.6 sometimes passes formatValid with off-topic gibberish ("Foundresses and Reformers: Architects of London…"). Worst case: pro `3c508095` slot 9 — **all 6 rewrites empty `llm_error`**, ranking never ran, forced fallback to original.

## Deep-dive: why better paragraphs don't make a better article (follow-up investigation)

Direct article-level queries on the 11 runs isolate **four mechanisms**, ranked by evidence. It is **primarily a measurement/architecture leak**, with a secondary genuine quality cost.

### Primary — the per-slot signal can't express itself at the article level
1. **Per-slot Elo is discarded at the article boundary.** Per-slot ranking spends **6–40 matches per slot** building careful Elo. The recombined article then enters the *article* arena fresh at default 1200 and plays only **3 matches** (true for all 11 runs). None of the per-slot investment transfers — the article's entire standing is decided by 3 noisy comparisons.
2. **"Beat the parent" is the wrong bar.** The run winner is the single max over **14–25 article variants** from other generate tactics (structural_transform, lexical_simplify, grounding_enhance — 152 such variants across the 11 runs). The recombined usually beats its parent (often a *weak* parent at Elo 1105) yet sits mid-pack: 2–6 other-tactic variants rank above it. Its **average** Elo (1283) is actually higher than other tactics (1197) — it's a good variant — but "good on average" ≠ "the single max in a thin, noisy ranking."
3. **Draw-saturated + position-confounded.** The recombined draws **62% (flash) / 67% (pro)** of its 3 matches — far above this run-pool's 37.4% article rate and the 45.9% general article rate (whole table) — because strong-vs-strong full-article comparisons mostly tie. Of its few decisive matches, flash went **4 wins (as entry_A) / 4 losses (as entry_B) / 13 draws** — a pure position artifact (`winner='b'` is 0/487 at the article level too). So the decisive signal is near-random and the recombined Elo barely moves off 1200 → it can't climb to win.

### Secondary — locally optimal, globally incoherent (a real quality cost)
4. **Greedy per-slot analogy-stuffing degrades the whole.** Each "helped" rewrite wins per-slot by **adding one vivid analogy** (the dominant winning move). Recombined article-by-article, this compounds: the recombined article is **5–14% longer** than its parent in every run and accumulates **multiple unrelated metaphors**. Example — recombined `1d98f811` (did NOT win) stacks four mixed metaphors in one article: *"a single haystack fire reveals cracks in old barn boards…"*, *"much like a judge's tenure protects judicial independence"*, *"much like a fire department that only acts when a blaze threatens a whole neighborhood"*, *"like the Fed adjusting the water level in a bathtub."* Each was a per-slot winner in isolation; together they read as gimmicky/over-analogized. The per-slot objective ("add a vivid analogy") is **misaligned** with article-level coherence and concision.

### Conclusion
The "better paragraphs → better article" assumption fails for two compounding reasons: (a) the article arena is too **starved** (3 matches) and **draw-saturated** (62–67% for the recombined) to register the per-slot gains, and the per-slot Elo investment doesn't transfer; and (b) greedily optimizing each paragraph for "add an analogy" produces a longer, metaphor-jumbled, less coherent whole. The recombined article is genuinely *decent* (above-average pool Elo) but neither clearly wins nor is reliably measured as winning.

### Implied levers (for planning)
- **Give the recombined article more article-level matches** — it is the expensive end-product, yet gets the thinnest ranking (3). Or carry per-slot confidence forward / seed its rating from per-slot results instead of resetting to 1200.
- **Constrain analogy density across the article** — diversify per-slot directives so not every slot adds an analogy, or add a final article-level coherence/length pass over the recombined output.
- **Evaluate the recombined directly against its parent** (paired), since "improve the parent" is the actual goal — pooled ranking dilutes that signal.
- A **stronger article judge** (the qwen A-skew + 62–67% draws make the article verdict near-random).

## Do we track which approach rewrites each paragraph? (attribution-capability investigation)

**Short answer: not as a persisted field — but it is deterministically recoverable from `index`.**

Each rewrite is assigned one of three transformation directives, cycled by `index % 3` (`PARAGRAPH_REWRITE_DIRECTIVES` in `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts`):
- **0 — tighten/simplify** (cut padding, no new info, ~0.85× length floor)
- **1 — add ONE concrete example/analogy** (single sentence, claim unchanged)
- **2 — improve flow/rhythm** (same info, better cadence)

The directive is selected at `ParagraphRecombineAgent.ts:559` (`PARAGRAPH_REWRITE_DIRECTIVES[index % length]`) and injected into the prompt, but the persisted per-rewrite record (`execution_detail.slots[*].rewrites[*]`) stores only `index, text, slotVariantId, temperature, status, dropReason, costUsd, durationMs, formatValid` — **there is no `directive`/`approach` field.**

### Recovered per-approach effectiveness (via `index % 3`, all 11 DeepSeek invocations)

| Approach | Rewrites | Drop % | Slot wins | Temps used |
|---|---|---|---|---|
| 0 — tighten/simplify | 159 | 22.6% | 4 | 0.7, 1.6 |
| 1 — **add example/analogy** | 159 | 42.1% | **56** | 1.2, 1.8 |
| 2 — improve flow/rhythm | 159 | 57.9% | 9 | 1.4, 2.0 |

**"Add an analogy" wins 56 of 69 this-invocation slot wins (81%)** — the dominant winning move, now quantified by approach (confirms the text-inspection finding in the side-by-side examples). Tighten is the safest (lowest drop) but rarely wins; flow drops the most and rarely wins.

### Caveats / capability gap
1. **Approach and temperature are confounded.** `index` drives BOTH the directive (`index%3`) AND the temperature ladder, so approach 1 only ever runs at temps 1.2 & 1.8. Approach effect cannot be cleanly separated from temperature effect from stored data.
2. **No first-class identity → brittle attribution.** Recovering the approach requires re-deriving `index % 3` and knowing the cycling rule, which silently breaks if `rewritesPerParagraph` or the directive list changes. Unlike full-article tactics (tracked `evolution_tactics` UUIDs + `eloAttrDelta:*` attribution metrics), the per-rewrite *approach* has no tracked identity, so per-approach effectiveness is not directly queryable.
3. **Direct tie to the article-level leak.** The same approach that wins per-slot (add an analogy) is the one driving the article-level incoherence (metaphor-stacking, +5–14% length). Without a stored approach field, "how much did each approach contribute to article-level outcome" and "cap analogy density" can only be answered by re-deriving from index — adding an explicit `directive`/`approach` field to the rewrite record (and optionally an approach-level attribution metric) would make this directly trackable.

## Documents Read
### Core Workflow Docs
- docs/docs_overall/getting_started.md, architecture.md, project_workflow.md
### Core Operations Docs
- docs/docs_overall/environments.md, testing_overview.md, debugging.md; docs/feature_deep_dives/testing_setup.md
### Relevant evolution docs
- evolution/docs/paragraph_recombine.md (cost envelope, failure modes, temp ladder, D1–D20)
- evolution/docs/arena.md (per-slot arena topics, sync_to_arena, comparison schema)
- evolution/docs/rating_and_comparison.md (Elo/uncertainty, 2-pass reversal, draw logic, paragraph rubric)
- evolution/docs/data_model.md (evolution_variants/arena_comparisons/agent_invocations/metrics schema)
- evolution/docs/metrics.md (paragraph_recombine_cost, eloAttrDelta, estimation-error metrics)
- evolution/docs/multi_iteration_strategies.md (iterationConfig, rewritesPerParagraph, maxDispatches)
- evolution/docs/cost_optimization.md, strategies_and_experiments.md, variant_lineage.md, evolution_metrics.md (digested)

## Code/DB surfaces queried
- `evolution_agent_invocations` (agent_name='paragraph_recombine', execution_detail JSONB: slots[*].{rewrites,ranking,spentUsd}, paragraph_rewrite/paragraph_rank, estimationErrorPct)
- `evolution_arena_comparisons` (winner, confidence, entry_a/b, invocation_id, mu/sigma before/after)
- `evolution_variants` (variant_kind, variant_content, mu/sigma/elo_score, arena_match_count, is_winner, parent_variant_ids)
- `evolution_runs`, `evolution_strategies` (config->>'generationModel'/'judgeModel'), `evolution_metrics` (paragraph_recombine_cost, eloAttrDelta)

## Open Questions (for planning / possible follow-up)
1. **Article-level leak:** why don't per-slot wins aggregate into a winning article (esp. pro 0/4)? Is recombination introducing cross-paragraph transition breakage (D2 accepted trade-off), or is the article judge rewarding different qualities than the paragraph rubric?
2. **Judge position bias:** is the qwen A-skew biasing the helped rate? Need an A/B-swap agreement test. Would a stronger judge (and/or 2-pass reversal verification) change the helped/hurt verdict — especially for pro, whose quality the judge can't separate (53% draws)?
3. **Temperature ladder tuning for DeepSeek:** drop rungs 1.6 and 2.0 (0 winners), cap at ~1.8, double up 1.2/1.4. Fix the 3-rung truncation (`[0.7,1.2,2.0]` → `[0.7,1.2,1.4]`). Expected ~33% generation-cost cut with no historical winner loss.
4. **Length validator:** the floor discards reasonable temp-0.7 compressions at ~680c; is the floor mis-calibrated for DeepSeek's tighter outputs? Add a hard token ceiling at temp ≥1.4 to convert `length_over` drops into usable rewrites.
5. **flash vs pro is confounded** (zero topic overlap, pool-maturity asymmetry). A controlled same-topic head-to-head is needed before claiming pro > flash on quality. Is pro's ~2.2× cost worth it given the judge can't see the difference?
6. **pro reliability:** the 7 `llm_error` rewrites in `3c508095` — endpoint instability? retried or silently dropped? affects true cost.
7. **Small N:** 11 invocations, one day, one judge — confirm at larger N before acting on any model recommendation.
8. **Approach tracking:** should the per-rewrite record persist an explicit `directive`/`approach` field (and an approach-level attribution metric)? Currently approach is only recoverable via `index % 3` and is confounded with temperature — see the approach-tracking section. This is the prerequisite for cleanly measuring per-approach effectiveness and for capping analogy density (the article-level leak fix).
