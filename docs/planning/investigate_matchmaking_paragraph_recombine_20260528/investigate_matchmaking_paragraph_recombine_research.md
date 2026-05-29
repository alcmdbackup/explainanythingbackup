# Investigate Matchmaking Paragraph Recombine Research

## Problem Statement
The **per-slot paragraph variant Elo** is not moving for the `paragraph_recombine` strategy on staging — all per-slot rewrite variants sit at `elo_score = 1200` (`mu = 25`). **Scope clarified by the user during /research: this is about the paragraph-slot rewrite variants' Elo, NOT the recombined article parent's Elo.** 1200 is `DEFAULT_ELO`. The goal is to determine why per-slot ratings never move and propose a fix.

## Requirements (from GH Issue #NNN)
- Explain why all variants are at 1200 Elo for my paragraph recombine last 3 runs on stage.
- (Details: same as summary.)
- /research clarification: focus on the **Elo of the paragraph rewrites not moving**, not the recombined parents.

## High Level Summary

**ROOT CAUSE (confirmed against staging data, runs from 2026-05-29):** Per-slot paragraph comparisons resolve as **draws ~98% of the time**, so the per-slot Elo never moves off the 1200 baseline. The judge model (`qwen-2.5-7b-instruct`) cannot reliably rank the paragraph rewrites because they are **quality-equivalent paraphrases** of one another (same facts, same structure, reworded). With no real quality signal, the judge's per-call pick is dominated by presentation order; the **2-pass A/B reversal protocol correctly detects the forward/reverse disagreement and forces a TIE at confidence 0.5**. A draw calls `updateDraw()`, which — between two equal-rated (mu=25) variants — leaves `mu` unchanged and only shrinks `sigma`. Hence every paragraph variant stays at exactly `elo 1200` while `sigma` drops from 8.333 → ~7.2 (proof that matches *did* run; they just weren't decisive).

This is NOT the article-parent no-op bug from `make_fixes_paragraph_recombine_20260528` (that path is working — see below). It is a **paragraph-level judging/generation-diversity problem** specific to ranking near-equivalent short rewrites.

### Evidence (staging, read-only `npm run query:staging`)

**1. Paragraph variants: sigma moved, mu did not.** All `variant_kind='paragraph'` rows have `mu = 25` exactly and `elo_score = 1200`, but `sigma ≈ 7.19–7.28` (default is 8.333). Uncertainty dropped → matches ran; mu unchanged → all draws. Exactly one slot (`[para] 31fef5d0.P7`) shows decisive movement (variants at elo 1157.9 and 1282.2).

**2. Match outcome distribution is overwhelmingly draws at the paragraph level — but decisive at the article level, SAME runs, SAME judge:**

| Scope | winner=a (decisive) | winner=draw | avg confidence (draws) | % decisive |
|---|---|---|---|---|
| **article_arena** | 50 | 13 | 0.500 | **79%** |
| **paragraph_slot** | 3 | 124 | 0.500 | **2.4%** |

The judge produces decisive verdicts on full articles but ~98% draws on paragraph slots → the problem is paragraph-specific, not a globally broken judge.

**3. Every draw is at confidence EXACTLY 0.500** (min=max=0.5, zero rows at 0.0/0.3). Per the `aggregateWinners()` table in `rating_and_comparison.md`, confidence 0.5 = forward pass and reverse(flipped) pass **disagree** (one says A, the other says B). This is *not* a parse failure (those are 0.0/0.3) — the judge returns a clean, parseable winner each pass; the two passes simply contradict. Signature of position bias / genuine indistinguishability.

**4. Rewrites are distinct paraphrases but quality-equivalent.** Sample slot `df0376a1.P1`: original + 3 rewrites, lengths 727–874 chars, all reworded versions of the same Fed paragraph ("ensure a stable, flexible, and prosperous economic landscape" vs "fostering a stable, adaptable, and thriving economy"). No rewrite is meaningfully "better" on clarity/structure/flow/grammar — so the judge has no signal and the reversal protocol correctly reports a tie.

