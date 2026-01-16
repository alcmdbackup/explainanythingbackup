# Reduce Number Critical E2E Tests Plan

## Background

The current CI pipeline runs ~10 minutes per PR to main, with E2E Critical tests consuming 43% of that time. GitHub Actions provides 2,000 free minutes/month for private repos, and at ~70 PRs/month we're using ~700 minutes (35% of free tier). The goal is to reduce CI costs by 75% while maintaining confidence in code quality.

## Problem

The CI pipeline treats all PRs equally, running the full test suite regardless of change scope. A docs-only PR runs the same 10-minute pipeline as a core service refactor. Additionally, the 39 @critical E2E tests include many that overlap with unit/integration coverage, and the 15 integration tests all run even when only 5 test critical paths.

## Options Considered

1. **Reduce E2E tests only** - Cut from 39 to 10 tests. Saves ~30% but doesn't hit 75% target.

2. **Skip tests based on file changes** - Fast path for docs/migrations, full path for code. Good but only 10-30% of PRs are docs-only.

3. **Hybrid approach (selected)** - Combine smart change detection, affected-only unit tests, critical subsets for integration and E2E, and parallel execution. Achieves 76% savings.

## Phased Execution Plan

### Phase 1: Change Detection & Fast Path

**Goal**: Skip heavy tests for docs-only and migration-only PRs

**Files to modify**:
- `.github/workflows/ci.yml`

**Implementation**:

Add `detect-changes` job at start of workflow:

```yaml
detect-changes:
  runs-on: ubuntu-latest
  outputs:
    path: ${{ steps.changes.outputs.path }}
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - id: changes
      env:
        BASE_REF: ${{ github.base_ref }}
      run: |
        CHANGED=$(git diff --name-only "origin/${BASE_REF}...HEAD")
        CODE_CHANGED=$(echo "$CHANGED" | grep -E '\.(ts|tsx|js|jsx|json|css)$' || true)
        if [ -z "$CODE_CHANGED" ]; then
          echo "path=fast" >> $GITHUB_OUTPUT
        else
          echo "path=full" >> $GITHUB_OUTPUT
        fi
```

Add conditions to test jobs (lint and tsc always run, only skip unit/integration/e2e):
```yaml
# These always run (no condition)
typecheck:
  needs: [detect-changes]

lint:
  needs: [detect-changes]

# These only run on code changes
unit-tests:
  if: needs.detect-changes.outputs.path == 'full'
  needs: [detect-changes, typecheck, lint]
```

**Tests**: Create a docs-only PR and verify only lint+tsc run (unit/integration/e2e skipped).

---

### Phase 2: Affected-Only Unit Tests

**Goal**: Run only unit tests related to changed files

**Files to modify**:
- `.github/workflows/ci.yml`
- `package.json`

**Implementation**:

Update unit-tests job to include fetch-depth for git history:
```yaml
unit-tests:
  if: needs.detect-changes.outputs.path == 'full'
  needs: [detect-changes, typecheck, lint]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0  # Required for --changedSince
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'
    - run: npm ci
    - name: Run Unit Tests (affected only)
      env:
        BASE_REF: ${{ github.base_ref }}
      run: npm test -- --changedSince="origin/${BASE_REF}"
```

Add full unit test script for production PRs:
```json
"test:unit:full": "jest --coverage"
```

**Tests**: Create PR touching one service file, verify only related tests run.

---

### Phase 3: Integration Test Split

**Goal**: Run only 5 critical integration tests on PRs to main

**Files to modify**:
- `package.json`
- `.github/workflows/ci.yml`

**Implementation**:

Add npm script (pattern matches anywhere in path):
```json
"test:integration:critical": "jest --config jest.integration.config.js --testPathPattern=\"auth-flow|explanation-generation|streaming-api|error-handling|vector-matching\""
```

Note: Jest `--testPathPattern` matches against full file paths, so patterns like `auth-flow` will match `src/__tests__/integration/auth-flow.integration.test.ts`.

**Critical integration tests (5)**:
- `auth-flow.integration.test.ts`
- `explanation-generation.integration.test.ts`
- `streaming-api.integration.test.ts`
- `error-handling.integration.test.ts`
- `vector-matching.integration.test.ts`

**Full-only integration tests (10)**:
- `explanation-update.integration.test.ts`
- `import-articles.integration.test.ts`
- `logging-infrastructure.integration.test.ts`
- `metrics-aggregation.integration.test.ts`
- `request-id-propagation.integration.test.ts`
- `tag-management.integration.test.ts`
- `session-id-propagation.integration.test.ts`
- `rls-policies.integration.test.ts`
- `vercel-bypass.integration.test.ts`
- `__tests__/integration/logging/otelLogger.integration.test.ts` (outside src/)

Update CI workflow:
```yaml
integration-critical:
  if: needs.detect-changes.outputs.path == 'full' && github.base_ref == 'main'
  needs: [unit-tests]
  run: npm run test:integration:critical

integration-full:
  if: github.base_ref == 'production'
  needs: [unit-tests]
  run: npm run test:integration
```

**Tests**: Run `npm run test:integration:critical` locally, verify 5 tests execute.

