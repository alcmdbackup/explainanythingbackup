# Improve Judge Lab Evolution Research

## Problem Statement
Make improvements to the Judge Lab — the systematic, persisted judge-evaluation tool in the
evolution admin UI (`/admin/evolution/judge-lab`) that runs batch A/B/TIE judge sweeps over frozen
test sets and ranks judge settings by decisive rate. Two concrete improvements are requested: (1) fix
a model-communication error that occurs when selecting `deepseek-v4-flash` or
`google/gemini-2.5-flash-lite` as the judge model, and (2) add the ability to edit a test set and view
its contents from the test-sets menu.

## Requirements (from GH Issue #1174)
- Trying to use deepseek-v4-flash or google/gemini-2.5-flash-lite results in an error 'error communication with AI model'.
- Want to add the ability to edit test sets and view their contents, from the test sets menu

## High Level Summary

_Synthesized from a 5-round × 4-agent investigation (20 agents; 2 on the model error, 2 on test
sets) that read the code and queried the dev/staging Supabase. The four dimensions converged with no
contradictions._

### Requirement 1 — "error communication with AI model" (root cause is NOT what it looks like)

**The two named models are correctly registered and correctly routed — this is not a model-id /
registry / routing bug, and not the reasoning-effort param.** Both models even have *proven-working*
judge calls in staging history. The failure is the product of **two confirmed code defects**:

- **(A) Error masking.** `categorizeError()` (`src/lib/errorHandling.ts:69-75`) collapses *any* error
  whose lowercased message contains `'api'`/`'openai'` into the generic
  `"Error communicating with AI service"` — and that `'api'` branch is even checked **before**
  `'timeout'`. The Judge Lab UI toast shows only `res.error.message` and **discards
  `res.error.details`** (`src/app/admin/evolution/judge-lab/page.tsx:~130`). So the real provider
  error is never surfaced.
- **(B) No-retry fragility.** The judge path calls **plain `callLLM`**
  (`evolution/src/lib/judgeEval/runJudgeEval.ts:226`); every provider client is built with
  `maxRetries:0` (`src/lib/services/llms.ts:264/293/325/354/385`) and the judge path does **not**
  use `createEvolutionLLMClient`'s retry loop. One transient 429/5xx/timeout aborts the whole sweep
  cell and, because `upsertRun` creates the run row *before* the call and the cell has no try/catch,
  leaves an **orphan 0-call run** with no error trail.

**Decisive evidence (DB):** in the 2026-06-07 22:03–22:05 window, same test set (`f40bdd83`), same
`kind_filter=paragraph`, same `reasoning_effort='none'` — `gpt-4o-mini` got **10 calls (success)**
while `google/gemini-2.5-flash-lite` and `deepseek-v4-flash` got **0 calls (fail)**. Since
`deepseek-v4-flash` and `gpt-4o-mini` take the **identical** `llms.ts` else-branch (which strips
`reasoning='none'`), the reasoning param cannot explain the divergence — leaving a **cross-provider
transient, made fatal by zero retries and hidden by the mask** as the only explanation consistent
with all evidence.

**Secondary / latent defects surfaced (real, but distinct from the reported failure):**
- `trackingDb` is **not wired** in the Judge Lab server-action path
  (`evolution/src/services/judgeEvalActions.ts:128-141`), so even *successful* judge runs write **no
  `llmCallTracking` rows** (~410 judge calls, 0 tracking rows observed). The CLI passes it
  (`judge-eval.ts:110`); the action should too.
- The judge dropdown exposes **environment-incompatible models** via `getEvolutionModelIds()`
  (`page.tsx:57`) — e.g. `LOCAL_qwen2.5:14b` → `localhost:11434`, a **guaranteed** failure on Vercel
  that emits the same generic error. The default judge is itself an OpenRouter model.
- `reasoning:{effort:'none'}` is attached **unconditionally** to OpenRouter non-reasoning models
  (gemini, qwen) and to mandatory-reasoning `gpt-oss-20b` (`llms.ts:443-462`) — hygiene, not the
  proven cause.
