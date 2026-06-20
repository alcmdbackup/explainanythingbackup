# Acceptance Gate (A) + Phase 5 composition (B) — Findings

Date: 2026-06-15. Measured on the live dev DB ("Federal Reserve 2" bank) with **n=60 large-gap pairs/mode**
(the gate's required power; the earlier pinned-corpus read was n=9 article / n=20 paragraph — underpowered).
Reproduce: `npx tsx evolution/scripts/gate-live-report.ts` (test sets `gate-article-lg60` / `gate-paragraph-lg60`).

## A) Acceptance gate — properly powered (n=60)

| Mode | Chain | decisive | large-gap accuracy | lone-decisive-WRONG | cost/dec | Verdict |
|---|---|---|---|---|---|---|
| Article | `[gpt-4o-mini → deepseek-chat]` | 63% | **92.1%** | **7.9%** | $0.00162 | **borderline NO-GO** |
| Paragraph | `[gemini-2.5-flash-lite → deepseek-v4-flash → gemini-2.5-flash]` | 67% | 80% | **20%** | $0.00038 | **NO-GO** |

Single-judge baselines (n=60):
- Article: gpt-4o-mini 45% dec / **96.3% acc** / 3.7% lone-wrong · deepseek-chat 52% / 90.3% / 9.7% · deepseek-v4-flash 52% / 90.3% / 9.7%
- Paragraph: gemini-2.5-flash-lite 57% / 79.4% / 20.6% · deepseek-v4-flash 15% / 77.8% / 22.2% · gemini-2.5-flash 5% / 66.7% / 33.3%

**Gate criteria result:**
- **Decisiveness uplift ≥0.10**: ✓ both (article +12pt, paragraph +10pt over best cheap single).
- **Large-gap accuracy guard (≥ strong − 3pt)**: ✗ article (92.1% vs gpt-4o-mini 96.3%, −4.2pt). Paragraph "passes" only because the strong reference (gemini-lite) is itself weak (79.4%).
- **Lone-decisive-wrong ≤10%**: ✓ article (7.9%) · ✗ paragraph (20% — 1 in 5 confident large-gap verdicts is WRONG).
- **Cost ≤ strong**: ✓ article · ✗ paragraph (chain cheaper-per-call but the cheap strong-ref gemini-lite is cheapest).

### Bottom line
The small-sample (n=9) "100% article accuracy / 0% lone-wrong" was luck. At proper power the cheap ensemble
**trades accuracy for decisiveness**: articles introduce ~8% confident-wrong on large-gap pairs (borderline —
fails the strict 3-pt accuracy guard), paragraphs ~20% (clear fail). **The original decision to ship Phase 4
default-OFF was correct.** Recommendation: **do not enable escalation in production ranking** on these numbers.

## B) Phase 5 — chain composition + levers

- **Per-mode composition**: the cheap escalation *targets* (deepseek-chat / deepseek-v4-flash at ~90% acc;
  paragraph models ≤79% acc) cap chain accuracy. No cheap composition reaches the ~93% accuracy guard while
  staying decisive. The only "safe" option is a single accurate judge run alone (gpt-4o-mini 96%/45% dec;
  gemini-flash 67% acc — not even safe), which fails the uplift bar. **No cheap ensemble passes both guards.**
- **Article 3rd tier**: adding a strong model does not help — the 2-model chain is already accuracy-capped by
  its decisive cheap target, and a strong tier rarely fires (first decisive vote resolves).
- **Force-a-winner / TIE-discouraging rubric (Option F)**: would *increase* decisiveness, which on this data
  means *more confident-wrong* verdicts (the bottleneck is accuracy, not indecision). Not pursued — it makes
  the safety metric worse, not better.

### What would actually move the needle (future, not done here)
A cheap judge that is BOTH decisive AND ≥95% accurate on large-gap pairs (none of the recorded cheap models
qualify), or accepting a single strong judge (gpt-4o-mini for articles) at lower decisiveness, or routing only
the *high-confidence-unanimous* subset to the cheap ensemble and the rest to a strong judge (hybrid — untested).

## C) Tie-breaking from the INCUMBENT judge (gemini-2.5-flash-lite) — the right lens

The gate above measures the chain as a *standalone* judge. But the prod judge is already gemini-2.5-flash-lite,
and first_decisive only escalates when the LEAD abstains — so escalation is **strictly additive on the ties
gemini leaves as draws** (it never changes a pair gemini already decides). Scoped to that subset
(`npx tsx evolution/scripts/tie-break-report.ts`, large-gap pairs):

| Mode | gemini indecisive | escalate to | broken | break-accuracy | net (correct/wrong) |
|---|---|---|---|---|---|
| Article | 20/60 | gpt-4o-mini → deepseek-chat | 20% | 75% | +3 / −1 (3:1) |
| Article | 20/60 | gpt-4o-mini | 10% | 100% | +2 / −0 |
| Paragraph | 26/60 | deepseek-v4-flash | 23% | 83% | +5 / −1 (5:1) |

**Conclusion:** for a gemini-flash-lite incumbent, escalation is a Pareto improvement on its indecisive subset
— it converts ~20-23% of no-signal draws into net-correct decisions (3:1–5:1 good:bad) and cannot worsen
gemini's existing calls. Recommended configs: paragraph `gemini-2.5-flash-lite → deepseek-v4-flash`; article
`gemini-2.5-flash-lite → gpt-4o-mini [→ deepseek-chat]`. Caveat: small numerators (the "−1 wrong" is 1 pair) —
widen to n≈150 to tighten the ratios. Safe to enable in **staging** for live telemetry (additive-only).

This does NOT contradict (A): the cheap chain is a poor standalone judge, AND it is a net-positive tie-breaker
*added to* an existing gemini-flash-lite judge. Different questions, different answers.

### C2) Partner ranking at n=150 (`tie-break-report.ts`)

gemini-2.5-flash-lite is indecisive on **30.7% (article) / 34.0% (paragraph)** of large-gap pairs (today = draws).
Ranking each candidate escalation partner on that tie subset:

| Partner | Article breaks/acc | Article net | Paragraph breaks/acc | Paragraph net |
|---|---|---|---|---|
| **gpt-4o-mini** | **24% / 91%** | **+10/−1** | **28% / 100%** | **+14/−0** |
| deepseek-v4-pro | 39% / 56% | +10/−8 | 29% / 87% | +13/−2 |
| deepseek-chat | 24% / 73% | +8/−3 | 12% / 83% | +5/−1 |
| deepseek-v4-flash | 24% / 73% | +8/−3 | 12% / 83% | +5/−1 |
| gemini-2.5-flash | 13% / 83% | +5/−1 | 4% / 50% | +1/−1 |

**Winner: `gpt-4o-mini`** on both modes — best break-accuracy (91% / 100%), near-zero wrong additions, because its
errors are uncorrelated with gemini's (cross-family diversity). The gemini sibling is the *worst* partner (correlated,
abstains on the same pairs). `deepseek-v4-pro` breaks the most ties but is decisive-but-wrong on the hard ones
(volume ≠ value).

