# Questions About Evolution Pipeline Progress

## Phase 1: Research
### Work Done
- Investigated evolution code file locations (src/lib/evolution/)
- Confirmed long-lived job support: continuation-passing (800s Vercel) + GitHub Actions batch runner (7h)
- Documented cron config: evolution-runner every 5 min (production only)

### Issues Encountered
- Project folder created at wrong path; fixed via `git mv` to match `docs/planning/${BRANCH}` convention

### User Clarifications
- User wanted to know code locations and long-lived job support

## Phase 2: Sentry Bug Investigation & Fix
### Work Done
- Investigated Sentry issue EXPLAINANYTHING-Y: "ServiceError: Failed to save LLM call tracking"
- Traced root cause: `hallOfFameIntegration.ts:204` passed `'system'` (string) as userid to `runHallOfFameComparisonInternal`, but `llmCallTracking.userid` is `uuid NOT NULL`
- Found secondary bug: `callOpenAIModel` doesn't catch tracking errors (unlike `callAnthropicModel`)
- Found tertiary issue: Zod schema used `z.string()` instead of `z.string().uuid()` for userid

### Fixes Applied
1. **Fix 1** (`hallOfFameIntegration.ts`): Replaced `'system'` with `EVOLUTION_SYSTEM_USERID` UUID constant (exported from `llmClient.ts`)
2. **Fix 2** (`llms.ts`): Wrapped `saveLlmCallTracking` in try-catch in `callOpenAIModel` (matching `callAnthropicModel` pattern)
3. **Fix 3** (`schemas.ts`): Changed `userid: z.string()` to `userid: z.string().uuid()` in `llmCallTrackingSchema`

### Tests Updated
- `schemas.test.ts`: Updated all `userid: 'user123'` → valid UUID, added "should reject non-UUID userid" test (71 tests pass)
- `hallOfFameIntegration.test.ts`: Added test verifying `EVOLUTION_SYSTEM_USERID` is passed to auto re-rank (14 tests pass)
- Verified no regressions: route.test.ts (13/13), metrics.test.ts (28/28), all evolution tests (1111/1111)

### Issues Encountered
- None — all fixes clean, tsc and lint pass
