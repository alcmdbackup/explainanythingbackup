# Analyze Site Performance Research

**Date**: 2026-01-17T08:47:43-0800
**Git Commit**: c4933b1275931620cc4ddb0a2ab1cc2ef7289d60
**Branch**: feat/analyze_site_performance_20260117
**Repository**: explainanything

## Problem Statement
Document the current site performance infrastructure across all layers of the ExplainAnything platform to enable informed optimization decisions. This includes page load performance, AI pipeline latency, database queries, frontend rendering, observability, and caching strategies.

## High Level Summary

ExplainAnything is a 60k+ LOC TypeScript codebase using Next.js 15.2.8, React 19, Supabase, Pinecone, and OpenAI. The platform has comprehensive observability infrastructure (Sentry + Honeycomb/OTLP) but limited application-level caching. Key performance characteristics:

1. **Page Load**: Hybrid SSR/CSR with most interactive pages client-rendered. Turbopack in development, Sentry monitoring in production. 4 Google Fonts with `display: swap`.

2. **AI Pipeline**: GPT-4o-mini default model with 60s timeout, 3 retries. Vector search via Pinecone with `text-embedding-3-large`. Streaming via SSE with 100ms debounced UI updates.

3. **Database**: Supabase with RLS. Stored procedures for atomic metric updates. Client-side aggregation for view counts. No application-level connection pooling.

4. **Frontend**: useReducer state machines, useCallback memoization, hydration guards. Lexical editor with debounced streaming sync.

5. **Observability**: Sentry (20% trace sampling in prod), Honeycomb via OTLP, request ID propagation via AsyncLocalStorage, `withLogging`/`withTracing` wrappers.

6. **Caching**: Database-backed source cache with expiry. localStorage for preferences. No CDN configuration. API routes explicitly set `no-cache`.

---

## Detailed Findings

### 1. Page Load Performance

#### SSR/SSG Patterns
| Rendering Type | Pages | Pattern |
|----------------|-------|---------|
| **Force-dynamic SSR** | `/explanations` | `export const dynamic = 'force-dynamic'` |
| **Server Component Auth** | `/admin/layout.tsx` | `isUserAdmin()` check before render |
| **Client-rendered (CSR)** | `/`, `/results`, `/login`, `/userlibrary`, `/settings`, `/admin/*` | `'use client'` directive |

#### Bundle Configuration
- **Turbopack** in development (`next dev --turbopack`)
- **Sentry webpack** wraps config in production with:
  - `widenClientFileUpload: true` - Full source map coverage
  - `hideSourceMaps: true` - Removes maps from client bundle
  - `tunnelRoute: /api/monitoring` - Bypasses ad-blockers
  - `disableLogger: false` - Enables Sentry.logger

#### Font Loading
Four Google Fonts configured in `src/app/layout.tsx:10-36`:
- Playfair Display (display font)
- Source Serif 4 (body font)
- DM Sans (UI font)
- JetBrains Mono (monospace)

All use `display: "swap"` strategy for optimal CLS.

#### Code Splitting
- `src/app/settings/page.tsx:8-35` - Dynamic import with `ssr: false` for SettingsContent
- `src/app/admin/whitelist/page.tsx:8-16` - WhitelistContent and CandidatesContent with `ssr: false`

#### No next/image Usage
The codebase does NOT use `next/image`. Images are inline SVGs only. No automatic optimization or lazy loading.

---

### 2. AI Pipeline Latency

#### LLM Configuration (`src/lib/services/llms.ts`)
| Setting | Value | Location |
|---------|-------|----------|
| Default Model | `gpt-4o-mini` | Line 22 |
| Lighter Model | `gpt-4o-mini` | Line 23 |
| Max Retries | 3 | Line 99 |
| Timeout | 60,000ms | Line 100 |

#### Streaming Implementation (Lines 181-198)
```typescript
for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    accumulatedContent += content;
    setText!(displayContent); // Real-time callback
}
```

#### Vector Search (`src/lib/services/vectorsim.ts`)
| Setting | Value | Location |
|---------|-------|----------|
| Embedding Model | `text-embedding-3-large` | Line 121 |
| Embedding Dimensions | 3072 | Line 567 |
| Upsert Batch Size | 100 vectors | Line 211 |
| Max Concurrent Batches | 3 | Line 212 |
| Deletion Batch Size | 1000 | Line 725 |

