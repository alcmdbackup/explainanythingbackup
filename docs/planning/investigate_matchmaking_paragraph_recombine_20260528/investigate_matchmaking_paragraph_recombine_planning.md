# Investigate Matchmaking Paragraph Recombine Plan

## Background
Diagnosis complete (see research doc). The **per-slot paragraph rewrite Elo** never moves off 1200 because **~98% of per-slot comparisons resolve as draws** (124/127, all at confidence exactly 0.5). The 3 rewrites per slot are quality-equivalent paraphrases (same prompt, no temperature/angle variation), so the judge (`qwen-2.5-7b-instruct`) has no real signal and near-deterministically picks position 1; the 2-pass reversal correctly converts that to a tie; `updateDraw` between equal-rated variants leaves mu (elo) at 1200 and only shrinks sigma. The article-parent path is fine (79% decisive). This project explores two complementary fixes the user chose: **A — generation diversity** (make rewrites genuinely differ in quality) and **B — paragraph-specific judging** (let the judge discriminate / break ties).

## Requirements (from GH Issue #NNN)
- Explain why all variants are at 1200 Elo for my paragraph recombine last 3 runs on stage. **(Done — root cause confirmed.)**
- /research clarification: focus on the Elo of the **paragraph rewrites** not moving, not the recombined parents.
- Build out fixes along directions **A (generation diversity)** and **B (paragraph-specific judging)**.

## Problem
Per-slot ranking can only move Elo when the judge returns *decisive* matches. Today it can't, for two compounding reasons: (1) the M rewrites are near-identical paraphrases (identical prompt, no diversity knobs), so there is no true quality gap to detect; and (2) the comparison uses an article-oriented prompt and a judge that exhibits strong position bias on short, similar texts, so even real differences would often tie. Fix A attacks (1); Fix B attacks (2). **A is necessary (without quality variance, a better judge still correctly ties); B raises the ceiling once A creates variance.**

## Options Considered
*(Diagnostic options A/B/C from /initialize are resolved — root cause is the draw-dominated per-slot ranking. The options below are the FIX directions the user selected to explore.)*

- [x] **A — Generation diversity** (SELECTED): A2 distinct directives + content-additive + A1 temperature ladder. Sub-approaches A1–A4 below.
- [x] **B — Paragraph-specific judging** (SELECTED: B1 only): paragraph comparison prompt via default-safe `mode` param. B2/B3 held as escalations. Sub-approaches B1–B4 below.
- [x] *(Set aside, per user — decided)* A4 single multi-rewrite call; B2 per-slot judge override; B3 tiebreak; D deterministic winner; E docs-only. Fallbacks if A2+B1 underperform.

## Brainstorm: Option A — Generation Diversity

Goal: produce rewrites with **genuine quality variance** (not just lexical variance) so one can legitimately beat another.

