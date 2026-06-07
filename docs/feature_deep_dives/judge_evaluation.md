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
| `judge_eval_calls` | Per-(run × pair × repeat) verdict; `decisive` GENERATED `(confidence > 0.6)`. |
| `judge_eval_settings_leaderboard` (VIEW) | Best settings by decisive rate, scoped to a test set, split by `pair_kind`. RLS-locked (REVOKE PUBLIC/anon/authenticated; GRANT service_role). |

All tables: deny-all RLS + `service_role_all` (mirrors evolution convention). Separate from
`evolution_arena_comparisons` (the in-run match log, which drops judge settings + raw passes).

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
  custom prompt) + per-kind decisive-rate leaderboard scoped to the test set.
- `/admin/evolution/judge-lab/runs/[evalRunId]` — per-kind aggregates + per-pair breakdown.
- `/admin/evolution/judge-lab/pair-banks` — list + seed-from-topic.
- `/admin/evolution/judge-lab/test-sets` — list + create (size/strategy/seed → frozen).

Interactive single-match re-judge stays in the Match Viewer (`/admin/evolution/matches`).

## Key files

- `evolution/src/lib/judgeEval/` — `schemas.ts`, `metrics.ts`, `testSet.ts`, `settings.ts`,
  `cost.ts`, `runJudgeEval.ts`, `persist.ts`, `seed.ts`, `executeSweep.ts` (+ colocated tests).
- `evolution/src/services/judgeEvalActions.ts` — server actions (cap-gated).
- `evolution/scripts/judge-eval.ts` — CLI.
- `src/app/admin/evolution/judge-lab/**` — admin pages.
- `supabase/migrations/20260606000001_judge_eval_tables.sql` — schema.
