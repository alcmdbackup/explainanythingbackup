# Sentry Integration Plan for ExplainAnything

## Executive Summary

This plan outlines a comprehensive Sentry integration that will:
1. Capture server and client-side errors with full context
2. Integrate with existing logging and tracing infrastructure
3. Enable automatic bug detection and issue creation for Claude Code

---

## Current State Analysis

### Existing Observability Infrastructure
| Component | Current State | Sentry Integration Opportunity |
|-----------|---------------|-------------------------------|
| **Request Tracing** | `RequestIdContext` propagates IDs client→server | Map to Sentry transaction IDs |
| **Error Handling** | 13+ categorized error codes in `errorHandling.ts` | Use as Sentry tags/fingerprints |
| **Logging** | `withLogging` wrapper captures inputs/outputs/errors | Convert to Sentry breadcrumbs |
| **OpenTelemetry** | Grafana Cloud integration | Connect via Sentry-OTEL bridge |
| **File Logging** | `server.log` with structured JSON | Send to Sentry as attachments |

### Gap Analysis
| Missing Capability | Priority | Solution |
|-------------------|----------|----------|
| React Error Boundaries | High | Add `Sentry.ErrorBoundary` wrapper |
| Client JS error capture | High | Sentry browser SDK |
| Session Replay | Medium | Sentry Replay integration |
| Issue auto-creation | High | GitHub integration + Sentry API |
| **Client logs lost in production** | High | `/api/client-logs` is dev-only; need Sentry breadcrumbs |
| **394 existing logger calls** | High | Hook into logger functions directly |
| **Client context incomplete** | Medium | Client only has `requestId`, missing `userId`/`sessionId` |

### Current Logging Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SERVER SIDE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  logger.info/error/warn/debug  →  Console + server.log file         │
│  (includes requestId, userId, sessionId from RequestIdContext)      │
│                                                                      │
│  withLogging() wrapper  →  Calls logger.info/error automatically    │
│  handleError()          →  Calls logger.error (NO Sentry currently) │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         CLIENT SIDE                                  │
├─────────────────────────────────────────────────────────────────────┤
│  logger.info/error/warn/debug  →  Console ONLY                      │
│  (only includes requestId, NOT userId/sessionId)                     │
│                                                                      │
│  /api/client-logs endpoint  →  Returns 403 in production!           │
│  withClientLogging() wrapper  →  Calls logger.info/error            │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Insight**: Rather than adding parallel Sentry breadcrumb calls throughout the codebase, we should **modify the logger functions themselves** to also send to Sentry. This automatically captures all 394 existing logger calls.

---

## Phase 1: Core SDK Installation & Configuration

### 1.1 Install Sentry Packages

```bash
npm install @sentry/nextjs
```

This single package includes:
- `@sentry/node` for server-side
- `@sentry/react` for client-side
- Next.js specific integrations

### 1.2 Initialize Sentry with Wizard

```bash
npx @sentry/wizard@latest -i nextjs
```

This will create:
- `sentry.client.config.ts` - Browser SDK initialization
- `sentry.server.config.ts` - Node.js SDK initialization
- `sentry.edge.config.ts` - Edge runtime initialization
- `next.config.js` updates - Source map upload configuration

### 1.3 Configuration Files

**`sentry.client.config.ts`**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Environment configuration
  environment: process.env.NODE_ENV,

  // Tracing
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  integrations: [
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
    Sentry.browserTracingIntegration(),
  ],

  // Custom configuration for existing infrastructure
  beforeSend(event) {
    // Attach requestId from our context system
    const requestId = window.__REQUEST_ID__;
    if (requestId) {
      event.tags = { ...event.tags, requestId };
    }
    return event;
  },

  // Ignore known non-actionable errors
  ignoreErrors: [
    'ResizeObserver loop limit exceeded',
    'Non-Error promise rejection captured',
  ],
});
```

**`sentry.server.config.ts`**
```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Tracing
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,

  // Connect to OpenTelemetry
  instrumenter: "otel",

  integrations: [
    // Database query tracking
    Sentry.prismaIntegration(), // If using Prisma
  ],

  beforeSend(event, hint) {
    // Enrich with our error categorization
    const originalError = hint.originalException;
    if (originalError && typeof originalError === 'object' && 'code' in originalError) {
      event.tags = {
        ...event.tags,
        errorCode: (originalError as any).code,
      };
    }
    return event;
  },
});
```

### 1.4 Environment Variables

Add to `.env.local`:
```bash
# Sentry Configuration
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_AUTH_TOKEN=your-auth-token
SENTRY_ORG=your-org
SENTRY_PROJECT=explainanything

