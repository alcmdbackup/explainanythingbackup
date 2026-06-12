# Effect of Asking the Judge to Explain Its Reasoning — Decisiveness vs Accuracy

How does adding an "explain your reasoning" instruction (or any custom rubric prompt) to the
evolution **Judge Lab** judge change its behavior? Short answer: it lowers the **decisive rate** by
raising **position bias** (correctly scored as 0.5 ties by the 2-pass reversal — NOT a parse bug),
and it trades **volume for precision** — fewer committed verdicts, but (for some models) much lower
error among the verdicts it does make. The effect is **strongly model- and content-dependent**, so
"explaining reasoning hurts performance across models" is **false as a universal claim**.

> **Provenance.** Project `analyze_performance_custom_prompt_judge_lab_evolution_20260611`
> (branch `feat/analyze_performance_custom_prompt_judge_lab_evolution_20260611`, 2026-06-11).
> Data: read-only staging mining of `judge_eval_calls`/`judge_eval_runs` (12,266 error-free calls /
> 112 runs) + an offline deterministic re-parse + a $0.14 controlled A/B sweep. Builds on
> [`judging_accuracy_20260412.md`](./judging_accuracy_20260412.md) and
> [`judge_agreement_summary_tables.md`](./judge_agreement_summary_tables.md); see the
> [Judge Evaluation deep dive](../feature_deep_dives/judge_evaluation.md) for the tool.

---

## Background: the three prompt modes and how a verdict is scored

The Judge Lab judge compares two texts via a **2-pass A/B reversal**: forward (A=X, B=Y) and reverse
(A=Y, B=X). The reverse verdict is flipped back to the original frame, and the two votes map to a
confidence via `aggregateWinners` (`evolution/src/lib/shared/computeRatings.ts:534`):

| Forward | Reverse (flipped) | Result | Confidence |
|---|---|---|---|
| same winner | same winner | that winner | **1.0** |
| winner | TIE | that winner | 0.7 |
| A | B (disagree) | **forced TIE** | **0.5** |
| winner | null (one parse fail) | that winner | 0.3 |
| null | null | TIE | 0.0 |

A call is **decisive** when `confidence > 0.6` (hard-wired; also the `decisive` GENERATED column in
`20260606000001_judge_eval_tables.sql`). So only 1.0 and 0.7 count; **0.5 (disagreement) and 0.3
(parse failure) are both non-decisive — and they mean very different things.**

The verdict instruction baked into the prompt selects the parser, and defines three modes:

| Mode | Verdict instruction | Parser |
|---|---|---|
| **default** | "Respond with ONLY one of these exact answers: A / B / TIE" | `parseWinner` |
| **explain-reasoning** | "First, briefly explain your reasoning … Then … 'Your answer: X'" | `parseVerdictFromReasoning` |
| **custom (no reasoning)** | operator rubric + "End your response with … 'Your answer: X'" | `parseVerdictFromReasoning` |

**What "accuracy" means here.** There is **no human ground truth**. Each pair snapshots an
`expected_winner` derived from the two variants' arena **Elo** ratings (`mu_a` vs `mu_b`). Accuracy =
agreement with that Elo expectation, and is only defined on `gap_kind='large'` pairs (Elo gap wide
enough — ~400 Elo ≈ 10:1 odds — to trust the higher-rated variant). It is an Elo proxy, itself built
from prior judge comparisons, so read it as "agreement with the arena's accumulated opinion on
clear-cut pairs," not absolute truth. Close pairs have no reliable right answer and are excluded.

---

## Finding 1 — the decisive-rate drop is increased POSITION BIAS, not parse failure

Decisive rate by mode (all error-free calls, current prompt formats):

| mode | n | decisive% | avg conf | parse-fail% (0.3/0.0) | position-bias (same-slot)% | conf=0.5% |
|---|---|---|---|---|---|---|
| explain_reasoning | 610 | 31.6 | 0.657 | **0.00** | 68.4 | 68.4 |
| custom_no_reasoning | 1350 | 36.4 | 0.681 | 0.07 | 63.5 | 63.5 |
| default_verdict_only | 3430 | 53.2 | 0.761 | **0.00** | 46.8 | 46.8 |

In explain-reasoning mode `decisive% + same-slot% = 31.6 + 68.4 = 100`: **every** non-decisive call
is a same-slot position-bias TIE @ 0.5, and **zero** are parse failures. "Position bias" = the judge
picks the same physical slot (A or B) in both reversal passes; after `flipWinner` the two votes
disagree, which `aggregateWinners` deterministically scores 0.5 — below the 0.6 threshold. The 2-pass
reversal is doing its job of catching the bias; the lower decisive rate is **correct measurement**.

