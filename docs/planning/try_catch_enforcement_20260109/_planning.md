# Try-Catch Enforcement Plan

## Background

ExplainAnything has a solid logging infrastructure (`withLogging` wrapper, `logger` utilities, RequestIdContext) but it's underutilized. Only 1 of 18 services uses `withLogging`, and several services have fire-and-forget patterns that silently swallow errors.

## Problem

1. **Silent failures** - Functions like `saveLlmCallTracking` catch errors but don't propagate them, making debugging difficult
2. **Missing observability** - 17 of 18 services don't use `withLogging`, losing automatic entry/exit logging with timing
3. **Inconsistent error handling** - Some services return empty results on failure instead of throwing

## Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **A: Full blocking (chosen)** | Complete visibility, no silent failures | May break flows if callers don't handle errors |
| B: Advisory errors | Errors visible but non-blocking | Still allows some silent continuation |
| C: Logging only | Minimal code changes | Doesn't fix silent failure problem |

**Decision:** Option A - Convert all fire-and-forget to blocking errors per user request.

---

## Phased Execution Plan

### Phase 1: Infrastructure
Create ServiceError class for structured error propagation.

**File:** `src/lib/errors/serviceError.ts` (new)

```typescript
import { ErrorCode, ERROR_CODES } from '@/lib/errorHandling';

export class ServiceError extends Error {
    readonly code: ErrorCode;
    readonly context: string;
    readonly details?: Record<string, unknown>;

    constructor(
        code: ErrorCode,
        message: string,
        context: string,
        options?: { details?: Record<string, unknown>; cause?: Error }
    ) {
        super(message, { cause: options?.cause });
        this.code = code;
        this.context = context;
        this.details = options?.details;
        this.name = 'ServiceError';
    }
}
```

**Test:** Create `src/lib/errors/serviceError.test.ts`
**Verify:** `npm test -- serviceError.test.ts`

---

### Phase 2: Critical Path Services (one at a time)

#### Phase 2a: llms.ts
- Add `withLogging` to `callOpenAIModel`
- Fix silent failure in `saveLlmCallTracking` (line 63) - throw instead of swallow

**Test file:** `src/lib/services/llms.test.ts`
**Verify:** `npm test -- llms.test.ts && npm run build`

#### Phase 2b: metrics.ts
- Add `withLogging` to all exports
- Convert `.catch()` to `await` in `createUserExplanationEvent` (lines 70-81)

**Test file:** `src/lib/services/metrics.test.ts`
**Verify:** `npm test -- metrics.test.ts && npm run build`

#### Phase 2c: userLibrary.ts
- Add `withLogging` to all exports
- Convert `.catch()` to `await` in `saveExplanationToLibrary` (lines 40-48)

**Test file:** `src/lib/services/userLibrary.test.ts`
**Verify:** `npm test -- userLibrary.test.ts && npm run build`

#### Phase 2d: returnExplanation.ts
- Fix `applyTagsToExplanation` - throw instead of log-only (lines 351-416)
- Fix `extractLinkCandidates` - throw instead of return `[]` (lines 116-122)
- Fix `generateAndSaveExplanationSummary` - await instead of fire-and-forget (lines 650-662)

**Test file:** `src/lib/services/returnExplanation.test.ts`
**Verify:** `npm test -- returnExplanation.test.ts && npm run build`

#### Phase 2e: links.ts
- Add `withLogging` to all exports
- Fix `createMappingsHeadingsToLinks` - throw instead of return `{}` (lines 148-156)

**Test file:** `src/lib/services/links.test.ts`
**Verify:** `npm test -- links.test.ts && npm run build`

---

### Phase 3: Core Database Services (one at a time)

#### Phase 3a: explanations.ts
- Add `withLogging` to: `createExplanation`, `getExplanationById`, `getRecentExplanations`, `updateExplanation`, `deleteExplanation`, `getExplanationsByIds`, `getExplanationsByTopicId`

**Test file:** `src/lib/services/explanations.test.ts` (may need creation)
**Verify:** `npm test -- explanations && npm run build`

#### Phase 3b: topics.ts
- Add `withLogging` to: `createTopic`, `getTopicById`, `getRecentTopics`, `updateTopic`, `deleteTopic`, `searchTopicsByTitle`

**Test file:** `src/lib/services/topics.test.ts` (may need creation)
**Verify:** `npm run build`

#### Phase 3c: tags.ts
- Add `withLogging` to all exports

**Test file:** `src/lib/services/tags.test.ts`
**Verify:** `npm test -- tags.test.ts && npm run build`

