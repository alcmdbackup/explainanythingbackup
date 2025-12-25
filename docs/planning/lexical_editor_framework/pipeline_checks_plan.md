# AI Suggestions Pipeline - Validation & Reliability Improvements

## Executive Summary

After analyzing the 4-step AI suggestions pipeline, I've identified **15 validation gaps** across the pipeline that can cause broken suggestions. This document outlines concrete improvements organized by:

1. **Prompt improvements** - Better instructions to reduce malformed output
2. **Inter-step validation** - Catch errors before they propagate
3. **Output validation** - Verify final output integrity
4. **Recovery mechanisms** - Graceful handling of failures

---

## Current Pipeline Gaps Analysis

### Step 1: Generate AI Suggestions
**Current validation**: Zod schema via OpenAI structured output
**Gaps identified**:
- Schema allows empty strings as content: `{edits: ["", "... existing text ...", ""]}`
- No validation that content is semantically meaningful
- Prompt ambiguity: "You can start with either" vs schema requiring even=content

### Step 2: Apply AI Suggestions
**Current validation**: None
**Gaps identified**:
- Receives STRING representation of Step 1 JSON (not parsed/validated)
- No verification that `... existing text ...` markers were correctly expanded
- No check that output contains content from original
- LLM can hallucinate entirely new content

### Step 3: Generate AST Diff
**Current validation**: AST structure checks
**Gaps identified**:
- No validation that CriticMarkup syntax is well-formed
- Special characters in content can break `{++braces{++}` patterns
- No depth limit on recursive diff operations

### Step 4: Preprocess CriticMarkup
**Current validation**: Format normalization only
**Gaps identified**:
- Assumes Step 3 output is valid CriticMarkup
- No regex validation of CriticMarkup patterns before processing
- Multiline `<br>` replacement can create invalid markdown

---

## Recommended Improvements

### A. Prompt Improvements (Step 1 & 2)

#### A1. Stricter Step 1 Prompt - Add Explicit Constraints
**File**: `src/editorFiles/aiSuggestion.ts:53-98`

Add to `<rules>` section:
```
- Each content section must contain at least 10 characters of actual text
- Never output empty strings as content - if no edit needed, use marker instead
- Content should be complete sentences, not fragments
- Preserve exact markdown formatting including headings (#), lists (-/*), links
```

Add negative examples:
```
INVALID examples - do NOT output:
{
  "edits": ["", "... existing text ..."]  // Empty content
}
{
  "edits": ["word", "... existing text ..."]  // Fragment, not sentence
}
```

#### A2. Improve Step 2 Prompt - Add Verification Instructions
**File**: `src/editorFiles/aiSuggestion.ts:145-173`

Add verification rules:
```
VERIFICATION CHECKLIST (apply before outputting):
1. Your output length should be within 20% of the original content length
2. Every "... existing text ..." marker should expand to substantial unchanged content
3. If the edit suggestions seem to delete most of the content, that's likely an error
4. Preserve ALL headings from the original unless explicitly asked to remove them
5. Your output should be valid markdown - check for unclosed formatting
```

### B. Inter-Step Validation (New Code)

#### B1. Add Step 1 Output Validator
**Location**: After Step 1, before Step 2 in `runAISuggestionsPipeline()`
**File**: `src/editorFiles/aiSuggestion.ts:~220`

```typescript
// New validation function
function validateStep1Output(output: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  try {
    const parsed = JSON.parse(output);

    // Check for empty content segments
    parsed.edits.forEach((edit: string, i: number) => {
      if (i % 2 === 0 && edit.trim().length < 10) {
        issues.push(`Content segment ${i} is too short: "${edit.slice(0, 20)}..."`);
      }
    });

    // Check for balanced markdown
    const content = parsed.edits.filter((_: string, i: number) => i % 2 === 0).join('');
    if ((content.match(/\*\*/g) || []).length % 2 !== 0) {
      issues.push('Unbalanced bold markers (**)');
    }

  } catch (e) {
    issues.push(`JSON parse failed: ${e}`);
  }

  return { valid: issues.length === 0, issues };
}
```