**5. The runs.** "Last 3 runs" = the three at `2026-05-29T02:06` (strategy **"New paragraph strategy"**, judge `qwen-2.5-7b-instruct`, gen model `google/gemini-2.5-flash-lite`), all `completed`. Two earlier runs (00:05, 00:56) show the same pattern. The pipeline ran fine end-to-end — no errors, no no-op.

**6. Secondary observation (separate from the Elo issue):** `match_count` and `arena_match_count` are `0` on every paragraph variant despite matches existing in `evolution_arena_comparisons`. The per-slot persistence path is not writing match counts back to the variant rows. This is an observability/accounting bug, not the cause of the stuck Elo, but worth fixing alongside.

### Why the reversal protocol forcing draws is "correct but unhelpful here"
The 2-pass reversal is designed to suppress position bias by demanding agreement across both orderings. When the underlying texts are genuinely equivalent, the judge can't agree with itself across orderings, so the protocol (correctly) yields a tie. The net effect for `paragraph_recombine` is that `selectWinner` over a slot pool of equivalent-quality, all-1200 rewrites has no Elo signal to pick from — it falls back to tie-break (lowest uncertainty), so the "winner" rewrite is effectively arbitrary, and per-slot leaderboards never accumulate meaningful Elo across invocations (D10's cross-invocation accumulation is starved).

> **Position-bias quantification:** if the judge were a random coin-flip on equivalent paragraphs, forward/reverse would disagree ~50% of the time (→ ~50% draws). Observed draw rate is **97.6%** (124/127). A disagreement rate that far above 50% means the judge is *near-deterministically* picking the same SLOT (position 1 = "Text A") regardless of content. On full articles the real quality gap overrides this positional prior (79% decisive); on near-equivalent paragraphs the positional prior dominates.

## Code-Level Findings (current implementation)

### Generation path — why rewrites are equivalent (informs Option A)
`ParagraphRecombineAgent.processSlot` (`evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts:389-408`) dispatches the M rewrites like this:
```ts
Array.from({ length: rewritesPerParagraph }, async (_, index) => {
  const prompt = buildParagraphRewritePrompt(parentH1, slot.originalText, slot.paragraphIndex, totalSlots);
  text = await slotLlm.complete(prompt, 'paragraph_rewrite');   // no options → no temperature
  ...
});
```
- **All M rewrites use the IDENTICAL prompt** — no per-rewrite index, tactic, angle, style, or temperature variation. They differ only by the LLM's default sampling.
- `buildParagraphRewritePrompt` (`buildParagraphRewritePrompt.ts`) instructs: *"Express the same meaning more clearly or fluently"* + Rule 1 *"PRESERVE MEANING"*. By design the output is a conservative paraphrase, not a differentiated alternative.
- `slotLlm.complete(prompt, 'paragraph_rewrite')` passes **no `temperature`** option. Generation model on staging is `google/gemini-2.5-flash-lite`.
- Net: low true quality variance among the 3 rewrites → nothing for the judge to discriminate → position bias dominates.

### Judging path — why comparisons tie (informs Option B)
- The comparison prompt is a SINGLE hardcoded function `buildComparisonPrompt(textA, textB)` (`evolution/src/lib/shared/computeRatings.ts:315`). Criteria are **article-oriented**: "Clarity and readability / Structure and flow / Engagement and impact / Grammar and style / Overall effectiveness." "Structure and flow" and "Overall effectiveness" barely apply to a single paragraph. There is **no paragraph-specific prompt and no `mode`/`taskType` parameter** to select one.
- `compareWithBiasMitigation(textA, textB, callLLM, cache)` (`computeRatings.ts:441`) is generic; `aggregateWinners` (`:413`) returns `confidence 0.5, winner TIE` exactly when forward and reverse-flipped disagree (`:433`). That is the bucket all 124 paragraph draws land in.
- The judge LLM call (`rankSingleVariant.ts:176-186`, `makeCallLLM`) uses `model: config.judgeModel`, `taskType: 'comparison'`, **no `temperature`** (judge defaults to 0) and **no reasoning effort**. The per-slot ranking reuses the run-level `config.judgeModel` (`ParagraphRecombineAgent.ts:486-488` only overrides `maxComparisonsPerVariant`), so there is currently **no way to use a different/stronger judge or reasoning mode for paragraph slots** without a code change.
- `rankSingleVariant` calls `compareWithBiasMitigation` at `:314`; a draw (winner TIE / confidence < 0.3) routes to `updateDraw`, which leaves equal-rated mu untouched.

