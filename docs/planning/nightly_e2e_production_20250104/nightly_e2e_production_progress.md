# Nightly E2E Production Progress

## Phase 1: Setup & Documentation

### Work Done
- Created project folder `/docs/planning/nightly_e2e_production_20250104`
- Created research doc with exploration findings
- Created planning doc
- Created this progress doc

### Issues Encountered
None

### User Clarifications
- Scope: Replace dev nightly (not run alongside)
- Data handling: Dedicated prod test user with full cleanup
- AI responses: Real AI (no mocking)
- Test scope: Full suite

## Phase 2: Prerequisites (Manual)

### Work Done
- (pending) Create production test user in Supabase
- (pending) Configure GitHub Production environment secrets

### Issues Encountered
(to be filled after manual setup)

## Phase 3: Workflow & Config Changes

### Work Done
- Replaced `.github/workflows/e2e-nightly.yml` with production-targeting workflow
  - Changed environment from `staging` to `Production`
  - Added `BASE_URL: https://explainanything.vercel.app`
  - Removed `E2E_TEST_MODE: 'true'` to use real AI
  - Added `max-parallel: 1` for sequential browser execution (avoid rate limiting)
  - Added health check step with Vercel bypass headers
  - Added `@skip-prod` audit step (BLOCKING pre-flight check)
  - Added `--grep-invert="@skip-prod"` to exclude mock-dependent tests
  - Added Slack notification on failure
  - Changed artifact retention to 30 days

- Updated `playwright.config.ts`:
  - Added `isProduction` detection based on BASE_URL
  - Set `fullyParallel: false` in production (serial execution)
  - Set `retries: 3` in production (vs 2 in CI, 0 locally)
  - Set `workers: 1` in production (avoid rate limiting)
  - Extended `timeout` to 120s in production (vs 60s CI)
  - Extended `expect.timeout` to 60s in production (vs 20s CI)

### Issues Encountered
None

## Phase 4: Test Safety Updates

### Work Done
#### 4.1 global-setup.ts
- Added `isProduction` detection after server readiness check
- Added production safety cross-validation:
  - Verifies TEST_USER_ID, TEST_USER_EMAIL, and SUPABASE_SERVICE_ROLE_KEY are present
  - Fetches user by ID and verifies email matches TEST_USER_EMAIL
  - Verifies email contains `e2e` or `test` pattern
  - Uses 10s timeout on Supabase calls
  - Throws immediately on any validation failure (fail-fast)
- Modified fixture seeding to skip in production (`!isProduction`)

#### 4.2 global-teardown.ts
- Added 10s timeout to Supabase client
- Added production safety check before any destructive operations:
  - Re-verifies test user email pattern
  - Aborts gracefully on any verification failure
  - Returns successfully without cleanup on safety failures (fail-safe)

### Issues Encountered
None

## Phase 5: Test Suite Modifications

### Work Done
- Added `@skip-prod` tag to `errors.spec.ts` describe block (line 18)
  - Tests use `mockReturnExplanationAPIError` and `mockReturnExplanationStreamError`
  - Cannot run against production (require mocked errors)

- Added `@skip-prod` tag to `error-recovery.spec.ts` describe block (line 35)
  - Tests use `mockAISuggestionsPipelineAPI` to simulate errors
  - Cannot run against production (require mocked errors)

### Issues Encountered
None

## Phase 6: Validation & Wrap-up

### Work Done
- TypeScript compilation: PASSED
- Build: PASSED
- YAML syntax validated for workflow file

### Files Modified
| File | Changes |
|------|---------|
| `.github/workflows/e2e-nightly.yml` | Complete rewrite for production |
| `playwright.config.ts` | Added isProduction detection and conditional config |
| `src/__tests__/e2e/setup/global-setup.ts` | Added production safety check, skip fixture seeding |
| `src/__tests__/e2e/setup/global-teardown.ts` | Added production safety check with abort |
| `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts` | Added @skip-prod tag |
| `src/__tests__/e2e/specs/06-ai-suggestions/error-recovery.spec.ts` | Added @skip-prod tag |

### Remaining Manual Steps (Phase 2 Prerequisites)
1. Create production test user in Supabase dashboard
   - Email: `e2e-nightly-test@explainanything.com` (must contain `e2e` or `test`)
   - Note the UUID after creation
2. Configure GitHub Production environment secrets:
   - `TEST_USER_EMAIL`
   - `TEST_USER_PASSWORD`
   - `TEST_USER_ID`
   - `SUPABASE_SERVICE_ROLE_KEY` (production)
   - `VERCEL_AUTOMATION_BYPASS_SECRET`
   - `SLACK_WEBHOOK_URL`
   - `PINECONE_INDEX_NAME_ALL` = `explainanythingprodlarge`
3. Verify Pinecone index `explainanythingprodlarge` exists
4. Run manual workflow dispatch to test