#### B2. Add Step 2 Output Validator (Content Preservation Check)
**Location**: After Step 2, before Step 3 in `runAISuggestionsPipeline()`

```typescript
function validateStep2Output(
  original: string,
  edited: string
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Length sanity check (allow 50% variance)
  const lengthRatio = edited.length / original.length;
  if (lengthRatio < 0.5 || lengthRatio > 2.0) {
    issues.push(`Suspicious length change: ${Math.round(lengthRatio * 100)}% of original`);
  }

  // Check that major structural elements preserved
  const originalHeadings = (original.match(/^#{1,6} .+$/gm) || []);
  const editedHeadings = (edited.match(/^#{1,6} .+$/gm) || []);
  if (editedHeadings.length < originalHeadings.length * 0.5) {
    issues.push(`Lost headings: ${originalHeadings.length} -> ${editedHeadings.length}`);
  }

  // Check for leftover markers
  if (edited.includes('... existing text ...')) {
    issues.push('Contains unexpanded markers');
  }

  return { valid: issues.length === 0, issues };
}
```

#### B2.5. Add Content Preservation Validator (LaTeX, Code, Links, Images)
**Location**: Call alongside B2 after Step 2

```typescript
function validateContentPreservation(
  original: string,
  edited: string
): { valid: boolean; issues: string[]; severity: 'error' | 'warning' } {
  const issues: string[] = [];

  // 1. LaTeX inline preservation ($...$)
  const origLatexInline = (original.match(/\$[^$]+\$/g) || []).length;
  const editedLatexInline = (edited.match(/\$[^$]+\$/g) || []).length;
  if (editedLatexInline < origLatexInline * 0.8) {
    issues.push(`LaTeX inline reduced: ${origLatexInline} → ${editedLatexInline}`);
  }

  // 2. LaTeX block preservation ($$...$$)
  const origLatexBlock = (original.match(/\$\$[\s\S]+?\$\$/g) || []).length;
  const editedLatexBlock = (edited.match(/\$\$[\s\S]+?\$\$/g) || []).length;
  if (editedLatexBlock < origLatexBlock * 0.8) {
    issues.push(`LaTeX blocks reduced: ${origLatexBlock} → ${editedLatexBlock}`);
  }

  // 3. Code fence preservation
  const origCodeBlocks = (original.match(/```[\s\S]*?```/g) || []).length;
  const editedCodeBlocks = (edited.match(/```[\s\S]*?```/g) || []).length;
  if (editedCodeBlocks < origCodeBlocks * 0.8) {
    issues.push(`Code blocks reduced: ${origCodeBlocks} → ${editedCodeBlocks}`);
  }

  // 4. Link preservation
  const origLinks = (original.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length;
  const editedLinks = (edited.match(/\[([^\]]+)\]\(([^)]+)\)/g) || []).length;
  if (editedLinks < origLinks * 0.8) {
    issues.push(`Links reduced: ${origLinks} → ${editedLinks}`);
  }

  // 5. Image preservation (stricter - no loss allowed)
  const origImages = (original.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).length;
  const editedImages = (edited.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || []).length;
  if (editedImages < origImages) {
    issues.push(`Images reduced: ${origImages} → ${editedImages}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    severity: issues.length > 2 ? 'error' : 'warning'
  };
}
```

#### B3. Add Step 3 Output Validator (CriticMarkup Syntax Check)
**Location**: After Step 3, before Step 4

```typescript
function validateCriticMarkup(content: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Check for balanced CriticMarkup
  const insertions = (content.match(/\{\+\+/g) || []).length;
  const insertionCloses = (content.match(/\+\+\}/g) || []).length;
  if (insertions !== insertionCloses) {
    issues.push(`Unbalanced insertions: ${insertions} opens, ${insertionCloses} closes`);
  }

  const deletions = (content.match(/\{--/g) || []).length;
  const deletionCloses = (content.match(/--\}/g) || []).length;
  if (deletions !== deletionCloses) {
    issues.push(`Unbalanced deletions: ${deletions} opens, ${deletionCloses} closes`);
  }

  // Check substitutions have proper separator (use [\s\S]*? for multiline)
  const substitutions = content.match(/\{~~[\s\S]*?~~\}/g) || [];
  substitutions.forEach((sub, i) => {
    if (!sub.includes('~>')) {
      issues.push(`Substitution ${i} missing ~> separator: "${sub.slice(0, 30)}..."`);
    }
  });

  return { valid: issues.length === 0, issues };
}
```

### C. Escape Special Characters in AST Diff (Step 3)

**File**: `src/editorFiles/markdownASTdiff/markdownASTdiff.ts`
**Function**: `toCriticMarkup()` around line 659

Add character escaping before wrapping in CriticMarkup:
```typescript
function escapeCriticMarkupContent(text: string): string {
  // Escape sequences that could break CriticMarkup parsing
  // Covers: insertions {++, deletions {--, substitutions {~~, highlights {==, comments {>>
  return text
    .replace(/\{(\+\+|--|~~|==|>>)/g, '\\{$1')  // Escape opening markers
    .replace(/(\+\+|--|~~|==|<<)\}/g, '$1\\}')  // Escape closing markers
    .replace(/~>/g, '\\~>');                     // Escape substitution separator
}
```

### D. Recovery Mechanisms

#### D1. Add Retry with Simplified Prompt
If Step 1 validation fails, retry with simpler prompt:
```typescript
if (!step1Validation.valid && retryCount < 2) {
  // Retry with more explicit prompt
  const simplifiedPrompt = createSimplifiedAISuggestionPrompt(content, userPrompt);
  // ... retry logic
}
```

#### D2. Add Fallback for Step 2 Failures
If Step 2 output is suspicious, fall back to word-level diff of Step 1 content:
```typescript
if (!step2Validation.valid) {
  // Fall back to direct diff between original and Step 1 content segments
  const fallbackEdited = applyStep1DirectlyToOriginal(original, step1Output);
  // ... continue with fallback
}
```

---

## Implementation Priority

| Priority | Improvement | Effort | Impact |
|----------|-------------|--------|--------|
| P0 | B2: Step 2 output validator (content preservation) | Low | High |
| P0 | A2: Step 2 prompt improvements | Low | High |
| P0 | B3: CriticMarkup syntax validator | Medium | High |
| P1 | C: Character escaping in AST diff | Medium | High |
| P1 | A1: Step 1 prompt improvements | Low | Medium |
| P1 | Timeout handling (pipeline-level) | Medium | High |
| P2 | B1: Step 1 output validator | Medium | Medium |
| P2 | B2.5: Content preservation validator (LaTeX, code, links) | Medium | Medium |
| P2 | Telemetry integration | Medium | Medium |
| P3 | D1/D2: Retry and fallback mechanisms | High | Medium |

---

## Files to Modify

1. `src/editorFiles/aiSuggestion.ts` - Prompts and validators
2. `src/editorFiles/actions/actions.ts` - Add validation calls
3. `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` - Character escaping
4. (New) `src/editorFiles/validation/pipelineValidation.ts` - Validation functions

---

## User Decisions

- **Strictness**: Configurable per-call via options, **default to blocking** on validation failure
- **Retries**: Yes, with simplified prompts (up to 2 retries)
- **Scope**: All priorities (P0-P3) + telemetry + content preservation
- **Content types**: Validate LaTeX, code blocks, links, images
- **Telemetry**: Track failure rates, retry counts, validation issues

---

## Detailed Implementation Plan

### Phase 1: Create Validation Module (P0-P1)
**New file**: `src/editorFiles/validation/pipelineValidation.ts`

```typescript
export interface ValidationResult {
  valid: boolean;
  issues: string[];
  severity: 'error' | 'warning';
}

