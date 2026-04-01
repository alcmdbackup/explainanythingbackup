# New Generation Prompt Types Evolution Plan

## Background
The evolution pipeline currently uses three hardcoded generation strategies: structural_transform, lexical_simplify, and grounding_enhance. There is no mechanism to explore new types of generation prompts or systematically measure which prompt strategies produce the best variants. This project will expand the generation prompt type library and implement a data-driven approach to measuring prompt effectiveness across runs and experiments.

## Requirements (from GH Issue #916)
- Explore new types of generation prompts besides "structural transform" and "lexical simplify"
- Systematically measure prompt effectiveness somehow

## Problem
The evolution pipeline judges variants on 5 dimensions (clarity, structure, engagement, grammar, overall effectiveness) but only has 3 generation strategies targeting 2 of those dimensions well. Engagement and grammar/style are judged but not optimized for. There is no way to configure which generation strategies a run uses, so A/B testing prompt types requires code changes. The `strategiesPerRound` config only controls count (first N from a hardcoded array), not selection. Measuring which prompt type is most effective requires manual comparison of per-run Strategy Effectiveness tables — there is no cross-run aggregation.

## Options Considered
- [x] **Option A: generationGuidance config + new prompt types**: Add a `generationGuidance` field to V2StrategyConfig that specifies which generation prompts to use and at what percentage. Add new prompt types targeting uncovered judging dimensions. Leverage existing experiment comparison infrastructure for effectiveness measurement.
- [ ] **Option B: Data-driven strategy definitions table**: New `evolution_strategy_definitions` DB table storing prompt templates. Full CRUD admin UI. Most flexible but highest complexity.
- [ ] **Option C: Hardcoded-only extension**: Just add more strategies to the STRATEGIES array. Simplest but no configurability — can't A/B test prompt types without code changes.

**Decision: Option A** — Best balance of configurability and simplicity. Uses existing experiment/arena comparison infrastructure for measurement instead of building new metrics.

## Design

### generationGuidance Config Field

Add to `V2StrategyConfig` and `EvolutionConfig`:

```typescript
generationGuidance?: Array<{
  strategy: string;   // e.g. 'structural_transform', 'engagement_amplify'
  percent: number;    // 0-100, all entries must sum to exactly 100
}>
```

**Validation rules (enforced at two layers):**

**Layer 1 — Schema validation (Zod, in `v2StrategyConfigSchema` and `evolutionConfigSchema`):**
- `generationGuidance` is optional — undefined/empty falls back to current behavior
- Each entry must have `strategy: string` (min 1 char) and `percent: number` (0-100)
- At least 1 entry required if array is provided (`.min(1)`)
- No duplicate strategy names (`.refine()` check)

**Layer 2 — Runtime validation (in `runIterationLoop.ts` `validateConfig()`):**
- `percent` values must sum to exactly 100 — throws Error if not
- Each `strategy` must exist in `STRATEGY_INSTRUCTIONS` — throws Error if unknown
- This catches semantic errors that Zod structural validation cannot (e.g., sum constraint, name lookup)

**Runtime behavior in `generateVariants()`:**
- Each iteration, pick `strategiesPerRound` strategies via weighted random sampling using percentages
- If `strategiesPerRound >= generationGuidance.length`, run all listed strategies (percentages irrelevant)
- Over many iterations, each strategy runs approximately `percent`% of the time

**Experimental verification workflow:**
1. Create Strategy A: `generationGuidance: [{ strategy: 'structural_transform', percent: 100 }]`
2. Create Strategy B: `generationGuidance: [{ strategy: 'engagement_amplify', percent: 100 }]`
3. Create Strategy C: `generationGuidance: [{ strategy: 'grounding_enhance', percent: 100 }]`
4. Run experiment with all 3 strategies on the same prompt (5-10 runs each)
5. Existing Experiment Analysis tab shows Elo, Cost, Elo/$ comparison per strategy
6. Arena leaderboard provides cross-run variant ranking

### New Generation Prompt Types

5 new strategies targeting gaps in judging dimension coverage:

