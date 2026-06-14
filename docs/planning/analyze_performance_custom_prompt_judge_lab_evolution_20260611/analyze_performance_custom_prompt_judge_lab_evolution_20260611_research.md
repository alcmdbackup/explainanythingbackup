# Analyze Performance of Custom-Prompt Judge (Explain Reasoning) in Judge Lab — Research

## Problem Statement
Help investigate if it is conclusive and not a bug that a custom prompt asking the judge to
explain reasoning conclusively hurts performance across models in Judge Lab for evolution.
The Judge Lab is the systematic judge-evaluation tool that measures whether changing the judge
model, temperature, reasoning effort, or rubric prompt improves the **decisive rate**
(`confidence > 0.6`). The concern: enabling the "Explain reasoning" toggle or supplying a custom
rubric prompt appears to drop measured performance (decisive rate / agreement / accuracy) across
models, and we need to determine whether that drop is a *genuine model-behavior effect* or an
*artifact/bug* (e.g. a parsing/format mismatch).

## Requirements (from GH Issue #1198)
- Investigate whether "custom prompt asking judge to explain reasoning conclusively hurts
  performance across models in judge lab for evolution" is a **real, conclusive effect** vs a **bug**.
- Deliverable: **Report + fix if a bug is found.** Investigate first; if the "hurts performance"
  effect turns out to be a parsing/format bug (e.g. `parseVerdictFromReasoning` misparse, dropped
  reasoning trace, error masking), fix it and re-measure. Produce a conclusive findings report either way.
- Evidence sources: **Both** — mine already-persisted `judge_eval_runs` / `judge_eval_calls` data
  (staging/prod) to form hypotheses first, then run targeted new controlled Judge Lab sweeps
  (explainReasoning on/off × custom-prompt on/off across several models) to confirm.

## Conclusion (CONFIRMED — Phases 1–3 executed on real staging data, 2026-06-11)

**It is NOT a bug, and it is NOT conclusive that it "hurts performance across models."** The effect
is real, fully explained, model- and content-dependent, and (on the metric you said matters most)
it *improves* quality rather than degrading it.

1. **Not a parse bug — definitively.** Re-parsing all 12,266 stored raw outputs reproduced the
   stored verdicts + confidence at **100%** in every current-format mode, and a deliberately
   hardened parser rescued **0 passes**. Parse-failure rate is ~0% in reasoning mode.
2. **The decisive-rate drop is increased POSITION BIAS, correctly measured.** When asked to reason,
   models more often pick the same physical slot in both reversal passes; `aggregateWinners` flips
   the reverse verdict, so same-slot → forced TIE @ confidence 0.5 (< the 0.6 threshold). Phase 3
   confirmed this causally on identical pairs: decisive rate moves inversely and tightly with
   position bias in every cell. The judge is behaving as designed; the 2-pass reversal is doing its
   job of catching the bias.
3. **Accuracy is not hurt — it improves** (your lead metric). On large-gap pairs, reasoning mode is
   right **89%** of the time when it commits (vs 79% default) and is confidently-wrong only **4%**
   (vs 11%). What falls is decisive rate / recall — it resolves fewer pairs (the cost).
4. **Not uniform across models or content** — bidirectional. Historically reasoning helped
   deepseek-v4-flash (+16.5 ppts) while hurting deepseek-v4-pro (−17.8) and gemini-2.5-flash-lite
   (−41.2); Phase 3 showed reasoning *helped* deepseek-flash on paragraphs (+70) while hurting it on
   articles (−50). So "conclusively hurts across models" is **false as stated**.

**Net answer to GH #1198:** the leaderboard drop is genuine signal, not a bug — it reflects more
position-biased (but more *accurate*-when-decisive) judging under reasoning, and it is model/
content-specific, not universal. The only real defect found is an **audit-persistence gap**
(`explainReasoning` is not stored), which doesn't affect the verdict but is worth fixing so future
leaderboard rows are self-explaining.

### The accuracy result, in detail (precision vs abstention trade-off)
"Accuracy" = agreement with the arena **Elo** `expected_winner` on `gap_kind='large'` pairs (NOT
human ground truth; an Elo proxy, trustworthy only on wide gaps). Pooled across models:

| mode | commits on | correct WHEN decisive | **wrong WHEN decisive** | correct of ALL large-gap calls |
|---|---|---|---|---|
| default (verdict-only) | 52.6% | 78.8% | **21.2%** | **41.4%** |
| reasoning | 42.1% | 90.3% | **9.7%** | 38.1% |