# For source map uploads
SENTRY_RELEASE=explainanything@${npm_package_version}
```

---

## Phase 2: Error Handling Integration

### 2.1 Enhance `errorHandling.ts`

Modify the existing `handleError` function to report to Sentry:

```typescript
// src/lib/errorHandling.ts

import * as Sentry from "@sentry/nextjs";
import { RequestIdContext } from "./requestIdContext";

export function handleError(
  error: unknown,
  context: string,
  additionalData?: Record<string, any>
): ErrorResponse {
  const errorResponse = categorizeError(error);

  // Report to Sentry with full context
  Sentry.withScope((scope) => {
    // Add request context
    const requestContext = RequestIdContext.get();
    if (requestContext) {
      scope.setTag('requestId', requestContext.requestId);
      scope.setUser({ id: requestContext.userId });
      scope.setExtra('sessionId', requestContext.sessionId);
    }

    // Add error categorization
    scope.setTag('errorCode', errorResponse.code);
    scope.setContext('errorContext', {
      context,
      ...additionalData,
    });

    // Set severity based on error code
    scope.setLevel(getSentryLevel(errorResponse.code));

    // Capture the exception
    Sentry.captureException(error);
  });

  return errorResponse;
}

function getSentryLevel(code: ErrorCode): Sentry.SeverityLevel {
  const criticalErrors = ['DATABASE_ERROR', 'LLM_API_ERROR'];
  const warningErrors = ['TIMEOUT_ERROR', 'VALIDATION_ERROR'];

  if (criticalErrors.includes(code)) return 'error';
  if (warningErrors.includes(code)) return 'warning';
  return 'info';
}
```

### 2.2 Create React Error Boundary

**`src/components/SentryErrorBoundary.tsx`**
```typescript
'use client';

import * as Sentry from "@sentry/nextjs";
import { Component, ReactNode } from "react";
import { ErrorCard } from "./ErrorCard";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  eventId: string | null;
}

export class SentryErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, eventId: null };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true, eventId: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.withScope((scope) => {
      scope.setContext('react', {
        componentStack: errorInfo.componentStack,
      });
      const eventId = Sentry.captureException(error);
      this.setState({ eventId });
    });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorCard
          message="Something went wrong"
          eventId={this.state.eventId}
          onRetry={() => this.setState({ hasError: false, eventId: null })}
        />
      );
    }

    return this.props.children;
  }
}
```

### 2.3 Wrap Root Layout

**`src/app/layout.tsx`**
```typescript
import { SentryErrorBoundary } from "@/components/SentryErrorBoundary";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SentryErrorBoundary>
          {children}
        </SentryErrorBoundary>
      </body>
    </html>
  );
}
```

---

## Phase 3: Logging Integration (CRITICAL)

This phase ensures ALL existing logging flows to Sentry. The key is to **modify the logger functions themselves** rather than adding parallel calls.

### 3.1 Modify Server Logger (`server_utilities.ts`)

Hook Sentry breadcrumbs directly into the existing logger:

```typescript
// src/lib/server_utilities.ts
import * as Sentry from "@sentry/nextjs";
import { appendFileSync } from 'fs';
import { join } from 'path';
import { RequestIdContext } from './requestIdContext';

interface LoggerData {
    [key: string]: any;
}

const logFile = join(process.cwd(), 'server.log');

// Map our log levels to Sentry severity
const sentryLevelMap: Record<string, Sentry.SeverityLevel> = {
  'DEBUG': 'debug',
  'INFO': 'info',
  'WARN': 'warning',
  'ERROR': 'error'
};

// Helper function to add request context
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();
    const sessionId = RequestIdContext.getSessionId();
    return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};

// File logging with FLAT structure
function writeToFile(level: string, message: string, data: LoggerData | null) {
    const timestamp = new Date().toISOString();
    const logEntry = JSON.stringify({
        timestamp,
        level,
        message,
        requestId: RequestIdContext.getRequestId(),
        userId: RequestIdContext.getUserId(),
        sessionId: RequestIdContext.getSessionId(),
        data: data || {}
    }) + '\n';

    try {
        appendFileSync(logFile, logEntry);
    } catch (error) {
        // Silently fail if file write fails
    }
}