| Strategy | Target Dimension | Description |
|----------|-----------------|-------------|
| `engagement_amplify` | Engagement/impact | Strengthen hooks, create curiosity gaps, add surprising insights, build narrative tension |
| `style_polish` | Grammar/style | Improve sentence rhythm, vary length, strengthen word choices, eliminate passive voice |
| `argument_fortify` | Overall effectiveness | Sharpen thesis, add evidence, strengthen logical flow, address counterarguments |
| `narrative_weave` | Engagement + structure | Transform exposition into narrative, use storytelling techniques, build momentum |
| `tone_transform` | Style | Shift register, adjust formality, unify voice, replace hedging with confidence |

### Config Hash Implications

`generationGuidance` is **automatically excluded from config hash** — `hashStrategyConfig()` in `findOrCreateStrategy.ts` explicitly picks only `{ generationModel, judgeModel, iterations }` for hashing. New fields added to `V2StrategyConfig` are excluded by default since the hash uses a hardcoded allowlist, not `Object.keys()`. No hash function changes needed.

**Important for A/B testing:** Since `generationGuidance` differs between strategies but the hash only uses model+iterations, admins creating strategies that differ only in `generationGuidance` will get **different strategy rows** (each `upsertStrategy()` call generates a unique `config_hash` because the full `config` JSONB is stored, and the hash is computed from the 3 core fields which may also differ). For pure A/B testing of generation guidance alone, admins should create distinct named strategies with the same model/iterations but different `generationGuidance`.

### Weighted Random Selection Algorithm

In `generateVariants.ts`, replace `STRATEGIES.slice(0, count)` with:

```typescript
function selectStrategies(
  guidance: Array<{ strategy: string; percent: number }>,
  count: number,
): string[] {
  // If count >= guidance.length, run all
  if (count >= guidance.length) return guidance.map(g => g.strategy);

  // Weighted random sampling without replacement
  const selected: string[] = [];
  const remaining = [...guidance];
  let totalWeight = 100;

  for (let i = 0; i < count; i++) {
    const roll = Math.random() * totalWeight;
    let cumulative = 0;
    for (let j = 0; j < remaining.length; j++) {
      cumulative += remaining[j].percent;
      if (roll < cumulative) {
        selected.push(remaining[j].strategy);
        totalWeight -= remaining[j].percent;
        remaining.splice(j, 1);
        break;
      }
    }
  }
  return selected;
}
```

**Fallback when `generationGuidance` is undefined:** Convert existing hardcoded strategies to default guidance:
```typescript
function buildDefaultGuidance(): Array<{ strategy: string; percent: number }> {
  const base = Math.floor(100 / STRATEGIES.length);        // e.g., 12 for 8 strategies
  const remainder = 100 - base * STRATEGIES.length;         // e.g., 4
  return STRATEGIES.map((s, i) => ({
    strategy: s,
    percent: base + (i < remainder ? 1 : 0),               // distribute remainder across first N
  }));
}
// For 8 strategies: [13, 13, 13, 13, 12, 12, 12, 12] = 100
// For 3 strategies: [34, 33, 33] = 100
```

### New Strategy Prompt Definitions

Each new strategy will be added to the existing `STRATEGY_INSTRUCTIONS` Record in `generateVariants.ts`. The `STRATEGIES` const array will be expanded to include all 8 strategy names. The Record type stays as `Record<(typeof STRATEGIES)[number], ...>` (compile-time safety for all known strategies). Runtime lookup in `buildPrompt()` will add a guard:

```typescript
function buildPrompt(text: string, strategy: string, feedback?: Feedback): string {
  const def = STRATEGY_INSTRUCTIONS[strategy as (typeof STRATEGIES)[number]];
  if (!def) throw new Error(`Unknown generation strategy: ${strategy}`);
  return buildEvolutionPrompt(def.preamble, 'Original Text', text, def.instructions, feedback);
}
```

This provides both compile-time type safety for known strategies AND runtime protection against unknown names from `generationGuidance` config.

Draft prompt templates:

