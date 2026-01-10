# Try-Catch Enforcement Research

## Problem Statement

The codebase has solid logging infrastructure (`withLogging` wrapper, `logger` utilities, RequestIdContext) but it's severely underutilized. Silent failures in service layer functions make debugging difficult, and lack of structured logging reduces observability.

## High Level Summary

### Error Handling Infrastructure (Strong Foundation)
- `src/lib/errorHandling.ts` provides 20+ error codes, Sentry integration, and `categorizeError()` utility
- Actions layer (`src/actions/actions.ts`) consistently uses `handleError()` with proper try-catch
- Integration tests exist for error handling patterns

### Logging Infrastructure (Underutilized)
- `withLogging` wrapper exists in `src/lib/logging/server/automaticServerLoggingBase.ts`
- Only **1 of 18 services** (`returnExplanation.ts`) uses `withLogging`
- `logger.debug/info/warn/error` utilities exist but some places still use `console.log`

### Silent Failure Patterns Found
| File | Function | Line | Pattern |
|------|----------|------|---------|
| `llms.ts` | `saveLlmCallTracking` | 63 | Catches error, logs, but doesn't throw |
| `metrics.ts` | `createUserExplanationEvent` | 70-81 | Uses `.catch()` fire-and-forget |
| `userLibrary.ts` | `saveExplanationToLibrary` | 40-48 | Uses `.catch()` fire-and-forget |
| `returnExplanation.ts` | `applyTagsToExplanation` | 351-416 | Logs error but continues |
| `returnExplanation.ts` | `extractLinkCandidates` | 116-122 | Returns `[]` on error |
| `returnExplanation.ts` | `generateAndSaveExplanationSummary` | 650-662 | Fire-and-forget with `.catch()` |
| `links.ts` | `createMappingsHeadingsToLinks` | 148-156 | Returns `{}` on error |

### Services Needing withLogging (17 files)
All services in `src/lib/services/` except `returnExplanation.ts`:
- explanations.ts, topics.ts, tags.ts, explanationTags.ts
- userQueries.ts, userLibrary.ts, metrics.ts
- llms.ts, vectorsim.ts, findMatches.ts, links.ts
- linkWhitelist.ts, linkResolver.ts, linkCandidates.ts
- sourceCache.ts, sourceFetcher.ts, importArticle.ts, testingPipeline.ts

## Documents Read
- `docs/docs_overall/architecture.md` - Core patterns, action wrapping, schema-first development
- `docs/docs_overall/project_workflow.md` - Workflow steps and plan template
- `docs/docs_overall/getting_started.md` - Documentation structure

## Code Files Read

### Logging Infrastructure
- `src/lib/logging/server/automaticServerLoggingBase.ts` - `withLogging` wrapper implementation
- `src/lib/server_utilities.ts` - Server-side logger (debug, info, warn, error)
- `src/lib/client_utilities.ts` - Client-side logger
- `src/lib/requestIdContext.ts` - Request ID propagation via AsyncLocalStorage

### Error Handling
- `src/lib/errorHandling.ts` - Error codes, categorization, Sentry integration
- `src/__tests__/integration/error-handling.integration.test.ts` - Error handling tests

### Services Analyzed (sample)
- `src/lib/services/llms.ts` - LLM call tracking with silent failure (line 63)
- `src/lib/services/metrics.ts` - Fire-and-forget metrics updates
- `src/lib/services/userLibrary.ts` - Fire-and-forget save metrics
- `src/lib/services/returnExplanation.ts` - Only service using withLogging
- `src/lib/services/explanations.ts` - Core CRUD, no withLogging
- `src/lib/services/links.ts` - Returns empty on failure

### Actions Layer
- `src/actions/actions.ts` - 50+ server actions, all use withLogging pattern correctly
