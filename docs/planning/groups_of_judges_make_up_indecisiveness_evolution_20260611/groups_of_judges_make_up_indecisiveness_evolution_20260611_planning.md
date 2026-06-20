# Groups Of Judges Make Up Indecisiveness Plan

## Background
Help me figure out how to combine together multiple judges in case a single judge is indecisive on a given paragraph or article.

## Requirements (from GH Issue #NNN)
- Look at judge lab results and come up with proposals that can be experimentally tested/validated.
- Utilize judge lab infrastructure if possible.
- Want things that are cheap as possible but still help to get decisive outcomes from weaker judges put together.
- Also suggest other useful judge optimization tactics that can help improve accuracy & decisiveness if any.

## Problem
The evolution arena uses a single LLM judge per pairwise comparison (2-pass A/B reversal ->
confidence 0.0-1.0; decisive when `confidence > 0.6`). Weak/cheap judges frequently land
indecisive - passes disagree (forced TIE @ 0.5), genuine TIEs, or parse failures - especially
on quality-equivalent paragraph pairs, which froze per-slot Elo at 1200. We want to combine
several **cheap** judges so the *group* is more decisive (and ideally more accurate) than one
cheap judge, at a total cost competitive with - ideally below - a single strong judge. Judge
Lab can validate any such proposal on a frozen test set before it touches the production loop.

## Decision (2026-06-12): sequential ESCALATION, not a parallel panel
Run **one judge**; only if it is indecisive, add a **different model** as a second submatch;
only if still indecisive, add a **third** different model. **Cap = 3.** Fold the 1-3 submatches
into **one match** via a versioned aggregation rule. Escalation (not a fixed K-panel) because:
it pays for extra judges only on the hard pairs, it never folds an abstention into the verdict
(no dilution), and avg cost stays near 1 judge. The model **chain is mode-aware** (article vs
paragraph) - see Finding: model quality is mode-dependent.

## Terminology (locked)
| Term | Meaning |
|---|---|
| **Matchup** / pair | the two texts being compared (constant across submatches) |
| **Match** | the resolved comparison that updates Elo **once** (the aggregate) |
| **Submatch** | one judge's verdict on the matchup: one model + its own 2-pass reversal; **1-3 per match** |
| **Pass** | the forward / reverse evaluation inside a submatch (existing term) |
| **Escalation** | adding a submatch because the running aggregate is still indecisive |
| **Aggregation rule** (versioned) | how submatches fold into the match verdict |
"panel" is **retired** (implies parallel voting; this is a sequential chain).

## Options Considered

> Research established two regimes (research doc Findings 1-6): paragraphs = deterministic
> within-model position bias (fixed by cross-MODEL diversity, NOT repeats or escalation-to-strong);
> articles = genuine signal/noise (cheap chain, optional strong tie-breaker). Most options validate
> OFFLINE for ~$0.

- [x] **Option A (CHOSEN): Sequential escalation chain, cap 3, mode-aware models**: 1 judge -> +different model iff indecisive -> +third iff still indecisive. Cheapest decisive-per-dollar; no abstention dilution; consolidates to one match.
- [x] **Option E: Offline re-aggregation (validation-first) — DO FIRST**: replay recorded `judge_eval_calls` through candidate rules; zero schema change, ~$0. Prototyped in research (articles 0.63->0.83; paragraphs 62% >=2-agree).
- [ ] ~~**Option B: Parallel panel (fixed K, all judges always run)**~~ — **DROPPED** in favor of escalation (pays for all K every time; folds abstentions). Kept only as the conceptual limit case.
- [ ] **Option F: Force-a-winner / TIE-discouraging rubric (non-ensemble)**: complementary lever; drains the 0.5 paragraph plateau at the prompt level. Needs ONE fresh cheap sweep. Guardrail: large-gap accuracy must not drop.
- [ ] ~~**Option C: Same-model repeats (self-consistency)**~~ — **REJECTED by data** (Finding 3): paragraph position bias is deterministic (indecisive pairs split 40/40 across 40 repeats).

## Model chains — FINALIZED in Phase 1 (2026-06-13, on the pinned corpus)
Offline analysis (`runJudgeEnsembleOffline.ts`) confirmed the chains below. Ordering matters under
`first_decisive` (the first *accurate* cheap judge should lead), and strong tiers HURT:
- **Article: `[gpt-4o-mini, deepseek-chat]`** — 0.833 decisive, 1.000 large-gap accuracy, 0.000
  lone-wrong, $0.00127/dec. Adding gpt-4.1 as a 3rd tier raised decisiveness to 0.967 but DROPPED
  accuracy to 0.778 (its own error rate) — so the strong tier is omitted.
- **Paragraph: `[gemini-2.5-flash-lite, deepseek-v4-flash, gemini-2.5-flash]`** — 0.740 decisive
  (vs 0.60 best single), 0.765 accuracy, $0.00053/dec. `deepseek-v4-pro` was REMOVED (decisive-but-
  wrong on paragraphs, acc 0.200 — the "don't escalate paragraphs to a strong model" finding).
- **Open at the gate:** paragraph lone-decisive-wrong = 0.235 (> the 0.10 bar) but large-gap n=20 is
  underpowered — widen corpus to >=50/mode before trusting it (or default paragraphs to
  `unanimous_among_decisive`, which restores 1.000 accuracy at ~0.22–0.30 decisive). See `_progress.md`.

### Original starting picks (superseded by the above; kept for provenance)
> Note: these pre-analysis picks were partly contradicted by the data (gpt-4.1-nano/qwen weren't in
> the pinned sets; deepseek-v4-pro hurt paragraphs). The finalized chains above replace them.

## Model chains (starting picks — CONFIRM in Phase 1 offline before committing)

Model quality is **mode-dependent** (single-judge decisive rate, from recorded data):
`gpt-4.1-nano` = 0.53 paragraph but **0.04 article**; `deepseek-chat` = 0.40 paragraph but **0.63
article**. So the ladder switches on the comparison's existing `mode`.