**This is not a parsing artifact — proven by offline re-parse.** Re-parsing all stored `forward_raw`/
`reverse_raw` with the real engine parsers reproduced the stored verdicts + confidence at **100.00%**
in every current-format mode, and a deliberately more-permissive ("hardened") parser **rescued 0
passes**. (Script: `evolution/scripts/analyze-reasoning-parse.ts`, read-only.) If the drop were a
parse bug it would surface as a rise in the 0.3/0.0 buckets and a hardened parser would recover it;
neither happens.

---

### Reading the position-bias % (same-slot rate) — 0% is ideal, 50% is chance, not "neutral"

The position-bias / same-slot metric counts how often the judge picked the same **physical slot**
(A or B) in both reversal passes. Because the texts are swapped between passes, picking the **same
slot** = picking the **different text** = a self-contradiction (scored 0.5, the position tie); picking
the **same text** = *different* slot labels = agreement (scored decisive). The reference points are
therefore counter-intuitive:

| same-slot rate | meaning |
|---|---|
| **0%** | ideal — always flips with the text; pure content judging, no bias |
| **~50%** | coin-flip — the two passes are independent; no reliable signal and no net slot preference |
| **>50%** | systematic position bias — passes positively correlated on slot |
| **100%** | total position lock |

A judge that ignored content and favored a slot with probability *p* per pass yields same-slot =
*p*² + (1−*p*)², which bottoms out at **50% when p = 0.5** — so **you cannot exceed 50% from noise
alone**; anything above 50% requires a *systematic* slot preference, and content judging pulls the
rate *below* 50% toward 0. Read distance **above** 50% as how position-biased the judge is, distance
**below** 50% as how content-consistent it is. So gpt-4.1-mini at 30% is genuinely content-tracking;
deepseek-pro / gemini-lite at 80–88% are strongly position-locked; a pooled default rate ~47% is
barely better than guessing. (One nuance: below 50% the metric can't separate "good content judging"
from "lucky noise"; above 50% it is unambiguously systematic.) Note `same-slot% ≈ 100% − decisive%`
when ties/nulls are negligible.

---

## Finding 2 — reasoning trades VOLUME for PRECISION (the headline accuracy result)

On large-Elo-gap pairs (where an Elo "right answer" exists), pooled across all models:

| mode | commits on | correct *when* decisive | **wrong** *when* decisive | correct of *all* large-gap calls |
|---|---|---|---|---|
| **default** | 52.6% | 78.8% | **21.2%** | **41.4%** |
| **reasoning** | 42.1% | 90.3% | **9.7%** | 38.1% |

- **Among committed verdicts, reasoning roughly halves the error rate (21% → ~10%).**
- **But it commits less often** (42% vs 53%) — it abstains (0.5 TIE) on the harder/ambiguous pairs.
- **Net, it resolves slightly FEWER pairs correctly in absolute terms** (38.1% vs 41.4% of all
  large-gap calls), because the higher per-commit precision doesn't fully offset the lower volume.

Interpretation: reasoning makes the judge a **more conservative, higher-precision committer** but a
**lower-throughput** one. Whether that is "better" depends on what the evolution pipeline values —
fewer-but-surer Elo updates, or more-but-noisier ones. It is **not** a quality regression; if
anything it improves the trustworthiness of each decisive verdict.

> **Denominator caution.** Some of the precision gain is *because* of the extra abstention: declining
> the ambiguous pairs leaves an easier subset, which inflates "correct-when-decisive." The
> `correct of all` column is the abstention-proof view, and there reasoning is marginally behind.

---

## Finding 3 — the effect is strongly MODEL- and CONTENT-dependent (not universal)

**Decisive rate, models that ran both modes (historical, different test sets/N — suggestive):**

| model | default decisive% | reasoning decisive% | Δ |
|---|---|---|---|
| deepseek-v4-flash | 36.8 | 53.3 | **+16.5 (reasoning helps)** |
| deepseek-v4-pro | 42.3 | 24.5 | −17.8 |
| google/gemini-2.5-flash-lite | 57.2 | 16.0 | −41.2 |

**Error rate (wrong-when-decisive) on large-gap pairs, both modes:**

| model | default wrong% | reasoning wrong% |
|---|---|---|
| deepseek-v4-flash | 33.3 | **12.0** ✅ |
| deepseek-v4-pro | 40.8 | **3.3** ✅ |
| google/gemini-2.5-flash-lite | 13.2 | **21.4** ❌ (worse) |
| gpt-4.1-mini | 1.2 | 0.0 (already near-perfect) |