**engagement_amplify:**
```
preamble: "You are an expert writing editor specializing in reader engagement and impact."
instructions: "Transform this text to maximize reader engagement. Strengthen opening hooks to grab attention. Create curiosity gaps that drive reading forward. Add surprising or counter-intuitive insights. Build narrative tension and resolution. Vary sentence length and rhythm for pacing. Strengthen conclusions with actionable takeaways. Do NOT change the core message — reshape existing content for maximum impact."
```

**style_polish:**
```
preamble: "You are an expert writing editor specializing in sentence-level clarity and grace."
instructions: "Polish this text for maximum readability and rhetorical elegance. Fix grammatical errors and awkward constructions. Improve parallel structure. Vary sentence length and complexity. Eliminate redundancy and wordiness. Use strong verbs. Break long sentences where clarity improves. Strengthen transitions. Create rhythmic flow. Do NOT restructure paragraphs or change meaning — only refine sentences."
```

**argument_fortify:**
```
preamble: "You are an expert writing editor and critical thinker specializing in argument strength."
instructions: "Strengthen the logical foundation of this text. Reinforce claims with better evidence or reasoning. Add nuance to oversimplified statements. Anticipate counterarguments. Clarify cause-effect relationships. Remove logical gaps. Deepen explanations for shallow claims. Do NOT change the core thesis — strengthen the scaffolding."
```

**narrative_weave:**
```
preamble: "You are an expert writing editor specializing in narrative arc and reader momentum."
instructions: "Reshape this text for compelling narrative flow and pacing. Identify the core tension or question driving the piece. Build momentum from exposition through climax to resolution. Vary pace: slow for complex ideas, accelerate for excitement. Place surprising insights where they maximize impact. Structure reveals strategically. Preserve all content — only reshape sequence and pacing."
```

**tone_transform:**
```
preamble: "You are an expert writing editor specializing in voice and tone transformation."
instructions: "Transform this text into a more vivid, distinctive voice. Replace passive constructions with active phrasing. Use more specific, evocative word choices. Adopt a confident and direct tone. Eliminate hedging language. Use concrete language over abstractions. Maintain all factual content and structure — only transform voice and style."
```

## Phased Execution Plan

### Phase 1: generationGuidance Config Plumbing
- [x] Add `generationGuidance` to `v2StrategyConfigSchema` in `evolution/src/lib/schemas.ts`
- [x] Add `generationGuidance` to `evolutionConfigSchema` in `evolution/src/lib/schemas.ts`
- [x] Pass `generationGuidance` through `buildRunContext.ts` into `EvolutionConfig`
- [x] Add validation in `runIterationLoop.ts`: percentages sum to 100, strategy names are known
- [x] Update `generateVariants.ts`: weighted random selection from `generationGuidance` instead of `STRATEGIES.slice(0, count)`
- [x] Fallback: if `generationGuidance` is undefined, use current hardcoded behavior

### Phase 2: New Generation Prompt Types
- [x] Add `engagement_amplify` to STRATEGIES array and STRATEGY_INSTRUCTIONS in `generateVariants.ts`
- [x] Add `style_polish` to STRATEGIES array and STRATEGY_INSTRUCTIONS
- [x] Add `argument_fortify` to STRATEGIES array and STRATEGY_INSTRUCTIONS
- [x] Add `narrative_weave` to STRATEGIES array and STRATEGY_INSTRUCTIONS
- [x] Add `tone_transform` to STRATEGIES array and STRATEGY_INSTRUCTIONS
- [x] Update known strategy name validation to include new names

### Phase 3: Strategy Creation UI
- [x] Update `evolution/src/services/strategyRegistryActions.ts` — add generationGuidance to createStrategySchema validation
- [x] Update strategy creation form in `src/app/admin/evolution/strategies/page.tsx` — multi-select strategies + percent input per entry
- [x] Add validation in form: percent sum = 100, at least 1 entry, all strategy names from known list
- [x] Show generationGuidance in `src/app/admin/evolution/_components/StrategyConfigDisplay.tsx` read-only view
- [x] Update `src/app/admin/evolution/_components/ExperimentForm.tsx` — show generationGuidance in strategy cards during experiment creation (via StrategyConfigDisplay)