So "wrong 21% → ~10%" is correct **only among committed verdicts** — reasoning roughly halves the
confident-error rate. BUT it commits less often (abstains via 0.5 ties on hard pairs), so in absolute
terms it resolves slightly FEWER pairs correctly (38.1% vs 41.4%). It's a precision-up / throughput-
down trade-off, not a free win.

**And it is NOT universal** (wrong-when-decisive, large-gap, both modes):

| model | default wrong% | reasoning wrong% |
|---|---|---|
| deepseek-v4-flash | 33.3 | 12.0 ✅ |
| deepseek-v4-pro | 40.8 | 3.3 ✅ |
| google/gemini-2.5-flash-lite | 13.2 | 21.4 ❌ worse |
| gpt-4.1-mini | 1.2 | 0.0 (already accurate) |

The pooled precision win is driven by the weak DeepSeek models; gemini-lite regresses and
gpt-4.1-mini was already near-perfect. → **Full write-up:**
[`docs/research/effect_adding_explanation_judge_accuracy.md`](../../research/effect_adding_explanation_judge_accuracy.md).

### Output length ↔ position bias (dose-response)
Within reasoning mode, **longer outputs are MORE position-biased**, holding **within model** AND
**within difficulty** (so neither a verbose-model nor a hard-pair confound):
- Per model, short→long same-slot: deepseek-pro 63→80%, gemini-lite 80→88%, gpt-4.1-mini 30→53%.
- Within difficulty, short→long: close 60.2→74.2% (+14), large-gap 54.1→61.6% (+7.5).
Dose-response = more output → more rationalization → more bias (opposite of "CoT reduces bias").
Correlational; clean causal test = vary *requested* explanation length on identical pairs (not yet run).

### Reading the position-bias % (same-slot rate) — 50% is chance, not "neutral"
Counts how often the judge picked the same **physical slot** in both swapped passes (= picked the
*different text* = self-contradiction → 0.5 tie). **0% = ideal** (always flips with the text, pure
content). **~50% = coin-flip** (independent passes, no signal). **>50% = systematic position bias.**
**100% = total lock.** A content-ignoring judge favoring a slot with prob p gives p²+(1−p)², min 50%
at p=0.5 — so >50% can't arise from noise alone; content judging pulls it *below* 50. So gpt-4.1-mini
@30% is genuinely content-tracking; deepseek-pro/gemini @80–88% are position-locked. `same-slot% ≈
100% − decisive%`.

---

## High Level Summary (pre-execution analysis — retained for context)

**Provisional verdict: the drop is most likely a GENUINE model-behavior effect, not a parse
artifact — confidence moderate-to-high, pending two cheap confirmation steps (Phase 1 capture +
Phase 2 offline re-parse).** [Now CONFIRMED — see Conclusion above.]

The mechanism is fully understood from code. Enabling "explain reasoning" OR supplying a custom
prompt flips the verdict parser from `parseWinner` to `parseVerdictFromReasoning`
(`runJudgeEval.ts:101-103`). A decisive-rate drop could therefore be (a) a **real** increase in
cross-pass **position bias** → forced-TIE `confidence=0.5` (below the 0.6 decisive threshold), or
(b) a **parse artifact** where a correct verdict isn't extracted → `confidence=0.3`. The two are
distinguishable only by inspecting the *value* of `confidence`, because the stored `decisive`
column is `GENERATED ALWAYS AS (confidence > 0.6)` — both 0.5 and 0.3 read as non-decisive.

Research agents ran read-only SQL against staging and reported the drop tracks a **shift into the
`confidence=0.5` bucket (+position bias), with parse-failure (`0.3`/`0.0`) rates essentially flat
(~0.10%) in both modes**, and that the effect is **bidirectional across models** (some improve,
some degrade). A systematic parser bug would push all models one direction and would inflate the
`0.3` bucket — neither is observed — so the evidence points to a real effect.

**Two important caveats** keep this short of "conclusive":
1. The cited SQL numbers were produced ad-hoc by the agents and are **not yet recorded,
   re-runnable Phase-1 artifacts** (`_progress.md` still shows Phase 1/2 `[Pending]`). The specific
   per-model deltas and some model names reported by the agents (e.g. "DeepSeek-V4-Pro/Flash") look
   non-standard and **must be re-verified against the actual `judge_eval_runs.judge_model` values**
   before being quoted as fact.
2. No **deterministic offline re-parse** has yet confirmed `parse(forward_raw) == stored_winner` at
   ≥99%. That single zero-cost test is what converts "moderate-high" into "conclusive."

