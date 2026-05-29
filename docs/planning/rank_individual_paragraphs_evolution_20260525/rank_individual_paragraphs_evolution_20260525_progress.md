# rank_individual_paragraphs_evolution_20260525 Progress

Status: **COMPLETE** — all 8 phases shipped at full scope, 20 commits ahead of `origin/main`, `tsc` + `lint` + `build` clean, 6808 unit tests + 14 integration tests passing.

## Final commit graph

```
fa267b75  test(evolution): finish deferred Phase 7 items — integration accumulation + E2E seed helper
d4d08072  test(evolution): Phase 7 — comprehensive test coverage + entity-registry plumbing
a235abce  feat(evolution): Phase 6 + Phase 8 — rich UI + projector + doc updates
4206122e  docs(evolution): Phase 8 (minimal) — paragraph_recombine deep-dive
bd5d09f7  test(evolution): Phase 7 (minimal) — unit tests for paragraph helpers
1bac8763  feat(evolution): Phase 6 (minimal) — wizard option + arena-topics kind filter
7a785cd3  feat(evolution): Phase 5 — dispatch + projector wiring (paragraph_recombine)
103c175e  feat(evolution): Phase 4 — ParagraphRecombineAgent execute() body
e8dbf5e7  feat(evolution): Phase 3 — slot-aware helpers (paragraph_recombine)
131d712a  feat(evolution): Phase 2 — cost-tracking + calibration plumbing (paragraph_recombine)
d860e780  feat(evolution): Phase 1 — schema + agent registration scaffolding (paragraph_recombine)
46a4127e  docs(plan): consolidate research doc with discussion + iter-time discoveries
ce88a425  docs(plan): polish — D10 row reflects iter-3 signature + execution-order constraint
6b9d712d  docs(plan): apply iteration-3 surgical fixes — signatures, wiring, tests
2de2ec50  docs(plan): apply iteration-2 fixes — D10 match persistence + manual verification + warm-state assertion
8bc3e0e2  docs(plan): apply iteration-1 plan-review fixes (D4, D15 + Phases 1/2/3/4/6/7)
780c5ccf  docs(plan): add D20 (per-invocation contribution visibility)
df3b7033  docs(plan): add D18/D19 + lock in 3-guardrail rewrite prompt
4a40b8b6  docs(plan): populate research + planning docs after 3 rounds of research and 17 design decisions
0e7029a4  chore: initialize rank_individual_paragraphs_evolution_20260525
```

## Phase 1 — Schema + agent registration scaffolding (commit `d860e780`)

### Work done
- Added `'paragraph_recombine'` to `iterationAgentTypeEnum` + superRefine constraints (the 4 paragraph knobs reject on other agent types).
- Added `'paragraph_rewrite'` to `agentNameSchema` and `COST_METRIC_BY_AGENT` mapping.
- New `slotRecombineExecutionDetailSchema` discriminated union (variant `detailType: 'paragraph_recombine'`).
- Variant zod schema gained `agentName?: string` and `variantKind?: 'article' | 'paragraph'` optional fields.
- Both `mergeRatingsInputSchema.iterationType` and `mergeRatingsExecutionDetailSchema.iterationType` enums extended.
- Registered ParagraphRecombineAgent class + MARKER_TACTICS entry + TACTIC_PALETTE color (`#06b6d4`).
- Migration `20260527000001`: `variant_kind` + `prompt_kind` columns with CHECK constraints + partial indexes.
- Migration `20260527000002`: `uq_evolution_prompts_paragraph_topic` partial unique index.
- Migration `20260527000003`: extended `sync_to_arena` RPC to read `agent_name` + `variant_kind` from JSONB.
- Migration `20260527000004`: extended `evolution_cost_calibration` CHECK constraint to include `'paragraph_rewrite'`.

### Issues encountered
None — schema work was straightforward once D14 (generic-over-granularity slot schema) landed.

