# Analyze First Paragraph Recombine Evolution Run Research

## Problem Statement

Analyze what happened for evolution run `4a48fcd3-21fa-4bd4-9735-a688ebdef1ad` on the **staging** database, because the results look strange. (The originally-supplied ID `d8b666a7-fbf4-4b89-98ee-6382311c1787` turned out to be the **`paragraph_recombine` invocation** within this run, not the run ID.) This is an early real `paragraph_recombine` run after the dispatch wiring shipped in `make_fixes_paragraph_recombine_20260528`.

## Requirements (from GH Issue #NNN)

- Analyze what happened for run `4a48fcd3-21fa-4bd4-9735-a688ebdef1ad` (invocation `d8b666a7-...`) on stage as results look strange.
- (Details: same as summary.)

## High Level Summary

The run **completed successfully** and its **winner is a good, complete article** (`2c558d62`, structural_transform, 7875 chars, Elo 1165). The "strange" part is that the **`paragraph_recombine` iteration was a near-total no-op**: it consumed only **$0.000224 of its $0.045 (90%) allocation**, processed a **single paragraph**, and emitted a recombined variant that is a **byte-identical copy of a truncated junk parent**. Total run cost was **$0.005 of the $0.05 cap (~10% used)**.

The behavior is the product of a **four-link chain**, none of which raised a warning or error (logs were clean):

1. **A generate variant came back truncated and entered the pool undetected.** Iteration 0 (`generate`, 10%) produced 4 article variants; 3 are complete (6k–10k chars), but `d94fa269` (grounding_enhance, gemini-2.5-flash-lite) was **truncated mid-sentence at 490 chars / 1 body paragraph** ("…the nation"). It still has `synced_to_arena = true`.
2. **`paragraph_recombine` picked that truncated variant at random.** Iteration 1 (`paragraph_recombine`, 90%, `sourceMode: pool`, `qualityCutoff topN=5`) resolves a parent via `resolveParent`, which takes the top-5 by Elo and then **picks uniformly at random**. With a ~4–5-variant pool, topN=5 covers the whole pool, so the parent is effectively random — and it landed on the truncated `d94fa269`.
3. **On a 1-paragraph article the agent does almost nothing.** `extractParagraphsWithRanges` yields **1 slot** (title/heading lines are filtered). 3 rewrites were generated, **2 dropped `length_over`** (±10% length cap: 342-char original → window ≈ [308, 376]; the two *complete* rewrites were ~390/470 chars), and the single survivor (363 chars) was **itself truncated mid-sentence**. It **drew** against the original in the one match → `winnerSource: "original"` → recombined article = the parent verbatim (`e33d9c80`, Elo 1112, not winner).
4. **Single-agent dispatch leaves the 90% budget stranded.** The `paragraph_recombine` branch dispatches **exactly one** agent with no top-up loop (intentional per design D18). A tiny parent → fixed, tiny work → the 90% iteration budget is structurally unspent.

## Key Findings

