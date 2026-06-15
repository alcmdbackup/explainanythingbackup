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

## Artifacts
- Reusable tooling (committed): `evolution/scripts/acceptance-gate-report.ts` (offline, pinned corpus),
  `chain-composition-explore.ts` (offline composition search), `build-gate-testsets.ts` (large-gap test sets),
  `gate-live-report.ts` (live n=60 gate).
- Dev DB test sets: `gate-article-lg60`, `gate-paragraph-lg60` (frozen, 60 large-gap pairs each).
- Live spend: ~720 LLM calls (~$0.28 actual).