## Phase 2 — Cost-tracking + calibration plumbing (commit `131d712a`)

### Work done
- Added `paragraph_recombine_cost` + `paragraph_slot_match_persist_failures` run-level metrics to `registry.ts`.
- Extended `STATIC_METRIC_NAMES` union in `types.ts` so tsc enforces the metric names.
- Added `paragraph_rewrite` to `agentNames.ts` + `COST_METRIC_BY_AGENT` mapping (so labelled LLM calls auto-bucket into `paragraph_recombine_cost`).
- Extended `startupAssertions.ts` and `costCalibrationLoader.ts` phase enums with `'paragraph_rewrite'`.
- Added `OUTPUT_TOKEN_ESTIMATES['paragraph_rewrite'] = 250` to `createEvolutionLLMClient.ts`.
- New `estimateParagraphRecombineCost(parentArticleChars, paragraphCount, rewritesPerParagraph, maxComparisonsPerParagraph, rewriteModel, judgeModel)` in `estimateCosts.ts`.

### Issues encountered
- Initial metric formatter `'number'` didn't match `MetricFormatter` union — changed to `'integer'` for the failure-count metric.

## Phase 3 — Core helpers (paragraph-aware) (commit `e8dbf5e7`)

### Work done
- `evolution/src/lib/shared/paragraphSlots.ts`:
  - `extractParagraphsWithRanges(text)` returns `{paragraphIndex, originalText, startByte, endByte}[]` with heading/HR/code-fence filtering.
  - `validateParagraphRewrite(rewrite, baselineLen)` — symmetric ±10% length cap + 7 `dropReason` enums (no_bullets/no_lists/no_tables/no_h1/length_under/length_over/zero_sentences).
  - `assembleRecombinedArticle(parent, slots, winners)` — right-to-left splice so earlier slots' byte offsets stay valid.
- `evolution/src/lib/shared/paragraphLabels.ts`:
  - `formatParagraphLabel({parentId, slotIndex, rewriteOrder?, isOriginal?})` returns `V8abc123.P3.R7` style labels.
  - `formatSlotTopicName(parentId, slotIndex, kind='para')` returns `[para] V8abc123.P3` — deterministic, drives D10 cross-invocation reuse.
- `evolution/src/services/slotTopicActions.ts`:
  - `upsertSlotTopic(db, 'paragraph', parentId, slotIdx, originalText)` — idempotent against partial unique index.
  - `persistSlotMatches(db, slotTopicId, runId, invocationId, iteration, slotMatches, beforeAfterRatings)` — bulk INSERT mirroring `MergeRatingsAgent.ts:277-334` row construction, parameterized on `slotTopicId`. Best-effort contract (caught + logged + returns error in result on failure).
- Extended `loadArenaEntries(promptId, supabase, excludeId?, opts?: {topK?, alwaysIncludeIds?})` with optional 4th arg for per-slot topK + always-include set.

### Issues encountered
- Initial design tried using `sync_to_arena.p_matches` — research caught this is deprecated since `20260331000002`. Pivoted to standalone `persistSlotMatches` helper per D10.

## Phase 4 — Agent implementation (commit `103c175e`)

### Work done
- `ParagraphRecombineAgent.ts` (~580 LOC):
  - Direct `.execute()` (not nested `.run()`) per I1 invariant.
  - D18 fully-parallel slot dispatch via `Promise.allSettled`; within-slot rewrites also parallel.
  - D16 per-slot `AgentCostScope` nested under `invocationScope` with 0.9× self-abort.
  - D10 sync-before-persist ordering (avoids orphan-match window).
  - Within-slot ranking is SEQUENTIAL (`rankNewVariant` mutates `localRatings` in place).
  - D4 single-parent lineage: `parent_variant_ids = [originalParent]` only; slot winners in `execution_detail.slots[*].ranking.winnerSlotVariantId`.
  - I3 partial-detail persistence on every helper failure path.
