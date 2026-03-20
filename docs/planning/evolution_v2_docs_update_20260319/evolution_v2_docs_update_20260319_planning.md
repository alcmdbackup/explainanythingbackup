# Evolution V2 Docs Update Plan

## Background
Update the evolution pipeline documentation to reflect evolution v2 changes. The evolution system has undergone significant architectural changes including the unified RankingAgent (merging CalibrationRanker and Tournament), evolution explanations decoupling, and various pipeline improvements. This project will audit all evolution docs under evolution/docs/evolution/ and ensure they accurately reflect the current codebase state.

## Requirements (from GH Issue #TBD)
- Audit all evolution docs in evolution/docs/evolution/ for accuracy against current codebase
- Verify all file references, function names, and code patterns are up to date
- Ensure architectural descriptions match current implementation
- Update any stale references to removed or renamed components

## Problem
V2 is a complete rewrite of the evolution pipeline — 3-operation flat loop (generate→rank→evolve) replaces V1's 12-agent two-phase system. All 19 evolution docs still describe V1 architecture. 10 docs are fully stale (describe non-existent agents/phases/checkpoint), 5 are partially accurate, and 4 are accurate. The .claude/doc-mapping.json has 27+ stale patterns and 60+ unmapped V2 files. The batch runner's housekeeping ops modules exist but aren't wired into the runner.

## Options Considered

### Option A: Rewrite all 19 docs from scratch for V2
- Pros: Clean slate, no V1 cruft
- Cons: Massive effort, loses accurate content in data_model/rating/arena/cost docs

### Option B: Delete stale docs, update partially-accurate docs, keep accurate docs (CHOSEN)
- Pros: Minimal effort, preserves accurate content, clear scope
- Cons: Need to verify "accurate" docs line by line
- Rationale: 4 docs are still accurate (V2 reuses V1 rating/comparison/format), 5 need targeted updates, and 10 can be deleted or replaced with short V2 summaries

### Option C: Keep V1 docs as archive, create parallel V2 docs
- Pros: Historical preservation
- Cons: Confusing duplication, maintenance burden

## Phased Execution Plan

### Phase 1: Delete stale agent docs (5 files)
Delete docs that describe non-existent V1 agents:
- `evolution/docs/evolution/agents/editing.md` — no editing agents in V2
- `evolution/docs/evolution/agents/tree_search.md` — no tree search in V2
- `evolution/docs/evolution/agents/support.md` — no support agents in V2
- `evolution/docs/evolution/agents/flow_critique.md` — no flow critique in V2
- `evolution/docs/evolution/agents/generation.md` — V1 GenerationAgent/OutlineGenerationAgent don't exist

**Verification**: `ls evolution/src/lib/agents/` confirms only formatValidator.ts and formatRules.ts remain.

### Phase 2: Rewrite architecture.md for V2
Replace the entire V1 architecture doc with V2 reality:
- V2 3-operation flat loop (generate→rank→evolve)
- No EXPANSION/COMPETITION phases
- No checkpoint/resume — runs complete in single execution
- No AgentBase framework — flat functions
- Kill mechanism (iteration-boundary DB status check)
- Winner determination (highest mu, tie-break lowest sigma)
- Stop reasons: iterations_complete | killed | converged | budget_exceeded
- Config: flat EvolutionConfig (iterations, budgetUsd, judgeModel, generationModel)
- Runner lifecycle: claim→resolve→evolve→persist→arena sync

Source: Research doc "V2 Pipeline Detail" section (evolve-article.ts, runner.ts, rank.ts analysis).

### Phase 3: Rewrite agents/overview.md for V2
Replace V1 12-agent framework description with V2 operations:
- 3 operations: generateVariants(), rankPool(), evolveVariants()
- No AgentBase class — functions imported from v2/ module
- Generation: 3 parallel strategies (structural_transform, lexical_simplify, grounding_enhance)
- Ranking: triage (stratified opponents, adaptive early exit) + Swiss fine-ranking
- Evolution: mutate_clarity, mutate_structure, crossover, creative_exploration
- Shared modules: OpenSkill rating, bias-mitigated comparison, format validation
- Per-operation invocation tracking via createInvocation/updateInvocation

Source: Research doc analysis of generate.ts, rank.ts, evolve.ts.

### Phase 4: Rewrite visualization.md for V2
Replace V1 15-page dashboard description with V2 reality:
- 3 remaining admin pages: experiments list, experiment detail, start-experiment
- ~16 remaining shared components (Entity-based patterns)
- 7 V2 server actions (experimentActionsV2.ts)
- Remove all references to deleted pages/components/actions