#### Phase 3d: explanationTags.ts
- Add `withLogging` to all junction operations

**Test file:** `src/lib/services/explanationTags.test.ts`
**Verify:** `npm test -- explanationTags.test.ts && npm run build`

#### Phase 3e: userQueries.ts
- Add `withLogging` to: `createUserQuery`, `getRecentUserQueries`, `getUserQueryById`

**Test file:** `src/lib/services/userQueries.test.ts` (may need creation)
**Verify:** `npm run build`

---

### Phase 4: External API Services (one at a time)

#### Phase 4a: vectorsim.ts
- Add `withLogging` to: `findMatchesInVectorDb`, `processContentToStoreEmbedding`, `searchForSimilarVectors`, `loadFromPineconeUsingExplanationId`

**Test file:** `src/lib/services/vectorsim.test.ts`
**Verify:** `npm test -- vectorsim.test.ts && npm run build`

#### Phase 4b: findMatches.ts
- Add `withLogging` to: `findBestMatchFromList`, `enhanceMatchesWithCurrentContentAndDiversity`

**Test file:** `src/lib/services/findMatches.test.ts`
**Verify:** `npm test -- findMatches.test.ts && npm run build`

#### Phase 4c: importArticle.ts
- Add `withLogging` to: `cleanupAndReformat`, `detectSource`, `validateImportContent`

**Test file:** `src/lib/services/importArticle.test.ts`
**Verify:** `npm test -- importArticle.test.ts && npm run build`

#### Phase 4d: linkWhitelist.ts
- Add `withLogging` to all exports (15+ functions)

**Test file:** `src/lib/services/linkWhitelist.test.ts`
**Verify:** `npm test -- linkWhitelist.test.ts && npm run build`

---

### Phase 5: Support Services (one at a time)

#### Phase 5a: sourceCache.ts
- Add `withLogging` to all exports

**Test file:** `src/lib/services/sourceCache.test.ts` (may need creation)
**Verify:** `npm run build`

#### Phase 5b: sourceFetcher.ts
- Add `withLogging` to `fetchAndExtractSource`

**Test file:** `src/lib/services/sourceFetcher.test.ts`
**Verify:** `npm test -- sourceFetcher.test.ts && npm run build`

#### Phase 5c: linkResolver.ts
- Add `withLogging` to all exports

**Test file:** `src/lib/services/linkResolver.test.ts`
**Verify:** `npm test -- linkResolver.test.ts && npm run build`

#### Phase 5d: linkCandidates.ts
- Add `withLogging` to all exports

**Test file:** `src/lib/services/linkCandidates.test.ts` (may need creation)
**Verify:** `npm run build`

#### Phase 5e: testingPipeline.ts
- Add `withLogging` to all exports

**Test file:** `src/lib/services/testingPipeline.test.ts`
**Verify:** `npm test -- testingPipeline.test.ts && npm run build`

---

### Phase 6: Final Verification

Run full test suite and integration tests:
```bash
npm run build
npm run lint
npx tsc --noEmit
npm test
npm run test:integration
```

**Manual verification on staging:**
1. Create a new explanation - verify logging in Grafana
2. Save to library - verify metrics increment visible (not silent)
3. Trigger a tag application - verify error visible if fails
4. Check Sentry for any new error patterns

---

### Phase 7: Prevention Hook

Create a Claude hook that blocks new silent failure patterns from being introduced.

**File:** `.claude/hooks/block-silent-failures.sh` (new)

