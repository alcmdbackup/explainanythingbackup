# Iterative Editing Agent Plan

## Background

The evolution pipeline generates diverse article variants and ranks them via Elo competition, but no agent performs targeted, critique-driven editing of the current best variant. The ReflectionAgent scores the top 3 variants across 5 dimensions and produces specific examples and improvement notes — but nothing acts on that feedback surgically. The pipeline also lacks any open-ended review mechanism that could catch issues outside the predefined rubric dimensions.

## Problem

Editing quality improvements require a tight feedback loop: evaluate → identify weakness → fix → verify the fix didn't regress the article → repeat. The current pipeline lacks this loop. GenerationAgent creates from scratch, EvolutionAgent mutates genetically, and DebateAgent synthesizes from two parents — none take a single variant and iteratively refine it based on specific feedback. Additionally, the existing ReflectionAgent is strictly rubric-bound (5 fixed dimensions), so issues like misleading analogies or repetitive arguments are never surfaced.

## Options Considered

See research doc for full analysis. **Approach A: New IterativeEditingAgent in COMPETITION phase** was selected because:
1. Follows established `PipelineAgent` pattern exactly
2. Uses new `compareWithDiff()` for blind, holistic diff-based judging
3. Feature-flaggable, budget-controlled, and checkpointed via existing infrastructure
4. Minimal changes to pipeline orchestration (one new field in `PipelineAgents`, one flag in `PhaseConfig`)

## Phased Execution Plan

### Phase 1: Core Agent Implementation

**Goal**: Implement `IterativeEditingAgent` with the evaluate→edit→judge loop, passing unit tests.

#### 1A. Create `iterativeEditingAgent.ts`

**File**: `src/lib/evolution/agents/iterativeEditingAgent.ts`

Top-level comment: `// Iterative editing agent that uses critique-driven edits with blind LLM-as-judge gating.`

```typescript
import { AgentBase } from './base';
import type {
  AgentResult, ExecutionContext, PipelineState, AgentPayload, Critique,
} from '../types';
import { BudgetExceededError } from '../types';
import { compareWithDiff } from '../diffComparison';
import type { DiffComparisonResult } from '../diffComparison';
import { getCritiqueForVariant, CRITIQUE_DIMENSIONS } from './reflectionAgent';
import { FORMAT_RULES } from './formatRules';
import { validateFormat } from './formatValidator';

/** Config for the iterative editing agent. */
export interface IterativeEditingConfig {
  /** Maximum edit→judge cycles per execution (default: 3). */
  maxCycles: number;
  /** Consecutive judge rejections before stopping (default: 3). */
  maxConsecutiveRejections: number;
  /** Rubric dimension threshold — stop if all dimensions >= this (default: 8). */
  qualityThreshold: number;
}

export const DEFAULT_ITERATIVE_EDITING_CONFIG: IterativeEditingConfig = {
  maxCycles: 3,
  maxConsecutiveRejections: 3,
  qualityThreshold: 8,
};
```

**Agent class structure**:

```typescript
export class IterativeEditingAgent extends AgentBase {
  readonly name = 'iterativeEditing';
  private readonly config: IterativeEditingConfig;

  constructor(config?: Partial<IterativeEditingConfig>) {
    super();
    this.config = { ...DEFAULT_ITERATIVE_EDITING_CONFIG, ...config };
  }

  canExecute(state: PipelineState): boolean {
    // Need at least one variant with a critique
    if (!state.allCritiques || state.allCritiques.length === 0) return false;
    const top = state.getTopByElo(1)[0];
    if (!top) return false;
    return getCritiqueForVariant(top.id, state) !== null;
  }

  async execute(ctx: ExecutionContext): Promise<AgentResult> {
    // See detailed flow below
  }

  estimateCost(payload: AgentPayload): number {
    // Per cycle: 1 rubric critique + 1 open review + 1 edit + 2 judge calls (diff-based)
    // Cycle 1 skips rubric (reuses ReflectionAgent output)
    // Judge calls use diff (much shorter than full article), so judge cost is lower
    const textLen = payload.originalText.length;
    const genCost = ((textLen + 500) / 4 / 1_000_000) * 0.80 + (textLen / 4 / 1_000_000) * 4.0;
    const diffLen = Math.ceil(textLen * 0.15); // diff is ~15% of article for targeted edits
    const judgeCost = ((diffLen + 300) / 4 / 1_000_000) * 0.10; // nano model on diff
    return (genCost * 2 + judgeCost * 2) * this.config.maxCycles; // conservative upper bound
  }
}
```