| # | Finding | Evidence |
|---|---------|----------|
| F1 | Run `4a48fcd3` **completed**, prompt-based, experiment `92b63d83`, strategy `f457885f` ("New paragraph strategy"), budget cap $0.05, runner `v2-gmktec-vm-…` (minicomputer), ~86s. No error. | `evolution_runs` row |
| F2 | Strategy = 2 iterations: `generate` (seed, 10%) → `paragraph_recombine` (pool, topN=5, 3 rewrites/para, 8 comp/para, 12 paras max, 90%). Gen `google/gemini-2.5-flash-lite`, judge `qwen-2.5-7b-instruct`. | `evolution_strategies.config` |
| F3 | Generate produced 4 articles: `2c558d62` (1165.4, **winner**, 7875 chars), `56d34f02` (1162.9, 9923), `7a69e22f` (1111.3, 6067), and **`d94fa269` (1111.9, 490 chars, 1 paragraph, truncated mid-sentence)**. | `evolution_variants` |
| F4 | `paragraph_recombine` invocation `d8b666a7`: success, **cost $0.000224**, 1 slot, parent `d94fa269`, `winnerSource: original`, `winnerIsOriginal: true`, recombined `formatValid: true` len 490. | invocation `execution_detail` |
| F5 | Slot: 3 rewrites, 2 dropped `length_over` + `formatValid:false`; the 1 survivor (`ad06a227`, 363 chars) is truncated mid-sentence; 1 match → draw → original retained. `costUsd:0` recorded on each rewrite in detail. | `execution_detail.slots[0]` |
| F6 | Recombined variant `e33d9c80` (paragraph_recombine, Elo 1112.4, **not** winner) is 490 chars / 1 paragraph, byte-identical to parent `d94fa269`. | `evolution_variants` |
| F7 | Costs: total **$0.005006** / $0.05 cap. generation $0.002458, ranking $0.002324, **paragraph_recombine $0.000224**, seed $0.000000. `paragraph_slot_match_persist_failures` absent (no failures). winner_elo 1165.4. | `evolution_metrics` (run) |
| F8 | **No `max_tokens` cap** is set on generation calls (the `OUTPUT_TOKEN_ESTIMATES.generation=1000` is for budget/cost only — complete siblings reached ~2500 tokens). `finish_reason` is logged but **never checked for `'length'`**; truncated completions are silently accepted. | `createEvolutionLLMClient.ts`, `src/lib/services/llms.ts:530` (Explore agent) |
| F9 | `validateFormat` (`evolution/src/lib/shared/enforceVariantFormat.ts`) enforces **only structure** — one H1, ≥1 heading, no bullets/lists/tables, paragraphs ≥2 sentences (25% tolerance). **No minimum length, no paragraph-count floor, no end-of-text/sentence-completeness check.** A 490-char article ending "…the nation" passes. | Explore agent |
| F10 | `resolveParent` (`evolution/src/lib/pipeline/loop/resolveParent.ts:74–108`): topN → `computeTopNIds` (Elo desc) then **uniform random** (`Math.floor(rng()*eligibleIds.length)`). With topN ≥ pool size, parent is effectively random across the whole pool. Ratings snapshot taken at iteration start. | Explore agent |
| F11 | `paragraph_recombine` branch (`runIterationLoop.ts:~1270–1391`) dispatches **one** agent, **no top-up loop** (generate has one at ~706–773). Single-agent-per-iteration is intentional (D18: parallelism is internal — N slots × M rewrites). Consequence: the iteration `budgetPercent` does not drive more work; a small parent strands the allocation. | Explore agent |
| F12 | Length cap (`paragraphSlots.ts:115–139`): symmetric **±10%** (ratio < 0.9 → `length_under`, > 1.1 → `length_over`). `extractParagraphsWithRanges` splits on `\n\n` and filters heading-only / HR / emphasis-only / label / code lines, so only **body paragraphs** become slots. | Explore agent |
| F13 | No warn/error logs for the run, and no invocation-level logs for `d8b666a7`. The whole chain executed **silently**. | `evolution_logs` |

## Root Causes (ranked by impact)

- **RC1 — Silent generation truncation + no completeness validation (broad, highest impact).** A provider-side truncated completion (gemini-2.5-flash-lite) entered the pool and arena because nothing checks `finish_reason==='length'`, no `max_tokens` floor/guard exists, and `validateFormat` has no min-length/sentence-completeness rule. Affects **all** agent types, not just paragraph_recombine. (F8, F9, F3)
- **RC2 — `paragraph_recombine` parent selection is uniform-random among top-N.** With `topN ≥ poolSize` the parent is effectively random, so the agent can refine a broken/truncated variant instead of the strongest one. (F10, F4)
- **RC3 — ±10% rewrite length cap is too strict.** An LLM rewriting a paragraph naturally expands it; the window rejected both *complete* rewrites and admitted a *truncated* one. (F5, F12)
- **RC4 — Single-agent dispatch makes `budgetPercent` misleading for paragraph_recombine.** 90% of the run budget was allocated but structurally unusable for a 1-paragraph parent. Intended design, but surprising and wasteful. (F11, F7)

## Open Questions