Source: Round 4 and Round 10 UI audit findings.

### Phase 5: Update reference.md for V2
Major targeted updates:
- Replace DEFAULT_EVOLUTION_CONFIG with V2 EvolutionConfig (flat, no nested objects)
- Update Key Files section: remove all V1 agent/pipeline files, add V2 module files
- Update CLI commands: document --parallel and --max-concurrent-llm flags
- Remove checkpoint/continuation references
- Update Database Schema: reflect V2 clean-slate migration (10 tables, 4 RPCs)
- Remove stale cron references (line 95)
- Update agent classification: 3 operations, no REQUIRED_AGENTS/OPTIONAL_AGENTS
- Fix feature flags section (agent-level flags removed, only enabledAgents config)

Source: Research doc V2 config mapping, DB migration analysis.

### Phase 6: Update partially-accurate docs (5 files)
Targeted line-level fixes:

**README.md**: Rewrite reading order for V2. Remove agent doc references (5 deleted). Update document map.

**data_model.md**: Remove V1-only references (checkpoint table, continuation_pending status, V1 agent names like 'calibration'/'tournament'). Keep core primitives (Prompt, Strategy, Run, Article, Agent — all still valid). Update Key Files section.

**rating_and_comparison.md**: Replace "RankingAgent (`agents/rankingAgent.ts`)" references with "rankPool() (`v2/rank.ts`)". Remove CalibrationRanker/Tournament references. Keep OpenSkill algorithm docs (unchanged). Keep bias mitigation docs (unchanged).

**strategy_experiments.md**: Remove cron driver references (lines 33, 88, 129). Replace with batch runner housekeeping. Update from 13 V1 actions to 7 V2 actions. Remove experimentHelpers.ts/experimentReportPrompt.ts references. Add experimentActionsV2.ts reference.

**minicomputer_deployment.md**: Fix API key requirements (OPENAI_API_KEY, not DEEPSEEK_API_KEY). Remove PINECONE variables. Add --parallel and --max-concurrent-llm CLI args. Note housekeeping modules exist but aren't wired.

### Phase 7: Verify and update remaining accurate docs (4 files)
Light-touch verification pass:

**arena.md**: Fix generation_method from 'evolution' to 'pipeline'. Update Key Files (arenaIntegration.ts → v2/arena.ts, remove arenaActions.ts). Remove admin arena page references.

**cost_optimization.md**: Verify V2CostTracker matches description. Note missing features vs V1 (no isOverflowed, no getAllAgentCosts, no checkpoint restore, no budget events audit log).

**entity_diagram.md**: Verify all relationships match V2 schema.

**experimental_framework.md**: Light verification — bootstrap CIs and per-run metrics should still be accurate.

### Phase 8: Update .claude/doc-mapping.json
- Remove 27+ patterns referencing deleted V1 files
- Add patterns for V2 files (evolution/src/lib/v2/*, evolution/src/services/experimentActionsV2.ts)
- Fix doc paths (docs/evolution/ → evolution/docs/evolution/)
- Remove mappings to deleted agent docs

### Phase 9: Clean up dead V1 code (optional, if time permits)
- Delete dead V1 core modules: configValidation.ts, budgetRedistribution.ts, agentToggle.ts, jsonParser.ts, validation.ts, seedArticle.ts, costEstimator.ts
- Delete dead evolution-runner-v2.ts script
- Note: core/costTracker.ts, core/llmClient.ts, core/logger.ts still used by evolutionRunnerCore.ts — keep

## Testing
- No code changes that require new tests (docs-only project)
- Run `npm run lint` to verify no broken doc links
- Run `npm run tsc` to verify no type errors from doc-mapping changes
- Run `npm run build` to verify build succeeds
- Manual: Verify each doc's file references point to existing files
- Manual: Spot-check 3-5 code snippets in updated docs against actual code

## Documentation Updates
Files to be modified (19 total):
- **DELETE** (5): agents/editing.md, agents/tree_search.md, agents/support.md, agents/flow_critique.md, agents/generation.md
- **REWRITE** (3): architecture.md, agents/overview.md, visualization.md
- **MAJOR UPDATE** (2): reference.md, strategy_experiments.md
- **TARGETED UPDATE** (5): README.md, data_model.md, rating_and_comparison.md, minicomputer_deployment.md, arena.md
- **LIGHT VERIFICATION** (3): cost_optimization.md, entity_diagram.md, experimental_framework.md
- **CONFIG UPDATE** (1): .claude/doc-mapping.json
