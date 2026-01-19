# Analyze Site Performance Plan

## Background
ExplainAnything is a 60k+ LOC Next.js 15 application with comprehensive observability (Sentry + Honeycomb) but limited performance optimization. Research identified opportunities in bundle size (2.9MB client chunks, 73 client components), database queries (sequential patterns, client-side aggregation), caching (no CDN config, explicit no-cache), and streaming (no timeout handling, single-shot).

## Problem
The platform lacks systematic performance optimization across multiple layers. Bundle size is larger than necessary due to limited code splitting. Database queries use sequential patterns with client-side joining instead of PostgREST JOINs. No caching layer exists beyond database-backed source cache. Streaming has no resilience (no timeouts, no reconnection, no backpressure).

## Goals
- **Faster page loads** - Reduce bundle size, add caching, optimize queries
- **Lower infrastructure costs** - Reduce database queries, add caching layer
- **Comprehensive audit** - Document current state and improvements
- **Excludes**: AI/LLM latency optimizations (outside scope)

## Success Metrics
| Metric | Current | Target |
|--------|---------|--------|
| Client bundle size | 2.9MB | < 2MB |
| Time to Interactive | TBD | < 3s |
| LCP | TBD | < 2.5s |
| Database queries/page | 3-5 | 1-2 |
| ~~Cache hit rate~~ | ~~0%~~ | ~~> 50%~~ | *(Out of scope - see Appendix)* |

---

## Phase 0: FAST_DEV Mode (Immediate)

### Problem
Local development server is slow due to observability overhead:
- 100% Sentry trace sampling in dev
- OpenTelemetry spans on every operation
- `withServerLogging`/`withServerTracing` wrappers on all functions
- Console interception and remote log flushing

### Solution
Add `FAST_DEV=true` environment variable that disables all observability for maximum local dev speed.

### Production Safeguard
**CRITICAL:** FAST_DEV must NEVER run in production. Add runtime guard (not module-level throw):
```typescript
// In sentry configs and instrumentation.ts - runtime check inside init function
export async function register() {
  // Runtime check prevents production FAST_DEV, allows CI builds
  if (process.env.NODE_ENV === 'production' && process.env.FAST_DEV === 'true' && !process.env.CI) {
    console.error('FATAL: FAST_DEV cannot be enabled in production');
    return; // Graceful degradation instead of crash
  }

  if (process.env.FAST_DEV === 'true') {
    console.log('⚡ FAST_DEV: Skipping initialization');
    return;
  }
  // ... normal initialization
}
```
**Note:** Uses runtime check inside function (not module-level throw) to allow CI builds to succeed. Follows E2E_TEST_MODE pattern in `returnExplanation/route.ts:15-17` which includes CI exception.

### Behavior
| Component | Normal Dev | FAST_DEV=true |
|-----------|------------|---------------|
| Sentry (client/server/edge) | Initialized, 100% traces | **Skipped entirely** |
| OpenTelemetry | Full SDK + 4 tracers | **Skipped** |
| `withServerLogging()` | Logs inputs/outputs/duration | **Pass-through (no-op)** |
| `withServerTracing()` | Creates spans | **Pass-through (no-op)** |
| Console interceptor | Patches console.* | **Skipped** |
| Remote log flusher | Batches logs to server | **Skipped** |

### Files to Modify

**Sentry configs** (`sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`):
```typescript
if (process.env.FAST_DEV === 'true') {
  // Skip Sentry initialization
} else {
  Sentry.init({ /* existing config */ });
}
```

**OpenTelemetry** (`instrumentation.ts`):
```typescript
export async function register() {
  if (process.env.FAST_DEV === 'true') {
    console.log('⚡ FAST_DEV: Skipping OpenTelemetry initialization');
    return;
  }
  // ... existing OTLP setup
}
```