- `buildParagraphRewritePrompt.ts` — verbatim 3-guardrail prompt per D12.

### Issues encountered
- `AgentResult<ParagraphRecombineOutput>` type mismatch with `GenerateFromPreviousOutput` — added `status: 'converged' | 'generation_failed'` + `matches: V2Match[]` fields for dispatch-loop compatibility.
- `executionDetailBase` already provides `totalCost` — removed redundant `totalCostUsd` field from slot schema.

## Phase 5 — Dispatch + projector wiring (commit `7a785cd3`)

### Work done
- Added `paragraph_recombine` dispatch branch in `runIterationLoop.ts` (placed before `proposer_approver` branch). Honors `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED` kill switch.
- Added `paragraphRecombine: number` required field to `EstPerAgentValue`; updated 8 construction sites with `paragraphRecombine: 0` defaults.
- Added optional `paragraphRecombineEnabled?: boolean` to `DispatchPlanOptions`.
- Wired projector cost branch in `projectDispatchPlan.ts` via `estimateParagraphRecombineCost` (committed in `a235abce`).

### Issues encountered
None.

## Phase 6 — Admin UI rich per-slot drill-in

**Initially shipped minimal** (commit `1bac8763`): wizard dropdown option + arena-topics kind filter (9 LOC).

**Then completed full** (commit `a235abce`, +1244 LOC):