---

### Phase 4: Reduce E2E Critical Tests (39 → 10)

**Goal**: Keep only highest-value E2E tests as @critical

**Current state**: 39 @critical tests across spec files

**Files to modify** (remove @critical tags from tests NOT in keep list):
- `src/__tests__/e2e/specs/auth.unauth.spec.ts` - keep 2, remove others
- `src/__tests__/e2e/specs/01-auth/auth.spec.ts` - remove all @critical
- `src/__tests__/e2e/specs/02-search-generate/search-generate.spec.ts` - keep 3, remove others
- `src/__tests__/e2e/specs/02-search-generate/regenerate.spec.ts` - remove all @critical
- `src/__tests__/e2e/specs/03-library/library.spec.ts` - remove all @critical
- `src/__tests__/e2e/specs/04-content-viewing/viewing.spec.ts` - keep 1, remove others
- `src/__tests__/e2e/specs/04-content-viewing/action-buttons.spec.ts` - keep 1, remove others
- `src/__tests__/e2e/specs/04-content-viewing/tags.spec.ts` - remove all @critical
- `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts` - remove all @critical
- `src/__tests__/e2e/specs/06-import/import-articles.spec.ts` - keep 1, remove others
- `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts` - keep 1, remove others
- `src/__tests__/e2e/specs/06-ai-suggestions/editor-integration.spec.ts` - remove all @critical
- `src/__tests__/e2e/specs/08-sources/add-sources.spec.ts` - keep 1
- `src/__tests__/e2e/specs/smoke.spec.ts` - remove all @critical (keep @smoke only)

**Keep @critical (10 tests)**:

| Test | File |
|------|------|
| login with valid credentials | auth.unauth.spec.ts |
| unauthenticated user redirected from protected route | auth.unauth.spec.ts |
| submit query from home page and redirect to results | search-generate.spec.ts |
| display full content after streaming completes | search-generate.spec.ts |
| should save explanation to library when save button clicked | action-buttons.spec.ts |
| should load existing explanation by ID from URL | viewing.spec.ts |
| should handle API error gracefully | search-generate.spec.ts |
| should import ChatGPT content with auto-detection | import-articles.spec.ts |
| should display AI suggestions panel | suggestions.spec.ts |
| should include sources when submitting search | add-sources.spec.ts |

**Verification**:
```bash
# Verify exactly 10 @critical tags remain
grep -r "@critical" src/__tests__/e2e/specs/ | wc -l
# Expected output: 10

# Run critical tests to confirm
npm run test:e2e:critical
# Expected: 10 tests execute
```

---

### Phase 5: Parallelize Integration + E2E

**Goal**: Run integration and E2E simultaneously to reduce wall time

**Files to modify**:
- `.github/workflows/ci.yml`

**Implementation**:

Change job dependencies so both run after unit tests:
```yaml
integration-critical:
  needs: [unit-tests]  # Not [integration-tests]

e2e-critical:
  needs: [unit-tests]  # Runs parallel with integration
```

**Note on dependency change**: This is intentional. Previously, e2e-critical waited for integration-tests. By running integration-critical and e2e-critical in parallel (both depending only on unit-tests), we reduce wall clock time. If integration tests fail, e2e tests still run but the overall job will fail due to integration failure. This tradeoff saves ~2 minutes per PR.

**Verification**: Push PR and verify integration-critical and e2e-critical start at same time in Actions UI.

---

### Phase 6: Update Documentation

**Files to modify**:
- `docs/docs_overall/testing_overview.md`
- `docs/feature_deep_dives/testing_setup.md`

**Updates**:
- Document fast path vs full path CI behavior
- Update E2E test count (39 → 10 critical)
- Document integration test split (14 → 5 critical)
- Add criteria for marking tests as @critical

## Testing

### Unit Tests
- No new unit tests required

### Integration Tests
- Verify `npm run test:integration:critical` runs 5 test files
- Verify `npm run test:integration` still runs all 15 test files

### E2E Tests
- Verify `npm run test:e2e:critical` runs 10 tests
- Verify `npm run test:e2e` still runs all 163 tests

### Manual Verification
- Create docs-only PR → verify fast path (~1 min)
- Create code PR → verify full path (~2.5-3 min)
- Create PR to production → verify full suite runs

## Documentation Updates

| File | Update |
|------|--------|
| `docs/docs_overall/testing_overview.md` | Add fast/full path documentation, update test counts |
| `docs/feature_deep_dives/testing_setup.md` | Document @critical criteria, integration split |

## Expected Outcomes

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Code PR CI time | 10 min | 2.5-3 min | 70-75% faster |
| Docs PR CI time | 10 min | 1 min | 90% faster |
| Monthly minutes | 700 min | 168 min | 76% reduction |
| E2E Critical tests | 39 | 10 | 74% fewer |
| Integration Critical tests | 15 | 5 | 67% fewer |

## Rollback Plan

If issues arise:
1. Revert CI workflow changes (single commit)
2. Re-add @critical tags to demoted tests
3. Remove `test:integration:critical` script

All changes are additive (new npm scripts, conditions) so rollback is straightforward.