**`execute()` detailed flow**:

```typescript
async execute(ctx: ExecutionContext): Promise<AgentResult> {
  const { state, llmClient, logger, costTracker } = ctx;
  let variantsAdded = 0;
  let consecutiveRejections = 0;

  // Get the top variant and its latest critique
  let current = state.getTopByElo(1)[0];
  let currentCritique = getCritiqueForVariant(current.id, state);

  // Initial open-ended review (the rubric critique is already in state from ReflectionAgent)
  let openReview = await this.runOpenReview(current.text, llmClient);

  for (let cycle = 0; cycle < this.config.maxCycles; cycle++) {
    // Check stopping: all dimensions >= threshold AND open review found nothing
    if (this.qualityThresholdMet(currentCritique) && !openReview) {
      logger.info('Quality threshold met, stopping', { cycle });
      break;
    }
    if (consecutiveRejections >= this.config.maxConsecutiveRejections) {
      logger.info('Max consecutive rejections reached, stopping', { cycle, consecutiveRejections });
      break;
    }

    // Pick edit target from combined rubric + open review
    const editTarget = this.pickEditTarget(currentCritique, openReview);
    if (!editTarget) break;

    // EDIT: generate targeted fix
    const editPrompt = buildEditPrompt(current.text, editTarget);
    const editedText = await llmClient.complete(editPrompt, this.name);

    // Validate format
    const formatResult = validateFormat(editedText);
    if (!formatResult.valid) {
      logger.warn('Edit failed format validation', { cycle, issues: formatResult.issues });
      consecutiveRejections++;
      continue;
    }

    // JUDGE: blind holistic diff-based comparison (no info about edit target)
    // Note: compareWithDiff does NOT use ComparisonCache — the diff comparison has its own
    // semantics (ACCEPT/REJECT/UNSURE) incompatible with the A/B ComparisonCache (winner/loser).
    const callLLM = (prompt: string) => llmClient.complete(prompt, this.name, { model: ctx.payload.config.judgeModel });
    const result = await compareWithDiff(current.text, editedText, callLLM);

    const accepted = result.verdict === 'ACCEPT';
    if (accepted) {
      // Create new variant
      const editedVariant = {
        id: crypto.randomUUID(),
        text: editedText,
        version: current.version + 1,
        parentIds: [current.id],
        strategy: `critique_edit_${editTarget.dimension || 'open'}`,
        createdAt: Date.now() / 1000,
        iterationBorn: state.iteration,
      };
      state.addToPool(editedVariant);
      variantsAdded++;
      consecutiveRejections = 0;
      current = editedVariant;

      logger.info('Edit accepted', { cycle, target: editTarget.dimension, verdict: result.verdict, confidence: result.confidence });

      // RE-EVALUATE: fresh rubric + open review on the accepted text
      currentCritique = await this.runInlineCritique(editedText, current.id, llmClient);
      openReview = await this.runOpenReview(editedText, llmClient);
    } else {
      consecutiveRejections++;
      logger.info('Edit rejected by judge', { cycle, target: editTarget.dimension, verdict: result.verdict, confidence: result.confidence });
    }
  }

  return {
    agentType: this.name,
    success: variantsAdded > 0,
    costUsd: costTracker.getAgentCost(this.name),
    variantsAdded,
  };
}
```

**Private methods**:

- `runOpenReview(text, llmClient)` — Single LLM call: "Read this article and identify the 2-3 most impactful improvements. Do NOT use a rubric. Focus on what strikes you as a reader." Parses JSON response for `suggestions` array. Wraps JSON.parse in try/catch — returns null on parse failure (agent continues with rubric critique only).
- `runInlineCritique(text, variantId, llmClient)` — Builds the same critique prompt structure as `reflectionAgent.ts` (NOTE: `buildCritiquePrompt` is a module-private function in reflectionAgent.ts and cannot be imported — duplicate the prompt template inline using `CRITIQUE_DIMENSIONS`). Parses JSON response into `Critique` object, setting `reviewer: 'llm'` explicitly (matching reflectionAgent.ts `parseCritiqueResponse` pattern). Wraps JSON.parse in try/catch — returns null on parse failure so the loop can continue with just the open review.
- `pickEditTarget(critique, openReview)` — Combines rubric weaknesses (sorted by score ascending) with open-ended suggestions. Returns an `EditTarget` with `{ dimension?: string; description: string; badExamples?: string[] }`.
- `qualityThresholdMet(critique)` — Returns true if all dimension scores >= `qualityThreshold`.

**Prompt builders** (private functions in the same file):

- `buildEditPrompt(text, target)` — Contains: variant text, target weakness (dimension name + score + bad examples + notes OR open-ended suggestion), FORMAT_RULES, instructions to fix ONLY the weakness while preserving everything else.
- `buildOpenReviewPrompt(text)` — Contains: variant text, instructions for freeform improvement suggestions with no rubric.

#### 1B. Unit tests

**File**: `src/lib/evolution/agents/iterativeEditingAgent.test.ts`

Follow the existing test patterns (see `debateAgent.test.ts`):

| Test case | What it verifies |
|-----------|------------------|
| `accepts edit when judge returns ACCEPT` | Happy path: edit generated, diff judge returns ACCEPT, variant added to pool |
| `rejects edit when judge returns REJECT` | Edit not added, consecutiveRejections incremented |
| `rejects edit when judge returns UNSURE` | UNSURE treated as rejection — insufficient evidence of improvement |
| `stops after maxConsecutiveRejections` | 3 rejections in a row → agent stops, returns success=false |
| `stops when quality threshold met` | All dimensions ≥ 8 → agent stops early |
| `stops at maxCycles` | Exactly N cycles run |
| `chains edits — second edit uses accepted text` | After accept, next edit prompt uses V₁ not V₀ |
| `re-evaluates after accepted edit` | Inline critique and open review called on new text |
| `skips on format validation failure` | Bad format → incrementsRejections, continues |
| `canExecute returns false without critiques` | No state.allCritiques → false |
| `canExecute returns false without top variant` | Empty pool → false |
| `propagates BudgetExceededError` | BudgetExceededError not caught, re-thrown |
| `judge prompt has no edit context` | Verify diff comparison prompt contains only CriticMarkup diff + generic criteria (spy on compareWithDiff) |
| `strategy name encodes target dimension` | Variant strategy is `critique_edit_clarity` etc. |
| `direction reversal catches framing bias` | When both passes return ACCEPT or both REJECT → result is UNSURE |
| `handles open review JSON parse failure gracefully` | Malformed LLM response → runOpenReview returns null, agent continues with rubric only |
| `handles inline critique JSON parse failure gracefully` | Malformed LLM response → runInlineCritique returns null, agent picks from open review only |

Use `makeMockLLMClient()` with queued responses. Mock `compareWithDiff` to control accept/reject behavior.

#### 1C. Implement `compareWithDiff()` in a NEW file

**File**: `src/lib/evolution/diffComparison.ts` (**NEW** — separate file to avoid ESM contamination of comparison.ts)

**Why a separate file**: `unified` and `remark-parse` are ESM-only packages. Adding them to `comparison.ts` (even via dynamic import) would risk breaking the 15+ existing Jest tests in `comparison.test.ts`. Following the codebase pattern in `aiSuggestion.ts`, we use dynamic `import()` and isolate the ESM dependency in its own module.