// NEW: Send to Sentry as breadcrumb
function sendToSentry(level: string, message: string, data: LoggerData | null) {
    try {
        Sentry.addBreadcrumb({
            category: 'log',
            message: message,
            level: sentryLevelMap[level] || 'info',
            data: {
                ...data,
                requestId: RequestIdContext.getRequestId(),
                userId: RequestIdContext.getUserId(),
                sessionId: RequestIdContext.getSessionId(),
            },
            timestamp: Date.now() / 1000,
        });

        // For ERROR level, also capture as Sentry event (not just breadcrumb)
        if (level === 'ERROR') {
            Sentry.captureMessage(message, {
                level: 'error',
                extra: data || {},
                tags: {
                    requestId: RequestIdContext.getRequestId(),
                    userId: RequestIdContext.getUserId(),
                }
            });
        }
    } catch (e) {
        // Don't let Sentry errors break logging
    }
}

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
        writeToFile('DEBUG', message, data);
        sendToSentry('DEBUG', message, data);  // NEW
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
        writeToFile('ERROR', message, data);
        sendToSentry('ERROR', message, data);  // NEW
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
        writeToFile('INFO', message, data);
        sendToSentry('INFO', message, data);  // NEW
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
        writeToFile('WARN', message, data);
        sendToSentry('WARN', message, data);  // NEW
    }
};

export { logger };
```

**Result**: All 394 existing `logger.info()`, `logger.error()`, etc. calls automatically flow to Sentry!

### 3.2 Modify Client Logger (`client_utilities.ts`)

The client logger currently only logs to console. In production, these logs are lost. Fix this:

```typescript
// src/lib/client_utilities.ts
import * as Sentry from "@sentry/nextjs";
import { RequestIdContext } from './requestIdContext';

interface LoggerData {
    [key: string]: any;
}

const sentryLevelMap: Record<string, Sentry.SeverityLevel> = {
  'DEBUG': 'debug',
  'INFO': 'info',
  'WARN': 'warning',
  'ERROR': 'error'
};

const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();      // NEW: now available
    const sessionId = RequestIdContext.getSessionId(); // NEW: now available
    return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};

// NEW: Send to Sentry (works in production!)
function sendToSentry(level: string, message: string, data: LoggerData | null) {
    try {
        Sentry.addBreadcrumb({
            category: 'client-log',
            message: message,
            level: sentryLevelMap[level] || 'info',
            data: addRequestId(data),
            timestamp: Date.now() / 1000,
        });

        // For ERROR level, capture as Sentry event
        if (level === 'ERROR') {
            Sentry.captureMessage(message, {
                level: 'error',
                extra: data || {},
                tags: {
                    source: 'client',
                    requestId: RequestIdContext.getRequestId(),
                }
            });
        }
    } catch (e) {
        // Sentry not initialized or error - fail silently
    }
}

const logger = {
    debug: (message: string, data: LoggerData | null = null, debug: boolean = false) => {
        if (!debug) return;
        console.log(`[DEBUG] ${message}`, addRequestId(data));
        sendToSentry('DEBUG', message, data);  // NEW
    },

    error: (message: string, data: LoggerData | null = null) => {
        console.error(`[ERROR] ${message}`, addRequestId(data));
        sendToSentry('ERROR', message, data);  // NEW
    },

    info: (message: string, data: LoggerData | null = null) => {
        console.log(`[INFO] ${message}`, addRequestId(data));
        sendToSentry('INFO', message, data);  // NEW
    },

    warn: (message: string, data: LoggerData | null = null) => {
        console.warn(`[WARN] ${message}`, addRequestId(data));
        sendToSentry('WARN', message, data);  // NEW
    }
};

export { logger };
```

### 3.3 Fix Client Context (userId/sessionId Missing)

**The Problem**: Server and client loggers capture different context:

```typescript
// SERVER (server_utilities.ts:33-38) - COMPLETE ✅
const addRequestId = (data) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();      // ✅ Captured
    const sessionId = RequestIdContext.getSessionId(); // ✅ Captured
    return { requestId, userId, sessionId, ...data };
};