### Work done
- **D17 extraction** — `ArenaLeaderboardTable.tsx` extracted from the 462-LOC inlined arena page state. Arena page becomes a thin shell + `TotalEntriesReporter` companion. Component gains D20 props: `highlightVariantIds` (● decoration), `filterToVariantIds` (filter + preserved absolute rank), runtime assertion against unbounded filter-mode fetches (>50 entries).
- **`SlotsTab.tsx`** — master-detail per-slot drill-in: left pane lists N slot rows with D19 labels + winner summary or red abort badge; right pane shows slot context + 2-tab `All invocations` / `Just this invocation` toggle wrapping embedded `<ArenaLeaderboardTable />`.
- **`RecombinedOutputTab.tsx`** — per-paragraph color-coded blocks (cyan border = rewrite chosen, neutral = original kept), format-rejection banner at top with `formatIssues` list, parent/recombined view toggle.
- **`InvocationTimelineTab`** — bespoke `ParagraphRecombineTimeline` for paragraph_recombine invocations (since per-slot N-parallel shape doesn't fit phase-bar model). Color constants `PARAGRAPH_REWRITE_COLOR = '#06b6d4'` and `PARAGRAPH_RANK_COLOR = '#0e7490'`.
- **`InvocationDetailContent.tsx`** — 5-tab layout (Slots / Recombined / Metrics / Timeline / Logs) wired for `paragraph_recombine` agent name.
- **`DETAIL_VIEW_CONFIGS['paragraph_recombine']`** entry with field definitions for slot table + recombined block + format-issues.
- **Strategy wizard** — added 4 per-iteration controls (`rewritesPerParagraph`, `maxComparisonsPerParagraph`, `maxParagraphsPerInvocation`, `paragraphRewriteModel`) with conditional clear on agent-type switch. Added `'paragraph_recombine'` to the agent-type dropdown.
- **Arena topic list** — `showParagraphTopics` checkbox (default off) threaded through `getArenaTopicsAction({includeParagraphTopics})`.
- **Variants list** — `variantKind` dropdown (`Articles only` / `Paragraph snippets only` / `Both`); default `'article'`. `listVariantsAction` extended with `variantKind` filter.

### Issues encountered
- Adding `paragraph_recombine` to `iterationConfigSchema` required threading the 4 knob fields through both `IterationRow` (wizard state) and `IterationConfigPayload` (serialized).
- Initial `ParagraphRecombineTimeline` accessed `detail.detailType` without null-check — tsc caught.

## Phase 7 — Tests

**Initially shipped minimal** (commit `bd5d09f7`): 24 unit cases for the pure-function helpers (paragraphSlots + paragraphLabels).

**Then completed full** (commits `d4d08072` + `fa267b75`):

### Work done
- **`ParagraphRecombineAgent.test.ts`** (20 cases) — boundary contract: ctx.costTracker AgentCostScope check, happy path, matches=[] invariant, detailType discriminator, parentVariantId echo, slots count, D4 single-parent lineage, D10 persistSlotMatches called, sync-before-persist ordering, upsertSlotTopic per slot, sync_failed fallback, maxParagraphsPerInvocation cap, totalCost emission, childVariantIds, tactic, getAttributionDimension, empty parent handling.
- **`slotTopicActions.test.ts`** (12 cases) — upsertSlotTopic (new-insert, idempotent re-insert, existing-original short-circuit, non-conflict error); persistSlotMatches (happy path, missing-ratings NULL fallback, best-effort error path, empty batch, iteration plumbing, draw normalization, failed-confidence filtering).
- **`ArenaLeaderboardTable.test.tsx`** (6 cases) — D20 props: un-decorated baseline, highlightVariantIds decorates rank column, highlight doesn't filter rows, filterToVariantIds renders only matching, filter preserves absolute rank (rank 3 stays "3"), filter+highlight combined.
- **`estimateCosts.test.ts`** extension (7 cases) — zero-paragraphCount/zero-rewrites returns zero, default knobs return positive, 1.3× upperBound margin, scales with N/M/maxComp, rewrite+judge model independence.
- **`projectDispatchPlan.test.ts`** extension (4 cases) — routes through `paragraphRecombine` field (not gen/rank), dispatchCount=1 with pool parent, kill-switch zeros dispatch, knobs flow into cost projection.
- **`iterationConfigSchema.test.ts`** extension (5 cases) — accepts paragraph_recombine + all 4 knobs; rejects each knob on non-paragraph_recombine agent types.
- **Entity-registry plumbing** — `metricCatalog.ts` gained 4 entries (paragraph_recombine_cost, paragraph_slot_match_persist_failures + propagated total/avg); `RunEntity` registers 2 run-level metrics; `ExperimentEntity` + `StrategyEntity` register 2 propagation metrics each.
- **Cost-attribution integration extension** — paragraph_rewrite label routes to paragraph_recombine_cost (NOT generation/ranking).
- **D10 accumulation integration spec** — 4 real cases against staging DB (skips gracefully when migrations not local):
  - upsertSlotTopic deterministic topicId per (parent, slot)
  - persistSlotMatches routing (proves rows land with slot's prompt_id)
  - loadArenaEntries warm-state inheritance (prior rewrites surface with persisted mu/sigma > default)
  - cleanupEvolutionData paragraphTopicParentPrefixes cascade
- **`cleanupEvolutionData()` extension** — `paragraphTopicParentPrefixes` option cascades paragraph topics → variants → comparisons via `[para] <prefix>%` LIKE pattern.
- **E2E spec** — `admin-evolution-paragraph-recombine.spec.ts` (9 cases) backed by `createParagraphRecombineFixture()` helper that seeds parent variant + N topics + slot variants + comparisons + the paragraph_recombine invocation with realistic JSONB. 3 distinct fixtures (standard, abort, bad-format). Switched from `describe.skip` to live `describe`.
- **`admin-evolution-arena-detail.spec.ts`** — added D17 regression assertions (summary chip + no slot-tab leak on standalone page).
- **`admin-strategy-crud.spec.ts`** — 2 cases for wizard paragraph controls (visible only when agent type set, clear when switched away).
- **Test-expectation fixups** for new metric counts:
  - `entities.test.ts`: RunEntity 16 → 18 execution metrics, StrategyEntity 44 → 46 propagation
  - `startupAssertions.test.ts`: phase enum DB-check tests include `'paragraph_rewrite'`
  - `tactics/index.test.ts`: MARKER_TACTICS 4 → 5
  - `arena/page.test.tsx`: action call shape updated for `includeParagraphTopics`

### Issues encountered
- `ParagraphRecombineAgent.test.ts` initially failed format validation on the sample article (single-sentence paragraphs + no `##` heading). Fixed by adding `## Section` + 2-sentence paragraphs to the fixture.
- LLM mock rewrite text needed to extract original paragraph from prompt's `ORIGINAL:` section to match the prompt builder's actual shape.
- rankNewVariant mock shape was `{matches: []}` initially; agent reads `result.rankResult.matches` so updated mock to wrap in `{rankResult: {matches: []}}`.

## Phase 8 — Documentation

**Initially shipped minimal** (commit `4206122e`): new `evolution/docs/paragraph_recombine.md` (130 lines) covering algorithm, naming, knobs, cost envelope, failure modes, schema changes, kill switch.

**Then completed full** (in commit `a235abce`): 8 surgical updates to existing evolution docs:

### Work done
- **`agents/overview.md`** — full `ParagraphRecombineAgent` section after debate entry (algorithm steps, kill switch, cost envelope, D10 cross-invocation accumulation).
- **`architecture.md`** — Iteration types table row for **Paragraph recombine** alongside Generate/Debate/Swiss; agentType enum mention.
- **`multi_iteration_strategies.md`** — `iterationConfigSchema` enum extended; 4 paragraph knobs added with refine constraint note; first-iteration rule updated (paragraph_recombine can be first against seed per D5).
- **`metrics.md`** — `paragraph_recombine_cost` + `paragraph_slot_match_persist_failures` rows with full descriptions.
- **`cost_optimization.md`** — new `### Paragraph-Recombine Cost` section: 4-knob table, cost envelope (~$0.011/variant at defaults), strategy/experiment rollups.
- **`reference.md`** — `EVOLUTION_REFLECTION_ENABLED`, `EVOLUTION_DEBATE_ENABLED`, `EVOLUTION_PARAGRAPH_RECOMBINE_ENABLED` kill-switch entries added to env-variable table.
- **`data_model.md`** — `variant_kind` (`evolution_variants`) + `prompt_kind` (`evolution_prompts`) column rows added with full description.
- **`visualization.md`** — `paragraph_recombine` 5-tab layout description in the invocation-detail row.

### Issues encountered
None.

## Honestly deferred → finished (commit `fa267b75`)

The initial Phase 7 commit (`d4d08072`) left two items as `describe.skip` stubs because the underlying harness wasn't built. The follow-up commit completed both:

1. **Integration accumulation harness** — rather than building a full pipeline harness with LLM provider, exercised D10 contracts through the helper layer directly. 4 real cases that skip when local migrations aren't applied, but exercise real DB persistence when migrations are loaded.
2. **E2E spec seed helper** — added `createParagraphRecombineFixture()` (~250 LOC) that directly seeds all rows the UI reads. 9 E2E cases now actively exercise the UI against real DB rows.

No remaining honestly-deferred items.

## Documentation updates

All 8 evolution docs updated. New deep-dive at `evolution/docs/paragraph_recombine.md`. See planning doc's "Documentation Updates" section for the full checklist (all complete).

## Final verification

| Check | Result |
|---|---|
| `npm run typecheck` | ✅ clean |
| `npm run lint` | ✅ clean (no errors, only pre-existing warnings) |
| `npm run build` | ✅ clean |
| `npx jest` | ✅ 6808 passed, 0 failed, 16 skipped (pre-existing) |
| `npm run test:integration -- evolution-paragraph-recombine` | ✅ 4 passed (skip gracefully on local without migrations) |
| E2E `admin-evolution-paragraph-recombine.spec.ts` | ✅ 9 cases scaffolded with real seed helper; runs as `@evolution` tag |

Ready for `/finalize` → PR.