```typescript
// Diff-based comparison using CriticMarkup and direction reversal for bias mitigation.

import { RenderCriticMarkupFromMDAstDiff } from '../../editorFiles/markdownASTdiff/markdownASTdiff';

/**
 * Parse markdown string to MDAST root node.
 * Uses dynamic import() for unified/remark-parse (ESM-only packages),
 * matching the pattern in aiSuggestion.ts:safeParseMarkdown().
 * Returns null on parse failure (malformed markdown from LLM output).
 */
async function parseToMdast(markdown: string): Promise<unknown | null> {
  try {
    const { unified } = await import('unified');
    const { default: remarkParse } = await import('remark-parse');
    return unified().use(remarkParse).parse(markdown);
  } catch {
    return null;
  }
}

/** Result of a diff-based comparison using direction reversal. */
export interface DiffComparisonResult {
  verdict: 'ACCEPT' | 'REJECT' | 'UNSURE';
  confidence: number;
  changesFound: number;
}

/**
 * Evaluates whether targeted edits improve an article by generating a CriticMarkup diff
 * and running 2-pass direction reversal (forward diff + reverse diff) for bias mitigation.
 */
export async function compareWithDiff(
  textBefore: string,
  textAfter: string,
  callLLM: (prompt: string) => Promise<string>,
): Promise<DiffComparisonResult> {
  // Parse markdown strings to AST nodes (RenderCriticMarkupFromMDAstDiff takes MdastNode, not strings)
  const beforeAst = await parseToMdast(textBefore);
  const afterAst = await parseToMdast(textAfter);

  // If either parse failed, we can't generate a diff — return UNSURE
  if (!beforeAst || !afterAst) {
    return { verdict: 'UNSURE', confidence: 0, changesFound: 0 };
  }

  // Generate CriticMarkup diffs in both directions
  // Cast to 'any' because MdastNode is not exported from markdownASTdiff;
  // Root from 'mdast' is structurally compatible (duck typing).
  const forwardDiff = RenderCriticMarkupFromMDAstDiff(beforeAst as any, afterAst as any);
  const reverseDiff = RenderCriticMarkupFromMDAstDiff(afterAst as any, beforeAst as any);

  // Count changes (for metadata)
  const changesFound = (forwardDiff.match(/\{[+\-~]/g) || []).length;

  if (changesFound === 0) {
    return { verdict: 'UNSURE', confidence: 0, changesFound: 0 };
  }

  // Pass 1: Forward (original → edited) — "Should these changes be accepted?"
  const forwardPrompt = buildDiffJudgePrompt(forwardDiff);
  const forwardResult = parseDiffVerdict(await callLLM(forwardPrompt));

  // Pass 2: Reverse (edited → original) — "Should these changes be accepted?"
  const reversePrompt = buildDiffJudgePrompt(reverseDiff);
  const reverseResult = parseDiffVerdict(await callLLM(reversePrompt));

  // Interpret 2-pass results (see research doc for truth table)
  return interpretDirectionReversal(forwardResult, reverseResult, changesFound);
}

function buildDiffJudgePrompt(criticMarkupDiff: string): string {
  return `You are an expert writing evaluator. The following article contains proposed changes
marked with CriticMarkup notation:

- {--deleted text--} = text that would be removed
- {++inserted text++} = text that would be added
- {~~old text~>new text~~} = text that would be replaced

## Article with Proposed Changes
${criticMarkupDiff}

## Evaluation Criteria
Consider whether the proposed changes, taken as a whole:
- Improve or harm clarity and readability
- Improve or harm structure and flow
- Improve or harm engagement and impact
- Improve or harm grammar and style
- Improve or harm overall effectiveness

