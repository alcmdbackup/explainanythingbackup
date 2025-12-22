# Automated Logging & Evaluation Research

## Overview

This document catalogs all files and plans related to logging and automated logging in the codebase.

---

## Planning Documents

### Client-Side Automated Logging (DEPRECATED - moved to docs/deprecated/)

#### Approach 1: Runtime Hybrid Discovery
**File:** `docs/deprecated/automated_client_logging_approach_1.md`

- **Strategy:** Dual-method function discovery (React DevTools Hook + Stack trace analysis)
- **Coverage:** 85% DevTools Hook, 15% Stack trace
- **Key Features:**
  - Multi-layer infinite recursion prevention
  - Emergency management with circuit breakers
  - Data sanitization with circular reference protection
  - FunctionDiscoveryEngine for unified wrapping
  - Mandatory production safety checklist (6+ layers)

#### Approach 2: Build-Time AST Transform
**File:** `docs/deprecated/automated_client_logging_approach_2.md`

- **Strategy:** SWC/Babel AST transforms at compile time
- **Key Features:**
  - 9-layer validation before instrumentation
  - 15+ PII pattern detection
  - EmergencyManager with automatic shutdown
  - Zero production performance impact
  - Function identity preserved (no wrapper reassignments)
  - TELEMETRY_SYSTEM_APIS exclusion list

---

### Server-Side Automated Logging (DEPRECATED - moved to docs/deprecated/)

**File:** `docs/deprecated/automatic_server_logging.md`

- **Architecture:** Three-phase implementation (NOT IMPLEMENTED - interceptors deleted)
  - Phase 1: Module interception (70% coverage)
  - Phase 2: Runtime callback wrapping (20% coverage)
  - Phase 3: Universal interception (10% coverage)
- **Total Coverage:** ~78%
- **Integration:** All logging flows through existing `withLogging` function
- **Infrastructure Files (DELETED):**
  - ~~`autoServerLoggingModuleInterceptor.ts`~~ - deleted
  - ~~`autoServerLoggingRuntimeWrapper.ts`~~ - deleted
  - ~~`autoServerLoggingUniversalInterceptor.ts`~~ - deleted
  - `automaticServerLoggingBase.ts` - **RETAINED** (contains `withLogging` wrapper)

---

### Request ID Correlation

**File:** `docs/backend_explorations/request_id.md`

- AsyncLocalStorage for server-side context
- Module variables for client-side tracking
- Automatic request ID injection in all logs
- Maps button clicks to server operations
- Zero changes to existing 100+ functions

---

### Claude Code Auto-Wrapping Hook

**File:** `docs/backend_explorations/hooks_to_add_withLogging.md`

- PostToolUse hook for automatic `withLogging` wrapping
- Pattern-based function detection (AST + regex)
- Two wrapping patterns (direct and with `serverReadRequestId`)
- Server file filtering

---

## Implementation Files