The pooled "21% → 10%" precision win is **driven by the weaker DeepSeek models**, whose default
error was high. **gemini-2.5-flash-lite gets *worse* with reasoning** (13% → 21%), and **gpt-4.1-mini
was already accurate** so reasoning is moot. A systematic parser bug would push every model the same
direction — this bidirectional split is itself strong evidence the effect is real model behavior.
(Reasoning-arm N is smaller, 24–110, so treat magnitudes as directional.)

---

## Finding 4 — controlled A/B sweep confirms it causally on identical pairs

Matched sweep on one frozen test set (`fr2-smoke`, 20 pairs, temp 0, repeats 3), baseline vs
`--explain-reasoning`, same models (total spend $0.14):

| model · kind | baseline decisive | reasoning decisive | Δ | position-bias base→reason |
|---|---|---|---|---|
| deepseek-flash · article | 70% | 20% | −50 | 33→**89%** |
| deepseek-flash · paragraph | 30% | **100%** | **+70** | 70→**0%** |
| deepseek-pro · article | 73% | 70% | −3 | 30→33% |
| deepseek-pro · paragraph | 40% | 13% | −27 | 60→**87%** |
| gpt-4.1-mini · article | 60% | 57% | −3 | 44→48% |
| gpt-4.1-mini · paragraph | 70% | 60% | −10 | 30→40% |

In **every** cell, decisive rate moves **inversely and tightly with position bias** — the mechanism,
on identical texts. And reasoning is not uniformly harmful: it took deepseek-flash on paragraphs from
30% → **100%** decisive (position bias 70% → 0%). The direction depends on model × content kind.

---

## Finding 5 — position bias rises with output length (dose-response)

Within reasoning mode, **longer outputs are more position-biased**, and the relationship survives
controls for both **model** and **pair difficulty** — making output length the cleanest dose-response
evidence for the rationalization mechanism below.

