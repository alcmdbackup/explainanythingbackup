# Investigate Matchmaking Paragraph Recombine Progress

## Phase 0: Initialize
### Work Done
- Created branch `feat/investigate_matchmaking_paragraph_recombine_20260528` off `origin/main`.
- Read core docs (getting_started, architecture, project_workflow) + the user-specified evolution and testing docs.
- Captured initial doc-based leads in the research doc (Leads A–E).

### Issues Encountered
- None.

### User Clarifications
- Branch type: `feat`.
- Summary + details both: "explain why all variants are at 1200 elo for my paragraph recombine last 3 runs on stage".

## Phase 1: Reproduce & Diagnose (staging data)
### Work Done
- Queried staging (read-only) for the paragraph_recombine runs from 2026-05-29 (strategy "New paragraph strategy", judge `qwen-2.5-7b-instruct`, gen `google/gemini-2.5-flash-lite`).
- **Root cause confirmed:** per-slot paragraph comparisons resolve as draws ~98% of the time (124 draw / 3 decisive, all draws at confidence exactly 0.5 = forward/reverse disagreement). `updateDraw` between equal-rated (mu=25) variants leaves mu unchanged and only shrinks sigma → every paragraph variant stuck at elo 1200 with sigma dropped to ~7.2.
- **Paragraph-specific, not a broken judge:** same runs/judge produced 79% decisive verdicts at the article level (50 decisive / 13 draw) vs 2.4% at the paragraph-slot level.
- **Why:** the 3 rewrites per slot are distinct but quality-equivalent paraphrases; the judge has no real signal, falls back to position, and the 2-pass reversal correctly forces a tie.
- Documented evidence, open questions, and 5 candidate fix directions (A–E) in the research doc.