### Server-Side Logging Infrastructure

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/logging/server/automaticServerLoggingBase.ts` | Core `withLogging` wrapper function | **Active** |
| ~~`src/lib/logging/server/autoServerLoggingModuleInterceptor.ts`~~ | Phase 1 - Module-level automatic wrapping | Deleted |
| ~~`src/lib/logging/server/autoServerLoggingRuntimeWrapper.ts`~~ | Phase 2 - Runtime callback interception | Deleted |
| ~~`src/lib/logging/server/autoServerLoggingUniversalInterceptor.ts`~~ | Phase 3 - Universal function interception | Deleted |

### Testing Infrastructure

| File | Purpose |
|------|---------|
| `src/testing/utils/logging-test-helpers.ts` | Mock factories, test utilities, log capture |
| `src/__tests__/integration/logging-infrastructure.integration.test.ts` | Entry/exit logging, performance, error handling tests |
| `src/__tests__/integration/request-id-propagation.integration.test.ts` | Request ID context tests |

### Client-Side Files

| File | Purpose |
|------|---------|
| `src/app/(debug)/test-client-logging/page.tsx` | Debug page for client logging |
| `src/app/api/client-logs/route.ts` | API route to collect client logs |
| `src/app/api/client-logs/route.test.ts` | Client logs API tests |

### Core Utilities

| File | Purpose |
|------|---------|
| `src/lib/server_utilities.ts` | Server-side logger implementation |
| `src/lib/client_utilities.ts` | Client-side logger implementation |
| `src/lib/schemas/schemas.ts` | LogConfig and TracingConfig types |

---

## Evaluation Framework Documents

### Evals Priority Order
**File:** `docs/backend_explorations/evals.md`

1. Title Generation
2. Vector Search and Matching
3. Tag Evaluation System
4. AI Suggestions Pipeline (Steps 1-2)
5. Explanation Generation
6. Stream Chat API
7. AI Suggestions Pipeline (Steps 3-4)
8. Link Enhancement System

### Scoring System
**File:** `docs/backend_explorations/scoring_system.md`

- Formula: `S_v = own_score_v + (inheritance_rate * similarity_factor * S_parent)`
- Shingle-based similarity (5-8 word shingles)
- Guardrails: rich-get-richer prevention, fork-bomb protection, stale ancestor detection

### Related Scoring Files
- `docs/backend_explorations/scoring_system_weighting.md`
- `docs/backend_explorations/scoring_system_weighting_v2.md`
- `docs/backend_explorations/scoring_system_weighting_v2_implementation.md`
- `docs/backend_explorations/shingles_nearest_neighbors_scoring.md`

### Aggregate Metrics
**File:** `docs/planning/aggregate_metrics/aggregate_metrics.md`

- Metrics: Total saves, views, save rate, last updated
- Database: `explanationMetrics` table with stored procedures
- API: `getExplanationMetrics()`, `incrementExplanationViews()`, etc.

---

## Safety Mechanisms Summary

All automated logging approaches implement:

1. **Recursion Prevention**
   - Operation-specific re-entrance guards
   - MAX_RECURSION_DEPTH = 3
   - Circuit breaker emergency shutdown

2. **API Exclusions**
   - Comprehensive TELEMETRY_SYSTEM_APIS list
   - User code directory whitelist
   - System code blacklist

3. **Data Protection**
   - Sensitive field redaction (passwords, tokens, API keys)
   - String truncation (500 char limit)
   - Array limiting (10 items max)
   - Object property limiting (20 properties max)
   - Circular reference detection via WeakSet

4. **Production Safety**
   - Mandatory pre-deployment checklists
   - Emergency shutdown mechanisms
   - Build-time validation

---

## Manual Logging Approaches

### Core Logger Utilities

#### Server-Side Logger
**File:** `src/lib/server_utilities.ts`

Custom logger wrapping console methods:
- `logger.debug()` - wrapped console.log
- `logger.info()` - wrapped console.log
- `logger.warn()` - wrapped console.warn
- `logger.error()` - wrapped console.error

**Features:**
- Request ID and user ID context injection via `RequestIdContext`
- JSON format written to `server.log` file
- Each entry includes: timestamp, level, message, data, request metadata

#### Client-Side Logger
**File:** `src/lib/client_utilities.ts`

- Same interface as server logger
- Console-only output (no file)
- RequestID injection from `RequestIdContext`

### Log Configuration

**File:** `src/lib/schemas/schemas.ts`

```typescript
interface LogConfig {
  enabled: boolean;
  logInputs: boolean;
  logOutputs: boolean;
  logErrors: boolean;
  maxInputLength: 1000;
  maxOutputLength: 1000;
  sensitiveFields: ['password', 'apiKey', 'token', 'secret', 'pass'];
}