**Paragraph ladder (all cheap, three different families - decorrelated position bias):**
1. `deepseek-v4-flash` (0.52 decisive, best $/decisive $0.00009) — DeepSeek
2. `gpt-4.1-nano` (0.53, highest paragraph decisive) — OpenAI
3. `qwen-2.5-7b-instruct` (0.46, current prod default) — Qwen
   - Do NOT escalate paragraphs to a strong model (Finding 2: strong = less decisive on paragraphs).

**Article ladder (cheap -> cheap -> strong tie-breaker):**
1. `deepseek-chat` (0.63, $0.00071) — DeepSeek
2. `gpt-4o-mini` (0.63) — OpenAI
3. `gpt-4.1` (0.90 strong; fires only when 1+2 both punt, so affordable). Alt: `deepseek-v4-pro` (0.87).

Rationale: family diversity in the first two maximizes the chance one judge "sees" a pair the
other is blind to; the rare 3rd call can afford strength. Final composition is a Phase-1 output
(pick the most *complementary* pair, not just the individually-best models).

**Preferred shared first-2 = `deepseek-v4-flash` + `google/gemini-2.5-flash-lite` (2026-06-12 user pref).**
Complementarity assessment on recorded data (temp 0, max-over-runs):
- **Paragraph (n=110 shared pairs):** flash 0.66 / lite 0.73 decisive; 18 only-flash + 25 only-lite
  complementary; 11% stump both; **union coverage 0.89**. -> CONFIRMED good shared first-2 for paragraphs.
- **Article (n=10 shared pairs — thin):** flash 0.40 / lite 0.70; **only-flash = 0** (flash redundant —
  lite covers everything flash gets, plus 3 more); 30% stump both; union 0.70. -> flash is dead weight
  on articles. **Article first-2 = `gemini-2.5-flash-lite` + a stronger second (`deepseek-chat` or
  `gpt-4o-mini`).** Re-run the article assessment at larger n before locking (see Phase 1).
- Net: shared first model can be `gemini-2.5-flash-lite` (decent on BOTH: 0.73 para / 0.70 article);
  2nd is `deepseek-v4-flash` for paragraphs, a stronger model for articles; 3rd = mode-aware tail.

## Architecture: two pluggable seams (Planner + Aggregator)

`mode` + pair -> **Planner** decides which submatches to dispatch (here: the escalation chain) ->
each submatch yields a `SubVerdict` -> **Aggregator** folds `SubVerdict[]` -> one consolidated
`{winner, confidence, breakdown}` -> one match. Both seams swappable so "different models judge
different criteria, then aggregate up" stays a config change, not a rewrite.

```ts
type SubVerdict = {
  sourceKind: 'judge' | 'criterion';   // replication axis vs decomposition axis
  sourceId: string;                     // model name, or criteria_id
  winner: 'A'|'B'|'TIE'|null; confidence: number; weight: number; decisive: boolean;
  escalationStep: number;               // 0,1,2 — position in the chain
  triggeredEscalation: boolean;         // did its indecision cause the next submatch?
  audit: { forwardWinner; reverseWinner; costUsd; tokens; latencyMs; model; ... };
};
type Aggregator = (subs: SubVerdict[], cfg) => {
  winner:'A'|'B'|'TIE'; confidence:number;
  breakdown: { ruleId; ruleVersion; votesA; votesB; abstains; dissenters; members: SubVerdict[] };
};
```
- **Planner** = escalation policy (dynamic): dispatch step 0; while aggregate indecisive and
  step < 3, dispatch the next mode-appropriate model. (`single` = chain of length 1.)
- **Aggregator** registry keyed by `ruleId@ruleVersion`. **Live default `first_decisive`**
  (decision 2026-06-13): only a *decisive A or B* (confidence > 0.6) is a vote; **everything else is an
  abstention — including a confident TIE**. The Planner escalates **only while the last judge abstained**
  (no decisive vote yet) and step < cap; the **first decisive A/B vote resolves the match** — a lone
  decisive vote among abstentions is accepted (e.g. `TIE, TIE, A -> A`). The match is **TIE only if all
  judges through the cap abstain**. Consequence: because we stop on the first decisive vote, two judges
  never disagree in the live path (no conflict case) and a decisive vote is never corroborated by a
  second. Stricter rules (`unanimous_among_decisive` = require >=2 agree; `confidence_weighted`) stay in
  the registry for **offline Phase-1 comparison**, so we can measure the accuracy traded away by trusting
  a lone decisive vote before locking the prod default. Adding a rule = one pure fn + register; no change
  to persistence or rating path.
  - **Rule selection is config-driven, not environment-driven.** The same registry ships to staging and
    production; the live ranking default is `first_decisive` in **both**. `unanimous_among_decisive` /
    `confidence_weighted` are *present* everywhere but *execute* only in the offline tool + Judge Lab
    sweeps (measurement surfaces on the dev/staging DB that never write real ratings) — or if a strategy
    is deliberately configured to canary one. Staging never silently diverges from prod on the live rule.
- Existing `rubricJudge.ts` becomes one instance (`criteria_split` planner + `criteria_weighted`
  rule). Escalation lives in the Planner; voting/weighting in the Aggregator; they compose.

## Persistence: submatches are first-class, queryable ROWS (verdict is derived + re-derivable)
Store `ruleId` + **`ruleVersion`** so any historical match re-scores under a new rule with $0 LLM.
- **Judge Lab**: each submatch = a `judge_eval_calls` row (reuse cost/tokens/raw cols) + new
  `submatch_group_key`, `escalation_step`, `triggered_escalation`. A small escalation-chain config
  record holds composition + ruleId + ruleVersion. `settings_key` includes the chain config.
