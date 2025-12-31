# Silent Error Swallowing - Research

## 1. Problem Statement
The codebase may contain instances where errors are caught but silently swallowed (no logging, no re-throwing, no user feedback). This makes debugging extremely difficult as errors can occur but leave no trace, leading to mysterious failures that only surface much later.

## 2. High Level Summary
A comprehensive audit of the codebase found **27 instances** of potentially problematic error handling:
- **6 HIGH severity** - Completely silent `.catch(() => {})` blocks
- **18 MEDIUM severity** - Logged but fire-and-forget, or return null/false masking errors
- **3 LOW severity** - Intentional but needs documentation

Key finding: 22 of 27 issues are in E2E test code, not production code. The production code has excellent error handling infrastructure with centralized error handler, Sentry integration, and OTLP/Grafana tracing.

## 3. Documents Read
- `/docs/docs_overall/getting_started.md`
- `/docs/docs_overall/start_project.md`
- `/Users/abel/.claude/plans/logical-humming-trinket.md` (initial exploration plan)

## 4. Code Files Read

### Error Handling Infrastructure (Good Examples)
- `src/lib/errorHandling.ts` - Centralized error categorization with 13 error codes
- `src/lib/server_utilities.ts` - Server logging with OTLP integration
- `src/lib/requestIdContext.ts` - Request context propagation
- `src/app/global-error.tsx` - Global React error boundary
- `sentry.client.config.ts` / `sentry.server.config.ts` - Sentry configuration

### HIGH Severity - Silent Error Swallowing
| File | Line | Pattern |
|------|------|---------|
| `src/lib/sessionId.ts` | 136 | `.catch(() => { })` |
| `src/__tests__/e2e/helpers/wait-utils.ts` | 61 | `.catch(() => {})` |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | 434, 449 | `.catch(() => {})` |
| `src/__tests__/e2e/specs/01-auth/auth.spec.ts` | 70 | `.catch(() => {})` |
| `src/__tests__/e2e/specs/05-edge-cases/errors.spec.ts` | 76 | `.catch(() => {})` |
| `src/__tests__/e2e/specs/06-import/import-articles.spec.ts` | 208 | `.catch(() => {})` |

### MEDIUM Severity - Logged But Fire-and-Forget
| File | Line(s) | Pattern |
|------|---------|---------|
| `src/lib/services/metrics.ts` | 72 | `.catch(err => logger.error)` |
| `src/lib/services/userLibrary.ts` | 41 | `.catch(err => logger.error)` |
| `src/components/AISuggestionsPanel.tsx` | 229 | `.catch(err => console.error)` |
| `src/__tests__/e2e/helpers/pages/UserLibraryPage.ts` | 62, 102, 103 | `.catch(() => null)` |
| `src/__tests__/e2e/helpers/pages/ResultsPage.ts` | 209, 213 | `.catch(() => false/null)` |
| `src/__tests__/e2e/helpers/pages/SearchPage.ts` | 76 | `.catch(() => false)` |
| `src/__tests__/e2e/specs/03-library/library.spec.ts` | multiple | `.catch(() => false)` |

### LOW Severity - Intentional But Needs Documentation
| File | Line | Pattern |
|------|------|---------|
| `src/lib/logging/client/remoteFlusher.ts` | 127 | `console.debug` (appropriate) |
| `src/lib/logging/client/consoleInterceptor.ts` | 145-146 | `/* ignore */` |
| `src/lib/sessionId.ts` | 48-50 | Fallback return |