1. **What did the user perceive as "strange"** — the no-op recombine / identical copy, the wasted 90% budget, the truncated article in the arena, or all three? (Confirms which RC to prioritize.)
2. **Is RC1 (truncation) reproducible or a one-off gemini flake?** Need ≥1 more truncated sample, or to inspect whether gemini-2.5-flash-lite returns `finish_reason='length'` here. (Would need either a deployed-log check or a controlled re-run.)
3. **Should `resolveParent` bias toward higher Elo for paragraph_recombine** (or exclude degenerate/short variants), rather than uniform-random?
4. **Should paragraph_recombine guard against tiny/1-paragraph parents** (skip / fall back to a larger pool variant), and/or should the length cap be widened/asymmetric?
5. **Minor:** `seed_cost = 0` for a prompt-based run — is seed-article generation cost being attributed correctly, or is this a separate small accounting gap? (Not central to the strange result.)
6. **Scope question for the user:** is this project analysis-only (document + recommend), or should it carry one or more fixes (e.g., RC1 truncation guard)?

---

# Second Invocation: `a0dac7f8` (run `abeea612`) — healthy contrast

Analyzed at user request as a second data point. **Verdict: this one is healthy — paragraph_recombine worked as intended and WON its run.** It's the instructive contrast to the first (strange) run, and it isolates which root causes are decisive vs. merely wasteful.

## What happened

Run `abeea612-784d-4777-a27d-cef7e87ec903` (completed, **same strategy `f457885f`**, same prompt `a546b7e9`, **different experiment `dfac8e3f`**, $0.05 cap, minicomputer runner, ~113s). Invocation `a0dac7f8` is its iteration-2 `paragraph_recombine`.

- The `generate` iteration produced **3 article variants, all complete** (6.2k–8.2k chars, no truncation this time).
- `resolveParent` (uniform-random among top-N) happened to pick the **highest-Elo** variant `5550ae51` (structural_transform, Elo 1155.9, 8159 chars, 13 paragraphs).
- The agent decomposed it into **8 slots** and emitted an **8024-char recombined article** `7cb3bad7` that **won the run at Elo 1169.7 — higher than its parent (1155.9).** A genuine improvement.

## Key findings (second invocation)

| # | Finding | Evidence |
|---|---------|----------|
| G1 | Invocation `a0dac7f8`: success, cost **$0.003615**, 8 slots, parent `5550ae51`, recombined `formatValid:true` len 8024. | invocation row + `execution_detail` |
| G2 | **5 of 8 slots dropped ALL 3 rewrites** (slots 0,2,4,6,7 → `winnerSource:null`, fell back to original). 3 slots (1,3,5) took a `this_invocation` rewrite. | `execution_detail.slots[*]` |
| G3 | **16 of 24 rewrites dropped, every one `length_under`** (none `length_over`, none other reasons). | dropReason aggregation |
| G4 | The dropped rewrites are **complete, well-formed paragraphs, just compressed** — slot 0 original 1137 chars; its 3 rewrites were 855/774/933 chars (ratios 0.75/0.68/0.82), each ending on a full sentence. The ±10% floor (ratio<0.9) rejected all three. | slot 0 rewrite text/endings |
| G5 | Recombined article `7cb3bad7` (paragraph_recombine, gen 2) is the **run winner**, Elo **1169.7 > parent 1155.9**. 3 of 8 paragraphs replaced; 5 kept original. | `evolution_variants` |
| G6 | Costs: total **$0.007760**/$0.05; paragraph_recombine **$0.002955** of its $0.045 (90%) allocation (~6.6% used); generation $0.002193, ranking $0.001952, seed $0. No `paragraph_slot_match_persist_failures`. | `evolution_metrics` (run) |

## Cross-run synthesis (runs `4a48fcd3` vs `abeea612`)

| Aspect | Run 4a48fcd3 (strange) | Run abeea612 (healthy) |
|---|---|---|
| Generate variants | 4; one truncated to 490 chars (`d94fa269`) | 3; all complete |
| Parent picked (random among top-N) | the **truncated 1-paragraph** variant | the **highest-Elo complete** variant |
| Slots processed | 1 | 8 |
| Rewrite drops | 2/3 `length_over` | 16/24 `length_under` |
| Recombined outcome | byte-identical no-op copy; not winner | improved article; **won run** (Elo +14 vs parent) |
| paragraph_recombine spend | $0.000224 / $0.045 | $0.002955 / $0.045 |