```bash
#!/bin/bash
# Block silent failure patterns in try-catch blocks
# Allows exceptions with documented reasons via @silent-ok comment

FILE_PATH="$1"
NEW_CONTENT="$2"

# Only check TypeScript/JavaScript files in src/
if [[ ! "$FILE_PATH" =~ ^src/.*\.(ts|tsx|js|jsx)$ ]]; then
    exit 0
fi

# Patterns that indicate silent failure (without @silent-ok)
# 1. Empty catch blocks: catch (error) { }
# 2. Catch that only logs: catch (error) { logger.error(...); }
# 3. Catch that returns empty: catch (error) { return []; }

# Check for problematic patterns
ISSUES=""

# Pattern 1: Empty catch blocks
if echo "$NEW_CONTENT" | grep -Pzo 'catch\s*\([^)]*\)\s*\{\s*\}' | grep -v '@silent-ok' > /dev/null 2>&1; then
    ISSUES="${ISSUES}\n- Empty catch block detected"
fi

# Pattern 2: Catch block with only logging (no throw/return error)
# This is complex to detect perfectly, use heuristic
if echo "$NEW_CONTENT" | grep -P 'catch.*\{[^}]*logger\.(error|warn)[^}]*\}' | grep -v 'throw' | grep -v '@silent-ok' > /dev/null 2>&1; then
    ISSUES="${ISSUES}\n- Catch block logs but doesn't throw - add @silent-ok comment if intentional"
fi

# Pattern 3: Catch returning empty array/object without throw
if echo "$NEW_CONTENT" | grep -P 'catch.*\{[^}]*return\s*(\[\]|\{\})' | grep -v 'throw' | grep -v '@silent-ok' > /dev/null 2>&1; then
    ISSUES="${ISSUES}\n- Catch block returns empty value - add @silent-ok comment if intentional"
fi

if [ -n "$ISSUES" ]; then
    echo "BLOCKED: Silent failure pattern detected"
    echo ""
    echo "Issues found:$ISSUES"
    echo ""
    echo "To fix:"
    echo "  1. Throw the error: throw new ServiceError(...)"
    echo "  2. Or add exemption comment if intentional:"
    echo "     // @silent-ok: <reason> (e.g., 'external API graceful degradation')"
    echo ""
    echo "Valid @silent-ok reasons:"
    echo "  - external API graceful degradation"
    echo "  - non-critical background task"
    echo "  - user experience preservation"
    echo "  - rate limiting fallback"
    exit 1
fi

exit 0
```

**Hook configuration in `.claude/settings.json`:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "command": "bash .claude/hooks/block-silent-failures.sh \"$FILE_PATH\" \"$NEW_CONTENT\""
      }
    ]
  }
}
```

**Valid exemption patterns:**
```typescript
// @silent-ok: external API graceful degradation
catch (error) {
    logger.warn('External API failed, using fallback', { error });
    return defaultValue;
}

// @silent-ok: non-critical background task
catch (error) {
    logger.error('Background sync failed', { error });
    // Continue without blocking user flow
}

// @silent-ok: user experience preservation
catch (error) {
    logger.error('Enhancement failed', { error });
    return originalContent; // Return unenhanced rather than fail
}
```

**Test the hook:**
```bash
# Should be blocked (no @silent-ok)
echo 'catch (e) { logger.error(e); }' > /tmp/test.ts
bash .claude/hooks/block-silent-failures.sh "/tmp/test.ts" "$(cat /tmp/test.ts)"
# Expected: BLOCKED

# Should pass (has @silent-ok)
echo '// @silent-ok: graceful degradation
catch (e) { logger.error(e); }' > /tmp/test.ts
bash .claude/hooks/block-silent-failures.sh "/tmp/test.ts" "$(cat /tmp/test.ts)"
# Expected: exit 0
```

---

## Rollback Plan

If changes break production after deployment:

### Immediate Rollback (< 5 min)
```bash
# Revert to previous deployment
git revert HEAD --no-edit
git push origin main
# Vercel auto-deploys on push to main
```

### Partial Rollback (specific service)
If only one service is causing issues:
1. Identify failing service from Sentry errors
2. Revert just that file: `git checkout HEAD~1 -- src/lib/services/<file>.ts`
3. Push hotfix

### Feature Flag Alternative
If rollback is complex, temporarily disable blocking:
```typescript
// In serviceError.ts - add escape hatch
const BLOCKING_ENABLED = process.env.SERVICE_ERRORS_BLOCKING !== 'false';