**Absolute vs relative** for `gemini-2.5-flash-lite → gpt-4o-mini`: of ALL large-gap pairs, gemini ties on ~31-34%;
of those ties, gpt-4o-mini breaks ~24-28% (**relative**) = ~**7-9% of ALL pairs recovered (absolute)** at ~90-100%
accuracy. It cannot touch the 66-69% gemini already decides.

**Recommended config: `gemini-2.5-flash-lite → gpt-4o-mini` for both modes** (cap 2, first_decisive). Sweeps used
test sets `gate-article-lg150` / `gate-paragraph-lg150` (150 large-gap pairs each), ~$1.8 live spend.

### C3) Third model + sequence exploration (n=150, offline — `sequence-explore.ts`)

**Best 3rd model after `gemini-2.5-flash-lite → gpt-4o-mini`** (on residual ties where both abstain):
- Paragraph (37 residual): **deepseek-v4-pro** — breaks 10, +8/−2 (80%). Worth adding.
- Article (35 residual): marginal — gemini-2.5-flash +4/−1 (only 5 breaks); deepseek-v4-pro is HARMFUL (+5/−8, 38%).
  Article residual ties are genuinely ambiguous → keep articles at 2 models.

**Top complementary, cost-effective sequences** (acc ≥85%, lone-wrong ≤12%):
- Article: `gemini-2.5-flash-lite → gpt-4o-mini → deepseek-v4-flash` (81% dec / 91% acc / 9% lone-wrong / $0.00098);
  cheapest-safe `deepseek-v4-flash → deepseek-chat` (65% / 92% / $0.00021).
- Paragraph: `gpt-4o-mini → gemini-2.5-flash-lite → deepseek-v4-pro` (82% / 89% / 11% / $0.00038).

**Patterns:** (1) cross-family diversity is the whole game — best chains mix Google + OpenAI + DeepSeek; same-family
(gemini-lite + gemini-flash) adds ~nothing. (2) Accuracy plateaus at ~90% no matter how many cheap models you
stack — more models buy decisiveness, not accuracy; a 3rd model only pays off where it adds *correct* breaks
(paragraphs), not confident-wrong ones (articles). (3) gpt-4o-mini is the universal MVP (best partner AND member).

**Final recommendation:** articles `gemini-2.5-flash-lite → gpt-4o-mini` (2 models); paragraphs
`gemini-2.5-flash-lite → gpt-4o-mini → deepseek-v4-pro` (3 models).

## Wired config (`chainRegistry.ts`)

Registered as `ensembleConfigId: 'gemini-tiebreak-v1'` (first_decisive, cap 3):
- Article: `google/gemini-2.5-flash-lite → gpt-4o-mini`
- Paragraph: `google/gemini-2.5-flash-lite → gpt-4o-mini → deepseek-v4-pro`

**To enable (staging first, additive-only — it only fires on gemini's ties):**
1. Set `EVOLUTION_JUDGE_ESCALATION_ENABLED='true'` in the environment.
2. Set the strategy config's `ensembleConfigId: 'gemini-tiebreak-v1'`.
Default (unset) → byte-identical single-judge ranking. Submatch telemetry (Match Viewer + the
`evolution_arena_submatches` tables) records every judge's verdict + where escalation fired.

## Artifacts
- Reusable tooling (committed): `evolution/scripts/acceptance-gate-report.ts` (offline, pinned corpus),
  `chain-composition-explore.ts` (offline composition search), `build-gate-testsets.ts` (large-gap test sets),
  `gate-live-report.ts` (live n=60 gate).
- Dev DB test sets: `gate-article-lg60`, `gate-paragraph-lg60` (frozen, 60 large-gap pairs each).
- Live spend: ~720 LLM calls (~$0.28 actual).