- **Production**: a normalized child table **`evolution_arena_submatches`** (FK ->
  `evolution_arena_comparisons` ON DELETE CASCADE), at **parity with `judge_eval_calls`** so the prod
  match viewer can show everything the Lab can:
  - identity/settings: `model, temperature, reasoning_effort, escalation_step, triggered_escalation,
    escalation_reason ('abstained'|'cap_reached'|NULL — stored, not re-derived; 'abstained' is the only
    mid-chain reason under `first_decisive` (judge cast no decisive vote — covers 0.5/null AND confident
    TIE); 'cap_reached' = terminal),
    judge_mode ('holistic'|'rubric'), judge_rubric_id (NULL unless rubric)`
  - verdict: `winner, confidence, forward_winner, reverse_winner`
  - cost: `cost_usd, prompt/output/reasoning tokens, latency_ms`
  - **deep audit (lazy/TOASTed, NOT in list/detail-summary selects): `forward_prompt, reverse_prompt,
    forward_raw, reverse_raw, reasoning`** — this is what the "show prompts/raw" button reads; without
    it prod could show verdicts but not what the model actually said.
  Plus a thin summary on the parent (`chain_depth`, `agreement`, `aggregation_rule`,
  `aggregation_rule_version`) for fast list rendering. Escalation keeps this cheap (avg ~1.3-1.5
  rows/match; the 3rd rarely fires). Rows oriented to the entry_a/entry_b frame
  (reuse `orientBreakdownToEntries`).
- **Rubric breakout (per-dimension verdicts as ROWS)**: a submatch in `judge_mode='rubric'` gets N
  rows in **`evolution_submatch_dimension_verdicts`** (FK -> `evolution_arena_submatches` ON DELETE
  CASCADE): `criteria_id (FK evolution_criteria ON DELETE SET NULL), criteria_name (snapshot),
  weight (snapshot - weights normalize at read time so freeze the value used), forward_verdict,
  reverse_verdict, dimension_winner, favored_match_winner (BOOLEAN, NULL on TIE - precomputed at write
  time so "which criteria pick the winner" is a single-table aggregate, no frame-join), position`.
  All rows oriented to the entry_a/entry_b frame so `dimension_winner`/`favored_match_winner` are
  comparable across matches. This replaces the `rubric_breakdown` JSONB as the
  queryable **source of truth** going forward; the JSONB stays a denormalized **read-cache** during
  transition (dual-write) so the existing Match Viewer keeps working until it reads the table.
  Unlocks: "which criterion most often picks the match winner", "per-criterion agreement / flip
  rate", "does criterion X correlate with the eventual Elo move".
  Dimension rows store the **parsed** per-dimension verdicts; if the model explained per dimension,
  that prose lives in the submatch's `forward_raw`/`reverse_raw` (the "show raw" path) — so a rubric
  submatch's full story = dimension rows (structured) + the parent submatch's raw audit (verbatim).
- **Two prod write sites** (the agent confirmed): `MergeRatingsAgent.ts` (main, ~L296-329) AND
  `slotTopicActions.ts` (~L239, paragraph slots). Submatch + dimension inserts co-locate with the
  existing arena-row insert there, inside the same write, after the match row.
- Unlocks: "decisive rate of model X as the 2nd-in-chain judge", "how often step-3 fires", "which
  model most often breaks ties", "filter match history to matches where model X was the decider".

**Why a SEPARATE prod table, not a flag on `evolution_arena_comparisons`:** the comparisons table
feeds the rating pipeline, so its invariant must stay "1 row = 1 match that updates Elo once". A
`is_submatch` flag would force *every* existing consumer (ratings aggregation, leaderboards, counts)
to remember `WHERE is_submatch=false`; the one that forgets silently corrupts Elo. A separate table
makes that mistake structurally impossible. (In Judge Lab the opposite is correct: `judge_eval_calls`
is already submatch-grained with NO rating semantics, so submatches live there with a group key.)

**INVARIANT — ratings update on MATCHES, never submatches.** The escalation chain yields exactly one
consolidated verdict per matchup; that single verdict is the only input to `updateRating`/`updateDraw`
(one Elo update per match per round, as today). Submatches are evidence/audit only. The separate prod
table enforces this physically: the rating pipeline reads `evolution_arena_comparisons` and never sees
`evolution_arena_submatches`.

### Schema Decision Record (SDR-1): submatches + rubric breakout
**Decision:** separate normalized tables, NOT a flag on the match table, NOT JSONB-only.
**Considered:** (1) same table + `is_submatch` flag (self-FK); (2) separate child table; (3) JSONB on the match.
**Why separate (prod):** `evolution_arena_comparisons` is a *rating event* — 8 of its 21 columns are
`entry_*_mu/sigma_before/after` rating snapshots that are meaningless for a submatch. A flag would force
every rating/leaderboard query to remember `WHERE is_submatch=false` (one miss corrupts Elo) and bloat
the hot table ~1.5-2.5x. JSONB loses the per-model / per-criterion queryability we explicitly want.
**Why this differs in Judge Lab:** `judge_eval_calls` is already submatch-grained with NO rating
semantics, so there submatches live in the same table with a group key. General rule: *separate when the
base table carries a downstream invariant others depend on; same-table+flag is fine when it doesn't.*
**Three-level prod model:** `evolution_arena_comparisons` (match, +summary cols) -> `evolution_arena_submatches`
(one per judge) -> `evolution_submatch_dimension_verdicts` (one per dimension, rubric mode only).
**Rubric support:** a submatch carries `judge_mode` + `judge_rubric_id`, so rubric judging is a per-submatch
property; the rubric chain naturally supports mixed holistic/rubric submatches.
**Backward compat:** 329 legacy rubric matches + all pre-feature matches keep their match-level JSONB /
chain-of-1 semantics; **no backfill**. New rubric judgements (rubric strategy on) write a chain-of-1
submatch + dimension rows even without escalation, so all NEW rubric data is uniform + queryable; the plain
holistic single-judge default path writes NO submatch rows (byte-identical).
**RLS/cleanup:** new tables = deny-all + `service_role_all` (evolution convention); `ON DELETE CASCADE`
from the match so run/`[TEST]` cleanup sweeps submatches + dimension rows for free.
**Pass scores derivable:** `RubricPassResult.scoreA/scoreB` = sum of dimension weights per pass verdict;
store dimension rows as source of truth, optionally cache pass scores on the submatch.

### Row-creation rules (when does a submatch row exist?)
The MATCH row (`evolution_arena_comparisons`) is **always** written — one per comparison; it is the
rating event, never skipped or replaced. A submatch is a **child** of it, never an alternative.
- **Ensemble/escalation active, 1st judge decisive (chain-of-1):** >=1 submatch row is STILL written —
  the lone judge that ran is recorded as a chain of length 1. The match row holds only the
  aggregate/summary (`winner`, `confidence`, `chain_depth=1`, rating snapshots); `model` + verdict +
  audit live on the submatch row.