## Instructions
Respond with ONLY one of these exact answers:
- "ACCEPT" if the changes improve the article overall
- "REJECT" if the changes harm the article overall
- "UNSURE" if the changes are neutral or have mixed effects`;
}

function parseDiffVerdict(response: string): 'ACCEPT' | 'REJECT' | 'UNSURE' {
  const upper = response.trim().toUpperCase();
  if (upper.includes('ACCEPT')) return 'ACCEPT';
  if (upper.includes('REJECT')) return 'REJECT';
  return 'UNSURE';
}

function interpretDirectionReversal(
  forward: 'ACCEPT' | 'REJECT' | 'UNSURE',
  reverse: 'ACCEPT' | 'REJECT' | 'UNSURE',
  changesFound: number,
): DiffComparisonResult {
  // Consistent: forward=ACCEPT, reverse=REJECT → edit improves article
  if (forward === 'ACCEPT' && reverse === 'REJECT') {
    return { verdict: 'ACCEPT', confidence: 1.0, changesFound };
  }
  // Consistent: forward=REJECT, reverse=ACCEPT → edit harms article
  if (forward === 'REJECT' && reverse === 'ACCEPT') {
    return { verdict: 'REJECT', confidence: 1.0, changesFound };
  }
  // Inconsistent: both ACCEPT or both REJECT → framing bias
  if (forward === reverse && forward !== 'UNSURE') {
    return { verdict: 'UNSURE', confidence: 0.5, changesFound };
  }
  // One or both UNSURE
  return { verdict: 'UNSURE', confidence: 0.3, changesFound };
}
```

**Unit tests for `compareWithDiff`** (`src/lib/evolution/diffComparison.test.ts`):

Mock only `unified` via `jest.mock('unified')` — do NOT mock `remark-parse` separately (it is consumed inside the `.use()` chain and never directly imported by the test subject). Also mock `RenderCriticMarkupFromMDAstDiff` via `jest.mock('../../editorFiles/markdownASTdiff/markdownASTdiff')` to return controlled CriticMarkup strings. This matches the proven `aiSuggestion.pipeline.test.ts` pattern where only `unified` is mocked.

| Test case | What it verifies |
|-----------|------------------|
| `returns ACCEPT when forward=ACCEPT, reverse=REJECT` | Consistent improvement signal |
| `returns REJECT when forward=REJECT, reverse=ACCEPT` | Consistent regression signal |
| `returns UNSURE when both passes ACCEPT` | Catches accept bias |
| `returns UNSURE when both passes REJECT` | Catches reject bias |
| `returns UNSURE when either pass is UNSURE` | Uncertain pass → uncertain result |
| `returns UNSURE with 0 changes` | No-op diff shortcircuits |
| `generates CriticMarkup diff with correct direction` | Verifies forward vs reverse diff content |
| `prompt contains no edit context` | Only CriticMarkup diff + generic criteria in prompt |

### Phase 2: Pipeline Integration

**Goal**: Wire the agent into the full pipeline so it runs in COMPETITION phase.

#### 2A. Add to `PipelineAgents` interface

**File**: `src/lib/evolution/core/pipeline.ts` (line 296)

```typescript
export interface PipelineAgents {
  generation: PipelineAgent;
  calibration: PipelineAgent;
  tournament: PipelineAgent;
  evolution: PipelineAgent;
  reflection?: PipelineAgent;
  debate?: PipelineAgent;
  iterativeEditing?: PipelineAgent;  // NEW
  proximity?: PipelineAgent;
  metaReview?: PipelineAgent;
}
```

#### 2B. Add `runIterativeEditing` flag to `PhaseConfig`

**File**: `src/lib/evolution/core/supervisor.ts` (line 16)

```typescript
export interface PhaseConfig {
  // ...existing fields...
  runIterativeEditing: boolean;  // NEW
  // ...existing fields...
}
```

Update `getPhaseConfig()` — add `runIterativeEditing` to **both** return objects:

```typescript
// In EXPANSION return (line ~156):
return {
  phase: 'EXPANSION',
  // ...existing fields...
  runIterativeEditing: false,  // NEW — never run during EXPANSION
};

// In COMPETITION return (line ~172):
return {
  phase: 'COMPETITION',
  // ...existing fields...
  runIterativeEditing: true,  // NEW — run during COMPETITION
};
```

TypeScript will enforce completeness — missing the field in either return object causes a compile error.

#### 2C. Add agent invocation in `executeFullPipeline`

**File**: `src/lib/evolution/core/pipeline.ts`

Insert after the Reflection block (line 414) and before Debate (line 417):

