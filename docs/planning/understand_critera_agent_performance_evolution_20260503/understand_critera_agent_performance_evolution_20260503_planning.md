# understand_critera_agent_performance_evolution_20260503 Plan

## Background

Investigation of recent criteria-driven runs (n=95 variants from 5 runs on staging, 2026-05-03) found `evaluate_criteria_then_generate_from_previous_article` produces **-47 Elo mean delta** vs parents — while sibling agents (vanilla generate, reflection) produce +16-23 Elo. Three root causes identified, in priority order: (1) two of the seven seeded sample criteria — `point_of_view` and `engagement` — have rubrics that misalign with educational content, (2) the wrapper's `customPrompt` template invites bloat through additive language with no length-preservation guidance, (3) GFPA executes bad suggestions mechanically. See `_research.md` for the full investigation.

## Requirements (from GH Issue #NNN)

The original brief was investigative ("understand why performance is worse than I expected"). The investigation produced findings; this plan converts the highest-leverage findings into actionable interventions, ordered by impact / effort / risk.

## Problem

The two misconfigured rubrics drive ~75% of weakest-K=2 focus pairs and produce -47.55 / -41.87 Elo when focused. The customPrompt template amplifies the damage by encouraging bloat (29-45% expansion in the worst cases). Operationally the agent is healthy (96.9% success, low cost, fast); the failure is purely about which suggestions get generated and how literally GFPA applies them. Best-case variants (max +3.64 mu) prove the agent can work well when suggestions land — so the fix is to improve the suggestions, not the agent itself.

## Options Considered

- [x] **Option A: Rubric edits via admin UI only** — fast, reversible, targets the root cause. Tested first; if it works, may be enough on its own.
- [x] **Option B: Rubric edits + customPrompt code change** — chosen as the full-fix path. Two clean phases with a validation gate between them.
- [x] **Option C: Drop POV + engagement entirely from the seed script** — rejected. They're useful for opinion content; the issue is the *default* anchors, not the criteria themselves.
- [x] **Option D: Switch criteria iterations to `sourceMode='seed'` instead of `'pool'`** — rejected. Investigation showed reflection uses identical pool mode and succeeds; RTM is not the dominant issue (~+4-6 Elo at most).
- [x] **Option E: Diversify the test set first, before fixing anything** — rejected as prerequisite (would delay the fix unnecessarily) but kept as Phase 3 follow-up.

## Phased Execution Plan

### Phase 1: Rubric edits via admin UI + validation run (~1-2 hours)

Lowest-effort, highest-impact intervention. Pure data fix; no code change. User edits two criteria via `/admin/evolution/criteria` UI, then re-runs the same strategy on the same Federal Reserve prompt to confirm deltas improve.

**Pre-edit safety steps:**
- [x] **Snapshot the current rubrics** (rollback insurance). Append a "Phase 1 Pre-Edit Snapshot" section to `_research.md` containing the exact current `description` + 3 anchors for both `point_of_view` and `engagement` criteria. The current text also lives in `evolution/scripts/seedSampleCriteria.ts` at lines 42-52 (engagement) and 86-96 (point_of_view), but the in-place admin-UI edit overwrites that history at the DB level — the snapshot in `_research.md` is the authoritative undo source.
- [x] **Drain in-flight runs**. Before editing, run `npm run query:staging -- "SELECT id FROM evolution_runs WHERE status IN ('claimed','running') AND id IN (SELECT DISTINCT run_id FROM evolution_agent_invocations WHERE agent_name='evaluate_criteria_then_generate_from_previous_article')"` — wait for it to return zero rows. `getCriteriaForEvaluation` (`evolution/src/services/criteriaActions.ts`) reads fresh per iteration with no caching, so any run mid-pipeline at edit time will use mixed pre/post-fix rubrics and contaminate the baseline comparison.
- [x] **Announce to the team** if anyone else may be running experiments against staging — rubric edits are global and will affect any in-progress baseline collection.

**Edit + re-run:**
- [x] User opens `/admin/evolution/criteria/<point_of_view-id>` and replaces description + 3 anchors with the proposed text in the "Proposed Rubric Replacements" section below. Note: requires an authenticated admin session cookie (the `updateCriteriaAction` Server Action is `adminAction`-gated).
- [x] User opens `/admin/evolution/criteria/<engagement-id>` and applies the same edit pattern.
- [x] User opens `/admin/evolution/start-experiment`, selects the existing "Criteria based generation" strategy, and triggers **at least 5 fresh runs** against the same prompt as the staging baseline. Five runs at the strategy's typical ~19 child variants per run yields ~95 child variants — matching the original investigation's sample size and bringing per-mean stderr to ~±5-6 Elo (with the observed stddev ≈ 54 mu × 16 = ~864 Elo per variant).
- [x] Wait for runs to complete (typical ~5-10 min each; 5 runs in parallel ≈ 15-20 min wall clock under default `EVOLUTION_MAX_CONCURRENT_RUNS=5`).