- Sweep-cell failures are **not persisted** (`judge_eval_calls.error` column exists but is unused on
  the throw path) → orphan runs instead of an errored run.

### Requirement 2 — view + edit test sets (design constraint, not a bug)

The binding fact is the **frozen-membership contract**: a test set's pairs are materialized **once**
at create time into `judge_eval_test_set_members` (PK `(test_set_id, pair_label)`, commented "written
once at create, never mutated"; sole writer = the create branch of `getOrCreateTestSet`,
`persist.ts:122-127`). The run idempotency key
`settings_key = sha256(judge_model | temperature | reasoning_effort | prompt_variant_hash |
kind_filter | test_set_id)` (`settings.ts:30-37`) embeds `test_set_id` but **not** membership /
strategy / seed / size; `upsertRun` uses `onConflict:'settings_key'` and `replaceCalls`
DELETE+reinserts; the leaderboard view groups purely by `test_set_id`. **Therefore any in-place
membership change (directly, or via strategy/seed/size which *determine* membership) keeps the same
`settings_key`, so a post-edit re-run silently reuses the existing run row and overwrites its calls
against a different pair population — corrupting comparability with zero collision and zero signal.**
Risk is **live**: `fr2-smoke` has 20 frozen members + **7 dependent runs** (DB-confirmed).

**Conclusion — "edit" must be split three ways:**
- **VIEW contents** (fully safe, read-only): wrap existing `loadTestSetPairs` (`persist.ts:142`) in a
  new `getTestSetContentsAction`; new detail page `test-sets/[testSetId]/page.tsx`. **Project OUT
  `text_a`/`text_b` in the list response** (a 100-member set ships ~1 MB otherwise); lazy-load
  snapshot texts on row-expand. Surface an **orphan warning** (member count vs resolved count) since
  `loadTestSetPairs` silently drops members absent from a re-seeded bank (`persist.ts:168-173`).