export interface PipelineValidationOptions {
  strictMode: boolean;        // true = block on failure, false = warn and continue
  enableRetry: boolean;       // true = retry with simplified prompt on failure
  maxRetries: number;         // default: 2
}

// Validators for each step
export function validateStep1Output(output: string): ValidationResult;
export function validateStep2Output(original: string, edited: string): ValidationResult;
export function validateCriticMarkup(content: string): ValidationResult;
```

### Phase 2: Improve Prompts (P0-P1)
**File**: `src/editorFiles/aiSuggestion.ts`

1. Update `createAISuggestionPrompt()` with:
   - Minimum content length rule (10+ chars)
   - Negative examples showing invalid patterns
   - Explicit markdown preservation instructions

2. Update `createApplyEditsPrompt()` with:
   - Verification checklist
   - Length preservation warning
   - Heading preservation rule

3. Add `createSimplifiedAISuggestionPrompt()` for retry attempts:
   - Even more explicit examples
   - Single-edit-at-a-time approach
   - Fallback for complex edits

### Phase 3: Add Inter-Step Validation (P0-P2)
**File**: `src/editorFiles/aiSuggestion.ts` in `runAISuggestionsPipeline()`

Insert validation calls after each step:
```
Step 1 → validateStep1Output() → [retry if failed & retries enabled]
Step 2 → validateStep2Output() → [retry if failed & retries enabled]
Step 3 → validateCriticMarkup() → [no retry, but can warn]
Step 4 → (already has preprocessing)
```

### Phase 4: Add Character Escaping (P2)
**File**: `src/editorFiles/markdownASTdiff/markdownASTdiff.ts`

Add `escapeCriticMarkupContent()` function and call it in `toCriticMarkup()` before wrapping content.

### Phase 5: Add Retry Mechanism (P3)
**File**: `src/editorFiles/aiSuggestion.ts`

Wrap Step 1 and Step 2 in retry logic:
```typescript
async function executeWithRetry<T>(
  action: () => Promise<T>,
  validator: (result: T) => ValidationResult,
  retryAction: () => Promise<T>,
  options: PipelineValidationOptions
): Promise<{ result: T; validation: ValidationResult; retried: boolean }>
```

### Phase 6: Add Fallback Mechanism (P3)
**File**: `src/editorFiles/aiSuggestion.ts`

Add `applyStep1DirectlyToOriginal()` for when Step 2 fails repeatedly:
- Parse Step 1 JSON directly
- Locate "... existing text ..." markers in original
- Substitute content segments directly
- Skip LLM for Step 2 entirely

---

## Implementation Order

1. **Create validation module** (`pipelineValidation.ts`)
   - All validator functions
   - Types and interfaces
   - Unit tests

2. **Update prompts** (`aiSuggestion.ts`)
   - Stricter rules for Step 1
   - Verification checklist for Step 2
   - Simplified prompt variant for retries

3. **Integrate validation into pipeline** (`aiSuggestion.ts`)
   - Add options parameter to `runAISuggestionsPipeline()`
   - Insert validation calls
   - Add logging for validation results

4. **Add character escaping** (`markdownASTdiff.ts`)
   - Escape function
   - Integration in `toCriticMarkup()`
   - Unit tests

5. **Add retry mechanism** (`aiSuggestion.ts`)
   - `executeWithRetry()` wrapper
   - Integration with Step 1 and 2
   - Logging for retry attempts

6. **Add fallback mechanism** (`aiSuggestion.ts`)
   - `applyStep1DirectlyToOriginal()` function
   - Fallback trigger logic
   - Integration tests

---

## Files to Modify/Create

| File | Action | Changes |
|------|--------|---------|
| `src/editorFiles/validation/pipelineValidation.ts` | CREATE | All validation functions, types |
| `src/editorFiles/validation/pipelineValidation.test.ts` | CREATE | Unit tests for validators |
| `src/editorFiles/aiSuggestion.ts` | MODIFY | Prompts, retry logic, validation integration |
| `src/editorFiles/aiSuggestion.test.ts` | MODIFY | Add tests for new validation flow |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | MODIFY | Add character escaping |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts` | MODIFY | Add escaping tests |

