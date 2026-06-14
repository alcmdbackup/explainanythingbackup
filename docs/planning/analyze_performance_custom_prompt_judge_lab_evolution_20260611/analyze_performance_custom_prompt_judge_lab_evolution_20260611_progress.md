# Analyze Performance of Custom-Prompt Judge (Explain Reasoning) in Judge Lab — Progress

## Research (4 rounds × 5 agents + synthesis, 2026-06-11)
### Work Done
Ran a 21-agent investigation (multi-round workflow). Established the full mechanism and a provisional
verdict — see `_research.md` (High Level Summary, Key Findings, Bug-vs-Real Decision).
- **Provisional verdict: most likely a GENUINE model effect (position-bias shift → confidence=0.5),
  NOT a parse artifact** — confidence moderate-to-high, pending Phase-1 capture + Phase-2 re-parse.
- Parser-selection lever confirmed at `runJudgeEval.ts:101-103`; confidence ladder at
  `computeRatings.ts:534-555`; decisive threshold 0.6 hard-wired (incl. `decisive` GENERATED column).
- **Real secondary defect found:** `explainReasoning` is NOT persisted anywhere → historical runs
  with `prompt_variant=NULL` are ambiguous about which parser ran. Phase 4 now fixes this regardless.
- Agent-reported staging SQL (decisive ~51.5%→38.7%, +position-bias, flat parse-fail, bidirectional
  per-model) is **UNVERIFIED** — must be re-run + recorded here, and model IDs re-verified.

### Issues Encountered
- Agents ran ad-hoc staging SQL not captured as durable artifacts (Phase 1 deliverable). Some
  reported model names (e.g. "DeepSeek-V4-Pro/Flash") look non-standard → flagged for re-verification.

## Phase 1: Reproduce & Localize (existing data) — DONE (staging, read-only, 2026-06-11)
### Work Done
Read-only staging mining via `npm run query:staging`. Data: 12,278 calls / 112 runs (9,266 baseline
`prompt_variant IS NULL` / 3,000 custom). **Parser mode classified from the verdict instruction baked
into `forward_prompt`** (more precise than `prompt_variant`, which misses explain-reasoning-on-default):
- `default` (→ `parseWinner`): forward_prompt LIKE '%Respond with ONLY one of these exact answers%'
- `explain_reasoning` (→ `parseVerdictFromReasoning`): LIKE '%First, briefly explain your reasoning%'
- `custom_no_reasoning` (→ `parseVerdictFromReasoning`): LIKE '%You may include reasoning. End your response%'

**Master breakdown (error IS NULL):**

| mode | n | decisive% | avg_conf | parse-fail%(0.0/0.3) | same-slot/position-bias% | conf=0.5% |
|---|---|---|---|---|---|---|
| explain_reasoning | 610 | 31.6 | 0.657 | **0.00** | 68.4 | 68.4 |
| custom_no_reasoning | 1350 | 36.4 | 0.681 | 0.07 | 63.5 | 63.5 |
| default_verdict_only | 3430 | 53.2 | 0.761 | **0.00** | 46.8 | 46.8 |
| other (older/paragraph prompt fmts) | 6876 | 49.8 | 0.746 | 0.17 | 50.1 | 50.0 |

In explain_reasoning: decisive% + same-slot% = 31.6 + 68.4 = 100 → **every** non-decisive call is a
position-bias 0.5 TIE; **zero** parse failures. The decisive drop is 100% position bias, 0% parsing.

**Large-gap accuracy (gap_kind='large', expected_winner known):**

| mode | n | decisive% | accuracy WHEN decisive | confidently-WRONG% | overall-correct% |
|---|---|---|---|---|---|
| explain_reasoning | 246 | 37.8 | **89.3** | **4.1** | 33.7 |
| custom_no_reasoning | 540 | 32.6 | 82.4 | 5.7 | 26.9 |
| default_verdict_only | 1343 | 52.6 | 78.8 | 11.2 | 41.4 |

→ Reasoning IMPROVES precision (89% vs 79% when decisive; confident-error 11%→4%) but lowers recall
(commits 38% vs 53%), so it resolves fewer large-gap pairs overall (34% vs 41%).

**Per-model (only 3 models ran BOTH modes; caveat: not same test_set/N — Phase 3 controls this):**

| model | default decisive% | reasoning decisive% | Δ |
|---|---|---|---|
| deepseek-v4-flash | 36.8 (n=560) | 53.3 (n=210) | **+16.5 (HELPS)** |
| deepseek-v4-pro | 42.3 (n=560) | 24.5 (n=200) | −17.8 |
| google/gemini-2.5-flash-lite | 57.2 (n=1430) | 16.0 (n=200) | −41.2 |

→ **Bidirectional / model-dependent** — incompatible with a single systematic parser bug.

### Provisional Phase-1 verdict
1. **NOT a parse bug** — parse-fail ~0% in reasoning mode; the whole decisive drop is increased
   position bias, correctly scored 0.5 by the 2-pass reversal (working as designed).