// In catch blocks
if (BLOCKING_ENABLED) {
    throw new ServiceError(...);
} else {
    logger.error('ServiceError suppressed', { ... });
}
```

### Monitoring During Rollout
- Watch Sentry error rate for 30 min post-deploy
- Check Grafana for increased error logs
- Verify core flows: create explanation, save to library, tag application

---

## Testing

### Test Files to Modify/Create

| Service | Test File | Status |
|---------|-----------|--------|
| serviceError | `src/lib/errors/serviceError.test.ts` | NEW |
| llms | `src/lib/services/llms.test.ts` | Modify - add error propagation tests |
| metrics | `src/lib/services/metrics.test.ts` | Modify - remove fire-and-forget expectations |
| userLibrary | `src/lib/services/userLibrary.test.ts` | Modify - expect errors to propagate |
| returnExplanation | `src/lib/services/returnExplanation.test.ts` | Modify - update error expectations |
| links | `src/lib/services/links.test.ts` | Modify - expect throws instead of empty |
| explanations | `src/lib/services/explanations.test.ts` | Exists - add withLogging tests |
| topics | `src/lib/services/topics.test.ts` | Exists - add withLogging tests |
| tags | `src/lib/services/tags.test.ts` | Exists |
| explanationTags | `src/lib/services/explanationTags.test.ts` | Exists |
| vectorsim | `src/lib/services/vectorsim.test.ts` | Exists |
| findMatches | `src/lib/services/findMatches.test.ts` | Exists |
| importArticle | `src/lib/services/importArticle.test.ts` | Exists |
| linkWhitelist | `src/lib/services/linkWhitelist.test.ts` | Exists |
| sourceCache | `src/lib/services/sourceCache.test.ts` | **NEW - must create** |
| sourceFetcher | `src/lib/services/sourceFetcher.test.ts` | Exists |
| linkResolver | `src/lib/services/linkResolver.test.ts` | Exists |
| linkCandidates | `src/lib/services/linkCandidates.test.ts` | **NEW - must create** |
| testingPipeline | `src/lib/services/testingPipeline.test.ts` | Exists |
| userQueries | `src/lib/services/userQueries.test.ts` | Exists - add withLogging tests |

### New Test Cases Required

For each service with silent failures being converted:

```typescript
describe('error propagation', () => {
    it('should throw ServiceError on database failure', async () => {
        // Mock Supabase to return error
        mockSupabase.from().insert.mockResolvedValue({ error: { message: 'DB error' } });

        await expect(serviceFunction(args))
            .rejects.toThrow(ServiceError);
    });

    it('should include context in ServiceError', async () => {
        mockSupabase.from().insert.mockResolvedValue({ error: { message: 'DB error' } });

        try {
            await serviceFunction(args);
        } catch (error) {
            expect(error).toBeInstanceOf(ServiceError);
            expect(error.context).toBe('functionName');
            expect(error.code).toBe(ERROR_CODES.DATABASE_ERROR);
        }
    });
});
```

### E2E Test Updates Required

**File:** `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts`

This E2E test validates error handling behavior. When converting fire-and-forget to blocking errors, review and update:

1. **Check current error expectations** - Tests may expect graceful degradation
2. **Update assertions** - If a feature now fails instead of continuing, update test expectations
3. **Add new error scenarios** - Test that new ServiceErrors are properly caught and displayed to users

```bash
# Run E2E error tests after Phase 2
npm run test:e2e -- --grep "error"
```

### Test Files to Create

#### sourceCache.test.ts
```typescript
// src/lib/services/sourceCache.test.ts
import { insertSourceCache, getSourceByUrl, getOrCreateCachedSource } from './sourceCache';

describe('sourceCache', () => {
    describe('insertSourceCache', () => {
        it('should insert cache entry successfully', async () => { ... });
        it('should throw on database error', async () => { ... });
    });
    // ... additional tests
});
```

#### linkCandidates.test.ts
```typescript
// src/lib/services/linkCandidates.test.ts
import { upsertCandidate, getCandidateById, saveCandidatesFromLLM } from './linkCandidates';

describe('linkCandidates', () => {
    describe('upsertCandidate', () => {
        it('should upsert candidate successfully', async () => { ... });
        it('should throw on database error', async () => { ... });
    });
    // ... additional tests
});
```

---

## Documentation Updates

| File | Update |
|------|--------|
| `docs/docs_overall/architecture.md` | Add ServiceError to error handling section |
| `docs/feature_deep_dives/logging_infrastructure.md` | Document withLogging coverage (create if needed) |
| `.claude/hooks/block-silent-failures.sh` | **NEW** - Prevention hook for silent failures |
| `.claude/settings.json` | Add PreToolUse hook for silent failure detection |

---

## Verification Checklist

- [ ] Phase 1: ServiceError class created with tests
- [ ] Phase 2a: llms.ts - withLogging + error propagation
- [ ] Phase 2b: metrics.ts - withLogging + blocking await
- [ ] Phase 2c: userLibrary.ts - withLogging + blocking await
- [ ] Phase 2d: returnExplanation.ts - all fire-and-forget fixed
- [ ] Phase 2e: links.ts - withLogging + throw on error
- [ ] Phase 3a-e: Core DB services have withLogging
- [ ] Phase 4a-d: External API services have withLogging
- [ ] Phase 5a-e: Support services have withLogging
- [ ] Phase 6: Full test suite passes
- [ ] Phase 6: Manual staging verification complete
- [ ] Phase 7: Prevention hook created and tested
- [ ] Phase 7: Hook added to .claude/settings.json
- [ ] Documentation updated