#### Explanation Pipeline Stages (`src/lib/services/returnExplanation.ts:431-750`)
1. **Title Generation** (lines 470-513) - GPT-4o-mini
2. **Parallel Vector Searches** (lines 514-537):
   - Similarity search
   - Anchor search
   - Diversity comparison
3. **Score Calculation & Validation** (lines 539-563)
4. **Match Enhancement** (lines 565-569) - Test content filtering
5. **Match vs. Generation Decision** (lines 571-587)
6. **New Explanation Generation** (lines 598-688) - Streaming
7. **Content Enhancement** (lines 653-701):
   - Save heading links
   - Apply tags
   - Save link candidates
   - Generate AI summary (fire-and-forget)
8. **User Query Tracking** (lines 704-714)

#### Postprocessing Parallelization (lines 147-203)
```typescript
const [headingTitles, tagEvaluation, linkCandidates] = await Promise.all([
    generateHeadingStandaloneTitles(...),
    evaluateTags(...),
    extractLinkCandidates(...)
]);
```

---

### 3. Database Performance

#### Supabase Client Setup (`src/lib/utils/supabase/`)
| Client | File | Purpose |
|--------|------|---------|
| Browser | `client.ts` | Session persistence via localStorage/sessionStorage |
| Server | `server.ts` | Cookie-based sessions |
| Service Role | `server.ts:40-51` | Bypasses RLS |
| Middleware | `middleware.ts` | Session sync per request |

**No explicit connection pooling** - relies on Supabase defaults (likely PgBouncer).

#### Query Patterns
- **`.limit(1)` instead of `.single()`** - Handles replication lag gracefully (`explanations.ts:82-88`)
- **Range queries**: `.order().range(offset, offset + limit - 1)`
- **Pattern matching**: `.ilike('tag_name', '%${searchTerm}%')`
- **Batch operations**: `.in('explanationid', explanationIds)`
- **Service role bypass**: `createSupabaseServiceClient()` for metrics

#### Stored Procedures (migration `20251109053825_fix_drift.sql`)
| Function | Lines | Purpose |
|----------|-------|---------|
| `increment_explanation_views()` | 329-354 | Atomic view increment + save_rate recalc |
| `increment_explanation_saves()` | 302-327 | Atomic save increment + save_rate recalc |
| `refresh_explanation_metrics()` | 391-439 | Batch recalculate from source tables |
| `refresh_all_explanation_metrics()` | 356-389 | Full refresh all explanations |

#### Key Indexes
- `idx_explanation_tags_explanation_isdeleted` - Compound for soft deletes
- `idx_explanations_status` - Published/draft filtering
- `idx_source_cache_url_hash` - SHA256 URL deduplication
- `idx_source_cache_expires` - Cache expiry queries

#### RLS Policies
- Public SELECT on `explanationMetrics`, `explanation_tags`, `tags`, `source_cache`
- User-isolated policies: `(SELECT auth.uid()) = userid` on userLibrary, userQueries, userExplanationEvents

---

### 4. Frontend Performance

#### React Patterns
| Pattern | Usage | Example Location |
|---------|-------|------------------|
| `useCallback` | Event handlers, async operations | `useExplanationLoader.ts:136-348` |
| `useMemo` | Derived state | `results/page.tsx:79-90` (bibliography) |
| `useReducer` | Complex state machines | `pageLifecycleReducer.ts`, `tagModeReducer.ts` |
| `forwardRef` | Editor imperative API | `LexicalEditor.tsx:262-277` |
| `useImperativeHandle` | Expose editor methods | `LexicalEditor.tsx:330-530` |

**No React.memo usage found** - relies on reducers and callback memoization.

#### Hydration Guards
`ThemeContext.tsx` and `PanelVariantContext.tsx` use mounted/isHydrated flags:
```typescript
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);
if (!mounted) return <>{children}</>;
```

#### Streaming Debounce (`StreamingSyncPlugin.tsx`)
- **During streaming**: 100ms debounce
- **After streaming**: Immediate updates
- **Deduplication**: Skips if content unchanged

