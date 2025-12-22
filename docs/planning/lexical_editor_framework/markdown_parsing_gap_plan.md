# Markdown Parsing Test Gap

## Problem Statement

The `markdownASTdiff.fixtures.test.ts` file contains 87 tests that are currently skipped because they require real markdown parsing via `unified` and `remark-parse`. These packages are ESM-only and Jest (with ts-jest) cannot transform them properly.

## Current State

### What Works
- **markdownASTdiff.test.ts** (63 tests) - Uses mock AST node factories (`createMockParagraph`, `createMockRoot`, etc.) to test the diff algorithm directly
- **preprocessing.fixtures.test.ts** (74 tests) - Tests Step 4 (preprocessing) using `expectedStep3Output` from fixtures, bypassing real parsing
- **E2E tests** - Use real browser environment where ESM works natively

### What's Skipped
- **markdownASTdiff.fixtures.test.ts** (87 skipped) - Fixture-based tests that need to parse markdown strings into AST nodes

## Root Cause

```
node_modules/unified/index.js:2
export {unified} from './lib/index.js'
^^^^^^
SyntaxError: Unexpected token 'export'
```

The `unified` ecosystem (unified, remark-parse, vfile, micromark, etc.) uses pure ESM. Jest's CommonJS-based transform pipeline cannot handle these imports without significant configuration changes.

## Attempted Solutions

### 1. transformIgnorePatterns (Failed)
```javascript
transformIgnorePatterns: [
  '/node_modules/(?!(unified|remark-parse|...)/)',
]
```
This didn't work because ts-jest still couldn't properly transform the ESM syntax.

### 2. Mock AST Parser (Partial)
Created a simplified `createSimpleAST()` function that parses basic markdown:
```typescript
function createSimpleAST(markdown: string) {
  // Split by paragraphs, detect headings, code blocks, lists
  // Returns mock AST structure
}
```
**Issue**: The mock parser doesn't produce granular enough nodes. Real parsing creates detailed inline structures that enable word-level diffs; the mock creates paragraph-level nodes that result in whole-paragraph replacements.

## Options for Resolution

### Option A: Native ESM Jest (Recommended for Future)
Switch to native ESM mode in Jest:
```javascript
// jest.config.mjs
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  // ...
}
```
**Pros**: Full ESM support, real parsing works
**Cons**: Requires significant migration, may break other tests

### Option B: Vitest Migration
Migrate from Jest to Vitest which has native ESM support:
```javascript
// vitest.config.ts
export default defineConfig({
  test: {
    environment: 'jsdom',
  },
})
```
**Pros**: Modern, fast, native ESM, similar API to Jest
**Cons**: Migration effort, learning curve

### Option C: Separate E2E Test File
Create a dedicated test file that runs in a real Node.js ESM environment:
```bash
# Run with tsx (supports ESM)
npx tsx --test src/editorFiles/markdownASTdiff/markdownASTdiff.esm.test.ts
```
**Pros**: No Jest config changes needed
**Cons**: Separate test runner, different reporting

### Option D: Improve Mock Parser (Current State)
Enhance `createSimpleAST()` to produce more granular nodes:
- Parse inline elements (bold, italic, links)
- Create proper text node boundaries
- Handle formatting markers

**Pros**: Works within current Jest setup
**Cons**: Complex to implement, may never fully match real parser

### Option E: Accept Current Coverage (Status Quo)
The skipped tests are covered by:
1. `markdownASTdiff.test.ts` - Tests diff algorithm with proper mock AST
2. `preprocessing.fixtures.test.ts` - Validates fixture outputs
3. E2E tests - Full integration with real parsing

**Pros**: No changes needed, good coverage exists
**Cons**: Fixture tests remain skipped

## Recommendation

**Chosen approach**: Option C - Separate ESM Test Runner with tsx

This enables the 87 skipped tests with real parsing while keeping Jest unchanged.

---

## Implementation Plan

### Phase 1: Create ESM Test File
1. Create `src/editorFiles/markdownASTdiff/markdownASTdiff.esm.test.ts`
2. Use Node's built-in test runner (`node:test`) with tsx
3. Import real `unified` and `remark-parse` (ESM works natively)
4. Port the 87 skipped fixture tests from `markdownASTdiff.fixtures.test.ts`

### Phase 2: Add npm Script
Add to `package.json`:
```json
"test:esm": "npx tsx --test src/**/*.esm.test.ts"
```

### Phase 3: Update CI (if applicable)
Ensure CI runs both:
```bash
npm test        # Jest tests (155 passing)
npm run test:esm  # ESM tests (87 parsing tests)
```

### Phase 4: Clean Up Original File
- Remove the `describe.skip` blocks from `markdownASTdiff.fixtures.test.ts`
- Add comment pointing to the ESM test file

### Files to Create/Modify
- `src/editorFiles/markdownASTdiff/markdownASTdiff.esm.test.ts` - **New file**
- `package.json` - Add `test:esm` script
- `src/editorFiles/markdownASTdiff/markdownASTdiff.fixtures.test.ts` - Remove skipped tests
- `.github/workflows/*.yml` - Add ESM test step (if CI exists)

### Success Criteria
- 87 previously-skipped tests now run and pass
- No changes to existing Jest tests
- Both test commands work: `npm test` and `npm run test:esm`

---

## Long-term Consideration

Consider Option B (Vitest migration) when the project needs major test infrastructure updates. Vitest has native ESM support and would unify both test runners.

## Test Coverage Summary

| Test File | Tests | Status | Coverage |
|-----------|-------|--------|----------|
| markdownASTdiff.test.ts | 63 | Passing | Diff algorithm with mock AST |
| markdownASTdiff.fixtures.test.ts | 4 | Passing | Basic behavior verification |
| markdownASTdiff.fixtures.test.ts | 87 | Skipped | Fixture-based parsing tests |
| preprocessing.fixtures.test.ts | 74 | Passing | Step 4 preprocessing |
| DiffTagAcceptReject.integration.test.tsx | 14 | Passing | Accept/reject mutations |

**Total diff-related coverage**: 155 passing tests (87 skipped pending ESM resolution)

## Files Involved

- `src/editorFiles/markdownASTdiff/markdownASTdiff.fixtures.test.ts` - Skipped tests
- `src/editorFiles/markdownASTdiff/markdownASTdiff.test.ts` - Working tests with mocks
- `src/testing/utils/editor-test-helpers.ts` - Mock AST factories and fixtures
- `jest.config.js` - Jest configuration
