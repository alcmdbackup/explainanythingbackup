# Suggestions to Improve Pipeline Agents Plan

## Background

The evolution pipeline is an autonomous content improvement system using 8+ specialized agents across two phases (EXPANSION → COMPETITION). Research documented the agent architecture thoroughly and identified several integration gaps where design intent doesn't match implementation. The comparison infrastructure project demonstrated successful patterns for extracted reusable logic, configuration-driven sweeps, and cost-efficiency metrics that could inform these improvements.

## Problem

Five key gaps exist between the pipeline's documented design and actual implementation:

1. **Strategy Routing Disconnection** (HIGH): Supervisor prepares rotating single-strategy payloads for COMPETITION, but GenerationAgent ignores them and uses hardcoded `STRATEGIES` constant — documented as "known gap" in evolution_pipeline.md lines 103, 110.

2. **Cost Attribution Gap** (MEDIUM): DebateAgent hardcodes `costUsd: 0` despite 4 LLM calls. Costs charge to global budget but agent-level visualization shows zero — misleading cost breakdown.

3. **MetaFeedback Underutilization** (MEDIUM): MetaReviewAgent produces `successfulStrategies`, `recurringWeaknesses`, `patternsToAvoid` but only `priorityImprovements` is consumed by GenerationAgent. EvolutionAgent and DebateAgent don't use the feedback.

4. **Title Mismatch Risk** (LOW): `applyWinnerAction` updates `explanations.content` but not `explanation_title`. If winner's H1 differs from original title, metadata becomes stale.

5. **Checkpoint History Clearing** (LOW): `eloHistory`/`diversityHistory` cleared on EXPANSION→COMPETITION transition (supervisor.ts:128-129). Run summary only shows COMPETITION metrics.

## Options Considered

### Option A: Full Integration Overhaul
- Connect all supervisor payloads to all agents
- Add comprehensive cross-agent feedback loops
- Preserve full history across phases
- **Pros**: Complete solution, addresses all gaps
- **Cons**: High risk, large diff, regression potential, blocks other work

### Option B: Phased Incremental Fixes (Recommended)
- Address gaps in priority order across 4 phases
- Each phase is independently shippable
- Existing tests constrain regressions
- **Pros**: Low risk, incremental value, reviewable chunks
- **Cons**: Takes longer to complete all improvements

### Option C: Minimal Fixes Only
- Only fix cost attribution and title mismatch (concrete bugs)
- Leave strategy routing as documented "known gap"
- **Pros**: Fastest, lowest risk
- **Cons**: Doesn't address root architectural gaps

**Selected**: Option B — phased incremental fixes provide the best balance of value delivery and risk management.

## Phased Execution Plan

### Phase 1: Cost Attribution Fix (1-2 hours)
**Goal**: Fix misleading cost breakdown in admin UI.

**Changes**:
1. `agents/debateAgent.ts`: Track actual cost across 4 LLM calls
   - Add `totalCost` accumulator in execute()
   - Update return statement: `costUsd: totalCost` instead of `costUsd: 0`

2. Verify cost calculation follows same pattern as other agents:
   ```typescript
   const cost = ctx.costTracker.recordSpend('debate', actualCost);
   totalCost += cost;
   ```

**Tests**:
- Update `debateAgent.test.ts` to verify cost attribution
- Add assertion: `expect(result.costUsd).toBeGreaterThan(0)`

**Verification**:
- Run local CLI with `--full` flag
- Check cost breakdown in admin UI shows debate agent cost > 0

---

### Phase 2: Strategy Routing Connection (2-3 hours)
**Goal**: GenerationAgent consumes supervisor's strategy payload.

**Changes**:
1. `agents/generationAgent.ts`:
   - Accept optional `strategy?: string` in `AgentPayload` or via `ExecutionContext`
   - If strategy provided, generate only that strategy
   - If not provided (EXPANSION or legacy), use all 3 strategies

   ```typescript
   // Current: Always runs all 3
   const strategies = STRATEGIES;

   // New: Respect supervisor payload
   const strategies = ctx.payload.strategy
     ? [ctx.payload.strategy]
     : STRATEGIES;
   ```

2. `core/supervisor.ts`:
   - Already prepares `currentStrategy` — ensure it's passed through `getPhaseConfig()` to pipeline

3. `core/pipeline.ts`:
   - Pass supervisor's strategy to GenerationAgent payload in `executeFullPipeline()`

**Tests**:
- Add test: GenerationAgent with single strategy payload produces 1 variant
- Add test: GenerationAgent without strategy produces 3 variants
- Integration test: Full pipeline uses strategy rotation in COMPETITION

**Verification**:
- Run `run-evolution-local.ts --full --iterations 5`
- Verify COMPETITION iterations generate 1 strategy each (rotating)

---

### Phase 3: MetaFeedback Enhancement (2-3 hours)
**Goal**: EvolutionAgent and DebateAgent consume MetaReviewAgent feedback.

