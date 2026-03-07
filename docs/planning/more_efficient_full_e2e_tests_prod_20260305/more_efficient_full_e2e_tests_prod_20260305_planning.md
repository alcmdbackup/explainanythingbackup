# More Efficient Full E2E Tests Prod Plan

## Background
Split tests into evolution vs. non-evolution and run only the relevant portion based on what changed. Also detect and fix sources of flakiness in tests.

## Requirements (from GH Issue)
1. Split tests into evolution-focused vs. non-evolution, leveraging existing CI change-detection logic to run only relevant tests based on changed files
2. Enforce testing rules from `docs/docs_overall/testing_overview.md` to eliminate flakiness

## Problem

The CI pipeline currently has a binary fast/full decision: docs-only changes skip tests, everything else runs ALL tests. There is no evolution-specific detection, so a change to `evolution/src/services/pipeline.ts` triggers 29 non-evolution E2E specs and 16 non-evolution integration tests unnecessarily. Conversely, a change to `src/components/SearchBar.tsx` triggers 7 evolution E2E specs and 11 evolution integration tests unnecessarily. On PRs to production, the full E2E suite runs across 4 shards (~30 min), but splitting by domain could cut each path in half. The evolution boundary is clean: 7 E2E specs, 11 integration tests, and well-defined directory paths.

---

## CI Change Detection Implementation Design

### 1. detect-changes Bash Script (ci.yml lines 17-39 replacement)

The current script outputs a single `path` variable with value `fast` or `full`. The new version outputs `path` with four possible values: `fast`, `evolution-only`, `non-evolution-only`, `full`.

**Logic:**
1. Get changed files (same as today)
2. Filter to code files (same as today)
3. If no code files: `fast`
4. Classify each changed code file into EVOLUTION_ONLY, SHARED, or NON_EVOLUTION
5. If any SHARED file changed: `full`
6. If only EVOLUTION_ONLY files changed: `evolution-only`
7. If only NON_EVOLUTION files changed: `non-evolution-only`
8. If both EVOLUTION_ONLY and NON_EVOLUTION changed: `full`

```yaml
  detect-changes:
    name: Detect Changes
    runs-on: ubuntu-latest
    timeout-minutes: 5
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
            echo "::notice ::Fast path - no code changes detected"
            exit 0
          fi

          # --- Classify changed files ---
          HAS_EVOLUTION=false
          HAS_NON_EVOLUTION=false
          HAS_SHARED=false

          while IFS= read -r file; do
            [ -z "$file" ] && continue

            # SHARED_PATHS — any change here triggers full suite
            if echo "$file" | grep -qE '^(src/lib/schemas/|src/lib/services/llms\.ts|src/lib/services/adminAuth\.ts|src/lib/services/auditLog\.ts|src/lib/utils/supabase/|src/lib/errorHandling\.ts|src/lib/prompts\.ts|src/lib/config/llmPricing\.ts|src/lib/server_utilities\.ts|src/lib/logging/|src/lib/serverReadRequestId\.ts|supabase/migrations/)'; then
              HAS_SHARED=true
            elif echo "$file" | grep -qE '^(package\.json|tsconfig\.json|jest\.config\.|jest\.integration\.config\.|playwright\.config\.ts)$'; then
              HAS_SHARED=true
            # EVOLUTION_ONLY_PATHS
            elif echo "$file" | grep -qE '^(evolution/|src/app/admin/quality/evolution/|src/app/admin/quality/arena/|src/app/admin/quality/optimization/|src/app/admin/quality/strategies/|src/app/admin/quality/prompts/|src/app/admin/evolution-dashboard/|src/app/api/evolution/|src/app/api/cron/evolution-|src/app/api/cron/experiment-)'; then
              HAS_EVOLUTION=true
            # Everything else = NON_EVOLUTION
            else
              HAS_NON_EVOLUTION=true
            fi
          done <<< "$CODE_CHANGED"

          # --- Determine path ---
          if [ "$HAS_SHARED" = true ]; then
            echo "path=full" >> $GITHUB_OUTPUT
            echo "::notice ::Full path - shared infrastructure changed"
          elif [ "$HAS_EVOLUTION" = true ] && [ "$HAS_NON_EVOLUTION" = true ]; then
            echo "path=full" >> $GITHUB_OUTPUT
            echo "::notice ::Full path - both evolution and non-evolution changed"
          elif [ "$HAS_EVOLUTION" = true ]; then
            echo "path=evolution-only" >> $GITHUB_OUTPUT
            echo "::notice ::Evolution-only path - only evolution code changed"
          elif [ "$HAS_NON_EVOLUTION" = true ]; then
            echo "path=non-evolution-only" >> $GITHUB_OUTPUT
            echo "::notice ::Non-evolution-only path - only non-evolution code changed"
          else
            echo "path=full" >> $GITHUB_OUTPUT
            echo "::notice ::Full path - unclassified changes"
          fi
```