**Logging wrappers** (`src/lib/logging/server/automaticServerLoggingBase.ts`):
```typescript
export function withServerLogging<T>(fn: T, name: string, config?: LogConfig): T {
  if (process.env.FAST_DEV === 'true') return fn; // Pass through
  // ... existing wrapper logic
}

export function withServerTracing<T>(fn: T, name: string, config?: TraceConfig): T {
  if (process.env.FAST_DEV === 'true') return fn; // Pass through
  // ... existing wrapper logic
}
```

**Client logging** (`consoleInterceptor.ts`, `remoteFlusher.ts`):
```typescript
// Client-side needs NEXT_PUBLIC_ prefix
export function initConsoleInterceptor() {
  if (process.env.NEXT_PUBLIC_FAST_DEV === 'true') return;
  // ... existing logic
}
```

**Also update deprecated alias** (`withLogging` used in 42 files):
The codebase uses both `withLogging` (deprecated alias) and `withServerLogging`. Both must check FAST_DEV. The alias is defined in the same file.

### Usage
Add to `.env.local` (not committed):
```bash
FAST_DEV=true
NEXT_PUBLIC_FAST_DEV=true  # For client-side checks
```

### Environment Variable Documentation
Add to `.env.example`:
```bash
# Development performance mode
# Disables Sentry, OpenTelemetry, logging wrappers for faster local dev
# NEVER enable in production (has explicit guard)
FAST_DEV=
NEXT_PUBLIC_FAST_DEV=
```

### Testing (Phase 0)
**Test files (co-located with source):**
- `src/lib/logging/server/__tests__/fastDevMode.test.ts` - Server-side wrapper tests
- `instrumentation.test.ts` (root) - OTLP initialization tests

**Test cases:**
1. **Production guard test:** Verify console error + graceful return when `NODE_ENV=production && FAST_DEV=true && !CI`
2. **CI exception test:** Verify initialization proceeds when `NODE_ENV=production && FAST_DEV=true && CI=true`
3. **Server skip test:** Verify Sentry/OTLP not initialized when FAST_DEV=true
4. **Wrapper passthrough test:** Verify `withServerLogging` returns original function
5. **Client skip test:** Verify console interceptor not patched when NEXT_PUBLIC_FAST_DEV=true
6. **Toggle test:** Remove FAST_DEV, confirm observability returns

---

## Phased Execution Plan

### Phase 1: Bundle Optimization (Days 1-2)

#### 1.1 Add Bundle Analyzer
**Files to modify:**
- `next.config.ts` - Wrap with bundle analyzer
- `package.json` - Add `@next/bundle-analyzer`, `npm run analyze` script

**Changes:**
- Add `@next/bundle-analyzer` for visibility
- Document baseline bundle sizes before changes

#### 1.2 Optimize Icon Imports
**Files to modify:** All files importing from `lucide-react` (8 locations), `@heroicons/react` (8 locations)

**Changes:**
- Convert barrel imports to direct imports: `import { Sun } from 'lucide-react'` → `import Sun from 'lucide-react/dist/esm/icons/sun'`
- Or create local icon barrel file with only used icons

#### 1.3 Add Code Splitting for Heavy Components
**Files to modify:**
- `src/app/results/page.tsx` - Lexical editor (largest client component)
- `src/components/sources/Bibliography.tsx` - KaTeX rendering

**Changes:**
- Wrap Lexical editor in `dynamic()` with loading skeleton
- Lazy-load KaTeX only when math content detected
- Add Suspense boundaries around heavy components

#### 1.4 Tree-Shaking Configuration
**Files to modify:**
- `package.json` - Add `sideEffects: false`
- `next.config.ts` - Optimize webpack config

---

### Phase 2: Database Query Optimization (Days 3-4)

#### 2.1 Add PostgREST JOINs
**Files to modify:**
- `src/lib/services/userLibrary.ts` - Replace sequential queries with JOIN
- `src/lib/services/explanations.ts` - getRecentExplanations optimization