### Levers each option can pull
- **Option A (generation diversity)** — vary the rewrite prompt per index (distinct angle/style directives), and/or pass a non-zero `temperature` per rewrite, and/or rotate a small tactic set, and/or a stronger rewrite model. Goal: produce rewrites with *real* quality variance so the judge has signal.
- **Option B (paragraph-specific judging)** — add a paragraph comparison prompt (concise, paragraph-appropriate criteria) selectable via a `mode`/`taskType`; optionally allow a per-slot judge model override and/or reasoning effort; optionally change tie-handling so a 0.5 forward/reverse disagreement triggers a tiebreak rather than freezing Elo. Goal: make the judge able to break ties it currently can't.

## Documents Read

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Relevant Docs (user-specified + discovered)
- evolution/docs/paragraph_recombine.md — the strategy under investigation; algorithm, dispatch wiring note, article-level ranking fix
- evolution/docs/rating_and_comparison.md — Elo/uncertainty model, `DEFAULT_ELO=1200`, ranking pipeline, draw/confidence handling
- evolution/docs/arena.md — per-slot arena topics, `loadArenaEntries`, `syncToArena`
- evolution/docs/architecture.md — config-driven iteration loop, dispatch table (incl. paragraph_recombine row), MergeRatingsAgent, winner determination
- evolution/docs/data_model.md — `evolution_variants` rating columns (`mu`/`sigma`/`elo_score`, default 1200/25/8.333), `evolution_arena_comparisons`, `evolution_metrics`
- evolution/docs/multi_iteration_strategies.md — `iterationConfigs[]`, `paragraph_recombine` knobs, first-iteration rules
- evolution/docs/metrics.md — `paragraph_recombine_cost`, `winner_elo`, `paragraph_slot_match_persist_failures`
- evolution/docs/evolution_metrics.md — ranking execution details, per-iteration metrics
- evolution/docs/strategies_and_experiments.md — StrategyConfig, eloPer$ (1200 baseline), per-run metrics
- docs/docs_overall/testing_overview.md — testing rules and tiers
- docs/feature_deep_dives/testing_setup.md — test config, evolution test helpers, `[TEST_EVO]` data factory
- docs/docs_overall/debugging.md — `npm run query:staging` (read-only), Supabase CLI inspection, evolution debugging queries

> Note: the following evolution docs were NOT deeply read (peripheral to the 1200-Elo question): agents/overview.md, criteria_agents.md, curriculum.md, editing_agents.md, entities.md, cost_optimization.md, logging.md, minicomputer_deployment.md, variant_lineage.md, visualization.md, reference.md, README.md. Read on demand if /research needs them (agents/overview.md and reference.md are the most likely follow-ups — agent contracts and env-var reference).

## Staging Queries Run (read-only, `npm run query:staging`)
1. `evolution_prompts WHERE prompt_kind='paragraph'` — confirmed per-slot topics exist (`[para] <parent>.P<n>`), fresh from 2026-05-29T02:07.
2. `evolution_variants WHERE variant_kind='paragraph'` — mu=25 / elo=1200 everywhere, sigma reduced to ~7.2, `match_count`/`arena_match_count`=0.
3. Winner/confidence distribution over paragraph-slot comparisons — 124 draw @0.5, 3 decisive @1.0.
4. Per-slot comparison detail for `31fef5d0.P7` (moved) and `df0376a1.P1` (all draws).
5. Clean scope split (article-arena vs paragraph-slot) for the 5 runs — article 50/13 decisive/draw, paragraph 3/124.
6. Run + strategy/judge model for the 5 runs — judge `qwen-2.5-7b-instruct`, gen `google/gemini-2.5-flash-lite`, strategy "New paragraph strategy", all completed.
7. `variant_content` previews for slot `df0376a1.P1` — distinct but quality-equivalent paraphrases.