- **Ensemble escalates (2-3 judges):** 2-3 submatch rows.
- **Rubric mode active (wider scoping), no escalation:** chain-of-1 submatch + dimension rows.
- **Pure legacy holistic (feature off):** NO submatch row; match row only (byte-identical to today).
We do NOT collapse a chain-of-1 into the match row: that would reintroduce per-judge columns
(`model`/audit) on the rating table and force two read paths (detail-on-match vs detail-on-submatch).
One cheap extra row keeps the model uniform and "model X as the step-0 judge" analytics complete.
Cost is the floor (~1 row/match for the common single-judge-decisive case).

## Match-history UX (carefully, given existing plumbing)
A match now nests **match -> submatches -> passes** (one level deeper than rubric_breakdown's
match -> dimensions -> passes; reuse that rendering pattern).
- **List row**: consolidated verdict + confidence + an **escalation badge**, e.g.
  `deepseek-flash (TIE) -> nano (A) ✓` or `3 judges · decided by #3` / `3 judges · all abstained -> TIE`.
  Conveys depth + who decided at a glance (under `first_decisive` there is no 2-vote split live).
- **Detail page**: an **escalation timeline** — **vertical timeline cards** (layout chosen 2026-06-13;
  alternatives "compact table" and "table + side-panel" rejected), one card per submatch in run order
  (model, verdict, confidence, `triggered_escalation` reason, cost), each **expandable inline** to its
  forward/reverse audit (holistic) or its per-dimension verdict table (rubric mode, with a
  "Backed winner?" column = `favored_match_winner`); consolidated verdict + aggregate tally
  (votes A/B/abstain) + rule + ruleVersion pinned on top. Reads top-to-bottom as the story of how the
  match resolved. Wireframes in `_progress.md` (2026-06-13).
- **Backward compatibility**: every legacy single-judge match = a chain of length 1, renders as
  today (no badge). History pages MUST treat the legacy row as the degenerate 1-submatch case.
- **Re-judge sandbox**: target one submatch (replay that model) OR the whole chain.
- **Filtering**: filter/search match history by submatch model + by escalation depth + by deciding
  model (enabled by the normalized rows above).

## Implementation seams & integration (plan-review iteration 1)

The "wire it through `compareWithBiasMitigation` at two write sites" framing was too glib — the
**compute** sites are not the **persist** sites, and the prod comparison path cannot currently
emit the audit/cost/multi-model data the schema promises. This section makes the seam concrete.

### G1 — Compute -> persist channel (carry SubVerdicts the way `rubricBreakdown` is carried)
The persist sites (`MergeRatingsAgent.ts` ~L296-329, `slotTopicActions.ts` ~L239) are downstream of
the **compute** sites: `SwissRankingAgent.ts` ~L144 (article ranking) and the paragraph-slot path
(`rankSingleVariant` inside `ParagraphRecombineAgent` — name it explicitly). Today only
`match.rubricBreakdown` survives compute->persist, carried on `ComparisonResult -> V2Match
(v2MatchSchema)`. We extend that **same channel**:
- [ ] Add optional `submatches: SubVerdict[]` (+ `chainConfigId`, `ruleId`, `ruleVersion`) to
  `ComparisonResult` and `v2MatchSchema`; both compute agents copy it onto the match exactly as they copy
  `rubricBreakdown`. (V2Match is the persistence carrier; `RankSingleVariantComparisonRecord` is
  detail/telemetry — extend it only if a consumer needs the submatches there.) Absent (no ensemble) ->
  field undefined -> legacy path unchanged.
- **FK ids:** the arena insert is a BULK `.insert(arenaRows)` with no `.select()`, so child rows can't
  learn the parent `id`. Fix: **client-generate the comparison `id` (UUID) on each `arenaRow`** so
  submatch rows can set `comparison_id` without a returning insert; an explicit `id` overrides the column
  default (one-line Phase-4 precheck: confirm `evolution_arena_comparisons.id` defaults to
  `gen_random_uuid()`, not an identity/serial). Submatch + dimension rows are inserted in the same persist
  block after the parent insert; same fix at both sites. The integration test asserts the **persisted
  parent `id` equals the client-generated value** used for the children's `comparison_id`.

### G2 + G3 — Prod judge runner (per-pass raw/cost capture + multi-model dispatch), unified with Phase 2
`compareWithBiasMitigation` builds verdicts via `run2PassReversal`, which **discards per-pass raw
responses**, and its `callLLM` is an opaque `(prompt)=>Promise<string>` **pre-bound to one model** — so
it can neither emit `forward_raw/reverse_raw/cost/tokens` nor dispatch *different* models per submatch.
The fix unifies the Phase-2 and Phase-4 seams onto **one abstraction**:
- [ ] Escalation does NOT run through the bare `callLLM`. The Planner receives a **model-parameterized
  factory `makeJudge(model) => JudgeFn`** (where `JudgeFn` returns a `JudgeCallOutput` with
  `verdict + forward/reverse winners + raw + cost + tokens + latency`, exactly Judge Lab's
  `createCallLLMJudge`). This is the SAME `createEscalationJudgeFn` built in Phase 2; Phase 4 reuses it.
  So multi-model dispatch and full per-submatch audit both fall out of one runner, and prod reaches
  audit parity with `judge_eval_calls` (the audit-parity test then passes by construction). The runner
  reuses Judge Lab's **throw-with-`partialResults`** contract (bounded retry, then a thrown submatch
  counts as an abstention): a step-3 throw still persists steps 0-1, and the parent insert + submatch
  inserts are **best-effort/non-fatal** (mirror the existing arena insert — log-and-continue; a failed
  child insert yields an orphaned-summary match, never corrupts Elo since ratings read only the
  consolidated verdict). `ensembleConfigId` must **fail closed**: if it resolves to no/empty chain
  composition (deleted/renamed config), raise rather than silently judging with an empty chain.