**Current pattern (2 queries):**
```typescript
const library = await supabase.from('userLibrary').select('explanationid');
const explanations = await getExplanationsByIds(ids);
```

**Optimized pattern (1 query with JOIN):**
```typescript
// Note: Requires FK relationship between userLibrary.explanationid -> explanations.id
// Verify FK exists: SELECT * FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY'
const { data } = await supabase
  .from('userLibrary')
  .select('*, explanations!userLibrary_explanationid_fkey(*)')
  .eq('userid', userid);
```

**Prerequisites:**
1. Verify FK exists in database schema (check `supabase/migrations/`)
2. If FK missing, create migration to add it first
3. Test RLS policies work with JOIN (see Security section below)

**RLS Security Verification (CRITICAL):**
The existing `userLibrary` table uses RLS. JOINed queries must be tested to prevent cross-user data leakage:
```sql
-- Test as authenticated user A
SET request.jwt.claim.sub = 'user-a-uuid';
SELECT * FROM userLibrary ul
JOIN explanations e ON ul.explanationid = e.id
WHERE ul.userid = 'user-b-uuid';  -- Should return 0 rows

-- Verify RLS policy restricts to own data
```
**Test file:** `src/__tests__/integration/userLibraryJoin.test.ts`

#### 2.2 Server-Side View Count Aggregation
**Files to create:**
- `supabase/migrations/YYYYMMDD_add_view_count_view.sql`

**Changes:**
- Create materialized view for view counts by explanation
- Add refresh trigger or scheduled job
- Remove client-side Map aggregation from `getRecentExplanations`

#### 2.3 Add Missing Indexes
**Files to create:**
- `supabase/migrations/YYYYMMDD_add_performance_indexes.sql`

**Indexes to add:**
- `idx_user_explanation_events_explanationid_eventname` - Composite for view count queries
- `idx_explanations_status_timestamp` - Composite for recent published queries

---

### Phase 3: Streaming Resilience (Days 5-6)

#### 3.1 Add Stream Timeout Handling
**Files to modify:**
- `src/app/api/returnExplanation/route.ts`
- `src/app/results/page.tsx`

**Server-side changes:**
- Add heartbeat ping every 30s during long operations
- Add overall stream timeout (5 min max)

**Client-side changes:**
- Add timeout detection (no data for 60s)
- Show "Connection lost" UI with retry button

#### 3.2 Add Proper SSE MIME Type
**Files to modify:**
- `src/app/api/returnExplanation/route.ts`
- `src/app/api/stream-chat/route.ts`

**Changes:**
- Change `Content-Type: text/plain` → `Content-Type: text/event-stream`
- Add `event:` field to SSE messages for proper parsing
- Consider using EventSource API on client (optional)

#### 3.3 Add Graceful Stream Error Recovery
**Files to modify:**
- `src/app/results/page.tsx`

**Changes:**
- Store partial content on error
- Add "Resume" functionality using last received content
- Show partial results with error banner

---

### Phase 4: Observability & Monitoring (Day 7)

#### 4.1 Add Web Vitals Collection
**Files to create:**
- `src/lib/webVitals.ts` - Web Vitals reporter

**Files to modify:**
- `src/app/layout.tsx` - Initialize Web Vitals

**Changes:**
- Add `web-vitals` package
- Report CLS, FCP, LCP, TTFB, FID to Sentry/Honeycomb
- Create dashboard for Core Web Vitals trends

#### 4.2 Add Performance Marks
**Files to modify:**
- `src/app/results/page.tsx` - Add performance.mark() calls
- `src/lib/services/returnExplanation.ts` - Add timing spans

**Changes:**
- Mark key milestones: page_load_start, streaming_start, content_complete
- Report timings to observability backend

---

## Testing Plan

### Test File Locations by Phase

**Note:** Project uses co-located tests (alongside source files) and integration tests in `src/__tests__/integration/`. E2E tests are in `src/__tests__/e2e/specs/`.

