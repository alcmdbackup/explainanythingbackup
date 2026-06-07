# Improve Judge Lab Evolution Plan

## Background
Make improvements to the Judge Lab — the systematic, persisted judge-evaluation tool in the evolution
admin UI (`/admin/evolution/judge-lab`) that runs batch A/B/TIE judge sweeps over frozen test sets and
ranks judge settings by decisive rate. Two improvements are requested: (1) fix a
model-communication error when selecting `deepseek-v4-flash` or `google/gemini-2.5-flash-lite` as the
judge model, and (2) add the ability to edit a test set and view its contents from the test-sets menu.

## Requirements (from GH Issue #NNN)
- Trying to use deepseek-v4-flash or google/gemini-2.5-flash-lite results in an error 'error communication with AI model'.
- Want to add the ability to edit test sets and view their contents, from the test sets menu

## Problem
The Judge Lab judge LLM call goes through `callLLM` (`src/lib/services/llms.ts`); two judge-model
choices fail with a generic "error communicating with AI model" message, masking the real provider
error and blocking those models from being evaluated. Separately, Test Sets are frozen samples with
no UI to inspect their member pairs or amend their metadata — researchers can only create and list
them, making it hard to understand what a sweep actually compared. The frozen-comparability contract
(`settings_key` includes `test_set_id`; membership materializes once) constrains what "edit" can
safely mean.

## Options Considered
- [ ] **Option A: [Name]**: [Description]
- [ ] **Option B: [Name]**: [Description]
- [ ] **Option C: [Name]**: [Description]

## Phased Execution Plan

### Phase 1: Diagnose & fix judge-model communication error
- [ ] Reproduce the error for `deepseek-v4-flash` and `google/gemini-2.5-flash-lite` (capture the real underlying error behind "error communicating with AI model")
- [ ] Trace model routing in `src/lib/services/llms.ts` + `getModelOptions` / model registry + `src/config/llmPricing.ts`
- [ ] Implement the fix (register/route models correctly and/or correct reasoning-effort/temperature param handling for these providers)

### Phase 2: View test set contents
- [ ] Add a server action to fetch a test set's member pairs + snapshot details
- [ ] Add a "View contents" UI to `/admin/evolution/judge-lab/test-sets`

### Phase 3: Edit test sets
- [ ] Define safe-edit scope that preserves frozen comparability (metadata edit and/or clone-to-new-set vs. in-place membership change)
- [ ] Implement edit server action + UI

## Testing

### Unit Tests
- [ ] [Test file path and description, e.g. `evolution/src/lib/judgeEval/testSet.test.ts` — test X behavior]

### Integration Tests
- [ ] [Test file path and description, e.g. `src/__tests__/integration/*.integration.test.ts` — test Y flow]

### E2E Tests
- [ ] [Test file path and description, e.g. `src/__tests__/e2e/specs/09-admin/*.spec.ts` — verify Z end-to-end]

### Manual Verification
- [ ] [Manual verification step description]

## Verification

### A) Playwright Verification (required for UI changes)
- [ ] [Playwright spec or manual UI check — run on local server via ensure-server.sh]

### B) Automated Tests
- [ ] [Specific test file path to run]

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [ ] `docs/feature_deep_dives/judge_evaluation.md` — Admin UI test-sets section (view/edit), and judge-model notes if model routing changes
- [ ] `evolution/docs/rating_and_comparison.md` — only if comparison/judge-call behavior changes
- [ ] `evolution/docs/reference.md` — LLM model/routing/error notes if model registry changes
- [ ] `evolution/docs/visualization.md` — Judge Lab admin page row (test-sets view/edit)
- [ ] `evolution/docs/data_model.md` — only if judge_eval_* schema changes

## Review & Discussion
[This section is populated by /plan-review with agent scores, reasoning, and gap resolutions per iteration]