## Code Files Read
- `evolution/src/lib/core/agents/paragraphRecombine/ParagraphRecombineAgent.ts` — per-slot pipeline: M rewrites via identical prompt, sequential `rankNewVariant`, `selectWinner`, `syncToArena`+`persistSlotMatches`. Per-slot ranking reuses `ctx.config` (only `maxComparisonsPerVariant` overridden) → no per-slot judge override today.
- `evolution/src/lib/core/agents/paragraphRecombine/buildParagraphRewritePrompt.ts` — the single rewrite prompt; "PRESERVE MEANING / express the same meaning"; no per-index variation, no temperature.
- `evolution/src/lib/shared/computeRatings.ts` — `buildComparisonPrompt` (article-oriented, no paragraph mode), `parseWinner`, `aggregateWinners` (0.5 = forward/reverse disagree → TIE), `compareWithBiasMitigation`.
- `evolution/src/lib/pipeline/loop/rankNewVariant.ts` — wrapper over `rankSingleVariant`; mutates pool/ratings; B119 in-run cutoff.
- `evolution/src/lib/pipeline/loop/rankSingleVariant.ts` — `makeCallLLM` (judge uses `config.judgeModel`, `taskType:'comparison'`, no temperature/reasoning), calls `compareWithBiasMitigation`.
- (Confirmed via docs `rating_and_comparison.md`: draw→`updateDraw`→mu-invariance on equal-rated variants. `updateDraw` lives in `evolution/src/lib/shared/rating.ts` — not re-read; behavior matches DB observation.)

## Open Questions (for planning/brainstorm)
1. **Position bias vs. genuine equivalence:** the 0.5 signature is consistent with both. Confirming which dominates would need the raw per-pass judge responses (not persisted in `evolution_arena_comparisons`). Does it matter for the fix, or is "judge can't rank equivalent paraphrases" sufficient?
2. **Generation diversity:** should the fix push rewrites to be *more differentiated* (prompt/temperature/model change), so there's real quality variance to rank? Or is paraphrase-equivalence inherent to single-paragraph rewriting?
3. **Judging:** should paragraph comparisons use a stronger judge / reasoning mode / a paragraph-specific prompt (the current 5 criteria — "structure and flow" — barely apply to one paragraph)?
4. **Tie handling:** when forward/reverse disagree (0.5), should the slot ranking do a tiebreak 3rd pass, or pick by a secondary signal, rather than calling it a draw that freezes Elo?
5. **Is "all draws" actually a problem to fix, or expected?** If rewrites are genuinely equivalent, freezing at 1200 is arguably honest. The user's expectation ("Elo should move") implies they want the system to *differentiate* rewrites — clarify the desired outcome before choosing a fix.
6. **Secondary:** fix `match_count`/`arena_match_count` not being written back to paragraph variant rows (per-slot persistence path).

## Fix Directions (candidate options for `_planning.md`)
- **A — Generation diversity:** raise rewrite temperature / vary tactic per rewrite / use a stronger gen model so rewrites differ in quality, giving the judge real signal.
- **B — Paragraph-specific judging:** dedicated paragraph comparison prompt + optionally a stronger/reasoning judge for slot ranking.
- **C — Tie-break on disagreement:** on confidence-0.5 disagreement, run a 3rd decisive pass or a different comparison mode instead of forcing a draw.
- **D — Accept equivalence, change winner selection:** if rewrites are equivalent, select by a cheaper deterministic signal (e.g., closest-to-target length, sentence-verbatim ratio) and stop spending judge calls that can't discriminate.
- **E — Documentation only:** if this is expected behavior, document that paragraph_recombine rewrites are often quality-equivalent and per-slot Elo will be flat; surface a wizard note.