```typescript
// === Iterative Editing (COMPETITION only — optional) ===
if (config.runIterativeEditing && agents.iterativeEditing) {
  if (options.featureFlags?.iterativeEditingEnabled === false) {
    logger.info('Iterative editing agent disabled by feature flag', { iteration: ctx.state.iteration });
  } else {
    await runAgent(runId, agents.iterativeEditing, ctx, phase, logger);
  }
}
```

#### 2D. Add feature flag

**File**: `src/lib/evolution/core/featureFlags.ts`

```typescript
export interface EvolutionFeatureFlags {
  // ...existing fields...
  iterativeEditingEnabled: boolean;  // NEW
}

export const DEFAULT_EVOLUTION_FLAGS: EvolutionFeatureFlags = {
  // ...existing fields...
  iterativeEditingEnabled: true,  // NEW
};

const FLAG_MAP: Record<string, keyof EvolutionFeatureFlags> = {
  // ...existing entries...
  evolution_iterative_editing_enabled: 'iterativeEditingEnabled',  // NEW
};
```

**Note on DB migration**: The feature flag defaults to `true` (enabled) in code. To disable it via Supabase, a row must be inserted into the `feature_flags` table: `INSERT INTO feature_flags (name, enabled) VALUES ('evolution_iterative_editing_enabled', false)`. No migration is required for the flag to work at its default (enabled) state — a migration is only needed if we want the ability to disable it remotely.

#### 2E. Add budget cap

**File**: `src/lib/evolution/config.ts`

```typescript
budgetCaps: {
  generation: 0.25,
  calibration: 0.15,    // reduced from 0.20
  tournament: 0.25,
  evolution: 0.15,       // reduced from 0.20
  reflection: 0.05,
  debate: 0.05,
  iterativeEditing: 0.10, // NEW — 10% of total budget
},
```

Note: Evolution reduced from 20% to 15% and calibration from 20% to 15% to make room. Total remains 100%. At $5.00 total budget → $0.50 for iterative editing → ~9 pipeline iterations at $0.052/iter.

#### 2F. Export from index.ts

**File**: `src/lib/evolution/index.ts`

```typescript
export { IterativeEditingAgent, DEFAULT_ITERATIVE_EDITING_CONFIG } from './agents/iterativeEditingAgent';
export type { IterativeEditingConfig } from './agents/iterativeEditingAgent';
export { compareWithDiff } from './diffComparison';
export type { DiffComparisonResult } from './diffComparison';
```

#### 2G. Wire agent creation in callers

**File 1**: `scripts/evolution-runner.ts`
- Add `iterativeEditing: new IterativeEditingAgent()` to the agents object passed to `executeFullPipeline`.

**File 2**: `scripts/run-evolution-local.ts` (has its own orchestration, separate from `executeFullPipeline`)
- Add `iterativeEditing: PipelineAgent;` to the local `NamedAgents` interface (line 531)
- Add `iterativeEditing: new IterativeEditingAgent()` to `buildAgents()` (line 542)
- Add entry to the `steps` array in `runFullPipeline()` (line 643), inserting after reflection and before debate:
  ```typescript
  { run: phaseConfig.runReflection, agent: agents.reflection },
  { run: phaseConfig.runIterativeEditing, agent: agents.iterativeEditing },  // NEW
  { run: phaseConfig.runDebate, agent: agents.debate },
  ```

**File 3**: `src/lib/services/evolutionActions.ts`
- `triggerEvolutionRunAction` currently uses `executeMinimalPipeline` (generation + calibration only), so iterativeEditing wiring is NOT needed here. However, if `applyWinnerAction` or other functions construct full agent sets, those should also include the new agent. Verify during implementation.

#### 2H. Pipeline integration tests

Add to existing `src/lib/evolution/core/pipeline.test.ts` (or `supervisor.test.ts`):