The investigation also surfaced a **real secondary defect worth fixing regardless of the verdict**:
`explainReasoning` is **not persisted anywhere** (no column in any migration, `persist.ts`, or
`schemas.ts`; runtime-only param at `runJudgeEval.ts:58`). A historical run with
`prompt_variant = NULL` is therefore **ambiguous** between explainReasoning=true+default-rubric
(→ `parseVerdictFromReasoning`) and explainReasoning=false (→ `parseWinner`), which both
complicates post-hoc parser recovery and makes the Judge Lab leaderboard's "Custom" label unable to
explain a low decisive rate.

## Key Findings (evidence-backed; SQL-derived numbers flagged UNVERIFIED until Phase 1 capture)

1. **Single boolean lever selects the parser.** `runJudgeEval.ts:101-103`:
   `wantsFreeform = (settings.explainReasoning ?? false) || settings.customPromptOverride != null;`
   → `parser = wantsFreeform ? parseVerdictFromReasoning : parseWinner`. This is the entire source
   of the bug-vs-real ambiguity.
2. **`parseVerdictFromReasoning` requires an explicit marker.** `computeRatings.ts:452`
   `VERDICT_MARKER_RE = /(?:your answer|verdict|winner)\s*:?\s*\*{0,2}\s*(A|B|TIE)\b/gi`; scans the
   whole response, returns the **last** match else `null`. Accepts `Your answer: B`, `Verdict: A`,
   `Winner: TIE` (optional colon / `**bold**`). **Rejects** `Response: A`, `Decision: B`, bare
   `A`/`B` with no marker, `Your answer: depends`.
3. **`parseWinner` is more permissive** via a heuristic fallback chain (`computeRatings.ts:464-503`):
   exact-trim → `TEXT A/B`+verb → `TIE/DRAW/EQUAL` → `^YOUR ANSWER:` → first-word/markdown → legacy
   bare token. This asymmetry is exactly why the documented Qwen3-8B `"Your answer: B"` precedent
   bit one parser and not the other.
4. **Confidence is a deterministic lookup over the two flipped verdicts.** `aggregateWinners`
   (`computeRatings.ts:534-555`): `flipWinner(reverse)` applied first, so **same-slot agreement maps
   to 0.5, not 1.0** (forward=B, reverse=B → reverseFlipped=A → B≠A → TIE@0.5). One null → 0.3; both
   null → 0.0; cross-frame agreement → 1.0; one TIE+one decision → 0.7. **This is the precise reason
   position bias depresses decisive rate.**
5. **Decisive threshold 0.6 is hard-wired in 3 places.** `computeRatings.ts:171`
   `DECISIVE_CONFIDENCE_THRESHOLD = 0.6`; `metrics.ts:27` `DECISIVE_THRESHOLD = 0.6`;
   `20260606000001_judge_eval_tables.sql:74` `decisive ... GENERATED ALWAYS AS (confidence > 0.6)
   STORED`. So `0.5` (position bias) and `0.3` (parse fail) are both non-decisive — only the value
   distinguishes them.
6. **[UNVERIFIED — agent SQL, re-run in Phase 1] Distribution favors REAL effect.** ~12,266 calls
   (9,266 baseline / 3,000 custom): decisive 51.54%→38.67% (−12.87 ppts); confidence
   baseline `{1.0:50.3, 0.5:48.4, 0.7:1.3, 0.3:0.10}` → custom `{1.0:38.4, 0.5:61.2, 0.7:0.30,
   0.3:0.10}` (%); parse-fail rate flat ~0.10%; same-slot position bias 49.6%→61.2% (+11.6 ppts),
   tracking the decisive drop ~1:1.
7. **[UNVERIFIED — agent SQL] Effect is bidirectional across models** (degraded: Qwen-2.5-7B,
   Gemini-2.5-Lite, GPT-4.1-Mini; improved: some Gemini/DeepSeek variants). Bidirectionality is
   incompatible with a single systematic parser bug. Exact model IDs need re-verification.
8. **[UNVERIFIED — agent SQL] TIE suppression is a secondary effect** (TIE verdicts ~2.54%→0.30%),
   shrinking the `0.7` bucket; valence (good decisiveness vs suppressed legitimate ties) unresolved.
9. **`explainReasoning` is NOT persisted (confirmed by grep).** No `explain_reasoning` column in any
   `supabase/migrations/*`, `persist.ts`, or `schemas.ts`; runtime-only (`runJudgeEval.ts:58`,
   `executeSweep.ts:24`). `prompt_variant` (custom text) IS persisted. → audit-trail gap (see §3).