| # | Approach | What changes | Pros | Cons / risks |
|---|----------|--------------|------|--------------|
| **A1** | Per-rewrite **temperature ladder** | Pass distinct `temperature` per index (e.g. 0.3 / 0.7 / 1.0) to `slotLlm.complete(prompt, 'paragraph_rewrite', { temperature })` | Tiny diff; cost-neutral; keeps prompt | Temperature changes *wording*, not *quality dimension* — may still yield equivalent paraphrases (the exact thing the judge can't rank). High temp → more validation drops. Must respect model `maxTemperature`. |
| **A2** | Per-rewrite **distinct directives** (angle/style axes) | Each index gets a different transformation instruction (e.g. 0=tighten/simplify, 1=add concrete example/analogy, 2=improve flow & rhythm) injected into the rewrite prompt | Creates real quality variance → judge gets signal. Aligns with existing tactic philosophy. Same # of LLM calls (cost-neutral). **Most likely to actually move Elo.** | More prompt eng.; "add example" can change length (validation drop) or strain Rule 1 "preserve meaning"; directives must be paragraph-appropriate; need a small curated set. |
| **A3** | Stronger / dedicated **rewrite model** | Thread the schema's reserved `paragraphRewriteModel` knob to the agent's rewrite calls (currently the agent uses `ctx.defaultModel` = generationModel; the knob appears unplumbed) | Better model → richer rewrites; knob already in `iterationConfigSchema` | Cost; same model+prompt still yields similar rewrites → only helps *combined* with A1/A2. Must verify the knob is actually threadable. |
| **A4** | **Single multi-rewrite call** | One LLM call asks for M deliberately-different rewrites (numbered), model self-diversifies | Model avoids near-dups; cheaper (1 call); natural diversity | Invasive: parse M from one response, per-rewrite cost/variantId mapping, one failure loses all M, breaks parallel structure. |

**A recommendation (for discussion):** lead with **A2** (distinct directives — the only one that targets *quality* variance), optionally stack **A1** (cheap booster). **A3** is a follow-on knob; **A4** is a larger refactor to keep as alternative. Key sub-decision: do we allow content-additive directives (relax Rule 1) or keep meaning fixed and diversify only structure/style (safer, less variance)?

## Brainstorm: Option B — Paragraph-Specific Judging

Goal: let the judge **discriminate** between paragraph rewrites (and stop spurious position-bias ties).

| # | Approach | What changes | Pros | Cons / risks |
|---|----------|--------------|------|--------------|
| **B1** | **Paragraph comparison prompt** | Add a paragraph variant of `buildComparisonPrompt` (concise, paragraph-appropriate criteria: clarity, concision, meaning-fidelity, sentence fluency; "avoid TIE unless truly identical"), selected via a `mode`/`taskType` threaded through `compareWithBiasMitigation` → `rankSingleVariant` | Fixes "article criteria don't fit a paragraph"; nudges the judge to commit. Moderate diff. | Won't fix position bias when texts are *genuinely* equivalent (needs A). Touches shared comparison code used by all agents → must default to current behavior (regression-safe). |
| **B2** | **Per-slot judge model / reasoning** | Optional `paragraphJudgeModel` and/or reasoning effort for per-slot ranking (the per-slot config already special-cases `maxComparisonsPerVariant` at `ParagraphRecombineAgent.ts:486-488`) | A stronger/reasoning judge resists position bias on short texts; localized to slots; judge-agreement research already exists | Cost + latency; doesn't help if rewrites equivalent; needs schema + plumbing; confirm model supports reasoning. |
| **B3** | **Tiebreak on 0.5 disagreement** | When `aggregateWinners` returns confidence 0.5, run a content-anchored 3rd pass ("are these meaningfully different? if not TIE; else which is better & why") instead of recording a draw | Directly targets the exact bucket all 124 draws fall in; converts position-bias ties into decisions | **Theoretically fraught**: 2-pass reversal *intends* disagreement = "can't tell" = tie. A naive 3rd pass is just another biased sample → re-introduces the bias the protocol suppresses. Only safe if content-anchored. Touches shared code. |
| **B4** | **Near-duplicate gate before ranking** | Pre-rank similarity check (Jaccard / `sentence_verbatim_ratio` — already in codebase) to skip judge calls on equivalent rewrites and pick deterministically | Stops wasting judge calls on unrankable pairs; complements A | Doesn't make Elo *move* — it stops pretending to. Really a cost/clarity fix; pairs with A. |

**B recommendation (for discussion):** **B1** (paragraph prompt) is the cleanest standalone judging improvement; **B2** is a measured escalation; **B3** only with a content-anchored design + explicit risk acceptance; **B4** as a guard/cost-saver. Default the `mode` param so all existing (article/swiss/debate) callers are byte-for-byte unchanged.

## How A and B combine + recommended exploration order
1. **A2** first — does diversity alone lift the per-slot decisive rate above 2.4% and move mu off 1200? (Cheapest, highest-leverage.)
2. Layer **B1** — measure decisive-rate lift from a paragraph-fit prompt on the now-differentiated rewrites.
3. Escalate to **B2** (stronger/reasoning judge) and/or **A1**/**A3** only if A2+B1 is insufficient.
4. **B4** as a cost guard; **B3** only if explicitly desired (with content-anchored design).
5. **Secondary fix (independent):** write `match_count`/`arena_match_count` back to paragraph variant rows (currently always 0 despite matches).

## Decisions (resolved with user 2026-05-28)
- **A scope:** allow ALL of A2 + content-additive directives + A1 temperature ladder. Rewrites get distinct per-index directives spanning structure/style AND content-additive (may add an example/analogy), plus a per-index temperature schedule in the **1.0–2.0** range (high, to maximize diversity — user choice 2026-05-28).
- **B scope:** **B1 only.** Paragraph comparison prompt via a default-safe `mode` param. No B2 (per-slot judge override) or B3 (tiebreak) for now — held as escalations if A+B1 underperforms.
- **Cost:** A1/A2 cost-neutral; B1 cost-neutral. No added spend this round.
- **Success metric (objective gate, committed):** across **≥2 fresh staging runs** of a `paragraph_recombine` strategy (report the comparison sample size N): (1) per-slot **decisive rate ≥ 30%** (vs the 2.4% baseline — a >10× lift; the article-level judge hits ~79% as an upper reference), AND (2) **≥1/3 of slots** produce a non-original winner whose `mu` moved off 25 (elo off 1200) by ≥ ~30 Elo. (Thresholds are provisional and tunable with the user, but the gate must be numeric + multi-run, not eyeballed.) Also report the rewrite **validation drop rate** (guards the length-cap regression). **Rollback:** `comparisonMode` defaults to `'article'` (B reverts by leaving the default); the whole agent has kill-switch `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED=false` (`runIterationLoop.ts:1276`).

## Firmed Phased Execution Plan

### Phase 1: Generation diversity (A2 + content-additive + A1)
- [x] Define an ordered `PARAGRAPH_REWRITE_DIRECTIVES` set (in/near `buildParagraphRewritePrompt.ts`) spanning the allowed axes, e.g.: (0) tighten & simplify [meaning-preserving], (1) add ONE concise concrete example/analogy that reinforces the point [content-additive], (2) improve flow & vary sentence rhythm [style]. Indexable/cyclable for `rewritesPerParagraph` 1–6 via `DIRECTIVES[i % len]`. **Bespoke (not `SYSTEM_GENERATE_TACTICS`):** the existing article tactics are section/heading-scoped ("restructure sections", "add headings") and would routinely violate the paragraph format/length gates — a small paragraph-scoped set is the right call; note this rationale in code.
- [x] Add a `directive` param to `buildParagraphRewritePrompt(...)` (optional, defaulted so the single existing caller at `ParagraphRecombineAgent.ts:396` and the to-be-created test still compile); inject an "APPROACH FOR THIS REWRITE" block. **Factual correction (from review):** Rule 1 *already* permits content-additive ("New examples, analogies, or supporting details are fine as long as they reinforce…", `buildParagraphRewritePrompt.ts:33-35`) — so NO relaxation is needed; we only inject the per-index directive. Drop the earlier "reword Rule 1" step.
- [x] Add a per-index temperature schedule spanning **1.0–2.0** (M=3 → `[1.0,1.5,2.0]`; general `temp_i = 1.0 + i/(M-1)` for M>1, `1.5` for M=1), passed via `slotLlm.complete(prompt, 'paragraph_rewrite', { temperature })` in `ParagraphRecombineAgent.processSlot` (currently passes NO options arg — this is a real wiring change). **Clamp is NOT automatic** (`createEvolutionLLMClient.ts:138-140` passes `options.temperature` straight through; only `agentName==='ranking'` is forced to 0). Implementation MUST: call `getModelMaxTemperature(ctx.defaultModel)` (`src/config/modelRegistry.ts:204`, already used at `schemas.ts:858`) and (a) if it returns a number, clamp `temp_i = min(temp_i, cap)`; (b) if it returns `null` (model rejects temperature, e.g. o3-mini), OMIT the temperature option entirely; (c) if `undefined` (unknown model), pass through. `google/gemini-2.5-flash-lite` cap = 2.0, so the 1.0–2.0 ladder is unclamped today.
- [x] **Judge-temp leak to fix alongside (review finding):** per-slot judge calls are relabeled `'paragraph_rank'` (`ParagraphRecombineAgent.ts:497-498`), but `createEvolutionLLMClient` forces temp 0 only when `agentName==='ranking'` — so `'paragraph_rank'` judge calls currently resolve to the provider DEFAULT temperature, undermining the 2-pass-reversal determinism this whole fix relies on. Fix: include `'paragraph_rank'` in the temp-0 branch (or pass `temperature: 0` on the relabel proxy's rank calls). Add a unit test asserting paragraph_rank judge calls go out at temp 0.
- [x] **Length-cap collision (plan's highest-risk item):** content-additive + temp 2.0 + the ±20% cap in `validateParagraphRewrite` (`paragraphSlots.ts:126-128`, ratio 0.80–1.20) will raise silent `length_over` drops; if a slot's survivors hit 0 (`ParagraphRecombineAgent.ts:469`) it keeps the original → re-ties (defeats the fix). Keep the example directive explicitly "ONE concise sentence". Drop-rate guard test is REQUIRED (see Testing), not optional; also watch drop rate in Phase 3.
- [x] Unit tests (see Testing for the corrected, deterministic specs).

### Phase 2: Paragraph judging (B1)
- [x] Add `mode: 'article' | 'paragraph'` (default `'article'`) to `buildComparisonPrompt` in `computeRatings.ts`. `'article'` output byte-for-byte unchanged. Keep the `## Text A` / `## Text B` labels and the exact A/B/TIE output contract so `parseWinner` heuristics (incl. the `TEXT A`/`TEXT B` phrase fallback) keep working unchanged.

  **Draft paragraph prompt** (variable texts placed LAST so the instruction/criteria block is a stable, cacheable prefix across every comparison and both reversal passes):
  ```
  You are an expert writing evaluator. You will be shown two versions (Text A and
  Text B) of the SAME single paragraph from a longer article. Decide which version
  is the stronger paragraph.

  ## Evaluation Criteria (judge at the paragraph level)
  - Clarity and concision — the point made cleanly, without padding
  - Sentence fluency and rhythm — smooth, well-varied sentences
  - Fidelity — preserves the original claim/conclusion (no distortion or drift)
  - Usefulness — any added example or detail genuinely sharpens the point

  ## Instructions
  Pick the stronger paragraph. Differences are often small — that is expected and
  fine. Answer "TIE" ONLY if the two are genuinely indistinguishable in quality;
  otherwise choose the better one even by a slim margin.

  Respond with ONLY one of these exact answers:
  - "A" if Text A is better
  - "B" if Text B is better
  - "TIE" only if truly indistinguishable

  ## Text A
  ${textA}

  ## Text B
  ${textB}

  Your answer:
  ```
  Differences vs the article prompt: (1) **ordering** — the static framing/criteria/instructions come first and the variable `Text A`/`Text B` come last, so providers that support prefix caching cache the whole instruction block (the article prompt interleaves texts in the middle; intentionally left as-is for `'article'` mode). (2) paragraph framing ("two versions of the SAME single paragraph"); (3) drops article-level criteria ("Structure and flow", "Engagement and impact", "Overall effectiveness") for paragraph-level ones (concision, sentence fluency, **fidelity** to original meaning, **usefulness** of added detail); (4) a TIE-discouraging instruction ("pick the better one even by a slim margin") to counteract the over-tying.
- [x] **Corrected threading (review found the original description wrong — `makeCallLLM` does NOT build the prompt).** The prompt is built inside `compareWithBiasMitigation` (`computeRatings.ts:455-456`, forward+reverse `buildComparisonPrompt(textA,textB)`). Exact change set:
  1. `buildComparisonPrompt(textA, textB, mode: 'article'|'paragraph' = 'article')` — new 3rd param, `'article'` branch returns the *current literal* byte-for-byte.
  2. `compareWithBiasMitigation(textA, textB, callLLM, cache?, mode: 'article'|'paragraph' = 'article')` — new TRAILING optional param, forwarded to both `buildComparisonPrompt` calls. **Shared function** — also called by `SwissRankingAgent.ts:141` and the article-ranking path 4-arg; the trailing default keeps every existing caller byte-identical.
  3. `rankSingleVariant` (`rankSingleVariant.ts:314` call site) reads `config.comparisonMode` and passes it to `compareWithBiasMitigation`. `makeCallLLM` is untouched (it only builds the judge caller).
  4. `rankNewVariant` already forwards `config` unchanged → no signature change needed (mode rides on config).
  5. **Schema:** add `comparisonMode: z.enum(['article','paragraph']).optional()` to `evolutionConfigBaseSchema` in `evolution/src/lib/schemas.ts` so `EvolutionConfig` (= `z.infer<…>`, `pipeline/infra/types.ts:23`) carries the field and the `perSlotConfig` spread typechecks. It is a run-internal override (never set at strategy level); confirmed NOT in `hashStrategyConfig` input, so strategy `config_hash`/dedup is unaffected. No `.strict()` on the config schema, so omission stays valid.
- [x] In `ParagraphRecombineAgent.processSlot`, set `comparisonMode: 'paragraph'` on the existing `perSlotConfig` (`ParagraphRecombineAgent.ts:488`, which already overrides `maxComparisonsPerVariant`) so per-slot ranking uses the paragraph prompt. Article-level ranking (Step 6, `config: ctx.config` unmodified) keeps `'article'`.
- [x] **Cache note:** `compareWithBiasMitigation`'s internal `makeCacheKey` (`computeRatings.ts:401-404`) is keyed on TEXTS only (not mode). Safe today because each slot uses a fresh slot-local cache that only sees `'paragraph'` and article ranking uses its own cache — no cross-mode collision. Add a one-line comment that `makeCacheKey` assumes mode-homogeneous caches.
- [x] Unit tests: see Testing for the corrected, deterministic specs (exact-equality article guard + paragraph-mode emission + no-mode-arg back-compat).

> **Honest limitation of B1:** the prompt change helps only when there's a *real* (even small) quality difference for the judge to lock onto consistently across both reversal passes. On genuinely-equivalent paragraphs the judge will still default to position and the reversal will still (correctly) tie. That's why **A is the load-bearing fix** — B1 raises the conversion of A's small real differences into decisive matches; it does not, by itself, defeat position bias on equivalent text.

### Phase 3: Measure (against the objective gate above)
- [ ] **(DEFERRED — runs post-merge on staging; see PR exception)** Run ≥2 fresh `paragraph_recombine` staging runs. Via `query:staging` compute: per-slot decisive rate (`winner='a'|'b'` vs `draw` over the slot-topic comparisons), # slots with a non-original/non-1200 winner, and the rewrite validation drop rate. Record before/after numbers + N in the progress doc and check against the committed gate. If the gate fails, do NOT ship — diagnose (most likely suspects: drop rate starving survivors, or rewrites still equivalent) before escalating to A3/B2.

### Phase 4: Secondary fix (independent — finalize write mechanism during impl)
- [ ] **(DEFERRED — follow-up PR; independent of the Elo fix, see PR exception)** Persist match counts to paragraph variant rows (currently always 0). Counts ARE in memory (`localMatchCounts`, mutated by `rankNewVariant`). **Write surface is larger than first stated (review correction):**
  - `arena_match_count`: `syncToArena` DERIVES it from its `matchHistory` arg, but the agent passes `[]` (`ParagraphRecombineAgent.ts:579`). The `sync_to_arena` RPC writes it via REPLACE on INSERT (`COALESCE(entry, existing)`), NOT accumulate — fresh rewrites take the INSERT path, so there is **no double-count risk** (earlier "avoid double-count" rationale was a misread). To populate it, pass real per-variant counts (derive from `localMatchCounts`) into the new-entry payload — and verify the RPC reads an `arena_match_count` field from the entry JSON (it currently computes from matches; the entry payload at `persistRunResults.ts:632-648` has no such field today).
  - `match_count` (the `evolution_variants` column): NOT writable through the current `syncToArena` payload or `sync_to_arena` RPC at all (only the article path writes it, at `persistRunResults.ts:281`, which the per-slot path bypasses). Populating it needs EITHER extending the RPC (a migration) OR a separate post-persist `UPDATE evolution_variants SET match_count=… WHERE id=…`. **Decide the mechanism during implementation** (likely the targeted UPDATE — no migration — unless we also want arena_match_count routed through the same path).
- [ ] **(DEFERRED — with Phase 4)** Test: a paragraph variant that participated in K matches persists the chosen count column(s) = K (not 0).
- [ ] **Note:** this is the lowest-priority, fully independent fix. If it grows (RPC migration), it can split into its own follow-up PR rather than blocking the A2+B1 work.

## Testing

> **Testing principle (review):** unit tests use a MOCKED LLM, so we CANNOT assert that real rewrite *outputs* are dissimilar (that depends on temp-1–2 sampling). All diversity assertions are on the **inputs** the agent constructs; output-quality lift is validated only by the Phase 3 staging gate.

### Unit Tests
- [x] **A — diversity is input-based** `buildParagraphRewritePrompt.test.ts` (NET-NEW file; mirror sibling `ParagraphRecombineAgent.test.ts` conventions): asserts a distinct directive string is injected per index; directive cycling `DIRECTIVES[i % len]` for M=1..6; the content-additive directive says "ONE concise sentence".
- [x] **A — agent wiring** `ParagraphRecombineAgent.test.ts`: capture the `slotLlm.complete` calls (existing `makeLlmMock`) and assert each of the M `'paragraph_rewrite'` calls received (i) a DISTINCT prompt string and (ii) a DISTINCT `options.temperature` (3rd arg — the agent currently passes none). Assert the temperature schedule values (M=1→1.5; M=3→[1.0,1.5,2.0]) and the clamp path (mock a model whose `getModelMaxTemperature` < 2.0 → temps clamped; a temp-unsupported model → option omitted). Do NOT assert on mock OUTPUT similarity.
- [x] **A — judge temp** assert per-slot `'paragraph_rank'` judge calls go out at `temperature: 0`.
- [x] **A — length-cap guard (REQUIRED, the highest-risk regression)** `paragraphSlots` test: a representative content-additive rewrite at ~1.15× original passes `validateParagraphRewrite`; boundary 1.20× passes, 1.21× is dropped with `dropReason: 'length_over'`.
- [x] **B — exact-equality article guard** `computeRatings.comparison.test.ts`: `buildComparisonPrompt('A','B')` === `buildComparisonPrompt('A','B','article')` === the current literal (EXACT string / snapshot equality, not `.toContain`, to catch reorder/whitespace drift). And `compareWithBiasMitigation` called 4-arg (no mode) is unchanged — protects SwissRankingAgent/debate/generate/article-ranking.
- [x] **B — paragraph emission** `buildComparisonPrompt('A','B','paragraph')` emits the paragraph prompt (texts last; paragraph criteria; TIE-discouraging line) and still keeps `## Text A`/`## Text B` + A/B/TIE so `parseWinner` is unaffected.
- [x] **B — threading** Covered by proxy across two ends: `compareWithBiasMitigation('paragraph')` → paragraph prompt (computeRatings.comparison.test) + agent sets `comparisonMode='paragraph'` on `perSlotConfig` passed to `rankNewVariant` (ParagraphRecombineAgent.test). The `rankSingleVariant` → `compareWithBiasMitigation` pass-through is one tsc-checked line; the end-to-end thread is also exercised by the deferred plumbing integration test. (No dedicated `rankSingleVariant.test.ts` added — redundant given the two-ended coverage.)

### Integration Tests
- [ ] **(DEFERRED — follow-up plumbing test, with Phase 4)** Minimal `paragraph_recombine` iteration with a MOCKED LLM whose comparison verdicts are CONSISTENTLY DIFFERENTIATED (forward `'A'` + reverse `'B'` → after flip both say A → decisive @ confidence 1.0, per `computeRatings.comparison.test.ts:176-183`); assert the resulting per-slot `mu`/`elo` moved off 25/1200 and persisted. **This proves the PLUMBING only** (mode threaded → decisive verdict → rating moves → persisted) — diversity itself can't come from a mock. Follow the existing `evolution-paragraph-recombine-accumulation.integration.test.ts` pattern + its `tablesExist`/`paragraphKindMigrationApplied` auto-skip guards. Also assert the Phase-4 `arena_match_count`/`match_count` persist as K (not 0).

### E2E Tests
- [x] N/A — no E2E added (backend-only). If a UI assertion is later warranted, extend an existing `09-admin/admin-evolution-*` spec (slot leaderboard shows non-1200 Elo) per testing_overview rules (`resetFilters()` + role/`data-testid` selectors, no `waitForTimeout`).

### Manual Verification
- [ ] **(DEFERRED — post-merge staging)** Trigger a fresh `paragraph_recombine` run (staging or local) and confirm in `/admin/evolution` that per-slot paragraph variants show Elo ≠ 1200 and the per-slot decisive rate rose from the 2.4% baseline.

## Verification

### A) Playwright Verification (required for UI changes)
- [x] N/A — backend-only change, no admin-UI touched. (Would otherwise verify `/admin/evolution/...` via `ensure-server.sh` + Playwright MCP.)

### B) Automated Tests
- [ ] **(DEFERRED — Phase 3, post-merge staging)** `npm run query:staging -- "..."` (read-only) before/after: per-slot decisive rate + paragraph variant mu/elo spread.
- [x] Targeted unit runs, e.g. `npm test -- ParagraphRecombineAgent computeRatings`.
- [x] Full local check trio before any push per repo workflow (lint + tsc + build + unit + ESM + integration + E2E critical) — run by /finalize.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/paragraph_recombine.md` — documented per-rewrite diversity (A) + paragraph judging mode (B) + the "Failure modes" row about equivalent rewrites tying.
- [x] `evolution/docs/rating_and_comparison.md` — documented the paragraph comparison `mode` (+ corrected the stale source path).
- [x] N/A `evolution/docs/multi_iteration_strategies.md` — no new `iterationConfigSchema` knobs added (`comparisonMode` is run-internal; directives are hardcoded; no `paragraphJudgeModel` since B2 was not done).
- [x] N/A Others in `_status.json` `relevantDocs` — none touched.

## Review & Discussion

### Iteration 1 — scores: Security/Technical 4, Architecture/Integration 3, Testing/CI 2
Critical gaps raised (all verified against code) and how the plan was updated:
- **Threading mis-described** (Sec + Arch + Test): `buildComparisonPrompt` is built in `compareWithBiasMitigation` (`computeRatings.ts:455`), not `makeCallLLM`. → Phase 2 rewritten with the exact 5-step change set (incl. `SwissRankingAgent.ts:141` as a co-caller; trailing optional `mode` keeps it byte-identical).
- **`comparisonMode` needs a real schema edit** (Sec + Arch): → Phase 2 names the `evolutionConfigBaseSchema` addition in `schemas.ts`; confirmed not in `hashStrategyConfig` (config_hash safe), no `.strict()`.
- **Temperature not auto-clamped** (Sec + Arch + Test): → Phase 1 specifies `getModelMaxTemperature(ctx.defaultModel)` with clamp / null-omit / undefined-passthrough; clamp-path unit test added.
- **Diversity test untestable on mocked LLM** (Test): → re-specified as INPUT assertions (distinct prompt + distinct `options.temperature` per index); output-quality lift moved to the Phase 3 staging gate only.
- **No byte-for-byte article guard** (Test): → exact-equality (not `.toContain`) test + 4-arg back-compat test for `compareWithBiasMitigation`.
- **Content-additive vs ±20% length cap** (Sec + Test): → made a REQUIRED length-cap guard test; example directive constrained to "ONE concise sentence".
- **Subjective success criterion** (Test): → committed numeric multi-run gate (decisive ≥30% over ≥2 runs, ≥1/3 slots move ≥30 Elo, report N + drop rate) + explicit rollback (`comparisonMode` default + kill switch).

Corrections/notes incorporated:
- Rule 1 in `buildParagraphRewritePrompt.ts:33-35` ALREADY permits content-additive → dropped the "relax Rule 1" step.
- `paragraph_rank` judge calls skip the `agentName==='ranking'` temp-0 forcing → added a fix + test (protects reversal determinism).
- Bespoke paragraph directive set justified over `SYSTEM_GENERATE_TACTICS` (article/section-scoped, would trip format/length gates).
- Match-count secondary fix committed to a SINGLE write site (syncToArena payload) to avoid the RPC's accumulation double-count.
- **Known pre-existing divergence (not fixed this round):** `paragraphRewriteModel` is plumbed for cost *projection* (`projectDispatchPlan.ts:470`) but NOT runtime (agent uses `ctx.defaultModel`) — a future A3 must reconcile both, not just add runtime plumbing.

### Iteration 2 — scores: Security/Technical 5, Architecture/Integration 5, Testing/CI 5 → ✅ CONSENSUS
All three reviewers re-verified the iteration-1 fixes against real code and found no remaining critical gaps. Post-consensus, one Phase-4 (independent secondary fix) inaccuracy flagged by two reviewers was corrected: `match_count` is not writable via the current `sync_to_arena` RPC (needs a targeted UPDATE or RPC migration), and `arena_match_count` uses REPLACE (not accumulate) semantics on INSERT so there is no double-count to avoid. Remaining items are cosmetic (line-number drift, widening `makeLlmMock` to capture the options arg) and do not block. **Plan is ready for execution.**
