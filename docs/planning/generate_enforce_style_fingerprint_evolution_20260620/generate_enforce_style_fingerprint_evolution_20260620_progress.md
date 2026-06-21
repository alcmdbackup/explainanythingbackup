# Generate Enforce Style Fingerprint Evolution Progress

## Execution status (2026-06-21)

Backend foundation complete and verified (typecheck + next lint + unit tests, committed in clean increments). Generation-injection mechanism in place. Run-context plumbing, paragraph parity, judge wiring, and the two UI phases remain.

### ✅ Phase 1 — Data model (committed)
- Migration `20260621000001_create_evolution_style_fingerprints.sql`: `evolution_style_fingerprints` + `evolution_style_fingerprint_articles` junction (exactly-one-non-empty-source CHECK), `evolution_runs.style_fingerprint_id` + `style_fingerprint_snapshot`, `evolution_metrics.entity_type` CHECK extended, seeded `stylistic_accuracy` criterion. **Passes `lint:migrations`.**
- **FIX caught during build:** junction `explanation_id` is `BIGINT` (explanations.id), not UUID — corrected in migration + Zod.
- Zod: `styleFingerprintTraitsSchema`, insert/full/article schemas, `addStyleFingerprintArticleInputSchema`; strategy config `styleFingerprintEnabled`/`styleFingerprintId`; run snapshot cols; `EvolutionConfig.targetStyleProse`.
- Metrics: `total_extraction_cost` in `STATIC_METRIC_NAMES`; `style_fingerprint` block in `METRIC_REGISTRY` + both `ENTITY_TYPES`/`CORE_ENTITY_TYPES`.

### ✅ Phase 2 — Entity backbone (committed)
- `StyleFingerprintEntity` (detailLinks, **soft-delete `executeAction('delete')` override**), registered in `entityRegistry`.
- `styleFingerprintActions.ts`: list/get/create/update/archive/delete(soft) + add/remove/reorder/reExtract + `validateStyleFingerprintId`. **Compute-first/persist-last** recompute; cost accumulated into `total_extraction_cost`.

### ✅ Phase 3 — Extraction + prose (committed, 10 unit tests)
- `extractStyleFingerprint` (injected `callFn`, parse + repair, untrusted-data delimiters).
- `renderFingerprintProse(traits, 'article'|'paragraph')` — article includes anti-overuse directive, paragraph omits.
- **Decision:** extraction uses `callLLM` (CRUD-time, no run — the `runJudgeEval` precedent), NOT `EvolutionLLMClient.complete` (needs a run/costTracker). A correct refinement of the plan's seam; `style_extraction` AgentName not needed.

### 🟡 Phase 4 — Generation injection (PARTIAL, committed)
- ✅ `buildEvolutionPrompt` options bag + `## Target Style` block (byte-identical when absent); `AgentContext.styleFingerprint`; `generateFromPreviousArticle` reads `ctx` + threads to both branches (reflect agent transitive). 7 unit tests.
- ⏳ **Remaining:** `buildRunContext` — resolve the referenced fingerprint at run start, write `evolution_runs.style_fingerprint_id` + snapshot, and populate `AgentContext.styleFingerprint` (multi-file plumbing through `AgentContext` construction in `claimAndExecuteRun`/`runIterationLoop`) + `EvolutionConfig.targetStyleProse`.
- ⏳ **Paragraph generation parity:** inject paragraph-shaped prose into `buildParagraphRewritePrompt` + `buildSequentialRewritePrompt` + coordinator (keep `promptEditor` co-caller compiling).

### ⏳ Phase 5 — Judging injection (not started)
- `rubricJudge.buildRubricComparisonPrompt` target-style block; carry `targetStyleProse` on `EvolutionConfig` read at `rankSingleVariant`/`SwissRankingAgent` call sites → `compareWithBiasMitigation`/`runSingleComparison`; **paragraph slot-judge OVERRIDE-not-inherit** on `perSlotConfig`.

### ⏳ Phase 6 — Strategy opt-in UI (not started)
- Hand-built strategy form (~2000 lines): checkbox + fingerprint dropdown + serialize + display row + `validateStyleFingerprintId`.

### ⏳ Phase 7 — Admin UI (not started)
- Sidebar nav entry, list page, detail page (Overview/Articles/Runs/Metrics), `ArticleCombobox`, create/edit dialog.

### ⏳ Phase 8 — Tests, docs, verification (partial — unit tests written alongside 1–4)
- Remaining: `evolution-test-data-factory` extension, integration tests, E2E spec, action unit tests, docs (+ new `style_fingerprint.md`), full check trio + build.

### Commits
- `feat(evolution): Phase 1 — style fingerprint data model …`
- `feat(evolution): Phase 2 — StyleFingerprintEntity + dual-registry keying …`
- `feat(evolution): Phase 2 — styleFingerprintActions … + bigint FK fix`
- `feat(evolution): Phase 3 — style extraction + prose renderer + tests`
- `feat(evolution): Phase 4a — article generation injection mechanism`