- **EDIT = metadata-only**: `updateTestSetMetaAction` scoped UPDATE on `name`/`description` only;
  catch unique-violation (`23505`) on `name` (it's the `createEvalRun`/CLI lookup key) and warn that
  renaming can break saved CLI `--test-set` scripts. **Do not** expose strategy/seed/size editing.
- **CLONE = the only safe membership-change path**: `cloneTestSetAction` loads
  `source.pair_bank_id` and re-runs `getOrCreateTestSet` + `selectTestSetMembers` with new params →
  **new id → new settings_keys → existing runs preserved**. Also the natural home to finally expose
  `description` + `strategy='manual'` + `manualLabels` (omitted from create today). Coerce
  `seed` string→number (BIGINT serializes as string); warn that clone re-samples the *current* bank.
- UI: migrate `test-sets/page.tsx` from the bespoke `<table>` to `EntityListPage` (self-managed
  `loadData`) to get rowActions (View/Edit/Clone/Delete) + dialogs for free. Any Delete must be
  hard-blocked when `runs>0` (four-level `ON DELETE CASCADE` blast radius).

### Pre-investigation orientation (kept for traceability — some hypotheses below were EXONERATED)

> The bullets below were the pre-investigation hypotheses. The investigation **exonerated** the
> "invalid/unregistered model id", "model-prefix routing", and "reasoning-param" theories for the
> reported failure; the real causes are the error-mask + no-retry defects documented above.

- **Judge Lab feature** lives at `src/app/admin/evolution/judge-lab/**` (pages) backed by
  `evolution/src/services/judgeEvalActions.ts` (cap-gated server actions), engine in
  `evolution/src/lib/judgeEval/` (`schemas.ts`, `metrics.ts`, `testSet.ts`, `settings.ts`, `cost.ts`,
  `runJudgeEval.ts`, `persist.ts`, `seed.ts`, `executeSweep.ts`), CLI at
  `evolution/scripts/judge-eval.ts`, schema in
  `supabase/migrations/20260606000001_judge_eval_tables.sql`.

- **Item 1 (model error)** — the judge LLM call routes through plain `callLLM`
  (`src/lib/services/llms.ts`) with `call_source='evolution_judge_eval'`. The model dropdown is
  populated by `getModelOptions` (same helper used by the Match Viewer re-judge sandbox). Likely root
  causes to verify during research:
  - The two failing models may not be registered in the model registry / `getModelOptions`
    allow-list, or map to a provider/route (`isOpenRouterModel`) that isn't wired for the judge path.
  - `deepseek-v4-flash` may be an invalid/unknown model id (DeepSeek pricing in `llmPricing.ts` lists
    `deepseek-chat`); `google/gemini-2.5-flash-lite` is an OpenRouter-style slug → check OpenRouter
    routing + `OPENROUTER_API_KEY`.
  - Reasoning-effort handling in `llms.ts`: for OpenRouter it sets `reasoning.effort` +
    `include_reasoning`; for OpenAI o-series it sets `reasoning_effort` (omitting `'none'`). A model
    that rejects these params could surface as "error communicating with AI model".
  - "error communicating with AI model" is the user-facing string — find where it is thrown/mapped to
    get the real underlying error (provider 4xx, unknown-model, missing API key, temperature clamp).

- **Item 2 (edit/view test sets)** — Test Sets are **frozen** by design: membership materializes once
  into `judge_eval_test_set_members` (PK `(test_set_id, pair_label)`) and "never changes" so
  consecutive runs compare on identical pairs. UI today: `/admin/evolution/judge-lab/test-sets` =
  list + create (size/strategy/seed → frozen). Research must determine what "edit" should mean given
  the frozen-comparability contract (rename/metadata edit vs. re-sampling membership vs. a
  view-only contents drawer), and what "view contents" should show (the member pairs + their snapshot
  texts/Elo-gap/recorded confidence). This interacts with the eval-run idempotency key
  (`settings_key` includes `test_set_id`) — editing membership in place would silently break
  cross-run comparability, so the design likely needs view + safe-edit (metadata) + optional
  "clone into new test set" rather than mutating a frozen set.

## Follow-up research: curate membership on clone (post-consensus request, 2026-06-09)

**Ask:** "clone AND simultaneously edit the articles/paragraphs in the test set" — clarified to mean
**edit which pairs are members** (add/remove article/paragraph pairs), NOT edit the frozen members'
text. Done as part of a **clone** (a new frozen set), so the source set and its eval runs stay intact.

**This is the safe path, and the mechanism already exists.** Editing a frozen set's membership
*in place* is the forbidden operation (it keeps the same `settings_key`, silently corrupting
cross-run comparability). Editing membership *while cloning* produces a NEW set → new `settings_key`s
→ zero impact on the source — exactly what clone is for.

Where the pieces already are:
- **Membership = pair labels**, stored in `judge_eval_test_set_members (test_set_id, pair_label,
  pair_kind)`. The article/paragraph **texts live only in the bank** (`judge_eval_pair_banks.pairs`
  JSONB); members reference pairs by `pair_label`. So "edit membership" = change the set of
  `pair_label`s, with the bank as the universe of available pairs.
- **`manual` strategy is the curation primitive.** `selectTestSetMembers(pairs, { strategy:'manual',
  manualLabels })` (`evolution/src/lib/judgeEval/testSet.ts:99-105`) returns exactly the bank pairs
  whose label is in `manualLabels` (kind is taken from each pair; mixed article+paragraph is fine).
  `assertMembersExist` (`testSet.ts:124`) rejects labels not in the bank.
- **`cloneTestSet` already threads `manualLabels`** (`persist.ts:334`, `CloneTestSetInput.manualLabels`
  → `getOrCreateTestSet` → `selectTestSetMembers`). The only gap is that `cloneTestSetAction`'s Zod
  schema (`judgeEvalActions.ts`) doesn't yet accept `strategy:'manual'` + `manualLabels`, and there is
  no curation UI.

What's actually needed:
1. **Expose the manual path in the action** — accept `strategy` (incl. `'manual'`) + `manualLabels:
   string[]` in `cloneSchema`; when manual, set the cloned set's `size_article`/`size_paragraph` to
   the **selected counts per kind** (honest metadata) and pass `manualLabels` through. Validate
   non-empty + map a friendly error when labels aren't in the bank (wrap `assertMembersExist`).
2. **A "universe" read action** for the picker — the curation UI must show *all bank pairs of the
   chosen kinds* (so the user can ADD pairs that aren't current members), each flagged
   `isMember` (current membership) + the same Elo projection + text-stripping as `loadTestSetContents`
   (texts fetched lazily per row via the existing `getTestSetPairTextsAction`). New helper, e.g.
   `loadBankPairsForCuration(db, testSetId)` returning `{ pairs: Array<{label, pair_kind, elo_a,
   elo_b, elo_gap, isMember}> }`. The source set's current members are the default selection.
3. **Curation UI** on the test-set detail (or a "Clone & curate" flow): checkbox list of bank pairs
   (current members pre-checked), per-kind filter + search, a live selected-count, and a "Clone with
   these N pairs" button → `cloneTestSetAction({ strategy:'manual', manualLabels, newName, … })`.

Edge cases / caveats to carry into the plan:
- **Scale.** Banks can be large (FR2 ~8.8k pairs). The universe list MUST strip `text_a`/`text_b`
  (megabytes otherwise — same reason `loadTestSetContents` does) and needs pagination + label/kind
  search; texts load lazily per row. A "select all (filtered)" should operate on labels, not fetch
  texts.
- **Orphans.** A current member whose label is no longer in the (re-seeded) bank can be *shown* (it's
  in the members table) but **cannot be re-included** in a manual clone (not in the bank → dropped by
  `selectTestSetMembers`/`assertMembersExist`). Surface this like the existing orphan warning.
- **Ground truth is unaffected** — we're changing *which* pairs are included, not their texts, so each
  included pair keeps its `mu`/`sigma`/`expected_winner`/`baseline_confidence`. (This is why the
  "edit the texts" interpretation was rejected: editing text would invalidate the rating ground truth.)
- **Manual ignores `seed`/`size`** — membership is exactly the chosen labels; store the per-kind
  selected counts as the cloned set's sizes for honest display.

Key files for this follow-up: `evolution/src/lib/judgeEval/testSet.ts` (`selectTestSetMembers` manual
path, `assertMembersExist`), `evolution/src/lib/judgeEval/persist.ts` (`cloneTestSet`,
`getOrCreateTestSet`, `loadTestSetContents`/`getTestSetPairTexts` to mirror), `evolution/src/services/
judgeEvalActions.ts` (`cloneTestSetAction` schema + new universe action), `src/app/admin/evolution/
judge-lab/test-sets/**` (curation UI).

## Follow-up research: prefill the Match Viewer re-judge custom-prompt box (parity, 2026-06-09)

**Finding:** the custom-prompt prefill we added was on the **Judge Lab** sweep launcher
(`src/app/admin/evolution/judge-lab/page.tsx`) only. The **Match Viewer re-judge sandbox**
(`src/app/admin/evolution/matches/[comparisonId]/page.tsx`) — the other place with a "custom judge
prompt" box — still initializes it **empty** (`const [customPrompt, setCustomPrompt] = useState('')`,
line 89). So the two surfaces are inconsistent; the user expected the prefill there too.

What the Match Viewer already has (so this is a small, consistent add):
- A `mode` toggle (`'article' | 'paragraph'`, line 85) — the default rubric is mode-dependent.
- An `explainReasoning` checkbox already as a separate control (line 87) — no decoupling needed
  (unlike Judge Lab, which we had to add one to).
- A `showCustom` toggle (line 88) gating the box; submit uses
  `customPrompt: showCustom && customPrompt.trim() ? customPrompt : undefined` (line 127), so the
  default re-judge path is unchanged unless the user opens + uses the box.

What's needed:
- Prefill `customPrompt` with the **mode-appropriate** default rubric from the client-safe
  `evolution/src/lib/shared/judgeRubrics.ts` — `PARAGRAPH_SANDBOX_RUBRIC` when `mode==='paragraph'`,
  `ARTICLE_SANDBOX_RUBRIC` when `mode==='article'` (both already exported there from Phase 2's
  extraction). Editable + submittable directly, same as Judge Lab.
- **Mode-aware**: when the user flips `mode`, refresh the box to that mode's rubric **unless they've
  hand-edited it** (track a "dirty" flag, or only auto-fill while the text still equals one of the two
  preset rubrics). A "Reset to default rubric" affordance (mirrors Judge Lab) covers the edited case.
- Keep the existing `showCustom`/`explainReasoning` controls as-is.

Key files: `src/app/admin/evolution/matches/[comparisonId]/page.tsx`,
`evolution/src/lib/shared/judgeRubrics.ts` (`ARTICLE_SANDBOX_RUBRIC` / `PARAGRAPH_SANDBOX_RUBRIC`).

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

### Relevant Docs
- docs/feature_deep_dives/judge_evaluation.md
- evolution/docs/rating_and_comparison.md
- evolution/docs/reference.md
- evolution/docs/visualization.md
- evolution/docs/data_model.md
- evolution/docs/README.md (orientation)
- evolution/docs/architecture.md (orientation)

## Code Files Read (during investigation)
- `src/app/admin/evolution/judge-lab/page.tsx` — sweep launcher; model dropdown via `getEvolutionModelIds()` (:57), reasoning default `'none'` (:63), `reasoningEfforts:[reasoning]` (:122), failure toast shows only `res.error.message` (~:130)
- `src/app/admin/evolution/judge-lab/test-sets/**` — list page (bespoke `<table>`, list+create only)
- `evolution/src/services/judgeEvalActions.ts` — server actions; `createEvalRunAction` (:125-141) omits `trackingDb`
- `evolution/src/lib/judgeEval/runJudgeEval.ts` — engine; `createCallLLMJudge` (:165-232), plain `callLLM` (:226), catch only handles budget/killswitch (:227-232)
- `evolution/src/lib/judgeEval/{executeSweep.ts,persist.ts,settings.ts,testSet.ts,seed.ts,schemas.ts}` — `settings_key` (settings.ts:30-37), `getOrCreateTestSet`/members write-once (persist.ts:88-127), `loadTestSetPairs` (persist.ts:142,168-173), `upsertRun`/`replaceCalls` (persist.ts:214-229)
- `src/lib/services/llms.ts` — `callLLM`, client builders (all `maxRetries:0` at :264/293/325/354/385), `isDeepSeekModel` (:301-303), `isOpenRouterModel` (:362-364), reasoning-effort handling (:443-462), client selection (:489-497)
- `src/config/modelRegistry.ts` — `deepseek-v4-flash` (:133-137), `google/gemini-2.5-flash-lite` (:159-164), `gpt-oss-20b` (:150-158), `DEFAULT_JUDGE_MODEL` (:211)
- `src/lib/errorHandling.ts` — `categorizeError()` (:69-75) generic-string masking
- `evolution/src/lib/shared/classifyErrors.ts` — `isTransientError` (:15) — reusable for the judge retry loop
- `supabase/migrations/20260606000001_judge_eval_tables.sql` — members PK + comment (:34-39), `name` UNIQUE (:25), leaderboard view group-by `test_set_id` (:127,149)

## DB Evidence (dev/staging, read-only)
- `fr2-smoke` test set: **20 frozen members + 7 dependent eval runs** (the live comparability risk).
- 2026-06-07 22:03–22:05, test set `f40bdd83`, `kind=paragraph`, `reasoning='none'`:
  `gpt-4o-mini`=10 calls (success), `google/gemini-2.5-flash-lite`=0 calls (fail),
  `deepseek-v4-flash`=0 calls (fail) — the decisive "same shape, different provider" comparison.
- ~410 `judge_eval_calls` exist with **0** matching `llmCallTracking` rows (`trackingDb` not wired).
- Both named models had prior **successful** `evolution_judge_eval` tracking rows historically
  (DB actively churns; the persistent 22:0x run-window evidence is the stable proof).
