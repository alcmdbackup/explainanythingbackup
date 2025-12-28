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

## Phase 3: Logging Integration

### 3.1 Create Sentry Breadcrumb Logger

**`src/lib/logging/sentryBreadcrumbs.ts`**
```typescript
import * as Sentry from "@sentry/nextjs";

export function addBreadcrumb(
  category: string,
  message: string,
  data?: Record<string, any>,
  level: Sentry.SeverityLevel = 'info'
) {
  Sentry.addBreadcrumb({
    category,
    message,
    data,
    level,
    timestamp: Date.now() / 1000,
  });
}

// Specific breadcrumb helpers
export const breadcrumbs = {
  navigation: (from: string, to: string) =>
    addBreadcrumb('navigation', `${from} → ${to}`, { from, to }),

  userAction: (action: string, data?: Record<string, any>) =>
    addBreadcrumb('user', action, data),

  apiCall: (endpoint: string, method: string, status?: number) =>
    addBreadcrumb('http', `${method} ${endpoint}`, { status }),

  stateChange: (description: string, data?: Record<string, any>) =>
    addBreadcrumb('state', description, data),

  llmCall: (model: string, prompt: string, tokens?: number) =>
    addBreadcrumb('ai', `LLM: ${model}`, {
      promptLength: prompt.length,
      tokens
    }),
};
```

### 3.2 Enhance `withLogging` Wrapper

Modify `automaticServerLoggingBase.ts` to add Sentry breadcrumbs:

```typescript
// In the withLogging function, add:
import { breadcrumbs } from './sentryBreadcrumbs';

export function withLogging<T extends (...args: any[]) => any>(
  fn: T,
  functionName: string,
  config: Partial<LogConfig> = {}
): T {
  return (async (...args: Parameters<T>) => {
    const startTime = performance.now();

    // Add breadcrumb for function call
    breadcrumbs.apiCall(functionName, 'CALL');

    try {
      const result = await fn(...args);
      const duration = performance.now() - startTime;

      // Add success breadcrumb
      breadcrumbs.stateChange(`${functionName} completed`, {
        duration: `${duration.toFixed(2)}ms`
      });

      return result;
    } catch (error) {
      const duration = performance.now() - startTime;

      // Add error breadcrumb before Sentry captures
      breadcrumbs.stateChange(`${functionName} failed`, {
        duration: `${duration.toFixed(2)}ms`,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw error;
    }
  }) as T;
}
```

### 3.3 Server Log Attachment

For capturing the `server.log` file on errors:

```typescript
// src/lib/logging/sentryLogAttachment.ts
import * as Sentry from "@sentry/nextjs";
import * as fs from 'fs';

export async function attachRecentLogs(eventId: string) {
  try {
    const logPath = process.cwd() + '/server.log';
    const logContent = await fs.promises.readFile(logPath, 'utf8');

    // Get last 100 lines
    const lines = logContent.split('\n');
    const recentLogs = lines.slice(-100).join('\n');

    Sentry.withScope((scope) => {
      scope.addAttachment({
        filename: 'server-logs.txt',
        data: recentLogs,
      });
    });
  } catch (error) {
    console.warn('Could not attach server logs:', error);
  }
}
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
- [ ] Add environment variables
- [ ] Verify source map uploads work

### Phase 2: Error Handling
- [ ] Enhance `handleError()` with Sentry reporting
- [ ] Create `SentryErrorBoundary` component
- [ ] Wrap root layout with error boundary
- [ ] Test error capture in development

### Phase 3: Logging Integration
- [ ] Create breadcrumb helpers
- [ ] Enhance `withLogging` wrapper
- [ ] Add server log attachment on errors
- [ ] Verify breadcrumb trail in Sentry

### Phase 4: Request Context
- [ ] Integrate RequestIdContext with Sentry
- [ ] Add Sentry context to API routes
- [ ] Verify request correlation in Sentry

### Phase 5: OpenTelemetry Bridge
- [ ] Configure OTEL-Sentry integration
- [ ] Link trace IDs between systems
- [ ] Verify traces appear in both Grafana and Sentry

### Phase 6: Issue Creation
- [ ] Configure GitHub integration in Sentry
- [ ] Set up alert rules for issue creation
- [ ] Create issue template
- [ ] Test end-to-end: error → GitHub issue

### Phase 7: Advanced Features
- [ ] Add performance monitoring wrappers
- [ ] Implement feedback widget
- [ ] Set up custom metrics
- [ ] Create monitoring dashboard

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