// CLIENT (client_utilities.ts:15-18) - INCOMPLETE ❌
const addRequestId = (data) => {
    const requestId = RequestIdContext.getRequestId();
    // ❌ userId NOT captured
    // ❌ sessionId NOT captured
    return { requestId, ...data };
};
```

**Why This Matters for Sentry**:

| Capability | Without userId/sessionId | With full context |
|------------|--------------------------|-------------------|
| "Who had this error?" | ❌ Unknown | ✅ User ID visible |
| "Is this user having repeated issues?" | ❌ Can't track | ✅ Filter by user |
| "How many sessions affected?" | ❌ Can't count | ✅ Session metrics |
| "Contact affected users" | ❌ Impossible | ✅ Know who to contact |

**The Fix**: The `RequestIdContext` already supports full context on client, but `setClient()` is never called with real values. Add initialization when user authenticates:

```typescript
// src/components/ClientContextProvider.tsx (NEW FILE)
'use client';

import { useEffect } from 'react';
import { RequestIdContext } from '@/lib/requestIdContext';
import { useUserAuth } from '@/hooks/useUserAuth';

function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return 'unknown';

  let sessionId = sessionStorage.getItem('ea_sessionId');
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    sessionStorage.setItem('ea_sessionId', sessionId);
  }
  return sessionId;
}

export function ClientContextProvider({ children }: { children: React.ReactNode }) {
  const { user } = useUserAuth();

  useEffect(() => {
    // Set full context when user state changes
    RequestIdContext.setClient({
      requestId: crypto.randomUUID(),
      userId: user?.id || 'anonymous',
      sessionId: getOrCreateSessionId(),
    });
  }, [user?.id]);

  return <>{children}</>;
}
```

Then wrap your app in `layout.tsx`:

```typescript
// src/app/layout.tsx
import { ClientContextProvider } from '@/components/ClientContextProvider';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <ClientContextProvider>
          {children}
        </ClientContextProvider>
      </body>
    </html>
  );
}
```

Also update the client logger to use full context:

```typescript
// src/lib/client_utilities.ts - update addRequestId
const addRequestId = (data: LoggerData | null) => {
    const requestId = RequestIdContext.getRequestId();
    const userId = RequestIdContext.getUserId();      // ADD THIS
    const sessionId = RequestIdContext.getSessionId(); // ADD THIS
    return data ? { requestId, userId, sessionId, ...data } : { requestId, userId, sessionId };
};
```

### 3.4 Server Log File Attachment on Errors

Attach recent server logs when an error is captured:

```typescript
// sentry.server.config.ts - add to beforeSend
import * as fs from 'fs';
import { join } from 'path';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  // ... other config

  beforeSend(event, hint) {
    // Only attach logs for actual errors, not breadcrumbs
    if (event.level === 'error' || event.exception) {
      try {
        const logPath = join(process.cwd(), 'server.log');
        const logContent = fs.readFileSync(logPath, 'utf8');
        const lines = logContent.split('\n');

        // Get last 50 log lines related to this request
        const requestId = event.tags?.requestId;
        let relevantLogs: string[];

        if (requestId) {
          // Filter logs for this specific request
          relevantLogs = lines
            .filter(line => line.includes(requestId))
            .slice(-50);
        } else {
          // Just get the last 50 lines
          relevantLogs = lines.slice(-50);
        }

        // Add as attachment
        event.attachments = event.attachments || [];
        event.attachments.push({
          filename: 'server-logs.txt',
          data: relevantLogs.join('\n'),
          contentType: 'text/plain',
        });
      } catch (e) {
        // Log file not available, continue without attachment
      }
    }

    return event;
  },
});
```

### 3.5 withLogging Wrapper Enhancement (Optional)

The `withLogging` wrapper already calls `logger.info()` and `logger.error()`, so with our changes above, it automatically sends to Sentry. However, we can add richer context:

```typescript
// In automaticServerLoggingBase.ts, enhance the logging to include span info:

// Add at the start of the wrapped function:
logger.info(`Function ${functionName} called`, {
  inputs: sanitizedArgs,
  timestamp: new Date().toISOString(),
  spanType: 'function-start',  // NEW: helps identify function boundaries in breadcrumbs
});

// On success:
logger.info(`Function ${functionName} completed successfully`, {
  outputs: sanitizedResult,
  duration: `${duration}ms`,
  timestamp: new Date().toISOString(),
  spanType: 'function-end',  // NEW
});

// On error:
logger.error(`Function ${functionName} failed`, {
  error: error instanceof Error ? error.message : String(error),
  duration: `${duration}ms`,
  timestamp: new Date().toISOString(),
  spanType: 'function-error',  // NEW
});
```

---

## Phase 4: Request Context Integration

### 4.1 Enhance RequestIdContext

**`src/lib/requestIdContext.ts`** modifications:

```typescript
import * as Sentry from "@sentry/nextjs";