#### Deferred Initialization (`ClientInitializer.tsx`)
```typescript
if ('requestIdleCallback' in window) {
    window.requestIdleCallback(async () => {
        const { initBrowserTracing } = await import('@/lib/tracing/browserTracing');
        initBrowserTracing();
    }, { timeout: 5000 });
}
```
Browser tracing (~60KB) deferred to idle time.

---

### 5. Observability Setup

#### Sentry Configuration
| Config | Client | Server | Edge |
|--------|--------|--------|------|
| DSN | `NEXT_PUBLIC_SENTRY_DSN` | `SENTRY_DSN` | `SENTRY_DSN` |
| Logs | `enableLogs: true` | `enableLogs: true` | `enableLogs: true` |
| Traces (prod) | 20% | 20% | N/A |
| Traces (dev) | 100% | 100% | N/A |
| Replay | 10% sessions, 100% errors | N/A | N/A |

Tunnel: `/api/monitoring` bypasses ad-blockers.

#### Honeycomb/OTLP (`instrumentation.ts` + `otelLogger.ts`)
Custom tracers:
- `llmTracer` - LLM/AI calls
- `dbTracer` - Database operations
- `vectorTracer` - Pinecone operations
- `appTracer` - Application operations

Log levels in production: ERROR/WARN only (unless `OTEL_SEND_ALL_LOG_LEVELS=true`)

#### Request ID Propagation
- **Server**: `AsyncLocalStorage` from Node.js
- **Client**: Module-level variable
- **API**: `RequestIdContext.run(data, callback)`

All logs auto-tagged with requestId, userId, sessionId.

#### Logging Wrappers (`automaticServerLoggingBase.ts`)
| Wrapper | Purpose |
|---------|---------|
| `withServerLogging()` | Entry/exit/duration/error logging |
| `withServerTracing()` | OpenTelemetry span creation |
| `withServerLoggingAndTracing()` | Combined |

Client equivalent: `withClientLogging()` in `clientLogging.ts`

---

### 6. Caching Strategies

#### Database-Backed Source Cache (`sourceCache.ts`)
- Table: `source_cache` with `expires_at` column
- Pattern: Cache-aside (check DB → fetch if miss/expired → store)
- Summarization: Long content auto-summarized before caching
- Junction: `article_sources` links sources to explanations (positions 1-5)

#### Client-Side Caching
| Key | Storage | Purpose |
|-----|---------|---------|
| `theme-palette` | localStorage | Theme preference |
| `theme-mode` | localStorage | Light/dark mode |
| `ai-panel-variant` | localStorage | Panel layout |
| `explanation-mode` | localStorage | Match mode preference |
| `pendingSources` | sessionStorage | Transient source transfer |

#### API Route Cache Headers
| Endpoint | Cache-Control |
|----------|---------------|
| `/api/health` | `no-store, max-age=0` |
| `/api/stream-chat` | `no-cache` |
| `/api/returnExplanation` | `no-cache` |
| Others | None set (default) |

#### Auth State Invalidation
`revalidatePath('/', 'layout')` called on login/signup/signout (`login/actions.ts:69,133,167`)

#### No CDN Configuration
- No `vercel.json` with edge caching
- No `headers()` export in next.config
- Relies on default Vercel platform behavior

---

### 7. Metrics & Analytics

#### Event Tracking
- Table: `userExplanationEvents`
- Events: `explanation_viewed`, `explanation_saved`
- Metadata: `{"duration_seconds": 30, "source": "search"}`

#### Aggregate Metrics
- Table: `explanationMetrics`
- Fields: `total_views`, `total_saves`, `save_rate` (saves/views)
- Updated via stored procedures for atomicity

#### LLM Cost Tracking
- Table: `llmCallTracking` with `estimated_cost_usd`
- View: `daily_llm_costs` for aggregation
- Admin dashboard: `/admin/costs` with charts

---

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md
- docs/feature_deep_dives/request_tracing_observability.md

