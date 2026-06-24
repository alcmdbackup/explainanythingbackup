# Fix Test Isolation Issues Progress

## Phase 0: verify Failure B resolved — DONE
`evolution-llm-cost-attribution.integration.test.ts` passes on this branch (already fixed by #1258 —
far-future-timestamp + tight window; root cause was PostgREST row-cap truncation, not a deleter). No code.

## Phase 1: run-deletion FK race — DONE & verified
- **1a — active-run-aware teardown** (`src/__tests__/e2e/setup/global-teardown.ts`): the `%[TEST]%`/`%[E2E]%`
  name-pattern delete now excludes `pending`/`claimed`/`running` runs at the id-collection step (kept the
  pattern delete as the safety net for untracked specs). Removes the cross-spec deletion vector.
- **1b — fail-closed persist guard** (`evolution/src/lib/pipeline/persistSeedVariant.ts`): extracted
  `persistSeedVariantRow`; on permanent upsert failure it re-asserts run existence — run GONE → graceful
  `RunDeletedDuringExecutionError`; run EXISTS → rethrow (never swallowed). `classifyError` maps the two
  new RunErrorCodes. `claimAndExecuteRun` calls it (outer catch + `markRunFailed` classify/mark).
- Tests: `persistSeedVariant.test.ts` (5, fake-DB: happy/retry/gone/exists) + a real-DB integration test
  `evolution-seed-persist-guard.integration.test.ts` (2: persist-ok, deleted-run→RunDeletedDuringExecutionError).
  Both green locally.

## Phase 2: deterministic E2E test-LLM — DONE & validated WITHOUT CI
- `evolution/src/lib/pipeline/infra/e2eTestLlm.ts` (`evolutionE2EMockResponse`) wired into the single
  `llmProvider.complete` chokepoint in `claimAndExecuteRun`. Under `E2E_TEST_MODE`: generation →
  format-valid article with a unique `# [E2E] Variant N` score; proposer → `<output>` echo of the working
  `<source>` + one CriticMarkup insert (drift-free); approver → JSONL accept; ranking → winner by higher
  variant score (consistent across the 2-pass reversal). Synthetic non-zero usage keeps cost metrics > 0.
- **No Playwright spec change needed**: the e2e-evolution CI job already runs with `E2E_TEST_MODE=true`, so
  the mock activates and the existing `admin-evolution-iterative-editing.spec.ts` becomes deterministic.
- **Local validation (no CI/Playwright)**: `evolution-e2e-test-llm-pipeline.integration.test.ts` drives the
  REAL `claimAndExecuteRun` under `E2E_TEST_MODE` against the dev DB → run completes, editing variants get
  non-default mu (13.9/19.1/13.2, 9–13 matches each) after ranking, cost > 0. Unit tests
  (`e2eTestLlm.test.ts`, 8) feed mock output through the real parsers + `checkProposerDrift`.
- Debugging notes (found via the local loop, not CI): generation needs an H1 on line 1 (format validator);
  realistic article length to bound variant count; `<source>` extraction must take the LAST `<source>\n`
  block (system prompt references `<source>` too); ranking winner must come from the variant-score, not
  slice length (textB slice included trailing boilerplate → constant winner → position-bias draws).

## Phase 3: get_llm_spend_buckets hardening — DESCOPED to docs
The optional ORDER-BY migration was dropped: `migration:verify` fails locally on a PRE-EXISTING 2025
migration (`role "anon" does not exist` — the bare Docker postgres lacks Supabase roles; the harness
creates none), and the plan explicitly allowed dropping Phase 3 if it added gate friction. ORDER BY
doesn't fix PostgREST truncation anyway (bounded range, already in place, is the real protection). The
bounded-range contract will be documented in `evolution/docs/data_model.md` during /finalize doc updates.

## Verification (local)
lint ✓ · tsc ✓ · unit (persistSeedVariant 5, e2eTestLlm 8) ✓ · integration (cost-attribution 3,
seed-persist-guard 2, e2e-test-llm-pipeline 1) ✓. E2E Playwright + 5x stability gate run in CI during /finalize.

## CI flake resolution — editing-variant mu (deeper fix)
First finalize CI (run 28059485937) flaked: the `:262` assertion ("every editing-born variant has
non-default mu") failed because the editing iteration's INLINE ranking hit `stopReason: 'budget'`
under shared-DB concurrency, leaving some editing variants at the OpenSkill default mu=25. Proof it
was budget (not nondeterminism): the integration proxy PASSED (44s) and FAILED (38s) in the SAME run.
Root cause: a generate-heavy split (50/30/20) over-produced variants and starved the editing-rank
budget. **Deeper fix**: rebalanced to editing-heavy (generate 20 / editing 60 / swiss 20) in BOTH
`admin-evolution-iterative-editing.spec.ts` and `evolution-e2e-test-llm-pipeline.integration.test.ts`,
guaranteeing the inline editing-rank has budget to rank every editing variant. This targets a
deterministic budget threshold (not the un-reproducible-locally concurrency timing). Re-push CI run
28063293065 (HEAD 4dfbb17d1): **all jobs green**, incl. Integration (Evolution) + E2E (Evolution).
PR #1271: OPEN, MERGEABLE.