| Test case | What it verifies |
|-----------|------------------|
| `PhaseConfig returns runIterativeEditing=true in COMPETITION` | Supervisor returns correct config |
| `PhaseConfig returns runIterativeEditing=false in EXPANSION` | Not run during EXPANSION |
| `iterativeEditing agent skipped when feature flag disabled` | Feature flag gating works |
| `iterativeEditing agent skipped when not provided` | Optional field, no crash |
| `agent runs after reflection and before debate` | Correct execution order |

### Phase 3: Open Review Prompt & Integration

**Goal**: Implement the open-ended (non-rubric) review and the combined edit-target selection.

#### 3A. Open review prompt

```typescript
function buildOpenReviewPrompt(text: string): string {
  return `You are an expert writing critic. Read this article and identify the 2-3 most impactful improvements that could be made.

Do NOT use a rubric or fixed dimensions. Focus on what strikes you as a reader — what would make this article meaningfully better?

## Article
"""${text}"""

## Output Format (JSON)
{
  "suggestions": [
    "Specific improvement suggestion 1",
    "Specific improvement suggestion 2"
  ]
}

Output ONLY valid JSON, no other text.`;
}
```

#### 3B. Edit prompt

```typescript
interface EditTarget {
  dimension?: string;       // rubric dimension (e.g., 'clarity') or undefined for open-ended
  description: string;      // human-readable description of the weakness
  score?: number;           // rubric score (1-10) if from rubric
  badExamples?: string[];   // specific quotes from the text
  notes?: string;           // additional context
}

function buildEditPrompt(text: string, target: EditTarget): string {
  const weaknessSection = target.dimension
    ? `## Weakness to Fix: ${target.dimension.toUpperCase()} (score: ${target.score}/10)
Problems identified:
${target.badExamples?.map(e => `- "${e}"`).join('\n') || '- See notes below'}
${target.notes ? `Notes: ${target.notes}` : ''}`
    : `## Issue to Fix
${target.description}`;

  return `You are a surgical writing editor. Fix ONLY the identified weakness while preserving all other qualities of the text.

## Text to Edit
${text}

${weaknessSection}

## Instructions
- Rewrite ONLY the sections exhibiting this weakness
- Do NOT alter sections that are working well
- Preserve structure, tone, and all other qualities
- Keep the same overall length (within 10%)

${FORMAT_RULES}

Output ONLY the complete revised text, nothing else.`;
}
```

#### 3C. Edit target selection logic

```typescript
// Instance field on the agent class:
private attemptedTargets = new Set<string>();

// Reset at the start of execute():
this.attemptedTargets.clear();

private pickEditTarget(critique: Critique | null, openReview: string[] | null): EditTarget | null {
  const targets: EditTarget[] = [];

  // Add rubric-based targets (dimensions scoring < qualityThreshold)
  if (critique) {
    const sorted = Object.entries(critique.dimensionScores)
      .filter(([, score]) => score < this.config.qualityThreshold)
      .sort((a, b) => a[1] - b[1]); // weakest first

    for (const [dim, score] of sorted) {
      targets.push({
        dimension: dim,
        description: `Improve ${dim}`,
        score,
        badExamples: critique.badExamples[dim],
        notes: critique.notes[dim],
      });
    }
  }

  // Add open-ended targets
  if (openReview && openReview.length > 0) {
    for (const suggestion of openReview) {
      targets.push({ description: suggestion });
    }
  }

  // Return the highest-priority target not yet attempted this execution
  const key = (t: EditTarget) => t.dimension || t.description;
  const unattempted = targets.filter(t => !this.attemptedTargets.has(key(t)));
  const pick = unattempted[0] ?? null;
  if (pick) this.attemptedTargets.add(key(pick));
  return pick;
}

### Phase 4: Run Verification & Documentation

**Goal**: End-to-end verification and documentation updates.

#### 4A. Local CLI verification

```bash
# Mock mode — verify agent runs in pipeline without real LLM calls
npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --mock --full --iterations 5