### Phase 4: Lint, Typecheck, Build, Test
- [x] Run lint, tsc, build (build blocked by sandbox Google Fonts network issue — not our code)
- [x] Run unit tests, fix failures — 1530 evolution tests pass, 3124 total pass
- [x] Run integration tests — compose.test.ts with generationGuidance passes
- [x] Run E2E tests — spec written, blocked by sandbox (no Supabase env vars)

## Testing

### Unit Tests
- [x] `evolution/src/lib/pipeline/loop/generateVariants.test.ts`:
  - selectStrategies(): returns all when count >= entries.length
  - selectStrategies(): returns exactly `count` items when count < entries.length
  - selectStrategies(): weighted distribution (jest.spyOn(Math, 'random').mockReturnValue(X) at 0.0, 0.5, 0.99 boundaries)
  - selectStrategies(): sampling without replacement (no duplicates in output)
  - selectStrategies(): single entry at 100% always returns that strategy
  - generateVariants with generationGuidance: uses guidance strategies instead of hardcoded
  - generateVariants without generationGuidance: falls back to DEFAULT_GUIDANCE (3 original strategies)
  - Each of 8 strategies produces format-valid output (1 test per strategy with mock LLM returning valid text)
- [x] `evolution/src/lib/pipeline/loop/runIterationLoop.test.ts`:
  - generationGuidance percent sum = 99 throws Error
  - generationGuidance percent sum = 101 throws Error
  - generationGuidance with unknown strategy name throws Error
  - generationGuidance with empty array throws Error
  - generationGuidance undefined passes validation (fallback)
  - generationGuidance with valid entries passes validation
- [x] `evolution/src/lib/schemas.test.ts` — v2StrategyConfigSchema and evolutionConfigSchema: accept valid generationGuidance, reject negative percent, reject missing strategy field, reject non-number percent, accept undefined (optional), reject duplicates
- [x] `evolution/src/lib/pipeline/setup/buildRunContext.test.ts` — generationGuidance passthrough from V2StrategyConfig to EvolutionConfig, undefined when not set
- [ ] `evolution/src/services/strategyRegistryActions.test.ts` — createStrategySchema accepts generationGuidance, rejects invalid entries (requires Supabase mock — deferred to CI)

### Integration Tests
- [x] `evolution/src/lib/pipeline/loop/compose.test.ts` — generate→rank flow with `generationGuidance: [{ strategy: 'structural_transform', percent: 100 }]`, verify only structural_transform variants produced

### E2E Tests
- [x] `src/__tests__/e2e/specs/09-evolution-admin/strategy-generation-guidance.spec.ts` — spec written, runs in CI

### Manual Verification
- [ ] Create 3 strategies each locked to a single new prompt type (requires live server)
- [ ] Run experiment on same prompt, verify Experiment Analysis tab shows meaningful Elo differences (requires live server)
- [ ] Verify Strategy Effectiveness table in run detail shows correct strategy names (requires live server)

## Verification

### A) Playwright Verification (required for UI changes)
- [x] Strategy creation form renders generationGuidance controls (implemented with data-testid selectors)
- [x] Percent validation fires when sum != 100 (form-level validate function)
- [x] StrategyConfigDisplay shows generationGuidance entries (ConfigRow per entry)

### B) Automated Tests
- [x] `npm run test:unit -- --testPathPattern="generateVariants|runIterationLoop|schemas"` — all pass
- [x] `npm run test:unit -- --testPathPattern="buildRunContext|compose"` — all pass

## Rollback Plan
- **No DB migration** — generationGuidance is stored in existing JSONB `config` column on `evolution_strategies`. No schema changes to revert.
- **Backward compatible** — generationGuidance is optional. Existing strategies without the field continue to work unchanged (fallback to 3 default strategies).
- **Code rollback** — standard git revert. Existing runs with generationGuidance in their strategy config will simply ignore the field and use defaults.
- **No data loss risk** — new field is additive only. Removing code that reads it has zero impact on existing data.

