# Evaluate Implied Rubric Results and Experimentally Validate Plan

## Background

Experimentally validate how implied rubric results are driven by the underlying wholistic prompts.

The Implicit Rubric Weights tool currently infers per-criterion weights from pairwise verdicts produced by both a holistic prompt (`buildComparisonPrompt`) and a per-criterion rubric prompt (`buildRubricComparisonPrompt`). The holistic prompt hardcodes a generic 5-item checklist (`clarity and readability, structure and flow, engagement and impact, grammar and style, overall effectiveness`) that has zero relationship to the user-chosen session criteria. We observed in staging that the fitted weights track which session criteria happen to overlap with that hardcoded checklist (clarity + tone dominate; depth has no holistic-prompt channel and gets zeroed out on **both** baseline runs at T=0 and T=1). This project runs a controlled experiment to disentangle "what the model intrinsically cares about" from "what the holistic-prompt checklist primes it for."

## Requirements (from GH Issue #1274)

Experimentally validate how implied rubric results are driven by the underlying wholistic prompts.

## Problem

The fitted weights from the current implied-rubric tool are inseparable from the holistic prompt's hardcoded checklist. The same model on the same article pair produces a `disagreesWithOverall` zeroing-out for any session criterion that is absent from the holistic prompt's checklist (depth, in the baseline data), and amplifies criteria that overlap (clarity, tone). Without varying the holistic prompt, we cannot distinguish "the model doesn't care about depth" from "the model's holistic ranking was primed to ignore depth." Until that ambiguity is resolved, exported judge rubrics from this tool inherit the priming and may not reflect what the model would prefer absent the holistic-prompt scaffolding.

## Options Considered