---

## API Changes

### Updated `runAISuggestionsPipeline()` Signature

```typescript
export async function runAISuggestionsPipeline(
  currentContent: string,
  userId: string,
  onProgress?: (step: string, progress: number) => void,
  sessionData?: { ... },
  validationOptions?: PipelineValidationOptions  // NEW PARAMETER
): Promise<{
  content: string;
  session_id?: string;
  validationIssues?: string[];  // NEW: Non-blocking issues encountered
  retriedSteps?: number[];      // NEW: Which steps required retry
}>
```

### Default Options
```typescript
const DEFAULT_VALIDATION_OPTIONS: PipelineValidationOptions = {
  strictMode: true,     // Block on failure (updated from false)
  enableRetry: true,    // Retry on failure
  maxRetries: 2         // Up to 2 retry attempts
};
```

---

## Additional Gaps Identified (Review Additions)

### E. Operational Concerns

#### E1. Pipeline-Level Timeout Handling
**Problem**: LLM calls can hang indefinitely; user may close tab during processing
**Current**: Only OpenAI client has 60s timeout

```typescript
// Add to runAISuggestionsPipeline()
const PIPELINE_TIMEOUT_MS = 90000; // 90 seconds total

async function runAISuggestionsPipelineWithTimeout(
  ...args
): Promise<PipelineResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PIPELINE_TIMEOUT_MS);

  try {
    return await runAISuggestionsPipeline(...args, controller.signal);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### E2. Concurrent Request Handling
**Problem**: User submits multiple AI suggestion requests rapidly → race conditions
**Solution**: Add request debouncing or queuing

```typescript
// In component or action layer
const pendingRequest = useRef<AbortController | null>(null);