10. **Phase 1 & 2 are still `[Pending]` in `_progress.md`.** The Round-2/3 SQL was generated ad-hoc
    this round, not captured as durable deliverables. The "real effect" claim is contingent on work
    not yet recorded/re-runnable.
11. **Offline re-parse is feasible and safe (the definitive disambiguator).** `forward_raw`/
    `reverse_raw` (`20260606000001:82-83`) + `forward_prompt/reverse_prompt/forward_reasoning/
    reverse_reasoning/reasoning_trace_format` + ground-truth snapshot (`20260610000001`) are all
    persisted; both parsers + `aggregateWinners` are pure/deterministic → re-parse reproduces stored
    verdicts exactly (modulo code drift).
12. **Controlled-sweep CLI exists.** `evolution/scripts/judge-eval.ts`: `seed`, `create-test-set`,
    `sweep` with `--explain-reasoning` (line 107), `--models`, `--temperatures`, `--repeats`,
    `--kind`, `--dry-run`. Hard caps `JUDGE_EVAL_MAX_CALLS=20000`, `JUDGE_EVAL_MAX_USD=5` enforced
    pre-flight.

## The Bug-vs-Real Decision

- **Parse-artifact mechanism (→ BUG):** reasoning mode uses `parseVerdictFromReasoning`, which only
  matches `your answer|verdict|winner`. A correct verdict in a non-matching shape (`Response: A`,
  `Decision: B`, lowercase `answer: B` without `your`, bare letter after prose) → `null` → one-null
  pass → confidence 0.3 → non-decisive even though correct. **Signature: rising `0.3`/`0.0` buckets
  in custom mode, concentrated in weakly instruction-tuned models.** The Qwen3-8B precedent proves
  the failure class is real.
- **Genuine-effect mechanism (→ REAL):** asking a model to reason raises **position bias** (same
  slot both passes); `flipWinner` makes that deterministically `confidence=0.5` < 0.6.
  **Signature: rising `0.5` bucket + `positionBiasRate` (`metrics.ts:99`), with flat parse-fail.**
- **Better supported:** the **genuine-effect** reading — the drop maps to a `+0.5`/+position-bias
  shift, not a `+0.3` collapse; parse-fail rates are flat; spot-checked raw outputs contain
  well-formed `Your answer: X`; and bidirectional model variance is incompatible with one
  systematic bug. **Residual bug-risk** (narrow): a model's format failure happening to correlate
  with position-bias models — possible but implausible; Phase 2 re-parse settles it.

## Confounders to Control (in Phase 1/2/3)
- **Parser identity not recoverable from data** (Finding 9): infer via
  `forward_prompt ILIKE '%First, briefly explain your reasoning%'` (`computeRatings.ts:427` signature)
  and/or `prompt_variant IS NOT NULL`; fragile if a custom prompt itself says "explain reasoning".
- **Same frozen `test_set_id`** across baseline vs custom arms; fixed **temperature** + **reasoning
  effort**; **stratify by `pair_kind`** (article vs paragraph rubrics differ) and **`gap_kind`**
  (accuracy only defined on `gap_kind='large'`, `expected_winner` non-null).
- **Code-version drift:** `git log` `computeRatings.ts` since run dates; pin re-parse to the
  run-time commit if either parser changed.
- **Error-rate / temporal / provider / repeats-balance parity** between arms.

## Documents Read

### Core Workflow Docs
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

### Core Operations Docs
- docs/docs_overall/environments.md
- docs/docs_overall/testing_overview.md
- docs/feature_deep_dives/testing_setup.md
- docs/docs_overall/debugging.md

### Relevant Docs (read in full)
- docs/feature_deep_dives/judge_evaluation.md — Judge Lab architecture; parser selection
  (`explainReasoning || customPrompt` → `parseVerdictFromReasoning`); data model; cost safety; UI.
- evolution/docs/rating_and_comparison.md — 2-pass reversal, `aggregateWinners` confidence ladder,
  `parseWinner` priority chain, `buildComparisonPrompt`, Match Viewer re-judge sandbox + custom prompt.
- docs/research/judging_accuracy_20260412.md — empirical judge accuracy/noise, beta calibration,
  decisiveness by model × temperature × gap; methodology now generalized into Judge Lab.
- docs/research/judge_agreement_summary_tables.md — agreement/decisive tables incl. the
  `"Your answer: B"` → `parseWinner` null → 0.30-confidence precedent (the canonical parse artifact).

