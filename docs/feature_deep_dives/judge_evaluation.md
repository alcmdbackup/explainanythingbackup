# Judge Evaluation (Judge Lab)

Systematic, repeatable evaluation of the evolution arena **judge** — the LLM that performs
pairwise A/B/TIE comparisons (`compareWithBiasMitigation` / `buildComparisonPrompt` in
`evolution/src/lib/shared/computeRatings.ts`). It measures whether changing the judge model,
temperature, reasoning effort, or rubric prompt improves the **decisiveness rate**
(`confidence > 0.6`, matching `finalization.ts`), and stores results in a structured, retrievable
way keyed by judge settings.

This is the **persistence + batch-measurement layer** on top of the Match Viewer (#1168), which
provides interactive single-match re-judge but persists nothing. Project:
`docs/planning/create_tool_systematic_judge_evaluation_evolutioN_20260606/`.

## Concepts

- **Pair-bank** — the full universe of comparison pairs pulled from an arena topic (e.g.
  "Federal Reserve 2", topic `a546b7e9…`: ~6,972 article + ~1,889 paragraph pairs). Each pair
  snapshots both variant texts + `mu`/`sigma` (Elo-gap ground truth) + the production judge's
  recorded confidence.
- **Test Set** — a named, **frozen** sample of a pair-bank (per-kind size + strategy + seed).
  Membership materializes once and never changes, so consecutive runs compare on identical
  pairs. This is "how many pairs enter a round" + the comparability anchor.
- **Eval run** — one judge-settings tuple (model × temperature × reasoning × prompt variant)
  evaluated against a test set. Idempotent by `settings_key` (which includes `test_set_id`).
- **Call** — one (pair × repeat) 2-pass A/B reversal result: forward/reverse winners, aggregated
  winner + confidence, raw responses, latency, tokens, cost.

Article vs paragraph are first-class throughout: a pair's `pair_kind` auto-selects the
comparison rubric (`article` 5-criteria vs `paragraph` TIE-discouraging), and every metric +
the leaderboard slices Article / Paragraph / Both.

## Data model (migration `20260606000001_judge_eval_tables.sql`)

| Table | Purpose |
|-------|---------|
| `judge_eval_pair_banks` | Full candidate pairs from a topic (`pairs` JSONB). |
| `judge_eval_test_sets` | Frozen sample def: strategy, seed, per-kind sizes. |
| `judge_eval_test_set_members` | Frozen membership (PK `(test_set_id, pair_label)`). |
| `judge_eval_runs` | One row per settings tuple; UNIQUE `settings_key`. |
| `judge_eval_calls` | Per-(run × pair × repeat) verdict; `decisive` GENERATED `(confidence > 0.6)`. Also stores the full **audit payload** (`forward_prompt`/`reverse_prompt` = exact rendered judge input incl. custom rubric; `forward_reasoning`/`reverse_reasoning` + `reasoning_trace_format` ∈ {verbatim,summary,unavailable}/NULL; `forward_raw`/`reverse_raw` = raw output) and a frozen **ground-truth snapshot** (`mu_a`/`mu_b`, `sigma_a`/`sigma_b`, `baseline_confidence`, `gap_kind`, `expected_winner`, `variant_a_id`/`variant_b_id`) — see migration `20260610000001`. The snapshot is copied from the resolved pair at write time so match-history analysis is durable against pair-bank re-seeding. All these columns are nullable (errored passes + pre-migration rows). |
| `judge_eval_settings_leaderboard` (VIEW) | Best settings by decisive rate, scoped to a test set, split by `pair_kind`. RLS-locked (REVOKE PUBLIC/anon/authenticated; GRANT service_role). |

All tables: deny-all RLS + `service_role_all` (mirrors evolution convention). Separate from
`evolution_arena_comparisons` (the in-run match log, which drops judge settings + raw passes).

## Escalation & criteria-split sweeps (`evolution/src/lib/judgeEval/escalation.ts`)

Beyond the single-judge sweep, the Judge Lab runs **ensemble** sweeps where one **match** consolidates
several **submatches** (each a `judge_eval_calls` row, tied by `submatch_group_key`, ordered by
`escalation_step`). Two pluggable seams — a **planner** (dispatch) and an **aggregation rule** (fold,
from the versioned registry in `judgeEnsemble/aggregation.ts`, keyed `ruleId@version`):

- **`escalation` planner** (default): a sequential, mode-aware model ladder (cap 3). It judges with the
  first model, and only escalates to a different model when the result is *indecisive*; it stops on the
  first decisive vote. Folded by `first_decisive` (live default), `unanimous_among_decisive` (≥2 agree),
  or `confidence_weighted`.
- **`criteria_split` planner** (requires a rubric): runs **one submatch per rubric dimension** — each a
  2-pass judge of a single-criterion sub-rubric, assigned round-robin over the chain models (or via an
  explicit `criteriaModelMap`) so cheap models can specialize per criterion. No early stop (a rubric is a
  partition). Folded by **`criteria_weighted`**, which sums each criterion's normalized weight onto its
  2-pass winner side (TIE/null abstain) and resolves to the heavier side with a winner-share confidence.
  The action/CLI **force** the rule to `criteria_weighted` whenever this planner is selected. Worst-case
  cost = #dimensions × 2 passes (the cost gate uses the dimension count, not the escalation cap).

**Rubric-mode submatches** persist a per-dimension breakout: each rubric-mode call gets N
`judge_eval_dimension_verdicts` rows (`criteria_name`, `weight`, forward/reverse verdict,
`dimension_winner`, `favored_match_winner` vs the consolidated MATCH winner) — see
`evolution/docs/data_model.md`. Wired into the sweep via the action (`judgeRubricId` + `planner`), the
CLI (`judge-eval.ts escalation-sweep --rubric <id> [--planner criteria_split]`), and the Judge Lab
escalation launcher (rubric + planner selectors).

**Production wiring (Phase 4, gated default OFF):** the escalation chain is also wired into the live
evolution ranking path via an optional `ensembleRunner` on `compareWithBiasMitigation` (byte-identical
single-judge path when unset). `buildRunContext` resolves a strategy's `ensembleConfigId` to a chain +
rule (`evolution/src/lib/shared/judgeEnsemble/chainRegistry.ts`) ONLY when
`EVOLUTION_JUDGE_ESCALATION_ENABLED === 'true'`; otherwise production Elo is unchanged. Ensemble matches
persist normalized submatch + per-dimension rows (`evolution_arena_submatches` /
`evolution_submatch_dimension_verdicts`; see `evolution/docs/data_model.md`) and surface in the Match
Viewer (escalation badge + per-submatch dimension tables; legacy single-judge matches render
unchanged). Flipping the env var in prod is the deliberate go-live step.

## Agreement Sweep — rubric ↔ holistic (`evolution/src/lib/judgeEval/agreement.ts`)

A third sweep mode (project `Compare_critera_judge_vs_whole_article_paragraph_judge_evolution_20260619`)
answers a different question than the escalation/criteria-split sweeps: **how often does a rubric judge
agree with the holistic (no-rubric) judge?** For each pair it runs BOTH a holistic 2-pass judge AND a
rubric 2-pass judge (all criteria in one response) with the **same model** — **4 LLM calls per
pair·repeat** (2 holistic + 2 rubric) — and records whether the aggregated rubric verdict and each
individual criterion agree with the holistic winner, plus each side's accuracy vs the Elo-gap ground
truth. (This is distinct from `judge_eval_dimension_verdicts.favored_match_winner`, which compares a
criterion to the rubric's OWN aggregate, not to a separate holistic verdict.)

The engine mirrors `escalation.ts` (inlined `Promise.all` 2-pass over an injected `JudgeFn` from
`createCallLLMJudge` — NOT `compareWithBiasMitigation`): holistic = `buildComparisonPrompt` +
`aggregateWinners`; rubric = `buildRubricComparisonPrompt` + `aggregateRubric`; per-criterion winner =
`reconcilePasses(forward, reverse)`. Temperature/reasoning reach the model only via the closure's
`CallLLMOptions`. The cost gate uses `assertWithinJudgeEvalCap({chainCap: 2})` → `plannedCalls =
cells·pairs·repeats·2·2 = ×4`, and inherits the `JUDGE_EVAL_ENABLED` kill switch.

**Data model (migration `20260619000001_judge_eval_agreement.sql`, additive + idempotent, deny-all +
service_role_all RLS):**

| Table / view | Purpose |
|---|---|
| `judge_eval_agreement_runs` | One row per settings tuple; `settings_key` (sha256 with an `agreement\|` prefix) UNIQUE → idempotent re-run. Carries `judge_rubric_id` (required). |
| `judge_eval_agreement_calls` | Per (pair × repeat): holistic + rubric winner/confidence, `holistic_decisive`/`rubric_decisive` (GENERATED `confidence > 0.6`), `rubric_matches_holistic`, split + summed cost/tokens, per-pass raw audit, and the frozen ground-truth snapshot. |
| `judge_eval_agreement_criterion_verdicts` | One flat row per criterion per call (SQL-queryable for `/write_doc_for_completed_analysis`): `dimension_winner`, `agrees_with_holistic` (NULL on criterion TIE/abstain), `matches_ground_truth` (NULL unless large-gap decisive). |
| `judge_eval_agreement_leaderboard` (VIEW) | One row per run × `pair_kind`: strict / both-decisive agreement, abstain-divergence, and holistic/rubric accuracy (FILTER + NULLIF guard zero-large-gap runs). RLS-locked to `service_role`. |

**Reducer** `computeAgreementMetrics` (`agreementMetrics.ts`, pure, reused by run-detail + tests): the
three TIE buckets (strict / both-decisive `conf>0.6` / abstain-divergence), per-pair-modal vs
per-repeat agreement, per-criterion agree/disagree/abstain (criterion TIE excluded from the
agree/disagree denominator), and holistic/rubric/per-criterion accuracy on large-gap pairs only.

**Server actions** (`judgeEvalActions.ts`): `createAgreementSweepAction` (cap-gated; **hard-fails when
the rubric resolves to null** — no silent holistic fallback), `getAgreementLeaderboardAction` (SQL
view), `getAgreementRunDetailAction` (run + Core calls + criterion verdicts → the page slices by kind
and runs the reducer). **CLI:** `agreement-sweep --test-set <name> --model <id> --rubric <id>`.

**Admin UI** (`src/app/admin/evolution/judge-lab/agreement/`): a third "Agreement" entry on the
launcher mode toggle links to the sub-route (its run-detail lives at `agreement/runs/[agreementRunId]/`
— nested so it doesn't collide with the existing `runs/[evalRunId]`). The run-detail `view-{kind}`
toggle re-slices every panel.

**UX overhaul (fix_ux_bugs_judge_lab_agreement_20260621):**
- **Live cost preview** on the launcher via `estimateAgreementCostAction` (ZERO LLM calls — pre-flight
  only). Debounced 300ms; recomputes on every input change. Renders the compact one-liner
  `${pairs} pairs × ${repeats} repeats × 4 calls = ${plannedCalls} calls · est $X · within $5 cap`
  next to the Launch button. Color-shifts red + disables Launch when the estimate exceeds
  `JUDGE_EVAL_MAX_CALLS` / `JUDGE_EVAL_MAX_USD`. Estimate failure ≠ Launch disabled (graceful fallback
  renders `Cost preview unavailable` and leaves Launch enabled — preserves user agency).
- **In-UI label/knob advice**: `<th title="...">` tooltips on terse leaderboard headers
  (`Per-rep`, `Both-dec`, `Abstain`, `Worst criterion`); a `<details><summary>What do these mean?</summary>`
  block at the top of the leaderboard AND the detail page with the canonical definitions. Faded
  subtitles under the `repeats` and temperature inputs ("Each pair judged N times. 4 LLM calls per
  repeat (2 holistic + 2 rubric)…" and "0 (recommended — matches production judge path)…").
- **Unified canonical labels**: `Per-repeat agreement` (was `Per-rep` + `Per-repeat agree`),
  `Per-pair (modal) agreement` (was `Per-pair agree`), `Both-decisive agreement`, `Single-judge abstain`
  (was `Abstain / diverge`). SQL view column names (`strict_agree_rate` etc.) intentionally diverge —
  mapping lives in `getAgreementLeaderboardAction`.
- **6 detail-page tiles**: the original 4 (per-pair / per-repeat / both-decisive / single-judge abstain)
  PLUS 2 new **position-bias** tiles (`Holistic position bias`, `Rubric position bias`). Position-bias
  rates are derived server-side from the persisted `*_raw` columns (`parseWinner` for holistic,
  `parseRubricVerdict` for rubric) and shipped as pre-aggregated counts to the client reducer — no
  migration, immediate coverage of historical runs.
- **95% Wilson score CIs** on every agreement rate (leaderboard + detail tiles + per-criterion table),
  rendered as `78% [72, 84]`. Wilson is the right tool for proportions (not bootstrap). Each rate's CI
  uses its OWN denominator (`strict_agree_rate` uses `n_calls`; `both_decisive_agree_rate` uses
  `both_decisive_n` — these differ). Implemented via in-memory aggregation in
  `getAgreementLeaderboardAction` over a light per-call projection (PostgREST cannot express
  `COUNT(*) FILTER (...)` directly; in-memory aggregation is the simpler alternative to introducing an
  RPC/migration).
- **New `Worst criterion (disagree%)` column** on the leaderboard — the criterion with the highest
  disagree-with-holistic rate in that run, with `name (rate%)` rendering. Highest-signal triage column
  for "which run had the most rebellious criterion."
- **New `/matches` sub-route** at `src/app/admin/evolution/judge-lab/agreement/runs/[agreementRunId]/matches/page.tsx`
  mirroring the regular-sweep match-history pattern: paginated 25 Core rows, lazy expand fetches the
  4 raws (holistic forward/reverse + rubric forward/reverse) PLUS per-criterion verdicts for that one
  call via `getAgreementCallDetailAction`. `?disagree=1` query param filters to both-decisive
  opposite-winner calls. "Open in Match Viewer" link via the existing
  `findArenaComparisonForVariantsAction`. The detail page links to it via "View all matches →" + the
  old in-page 100-row disagreement drill-down is replaced with a count headline + link to
  `/matches?disagree=1`.
- **Shared audit primitives**: `TextBlock`, `extractTexts`, `reasoningStateLabel` extracted to
  `evolution/src/components/evolution/matches/sharedAuditPrimitives.tsx` (used by both the regular
  sweep's `runs/[evalRunId]/matches/page.tsx` and the new agreement `/matches` page).
  **Plain-text render contract**: every raw / reasoning / prompt is rendered via `<pre>` (auto-
  escaping); NO `dangerouslySetInnerHTML`, NO Markdown-to-HTML pipeline.

## Metrics (`evolution/src/lib/judgeEval/metrics.ts`)

`decisive_rate` (conf > 0.6), self-consistency / agreement, avg confidence, **position-bias rate**
(both passes pick the same slot label → confidence-0.5 forced tie), accuracy vs ground truth
(large-gap pairs only), median latency, avg output/reasoning tokens, avg cost, cost-per-decisive,
and **implied beta** (`beta-analysis.ts` back-solve: `c = gap/(-ln(1/p-1))`,
`β = sqrt((c² - σ_a² - σ_b²)/2)`). Accuracy + implied-β require ground truth, so they apply to
`gap_kind='large'` pairs only; close pairs are tie-acceptable.

## Engine (`runJudgeEval.ts`)

Mirrors `rejudgeComparisonAction`: an **inlined `Promise.all` 2-pass** (NOT `run2PassReversal`,
which discards raw passes; NOT `compareWithBiasMitigation`, which has no temp/prompt/reasoning +
a text-only cache). The LLM call is injected (`JudgeFn`) for unit-testability;
`createCallLLMJudge()` builds the production path over **plain `callLLM`** (call_source
`evolution_judge_eval` → inherits the shared LLM semaphore + global spending gate) with the
`E2E_TEST_MODE` stub + prod guard. Writes nothing to ratings/arena/metrics. Parser selection:
`explainReasoning || customPrompt` → `parseVerdictFromReasoning`, else `parseWinner`.

**Reliability (improve_judge_lab_evolution_20260707).** Provider clients are built `maxRetries:0`,
so `createCallLLMJudge` wraps `callLLM` in a **bounded retry** (`MAX_JUDGE_RETRIES=3`, exponential
backoff, reusing `isTransientError`); budget/kill-switch errors are never retried, and each retry
re-enters the global spending gate. On failure the engine attaches **combined `partialResults`** to
the thrown error and `executeSweep` persists them via `replaceCalls` so a failed cell becomes a real
errored run (`judge_eval_calls.error` set; excluded from the decisive-rate VIEW which filters
`error IS NULL`) rather than a 0-call orphan. The server action now passes `trackingDb` so judge
calls also write `llmCallTracking` rows. Note: the generic UI string "error communicating with AI
model" was an **error-masking** artifact — `categorizeError` (`src/lib/errorHandling.ts`) matched
`'api'` before `'timeout'` and the UI dropped `res.error.details`; both are fixed, so the real
provider error now surfaces in the sweep-failure toast.

## Cost safety (`settings.ts`)

Judge-eval has **no per-user cap** (only the guest user is capped), so `assertWithinJudgeEvalCap`
enforces a hard, non-overridable ceiling BEFORE any LLM call — used by both the server action and
the CLI:

| Env | Default | Effect |
|-----|---------|--------|
| `JUDGE_EVAL_ENABLED` | `true` | `'false'` short-circuits sweeps (per-feature kill switch). |
| `JUDGE_EVAL_MAX_CALLS` | `20000` | Reject sweeps planning more 2-pass LLM calls. |
| `JUDGE_EVAL_MAX_USD` | `5` | Reject sweeps whose pre-flight estimate exceeds this. |

## CLI (`evolution/scripts/judge-eval.ts`)

```bash
npx tsx evolution/scripts/judge-eval.ts seed --topic <uuid> --bank "<name>"
npx tsx evolution/scripts/judge-eval.ts create-test-set --bank "<name>" --name fr2-smoke \
    --size-article 10 --size-paragraph 10 --strategy stratified_confidence --seed 1
npx tsx evolution/scripts/judge-eval.ts sweep --test-set fr2-smoke \
    --models qwen-2.5-7b-instruct,gpt-4.1-nano --temperatures 0,1 --repeats 5 [--dry-run]
```

## Admin UI

Under the evolution "Tools" sidebar group:
- `/admin/evolution/judge-lab` — sweep launcher (test set + kind + models × temps × reasoning +
  custom prompt) + per-kind decisive-rate leaderboard scoped to the test set. The judge-model
  dropdown is curated server-side (`getJudgeModelOptionsAction` → `getDeployableEvolutionModelIds`)
  to drop `provider:'local'` models when `LOCAL_LLM_BASE_URL` is unset. The **custom-prompt** box is
  pre-filled with the real default paragraph rubric (`PARAGRAPH_SANDBOX_RUBRIC` from
  `evolution/src/lib/shared/judgeRubrics.ts`) — editable + submittable directly — with a separate,
  default-off **Explain reasoning** checkbox (decoupled from the textarea). The leaderboard's
  **Prompt** column shows whether a custom prompt was used and the text (expandable), enriched from
  `judge_eval_runs.prompt_variant`.
  The leaderboard's first column is the **Run** id (8-char, full UUID in `title`) — that is the link to
  the run detail page (the model name is plain text); the eval-run id is the tracking handle throughout.
- `/admin/evolution/judge-lab/runs/[evalRunId]` — per-kind aggregates + per-pair breakdown (reads
  light **Core** columns only — `getEvalRunDetailAction` selects an explicit column list, never `*`,
  so the heavy audit text never ships with the aggregates). Header shows the full run id (click-to-copy).
  Links to ↓.
- `/admin/evolution/judge-lab/runs/[evalRunId]/matches` — **match history**: every (pair × repeat)
  call, paginated (`getJudgeEvalCallsAction`, Core rows). Expand a row to lazily load the audit
  payload (`getJudgeEvalCallDetailAction`): both input content pieces, the winner, and the full judge
  input (incl. custom prompt) + raw output + reasoning for each pass, with the `reasoning_trace_format`
  state surfaced ("not requested" vs "provider dropped the trace"). All model/user text is rendered as
  plain (auto-escaped) `<pre>` — never `dangerouslySetInnerHTML`. Each row also has **Open in Match
  Viewer**: judge-eval pairs are seeded from `evolution_arena_comparisons`, so
  `findArenaComparisonForVariantsAction` resolves the call's snapshotted `variant_a_id`/`variant_b_id`
  (either entry order, newest) to a comparison id and opens `/admin/evolution/matches/[comparisonId]` in
  a new tab (toasts if none / if the row predates the variant-id snapshot).
- `/admin/evolution/judge-lab/pair-banks` — list + seed-from-topic.
- `/admin/evolution/judge-lab/test-sets` — list + create (size/strategy/seed → frozen), plus
  **View** / **Edit** / **Clone** row actions.
- `/admin/evolution/judge-lab/test-sets/[testSetId]` — **view contents**: per-pair table showing
  **display Elo ± uncertainty** (not raw mu) + Elo-gap, with snapshot texts fetched lazily per row,
  and an orphan warning when frozen members no longer resolve in a re-seeded bank
  (`getTestSetContentsAction` / `getTestSetPairTextsAction`).

**Editing a frozen set is metadata-only** (`updateTestSetMetaAction`: name/description; `23505`→
friendly error). Membership/strategy/seed/size are NOT editable in place — they determine the frozen
membership and `settings_key` embeds `test_set_id`, so an in-place change would silently break
cross-run comparability. The only safe membership change is **Clone** (`cloneTestSetAction`): it
re-samples the source's *current* bank into a NEW set (new id → new `settings_key`s), leaving the
source and its eval runs intact; it errors on name collision (never aliases an existing set).

**Clone & curate** (`CloneCuratePanel` on the test-set detail page) is the membership-editing path:
it lists the source's **bank** (the available universe of existing recorded pairs) via
`getBankPairsForCurationAction` → `loadBankPairsForCuration` — each pair projected to Elo,
text-stripped, and flagged `isMember`, filtered by Kind · Membership · Gap-kind · **Elo both-sides
min/max** · label search, paginated. Current members are pre-checked (seeded from the load's
`memberLabels` — one round-trip); uncheck to remove, check a non-member to add. "Clone with N pairs"
calls `cloneTestSetAction({ strategy:'manual', manualLabels, newName })`, which freezes exactly the
chosen labels into a new set (per-kind selected counts stored as its sizes). It curates **existing
pairs only** — it never constructs novel pairs from individual variants (that would null out
`baseline_confidence`), and it never mutates the source.

Interactive single-match re-judge stays in the Match Viewer (`/admin/evolution/matches`) — whose
custom-prompt box is pre-filled with the mode-appropriate default rubric (article/paragraph) from
`judgeRubrics.ts`, editable and directly submittable (parity with the Judge Lab launcher).

## Key files

- `evolution/src/lib/judgeEval/` — `schemas.ts`, `metrics.ts`, `testSet.ts`, `settings.ts`,
  `cost.ts`, `runJudgeEval.ts`, `persist.ts`, `seed.ts`, `executeSweep.ts` (+ colocated tests).
- `evolution/src/services/judgeEvalActions.ts` — server actions (cap-gated).
- `evolution/scripts/judge-eval.ts` — CLI.
- `src/app/admin/evolution/judge-lab/**` — admin pages.
- `supabase/migrations/20260606000001_judge_eval_tables.sql` — schema; `20260610000001_judge_eval_calls_audit_and_snapshot.sql` — additive audit + ground-truth-snapshot columns on `judge_eval_calls`.