**Changes**:
1. `agents/evolvePool.ts` (EvolutionAgent):
   - Already reads `metaFeedback` — expand usage:
   - Use `successfulStrategies` to weight parent selection
   - Use `patternsToAvoid` to guide mutation prompts
   - Use `recurringWeaknesses` to focus mutations

   ```typescript
   // Boost selection probability for variants from successful strategies
   const strategyBoost = metaFeedback?.successfulStrategies?.includes(parent.strategy) ? 1.2 : 1.0;
   ```

2. `agents/debateAgent.ts`:
   - Inject `recurringWeaknesses` into judge prompt
   - Help judge prioritize improvements that address known weaknesses

   ```typescript
   const judgeContext = metaFeedback?.recurringWeaknesses
     ? `Known weaknesses to address: ${metaFeedback.recurringWeaknesses.join(', ')}`
     : '';
   ```

**Tests**:
- Add test: EvolutionAgent with successful strategies boosts those parents
- Add test: DebateAgent includes weaknesses in judge prompt

**Verification**:
- Run full pipeline, inspect logs for metaFeedback consumption
- Verify judge prompts contain weakness context

---

### Phase 4: History Preservation & Title Sync (1-2 hours)
**Goal**: Fix data quality issues in run summary and winner application.

**Changes**:
1. `core/supervisor.ts`:
   - Remove history clearing on phase transition (lines ~128-129)
   - Or: Store EXPANSION history in separate field before clearing

   ```typescript
   // Before: Clears on transition
   this.eloHistory = [];

   // After: Preserve or split
   this.expansionEloHistory = [...this.eloHistory];
   this.eloHistory = []; // Fresh for COMPETITION
   ```

2. `services/evolutionActions.ts` (`applyWinnerAction`):
   - Extract H1 title from winner content
   - Update `explanation_title` to match

   ```typescript
   const h1Match = winnerContent.match(/^#\s+(.+)$/m);
   if (h1Match) {
     await supabase.from('explanations')
       .update({ content: winnerContent, explanation_title: h1Match[1] })
       .eq('id', explanationId);
   }
   ```

**Tests**:
- Add test: Phase transition preserves expansion history
- Add test: applyWinnerAction syncs title from H1

**Verification**:
- Run full pipeline, verify run summary contains EXPANSION metrics
- Apply winner with different H1, verify title updates

---

## Testing

### Unit Tests to Add/Modify

| File | Changes |
|------|---------|
| `agents/debateAgent.test.ts` | Assert `costUsd > 0` in result |
| `agents/generationAgent.test.ts` | Test single-strategy payload behavior |
| `agents/evolvePool.test.ts` | Test strategy boost from metaFeedback |
| `core/supervisor.test.ts` | Test history preservation across phases |
| `services/evolutionActions.test.ts` | Test title extraction and sync |

### Integration Tests

| Test | Verification |
|------|--------------|
| Full pipeline cost breakdown | All agents show non-zero cost |
| Strategy rotation | COMPETITION uses rotating single strategies |
| MetaFeedback flow | Feedback appears in subsequent iteration prompts |
| Winner application | Title matches content H1 |

### Manual Verification (Staging)

1. **Cost Breakdown**: Queue evolution run, verify admin UI cost chart shows debate > 0
2. **Strategy Rotation**: Run CLI `--full`, verify logs show single strategy per COMPETITION iteration
3. **MetaFeedback**: Inspect variant generation prompts for weakness context
4. **Title Sync**: Apply winner with modified H1, verify explanation title updates

## Documentation Updates

The following docs need updates after implementation:

| Doc | Updates Needed |
|-----|----------------|
| `docs/feature_deep_dives/evolution_pipeline.md` | Remove "known gap" notes at lines 103, 110, 170; update agent interaction table |
| `docs/feature_deep_dives/evolution_pipeline_visualization.md` | Note accurate cost breakdown; document phase history in summary |
| `docs/feature_deep_dives/iterative_editing_agent.md` | No changes expected |
| `docs/feature_deep_dives/iterative_planning_agent.md` | No changes expected |
| `docs/feature_deep_dives/comparison_infrastructure.md` | No changes expected |

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Strategy routing breaks EXPANSION | Guard: only apply single-strategy in COMPETITION phase |
| MetaFeedback injection changes output quality | Feature flag: `evolution_enhanced_metafeedback_enabled` |
| History preservation increases checkpoint size | Minimal: ~10KB per phase, acceptable |
| Title sync overwrites intentional title differences | Only sync if H1 present and differs; log warning |

## Success Criteria

- [ ] Admin UI cost breakdown shows debate agent cost > 0
- [ ] COMPETITION phase generates 1 strategy per iteration (rotating)
- [ ] EvolutionAgent and DebateAgent log metaFeedback consumption
- [ ] Run summary includes EXPANSION phase metrics
- [ ] Applied winner has matching title and H1
- [ ] All existing tests pass
- [ ] No regression in evolution pipeline quality metrics