**Compare (multi-signal — single-metric significance is impossible at this sample size; see Statistical reality below):**

Compute four independent signals from the new batch and judge them together:

- [x] **Signal 1 — Per-criterion focus shift.** Run the same `frequency_as_weakest` query from Round 1. POV was focused on 96.8% of pre-edit variants; engagement on 66.3%. **Post-edit expectation**: if the rubric reframing worked, POV should drop substantially (target ≤40%) — and the LLM should spread focus across criteria more evenly. This signal is small-sample-robust because focus frequency reflects the LLM's scoring behavior under the new rubric, which is deterministic given temperature=0 / qwen-2.5-7b judge.
- [x] **Signal 2 — Mean child-vs-parent word-count ratio.** Pre-edit: 1.118 (criteria) vs 0.967 (vanilla GFPA) vs 1.167 (reflection). Post-edit expectation: ratio drops toward ~1.05 if the rubric reframing reduces bloat-inducing suggestions; further toward 1.0 only after Phase 2's customPrompt fix.
- [x] **Signal 3 — Mean Elo delta.** Compute mean and stddev. Pre-edit: -47 Elo, stddev ~864 Elo per variant (n=95). Post-edit, treat the mean as **directional, not significant** — see Statistical reality.
- [x] **Signal 4 — Qualitative spot-check of 2 best + 2 worst variants** from the new batch. Read the suggestions + child text. Compare against Round 2 Agent A's worst-case readings (bolted-on sections, tone inflation, meta-commentary). The spot-check is the most informative signal at small sample sizes.