async function handleAISuggestion() {
  // Cancel any pending request
  if (pendingRequest.current) {
    pendingRequest.current.abort();
  }
  pendingRequest.current = new AbortController();
  // ... proceed with new request
}
```

### F. Telemetry Integration

#### F1. Pipeline Metrics Types
**New file**: `src/editorFiles/validation/pipelineMetrics.ts`

```typescript
export interface PipelineStepMetrics {
  pipelineId: string;           // Unique ID for this run
  step: 1 | 2 | 3 | 4;
  stepName: 'generate' | 'apply' | 'diff' | 'preprocess';
  success: boolean;
  validationIssues: string[];
  durationMs: number;
  retryCount: number;
  inputLength: number;
  outputLength: number;
  timestamp: Date;
}

export interface PipelineSummaryMetrics {
  pipelineId: string;
  userId: string;
  totalDurationMs: number;
  stepsCompleted: number;
  totalRetries: number;
  allValidationIssues: string[];
  finalStatus: 'success' | 'partial' | 'failed';
}

export function trackPipelineStep(metrics: PipelineStepMetrics): void {
  logger.info('pipeline_step', metrics);
}

export function trackPipelineSummary(summary: PipelineSummaryMetrics): void {
  logger.info('pipeline_complete', summary);
}
```

#### F2. Integration Points
- Call `trackPipelineStep()` at end of each step in `runAISuggestionsPipeline()`
- Call `trackPipelineSummary()` at pipeline completion
- Include validation issues in metrics for debugging

### G. Database Failure Handling
**Problem**: Current code logs DB save failures but doesn't halt execution (lines 253, 294, 328, 359)
**Solution**: Make DB saves optionally blocking in production

```typescript
interface PipelineValidationOptions {
  // ... existing options
  blockOnDbFailure: boolean;  // true = halt pipeline on DB save failure
}
```

---

## Updated Files to Modify/Create

| File | Action | Changes |
|------|--------|---------|
| `src/editorFiles/validation/pipelineValidation.ts` | CREATE | All validation functions, types |
| `src/editorFiles/validation/pipelineValidation.test.ts` | CREATE | Unit tests for validators |
| `src/editorFiles/validation/pipelineMetrics.ts` | CREATE | Telemetry types and functions |
| `src/editorFiles/validation/contentPreservation.ts` | CREATE | LaTeX, code, link, image validators |
| `src/editorFiles/aiSuggestion.ts` | MODIFY | Prompts, retry, validation, timeout, telemetry |
| `src/editorFiles/aiSuggestion.test.ts` | MODIFY | Add tests for new validation flow |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.ts` | MODIFY | Add character escaping |
| `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts` | MODIFY | Add escaping tests |
| `src/editorFiles/actions/actions.ts` | MODIFY | Timeout handling, validation calls |
| `src/lib/errorHandling.ts` | MODIFY | Add pipeline-specific error codes |