export const RequestIdContext = {
  run<T>(data: ContextData, callback: () => T): T {
    // Set Sentry context when request context is established
    Sentry.setTag('requestId', data.requestId);
    Sentry.setUser({ id: data.userId });
    Sentry.setContext('session', { sessionId: data.sessionId });

    // Start Sentry transaction
    return Sentry.startSpan(
      { name: `request-${data.requestId}`, op: 'request' },
      () => {
        // Run the existing AsyncLocalStorage logic
        return asyncLocalStorage.run(data, callback);
      }
    );
  },
  // ... rest of implementation
};
```

### 4.2 API Route Integration

Enhance API routes with Sentry:

```typescript
// src/app/api/returnExplanation/route.ts
import * as Sentry from "@sentry/nextjs";

export async function POST(request: NextRequest) {
  return Sentry.withIsolationScope(async (scope) => {
    const body = await request.json();

    scope.setTag('requestId', body.__requestId);
    scope.setTag('endpoint', 'returnExplanation');
    scope.setContext('request', {
      userInput: body.userInput?.substring(0, 100),
      userId: body.userid,
    });

    try {
      // Existing logic...
    } catch (error) {
      Sentry.captureException(error);
      throw error;
    }
  });
}
```

---

## Phase 5: OpenTelemetry Bridge

### 5.1 Connect Existing OTEL to Sentry

Modify `instrumentation.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";
import { trace, context } from '@opentelemetry/api';

export async function register() {
  // Existing OTEL setup...

  // Add Sentry-OTEL integration
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    instrumenter: "otel",
    // ... other config
  });

  // Link OTEL traces to Sentry
  const originalCreateSpan = llmTracer.startSpan.bind(llmTracer);
  llmTracer.startSpan = (name: string, options?: any) => {
    const otelSpan = originalCreateSpan(name, options);

    // Get Sentry span and link
    const sentrySpan = Sentry.getActiveSpan();
    if (sentrySpan) {
      sentrySpan.setAttribute('otel.trace_id', otelSpan.spanContext().traceId);
    }

    return otelSpan;
  };
}
```

---

## Phase 6: Automatic Issue Creation for Claude Code

### 6.1 Sentry → GitHub Integration

Configure in Sentry Dashboard:
1. **Settings → Integrations → GitHub**
2. Enable repository linking
3. Configure issue auto-creation rules

### 6.2 Custom Issue Template

Create GitHub issue template for Sentry-generated issues:

**`.github/ISSUE_TEMPLATE/sentry-bug.md`**
```markdown
---
name: Sentry Bug Report
about: Auto-generated from Sentry error tracking
title: '[SENTRY] {{ title }}'
labels: bug, sentry, claude-code
assignees: ''
---

## Sentry Error Report

**Error ID:** {{ eventId }}
**First Seen:** {{ firstSeen }}
**Occurrences:** {{ count }}

### Error Details
```
{{ errorMessage }}
```

### Stack Trace
```
{{ stackTrace }}
```

### Context
- **Request ID:** {{ requestId }}
- **User ID:** {{ userId }}
- **Error Code:** {{ errorCode }}
- **Environment:** {{ environment }}

### Breadcrumbs
{{ breadcrumbs }}

### Claude Code Instructions
This issue was automatically created from a Sentry error. To fix:
1. Review the stack trace and error context
2. Check the breadcrumbs for user actions leading to the error
3. Implement a fix with appropriate error handling
4. Add tests to prevent regression

[View in Sentry]({{ sentryLink }})
```

### 6.3 Sentry Alert Rules

Configure in Sentry:

```yaml
# Alert for new issues
- name: "New High-Priority Issue"
  conditions:
    - type: first_seen_event
  filters:
    - type: level
      value: error
  actions:
    - type: create_github_issue
      integration: github
      repo: your-org/explainanything
      labels: ["bug", "sentry", "claude-code"]

# Alert for regressions
- name: "Issue Regression"
  conditions:
    - type: regression_event
  actions:
    - type: create_github_issue
      integration: github
      labels: ["regression", "sentry", "claude-code"]