## Code Files Read
- next.config.ts
- src/app/layout.tsx
- src/app/results/page.tsx
- src/app/explanations/page.tsx
- src/app/admin/layout.tsx
- src/app/settings/page.tsx
- src/app/login/actions.ts
- src/lib/services/llms.ts
- src/lib/services/vectorsim.ts
- src/lib/services/returnExplanation.ts
- src/lib/services/tagEvaluation.ts
- src/lib/services/explanationSummarizer.ts
- src/lib/services/metrics.ts
- src/lib/services/sourceCache.ts
- src/lib/services/costAnalytics.ts
- src/lib/utils/supabase/client.ts
- src/lib/utils/supabase/server.ts
- src/lib/utils/supabase/middleware.ts
- src/lib/requestIdContext.ts
- src/lib/serverReadRequestId.ts
- src/lib/logging/server/automaticServerLoggingBase.ts
- src/lib/logging/server/otelLogger.ts
- src/lib/logging/client/consoleInterceptor.ts
- src/lib/logging/client/remoteFlusher.ts
- src/lib/tracing/browserTracing.ts
- src/contexts/ThemeContext.tsx
- src/contexts/PanelVariantContext.tsx
- src/hooks/useExplanationLoader.ts
- src/hooks/useStreamingEditor.ts
- src/reducers/pageLifecycleReducer.ts
- src/reducers/tagModeReducer.ts
- src/editorFiles/lexicalEditor/LexicalEditor.tsx
- src/editorFiles/lexicalEditor/StreamingSyncPlugin.tsx
- src/components/ClientInitializer.tsx
- instrumentation.ts
- sentry.client.config.ts
- sentry.server.config.ts
- sentry.edge.config.ts
- supabase/migrations/20251109053825_fix_drift.sql
- supabase/migrations/20260104102443_fix_rls_critical_issues.sql
- supabase/migrations/20260110160113_repair_source_tables.sql
- supabase/migrations/20260116061036_add_llm_cost_tracking.sql

---

## Extended Research Findings (Round 2)

### 8. Bundle Size Analysis

#### Total Bundle Metrics
| Metric | Value |
|--------|-------|
| node_modules | 884MB |
| Build output (.next/) | 1.2GB |
| Client chunks | 2.9MB |
| Source files | 366 TypeScript/TSX files (~4.3MB) |
| Client components | 73 files (20% of codebase) |