- [ ] `compareWithBiasMitigation` gains an optional `ensembleRunner?: { makeJudge, planner, aggregator }`.
  **When unset -> the existing single-`callLLM` 2-pass path runs byte-for-byte unchanged** (no capture,
  no submatch rows). When set -> the escalation chain runs and returns `ComparisonResult` + `submatches`.
- The pure **Aggregator + Planner registries live in `evolution/src/lib/shared/`** (next to
  `rubricJudge.ts`), NOT under `judgeEval/`, so both Judge Lab and the prod ranking path import them
  without a `judgeEval -> pipeline` dependency inversion.

### G3 — Kill switch: single enforcement point + parity guarantee
- [ ] `EVOLUTION_JUDGE_ESCALATION_ENABLED='false'` is resolved **once in `buildRunContext`** (mirrors
  `EVOLUTION_RUBRIC_JUDGING_ENABLED`): when off (or no `ensembleConfigId`), `ensembleRunner` is
  `undefined`, so every comparison takes the legacy single-judge path and **writes zero submatch rows**.
  A test asserts: switch off => no `evolution_arena_submatches` rows AND the match row is byte-identical
  to the pre-feature path.

### G4 — Cache must not break "always >=1 submatch row"
The in-run `ComparisonCache` (order-invariant) returns a cached `ComparisonResult` without recomputing.
If submatches aren't cached, a cache-hit match would have no submatch rows, violating the row-creation
rule.
- [ ] Cache the **full payload including `submatches`**; on a cache hit, **clone** the cached submatch
  audit into fresh rows (new ids, same content, `comparison_id` = this match) so every match still has
  its chain. Cache key gains the `chainConfigId + ruleVersion` suffix (mirrors the existing
  `|rubric:<id>` suffix); a single-judge key never collides with a chain key. **Cache-write rule
  (decided):** when `ensembleRunner` is set, **always cache the consolidated verdict regardless of
  confidence** (bypass the B033 `confidence >= 0.3` gate) — else an all-abstain chain (consolidated TIE
  @ 0.0) never caches and re-runs the full (expensive) chain on every re-query. Unit test covers the
  0.0-confidence all-abstain-chain clone.

### G5 — Cost: escalation-aware estimate + bounded prod spend + test budget guard
- [ ] `plannedCalls`/`estimateSweepCost` currently hardcode `*2` (one judge). Make them
  **escalation-aware**: worst-case `= cap(3) x 2` calls/pair; `assertWithinJudgeEvalCap` must gate on the
  **worst case** (also surface an expected-case estimate using the measured escalation rate). Without
  this, `JUDGE_EVAL_MAX_USD` undercounts chains up to 3x.
- **Prod spend is bounded by construction:** cap=3 -> <=6 calls/comparison; every submatch call still
  passes the existing **global `LlmSpendingGate`** + per-run reserve path (no new ungated path). State
  this explicitly; no separate prod cost ceiling is added (the cap + existing gate bound it).
  **Load-bearing requirement:** the escalation runner MUST route every submatch's calls through the same
  **reserving `callLLM`/client** (the `V2CostTracker.reserve` -> `BudgetExceededError` path), NOT a fresh
  unwrapped client — otherwise the runtime spend bound silently disappears.