# Real LLM mode — verify actual editing quality
npx tsx scripts/run-evolution-local.ts --file docs/sample_evolution_content/filler_words.md --full --iterations 5
```

Check logs for:
- `Edit accepted` / `Edit rejected by judge` messages with `verdict: ACCEPT/REJECT/UNSURE`
- Strategy names like `critique_edit_clarity`, `critique_edit_open` in variant listing
- Agent cost within budget cap
- Direction reversal consistency in judge calls

#### 4B. Run all existing tests

```bash
npm run test -- --testPathPattern='evolution'
npm run lint
npx tsc --noEmit
```

Ensure no regressions in existing agent tests, pipeline tests, or supervisor tests.

#### 4C. Update feature deep dive

**File**: `docs/feature_deep_dives/iterative_editing_agent.md`

Fill in the template created during `/initialize` with:
- Overview of the evaluate→edit→judge loop
- Key files listing
- Data flow diagram
- Configuration reference
- Interaction with ReflectionAgent

**File**: `docs/feature_deep_dives/evolution_pipeline.md`

Add IterativeEditingAgent to:
- Agent listing table
- COMPETITION phase agent order diagram
- Agent interaction pattern table (reads: allCritiques, pool top-1; writes: pool)
- Key files section (agents table)

#### 4D. Update architecture docs

**File**: `docs/docs_overall/architecture.md`

No changes needed — the evolution pipeline section already links to feature deep dives.

## Files Modified

| File | Change |
|------|--------|
| `src/lib/evolution/agents/iterativeEditingAgent.ts` | **NEW** — agent implementation |
| `src/lib/evolution/agents/iterativeEditingAgent.test.ts` | **NEW** — unit tests |
| `src/lib/evolution/diffComparison.ts` | **NEW** — `compareWithDiff()`, `DiffComparisonResult`, `buildDiffJudgePrompt()`, `parseDiffVerdict()`, `interpretDirectionReversal()` |
| `src/lib/evolution/diffComparison.test.ts` | **NEW** — unit tests for diff comparison |
| `src/lib/evolution/core/pipeline.ts` | Add `iterativeEditing?` to `PipelineAgents`, invoke in loop |
| `src/lib/evolution/core/supervisor.ts` | Add `runIterativeEditing` to `PhaseConfig`, set in `getPhaseConfig()` |
| `src/lib/evolution/core/featureFlags.ts` | Add `iterativeEditingEnabled` flag |
| `src/lib/evolution/config.ts` | Add `iterativeEditing` budget cap, rebalance others |
| `src/lib/evolution/index.ts` | Export new agent, config, and diffComparison |
| `scripts/evolution-runner.ts` | Wire `new IterativeEditingAgent()` |
| `scripts/run-evolution-local.ts` | Wire `new IterativeEditingAgent()` in NamedAgents, buildAgents(), and steps array |
| `docs/feature_deep_dives/iterative_editing_agent.md` | Fill in deep dive |
| `docs/feature_deep_dives/evolution_pipeline.md` | Add agent to docs |

**Note**: `src/lib/services/evolutionActions.ts` does NOT need changes — `triggerEvolutionRunAction` uses `executeMinimalPipeline` (generation + calibration only).

## Testing

### Unit Tests (Phase 1)
- `iterativeEditingAgent.test.ts` — 17 test cases covering accept/reject/unsure/stop/chain/format/budget/canExecute/blindness/direction-reversal/json-parse-failures
- `diffComparison.test.ts` — 8 test cases covering `compareWithDiff` direction reversal logic, bias detection, no-op diff, and prompt blindness (jest.mock unified/remark-parse to avoid ESM issues)

### Pipeline Integration Tests (Phase 2)
- `pipeline.test.ts` or `supervisor.test.ts` — 5 test cases covering PhaseConfig, feature flag, execution order

### Manual Verification (Phase 4)
- Run local CLI in mock mode → verify agent executes and produces variants
- Run local CLI in real LLM mode → verify edit quality and judge blindness
- Check admin dashboard → verify variants with `critique_edit_*` strategies appear in lineage

## Documentation Updates

| File | Update |
|------|--------|
| `docs/feature_deep_dives/iterative_editing_agent.md` | Fill complete deep dive |
| `docs/feature_deep_dives/evolution_pipeline.md` | Add agent to pipeline docs, update diagrams |