#### Major Dependencies by Size Impact
| Package | node_modules Size | Bundle Impact | Notes |
|---------|-------------------|---------------|-------|
| next | 126MB | Build-time only | Framework |
| @sentry/nextjs | 72.5MB | ~2-3MB client wrapper | Error tracking |
| @opentelemetry/* | 45MB | ~60KB gzipped (lazy-loaded) | Browser tracing |
| lucide-react | 43MB | ~15-30KB (tree-shakeable) | Icons |
| openai | 9.6MB | Server-side only | LLM API |
| react-dom | 7.1MB | Production dependency | Core |
| langchain | 6.6MB | Server-side only | RAG |
| @supabase | 6.5MB | Server + client | Auth/DB |
| @lexical/* | 5.1MB | Editor core | 23 files in editorFiles/ |
| katex | 4.3MB | LaTeX rendering | Math display |

#### Dynamic Import Code Splitting
Only **3 explicit `dynamic()` imports**:
1. `src/app/settings/page.tsx` - SettingsContent (ssr: false)
2. `src/app/admin/whitelist/page.tsx` - WhitelistContent (ssr: false)
3. `src/app/admin/whitelist/page.tsx` - CandidatesContent (ssr: false)

**Lazy `import()` patterns**:
- `ClientInitializer.tsx` - consoleInterceptor, remoteFlusher, browserTracing
- `browserTracing.ts` - 4 OpenTelemetry modules via `Promise.all()`
- Uses `requestIdleCallback` with 5s timeout fallback

#### Client Component Distribution
- Components: 57 files
- Pages: 12 files
- Contexts/Hooks: 4 files
- Editor: Multiple (LexicalEditor, plugins)

---

### 9. Streaming Architecture Details

#### SSE Message Types (`/api/returnExplanation`)
| Event Type | Payload | Client Handling |
|------------|---------|-----------------|
| `streaming_start` | `{type, isStreaming}` | Dispatch START_STREAMING |
| `progress` | `{type, stage, title}` | Dispatch STREAM_TITLE if title_generated |
| `content` | `{type, content, isStreaming, isComplete}` | Dispatch STREAM_CONTENT |
| `streaming_end` | `{type, isStreaming}` | Informational only |
| `complete` | `{type, result, sources[], isComplete}` | Store result, extract sources |
| `error` | `{type, error, isComplete}` | Dispatch ERROR, reset state |

#### Stream Construction Pattern
```typescript
const encoder = new TextEncoder();
const stream = new ReadableStream({
  async start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
    controller.close();
  }
});
return new Response(stream, {
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' }
});
```

#### Streaming Constraints
- **No backpressure handling** - relies on browser/TCP buffering
- **Single-shot streams** - no reconnection/resume capability
- **text/plain MIME** - not standard text/event-stream
- **Manual line parsing** - client parses `data: ` prefix manually
- **No timeout handling** - stream may hang indefinitely if server disconnects

---

### 10. Database Query Pattern Analysis

#### Query Aggregation Approach
- **Sequential queries** - Most common pattern, not batched
- **Client-side aggregation** - JavaScript Map for view count grouping
- **No PostgREST JOINs** - All multi-table via separate queries + client-side joining

#### Example: `getRecentExplanations` (3 sequential operations)
1. Query `userExplanationEvents` for view counts
2. Query all published `explanations`
3. Client-side aggregation and sorting in JavaScript

#### Pagination Pattern
All use offset-limit: `.range(offset, offset + limit - 1)`
- Validated bounds: `if (limit <= 0) limit = 10; if (offset < 0) offset = 0;`
- Exact counts via `{ count: 'exact' }` in admin queries

#### No Realtime Subscriptions
- No `.on()`, `channel()`, or `realtime()` usage detected
- All data retrieval is request-response based

#### RPC Stored Procedures
| Function | Usage Location |
|----------|----------------|
| `refresh_all_explanation_metrics()` | metrics.ts:129-130 |
| `refresh_explanation_metrics(ids)` | metrics.ts:151-152 |
| `increment_explanation_views(id)` | metrics.ts:230-231 |
| `increment_explanation_saves(id)` | metrics.ts:273-274 |

---

### 11. Error Handling & Resilience

#### Error Codes (`errorHandling.ts:7-26`)
- `INVALID_INPUT`, `INVALID_RESPONSE`, `INVALID_USER_QUERY`
- `LLM_API_ERROR`, `TIMEOUT_ERROR`, `UNKNOWN_ERROR`
- `DATABASE_ERROR`, `EMBEDDING_ERROR`, `VALIDATION_ERROR`
- `SAVE_FAILED`, `QUERY_NOT_ALLOWED`, `NOT_FOUND`
- `SOURCE_FETCH_TIMEOUT`, `SOURCE_FETCH_FAILED`, `SOURCE_CONTENT_EMPTY`, `SOURCE_PAYWALL_DETECTED`

#### Timeout Configuration
| Operation | Timeout | Location |
|-----------|---------|----------|
| Source fetch | 10s | sourceFetcher.ts:11 |
| OpenAI API | 60s | llms.ts:100 |
| Streaming debounce | 100ms | useStreamingEditor.ts:73 |
| Browser tracing init | 5s fallback | ClientInitializer.tsx |
| E2E server poll | 30s local, 60s CI | global-setup.ts:51 |

#### Retry Configuration
| Operation | Retries | Strategy |
|-----------|---------|----------|
| OpenAI SDK | 3 | Built-in exponential backoff |
| E2E auth | 3-5 | Exponential backoff |
| Source cache | 0 | Failed status cached for 7 days |

#### React Error Boundaries
- `src/app/error.tsx` - Page-level boundary with Sentry reporting
- `src/app/global-error.tsx` - Root layout boundary (fatal level)

#### Graceful Degradation Patterns
- **Fire-and-forget log flushing** - `requestIdleCallback()` + `sendBeacon()` on unload
- **Progress events optional** - Parsing failures treated as regular content
- **Source cache failures** - Stores "Failed" status in DB for 7-day expiry
- **Editor locked during streaming** - Prevents user edits conflicting with content

#### No Circuit Breaker Pattern
- Relies on OpenAI SDK's built-in retries
- Failed fetches cached to prevent hammering
- No shared state-based failure tracking

---

### 12. Performance Configuration Summary

| Setting | Value | File |
|---------|-------|------|
| **LLM Model** | gpt-4o-mini | llms.ts:22 |
| **LLM Timeout** | 60s | llms.ts:100 |
| **LLM Retries** | 3 | llms.ts:99 |
| **Embedding Model** | text-embedding-3-large | vectorsim.ts:121 |
| **Embedding Dims** | 3072 | vectorsim.ts:567 |
| **Vector Batch Size** | 100 | vectorsim.ts:211 |
| **Max Concurrent Batches** | 3 | vectorsim.ts:212 |
| **Source Fetch Timeout** | 10s | sourceFetcher.ts:11 |
| **Source Cache Expiry** | 7 days | sourceFetcher.ts:13 |
| **Log Flush Interval** | 30s | remoteFlusher.ts:24 |
| **Log Batch Size** | 50 | remoteFlusher.ts:25 |
| **Streaming Debounce** | 100ms | StreamingSyncPlugin.tsx |
| **Sentry Trace Sample (prod)** | 20% | sentry.*.config.ts |
| **Sentry Replay (sessions)** | 10% | sentry.client.config.ts:40 |
| **Sentry Replay (errors)** | 100% | sentry.client.config.ts:43 |
| **OTel Log Levels (prod)** | ERROR/WARN only | otelLogger.ts:42 |

---

## Additional Code Files Read (Round 2)
- package.json
- src/lib/errorHandling.ts
- src/lib/errors/serviceError.ts
- src/app/error.tsx
- src/app/global-error.tsx
- src/app/api/returnExplanation/route.ts
- src/app/api/stream-chat/route.ts
- src/lib/services/sourceFetcher.ts
- src/lib/services/userLibrary.ts
- src/lib/services/userQueries.ts
- src/lib/services/topics.ts
- src/lib/services/adminContent.ts
- src/lib/services/auditLog.ts
- src/lib/services/explanationTags.ts
- src/lib/services/contentReports.ts
- src/__tests__/e2e/setup/vercel-bypass.ts
- src/__tests__/e2e/fixtures/auth.ts
- src/__tests__/e2e/setup/global-setup.ts

---

## Extended Research Findings (Round 3)

### 13. Image & Asset Handling

#### Image Optimization Status
- **next/image NOT used** - No usage of Next.js Image component anywhere
- All images are inline SVGs or CSS-generated backgrounds
- No `<img>` tags with external images found in components

#### Static Assets in /public
| File | Size | Notes |
|------|------|-------|
| vercel.svg | 128 B | Well-optimized |
| file.svg | 391 B | Minimal |
| window.svg | 385 B | Minimal |
| globe.svg | 1,035 B | Could optimize |
| next.svg | 1,375 B | Could optimize |
| example.dot | 2,387 B | Non-image |
| **Total** | **3.3 KB** | Very lightweight |

#### Icon Libraries
- **Heroicons** (`@heroicons/react ^2.2.0`) - Primary icon system
- **Lucide React** (`lucide-react ^0.553.0`) - Secondary icon system
- Both tree-shakeable, imported as React components

#### Background Images
- Paper texture: Inline SVG as data URI in CSS (`globals.css:1005-1020`)
- Gold gradients: CSS `linear-gradient()` functions
- No external image files for backgrounds

#### Lazy Loading Status
- **No `loading="lazy"` attributes** found
- **No `<picture>` elements** for responsive images
- **No `srcSet` attributes** configured
- Middleware properly bypasses `_next/image` route (unused)

---

### 14. CSS & Styling Performance

#### CSS Strategy
- **Tailwind CSS 4.0.15** with PostCSS plugin
- No CSS-in-JS libraries (zero runtime overhead)
- 890 instances of CSS custom properties (`var(`) in globals.css
- 4 complete themes (Midnight Scholar, Venetian Archive, Oxford Blue, Sepia Chronicle)

#### CSS Bundle Size
| File | Size |
|------|------|
| Primary CSS | 152 KB |
| Secondary CSS | 16 KB |
| Tertiary CSS | 25 KB |
| **Total** | **~194 KB** |

Source: `globals.css` = 2,685 lines, 68 KB uncompressed

#### Font Loading
```typescript
// layout.tsx - All fonts use display: "swap" (best practice)
Playfair_Display({ display: "swap", weight: ["400", "500", "600", "700"] })
Source_Serif_4({ display: "swap", weight: ["400", "500", "600"] })
DM_Sans({ display: "swap", weight: ["400", "500", "600"] })
JetBrains_Mono({ display: "swap", weight: ["400", "500"] })
```
- 4 fonts, 12 weight files total (~150-200 KB estimated)
- Latin subset only (reduces size)
- No font preloading directives found

#### Animation Performance
- **30 @keyframes** defined in globals.css
- **Expensive patterns found:**
  - `filter: blur(8px)` - textRevealBlur animation
  - `clip-path: inset()` - textRevealInk animation
  - `box-shadow` animation - warmGlowPulse
- **Good patterns:**
  - Transform-only animations (GPU accelerated)
  - 8 `prefers-reduced-motion` media queries (accessibility)

#### Critical CSS
- **Not implemented** - All CSS via external stylesheets
- Large 152 KB CSS file blocks initial paint

---

### 15. API Response Efficiency

#### Over-Fetching Issues

| Location | Problem | Impact |
|----------|---------|--------|
| `returnExplanation/route.ts:150` | Full `SourceCacheFullType` fetched, only 6 fields used | 25-500KB extra per request |
| `explanations.ts:58-67` | `.select()` without field specification | 500KB+ for 10 explanations |
| `adminContent.ts:56-57` | `content` field in list queries | 2-3MB for 50 items |
| `tags.ts:327` | All tag fields fetched when only id/name needed | 2-5KB × 100+ tags |
| `vectorsim.ts:278` | `includeValues: true` returns 3072-dim embeddings | 61KB per search |

#### N+1 Query Pattern
`getRecentExplanationsImpl()` with `sort: 'top'`:
1. Query `userExplanationEvents` for all view events
2. Query `explanations` for all published
3. Client-side Map aggregation

**Better:** Database-side `GROUP BY` with `LEFT JOIN`

#### Good Practices Found
- Streaming SSE responses (no full payload in memory)
- Server-side test content filtering
- Source cache with 7-day expiry

---

### 16. Build & Webpack Configuration

#### Current Configuration
- **Turbopack** in development (`--turbopack` flag)
- **Sentry webpack** wraps production config
- **No bundle analyzer** configured
- **No `sideEffects`** in package.json (impacts tree-shaking)
- **Empty `swcPlugins`** array (unused optimization slot)

#### TypeScript Configuration
```json
{
  "target": "ES2017",
  "module": "esnext",
  "moduleResolution": "bundler",
  "strict": true,
  "incremental": true
}
```
Single clean path alias: `@/*` → `./src/*`

#### Environment Variables
- ✅ Properly separated public (`NEXT_PUBLIC_*`) vs server-only
- ✅ No sensitive data exposed to client
- Server-only: `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `PINECONE_API_KEY`

#### Code Splitting Status
Only **3 dynamic imports** found:
1. `src/app/settings/page.tsx` - SettingsContent
2. `src/app/admin/whitelist/page.tsx` - WhitelistContent
3. `src/app/admin/whitelist/page.tsx` - CandidatesContent

**Opportunity:** Many more routes could benefit from code splitting

#### Source Maps
- `hideSourceMaps: true` - Hidden from public bundles
- Uploaded to Sentry for debugging
- Production approach is secure

---

## New Optimization Opportunities (Round 3)

### High Priority
1. **Add `sideEffects: false`** to package.json for tree-shaking
2. **Strip `extracted_text`** from source responses (100-500KB savings)
3. **Remove `content` field** from admin list queries (2-3MB savings)
4. **Select only needed fields** in all `.select()` calls
5. **Inline critical CSS** for above-the-fold content

### Medium Priority
6. **Database GROUP BY** instead of client-side view aggregation
7. **Make `includeValues`** conditional in vector search
8. **Add bundle analyzer** for visibility
9. **Expand dynamic imports** to more route components
10. **Replace blur animations** with transform-only alternatives

### Low Priority
11. **Add font preloading** directives
12. **Code-split themes** instead of loading all 4
13. **Minify SVG assets** (globe.svg, next.svg)

---

## Code Files Read (Round 3)
- public/* (6 static assets)
- src/components/ui/spinner.tsx
- src/components/Navigation.tsx
- src/app/globals.css
- tailwind.config.ts
- postcss.config.mjs
- .next/static/css/* (build output)
- src/lib/services/vectorsim.ts (lines 271-280)
- tsconfig.json
- .env.example
- sentry.server.config.ts
- sentry.client.config.ts
- .github/workflows/ci.yml
- jest.config.js