**Per model** (each model's reasoning outputs split at its own median length):

| model | short outputs | long outputs |
|---|---|---|
| deepseek-v4-pro | 63% bias (144 tok) | 80% (178 tok) |
| google/gemini-2.5-flash-lite | 80% (137 tok) | 88% (165 tok) |
| gpt-4.1-mini | 30% (163 tok) | 53% (222 tok) |

**Controlling for difficulty** (length halves *within* each `gap_kind`):

| difficulty | short outputs | long outputs | Δ |
|---|---|---|---|
| close pairs | 60.2% (144 tok) | 74.2% (177 tok) | +14.0 |
| large-gap pairs | 54.1% (148 tok) | 61.6% (180 tok) | +7.5 |

Every cut points the same way: more output → more position bias. It holds within each model (so it is
not "verbose models happen to be biased") and within each difficulty bucket (so it is not merely "the
model writes more on hard pairs"). The effect is larger on close pairs (+14 vs +7.5), consistent with
content signal partially anchoring the reasoning on large-gap pairs. This is the **opposite** of the
"more chain-of-thought reduces bias" intuition — here every extra sentence is another opportunity to
construct and lock in a slot-anchored narrative.

> **Caveat — correlational.** Output length is not randomly assigned, so residual difficulty not
> captured by `gap_kind` could contribute. The clean causal test is to vary the *requested*
> explanation length ("explain in 1 sentence" vs "5 sentences" vs verdict-only) on identical pairs and
> measure bias — a cheap controlled sweep, not yet run.

---

## Why does asking for reasoning increase position bias? (mechanism — now transcript-confirmed)

The best-supported explanation: **chain-of-thought rationalizes a recency prior instead of correcting
it.** Three legs, the first two measured, the third directly observed in transcripts.

**(1) There is a baseline recency prior, and reasoning amplifies it.** Among position-locked calls
(same physical slot picked in both passes), which slot wins, by mode:

| mode | same-slot rate | of those, "both picked the 2nd text" (recency) | explicit double-TIE @1.0 |
|---|---|---|---|
| default | 46.8% | 60.7% | 0.3% |
| reasoning | 68.4% | 67.1% | 1.1% |

When the judge is position-driven it favors the **second / most-recently-read** text ~61–67% of the
time, and reasoning pushes that recency share up (60.7% → 67.1%) on top of making position-driven
verdicts far more common overall (same-slot 46.8% → 68.4%). The prompt is
`[rubric][Text A][Text B][instructions][Your answer:]`, so Text B sits closest to where the verdict
is generated. Note this also **refutes** a "suppressed-TIE" story: explicit decisive TIEs are rare in
*both* modes (0.3% vs 1.1%), so the lost decisiveness is not converted explicit ties — default-mode
decisive calls are genuine cross-frame *winner* agreements that reasoning turns into same-slot 0.5s.

**(2) Generating an explanation is a recency-weighted operation.** Asking for "2–4 sentences, then a
verdict" makes the model summarize what it just read before committing; autoregressive attention
over-weights the most recent text, so the rationale disproportionately builds a case for Text B, and
the verdict must then stay consistent with the rationale it just wrote. The prior is amplified, not
averaged out. On a no-ground-truth comparison this is the known CoT failure mode — reasoning helps
when there is a verifiable answer to reason *toward*, but on an ambiguous A-vs-B it becomes post-hoc
rationalization of whatever prior the model already had (here, position). Because the prior is
*positional*, it appears identically in both reversal passes → same-slot → correctly scored 0.5.
**Finding 5 measures this dose-response directly:** bias rises monotonically with output length, within
both model and difficulty — the more the model writes, the more it talks itself into a slot.

**(3) Transcript confirmation — opposite justifications for the same content, by slot.** Inspecting
`forward_raw`/`reverse_raw` on same-slot 0.5 calls (deepseek-v4-pro, paragraph) shows the model
anchoring on "Text B is stronger" and inventing whichever rationale fits the slot — citing the **same
content feature with opposite valence** depending on where it sits. One pair, forward vs reverse
(texts swapped between passes):

> **Forward** (variant X in slot B): "Text B is stronger… it eliminates wordiness … and **avoids the
> slightly forced analogy about judges**, which adds little useful detail. *Your answer: B*"
>
> **Reverse** (variant X now in slot A): "Text B is stronger… more vivid phrasing … and **the simile
> comparing governors' terms to judicial independence**. It adds useful detail … *Your answer: B*"

The judges/judicial-independence analogy is praised for being **absent** when in slot B and praised
for being **present** when in slot B. (Another pair does the same with a "shopkeeper analogy" — "feels
forced" in slot A, "vivid … clarifies" in slot B.) The model is not evaluating content; it is
defending a fixed positional choice. This is the rationalization mechanism in the model's own words.

**(4) Why it only bites ambiguous pairs.** On large-gap pairs the content signal is strong enough to
override recency, so reasoning helps there (it reasons to the genuinely-better text → precision up,
error halved, Finding 2). It is specifically the close / quality-equivalent pairs — where there is no
real winner to reason toward — that recency fills, producing the 0.5 ties. This is exactly why
reasoning *simultaneously* lowers decisive rate and raises accuracy-when-decisive.

**Remaining caveat.** The recency numbers are measured and the transcript anchoring is directly
observed, but the latter is from deepseek-v4-pro paragraph cases; the "CoT rationalizes priors"
framing is well-supported in the literature and consistent with our data, not an isolated causal test
across all models. gemini-2.5-flash-lite (which got *worse* on accuracy too) may anchor differently.

---

## What it means for the evolution pipeline

- **Don't read a lower Judge Lab decisive rate under reasoning as "the judge got worse."** It got
  more position-biased *and* (for weak models) more precise-when-decisive. For the Elo loop the real
  cost is throughput: more 0.5 ties = fewer rating updates per comparison-dollar.
- **Model choice dominates.** For an already-accurate judge (gpt-4.1-mini), reasoning adds latency/
  cost for no precision gain and some decisiveness loss — not worth it. For a cheap-but-noisy judge,
  reasoning can sharply cut confident errors at the price of throughput.
- **Report decisiveness AND accuracy together.** Decisive rate alone is misleading; pair it with
  large-gap accuracy and position-bias rate so the precision/throughput trade-off is visible.

## Caveats

- "Accuracy" = agreement with arena Elo on large-gap pairs, not human ground truth (Elo is itself
  judge-derived; most trustworthy on wide gaps).
- Historical per-model comparisons pool different test sets / N; the $0.14 sweep is controlled but
  small (20 pairs, repeats 3). Magnitudes are directional, the direction is robust.
- `explainReasoning` is **not persisted** in `judge_eval_runs`; mode here is recovered from the
  verdict instruction in `forward_prompt`, so 6,876 pre-audit-migration rows (NULL prompt) are
  excluded. Persisting the mode is a recommended follow-up.
- OpenRouter-routed models (e.g. gemini-2.5-flash-lite) could not be re-swept (account out of
  credits / 402); their numbers are historical only.

## Related documents

- [Judge Evaluation (Judge Lab) deep dive](../feature_deep_dives/judge_evaluation.md) — the tool, data model, parser selection.
- [`judging_accuracy_20260412.md`](./judging_accuracy_20260412.md) — original judge accuracy/noise + OpenSkill beta calibration.
- [`judge_agreement_summary_tables.md`](./judge_agreement_summary_tables.md) — agreement/decisiveness tables incl. the `parseWinner` "Your answer:" precedent.
- Project: `docs/planning/analyze_performance_custom_prompt_judge_lab_evolution_20260611/` — full research + per-phase progress.