**Phase 0 (FAST_DEV):**
- `src/lib/logging/server/__tests__/fastDevMode.test.ts` - Production guard, wrapper passthrough (co-located)
- `instrumentation.test.ts` (root) - OTLP skip test

**Phase 1 (Bundle):**
- `src/components/__tests__/dynamicImports.test.ts` - Verify dynamic() loading
- Manual verification: `npm run analyze` output comparison

**Phase 2 (Database):**
- `src/__tests__/integration/userLibraryJoin.test.ts` - JOIN queries with RLS
- `src/__tests__/integration/viewCountAggregation.test.ts` - Materialized view refresh
- Manual: `EXPLAIN ANALYZE` for query timing

**Phase 3 (Streaming):**
- `src/app/api/returnExplanation/__tests__/streamTimeout.test.ts` - Heartbeat and timeout logic (co-located)
- `src/__tests__/e2e/specs/streaming-recovery.spec.ts` - Error recovery UI flow

**Phase 4 (Observability):**
- `src/lib/webVitals.test.ts` - Metrics reporting (co-located)

### Verification Commands
```bash
# Bundle analysis (before/after comparison)
npm run analyze

# Lighthouse audit
npx lighthouse https://localhost:3000 --output=json

# Query timing
EXPLAIN ANALYZE SELECT * FROM userLibrary ul JOIN explanations e ON ul.explanationid = e.id WHERE ul.userid = '...';

# Run all performance tests
npm test -- --grep "performance"
```

---

## Rollback Plan

### Database Migrations
All migrations in `supabase/migrations/` are versioned and reversible:

**Rollback procedure:**
```bash
# List migrations
supabase migration list

# Rollback to specific version (local)
supabase db reset --version YYYYMMDD_previous

# Production rollback requires manual SQL:
# 1. DROP INDEX idx_user_explanation_events_explanationid_eventname;
# 2. DROP MATERIALIZED VIEW IF EXISTS view_counts;
```

**Migration files to create with DOWN scripts:**
- `supabase/migrations/YYYYMMDD_add_performance_indexes.sql` - Include DROP INDEX statements
- `supabase/migrations/YYYYMMDD_add_view_count_view.sql` - Include DROP VIEW statement

### Feature Flags
Use environment variables for instant rollback without deployment:

| Feature | Flag | Default |
|---------|------|---------|
| FAST_DEV mode | `FAST_DEV` | `false` |

### Code Rollback
All changes are on feature branch. If issues arise:
1. Disable feature flags immediately
2. Revert specific commits if needed
3. Deploy previous known-good version

---

## CI/CD Changes

### New GitHub Actions Workflow Steps
Add to `.github/workflows/ci.yml`:

```yaml
# After existing build step
- name: Bundle Size Check
  run: |
    npm run analyze -- --json > bundle-stats.json
    # Fail if client bundle > 2.5MB (with buffer)
    node -e "
      const stats = require('./bundle-stats.json');
      const clientSize = stats.assets.filter(a => a.name.includes('client')).reduce((sum, a) => sum + a.size, 0);
      if (clientSize > 2.5 * 1024 * 1024) {
        console.error('Client bundle too large:', clientSize);
        process.exit(1);
      }
    "

- name: Performance Regression Test
  run: npm run test:performance
```

### New Scripts in package.json
```json
{
  "scripts": {
    "analyze": "ANALYZE=true next build",
    "test:performance": "jest --testPathPattern=performance",
    "perf:baseline": "npm run build 2>&1 | tee docs/planning/analyze_site_performance_20260117/baseline-build.log && npx lighthouse http://localhost:3000 --output=json --output-path=docs/planning/analyze_site_performance_20260117/baseline-lighthouse.json"
  }
}
```