interface TracingConfig {
  enabled: boolean;
  tracerName: 'app' | 'llm' | 'db' | 'vector';
  includeInputs: boolean;
  includeOutputs: boolean;
  customAttributes: {};
}
```

### Request Context Propagation

**File:** `src/lib/requestIdContext.ts`

- **Server:** AsyncLocalStorage from `async_hooks`
- **Client:** Module-level variable
- **API:**
  - `RequestIdContext.run()` - Sets context for callback
  - `RequestIdContext.get()` - Retrieves full context
  - `RequestIdContext.getRequestId()` - Gets request ID
  - `RequestIdContext.getUserId()` - Gets user ID
- **Defaults:** `requestId: 'unknown'`, `userId: 'anonymous'`

### Direct Console Usage Patterns

#### High-Volume Debug Logging (Emoji Prefixes)

| File | Pattern |
|------|---------|
| `src/hooks/useStreamingEditor.ts` | Streaming and editor state tracking |
| `src/editorFiles/aiSuggestion.ts` | AI pipeline steps (🚀📦🤖✏️🔄🔧✅) |
| `src/app/results/page.tsx` | SSE data, tag ops, editor state |

#### Error Handling

| File | Usage |
|------|-------|
| `src/components/TagBar.tsx` | `console.error` for tag failures |
| `src/hooks/useUserAuth.ts` | `console.error`, `console.warn` for auth |
| `src/hooks/useTextRevealSettings.ts` | `console.warn` for localStorage failures |
| `src/app/api/returnExplanation/route.ts` | `console.error` for streaming errors |
| `src/app/api/client-logs/route.ts` | `console.error` for write failures |
| `src/reducers/pageLifecycleReducer.ts` | `console.warn` for invalid state transitions |

#### E2E/Debug Utilities

| File | Prefix Pattern |
|------|----------------|
| `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts` | `[E2E-DEBUG]`, `[BROWSER]` |
| `src/__tests__/e2e/helpers/api-mocks.ts` | `[MOCK-DEBUG]` |
| `src/__tests__/e2e/setup/global-setup.ts` | Setup phase logging |
| `src/app/(debug)/test-client-logging/page.tsx` | Manual console test page |

### Log File Locations

| File | Purpose |
|------|---------|
| `server.log` | Server-side logs (JSON lines, appendFileSync) |
| `client.log` | Client-side logs via API endpoint |

### Client Logs API Endpoint

**File:** `src/app/api/client-logs/route.ts`

- POST endpoint accepting client logs
- Writes to `client.log` file
- **Development only** - returns 403 in production
- Adds `source: 'client'` tag

### Function Wrapper Utilities

**File:** `src/lib/logging/server/automaticServerLoggingBase.ts`

| Function | Purpose |
|----------|---------|
| `withLogging<T>()` | Wraps functions with entry/exit logging |
| `withTracing<T>()` | Wraps with OpenTelemetry spans |
| `withLoggingAndTracing<T>()` | Combines both |
| `logMethod()` | Decorator for class methods |
| `createLoggedFunction()` | Creates logged version of function |
| `withBatchLogging<T>()` | Batch logging for multiple functions |
| `sanitizeData()` | Redacts sensitive fields, truncates values |

### Framework Exclusion Patterns

`shouldSkipAutoLogging()` skips:
- React/React-DOM internals (`.cjs`, `.dist`, `react-jsx-runtime`)
- Next.js internals (`next/dist`, `turbopack`, `.next-internal`)
- Build tools (webpack, node_modules)
- Node.js internals (`internal/modules`, `vm.js`, `loader.js`)
- Native functions (`[native code]`)
- Short functions (< 20 chars)
- Only allows: `./src/`, `../src/`, `@/` patterns

---

## Integration Points

- OpenTelemetry tracing
- AsyncLocalStorage for request context
- Client-server request correlation
- Development-only modes with production safety

---

## Currently Unimplemented

- **Client-side automatic logging:** Infrastructure designed but not activated (requires recursion prevention guards)
- **OpenTelemetry export:** Tracing created but not exported to Jaeger/OTLP backend
- **Log aggregation service:** Logs only written to local files
- **Advanced sampling/filtering:** All logs of enabled type are written