2. **Accuracy NOT hurt — improved** (per the user's lead metric). Reasoning makes the judge more
   precise and far less confidently-wrong; what drops is decisive rate / signal recall (the cost).
3. **NOT uniform "across models"** — bidirectional (helps flash, hurts pro + gemini-lite).
So "custom/reasoning prompt conclusively hurts performance across models" is: real (not a bug) as a
decisive-rate/recall cost for most models, FALSE as an accuracy regression, and NOT universal.

### Issues Encountered
- `explainReasoning` not persisted → mode recovered from `forward_prompt` text (robust here).
- Default vs reasoning runs per model use different test_sets/N → per-model deltas are suggestive,
  not perfectly controlled. Phase 3 controlled sweep (same frozen set) resolves this.
- Agent-reported model names (deepseek-v4-flash/pro) turned out to be REAL judge_model values.

### User Clarifications
- Deliverable scope: **Report + fix if bug found** (investigate first; fix only if a parsing/format
  bug is isolated; produce a conclusive report either way).
- Evidence sources: **Both** — mine existing persisted judge_eval data first, then confirm with
  targeted new controlled sweeps.
- **Claim origin (2026-06-11):** user **saw the drop in the Judge Lab leaderboard** across multiple
  models → real recorded runs exist; Phase 1 anchors on those actual rows.
- **"Performance" definition:** **Both, ranked** — lead with **accuracy** (large-gap, vs ground
  truth) as the regression signal; report **decisive-rate** loss as a cost (budget/efficiency), not
  itself proof of a regression.
- **Execution:** run **Phases 1–3**; Phase 3 sweep **pre-authorized but capped at $1** (not $5) —
  `JUDGE_EVAL_MAX_USD=1`, dry-run + scale down to fit.

## Phase 2: Bug-vs-Real Discrimination (offline re-parse) — DONE (2026-06-11)
### Work Done
Wrote read-only forensic `evolution/scripts/analyze-reasoning-parse.ts` (SELECT-only via
`.env.staging.readonly`; imports the real `parseWinner`/`parseVerdictFromReasoning`/`aggregateWinners`).
Re-parsed all 12,266 stored `forward_raw`/`reverse_raw` and compared to stored verdicts + confidence;
also ran a HARDENED reasoning parser (widened verdict-marker regex: + decision|response|answer|choice).

**Results (audit-captured rows, current prompt formats):**

| mode | n | fwd match | rev match | confidence match | engine NULL passes | hardened RESCUED |
|---|---|---|---|---|---|---|
| explain_reasoning | 610 | 100.00% | 100.00% | 100.00% | 0.00% | **0** |
| custom_no_reasoning | 1350 | 100.00% | 100.00% | 100.00% | 0.04% | **0** |
| default | 3430 | 100.00% | 100.00% | 100.00% | 0.00% | **0** |

→ **DEFINITIVE: NOT a parse artifact.** Stored verdicts + confidence reproduce exactly; a deliberately
more-permissive parser rescues ZERO passes. The decisive-rate drop is a real model effect (position
bias correctly scored 0.5 by the 2-pass reversal). (default's "decisive% if hardened = 0%" is a
category artifact — the reasoning-marker hardened parser can't read bare `A`/`B` default outputs;
irrelevant since default re-parses at 100% with its real `parseWinner`.)

**`other` bucket = 6,876 PRE-audit-migration rows** (first seen 2026-06-07, before audit columns landed
2026-06-10) with NULL `forward_prompt` → mode unrecoverable by the forensic (72% match / 3,801 rescues
is a classifier-can't-recover-mode artifact, NOT a pipeline bug). Reinforces the Phase 4 need to
persist the mode explicitly.

### Issues Encountered
- `forward_prompt` nullable (pre-audit rows) → guarded `classify()`; excluded from the clean verdict.

## Phase 3: Confirm with Controlled Sweeps (new data) — DONE (2026-06-11, spend $0.14 of $1 cap)
### Work Done
Matched A/B on the SAME frozen test set `fr2-smoke` (20 pairs, temp 0, repeats 3), baseline
(explainReasoning OFF) vs reasoning (ON), 3 direct-API models. `gemini-2.5-flash-lite` excluded —
OpenRouter account is out of credits (402), an ops/billing issue, not code.

| model · kind | baseline decisive | reasoning decisive | Δ | posBias base→reason |
|---|---|---|---|---|
| deepseek-v4-flash · article | 70% | 20% | −50 | 33→89% |
| deepseek-v4-flash · paragraph | 30% | 100% | +70 | 70→0% |
| deepseek-v4-pro · article | 73% | 70% | −3 | 30→33% |
| deepseek-v4-pro · paragraph | 40% | 13% | −27 | 60→87% |
| gpt-4.1-mini · article | 60% | 57% | −3 | 44→48% |
| gpt-4.1-mini · paragraph | 70% | 60% | −10 | 30→40% |

→ **Causally confirmed on identical pairs.** In every cell decisive rate moves **inversely and
tightly with position bias** (the 2-pass-reversal mechanism), NOT with any parse failure. The effect
is strongly **model- AND content-kind-dependent**: reasoning HELPED deepseek-flash on paragraphs
(+70) while HURTING it on articles (−50); hurt deepseek-pro paragraphs; barely moved gpt-4.1-mini.
This refutes a uniform "conclusively hurts across models."

### Issues Encountered
- OpenRouter-routed models (gemini-2.5-flash-lite) fail with 402 (credits exhausted) → can't be swept
  until credits are topped up. DeepSeek + OpenAI direct paths work. Dry-run cost estimates are very
  conservative (est $0.27/$0.50; actual total $0.14).

## Phase 4: Fix (only if a bug is isolated) + Re-measure
### Work Done
No parsing/format bug to fix (Phase 2 proved 100% parse fidelity, 0 hardened-rescue). The one real
defect found is the **audit-persistence gap** (`explainReasoning` not stored → 6,876 pre-audit rows
un-analyzable by mode). Recommended follow-up (NOT yet implemented): add an
`explain_reasoning_requested` column + surface mode in the leaderboard. Pending user go-ahead.

## Phase 5: Report — see _research.md "Conclusion"

## Phase 4: Fix (only if a bug is isolated) + Re-measure
### Work Done
[Pending]

## Phase 5: Report
### Work Done
[Pending]
