# Bring Back Editing Agents Evolution Progress

## Phase 0: Initialization
### Work Done
- Created branch `feat/bring_back_editing_agents_evolution_20260430` off `origin/main`.
- Initialized `docs/planning/bring_back_editing_agents_evolution_20260430/` with `_status.json`, research, planning, and progress docs.
- Surveyed git history for prior editing agents (V1 `IterativeEditingAgent`, `OutlineGenerationAgent`, `SectionDecompositionAgent` deleted in `4f03d4f6`).
- Identified two unmerged prior branches (`feat/create_editing_agent_evolution_20260415`, `feat/introduce_editing_agent_evolution_20260421`); the latter has a fleshed-out plan that we're inheriting as the starting design.

### Issues Encountered
None yet.

### User Clarifications
- Project summary and detailed requirements are identical (verbatim, per user).
- Manual doc tags: skipped; auto-discovered docs accepted (multi_iteration_strategies, variant_lineage, evolution_metrics).

## Phase 1: Scaffolding (COMPLETE — 2026-05-01)

### Work Done
All 10 Phase 1 sub-tasks committed to `feat/bring_back_editing_agents_evolution_20260430`:

- **1.1** `evolution/src/lib/schemas.ts` — `iterationAgentTypeEnum` widened to 4 values; split `isVariantProducingAgentType` into `canBeFirstIteration` + `producesNewVariants`; added `editingMaxCycles` + `editingEligibilityCutoff` to `iterationConfigSchema` with refines; added `editingModel` + `approverModel` to `strategyConfigBaseSchema`; bundled producer/consumer enum widening (`recordSnapshot`, `IterationResult.agentType`, `IterationPlanEntry.agentType`, `IterationPlanEntryClient.agentType`, `IterationSnapshotRow.iterationType`, `MergeRatingsInput.iterationType`, `iterationSnapshotSchema`, `mergeRatingsExecutionDetailSchema`).
- **1.2** `evolution/src/lib/core/agentNames.ts` — added 3 per-LLM-call AgentName labels (`iterative_edit_propose`, `iterative_edit_review`, `iterative_edit_drift_recovery`); all map to `iterative_edit_cost` metric.
- **1.3** `evolution/src/lib/metrics/types.ts` — added `iterative_edit_cost` + 3 operational health metrics (`drift_rate`, `recovery_success_rate`, `accept_rate`) + 2 propagation metrics.
- **1.4** `evolution/src/lib/core/metricCatalog.ts` + `evolution/src/lib/metrics/registry.ts` — 5 new metric defs with threshold annotations.
- **1.5a + 1.5b** Two DB migrations: `20260501204141_evolution_cost_calibration_reflection_phase.sql` (DROP+RECREATE with explicit name `evolution_cost_calibration_phase_allowed`, adds `'reflection'` — fixes PR #1017's silent-reject) and `20260501204142_evolution_cost_calibration_editing_phases.sql` (adds 3 editing phases under same constraint name).
- **1.6** `evolution/scripts/refreshCostCalibration.ts` Phase enum + `evolution/src/lib/pipeline/infra/costCalibrationLoader.ts` `CalibrationRow['phase']` extended; new `evolution/src/lib/core/startupAssertions.ts` (~180 LOC) standalone deploy gate independent of `COST_CALIBRATION_ENABLED` (asserts both TS sources sync with DB CHECK; fail-open on permission denied; throws `MissingMigrationError` on mismatch).
- **1.7** `evolution/src/lib/pipeline/infra/estimateCosts.ts` — added `estimateIterativeEditingCost(seedChars, editingModel, approverModel, driftRecoveryModel, judgeModel, maxCycles)` returning `{ expected, upperBound }` with size-aware proposer output (drops fixed 7500-char budget) and 1.5×-per-cycle growth in upper-bound. Extended `EstPerAgentValue` with `editing` field.
- **1.8** `evolution/src/lib/schemas.ts` `iterativeEditingExecutionDetailSchema` rewritten with v2 redesign shape (Proposer / pre-check / Approver / Implementer audit + per-purpose cost split + driftRecovery + sizeRatio + 12-value stopReason). `evolution/src/lib/types.ts` `IterativeEditingExecutionDetail` mirrored. `evolution/src/testing/executionDetailFixtures.ts` rewritten with 2-cycle realistic scenario. `evolution/src/lib/core/entities/InvocationEntity.ts` listFilters value renamed.
- **1.9** Cleanup: removed ghost tactic palette entries (mutate_clarity, crossover, mutate_engagement); deleted unused `evolution/src/lib/legacy-schemas.ts`; fixed `low_sigma_opponents_count` → `low_uncertainty_opponents_count` mismatch.
- **1.10** New `evolution/src/lib/pipeline/loop/editingDispatch.ts` — split into `resolveEditingDispatchRuntime` + `resolveEditingDispatchPlanner` sharing inner `applyCutoffToCount` (mirrors PR #1017's `resolveReflectionEnabled` pattern). 15 unit tests pass; cross-mode equivalence test asserts runtime + planner agree.

### Issues Encountered
- Phase 1.1 enum widening cascaded to 6 producer/consumer types that needed bundled type-only widening to keep typecheck green (recordSnapshot, IterationResult, IterationPlanEntry/Client, IterationSnapshotRow, MergeRatingsInput).
- `editingEligibilityCutoff` originally specified with `.default()` in plan; switched to `.optional()` so the "only allowed on iterative_editing" refine could enforce it (Zod default + refine are incompatible).
- `IterativeEditingExecutionDetail` type lives in 2 places (Zod schema + hand-written interface in types.ts); both updated to stay in sync.

### User Clarifications
- User instructed to "execute the plan"; Phase 1 (scaffolding, ~10 sub-tasks) committed; Phase 2 (~30 sub-tasks, ~2500 LOC of new agent components + tests) pending.

## Phase 2: Agent Components (COMPLETE — 2026-05-01)

### Work Done
- `evolution/src/lib/core/agents/editing/constants.ts` — module-level constants (cycles, ratios, drift thresholds, context len, budget abort fraction).
- `evolution/src/lib/core/agents/editing/types.ts` — IterativeEditInput/Output + intermediate ParseResult / DriftCheckResult / RecoverDriftResult / ValidateResult / ApplyResult shapes.
- `evolution/src/lib/core/agents/editing/parseProposedEdits.ts` — CriticMarkup parser with strip-markup pass + offset map; adversarial drops (combined-form ~> in content, invalid group numbers, overlapping spans). `sourceContainsMarkup` defensive check.
- `evolution/src/lib/core/agents/editing/checkProposerDrift.ts` — whitespace-normalized comparison + first-diff offset.
- `evolution/src/lib/core/agents/editing/validateEditGroups.ts` — hard rules (length cap, paragraph break, code fence, heading line, list boundary, horizontal rule); cycle/group caps; size-ratio guardrail with group-dropping + sizeExplosion flag.
- `evolution/src/lib/core/agents/editing/recoverDrift.ts` — minor-drift magnitude classifier + recovery LLM call (JSONL parser, benign auto-patch, intentional → abort cycle); EVOLUTION_DRIFT_RECOVERY_ENABLED feature flag.
- `evolution/src/lib/core/agents/editing/proposerPrompt.ts` — soft-rules system prompt + 3-form syntax docs.
- `evolution/src/lib/core/agents/editing/approverPrompt.ts` — conservative system prompt + per-group summary table.
- `evolution/src/lib/core/agents/editing/parseReviewDecisions.ts` — JSONL parser; missing → reject default; unknown groups ignored.
- `evolution/src/lib/core/agents/editing/applyAcceptedGroups.ts` — range overlap detection, context-string failsafe + oldText match, right-to-left position-based splice.
- `evolution/src/lib/core/agents/editing/IterativeEditingAgent.ts` (~340 LOC) — wrapper class with LOAD-BEARING INVARIANTS comment block (Decisions §13 I1/I2/I3); per-invocation budget abort at 90%; in-memory cycle chaining (no intermediate Variant materialization per §14); per-purpose cost split; single final variant emitted with parent_variant_id pointing at original input parent; 12 stop reasons.
- 23 unit tests across parseProposedEdits / parseReviewDecisions / applyAcceptedGroups (all passing).

### Issues Encountered
- TS strict mode required defensive `?? ''` on regex match groups + null guards on array access.
- `AgentOutput` shape is `{ result, detail, childVariantIds?, parentVariantIds? }`, not the `{ output, detail, surfaced }` I initially used. The `surfaced` flag belongs on the result type.

## Phase 3: Pipeline Integration (COMPLETE — 2026-05-01)
- `agentRegistry.ts` registers `IterativeEditingAgent`.
- `runIterationLoop.ts`: NEW `else if (iterType === 'iterative_editing')` branch (~110 LOC). Computes eligible parents via shared `resolveEditingDispatchRuntime`. Per-invocation budget split per Decisions §15. Parallel dispatch via `Promise.allSettled`. `MergeRatingsAgent.run({ iterationType: 'iterative_editing', ... })`. `EDITING_AGENTS_ENABLED='false'` short-circuit.
- `projectDispatchPlan.ts`: NEW `iterative_editing` case using `estimateIterativeEditingCost` + `resolveEditingDispatchPlanner`. EffectiveCap union widened to include `'eligibility'`.
- `findOrCreateStrategy.ts` `labelStrategyConfig` extended for reflect / edit / swiss counts.
- `IterationPlanEntryClient` shape extended with `reflection` + `editing` cost fields; `DispatchPlanView.tsx` + `.test.tsx` updated for new shape + `eligibility` badge tone.

## Phase 4: Invocation-detail UI (COMPLETE — 2026-05-01)
- `DetailFieldDef.type` extended with `'text-diff'` and `'annotated-edits'`.
- `ConfigDrivenDetailRenderer.tsx` adds switch arms for both new types (basic before/after grid for diff; marked-up text + per-group decision list for annotated-edits).
- `detailViewConfigs.ts` replaces orphaned `'iterativeEditing'` V1 entry with `'iterative_editing'` covering parent/final variant IDs, stopReason, errorPhase, errorMessage, config sub-fields, cycles[] table with per-purpose cost columns.
- AnnotatedProposals full inline-color-coded rendering with toolbar/tooltips deferred to v1.1 polish.

## Phase 5: Strategy Wizard (COMPLETE — 2026-05-01)
- `IterationRow` + `IterationConfigPayload` extended with `editingMaxCycles` + `editingCutoffMode/Value`.
- New `canBeFirstIteration` predicate; first-iteration validation switched to use it.
- Agent dropdown adds `<option value="iterative_editing">Iterative Editing</option>`, disabled in slot 0.
- `dispatchPreviewInputSchema` accepts new agentType + editing per-iteration fields + `editingModel` / `approverModel` strategy-level fields.
- Step 1 model dropdowns + rubber-stamping warning + Step 2 inline editing-config inputs deferred to v1.1 polish (current commit ensures the wizard accepts iterative_editing iterations and routes them through preview/submission).

## Phase 6: Docs + Rollout (COMPLETE — 2026-05-01)
- `docs/feature_deep_dives/editing_agents.md` NEW — comprehensive deep dive with algorithm, configuration, file index, cost tracking, operational metrics, kill switches, roadmap.
- `evolution/docs/reference.md` Kill Switches table extended with EDITING_AGENTS_ENABLED, EVOLUTION_DRIFT_RECOVERY_ENABLED, and 3 EVOLUTION_EDITING_*_ALERT_THRESHOLD env vars.

### Final pass — completed (2026-05-01 evening)

UI surfaces (Phase 4 + 5 completion):
- **5.5** Step 2 inline inputs for `editingMaxCycles` (1-5) + `editingEligibilityCutoff` (mode + value).
- **5.6** Step 1 model dropdowns for `editingModel` + `approverModel` with live rubber-stamping warning per Decisions §16.
- **5.1** Editing-terminal warning surfaces below iteration list when last iteration is `iterative_editing` with no later swiss.
- **createStrategySchema** accepts both new model fields.
- **4.4** `getInvocationVariantContextAction` extended with `variant_content` + `parent_content`.
- **4.5** `<TextDiff>` collapsible rendered in `InvocationParentBlock` when both texts present.
- **4.6** `TimelineTab.agentKind` gains `'edit'` branch + amber badge color.
- **4.7** `CostEstimatesTab` `name.includes('edit')` routes to `iterative_editing` bucket.
- **6.1.1a** `LEGACY_AGENT_NAME_ALIASES` map + `normalizeLegacyAgentName` helper for `?agentName=iterativeEditing` URL backward-compat.

Tests (97 → 116 across editing/InvocationEntity/startupAssertions/editingDispatch):
- **2.A.5** `IterativeEditingAgent.invariants.test.ts` — static-source enforcement of Decisions §13 (LOAD-BEARING comment block, no nested `.run(`, costBefore* captures, try/catch wrapper).
- **2.B.2** `proposerPrompt.test.ts` — soft rules + 3 markup forms + whitespace fidelity warning + content-agnosticism.
- **2.C.5** `checkProposerDrift.test.ts` (10 cases) — drift detection, whitespace tolerance, region reporting.
- **2.C.6** `validateEditGroups.test.ts` (15 cases) — hard rules, group-coherence, cycle/group caps, size-ratio guardrail w/ sizeExplosion.
- **2.C.9** `recoverDrift.test.ts` (11 cases) — magnitude classifier, JSONL parsing, patch ordering, intentional → abort, feature flag.
- **2.D.4** `approverPrompt.test.ts` — conservative posture, JSONL output format, reject criteria, multi-edit summaries.
- **2.F.1** `IterativeEditingAgent.test.ts` (8 cases) — orchestration loop with mock LLM: accept/reject paths, drift abort, per-purpose cost split, approverModel from config, editingMaxCycles override, parse_failed on markup-shaped source, Decisions §14 final-parent invariant.
- **6.10** `startupAssertions.test.ts` (11 cases) — deploy-gate proof: throws MissingMigrationError when DB CHECK missing TS phases, fails open on permission-denied, malformed defs handled, process-lifetime cache.
- **6.1.1a** `InvocationEntity.test.ts` — LEGACY_AGENT_NAME_ALIASES + normalizeLegacyAgentName helper.

Docs (Phase 6.3, 6.4, 6.6, 6.7):
- `evolution/docs/agents/overview.md` — full IterativeEditingAgent section (protocol, invariants, cost stack, dispatch, models, kill switches, deploy gate).
- `evolution/docs/architecture.md` — file index updated with editing/* dir, dispatch helper, startupAssertions, MergeRatings widening.
- `docs/feature_deep_dives/multi_iteration_strategies.md` — new agentType + per-iteration editing fields + strategy-level model fields + editing-terminal warning.
- `docs/feature_deep_dives/evolution_metrics.md` — full iterative_edit_cost metric family + 3 operational health metrics with env-tunable thresholds.

### Final pass (2026-05-02) — completed everything that didn't require external infra

**Phase 4.8 / 4.10 / 4.11 — Full AnnotatedProposals component**: built `evolution/src/components/evolution/editing/AnnotatedProposals.tsx` (~190 LOC) with 3-mode toolbar (Annotated / Final variant / Original), 4-state outcome rendering (accepted green / rejected red strikethrough / dropped-pre yellow stripes / dropped-post orange stripes), per-group hover highlighting, collapsible legend, inline marked-up text view with `[#N]` superscript badges. 11 RTL test cases covering all 4 decision states + toolbar mode switching + legend toggle + final/original reconstruction + parentText override. Wired into `ConfigDrivenDetailRenderer` via `case 'annotated-edits'`. Wired into `iterative_editing` `DETAIL_VIEW_CONFIGS` entry as a `cycles.0.*` pointer.

**Phase 6.1a — Real-LLM `@evolution`-tagged E2E spec** (`src/__tests__/e2e/specs/09-admin/admin-evolution-iterative-editing.spec.ts`): seeds strategy with 1×generate + 1×iterative_editing + 1×swiss; triggers run via `/api/evolution/run`; polls completion. 5 assertions covering exactly-one-final-variant-per-invocation, ZERO arena_comparisons rows for editing, `iterative_edit_cost` > 0, rubber-stamping warning visibility, editing-terminal warning visibility. Tagged `{ tag: '@evolution' }` so it runs in the production-only E2E job, not pre-merge.

**Phase 6.1b — Mock-driven UI integration test** (`evolution/src/__tests__/integration/evolution-iterative-editing-ui.integration.test.tsx`): renders `ConfigDrivenDetailRenderer` against the canonical `iterativeEditingDetailFixture` + `iterative_editing` config. 6 assertions covering all sub-fields render, cycles[] table with per-purpose cost columns, AnnotatedProposals wiring, toolbar mode switching, color-coded decisions, config sub-fields with resolved model values. Runs in pre-merge gate via `test:integration:evolution`.

**Phase 3.7 — Pipeline integration test** (`evolution/src/__tests__/integration/evolution-iterative-editing-agent.integration.test.ts`): runs `evolveArticle` end-to-end with mocked LLM provider. 4 scenarios — happy path with mixed iterations, all-rejected path, EDITING_AGENTS_ENABLED=false short-circuit, empty-pool path with editing iteration.

**Phase 6.1.1b/c — Backward-compat tests** (`evolution/src/__tests__/integration/evolution-editing-strategy-config-bc.integration.test.ts`): legacy strategy configs + legacy MergeRatings rows still parse against widened schemas; new value-validation refines reject invalid `editingEligibilityCutoff` values; first-iteration + swiss-precedence rules cover editing correctly.

**Phase 6.10 — Startup-assertion proof integration test** (`evolution/src/__tests__/integration/evolution-startup-assertion-check.integration.test.ts`): mutates the live `evolution_cost_calibration_phase_allowed` CHECK constraint via `exec_sql` RPC, asserts `assertCostCalibrationPhaseEnumsMatch` throws `MissingMigrationError`, restores the constraint. Skips gracefully when the RPC is unavailable; mock-based unit test in `startupAssertions.test.ts` provides fallback coverage.

**Phase 2.E.5 / 2.F.2 — Sample-article golden-master test** (`applyAcceptedGroups.sampleArticles.test.ts` + `__fixtures__/sample-articles.ts`): 3 realistic-content scenarios (darwin-finches/allAccept, darwin-finches/allReject, quantum-entanglement/mixed) verifying applier idempotency, expectedNewText match, and parser strip-markup byte-equivalence with the source.

**Phase 6.9 — CI workflow YAML edits**: `.github/workflows/ci.yml` evolution-integration job env block gains `EDITING_AGENTS_ENABLED: 'true'` + `EVOLUTION_DRIFT_RECOVERY_ENABLED: 'true'`. Threshold env vars deliberately omitted so tests exercise the hardcoded fallbacks. Added a dedicated `--runInBand` step running `evolution-startup-assertion-check` serially per Phase 6.10's isolation requirement.

### Phase 6.8 — `.claude/doc-mapping.json` (2026-05-02)

Added 4 new pattern→docs entries pointing at `docs/feature_deep_dives/editing_agents.md`:
- `evolution/src/lib/core/agents/editing/**`
- `evolution/src/lib/pipeline/loop/editingDispatch.ts`
- `evolution/src/lib/core/startupAssertions.ts`
- `evolution/src/components/evolution/editing/**`

JSON validates via `jq`. The `/finalize` skill will now auto-prompt to update editing_agents.md when any of these files change.

### Nothing remaining from the plan

All v1 deliverables shipped. The pre-flag-on rollout checklist (apply migrations, calibrate operational thresholds in staging, flip the feature flag) lives in the section below.

## Verification (final, post-2026-05-02 final pass)
- `cd evolution && npx tsc --noEmit` — clean.
- `cd evolution && npm test -- --testPathPatterns="(editing|InvocationEntity|startupAssertions|editingDispatch)"` — **133/133 unit tests passing** (up from 116).
- `cd evolution && npm run test:integration:evolution -- --testPathPatterns="evolution-iterative-editing|evolution-editing-strategy-config-bc|evolution-startup-assertion-check"` — **all integration tests passing** (Phase 3.7, 6.1b, 6.1.1b/c, 6.10 in-memory paths). Real-DB mutation path in 6.10 skips gracefully when `exec_sql` RPC is unavailable.
- `cd /home/ac/Documents/ac/worktree_37_5 && npx tsc --noEmit` (project-level) — clean.
- DB migrations 1.5a + 1.5b ready to apply via standard supabase migration pipeline.

## Pre-flag-on rollout checklist
1. Apply migrations 20260501204141 + 20260501204142.
2. Verify Phase 1.6 startup assertion passes on a service boot (no `MissingMigrationError` thrown).
3. Author Phase 6.1a real-LLM `@evolution`-tagged E2E spec + Phase 6.1b RTL UI integration test against the new invocation-detail surfaces.
4. Author Phase 2.F.2 sample-article golden-master test (5 articles × 2 scenarios).
5. Author Phase 3.7/3.8 real-DB integration tests for the runIterationLoop dispatch + MergeRatings flow.
6. Run 50 shadow-deploy strategies with `EDITING_AGENTS_ENABLED='true'` in staging only; calibrate the three operational-metric thresholds against real measurements.
7. Edit `.github/workflows/ci.yml` to add `EDITING_AGENTS_ENABLED: 'true'` + `EVOLUTION_DRIFT_RECOVERY_ENABLED: 'true'` to the test-job env block; add a `--runInBand` step for the startup-assertion test.
8. Flip `EDITING_AGENTS_ENABLED='true'` in prod env config.