```

### 6.4 Webhook for Custom Processing

**`src/app/api/sentry-webhook/route.ts`**
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('sentry-hook-signature');
  // Verify webhook signature...

  const payload = await request.json();

  if (payload.action === 'created' && payload.data.issue) {
    const issue = payload.data.issue;

    // Create GitHub issue with Claude Code context
    const githubIssue = await createGitHubIssue({
      title: `[BUG] ${issue.title}`,
      body: formatIssueBody(issue),
      labels: ['bug', 'sentry', 'claude-code'],
    });

    // Log for tracking
    console.log('Created GitHub issue:', githubIssue.number);
  }

  return NextResponse.json({ received: true });
}

function formatIssueBody(issue: any): string {
  return `
## Sentry Error: ${issue.title}

**Error ID:** ${issue.id}
**Occurrences:** ${issue.count}
**Users Affected:** ${issue.userCount}

### Error Message
\`\`\`
${issue.metadata.value || issue.culprit}
\`\`\`

### Context
${JSON.stringify(issue.context, null, 2)}

### Claude Code Instructions
Use the error context above to:
1. Identify the root cause
2. Implement a fix with proper error handling
3. Add error boundary if it's a React component error
4. Add tests to prevent regression

[View in Sentry](https://sentry.io/organizations/your-org/issues/${issue.id}/)
`;
}
```

---

## Phase 7: Advanced Features

### 7.1 Performance Monitoring

```typescript
// src/lib/sentryPerformance.ts
import * as Sentry from "@sentry/nextjs";

export function measureOperation<T>(
  name: string,
  operation: () => Promise<T>,
  category: 'llm' | 'db' | 'vector' | 'compute'
): Promise<T> {
  return Sentry.startSpan(
    { name, op: category },
    async (span) => {
      try {
        const result = await operation();
        span.setStatus({ code: 1, message: 'ok' });
        return result;
      } catch (error) {
        span.setStatus({ code: 2, message: (error as Error).message });
        throw error;
      }
    }
  );
}

// Usage example
const explanation = await measureOperation(
  'generate-explanation',
  () => generateExplanation(query),
  'llm'
);
```

### 7.2 User Feedback Widget

```typescript
// src/components/FeedbackButton.tsx
'use client';

import * as Sentry from "@sentry/nextjs";

export function FeedbackButton() {
  const handleFeedback = () => {
    Sentry.showReportDialog({
      eventId: Sentry.lastEventId(),
      title: 'Report an Issue',
      subtitle: 'Help us improve ExplainAnything',
      labelComments: 'What happened?',
    });
  };

  return (
    <button onClick={handleFeedback}>
      Report Issue
    </button>
  );
}
```

### 7.3 Custom Metrics

```typescript
// src/lib/sentryMetrics.ts
import * as Sentry from "@sentry/nextjs";

