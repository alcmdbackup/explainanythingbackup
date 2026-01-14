# Pass Logs & Traces to Sentry - Implementation Plan

## Summary

Enable Sentry's Logs feature to send ERROR/WARN logs alongside existing Honeycomb observability. Reuse existing sanitization infrastructure.

**Decision:** Option A - Enable Sentry Logs for error correlation while keeping Honeycomb as primary backend.

## Problem

1. `enableLogs: true` missing from Sentry configs → logs don't appear in Sentry Logs product
2. Server Actions not wrapped with `withServerActionInstrumentation`
3. Route Handlers lack explicit `Sentry.captureException()`

## Architecture

```
Logger calls → Console + server.log + Honeycomb OTLP
                      ↓
                Sentry.logger.* (ERROR/WARN only)
                      ↓
                Sentry Logs Product
```

---

## Phase 1: Infrastructure Setup

### 1.1 Verify API Availability

```bash
npm list @sentry/nextjs  # Requires v9.41.0+, we have ^10.32.1 ✓
npx tsx -e "import * as S from '@sentry/nextjs'; console.log(typeof S.logger?.error)"
```

**Blocker:** If `Sentry.logger` undefined, stop and research alternatives.

### 1.2 Export Existing Sanitization

**File:** `src/lib/logging/server/automaticServerLoggingBase.ts`

Add `export` keyword to existing `sanitizeData` function (line ~72).

### 1.3 Create Sentry Sanitization Wrapper

**File:** `src/lib/sentrySanitization.ts` (new)

```typescript
// Thin wrapper reusing existing sanitization
import { sanitizeData } from '@/lib/logging/server/automaticServerLoggingBase';
import { LogConfig, defaultLogConfig } from '@/lib/schemas/schemas';

export const SENTRY_SENSITIVE_FIELDS = [
  ...defaultLogConfig.sensitiveFields,
  'email', 'authorization', 'cookie', 'session', 'jwt',
  'bearer', 'refresh_token', 'access_token', 'apiKey', 'pass',
];

const SENTRY_LOG_CONFIG: LogConfig = {
  ...defaultLogConfig,
  sensitiveFields: SENTRY_SENSITIVE_FIELDS,
  maxInputLength: undefined,
  maxOutputLength: undefined,
};

export function sanitizeForSentry(data: Record<string, unknown> | null) {
  if (!data) return undefined;
  return sanitizeData(data, SENTRY_LOG_CONFIG);
}

export function createBeforeSendLog() {
  return (log: { level: string; attributes?: Record<string, unknown> }) => {
    if (process.env.NODE_ENV === 'production') {
      if (['trace', 'debug', 'info'].includes(log.level)) return null;
    }
    if (log.attributes) {
      log.attributes = sanitizeForSentry(log.attributes) ?? {};
    }
    return log;
  };
}
```

### 1.4 Enable Sentry Logs in Config Files

**Files:** `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`

```typescript
import { createBeforeSendLog } from '@/lib/sentrySanitization';

Sentry.init({
  // ... existing config
  enableLogs: true,
  beforeSendLog: createBeforeSendLog(),
});
```

### 1.5 Add Unit Tests

**File:** `src/lib/sentrySanitization.test.ts`

- Test `SENTRY_SENSITIVE_FIELDS` includes extended fields
- Test `sanitizeForSentry` redacts Sentry-specific fields
- Test `createBeforeSendLog` filters by level in production

### Phase 1 Verification

- [ ] `npm run lint && npm run tsc && npm run build` passes
- [ ] Unit tests pass
- [ ] Manual test: `Sentry.logger.info("test")` appears in dashboard

---

## Phase 2: Integration

### 2.1 Update Logger Utilities

**Files:** `src/lib/server_utilities.ts`, `src/lib/client_utilities.ts`

Add `Sentry.logger.*` calls for ERROR/WARN only:

```typescript
import { sanitizeForSentry } from '@/lib/sentrySanitization';

error: (message: string, data: LoggerData | null = null) => {
  // ... existing code ...
  try {
    Sentry.logger.error(message, sanitizeForSentry(data));
  } catch (e) {
    console.warn('[Sentry Logger] Failed:', e);
  }
},
```

### 2.2 Instrument Server Actions

**Files:** Discover with `grep -rn "'use server'" src/`

Wrap with `Sentry.withServerActionInstrumentation`:

```typescript
export async function login(formData: FormData) {
  return await Sentry.withServerActionInstrumentation('login', { formData, recordResponse: true }, async () => {
    // existing logic
  });
}
```

### 2.3 Add Explicit Route Handler Capture

**Files:** `src/app/api/*/route.ts`

Add to catch blocks:

```typescript
Sentry.captureException(error, {
  tags: { endpoint: '/api/xyz', method: 'POST' },
  extra: { requestId: RequestIdContext.getRequestId() },
});
```

### 2.4 Update Jest Mock

**File:** `jest.setup.js`

```typescript
jest.mock('@sentry/nextjs', () => ({
  init: jest.fn(),
  logger: { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), fatal: jest.fn() },
  captureException: jest.fn(),
  withServerActionInstrumentation: jest.fn((name, opts, fn) => fn()),
  // ... other mocks
}));
```

### Phase 2 Verification

- [ ] All unit tests pass
- [ ] E2E tests pass (`npm run test:e2e`)
- [ ] Trigger error → appears in Sentry Issues + Logs
- [ ] PII redacted in Sentry dashboard

---

## Testing Summary

| Type | Location | Focus |
|------|----------|-------|
| Unit | `src/lib/sentrySanitization.test.ts` | Config differences, field redaction |
| Integration | `src/lib/sentrySanitization.integration.test.ts` | `beforeSendLog` filtering behavior |
| E2E | Existing suite | No regressions |

---

## Rollback Plan

1. Remove `enableLogs: true` from Sentry configs
2. Remove `Sentry.logger.*` calls from logger utilities
3. Remove `withServerActionInstrumentation` wrappers
4. Redeploy

**Note:** Logs already in Sentry cannot be deleted retroactively.

---

## Success Criteria

- [ ] `enableLogs: true` in all three Sentry configs
- [ ] ERROR/WARN logs appear in Sentry Logs
- [ ] PII redacted (email, session, jwt, etc.)
- [ ] Server Actions instrumented
- [ ] Route Handlers have explicit error capture
- [ ] All tests pass
- [ ] Sentry quota stable after 48 hours