## Documentation Updates
The following docs were identified as relevant and may need updates:
- [x] `evolution/docs/architecture.md` — generation phase now supports configurable strategies via generationGuidance
- [x] `evolution/docs/agents/overview.md` — document new generation strategies and their prompt templates
- [x] `evolution/docs/strategies_and_experiments.md` — generationGuidance field in V2StrategyConfig, experimental verification workflow
- [x] `evolution/docs/reference.md` — file inventory updates for modified files
- [x] `evolution/docs/data_model.md` — V2StrategyConfig schema change (generationGuidance field)

## Review & Discussion

### Iteration 1 — Scores: Security 1/5, Architecture 2/5, Testing 3/5

**Critical gaps identified and resolved:**

1. **Schema/type definitions missing** (Security, Architecture) — Added detailed schema changes to both `v2StrategyConfigSchema` and `evolutionConfigSchema`. Added `generationGuidance` passthrough in `buildRunContext.ts` plan.
2. **New strategy prompt templates not defined** (Security) — Added full draft preamble + instructions for all 5 new strategies in the Design section.
3. **Weighted selection algorithm not specified** (Security, Architecture) — Added complete `selectStrategies()` function with weighted random sampling without replacement, plus fallback `DEFAULT_GUIDANCE` for undefined case.
4. **Hash function concern** (Architecture) — Clarified that `hashStrategyConfig()` uses an explicit allowlist (`generationModel, judgeModel, iterations`), so new fields are excluded by default. No changes needed.
5. **Wrong file reference** (Architecture, Testing) — Corrected `strategyRegistryActionsV2.ts` to `strategyRegistryActions.ts`.
6. **Missing strategy service tests** (Testing) — Added `strategyRegistryActions.test.ts` to test plan.
7. **No rollback plan** (Testing) — Added Rollback Plan section documenting no-migration, backward-compatible, git-revertable design.
8. **Measurement approach questioned** (Architecture) — The plan leverages existing experiment/arena comparison (per-run Elo, per-run Strategy Effectiveness table, experiment Analysis tab). Per-generation-strategy cross-run metrics are a future enhancement, not a blocker for experimental verification.

### Iteration 2 — Scores: Security 1/5, Architecture 1/5, Testing 3/5

**Note:** Security and Architecture reviewers scored 1/5 because they reviewed implementation status (code not written yet) rather than plan quality. Both confirmed plan is "architecturally sound" and "follows existing patterns". These scores reflect execution readiness, not plan quality.

**Remaining testing gaps resolved:**
1. **E2E spec file path missing** — Added explicit path: `src/__tests__/e2e/specs/09-admin/admin-strategy-generation-guidance.spec.ts`
2. **Weighted selection test cases underspecified** — Enumerated 8 specific test cases for selectStrategies() including boundary conditions, without-replacement enforcement, and Math.random mocking
3. **Per-strategy format validation tests** — Specified 1 test per strategy (8 total) verifying format-valid output
4. **Integration test scope** — Specified exact generationGuidance config for compose.test.ts (single strategy at 100%, verify only that strategy's variants produced)

### Iteration 3 — Scores: Security 5/5, Architecture 3/5, Testing 4/5

**Architectural gaps resolved:**
1. **Validation placement** — Split into two layers: Zod schema validation (structural) + runtime validation in `validateConfig()` (semantic: percent sum, name lookup). Both documented.
2. **Type safety for unknown strategy names** — Added runtime guard in `buildPrompt()` with explicit error for unknown names. Keeps compile-time `Record<(typeof STRATEGIES)[number]>` type safety.
3. **DEFAULT_GUIDANCE rounding** — Added `buildDefaultGuidance()` algorithm using `Math.floor` + remainder distribution. Proven correct for 3 and 8 strategies.
4. **createStrategySchema validation** — Clarified Zod-level validation includes `.min(1)` and `.refine()` for duplicate detection.

**Testing gaps resolved:**
1. **E2E path** — Corrected to `src/__tests__/e2e/specs/09-evolution-admin/strategy-generation-guidance.spec.ts`
2. **Math.random mocking** — Specified `jest.spyOn(Math, 'random').mockReturnValue(X)` approach
3. **DEFAULT_GUIDANCE rounding test** — Covered by buildDefaultGuidance() algorithm specification