export const metrics = {
  // Track LLM usage
  trackLLMCall: (model: string, tokens: number, duration: number) => {
    Sentry.setMeasurement('llm.tokens', tokens, 'none');
    Sentry.setMeasurement('llm.duration', duration, 'millisecond');
  },

  // Track vector search performance
  trackVectorSearch: (results: number, duration: number) => {
    Sentry.setMeasurement('vector.results', results, 'none');
    Sentry.setMeasurement('vector.duration', duration, 'millisecond');
  },

  // Track explanation generation
  trackExplanation: (charCount: number, duration: number) => {
    Sentry.setMeasurement('explanation.length', charCount, 'none');
    Sentry.setMeasurement('explanation.duration', duration, 'millisecond');
  },
};
```

---

## Implementation Checklist

### Phase 1: Core Setup
- [ ] Run `npx @sentry/wizard@latest -i nextjs`
- [ ] Configure `sentry.client.config.ts`
- [ ] Configure `sentry.server.config.ts`
- [ ] Add environment variables to `.env.local` and production
- [ ] Verify source map uploads work in CI/CD

### Phase 2: Error Handling
- [ ] Enhance `handleError()` in `src/lib/errorHandling.ts` with Sentry reporting
- [ ] Create `SentryErrorBoundary` component
- [ ] Wrap root layout (`src/app/layout.tsx`) with error boundary
- [ ] Test error capture in development

### Phase 3: Logging Integration (CRITICAL - captures all 394 existing log calls)
- [ ] Modify `src/lib/server_utilities.ts` to add `sendToSentry()` function
- [ ] Modify `src/lib/client_utilities.ts` to add `sendToSentry()` function
- [ ] Update client-side code to set full context (userId, sessionId) on `RequestIdContext`
- [ ] Add server log file attachment in `sentry.server.config.ts` `beforeSend`
- [ ] Verify breadcrumb trail appears in Sentry for a test error
- [ ] Test that `logger.error()` calls create Sentry events

### Phase 4: Request Context
- [ ] Integrate `RequestIdContext.run()` with Sentry tags/user context
- [ ] Add Sentry scope to API routes (especially `/api/returnExplanation`)
- [ ] Verify request correlation in Sentry (all events from same request grouped)

### Phase 5: OpenTelemetry Bridge (Optional - depends on needs)
- [ ] Evaluate if dual Grafana + Sentry is needed or if Sentry replaces Grafana
- [ ] If keeping both: Configure OTEL-Sentry integration via `instrumenter: "otel"`
- [ ] Link trace IDs between systems
- [ ] Verify traces appear in both Grafana and Sentry

### Phase 6: Automatic Issue Creation
- [ ] Create Sentry project and configure GitHub integration
- [ ] Create issue template `.github/ISSUE_TEMPLATE/sentry-bug.md`
- [ ] Set up Sentry Alert Rules for new errors
- [ ] Set up Sentry Alert Rules for regressions
- [ ] Test end-to-end: trigger error → verify GitHub issue created with `claude-code` label

### Phase 7: Advanced Features (Nice-to-have)
- [ ] Add performance monitoring for LLM calls, vector searches
- [ ] Implement user feedback widget
- [ ] Set up custom metrics dashboard
- [ ] Configure Session Replay for production debugging

---

## Configuration Reference

### Recommended Sentry Project Settings

| Setting | Development | Production |
|---------|-------------|------------|
| `tracesSampleRate` | 1.0 | 0.2 |
| `replaysSessionSampleRate` | 0.0 | 0.1 |
| `replaysOnErrorSampleRate` | 1.0 | 1.0 |
| `attachStacktrace` | true | true |
| `maxBreadcrumbs` | 100 | 50 |
| `debug` | true | false |

### Alert Rule Suggestions

| Alert Name | Trigger | Action |
|------------|---------|--------|
| New Critical Error | First seen, level=error | Create GitHub issue, Slack notification |
| Error Spike | >10 errors in 5 min | Slack notification |
| Performance Regression | p95 > 5s | Email notification |
| Regression | Previously resolved error | Create GitHub issue |

---

## Security Considerations

1. **PII Scrubbing**: Configure `beforeSend` to redact sensitive fields
2. **Source Maps**: Keep auth tokens in CI/CD secrets only
3. **DSN Security**: Use `NEXT_PUBLIC_SENTRY_DSN` carefully (client-exposed)
4. **Session Replay**: Review `maskAllText` settings for sensitive content

---

## Testing the Integration

### Manual Testing Checklist

```typescript
// Test error capture
throw new Error('Test Sentry integration');

// Test breadcrumb trail
logger.info('Step 1');
logger.info('Step 2');
throw new Error('Error after breadcrumbs');

// Test context propagation
RequestIdContext.run({ requestId: 'test-123' }, () => {
  throw new Error('Error with context');
});
```

### E2E Test Additions

```typescript
// __tests__/e2e/specs/sentry-integration.spec.ts
test('captures client error and sends to Sentry', async ({ page }) => {
  // Trigger an error
  await page.evaluate(() => {
    throw new Error('E2E test error');
  });

  // Verify Sentry received the error (via mock/stub)
  // ...
});
```

---

## Monitoring Dashboard

### Key Metrics to Track

1. **Error Rate**: Errors per 1000 requests
2. **Error Types**: Distribution by `errorCode`
3. **Response Time**: p50, p95, p99 for API routes
4. **User Impact**: Unique users affected by errors
5. **LLM Performance**: Token usage, response times
6. **Vector Search**: Query latency, result counts

### Sentry Dashboard Widgets

1. **Issue Stream**: Real-time error feed
2. **Release Health**: Error rate per deployment
3. **Performance**: Transaction duration trends
4. **User Feedback**: Submitted feedback reports

---

## Cost Estimation

| Feature | Free Tier | Team Tier ($26/mo) | Business ($80/mo) |
|---------|-----------|--------------------|--------------------|
| Errors | 5k/mo | 50k/mo | 100k/mo |
| Performance | Limited | Full | Full |
| Session Replay | 50/mo | 500/mo | 1500/mo |
| Attachments | 1GB | 10GB | 100GB |

**Recommendation**: Start with Team tier for production use.