### test:performance Implementation
Create `src/__tests__/performance/bundle-size.test.ts`:
```typescript
import { readFileSync } from 'fs';
import { glob } from 'glob';

describe('Bundle Size Limits', () => {
  it('client bundle should be under 2.5MB', async () => {
    const clientChunks = await glob('.next/static/chunks/**/*.js');
    const totalSize = clientChunks.reduce((sum, file) =>
      sum + readFileSync(file).length, 0);
    expect(totalSize).toBeLessThan(2.5 * 1024 * 1024);
  });
});
```

---

## Performance Regression Strategy

### Baseline Capture (Before Implementation)
Run and document before starting Phase 1. Files stored in this planning folder for version control:

**Baseline file locations:**
- `docs/planning/analyze_site_performance_20260117/baseline-build.log` - Build output with chunk sizes
- `docs/planning/analyze_site_performance_20260117/baseline-lighthouse.json` - Lighthouse Core Web Vitals

```bash
# Run baseline capture script (creates both files)
npm run perf:baseline

# Or manually:
# Capture current bundle sizes
npm run build 2>&1 | tee docs/planning/analyze_site_performance_20260117/baseline-build.log

# Capture Lighthouse scores (requires dev server running)
npx lighthouse http://localhost:3000 --output=json \
  --output-path=docs/planning/analyze_site_performance_20260117/baseline-lighthouse.json

# Document database query counts (manual observation in Supabase dashboard)
# Current: 3-5 queries per page load - note in progress.md
```

**Commit baseline files** so they're tracked for comparison.

### Continuous Monitoring
After each phase:
1. Re-run bundle analysis and compare to baseline
2. Run Lighthouse and compare Core Web Vitals
3. Check Sentry/Honeycomb for query count changes

### Alerting Thresholds
Set up alerts in Sentry/Honeycomb:
- LCP > 3s (warn), > 4s (critical)
- Bundle size increase > 100KB between deploys
- Database query count > 5 per page load

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| PostgREST JOINs | Medium | Test thoroughly in integration tests |
| SSE MIME type | Low | Test in all browsers |
| Bundle splitting | Medium | Verify with bundle analyzer |
| Materialized views | Medium | Start with manual refresh, add automation |

---

## Documentation Updates
- `docs/feature_deep_dives/search_generation_pipeline.md` - Update streaming documentation
- `docs/docs_overall/environments.md` - Document FAST_DEV mode

---

## Files to Modify Summary

### Phase 1 (Bundle)
- `next.config.ts`
- `package.json`
- `src/app/results/page.tsx`
- `src/components/sources/Bibliography.tsx`
- All files with lucide-react/heroicons imports

### Phase 2 (Database)
- `src/lib/services/userLibrary.ts`
- `src/lib/services/explanations.ts`
- `supabase/migrations/` (new migration files)

### Phase 3 (Streaming)
- `src/app/api/returnExplanation/route.ts`
- `src/app/api/stream-chat/route.ts`
- `src/app/results/page.tsx`

### Phase 4 (Observability)
- `src/app/layout.tsx`
- New: `src/lib/webVitals.ts`

---

## Appendix: Out of Scope

### Caching Layer (Deferred)

The following caching optimizations were researched but deferred due to complexity around cache invalidation:

#### A.1 Vercel Edge Caching Headers
- Add `Cache-Control` headers to `next.config.ts`
- Limited value for dynamic content

#### A.2 ISR for Explore Page
- Add `export const revalidate = 300` to `/explanations` page
- **Concern:** Cache invalidation on publish/unpublish requires on-demand revalidation calls throughout the codebase

#### A.3 React Query for Client-Side Caching
- Add `@tanstack/react-query` for browser-side caching
- Files: `src/lib/queryClient.ts`, `src/contexts/QueryProvider.tsx`
- **Concern:** Adds complexity, requires careful cache key management

#### A.4 LRU Source Cache
- Add in-memory LRU cache to `sourceCache.ts`
- **Concern:** Memory management, cache invalidation strategy

**Recommendation:** Revisit caching after measuring actual performance gains from Phases 0-4. The database and bundle optimizations may provide sufficient improvement.