- [x] **Option A: 4-arm controlled experiment (CHOSEN)** — Run new weight-inference sessions on the SAME test set + criteria + model as the baseline, varying only the holistic prompt's checklist (Stripped / Aligned / Inverted vs the existing Control). Compare weight vectors + per-pair holistic-verdict flip rates across arms. Lets us causally attribute the priming effect, and reuses every persistent table + the fit/CI/audit code unchanged.
- [x] **Option B: Re-fit Arm A data with a different fit math (rejected)** — Doesn't address the question; the priming is at the verdict layer, not the fit layer.
- [x] **Option C: Soft "intrinsic weights" prior (rejected)** — Adding a Bayesian prior that nudges weights toward equality across criteria might mask the priming without actually measuring it. We want the measurement first.
- [x] **Option D: Switch holistic prompt to a per-session rubric and ship (rejected as first step)** — Premature. If the experiment shows priming is small (Option A's first outcome), shipping a redesigned holistic prompt is unnecessary churn. Decide after data lands.

## Phased Execution Plan

### Phase 1: Plumbing — `holistic_prompt_override` on weight-inference sessions

Smallest viable change to let a session carry a custom holistic prompt without touching the per-criterion path.

**Why this only affects the holistic prompt:** `buildRubricComparisonPrompt` (the per-criterion path in `evolution/src/lib/shared/rubricJudge.ts:284`) is byte-identical across arms in article mode — its `priorPicks` / `nextContext` / `originalParagraph` / `targetStyleProse` params all gate on `isParagraphMode`. So the per-criterion verdicts the fit uses as features are invariant across arms; only the **overall verdict** (the label) shifts. Clean experimental isolation, no new confound (research Finding 2).

- [x] Add migration `supabase/migrations/20260624173001_evolution_weight_inference_holistic_override.sql`:
  - `ALTER TABLE evolution_weight_inference_sessions ADD COLUMN IF NOT EXISTS holistic_prompt_override TEXT;`
  - Default NULL → byte-identical to current behavior (back-compat).
  - Length check: `CONSTRAINT evolution_wi_sessions_holistic_override_len CHECK (char_length(holistic_prompt_override) <= 8000)` (matches sandbox's existing rubric-block limit).
  - Idempotent guards required by `lint-migrations-idempotent` (`ADD COLUMN IF NOT EXISTS`; `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`).
- [x] Update Zod schema `evolutionWiSessionInsertSchema` in `evolution/src/lib/schemas.ts` to include the optional `holistic_prompt_override` field.
- [x] Update `createWeightInferenceSessionAction` in `evolution/src/services/weightInferenceActions.ts` to accept + persist the override.
- [x] **Seam location (research Finding 1):** the actual injection point is `judgePairOnce` in `evolution/src/lib/weightInference/autoJudge.ts:69`, NOT `buildComparisonPrompt`. Today `judgePairOnce` calls `buildComparisonPrompt(textA, textB, mode)` inline with no override. Extend it:
  - Add 7th param `holisticOverride?: string` to the `judgePairOnce` signature.
  - Forward inside `buildPrompts: () => ({ forward: buildComparisonPrompt(textA, textB, mode, holisticOverride), reverse: buildComparisonPrompt(textB, textA, mode, holisticOverride) })`.
  - `buildComparisonPrompt`'s 4th arg (`customPromptOverride`) already exists for the rejudge sandbox — destination unchanged. Total surface ~6 LOC across 2 files.
- [x] Update `runAutoChunk` in `evolution/src/lib/weightInference/autoRun.ts`:
  - Add `holistic_prompt_override` to the SessionRow `select(...)` and the `SessionRow` interface (autoRun.ts:33-40, 56-67).
  - Capture once into a `holisticOverride: string | undefined` constant after the session load.
  - Pass to `judgePairOnce(judge, textA, textB, rubric, pairAcc, session.pair_kind, holisticOverride)` in `judgeOne` (autoRun.ts:167).

```typescript
// autoJudge.ts (sketch)
export async function judgePairOnce(
  judge: JudgeText,
  textA: string,
  textB: string,
  rubric: ResolvedJudgeRubric,
  costAcc: { usd: number },
  mode: ComparisonMode = 'article',
  holisticOverride?: string,  // NEW
): Promise<SinglePairResult> {
  // ...
  const overallRes = await run2PassReversal<string | null, ComparisonResult>({
    buildPrompts: () => ({
      forward: buildComparisonPrompt(textA, textB, mode, holisticOverride),
      reverse: buildComparisonPrompt(textB, textA, mode, holisticOverride),
    }),
    // ...
  });
  // ...
}
```

- [x] **Verdict-instruction contract — DO NOT reuse `buildSandboxComparisonPrompt` (corrected after Iteration 1 review).** When `customPromptOverride` is non-empty AND `explainReasoning=false`, the sandbox builder emits a *reasoning-tolerant* tail ("You may include reasoning. End your response with a final line containing exactly one of: 'Your answer: A'..."). That tail is designed for the rejudge sandbox's `parseVerdictFromReasoning` scanner. But `judgePairOnce` uses the strict `parseWinner` (start-anchored, bare-substring-prone) — a multi-sentence model response would mis-route or null-out. **Fix:** add a new 6th param `strictVerdictTail?: boolean` to `buildComparisonPrompt` (and forward to `buildSandboxComparisonPrompt`) so the auto-mode override path can emit the strict "Respond with ONLY one of A/B/TIE" tail even when `customPromptOverride` is set. `judgePairOnce` passes `strictVerdictTail: true` whenever it passes the override. The rejudge sandbox (`rejudgeComparisonAction`) is unchanged — it continues to omit the new param, preserving its reasoning-tolerant default.
- [x] **Override content sanitization (Zod, Iteration 1 fix).** Add a regex deny-list to the `holistic_prompt_override` field in `evolutionWiSessionInsertSchema` rejecting any string that contains `## Text A`, `## Text B`, `Your answer:`, or `<\|` / `\|>` (anti-jailbreak). Operators rarely intend these substrings in a rubric block; allowing them risks pre-positioning fake A/B text bodies before `parseWinner` sees the real ones. Zod rejection with a clear error: `"holistic_prompt_override may not contain reserved markers (## Text A/B, Your answer:, <|, |>)"`.
- [x] **Kill-switch env var (Iteration 1 fix).** `runAutoChunk` consults `EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED`. When `'true'`, treat the session's `holistic_prompt_override` as `null` (warn-log once per chunk). Provides an instant rollback path if the Phase 1 plumbing surfaces a regression after deploy — no migration revert needed.
- [x] **Cost-cap math (research Finding 4 + Iteration 1 sharpening):** replace `HOLISTIC_PROMPT_OVERHEAD_CHARS = 700` in `estimateAutoRunCost` with `Math.max(700, override?.length ?? 0)` so the form's $ projection matches reality when the operator supplies a long override. The pre-flight $5 cap remains conservative even at the 8000-char DB max (~$0.10/arm worst-case).
- [x] Unit tests `evolution/src/lib/weightInference/autoJudge.test.ts`:
  - Default behavior (no override) → byte-identical prompt to pre-Phase-1 (also guards the default `strictVerdictTail=false` rejudge-sandbox path from silent regression).
  - Override set → checklist replaced, **strict "Respond with ONLY one of A/B/TIE" tail emitted (NOT the reasoning-tolerant "Your answer:" tail from `buildSandboxComparisonPrompt`)**, `parseWinner` resolves A/B/TIE on a single-token mock response.
  - Forward + reverse prompts both receive the override (regression guard against the override accidentally being passed to only one pass).
  - Zod deny-list (literal case-sensitive match) rejects `## Text A` / `## Text B` / `Your answer:` / `<|` / `|>` substrings.

  (The `EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED` kill-switch assertion lives in `autoRun.test.ts`, NOT here — the env var is consulted in `runAutoChunk`, not in `judgePairOnce`.)

### Phase 2: Define the 4 arms — frozen prompt strings

Commit prompt strings as constants for reproducibility. Lives at `evolution/src/lib/weightInference/experimentArms.ts`.

**Granularity discipline (research Finding 3):** the per-criterion rubric prompt renders each dimension as `${i+1}. ${name}: ${description}` plus Excellent/Adequate/Weak tier anchors from `evaluation_guidance`. If Arm C's override only listed criterion NAMES, the holistic prompt would be semantically narrower than the per-criterion prompt and the "alignment" wouldn't really be aligned. Arm C therefore includes the criterion **description** (matching the rubric prompt's `${name}: ${description}` line) but NOT the tier anchors (they'd bloat the holistic prompt and risk breaking the verdict-instruction tail).

- [x] **Arm A — Control.** `null` (= current hardcoded behavior). Reuses existing baseline data.
- [x] **Arm B — Stripped.** Override:
  ```
  ## Evaluation
  Decide which version is better overall. Differences are often small — answer TIE only if the two are genuinely indistinguishable in quality.
  ```
- [x] **Arm C — Aligned.** Override mirrors the 5 session criteria verbatim, **with descriptions**:
  ```
  ## Evaluation Criteria
  Consider the following when making your decision:
  - sentence_variety: Variation in sentence length and structure across paragraphs to maintain rhythm.
  - tone: Voice and register; consistency with the article's intent (educational, persuasive, etc.).
  - depth: Quality of detail, technical accuracy, and explanation of mechanisms.
  - structure: Logical flow between sections, paragraph organization, and transitions.
  - clarity: How easy the article is to read for the target audience.
  ```
- [x] **Arm D — Inverted (optional).** Override deliberately omits clarity, amplifies depth/structure:
  ```
  ## Evaluation Criteria
  Consider the following when making your decision:
  - Depth — quality of detail, technical accuracy, and explanation of mechanisms
  - Structure — logical flow between sections, paragraph organization, and transitions
  - Technical accuracy — claims are grounded and verifiable
  - Factual precision — specific numbers/dates/mechanisms are correct
  - Completeness — covers the question without leaving load-bearing gaps
  ```
- [x] **Static / hard-coded:** prompt strings exported as `const` so two `experimentArms[arm]` lookups produce byte-identical strings.
- [x] **Hash registry (Iteration 1 fix — versioning).** Instead of one canonical hash per arm, export `ACCEPTED_HASHES: Record<ArmKey, string[]>` — an array of SHA-256 hashes that have ever been valid for each arm. A typo fix in the prompt string appends a new entry; old entries stay in the array so historical sessions still verify. New runs are gated on the FIRST entry (current canonical); historical sessions match against any entry. This avoids orphaning prior arm-runs when an operator notices a typo and patches `experimentArms.ts`.
- [x] Unit test `experimentArms.test.ts`:
  - Each non-null arm prompt is < 8000 chars (the DB CHECK constraint).
  - Each non-null arm prompt passes the Zod deny-list (does NOT contain `## Text A`, `## Text B`, `Your answer:`, `<|`, `|>`).
  - Composing each with `buildComparisonPrompt(strictVerdictTail=true)` produces output containing the override verbatim AND the strict `Respond with ONLY one of: "A"/"B"/"TIE"` tail.
  - SHA-256 of each arm's current prompt is the FIRST entry of `ACCEPTED_HASHES[arm]` (regression guard against silent prompt edits without appending to the registry).

### Phase 3: UI exposure + run the experiment on staging

**UI exposure (research Finding 5 + Iteration 1 fix for paste-mismatch):** add a "Custom holistic prompt" textarea inside the auto-mode block of the create-session form, fronted by an **Arm preset dropdown** that auto-fills the textarea from the canonical `experimentArms.ts` constants. Eliminates the paste-mismatch risk where an operator copying a string from source into the form introduces trailing-whitespace / smart-quote drift that breaks Phase 4's hash gate. Wrap the whole block in a `<details>` "Advanced" disclosure. ~40 LOC.

- [x] Add state to `WeightInferencePage`:
  ```typescript
  const [holisticPromptOverride, setHolisticPromptOverride] = useState('');
  const [armPreset, setArmPreset] = useState<'' | 'B' | 'C' | 'D'>('');
  ```
- [x] Inside the existing auto-mode block (page.tsx:277-294), append:
  ```tsx
  <details className="md:col-span-3" data-testid="wi-advanced">
    <summary className="font-ui text-sm text-[var(--text-secondary)] cursor-pointer">
      Advanced — custom holistic prompt (experiments)
    </summary>
    <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
      <select
        data-testid="wi-arm-preset"
        className={inputCls}
        value={armPreset}
        onChange={(e) => {
          const arm = e.target.value as '' | 'B' | 'C' | 'D';
          setArmPreset(arm);
          // Auto-fill from canonical experimentArms.ts (NOT operator typing). Preserves
          // byte-identical match for Phase 4's SHA-256 hash gate.
          setHolisticPromptOverride(arm ? EXPERIMENT_ARMS[arm].prompt : '');
        }}
      >
        <option value="">— No preset (free-form) —</option>
        <option value="B">Arm B — Stripped</option>
        <option value="C">Arm C — Aligned</option>
        <option value="D">Arm D — Inverted</option>
      </select>
    </div>
    <textarea
      id="wi-holistic-override"
      data-testid="wi-holistic-override"
      className={`${inputCls} mt-2`}
      rows={8}
      maxLength={8000}
      placeholder="Leave blank to use the default holistic prompt."
      value={holisticPromptOverride}
      onChange={(e) => {
        // If operator edits after picking a preset, clear the preset selector so the
        // dropdown can't lie about what's actually in the textarea. Phase 4's hash-verify
        // will then treat the submission as free-form (and reject unless the manual edits
        // happen to hash to a registered ACCEPTED_HASHES entry).
        if (armPreset) setArmPreset('');
        setHolisticPromptOverride(e.target.value);
      }}
    />
  </details>
  ```
- [x] Forward in the `create()` call: `holistic_prompt_override: holisticPromptOverride.trim() || null`.
- [x] **`listWeightInferenceSessionsAction`** (`evolution/src/services/weightInferenceActions.ts:557` — Iteration 1 minor): augment the SELECT to include `holistic_prompt_override IS NOT NULL AS has_override` and surface a "custom" badge in the sessions-list table column. Cheap to add, makes the experiment sessions instantly identifiable in the list view.
- [x] **Session-detail Results tab indicator:** in `[sessionId]/page.tsx`, when `session.holistic_prompt_override` is non-null, render a small "Custom holistic prompt in use" badge near the Run banner with a click-to-expand showing the override + the matched arm name (if any). ~10 LOC.

**Run config:**

- [x] **Test set.** `judge_eval_test_sets.id = 9acb42f5-fa9b-4ce8-b053-431fbe01e026` (same as the baseline). `source_kind='test_set'`, `pair_kind='article'`.
- [x] **Model.** `judge_model='google/gemini-2.5-flash-lite'`, `judge_temperature=0`, `auto_repeats=3` (within-arm self-consistency from cross-repeat agreement; human-mode `replication_rate` is hardcoded `0` for auto sessions).
- [x] **Sample size.** N=30 pairs (test set is frozen; research Finding — expanding the test set would be a separate Judge Lab project). `auto_repeats=3` is the new lever: cross-repeat agreement gives per-pair confidence absent from the baseline N=30/repeats=1 sessions, which should tighten the tone↔clarity ordering signal.
- [x] **Chunking (research Finding 7):** `WEIGHT_INFERENCE_AUTO_CHUNK_PAIRS=40` default ≥ 30, so each arm's run completes in one POST to `/api/evolution/weight-inference/auto-run`. No multi-chunk concerns.
- [x] Create sessions named:
  - `[ARM-B] Stripped holistic 20260623`
  - `[ARM-C] Aligned holistic 20260623`
  - `[ARM-D] Inverted holistic 20260623` (optional — start with B+C, add D only if results are ambiguous or to sharpen a borderline reading)
- [x] Verify pre-flight cost cap (research Finding 8). Auto-mode's `plannedCalls = pairs × repeats × 4` → 30 × 3 × 4 = 360 calls per arm. At `google/gemini-2.5-flash-lite` (~$0.0001/call after the D5 `max_tokens=4096` cap) → ~$0.04/arm. Total 3-arm cost ≈ $0.12, well under the $5 per-session cap (`WEIGHT_INFERENCE_AUTO_MAX_USD`) and the $25 evolution daily cap.
- [x] Trigger each arm's run via the existing "Run" button on `/admin/evolution/weight-inference/[sessionId]` and let it complete. Each arm ~3-5 minutes wall-clock at gemini-flash-lite latency.

### Phase 4: Analysis script — quantify the priming effect

**Why a standalone script, not a UI page (research Finding 6):** the codebase has no cross-session comparison UI today. Prompt Editor (`/admin/evolution/prompt-editor`) is the architectural analog (multi-config side-by-side) and Judge Lab leaderboard shows runs-per-test-set, but neither does "compare these N sessions' fitted weights." Building one for this experiment is project-scope creep — defer to a follow-up project if cross-session comparison becomes a recurring need. For this project, a standalone script that outputs a markdown table is the right cost/value.

Reuses the script pattern from the baseline analysis. Lives at `evolution/scripts/_wi_arm_comparison.ts` (kept for reproducibility; not committed long-term — `_` prefix mirrors the baseline `_wi_consistency_analysis.ts`).

- [ ] Load all 4 arms' (3 new + 1 baseline-derived "Arm A") comparisons + dimension verdicts via `query:staging` (read-only).
- [ ] Group sessions by arm using a strict name-regex on `^\\[ARM-([BCD])\\] (Stripped|Aligned|Inverted) holistic 20260623$`. Any session matching `[ARM-...]` but not the strict format is rejected with a hard error (defense against operator typo like `[ARM B]` silently excluding a session).
- [ ] **Hash-verify each arm's `holistic_prompt_override` against `ACCEPTED_HASHES[arm]` in `experimentArms.ts`** (defense against operator typo / paste error). Refuse to compute fits for any arm whose persisted override hash doesn't match ANY entry in the registry array. Arm A's "canonical override" is the literal hardcoded checklist string from `computeRatings.ts:509-515` (NULL override = canonical hardcoded path); the script must reconstruct the canonical string and hash it the same way for Arm A's comparison.
- [ ] **Test-set frozenness invariant (Iteration 1 fix).** Before computing fits, the script must verify the resolved pair set is identical across all arms — for each arm, sort the per-session `(article_a_id, article_b_id)` canonical pairs and SHA-256 the joined string. If any two arms' pair-set hashes differ, abort with `"test-set pair set drifted between arms — cross-arm comparison invalid"`. This catches the failure mode where `judge_eval_test_sets.id=9acb42f5…` was mutated between arm runs (`pair_bank_id`'s `pairs` JSONB edited, or `judge_eval_test_set_members` rows added/removed). The article CONTENT is independently snapshotted into `evolution_weight_inference_articles` per session — only the PAIR IDENTITIES need cross-arm consistency.
- [ ] For each arm: compute `fitWeights` + `weightCIs` using the existing `@evolution/lib/weightInference` exports (same as the baseline analysis script).
- [ ] Cross-arm pairwise metrics (matrix indexed by arm × arm):
  - Per-pair holistic-verdict flip rate (same model, same article pair, different checklist).
  - Per-pair per-criterion verdict agreement (should be near-identical across arms — research Finding 2 — and any large deviation is a red flag of unintended bleed).
  - L1 / cosine / Spearman rank correlation on weight vectors.
  - Top-criterion agreement.
  - Position-bias rate per arm (from `forward_winner` / `reverse_winner`).
- [ ] Output as a JSON report saved to `docs/analysis/wi_holistic_prompt_priming/wi_arm_comparison_results.json` plus a markdown table embedded in the analysis report (Phase 6). **Use a stable JSON serializer** — sort object keys alphabetically, fix array order to match arm enumeration A/B/C/D — so re-running the script on identical data produces byte-identical output (lets `git diff` confirm reproducibility cheaply).

### Phase 5: Decision rule + reporting

- [ ] Apply the pre-registered rule: **priming is real** if Control vs Stripped flip rate > 15% **OR** weight-vector L1 > 0.3 with non-overlapping CIs on the top-2 criteria.
- [ ] Map outcome to one of 5 readings (see research doc's outcome table) and document the matched reading in the analysis report.
- [ ] If the outcome is "B ≈ C, both differ from A" (the production-fix outcome), open a follow-up project to redesign the holistic prompt → strip-and-align by default for new sessions.
- [ ] If the outcome is degenerate (Arm B kills the holistic signal), document the finding and DO NOT recommend dropping the checklist — instead recommend "Aligned by default" if Arm C looks stable.

### Phase 6: Promote findings to `/docs/analysis/`

Reuses the existing `/analysis` skill pattern. The research doc is the source; the analysis report is the durable, reproducible artifact.

- [ ] Create `docs/analysis/wi_holistic_prompt_priming/README.md` with:
  - Setup table (sessions per arm, model, sample size, prompt strings as fenced code blocks).
  - Results table (weights + CIs per arm).
  - Cross-arm flip-rate matrix.
  - Outcome reading and decision.
  - Exact SQL + script used to reproduce.
- [ ] Append the analysis path to `_status.json.analyses` (per the field's documented behavior in `/initialize`).

## Testing

### Unit Tests
- [x] `evolution/src/lib/weightInference/autoJudge.test.ts` — extend to assert (a) default behavior (no override) is byte-identical to pre-Phase-1 (regression guard); (b) override flows through `judgePairOnce` → both forward + reverse passes of `buildComparisonPrompt`; (c) verdict-instruction tail (`Your answer:`) is preserved; (d) `parseWinner` still resolves A/B/TIE on a mocked LLM response.
- [x] `evolution/src/lib/weightInference/experimentArms.test.ts` — assert each non-null arm prompt is < 8000 chars; composing with `buildComparisonPrompt` includes the override verbatim AND the `Your answer:` tail; SHA-256 hashes match snapshot (regression guard against silent prompt edits — important because the hash is the operator-error gate in Phase 4).
- [x] `evolution/src/lib/weightInference/autoRun.test.ts` — **create new** (Iteration 1: was wrongly listed as "extend"; the file does not exist today). Cover (a) `session.holistic_prompt_override` from the loaded SessionRow is forwarded to every `judgePairOnce` call within a chunk; (b) null override behaves identically to pre-Phase-1; (c) `EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED=true` causes the override to be ignored even when persisted, with a single warn-log per chunk; (d) `foldRepeats` cross-repeat-agreement confidence flows correctly into the persisted `confidence` column when `auto_repeats=3` (new behavior not exercised by the baseline `repeats=1` sessions).
- [x] `evolution/src/services/weightInferenceActions.test.ts` — extend to assert `createWeightInferenceSessionAction` persists `holistic_prompt_override`, rejects strings > 8000 chars via Zod with a clear error, and accepts `null` / undefined / empty-string as "use default."

### Integration Tests
- [x] `src/__tests__/integration/evolution-weight-inference-holistic-override.integration.test.ts` — create a session with override → run mocked auto-judge → assert the override appeared in the LLM call's prompt + the session row carries it back on `getWeightInferenceFitAction`. Mocks `callLLM` end-to-end so no real LLM cost.

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-admin/admin-evolution-weight-inference-holistic-override.spec.ts` — verify (a) create-session UI's `<details data-testid="wi-advanced">` collapses by default and reveals the `wi-holistic-override` textarea on click (Rule 18: wait for `wi-advanced` visibility before clicking summary); (b) submitting with an override populates the form payload; (c) the Results tab for a session with an override renders the "Custom holistic prompt in use" badge near the Run banner; (d) sessions without an override render no badge; (e) **Arm-preset dropdown auto-fill** — picking `wi-arm-preset` value `"B"` writes the canonical Arm B prompt string verbatim into the textarea (assert `await expect(textarea).toHaveValue(EXPERIMENT_ARMS.B.prompt)`); (f) **operator-edit-after-preset path** — picking Arm B then typing into the textarea resets `wi-arm-preset` to `""` (so the dropdown can't lie about what's persisted). Route-mock the POST (no test-data-factory import → no afterAll cleanup needed). `{ tag: '@evolution' }`.

### Manual Verification
- [x] After Phase 3 runs complete, visually compare weight vectors across the 3 (or 4) arms on the Results tab. Confirm the analysis script's numbers match the UI.
- [x] Spot-check 3 random pairs across arms: confirm that for pairs where Control and Stripped disagree on the overall verdict, the model's behavior is consistent with the change in priming (the holistic call should shift in the direction the override emphasizes).

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Run `npm run test:e2e:evolution -- --grep "weight-inference-holistic-override"` against the local server via `ensure-server.sh`. The new spec must follow Rule 18 (wait for hydration proof: wait for `wi-advanced` visibility before clicking summary).

### B) /finalize check parity (Iteration 1 fix — full coverage)

Per testing_overview.md, evolution/ + supabase/migrations/** changes require the full check suite. Cross-referenced one-to-one with the "Check Parity: Local vs CI" table:

- [x] `npm run lint` — ESLint including `flakiness/*` rules.
- [x] `npm run typecheck` — tsc strict mode.
- [x] `npm run build` — Next.js production build.
- [x] `npm test` — full unit test suite (not just changed files — local pre-PR).
- [x] `npm run test:esm` — Node native test runner (1 file).
- [x] `npm run test:integration` — all integration tests (including the new `evolution-weight-inference-holistic-override`).
- [x] `npm run test:e2e:critical` — `@critical` tagged E2E (~18 tests).
- [x] `npm run test:e2e:evolution` — `@evolution` tagged E2E (~45 tests, includes the new spec).
- [x] `npm run migration:verify` — ephemeral Docker postgres applies all migrations. **Prerequisite:** Docker installed (see CLAUDE.md). When Docker is genuinely unavailable, `MIGRATION_VERIFY_SKIP=true` bypasses as last resort.
- [x] `npm run lint:migrations` — confirms `20260624173001` is idempotent (`ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT`).
- [x] `npm run check:llm-coverage` — verifies the new `experimentArms.ts` constants don't introduce a direct LLM call without a registered `call_source`. (Spoiler: it shouldn't — the file is prompt-string constants only — but the CI guard runs anyway.)

### C) Production rollback path

- [x] **Phase 1 plumbing rollback:** flip `EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED=true` in Vercel/staging env vars. `runAutoChunk` immediately ignores any persisted override and uses the default hardcoded checklist for new chunks. Zero-deploy revert.
- [x] **Schema rollback:** the migration is additive (`ADD COLUMN IF NOT EXISTS holistic_prompt_override TEXT` with NULL default). Schema rollback is `ALTER TABLE ... DROP COLUMN IF EXISTS holistic_prompt_override` if absolutely needed, but more typically the column stays and stale data is just ignored. No data loss either way (existing sessions had NULL).

## Documentation Updates

The following docs were identified as relevant and may need updates:

- [x] `evolution/docs/implicit_rubric_weights.md` — add a section noting (a) auto-mode holistic prompt is overridable per-session (default = hardcoded checklist, back-compat); (b) the new `strictVerdictTail` parameter and why it's separate from the rejudge sandbox path; (c) `EVOLUTION_WI_HOLISTIC_OVERRIDE_DISABLED` kill-switch; (d) cross-reference to the analysis report once published.
- [x] `evolution/docs/data_model.md` — append `holistic_prompt_override TEXT NULL` to the `evolution_weight_inference_sessions` column list and add migration `20260624173001` to the migration-log table.
- [x] `evolution/docs/rating_and_comparison.md` — add a one-paragraph note: `buildComparisonPrompt`'s `customPromptOverride` is now reached from two places (rejudge sandbox AND weight-inference auto-mode), with the 6th param `strictVerdictTail` distinguishing parser semantics (sandbox tolerates reasoning + uses `parseVerdictFromReasoning`; auto-mode demands single-token + uses `parseWinner`).
- [x] `evolution/docs/visualization.md` — add the "Custom holistic prompt in use" badge to the weight-inference session detail section and the "custom" column to the sessions-list table.
- [x] `evolution/docs/cost_optimization.md` — note the `HOLISTIC_PROMPT_OVERHEAD_CHARS` constant is now replaced by `Math.max(700, override?.length ?? 0)` in `estimateAutoRunCost`.
- [x] `docs/feature_deep_dives/judge_evaluation.md` — cross-reference: the experiment uses the same test-set source pattern Judge Lab pioneered.

## Review & Discussion

[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