**Key design decisions:**
- SHARED_PATHS are intentionally broad (schemas, supabase utils, migrations, config files). False positives (running full when not needed) are safe; false negatives (skipping needed tests) are not.
- The `src/app/api/cron/evolution-` and `src/app/api/cron/experiment-` patterns use prefix matching to catch `evolution-runner/`, `evolution-watchdog/`, `experiment-driver/`.
- Config files (`package.json`, `tsconfig.json`, `jest*.config.*`, `playwright.config.ts`) are SHARED because they affect all test behavior.

---

### 2. E2E Spec Tagging with @evolution

**Approach: Use `{ tag: '@evolution' }` in the Playwright test options at the `test.describe` level.**

This is the same pattern already used for `@critical`, `@skip-prod`, and `@prod-ai`. Adding it at the describe level means every test in the file inherits the tag.

**7 files to tag (all in `src/__tests__/e2e/specs/09-admin/`):**

| File | Current top-level describe | Change |
|------|---------------------------|--------|
| `admin-evolution.spec.ts` | `adminTest.describe('Evolution Pipeline', ...)` | Add `{ tag: '@evolution' }` |
| `admin-arena.spec.ts` | `adminTest.describe('Admin Arena', ...)` AND `adminTest.describe('Admin Arena — Prompt Bank UI', ...)` | Add `{ tag: '@evolution' }` to BOTH top-level describes |
| `admin-evolution-visualization.spec.ts` | `adminTest.describe('Evolution Visualization', ...)` | Add `{ tag: '@evolution' }` |
| `admin-experiment-detail.spec.ts` | `adminTest.describe('Experiment Detail', ...)` | Add `{ tag: '@evolution' }` |
| `admin-elo-optimization.spec.ts` | `adminTest.describe('Elo Optimization', ...)` | Add `{ tag: '@evolution' }` |
| `admin-strategy-registry.spec.ts` | `adminTest.describe('Strategy Registry', ...)` | Add `{ tag: '@evolution' }` |
| `admin-article-variant-detail.spec.ts` | `adminTest.describe('Article Variant Detail', ...)` | Add `{ tag: '@evolution' }` |

**Exact tag syntax for each file:**

For files where describe currently has no options object:
```typescript
// Before:
adminTest.describe('Evolution Pipeline', () => {
// After:
adminTest.describe('Evolution Pipeline', { tag: '@evolution' }, () => {
```

For files where individual tests already have `{ tag: '@critical' }`:
```typescript
// The @critical tag stays on the individual test.
// The @evolution tag goes on the outer describe.
// Both tags are inherited/combined by Playwright's tag system.
// A test tagged @critical inside a describe tagged @evolution
// will match BOTH --grep=@critical AND --grep=@evolution.
```

**Important: `admin-experiment-detail.spec.ts` has `@critical` embedded in test title strings** (e.g., `'experiment history shows ID and links to detail page @critical'`). These title-embedded tags are matched by the `grep: /@critical/` regex in the chromium-critical project. Adding `{ tag: '@evolution' }` at the describe level works independently -- no conflict.

---

### 3. Playwright Project vs CLI --grep: Use CLI --grep (no new project)

**Decision: Use `--grep` and `--grep-invert` CLI flags. Do NOT add new Playwright projects.**