### Issues Encountered
- Initial /initialize leads focused on the recombined ARTICLE parent landing at 1200 (the pre-#1119 no-op). User clarified mid-research that the concern is the PARAGRAPH-SLOT rewrite Elo. Reoriented; the article-parent path is actually working (article matches are decisive).

### User Clarifications
- "I'm looking at the elo of paragraphs not moving, not the recombined parents."
- "please query stage supabase using debugging skill to understand behavior."

## Phase 2: Confirm root cause in code + brainstorm fixes A & B
### Work Done
- Read generation + judging code. Confirmed the two mechanisms:
  - **Generation:** `ParagraphRecombineAgent` dispatches all M rewrites with the *identical* `buildParagraphRewritePrompt` (no per-index/temperature/angle variation); the prompt says "preserve meaning / express the same meaning" → equivalent paraphrases by design.
  - **Judging:** `buildComparisonPrompt(textA,textB)` (computeRatings.ts) is a single article-oriented prompt with no paragraph mode; judge call (`rankSingleVariant.makeCallLLM`) uses `config.judgeModel` at temp 0, no reasoning; `aggregateWinners` returns confidence 0.5/TIE on forward-reverse disagreement. Per-slot ranking reuses run-level `config` (only `maxComparisonsPerVariant` overridden) → no per-slot judge override today.
- Quantified position bias: 97.6% draw rate vs ~50% expected from randomness → near-deterministic position-1 preference.
- Brainstormed Option A (A1 temperature ladder, A2 distinct directives [recommended], A3 dedicated rewrite model, A4 single multi-rewrite call) and Option B (B1 paragraph prompt [recommended], B2 per-slot judge/reasoning, B3 0.5-tiebreak [risky], B4 near-dup gate) in the planning doc, with pros/cons and a combined exploration order (A2 → B1 → escalate). Key insight: A is necessary (B alone correctly keeps tying equivalent texts).

### Issues Encountered
- None. `comparison.ts` doc path was stale — primitives actually live in `evolution/src/lib/shared/computeRatings.ts`.

### User Clarifications
- User selected directions A (generation diversity) and B (paragraph-specific judging) to explore.

### Decisions (resolved 2026-05-28)
- A: allow ALL — distinct directives (structure/style + content-additive) + temperature ladder.
- B: B1 only (paragraph comparison prompt via default-safe `mode` param). B2/B3 held as escalations.
- Cost: no added spend this round (A1/A2/B1 all cost-neutral).
- Success: per-slot decisive rate well above 2.4% baseline + paragraph mu/elo move off 1200 on a fresh staging run.

## Plan review
Ran `/plan-review`: iteration 1 scored 4/3/2 with verified critical gaps (threading mis-described, schema edit unnamed, temperature unclamped, untestable diversity test, no objective success gate). Fixed all; iteration 2 → 5/5/5 consensus.

## Phase 3 (renamed): Implement A + B1
### Work Done
**Phase 1 (Option A — generation diversity):**
- `buildParagraphRewritePrompt.ts`: added `PARAGRAPH_REWRITE_DIRECTIVES` (tighten/simplify · add ONE concise example · improve flow) + optional `directive` param injecting an "APPROACH FOR THIS REWRITE" block.
- `ParagraphRecombineAgent.ts`: per-rewrite distinct directive (cycled) + per-index temperature via new exported `paragraphRewriteTemperature` (1.0–2.0 ladder, clamped to `getModelMaxTemperature(ctx.defaultModel)`, null→omit, undefined→passthrough); passed as `slotLlm.complete(prompt, 'paragraph_rewrite', { temperature })`.
- `createEvolutionLLMClient.ts`: `'paragraph_rank'` now forced to temp 0 alongside `'ranking'` (was leaking to provider default → broke reversal determinism).

**Phase 2 (Option B1 — paragraph judging):**
- `schemas.ts`: added `comparisonMode: z.enum(['article','paragraph']).optional()` to `evolutionConfigBaseSchema` (run-internal; not in config_hash).
- `computeRatings.ts`: `buildComparisonPrompt(textA, textB, mode='article')` with a paragraph rubric (texts last, cacheable prefix; TIE-discouraging; `## Text A`/`## Text B` + A/B/TIE preserved); `'article'` byte-for-byte unchanged. Threaded trailing optional `mode` through `compareWithBiasMitigation`.
- `rankSingleVariant.ts`: passes `config.comparisonMode` to `compareWithBiasMitigation`.
- `ParagraphRecombineAgent.ts`: per-slot `perSlotConfig` sets `comparisonMode: 'paragraph'`; article-level ranking keeps default.

**Tests (all input-based / deterministic per review):**
- `buildParagraphRewritePrompt.test.ts` (new): directive set, distinct-prompt injection, content-additive ONE-sentence guard.
- `ParagraphRecombineAgent.test.ts`: per-rewrite distinct directive+temperature wiring; `paragraphRewriteTemperature` ladder/clamp/null; per-slot `comparisonMode='paragraph'`.
- `createEvolutionLLMClient.test.ts`: `ranking`/`paragraph_rank` → temp 0; generation passes temperature through.
- `computeRatings.comparison.test.ts`: byte-for-byte `'article'` exact-equality guard; paragraph emission; mode forwarding + 4-arg back-compat.

**Checks:** typecheck ✓, `npm run lint` ✓ (no new errors; stale-specs clean), full evolution unit suite ✓ (2939 passed / 0 failed), `npm run build` ✓.

### Issues Encountered
- `npx eslint` direct invocation false-flagged pre-existing underscore params / `requireActual`; authoritative `npm run lint` (next lint) is clean. Use `npm run lint`, not bare eslint.

### Deferred / Not Done
- **Phase 4 (match_count/arena_match_count = 0):** deferred to a follow-up (plan-sanctioned, independent of Elo). Needs a new `evolution_variants` UPDATE write path + real-DB test.
- **Integration test (plumbing):** recommended follow-up alongside Phase 4; unit coverage already exercises the threading + existing accumulation integration test covers persistence.
- **Phase 3 staging measurement:** REQUIRES triggering ≥2 fresh `paragraph_recombine` staging runs (cannot be done from here). Gate: per-slot decisive rate ≥30% (vs 2.4%), ≥1/3 slots move ≥30 Elo off 1200, report N + rewrite drop rate.

### User Clarifications
- Temperature range 1.0–2.0 (high, for diversity). Paragraph prompt reordered so texts come last (caching).