**Conclusions:**
- **RC2 (uniform-random parent pick) is the decisive swing factor.** Same strategy, same prompt; the only difference in fate was which parent the random selector grabbed. Run 1 grabbed junk → no-op; run 2 grabbed the best → win. Biasing toward higher Elo (and/or excluding degenerate parents) would have made run 1 behave like run 2.
- **RC1 (silent truncation) only bites when a truncated variant exists in the pool.** abeea612 had none, so it was fine. But nothing prevents recurrence — the gap is real, just probabilistic.
- **RC3 (±10% length cap) is systemic and now firmly evidenced as too strict in BOTH directions.** Run 1 dropped rewrites for being too long; abeea612 dropped ~62% for being too short — and G4 proves those drops were *complete, high-quality* rewrites the model legitimately compressed. The cap wastes most generated rewrites (and the LLM spend on them) and forecloses improvement on the affected slots (5/8 here fell back to original purely due to the floor).
- **RC4 (single-agent dispatch → stranded budget) is systemic** but benign — both runs used <7% of the paragraph_recombine allocation regardless of outcome.

This second data point **does not add a new root cause**; it confirms RC2/RC3/RC4 and shows the pipeline produces a good result when RC1/RC2 happen to break favorably. (Re the ranked follow-ups in the planning doc: RC3's effective drop rate ≈ 62% across both runs argues for raising its priority alongside RC2.)

---

## Documents Read

### Core Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Testing / Debugging Docs (user-tagged)
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md (used `npm run query:staging` read-only path)

### Supplementary Docs (user-confirmed)
- docs/docs_overall/environments.md
- docs/feature_deep_dives/admin_panel.md _(not yet read)_
- docs/feature_deep_dives/metrics_analytics.md _(not yet read)_

### Evolution Docs
- README, paragraph_recombine, architecture, multi_iteration_strategies, data_model, variant_lineage, rating_and_comparison, arena, metrics, cost_optimization, reference (partial), logging

## Code Files Read (via Explore agents)
- `evolution/src/lib/pipeline/infra/createEvolutionLLMClient.ts` — no `max_tokens` cap; OUTPUT_TOKEN_ESTIMATES used for budget only; no finish_reason check.
- `src/lib/services/llms.ts` (~line 530) — `finish_reason` extracted/logged, never checked for `'length'`.
- `evolution/src/lib/shared/enforceVariantFormat.ts` — structural-only format validation (no min-length / completeness).
- `evolution/src/lib/pipeline/loop/resolveParent.ts` (74–108) — top-N then uniform-random parent pick.
- `evolution/src/lib/pipeline/loop/runIterationLoop.ts` (~1270–1391) — dedicated single-dispatch paragraph_recombine branch, no top-up.
- `evolution/src/lib/shared/paragraphSlots.ts` (115–139, 42–88) — ±10% length cap; body-paragraph-only slot extraction.

## Investigation Method (reproducible)
All staging reads were via the read-only `npm run query:staging` path (debugging.md).

**Run 1 (strange):** run `4a48fcd3-21fa-4bd4-9735-a688ebdef1ad`, invocation `d8b666a7-fbf4-4b89-98ee-6382311c1787`, parent variant `d94fa269-3b11-4ff9-be4d-0002592c9b6d`, recombined variant `e33d9c80-6955-48e8-88c7-ae2380b5c31d`, surviving rewrite `ad06a227-37fa-4182-9032-c1369efb1a6d`, experiment `92b63d83-6d8f-4df7-84b1-396c5f2caa44`.

**Run 2 (healthy):** run `abeea612-784d-4777-a27d-cef7e87ec903`, invocation `a0dac7f8-de4c-43b1-a597-d0c84806dddd`, parent variant `5550ae51-8f0f-4325-951b-1add01902dd5`, recombined/winner variant `7cb3bad7-c4c9-4b77-bc87-5afe6172830e`, experiment `dfac8e3f-e4d9-47a8-8075-f51c569bf76f`.

**Shared:** strategy `f457885f-1dde-446d-9c90-2c94046c6974` ("New paragraph strategy"), prompt `a546b7e9-f066-403d-9589-f5e0d2c9fa4f`.