**Reasoning:**
- Adding `chromium-evolution` / `chromium-non-evolution` projects would require duplicating device configs and complicate the project matrix.
- The existing `chromium` project already runs all authenticated specs. Filtering with `--grep=@evolution` or `--grep-invert=@evolution` at the CLI level is simpler.
- The `chromium-critical` project already demonstrates this pattern (uses `grep: /@critical/` in config).
- CLI flags override/combine with config-level grep, giving CI full control.

**How it works in CI:**

```bash
# Evolution-only E2E:
npx playwright test --project=chromium --grep=@evolution
# plus unauth (always runs, it's 1 lightweight spec):
npx playwright test --project=chromium-unauth

# Non-evolution-only E2E:
npx playwright test --project=chromium --grep-invert=@evolution --project=chromium-unauth

# Full E2E (unchanged):
npx playwright test --project=chromium --project=chromium-unauth
```

**Note on sharding interaction:** `--grep=@evolution` reduces the test set to 7 files. Sharding 7 files across 4 shards is wasteful. Evolution-only runs should use 1-2 shards. Non-evolution (29 files) can keep 3-4 shards.

---

### 4. New CI Jobs and Dependencies

**Current production pipeline:**
```
detect-changes -> typecheck + lint -> unit-tests -> integration-full + e2e-full(4 shards)
```

**New production pipeline (Option A — remove old full jobs):**
```
detect-changes -> typecheck + lint -> unit-tests ->
  CASE path=full:
    integration-evolution + e2e-evolution(1 shard)
    + integration-non-evolution + e2e-non-evolution(3 shards)
  CASE path=evolution-only:
    integration-evolution + e2e-evolution(1 shard)
  CASE path=non-evolution-only:
    integration-non-evolution + e2e-non-evolution(3 shards)
  CASE path=fast:
    [nothing beyond lint+tsc]
```
Note: The old `e2e-full`/`integration-full` jobs are REMOVED. On `path=full`, both split pairs run (4 total runners), providing equivalent coverage.

**Current main pipeline:**
```
detect-changes -> typecheck + lint -> unit-tests -> integration-critical + e2e-critical
```

**New main pipeline (unchanged for now):**
```
detect-changes -> typecheck + lint -> unit-tests -> integration-critical + e2e-critical
```