- [ ] **Cost ESTIMATES must scale with judge count (not just the runtime gate).** Every place that
  *projects* cost ahead of time currently assumes one judge (2 calls/comparison) and would undercount an
  escalation run by up to 3x: (a) Judge Lab `estimateSweepCost`/`plannedCalls`/`--dry-run` (worst-case
  `cap*2`, per G5 above); (b) the **production pre-run cost projection** — specifically
  `estimateRankingCost()` (`estimateCosts.ts`, currently `numComparisons * 2 * costPerCall`, the `*2` =
  one judge's 2 passes) consumed by `projectDispatchPlan`/the wizard preview. The comparison **count** is
  escalation-INVARIANT (still bounded by `maxComparisonsPerVariant`, default 15) — only the **per-
  comparison cost** rises (up to `cap*2` calls). So `estimateRankingCost` must multiply per-comparison
  cost by the **expected chain depth** (from the offline-measured escalation rate, for planning) and bound
  it by the **worst-case cap** (hard limit); otherwise a run does its usual comparison count at up to 3x
  cost and overshoots its budget before the runtime reserve gate trips. (Note: `budgetTier` in the rank
  result is read-only telemetry, NOT a count-capping mechanism — don't wire cost there.) ACTUAL spend is
  already captured (each submatch row carries `cost_usd`, summed into `evolution_metrics`); this item is
  the forward ESTIMATE. Add a unit test asserting `estimateRankingCost` scales by depth.
- [ ] **Test budget guard:** integration specs run with the **mocked LLM** (assert `call_source` /
  zero real spend); the escalation E2E runs under `E2E_TEST_MODE` (stubbed judge) with a tiny
  `JUDGE_EVAL_MAX_USD` so a real chain can never fire. Assert no real LLM call in CI.

## Acceptance gate (Phase 1 offline -> Phase 4 prod wiring): numeric go/no-go
Production wiring (Phase 4) MUST NOT start until the Phase-1 offline numbers clear ALL of (measured per
mode, Article/Paragraph, on the pinned corpus below):
- [ ] **Decisiveness uplift:** chain `decisive_rate` >= best-single-cheap-judge + **0.10** absolute.
- [ ] **Accuracy guardrail (large-gap, has ground truth):** chain accuracy **>= single-strong-judge
  baseline - 0.03** (i.e. no meaningful accuracy regression to buy decisiveness).
- [ ] **Lone-decisive safety:** `first_decisive` "lone-decisive-but-wrong" rate on large-gap pairs
  **< 0.10**, and not worse than `unanimous_among_decisive` by more than **0.05** (the head-to-head). If
  it fails, escalate the default to `unanimous_among_decisive` for that mode.
- [ ] **Cost:** chain `cost_per_decisive` **<= single-strong-judge** cost_per_decisive.
**Statistical power:** the accuracy + lone-decisive bars are computed on the large-gap (ground-truth)
subset only. The current pinned article set has just **n=10** large-gap pairs — underpowered for a
3-point accuracy bar. Before trusting those bars, **widen the corpus** (seed more large-gap pairs into the
frozen sets so each bar has a documented minimum n, target >=50/mode); record the n alongside each gate
number. (This is the same "re-run the article assessment at larger n" item from the model-chain section.)
If any bar fails, stop at Phase 3 (Judge Lab) and iterate on chain composition / rule — do not wire prod.

## Migrations, deploy & rollback
- [ ] **Idempotency (CI-gated):** every migration uses `CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`; passes `npm run lint:migrations`
  (idempotency) + `check-migration-order` + `check-migration-append-only`; and `npm run migration:verify`
  (ephemeral Docker postgres) locally before PR. New migration files only — never edit shipped ones.
- [ ] **High-blast PR gate:** these PRs touch `supabase/migrations/**`, so `gh pr create` requires a valid
  `.claude/push-gate.json` (written by `/finalize`); plan for that in each schema-bearing phase (2,3,4).
- [ ] **Staging-first + dual-env kill switch:** set `EVOLUTION_JUDGE_ESCALATION_ENABLED='false'` in **both**
  staging and prod (Vercel env + `.env`) **before** the Phase-4 migration merges. Migrations deploy to
  staging on PR-merge and prod only on release; verify the new tables exist on staging before any prod
  wiring relies on them. Feature stays OFF in both until offline gate + staging validation pass.
- [ ] **Rollback procedure:** rollback = **flip the kill switch OFF** (code path reverts to byte-identical
  legacy; submatch writes stop). Migrations are **additive forward-only** (no down-migration); the new
  tables/cols are left in place harmlessly. The `rubric_breakdown` JSONB dual-write means the Match Viewer
  still renders rubric matches if normalized reads are reverted.

## Phased Execution Plan

### Phase 1: Aggregation framework + offline validation (no schema change, ~$0 LLM)
- [ ] `evolution/src/lib/shared/judgeEnsemble/` (in `lib/shared` next to `rubricJudge.ts` so BOTH Judge Lab and the prod ranking path import it without a `judgeEval -> pipeline` dependency inversion): `SubVerdict`/consolidated types, `Aggregator` registry + `Planner`, rules `first_decisive` (live default), `unanimous_among_decisive` (">=2 agree"), `confidence_weighted`, `threshold_k` (pure, versioned).
- [ ] Offline **escalation simulator** (`offlineReaggregate.ts` + CLI): given a test set + recorded single-judge runs, replay the **mode-aware escalation chain** by consuming recorded submatch verdicts in chain order (stop when aggregate decisive); emit a leaderboard.
- [ ] Metrics per chain+rule: `decisive_rate`, **large-gap accuracy**, **unanimous-but-wrong** (guardrail), `cost_per_decisive`, avg chain depth (how often 2nd/3rd fired). Split Article / Paragraph.
- [ ] **`first_decisive` vs `unanimous_among_decisive` (>=2 agree) head-to-head**: quantify the accuracy traded away by accepting a lone decisive vote (i.e. on pairs a lone judge decided, how often would a 2nd judge have disagreed / how often was the lone vote wrong on large-gap pairs). Confirms `first_decisive` is safe as the live default, or flags where >=2-agree is worth the extra call.
- [ ] **First-2 complementarity assessment** (re-run at adequate n): `deepseek-v4-flash` + `gemini-2.5-flash-lite` per mode — paragraph already CONFIRMED (n=110, union 0.89); article needs larger n (n=10 prelim shows flash redundant, only-flash=0) -> decide article 2nd model (`deepseek-chat` vs `gpt-4o-mini`).
- [ ] Confirm Findings 4-5 at corpus scale; **finalize the 3-model chain per mode** (most complementary, not just individually-best). Sanity: chain-of-1 reproduces the recorded single-judge `decisive_rate`.
- [ ] **Pin the validation corpus** (so results are reproducible + CI-gateable): freeze the recorded runs on test sets `9acb42f5-fa9b-4ce8-b053-431fbe01e026` ("Model baseline 3 - articles") and `970494a4-d95b-4097-ad77-07702846a6ed` ("New federal", paragraphs) into a committed JSON fixture (the recorded SubVerdict corpus); the offline simulator + its unit test run against the fixture, not a live DB query, with explicit numeric tolerance bands stated in the test itself. This makes the **Acceptance gate** numbers deterministic.
- [ ] **Widen the large-gap (ground-truth) subset to >=50/mode** before running the Acceptance gate: the article set currently has only n=10 large-gap pairs (underpowered for the 3-pt accuracy / lone-decisive bars). Seed more large-gap pairs into the frozen sets and record the achieved n alongside each gate number. (Owning checkbox for the statistical-power note in the Acceptance gate.)

### Phase 2: Live escalation chain as a first-class Judge Lab sweep (Planner + persistence)
- [ ] `Planner`/`dispatchStrategy`: `single` + `escalation` (mode-aware ladder, cap 3, stop-on-decisive). Wire at the `JudgeFn` injection seam (`createEscalationJudgeFn` consolidates submatches via the chosen Aggregator).
- [ ] Migration (additive): `submatch_group_key`, `escalation_step`, `triggered_escalation` on `judge_eval_calls` + an escalation-chain config record. Extend `settings_key`; idempotent re-runs preserved.
- [ ] Persist each submatch as a first-class row + the consolidated verdict; leaderboard VIEW gains chain decisive/accuracy/cost/avg-depth.
- [ ] Admin UI: chain + rule selector on the launcher; leaderboard shows chain, rule, depth, decisive/accuracy/cost. CLI `sweep --chain ... --rule ...`.
- [ ] Run live escalation sweeps; confirm they reproduce offline predictions (real escalation trigger rate + cost).

### Phase 3: Rubric-mode submatches + criteria-partitioned aggregation
- [x] Submatches support **rubric mode**: thread `judgeRubric`/`judge_rubric_id` per submatch through the escalation `JudgeFn`; reuse `compareWithBiasMitigation`'s rubric branch (`buildRubricComparisonPrompt`/`aggregateRubric`). *(Phase 3a — escalation.ts EscalationConfig.rubric + per-pass aggregateRubric.)*
- [x] Judge Lab dimension breakout: migration `judge_eval_dimension_verdicts` (FK -> `judge_eval_calls` ON DELETE CASCADE): `criteria_id, criteria_name, weight, forward_verdict, reverse_verdict, dimension_winner, favored_match_winner, position`. Persist for any rubric-mode call (mirrors the prod `evolution_submatch_dimension_verdicts`). *(Phase 3b — migration 20260614000003 + dimensionVerdictRows/insertDimensionVerdicts.)*
- [x] `criteria_split` Planner: map each rubric dimension (`evolution_criteria`) to a model; dispatch per-criterion submatches (`sourceKind:'criterion'`). *(escalation.ts evaluatePairWithCriteriaSplit — one 2-pass judge per dimension, round-robin over chain models or explicit criteriaModelMap; each criterion is a SubmatchRecord with a 1-dim breakdown.)*
- [x] `criteria_weighted` Aggregator generalizing `rubricJudge.ts` weighting into the registry (one engine for both). Ships no new aggregation engine — a new Planner + a registered rule. *(aggregation.ts criteriaWeighted — folds per-criterion SubVerdicts by weight; winner-share confidence. Sweep forces this rule whenever planner=criteria_split.)*
- [x] Validate in Judge Lab vs holistic chain + single-model rubric baselines (decisive, accuracy, cost); confirm per-dimension rows reconstruct the JSONB breakdown exactly. *(Phase 3c — integration test reconstructs the breakdown + CASCADE; CLI `--rubric` + UI selector for live validation.)*

### Phase 4: Production wiring (gated, default OFF)
- [ ] Compute->persist plumbing (see seams G1/G2): add `submatches: SubVerdict[]` (+ chain/rule ids) to `ComparisonResult`, `v2MatchSchema`, `RankSingleVariantComparisonRecord`; copy onto the match at BOTH compute sites (`SwissRankingAgent.ts` ~L144, `rankSingleVariant.ts` ~L317); client-generate comparison `id` so submatch rows FK without a returning insert.
- [ ] Add `ensembleRunner?` (model-parameterized `makeJudge(model)=>JudgeFn` + planner + aggregator) to `compareWithBiasMitigation` — **byte-identical single-`callLLM` path when unset** (seam G2). Reuse the Phase-2 `createEscalationJudgeFn` so prod gets multi-model dispatch + per-pass raw/cost audit in one runner.
- [ ] Extend the comparison **cache key** with `chainConfigId + ruleVersion`; cache the FULL payload incl. `submatches` and **clone** submatch rows on a cache hit so every match keeps >=1 submatch row (seam G4). Resolve `ensembleConfigId` (strategy field) to a chain composition via the shared aggregator/planner registry (re-derivation needs composition + rows).
- [ ] Migration (idempotent): `evolution_arena_submatches` child table + `evolution_submatch_dimension_verdicts` (rubric breakout) + parent summary cols (`chain_depth`, `agreement`, `aggregation_rule`, `aggregation_rule_version`). Deny-all RLS + `service_role_all`; `ON DELETE CASCADE` from the match; indexes on `comparison_id`, `model`, `(submatch_id)`, `criteria_id`.
- [ ] Write submatch + dimension rows at **both** persistence sites — `MergeRatingsAgent.ts` (~L296-329) and `slotTopicActions.ts` (~L239) — co-located with the existing arena-row insert. Keep dual-writing `rubric_breakdown` JSONB as a read-cache during transition. Per-submatch cost attribution into run cost metrics.
- [ ] Match-history UX: escalation badge (list) + escalation timeline (detail) + per-submatch rubric dimension table + legacy-as-chain-of-1 compatibility + per-submatch re-judge. Migrate the Match Viewer read to the normalized tables (fall back to JSONB for legacy rows).
- [ ] Rating path: live default **`first_decisive`** (first decisive A/B resolves the match; TIE only if all judges abstain -> `updateDraw`). No rating-math change — still one consolidated verdict per match, as today. Measure later if a confidence-weighted K-factor is worth a follow-up.
- [ ] Strategy-config field (`ensembleConfigId`, config-hashed) + wizard surface; kill switch `EVOLUTION_JUDGE_ESCALATION_ENABLED='false'`.

### Phase 5: Tuning & non-ensemble levers (measured, not assumed)
- [ ] Per-mode chain composition (most complementary biases); escalation trigger threshold + strong-model choice for the article 3rd tier.
- [ ] Force-a-winner / TIE-discouraging rubric (Option F) + structured judging as standalone decisiveness levers — fresh cheap sweeps; guardrail = large-gap accuracy must not drop.

## Testing

### Unit Tests
- [ ] `evolution/src/lib/shared/judgeEnsemble/aggregation.test.ts` — each Aggregator over synthetic `SubVerdict[]`: `first_decisive` (lone decisive resolves; confident TIE = abstain -> not a vote; all-abstain -> TIE), unanimous/split/abstain-heavy/single-voter/null edge cases; **ruleId@ruleVersion lookup + unknown-version handling + re-derive a historical match under a new ruleVersion**.
- [ ] `evolution/src/lib/shared/judgeEnsemble/planner.test.ts` — escalation dispatches step 2 only when step 1 abstained, step 3 only when still abstained, caps at 3, mode selects the right ladder, stops on first decisive; chain-of-1 == single. A thrown submatch LLM call after bounded retry counts as an **abstention** (escalates), distinct from a parse-null.
- [ ] `evolution/src/lib/shared/judgeEnsemble/offlineReaggregate.test.ts` — runs against the **committed pinned-corpus fixture** (not a live DB); chain replay + stop-on-decisive reproduces the research numbers within tolerance (articles ~0.83 @ ~0.857 acc; paragraph ~0.62 >=2-agree); chain-of-1 reproduces recorded decisive_rate; unanimous-but-wrong + lone-decisive-wrong guardrails computed correctly.
- [ ] `evolution/src/lib/shared/judgeEnsemble/cost.test.ts` — escalation-aware `plannedCalls` returns worst-case `cap*2`; `assertWithinJudgeEvalCap` rejects a sweep whose worst-case exceeds `JUDGE_EVAL_MAX_USD` even if expected-case is under.
- [ ] `evolution/src/lib/shared/computeRatings.test.ts` (extend) — `ensembleRunner` unset => single-`callLLM` 2-pass path byte-identical (no submatch emission); set => returns `submatches`. Cache: chain key != single-judge key; a cache HIT still yields >=1 (cloned) submatch in the payload (no escalation skipped).

### Integration Tests
- [ ] `src/__tests__/integration/judge-eval-escalation.integration.test.ts` — escalation sweep persists submatch rows (`escalation_step`, `triggered_escalation`) + chain config + consolidated verdict; leaderboard returns chain decisive/cost/depth (mocked LLM).
- [ ] `src/__tests__/integration/arena-submatches.integration.test.ts` (Phase 4) — production comparison writes `evolution_arena_submatches` rows + parent summary at **BOTH** write sites (merge path AND paragraph-slot path) with identical persistence shape; child rows FK to the client-generated comparison `id`; verdict re-derivable under a new ruleVersion; queryable by submatch model; a mid-chain thrown submatch persists as `chain_depth` reflecting the abstention (non-fatal, mirrors the best-effort arena insert).
- [ ] `src/__tests__/integration/escalation-killswitch.integration.test.ts` — with `EVOLUTION_JUDGE_ESCALATION_ENABLED='false'` (or no `ensembleConfigId`): zero `evolution_arena_submatches` rows written and the match row is byte-identical to the legacy single-judge path. Also: an `ensembleConfigId` resolving to a missing/empty chain composition **fails closed** (raises), never judges with an empty chain.
- [ ] `src/__tests__/integration/submatch-cascade-cleanup.integration.test.ts` — deleting a match / run sweeps `evolution_arena_submatches` AND `evolution_submatch_dimension_verdicts` via `ON DELETE CASCADE` (verifies the SDR-1 "for free" cleanup claim end-to-end); read path tolerates a `chain_depth>=2` summary with zero surviving child rows (orphaned-summary from a best-effort partial write).
- [ ] `src/__tests__/integration/submatch-dimension-verdicts.integration.test.ts` — a rubric-mode submatch writes `evolution_submatch_dimension_verdicts` rows whose values reconstruct the `rubric_breakdown` JSONB exactly (parity guard); criteria deletion sets `criteria_id` NULL but keeps `criteria_name` snapshot.
- [ ] `src/__tests__/integration/submatch-audit-parity.integration.test.ts` — every prod submatch (produced by the `makeJudge(model)=>JudgeFn` runner) persists the raw/prompt + cost/token audit columns at parity with `judge_eval_calls`, so "show prompts/raw" has data; `escalation_reason` set on every non-terminal step.
- [ ] `src/__tests__/integration/match-viewer-rubric-readpath.integration.test.ts` — the Match Viewer read path returns identical rendering data for a NEW rubric match (normalized `evolution_submatch_dimension_verdicts`) and a LEGACY one (329 `rubric_breakdown` JSONB rows) — guards the dual-write/dual-read transition.

### E2E Tests
- [ ] `src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-escalation.spec.ts` — launch an escalation sweep from `/admin/evolution/judge-lab`; leaderboard shows chain + rule + depth; match detail shows the escalation timeline. (`@evolution`.) Runs under `E2E_TEST_MODE` with a tiny `JUDGE_EVAL_MAX_USD` so no real chain fires; asserts **zero real LLM spend** (no live `call_source` rows) during the run. Cleanup via `evolution-test-data-factory` `cleanupAllTrackedEvolutionData()` in `afterAll` (tracked-id based — NOT literal `[TEST_EVO]` criteria names, which the `evolution_criteria.name` CHECK forbids; satisfies the `require-test-cleanup` ESLint rule).

### Manual Verification
- [ ] CLI `judge-eval.ts sweep --chain ... --rule ... --dry-run` cost estimate stays under `JUDGE_EVAL_MAX_USD`.
- [ ] Offline tool reproduces research prototype numbers within tolerance against the **committed fixture** (sets `9acb42f5…` articles, `970494a4…` paragraphs): articles ~0.83 @ ~0.857 acc; paragraph ~0.62 >=2-agree. Deterministic (no live DB).
- [ ] Match-history detail renders a legacy single-judge match (chain-of-1) unchanged.

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] Judge Lab escalation launcher + leaderboard + match-detail escalation timeline render on the evolution host (ensure-server.sh; `@evolution`).

### B) Automated Tests
- [ ] `npm run test:unit -- --grep "aggregat|escalat|planner|submatch"` and the new integration specs.
- [ ] `npx playwright test src/__tests__/e2e/specs/09-admin/admin-evolution-judge-lab-escalation.spec.ts`

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `docs/feature_deep_dives/judge_evaluation.md` — escalation sweep mode, Planner/Aggregator seams, offline simulator, submatch persistence, terminology. *(Added "Escalation & criteria-split sweeps" section: planner/rule seams, criteria_split + criteria_weighted, rubric-mode dimension breakout.)*
- [ ] `evolution/docs/rating_and_comparison.md` — escalation/aggregation as an overlay on the 2-pass reversal / confidence table; the `first_decisive` rule (+ registry alternates); submatch vs match.
- [ ] `evolution/docs/cost_optimization.md` — cost-per-decisive + avg chain depth vs single strong judge; mode-aware chains.
- [ ] `evolution/docs/criteria_agents.md` / structured-judging section — criteria-split planner generalizing `rubricJudge.ts`.
- [ ] `evolution/docs/agents/overview.md` — when escalation reaches the ranking path used by agents.
- [ ] `evolution/docs/metrics.md` — submatch / chain metrics (decisive, cost_per_decisive, avg depth, unanimous-but-wrong).
- [x] `evolution/docs/data_model.md` — `judge_eval_calls` submatch cols + `judge_eval_dimension_verdicts` documented. *(The prod `evolution_arena_submatches`/`evolution_submatch_dimension_verdicts` tables are Phase 4 — deferred/gated.)*
- [ ] `evolution/docs/rating_and_comparison.md` (structured-judging section) — per-dimension verdicts now normalized rows (rubric_breakdown JSONB = transitional read-cache).
- [ ] `docs/docs_overall/llm_provider_limits.md` — cheap judge model availability/limits used by chains.

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
