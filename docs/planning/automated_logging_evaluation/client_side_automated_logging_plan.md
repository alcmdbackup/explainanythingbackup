# Plan: Automatic withLogging Enforcement via Claude Code Stop Hook

## Goal
Automatically ensure all server actions, services, and client functions are wrapped with `withLogging` using a Claude Code prompt-based Stop hook.

## Summary
1. Create client-side `withClientLogging` (mirrors server pattern)
2. Add prompt-based Stop hook to enforce logging wrappers
3. Client logs go to console; server logs go to `server.log`

## Prior Art
- **Existing hook plan:** `docs/backend_explorations/hooks_to_add_withLogging.md` (PostToolUse approach - we're using Stop hook instead)
- **Research doc:** `docs/planning/automated_logging_evaluation/automated_logging_evaluation_research.md`
- **Deprecated approaches:** Runtime/AST transforms in `docs/deprecated/` - too complex, manual wrapping preferred

---

## Phase 1: Client-Side Logging Infrastructure

### Create: `src/lib/logging/client/clientLogging.ts`
Port `withLogging` from server to client, using `logger` from `client_utilities.ts`:

```typescript
import { logger } from '@/lib/client_utilities';
import { LogConfig, defaultLogConfig } from '@/lib/schemas/schemas';

// Data sanitization limits (from research doc)
const SANITIZE_LIMITS = {
  maxStringLength: 500,
  maxArrayItems: 10,
  maxObjectProperties: 20,
};

function sanitizeData(data: any, config: LogConfig, seen = new WeakSet()): any {
  // Circular reference detection via WeakSet
  // Apply SANITIZE_LIMITS
  // Redact sensitiveFields from LogConfig
}

export function withClientLogging<T extends (...args: any[]) => any>(
  fn: T,
  functionName: string,
  config: Partial<LogConfig> = {}
): T {
  // Mirror server implementation, use client logger
}
```

### Create: `src/lib/logging/client/index.ts`
```typescript
export { withClientLogging } from './clientLogging';
```

### Test file: `src/lib/logging/client/__tests__/clientLogging.test.ts`
- Reuse patterns from `src/testing/utils/logging-test-helpers.ts`

### Existing infrastructure to leverage:
- `src/app/api/client-logs/route.ts` - API endpoint (dev only, writes to `client.log`)
- `src/app/(debug)/test-client-logging/page.tsx` - Debug test page

---

## Phase 2: Stop Hook Configuration

### Modify: `.claude/settings.json`

Add prompt-based hook after existing command hook:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "(npx tsc --noEmit && npm run lint && npm test) 1>&2; true"
          },
          {
            "type": "prompt",
            "prompt": "LOGGING WRAPPER ENFORCEMENT\n\nCheck files modified in this session:\n\n$ARGUMENTS\n\nRULES:\n1. Server actions (src/actions/*.ts): exported functions must use `withLogging` + `serverReadRequestId` pattern\n2. Services (src/lib/services/*.ts): exported async functions must use `withLogging`\n3. Client hooks (src/hooks/*.ts): async callbacks must use `withClientLogging`\n4. Components: async event handlers must use `withClientLogging`\n\nSKIP: test files, type definitions, re-exports, sync utilities, already-wrapped functions\n\nRespond JSON:\n- All wrapped: {\"decision\": \"approve\"}\n- Missing wrapper: {\"decision\": \"approve\", \"reason\": \"WARNING: Missing withLogging in [file]: [function]\"}",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

---

## Phase 3: Wrap Existing Functions (Gradual Rollout)

### Priority hooks to wrap first:
- `src/hooks/useExplanationLoader.ts`
- `src/hooks/useUserAuth.ts`
- `src/hooks/useStreamingEditor.ts`

### Pattern for client hooks:
```typescript
const loadData = withClientLogging(
  async function loadData() { /* ... */ },
  'useExplanationLoader.loadData',
  { enabled: true }
);
```

---

## Files to Create/Modify

| Action | File |
|--------|------|
| Create | `src/lib/logging/client/clientLogging.ts` |
| Create | `src/lib/logging/client/index.ts` |
| Create | `src/lib/logging/client/__tests__/clientLogging.test.ts` |
| Modify | `.claude/settings.json` |
| Update | `docs/planning/automated_logging_evaluation/automated_logging_evaluation_research.md` - add this plan reference |

### Existing files to leverage (no changes needed):
| File | Purpose |
|------|---------|
| `src/lib/logging/server/automaticServerLoggingBase.ts` | Server `withLogging` - pattern to follow |
| `src/testing/utils/logging-test-helpers.ts` | Test utilities to reuse |
| `src/app/api/client-logs/route.ts` | Client log API (dev only) |
| `src/lib/schemas/schemas.ts` | LogConfig type definition |

---

## Detection Patterns

**Requires wrapping:**
- `export async function X` in actions/services
- `useCallback(async () => ...)` in hooks
- `handleX = async () => ...` in components

**Already wrapped (skip):**
- `withLogging(async function X...`
- `withClientLogging(async function X...`

---

## Implementation Order

1. Create `clientLogging.ts` + tests
2. Create index.ts export
3. Update `.claude/settings.json` with prompt hook
4. Test hook locally
5. Wrap priority hooks as examples