Main pipeline uses `@critical` subset which already has both evolution and non-evolution tests. Splitting `@critical` further is not worthwhile (it's already fast). No changes to main pipeline.

**New CI jobs to add (production only):**

#### Job: `e2e-evolution`
```yaml
  e2e-evolution:
    name: E2E Tests (Evolution)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [detect-changes, unit-tests]
    if: >-
      github.base_ref == 'production' &&
      (needs.detect-changes.outputs.path == 'evolution-only' ||
       needs.detect-changes.outputs.path == 'full')
    environment: staging
    env:
      # Same env vars as e2e-full
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
      PINECONE_INDEX_NAME_ALL: ${{ secrets.PINECONE_INDEX_NAME_ALL }}
      PINECONE_NAMESPACE: ${{ secrets.PINECONE_NAMESPACE }}
      TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
      TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
      TEST_USER_ID: ${{ secrets.TEST_USER_ID }}
      ADMIN_TEST_EMAIL: ${{ secrets.ADMIN_TEST_EMAIL }}
      ADMIN_TEST_PASSWORD: ${{ secrets.ADMIN_TEST_PASSWORD }}
      NEXT_PUBLIC_USE_AI_API_ROUTE: 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Seed admin test user
        run: npx tsx scripts/seed-admin-test-user.ts
      - name: Get Playwright version
        id: playwright-version
        run: echo "version=$(npm ls @playwright/test --json | jq -r '.dependencies["@playwright/test"].version')" >> $GITHUB_OUTPUT
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        id: playwright-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}
      - name: Install Playwright browsers
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium
      - name: Install Playwright deps (if cached)
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium
      - name: Run Evolution E2E Tests
        run: npm run test:e2e:evolution
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-evolution
          path: |
            playwright-report/
            test-results/
          retention-days: 7
```

#### Job: `e2e-non-evolution`
```yaml
  e2e-non-evolution:
    name: E2E Tests (Non-Evolution - Shard ${{ matrix.shard }}/3)
    runs-on: ubuntu-latest
    timeout-minutes: 25
    needs: [detect-changes, unit-tests]
    if: >-
      github.base_ref == 'production' &&
      (needs.detect-changes.outputs.path == 'non-evolution-only' ||
       needs.detect-changes.outputs.path == 'full')
    environment: staging
    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3]
    env:
      # Same env vars as e2e-full
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
      PINECONE_INDEX_NAME_ALL: ${{ secrets.PINECONE_INDEX_NAME_ALL }}
      PINECONE_NAMESPACE: ${{ secrets.PINECONE_NAMESPACE }}
      TEST_USER_EMAIL: ${{ secrets.TEST_USER_EMAIL }}
      TEST_USER_PASSWORD: ${{ secrets.TEST_USER_PASSWORD }}
      TEST_USER_ID: ${{ secrets.TEST_USER_ID }}
      ADMIN_TEST_EMAIL: ${{ secrets.ADMIN_TEST_EMAIL }}
      ADMIN_TEST_PASSWORD: ${{ secrets.ADMIN_TEST_PASSWORD }}
      NEXT_PUBLIC_USE_AI_API_ROUTE: 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Seed admin test user
        run: npx tsx scripts/seed-admin-test-user.ts
      - name: Get Playwright version
        id: playwright-version
        run: echo "version=$(npm ls @playwright/test --json | jq -r '.dependencies["@playwright/test"].version')" >> $GITHUB_OUTPUT
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        id: playwright-cache
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ steps.playwright-version.outputs.version }}
      - name: Install Playwright browsers
        if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium
      - name: Install Playwright deps (if cached)
        if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium
      - name: Run Non-Evolution E2E Tests
        run: npm run test:e2e:non-evolution -- --shard=${{ matrix.shard }}/3
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report-non-evolution-${{ matrix.shard }}
          path: |
            playwright-report/
            test-results/
          retention-days: 7
```

#### Job: `integration-evolution`
```yaml
  integration-evolution:
    name: Integration Tests (Evolution)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [detect-changes, unit-tests]
    if: >-
      github.base_ref == 'production' &&
      (needs.detect-changes.outputs.path == 'evolution-only' ||
       needs.detect-changes.outputs.path == 'full')
    environment: staging
    env:
      # Same env vars as integration-full
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
      PINECONE_INDEX_NAME_ALL: ${{ secrets.PINECONE_INDEX_NAME_ALL }}
      PINECONE_NAMESPACE: ${{ secrets.PINECONE_NAMESPACE }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:integration:evolution
```

#### Job: `integration-non-evolution`
```yaml
  integration-non-evolution:
    name: Integration Tests (Non-Evolution)
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [detect-changes, unit-tests]
    if: >-
      github.base_ref == 'production' &&
      (needs.detect-changes.outputs.path == 'non-evolution-only' ||
       needs.detect-changes.outputs.path == 'full')
    environment: staging
    env:
      # Same env vars as integration-full
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.NEXT_PUBLIC_SUPABASE_URL }}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      PINECONE_API_KEY: ${{ secrets.PINECONE_API_KEY }}
      PINECONE_INDEX_NAME_ALL: ${{ secrets.PINECONE_INDEX_NAME_ALL }}
      PINECONE_NAMESPACE: ${{ secrets.PINECONE_NAMESPACE }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run test:integration:non-evolution
```

**What happens to `e2e-full` and `integration-full`?**

Option A (recommended): **Remove them.** The `evolution` + `non-evolution` jobs together cover the full suite. When `path=full`, both jobs run, providing identical coverage to the old `e2e-full`/`integration-full`.

Option B (conservative): Keep them as-is, only used when `path=full`. Add the split jobs for `evolution-only` / `non-evolution-only` paths. This avoids risk but adds CI complexity.

**Recommendation: Option A.** The split jobs with `path == 'full'` condition already cover the full case. Fewer jobs = simpler CI. The only behavioral difference: full path runs evolution (1 shard) + non-evolution (3 shards) = 4 runners instead of 4 shards of everything. Same parallelism, better isolation.

**CRITICAL: Transition steps (must all happen in same PR):**
1. Remove `e2e-full` job entirely (lines 213-279)
2. Remove `integration-full` job entirely (lines 123-146)
3. Add the 4 new split jobs (above)
4. Update `unit-tests` job `if` condition from `path == 'full'` to `path != 'fast'` so unit tests run on ALL code-change paths (evolution-only, non-evolution-only, full)

**Shard tradeoff (deliberate):** On `path=full`, evolution runs unsharded (7 specs, 1 runner) while non-evolution runs 3 shards (29 specs, ~10/shard). This is acceptable — evolution admin specs are similar weight to other admin specs.

**grepInvert interaction:** In production, `playwright.config.ts` sets `grepInvert: /@skip-prod/`. CLI `--grep-invert` may OVERRIDE the config value rather than union with it. To be safe, the `test:e2e:non-evolution` script includes BOTH patterns in a single regex: `--grep-invert="@evolution|@skip-prod"`. This ensures both @evolution and @skip-prod tests are always excluded regardless of Playwright's override vs union behavior.

---

### 5. Integration Test Split (testPathPatterns)

**Evolution integration tests (11 files):**
```
evolution-infrastructure|evolution-actions|evolution-cost-estimation|evolution-tree-search|evolution-cost-attribution|evolution-outline|evolution-pipeline|evolution-visualization|arena-actions|manual-experiment|strategy-resolution
```

Simplified regex: `evolution-|arena-actions|manual-experiment|strategy-resolution`

**Non-evolution integration tests (16 files):**
Everything NOT matching the evolution pattern. Use `--testPathIgnorePatterns` to exclude evolution tests.

**New package.json scripts:**

```jsonc
{
  "test:integration:evolution": "jest --config jest.integration.config.js --testPathPatterns=\"evolution-|arena-actions|manual-experiment|strategy-resolution\"",
  "test:integration:non-evolution": "jest --config jest.integration.config.js --testPathIgnorePatterns=\"evolution-|arena-actions|manual-experiment|strategy-resolution\""
}
```

**Verification:** The patterns are mutually exclusive and collectively exhaustive:
- Evolution pattern matches: `evolution-infrastructure`, `evolution-actions`, `evolution-cost-estimation`, `evolution-tree-search`, `evolution-cost-attribution`, `evolution-outline`, `evolution-pipeline`, `evolution-visualization`, `arena-actions`, `manual-experiment`, `strategy-resolution` (11 files)
- Non-evolution = everything else: `auth-flow`, `explanation-generation`, `streaming-api`, `error-handling`, `vector-matching`, `rls-policies`, `source-management`, `content-report`, `metrics-aggregation`, `tag-management`, `import-articles`, `vercel-bypass`, `explanation-update`, `session-id-propagation`, `request-id-propagation`, `logging-infrastructure` (16 files)

---

### 6. New package.json Scripts

Add these 4 scripts to `package.json`:

```jsonc
{
  "scripts": {
    // ... existing scripts ...

    // Evolution E2E: runs only @evolution-tagged chromium specs (7 files, no sharding needed)
    // chromium-unauth NOT included here — it runs in non-evolution to avoid double-run on path=full
    "test:e2e:evolution": "playwright test --project=chromium --grep=@evolution",

    // Non-evolution E2E: all chromium specs EXCEPT @evolution (29 files, supports sharding) + unauth
    // Combined grepInvert pattern ensures both @evolution AND @skip-prod are excluded
    // (CLI --grep-invert may override config grepInvert rather than union with it)
    "test:e2e:non-evolution": "playwright test --project=chromium --grep-invert=\"@evolution|@skip-prod\" --project=chromium-unauth",

    // Evolution integration tests (11 files)
    "test:integration:evolution": "jest --config jest.integration.config.js --testPathPatterns=\"evolution-|arena-actions|manual-experiment|strategy-resolution\"",

    // Non-evolution integration tests (16 files)
    "test:integration:non-evolution": "jest --config jest.integration.config.js --testPathIgnorePatterns=\"evolution-|arena-actions|manual-experiment|strategy-resolution\""
  }
}
```

---

### Summary: Complete File Change List

| File | Change |
|------|--------|
| `.github/workflows/ci.yml` | Replace detect-changes script (lines 30-39); add 4 new jobs; remove `e2e-full` + `integration-full` (or keep with Option B) |
| `package.json` | Add 4 new scripts: `test:e2e:evolution`, `test:e2e:non-evolution`, `test:integration:evolution`, `test:integration:non-evolution` |
| `src/__tests__/e2e/specs/09-admin/admin-evolution.spec.ts` | Add `{ tag: '@evolution' }` to top-level describe |
| `src/__tests__/e2e/specs/09-admin/admin-arena.spec.ts` | Add `{ tag: '@evolution' }` to top-level describe |
| `src/__tests__/e2e/specs/09-admin/admin-evolution-visualization.spec.ts` | Add `{ tag: '@evolution' }` to top-level describe |
| `src/__tests__/e2e/specs/09-admin/admin-experiment-detail.spec.ts` | Add `{ tag: '@evolution' }` to top-level describe |
| `src/__tests__/e2e/specs/09-admin/admin-elo-optimization.spec.ts` | Add `{ tag: '@evolution' }` to top-level describe |
| `src/__tests__/e2e/specs/09-admin/admin-strategy-registry.spec.ts` | Add `{ tag: '@evolution' }` to top-level describe |
| `src/__tests__/e2e/specs/09-admin/admin-article-variant-detail.spec.ts` | Add `{ tag: '@evolution' }` to top-level describe |

**Total: 9 files changed, ~200 lines of CI YAML, ~7 one-line spec changes, ~4 script additions.**

---

## Testing

### Verifying the change detection script
```bash
# Test with evolution-only changes
echo "evolution/src/services/pipeline.ts" | bash -c '... script ...'
# Expected: evolution-only

# Test with non-evolution-only changes
echo "src/components/SearchBar.tsx" | bash -c '... script ...'
# Expected: non-evolution-only

# Test with shared file
echo "src/lib/schemas/foo.ts" | bash -c '... script ...'
# Expected: full

# Test with mixed
printf "evolution/foo.ts\nsrc/components/Bar.tsx" | bash -c '... script ...'
# Expected: full
```

### Verifying E2E split
```bash
# Should show exactly 7 spec files (evolution admin specs)
npx playwright test --project=chromium --grep=@evolution --list

# Should show remaining chromium specs (non-evolution) — count = total - 7
# Note: --grep-invert applies globally, so run chromium only to get clean count
npx playwright test --project=chromium --grep-invert=@evolution --list

# Verify union = full chromium set
npx playwright test --project=chromium --list
# evolution count + non-evolution count should equal full count

# Verify non-evolution script (with chromium-unauth) adds unauth tests
npx playwright test --project=chromium --grep-invert="@evolution|@skip-prod" --project=chromium-unauth --list
```

### Verifying integration split
```bash
# Should show 11 test files
npx jest --config jest.integration.config.js --testPathPatterns="evolution-|arena-actions|manual-experiment|strategy-resolution" --listTests

# Should show 16 test files
npx jest --config jest.integration.config.js --testPathIgnorePatterns="evolution-|arena-actions|manual-experiment|strategy-resolution" --listTests
```

## Rollback Plan

If CI splitting causes issues after merging:

1. **Quick revert:** Revert the single PR that implements detect-changes + split jobs. This restores `e2e-full`/`integration-full` and the binary fast/full detection. The @evolution tags on specs are harmless and can remain.

2. **Partial rollback:** If only integration splitting fails, revert just the integration split jobs and restore `integration-full`. E2E split can remain if working.

3. **Pre-merge verification checklist:**
   - `npx playwright test --project=chromium --grep=@evolution --list` shows exactly 7 files
   - `npx playwright test --project=chromium --grep-invert=@evolution --list` shows exactly 29 files
   - Sum equals full `--list` count
   - `npx jest --listTests` with both patterns sums to 27 files
   - Run the full CI workflow on a test PR before merging

## Documentation Updates
The following docs were identified as relevant and may need updates:
- `docs/docs_overall/testing_overview.md` - Document evolution test splitting, @evolution tag, and new CI paths
- `docs/feature_deep_dives/testing_setup.md` - Update CI workflow descriptions and test statistics