### Relevant Docs (surveyed; consult in full as needed)
- evolution/docs/{arena,metrics,data_model,strategies_and_experiments,criteria_agents}.md
- evolution/docs/{evolution_metrics,logging,reference,agents/overview}.md

### Prior related project docs (harvested in Round 3)
- docs/planning/improve_judge_lab_evolution_20260707{,_v3}/, improve_judge_lab_evolution_20260707/
- docs/planning/create_tool_systematic_judge_evaluation_evolutioN_20260606/

## Code Files Read (verified during the 4-round investigation)
- evolution/src/lib/judgeEval/runJudgeEval.ts — parser-selection lever (101-103); `explainReasoning`
  runtime-only param (58); never persisted.
- evolution/src/lib/shared/computeRatings.ts — `parseVerdictFromReasoning` (452-460, marker-LAST
  regex), `parseWinner` (464-503, heuristic chain), `aggregateWinners` (534-555, flip-then-lookup),
  `DECISIVE_CONFIDENCE_THRESHOLD=0.6` (171), explain-reasoning prompt instruction (427-432).
- evolution/src/lib/judgeEval/metrics.ts — `DECISIVE_THRESHOLD=0.6` (27), `decisiveRate` (83-84),
  `positionBiasRate` (99), `accuracy` only when `expectedWinner` ∈ {A,B} (104-111).
- evolution/src/lib/judgeEval/schemas.ts — `CONFIDENCE_VALUES=[0,0.3,0.5,0.7,1.0]` (22).
- evolution/src/lib/judgeEval/executeSweep.ts — `explainReasoning` flows through the grid (24,68,120)
  but is never written to the DB.
- evolution/src/lib/comparison.ts — `parseWinner`/`aggregateWinners` callers (cross-checked vs computeRatings).
- evolution/scripts/judge-eval.ts — `seed`/`create-test-set`/`sweep`; `--explain-reasoning` (107).
- supabase/migrations/20260606000001_judge_eval_tables.sql — `decisive` GENERATED (74),
  `forward_raw`/`reverse_raw` (82-83), leaderboard VIEW keyed by `prompt_variant_hash` (no explainReasoning).
- supabase/migrations/20260610000001_judge_eval_calls_audit_and_snapshot.sql — audit + ground-truth
  snapshot columns enabling offline re-parse.
- evolution/src/lib/judgeEval/persist.ts (grep) — confirmed zero `explain_reasoning` persistence.
- runJudgeEval.test.ts (143-159) — covers explainReasoning=true only; no customPrompt-without-reasoning
  or non-standard verdict-format coverage (test gap).

## Open Questions
1. **Capture Phase 1 as durable artifacts** — re-run the §Plan SQL against staging, record outputs,
   and re-verify the per-model deltas + exact `judge_model` IDs (the agent-reported names are suspect).
2. **Run the deterministic offline re-parse (Phase 2)** — confirm `parse(forward_raw) == stored_winner`
   ≥99%; this is the single test that makes the conclusion conclusive.
3. **Regression vs trade-off** — compute large-gap (`gap_kind='large'`) accuracy per model, baseline
   vs custom. Accuracy preserved + decisiveness down = benign caution trade-off, not a quality regression.
4. **What exactly does GH Issue #1198 claim** — a measured drop in specific runs, or a forward-looking
   concern? Confirm the original observation's specificity.
5. **Root cause of the position-bias increase** — RESOLVED. Measured a recency prior amplified by
   reasoning (same-slot "picked 2nd text" share 60.7%→67.1%; explicit-TIE-suppression refuted, 0.3%
   vs 1.1%), and transcripts directly show the model giving **opposite justifications for the same
   content feature by slot** (judges/shopkeeper analogy praised for being absent-in-B *and*
   present-in-B) — post-hoc rationalization of a positional prior. Mechanism write-up in
   [`effect_adding_explanation_judge_accuracy.md`](../../research/effect_adding_explanation_judge_accuracy.md) §"Why does asking for reasoning increase position bias?".
6. **Why bidirectional across models** — likely instruction-tuning differences; unconfirmed.
7. **Full verdict-format distribution under reasoning mode** — characterize `forward_raw` shapes
   (`Response:`, bare letters, etc.); the hardened-parser arm of Phase 2 quantifies this.
8. **Is 0.6 the right threshold** when ~61% of custom-mode calls land at 0.5? A 0.5–0.7 sensitivity
   sweep shows whether the drop is threshold-fragile.
9. **TIE-suppression valence** — desirable decisiveness or suppressed legitimate ties? Human spot-check.
10. **Parser code-version drift** between analyzed runs and HEAD — verify before trusting offline
    re-parse against historical rows.