**Decision gate (multi-signal, qualitative):**
- [x] **Proceed to Phase 2** if AT LEAST 3 of the 4 signals point in the predicted direction (POV focus drops, length ratio drops, Elo delta improves directionally, qualitative reading is no-worse-than-baseline).
- [ ] **Stop and revert rubrics from snapshot** if 3+ of the 4 signals show no improvement or regression. Do not ship code changes on a refuted hypothesis.
- [ ] **Mixed signals** (2 indicators move, 2 don't): run another 5 runs to gather more evidence, OR proceed to Phase 2 if the qualitative spot-check is clearly better — the customPrompt change is independently motivated by the bloat pattern from R2A and may close the remaining gap.

**Statistical reality (corrected from prior version):**

Single-metric significance testing is **infeasible at the sample sizes available in this project**. With observed per-variant Elo stddev ≈ 864 (54 mu × 16), the standard error of the mean for n=95 variants is 864/√95 ≈ 88.5 Elo, giving a 95% CI half-width of roughly **±174 Elo**. To detect a +30 Elo improvement at 95% CI from a single t-test would require n ≈ 30,000 variants — wildly out of scope.

What this means in practice:
- **Don't read the post-edit mean Elo delta as a significance test.** A new mean of, say, -20 Elo (vs the -47 baseline) is consistent with anything from no-real-change to a large improvement — the noise floor is wider than the signal.
- **Use the multi-signal gate above instead.** The four signals are (mostly) independent; concordant movement across 3+ signals is much stronger evidence than any single mean shift.
- **The most decisive evidence is the qualitative reading.** Round 2 Agent A's analysis showed the failure pattern (bloat + meta-commentary + tone inflation) is recognizable on inspection. If the post-edit batch's worst variants no longer exhibit those patterns, that's stronger evidence than any mean.

### Phase 2: customPrompt length-preservation + seed script update (~2-3 hours)

Codifies the rubric fix into the seed script (so fresh installs get the corrected defaults) AND adds a length-preservation instruction to the customPrompt template (addresses the bloat amplifier).

**Code prerequisite (one-line refactor):**
- [x] **Export `buildCustomPromptFromSuggestions`** from `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts` so the new unit test can import it. Currently the function is module-internal; a `export function buildCustomPromptFromSuggestions(...)` change is needed before the test can be written. Verify nothing else breaks (it's called by the agent's `execute()` method only; export adds it to the module's public surface but doesn't change call sites).

**Code edits:**
- [x] Edit `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.ts:253-268` (`buildCustomPromptFromSuggestions`) — replace the trailing instruction with the proposed text in the "Proposed Code Changes" section below.
- [x] Edit `evolution/scripts/seedSampleCriteria.ts` lines 42-52 (engagement) and 86-96 (point_of_view) — update inline `SAMPLE_CRITERIA` array so future runs of `npm run seed:criteria` write the corrected rubrics. The script uses an **application-level skip-if-exists** pattern (pre-flight `select` + conditional `insert`, NOT a Postgres `ON CONFLICT` clause), so it won't overwrite the user-edited rows on staging/prod, which is correct.
- [x] **Prod parity note**: the seed script's skip-if-exists means prod will keep whatever rubrics were originally seeded there. If prod still has the OLD POV/engagement rubrics (because nobody admin-edited them on prod), Phase 1's edits don't reach prod automatically. After Phase 2 lands, manually mirror the admin-UI rubric edits on prod (same procedure as Phase 1: snapshot → drain in-flight → edit), or hard-delete the existing rows and re-run `npm run seed:criteria` to pick up the corrected defaults.

**Test additions (definitive — no conditional wording):**
- [x] **Add a new unit test** `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.test.ts` for `buildCustomPromptFromSuggestions` (function does not currently have test coverage and no snapshot exists today — verified via grep). Test must:
  - Pass a fixture with 2 suggestions (one each for two different criteria).
  - Assert the rendered prompt contains the new length-preservation directive verbatim: `"Preserve the original word count within ±10%"` and `"Do not introduce meta-commentary about the article itself"`.
  - Assert the suggestion blocks are correctly enumerated ("Issue 1 (...)", "Issue 2 (...)").
  - Assert the prompt structure (preamble, then issue blocks, then trailing instruction) is preserved.
- [x] Update `evolution/scripts/seedSampleCriteria.test.ts` (existing) — verify the updated `SAMPLE_CRITERIA` entries still pass `evolutionCriteriaInsertSchema.parse()` and the rubric in-range refinement (`evolution_criteria_rubric_anchors_in_range` validation).
- [x] Run `npm run lint && npm run tsc && npm run build && npm run test:unit -- --testPathPattern="evaluateCriteriaThenGenerate|seedSampleCriteria"`.

**Validation:**
- [ ] Drain in-flight criteria-driven runs (same query as Phase 1) before triggering new runs.
- [ ] Trigger 5 more fresh runs on staging using the same strategy. Compare against Phase 1's improved baseline using **both** mean Elo delta AND mean child/parent word-count ratio (the two KPIs together let us attribute improvement to the rubric fix vs the customPrompt fix).
- [ ] **Decision gate** (same multi-signal framework as Phase 1; single-metric significance still infeasible at n≈95):
  - If word-count ratio drops AND qualitative spot-check shows fewer bloat patterns AND mean Elo delta improves directionally OR holds steady: customPrompt change is contributing — keep it and proceed to Phase 3.
  - If word-count ratio drops but Elo delta is flat: customPrompt is reducing bloat without affecting Elo (acceptable — bloat-reduction is a defensible win on its own; ship it).
  - If neither word-count ratio nor Elo delta move: `git revert` the customPrompt change and ship Phase 1 only.
  - If mean delta REGRESSES (qualitative reading also worse): the ±10% directive is over-constraining. Revert and replace with the **pre-committed softer fallback**: `'Rewrite the article addressing each issue. Address each fix as concisely as possible — refactor or deepen existing passages rather than adding new sections. Do not introduce meta-commentary about the article itself.'` (Drops the ±10% cap; keeps the no-new-sections + no-meta-commentary directives that target the observed worst-case patterns.)

### Phase 3: Diversify test set + decide on long-term scope (~variable)

The investigation's biggest weakness was sampling: 1 prompt (Federal Reserve, highly factual). Before declaring victory, validate on more diverse prompts. Also a chance to decide if the criteria system needs an article-type field (so opinion content can use the original POV/engagement rubrics).

- [ ] User picks 2-3 additional prompts from the existing prompt library covering different content types (e.g., 1 opinion/editorial, 1 explainer/how-to, 1 narrative).
- [ ] Run the same strategy against each prompt; compare deltas across prompts.
- [ ] If criteria_driven now performs comparably to reflection on educational prompts AND on the opinion/explainer prompts, no further work is needed.
- [ ] If POV/engagement seem helpful for opinion content but the new rubrics dampen that benefit, open a follow-up project to add an article-type field to `evolution_criteria` (or split the seeded criteria into two sets: "educational" and "opinion").
- [ ] Document findings inline in `_research.md` and close this project.

## Proposed Rubric Replacements

### `point_of_view` (current → proposed)

| | Current (Wikipedia-pejorative) | Proposed (voice + framing) |
|--|--|--|
| Description | Whether the article takes a clear stance or perspective rather than enumerating facts neutrally. | Clarity of authorial voice and pedagogical framing — does the reader understand who is explaining this and why each section is included? |
| Score 1 | Pure enumeration; no perspective; reads like a Wikipedia summary. | No discernible voice; the article reads like disconnected facts with no guiding intent. |
| Score 5 | Implicit perspective; takes occasional positions but mostly neutral. | Voice is present but inconsistent; the framing of why-this-matters appears in some sections and is missing in others. |
| Score 10 | Clear thesis or perspective; the article argues for something specific. | Strong, consistent authorial voice; the reader always understands the framing and why each section is included. |

The new version DOESN'T penalize neutral encyclopedic writing — an educational article can score 10 if its "let me carefully walk you through this" voice is consistent.

### `engagement` (current → proposed)

| | Current (page-turner) | Proposed (logical pacing) |
|--|--|--|
| Description | How well the article holds reader attention from start to finish. | Logical pacing and example sequencing — does the reader feel guided from one idea to the next, with examples that build understanding? |
| Score 1 | No hook; reader bounces in the first paragraph. | Examples appear randomly or as bullet-list filler; transitions between concepts are abrupt or absent. |
| Score 5 | Mild interest; pacing flat or uneven. | Examples are present and mostly relevant, but transitions feel mechanical and pacing is uneven. |
| Score 10 | Compelling throughout; reader can't stop until the end. | Each example builds on the last; transitions feel inevitable; pacing matches the cognitive load of the material. |

The new version anchors on structure-of-explanation, not entertainment value.

## Proposed Code Changes

### `evaluateCriteriaThenGenerateFromPreviousArticle.ts:253-268`

Currently the trailing instruction in `buildCustomPromptFromSuggestions`:

```typescript
instructionLines.push('');
instructionLines.push('Rewrite the article addressing each issue while preserving its overall intent and structure.');
```

Proposed replacement:

```typescript
instructionLines.push('');
instructionLines.push(
  'Rewrite the article addressing each issue. Preserve the original word count within ±10% — refactor or deepen existing passages rather than adding new sections or examples. Do not introduce meta-commentary about the article itself.',
);
```

The three sub-instructions target the three concrete bloat patterns we observed in the worst-case variants: (a) bolting on new sections (Pair 1 in Round 2A had a "### An Examination of the Fed's Efficacy and Structure" appended at the end), (b) tone inflation via ornamental adjectives (Pair 2 had every clause dressed with "crucial / profound / sophisticated"), and (c) self-referential meta-commentary ("This detailed exploration of the Federal Reserve's history... prompts a critical inquiry").

### `evolution/scripts/seedSampleCriteria.ts`

Replace the inline `evaluation_guidance` arrays for `point_of_view` (lines 86-96) and `engagement` (lines 42-52) with the new anchors above.

## Testing

### Unit Tests

- [x] `evolution/src/lib/core/agents/evaluateCriteriaThenGenerateFromPreviousArticle.test.ts` — **add** a new test for `buildCustomPromptFromSuggestions` (function currently has no coverage; export it from the agent module first per Phase 2 prerequisite). Assert the rendered prompt contains the new length-preservation directive verbatim and that suggestion blocks are correctly enumerated.
- [x] `evolution/scripts/seedSampleCriteria.test.ts` — verify updated `SAMPLE_CRITERIA` entries pass `evolutionCriteriaInsertSchema.parse()` and the rubric in-range refinement (`evolution_criteria_rubric_anchors_in_range`).

### Integration Tests

- [x] None planned. Existing `evolution-criteria-pipeline.integration.test.ts` should continue to pass; rubric content isn't asserted at integration level.

### E2E Tests

- [x] None planned. The rubric edits are content changes; no UI behavior changes.

### Manual Verification

- [x] Phase 1: ≥5 staging runs against same Fed prompt with edited rubrics; evaluate the 4 signals (POV focus, length ratio, mean delta, qualitative spot-check) against the Phase 1 multi-signal gate.
- [ ] Phase 2: ≥5 more runs after the customPrompt code change; evaluate the same 4 signals against Phase 1's improved baseline.
- [ ] Phase 3: ≥3 runs on each of 2-3 non-Fed prompts to validate generalization.
- [x] Pre-Phase-1 prerequisite: verify `_research.md` contains the "Phase 1 Pre-Edit Snapshot" section (rollback insurance) before clicking Save in admin UI.

## Verification

### A) Playwright Verification (required for UI changes)

- [x] Not required — no UI changes. Rubric edits go through the existing `/admin/evolution/criteria` edit dialog (no schema change).

### B) Automated Tests

- [x] `npm run lint && npm run tsc && npm run build` — clean.
- [x] `npm run test:unit -- --testPathPattern="evaluateCriteriaThenGenerate|seedSampleCriteria"` — passes (covers Phase 2 changes).
- [x] **No CI workflow changes required** — this is a content + small code change against existing test infrastructure. No new env vars, secrets, or pipeline jobs.

## Documentation Updates

- [x] `evolution/scripts/seedSampleCriteria.ts` header comment — note that the `point_of_view` + `engagement` rubrics were revised on 2026-05-03 based on the criteria-agent performance investigation.
- [x] `evolution/docs/agents/overview.md` — under the `EvaluateCriteriaThenGenerateFromPreviousArticleAgent` section, add a note about the customPrompt's length-preservation directive.
- [ ] (Optional) `evolution/docs/curriculum.md` glossary entry for "Criteria" — clarify that rubric design strongly affects performance and reference this investigation as a worked example.

## Review & Discussion

### `/plan-review` consensus reached after 3 iterations (2026-05-03)

| Perspective | Iter 1 | Iter 2 | Iter 3 |
|-------------|:------:|:------:|:------:|
| Security & Technical | 4/5 | **5/5** | — |
| Architecture & Integration | 4/5 | **5/5** | — |
| Testing & CI/CD | 3/5 | 4/5 | **5/5** |

**Iteration 1 → 2 fixes:**
- [Architecture] Phase 2 prerequisite added: export `buildCustomPromptFromSuggestions` from the agent module before adding the new test (function is currently module-internal at line 253).
- [Architecture] Test instruction made definitive ("**add** a new test") rather than conditional ("if exists, update; else add"). Verified via grep that no test exists today.
- [Testing] Phase 1 sample size raised from 2-3 runs to ≥5 runs (~95 child variants, matching the original investigation baseline).
- [Testing] 3-way decision gate added (strong improvement / partial improvement / no improvement) with explicit handling for each case.
- [Testing] Pre-edit snapshot step added: append the current rubric anchors to `_research.md` as authoritative undo source before clicking Save in admin UI.
- [Security] In-flight-run drain step added with concrete query (otherwise rubric edits during in-flight runs contaminate the baseline).
- [Security] "ON CONFLICT (name) DO NOTHING" wording corrected to "application-level skip-if-exists" (the seed script uses pre-flight SELECT + conditional INSERT, not Postgres ON CONFLICT).
- [Security] Prod parity gap noted: skip-if-exists means seed script won't update existing prod rows; Phase 1 admin-UI edits must be manually mirrored on prod, OR rows hard-deleted + re-seeded.
- [Security] POV line range corrected (87-96 → 86-96).
- [Security] Admin-auth gating noted (`updateCriteriaAction` requires authenticated admin session cookie).
- [Security] Word-count delta added as a co-equal KPI alongside Elo delta.

**Iteration 2 → 3 fixes:**
- [Testing] Statistical caveat corrected (was "±9 Elo at 95% CI", off by ~20× given observed stddev ≈864 Elo per variant; correct figure is ~±174 Elo). Decision gates reframed from single-metric significance tests to **multi-signal directional judgments** based on 4 independent signals: per-criterion focus shift, length ratio, mean Elo delta, qualitative spot-check.
- [Testing] Manual Verification section reconciled with Phase 1's ≥5-run requirement (was inconsistently "2-3 runs").
- [Testing] Phase 2 fallback phrasing pre-committed verbatim (was "softer directive" without specifics).
- [Testing] Snapshot-verification checkbox added to Manual Verification.
- [Architecture] POV line-range inconsistency tightened (Code Edits and Proposed Code Changes sections both say 86-96 now).

**Outstanding minor issues** (non-blocking, can be addressed at execution time):
- The "~30,000 variants" figure in the Statistical reality block is order-of-magnitude — exact n depends on test framing (one-sample CI half-width vs two-sample power calc). The qualitative claim ("wildly out of scope") stands.
- Signal 1's "small-sample-robust because deterministic given temperature=0" assumes the judge model is actually called at temp=0; worth a one-line verification before relying on it.
- Phase 2 word-count-ratio decision gate uses qualitative language ("drops") without a numeric threshold; could harden to e.g. "≤1.05" if execution requires sharper gating.
