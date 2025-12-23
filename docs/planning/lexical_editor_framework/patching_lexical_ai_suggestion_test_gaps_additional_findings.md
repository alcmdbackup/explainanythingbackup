# Patching Lexical AI Suggestion Test Gaps - Additional Findings

## Date: December 22, 2024

## Overview

This document captures additional analysis and proposed solutions for the 20 skipped E2E tests documented in `patching_lexical_ai_suggestion_test_gaps_progress.md`.

---

## Root Cause Deep Dive

### Why RSC Wire Format Breaks Mocking

The 4 passing tests work because they only test **transient UI states**:
- Loading spinner appears → test passes before response needed
- Error state appears → mock returns error before RSC parsing
- Panel visibility → no server action invoked

The 20 skipped tests fail because they require **successful response parsing**:
- `waitForSuggestionsComplete()` waits for success indicator
- Diff nodes must render with actual content
- Accept/reject buttons need diffs to interact with

### Technical Details

**Current mock implementation** (`src/__tests__/e2e/helpers/api-mocks.ts`):
```typescript
await route.fulfill({
  status: 200,
  headers: { 'Content-Type': 'text/x-component' },
  body: JSON.stringify(response),  // Plain JSON
});
```

**What Next.js expects**:
- RSC wire format with type markers, reference IDs, special encoding for promises/streams
- Plain JSON causes "Connection closed" errors

**Reference**: https://github.com/vercel/next.js/discussions/49383

---

## Approaches Analyzed

| Approach | Summary | Complexity | Reliability | Recommendation |
|----------|---------|------------|-------------|----------------|
| **A: API Route Alternative** | Create `/api/runAISuggestionsPipeline` that calls same pipeline. Mock JSON instead of RSC. | Medium | High | **Recommended** |
| **B: Real Server Testing** | No mocking - run against real dev server with real AI calls. | Low | Low (flaky) | Not recommended |
| **C: Mock at AI Service Level** | Inject mocks at LLM layer via dependency injection. Server action runs naturally. | High | High | Viable but complex |
| **D: Expand Integration Tests** | Move tests to Jest + JSDOM. Skip E2E for these scenarios. | Medium | High | Good secondary option |
| **E: RSC Wire Format Encoder** | Implement proper RSC serialization for mocks (undocumented format). | Very High | Medium | Not recommended |
| **F: Hybrid Real Pipeline + AI Mock** | Environment flag enables mock mode in LLM service. Pipeline runs real, AI mocked. | High | High | Viable but adds test code to prod |

---

## Detailed Approach Analysis

### Approach A: API Route Alternative (Recommended)

**Implementation**:
1. Create `/src/app/api/runAISuggestionsPipeline/route.ts` wrapping same pipeline
2. Add env-based switch in `AISuggestionsPanel.tsx`
3. Mock new API route with standard JSON in E2E tests

**Pros**:
- Standard JSON mocking works
- Follows existing patterns (`/api/stream-chat/route.ts`)
- Clean separation: prod uses server action, tests use API route
- No undocumented formats

**Cons**:
- Code duplication (two paths to maintain)
- Runtime switch adds minor complexity

**Files to modify**:
- `src/app/api/runAISuggestionsPipeline/route.ts` (NEW)
- `src/components/AISuggestionsPanel.tsx`
- `src/__tests__/e2e/helpers/api-mocks.ts`
- `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts`

---

### Approach B: Real Server Testing

**Implementation**: Remove all mocks, run against real dev server with real AI calls.

**Pros**:
- Tests actual production behavior
- No mock maintenance

**Cons**:
- Slow (5-30s per AI call, 20 tests = 2-10 minutes minimum)
- Non-deterministic AI responses cause flakiness
- Expensive (API costs per test run)
- CI requires production API keys

---

### Approach C: Mock at AI Service Level

**Implementation**: Refactor `src/lib/services/llms.ts` for dependency injection. Server action runs naturally, only AI responses mocked.

**Pros**:
- RSC format works naturally
- Tests real pipeline logic

**Cons**:
- Requires DI refactoring
- Complex IPC: E2E server runs in different process than Playwright
- Hard to inject mocks across process boundary

---

### Approach D: Expand Integration Tests

**Implementation**: Move 20 tests to Jest integration layer using JSDOM + Lexical.

**Pros**:
- Uses existing integration infrastructure (`jest.integration.config.js`)
- OpenAI mocking already configured
- Fast, deterministic

**Cons**:
- Doesn't test real browser interactions
- Hover/click interactions on diffs untested
- Less confidence in actual UI behavior

---

### Approach E: RSC Wire Format Encoder

**Implementation**: Reverse-engineer and implement RSC serialization format.

**Pros**:
- No production code changes
- Tests actual server action flow

**Cons**:
- Format is undocumented and unstable
- High risk of breakage on Next.js updates
- Very complex implementation
- Not recommended by Next.js team

---

### Approach F: Hybrid Real Pipeline + AI Mock

**Implementation**: Environment variable enables mock mode in LLM service. Pipeline runs real, only external AI API mocked.

**Pros**:
- RSC works naturally
- Tests full flow minus AI
- Deterministic AI responses

**Cons**:
- Test mode flag in production code (code smell)
- Complex environment setup
- Risk of test mode leaking to production

---

## Recommended Solution

**Primary: Approach A (API Route Alternative)**

Best tradeoff of:
- Implementation complexity (medium)
- Test reliability (high)
- Maintenance burden (acceptable)
- Coverage quality (high - tests full UI flow)

**Secondary: Combine A + D**

For maximum coverage:
- API Route (A) for E2E tests → tests UI interactions
- Integration Tests (D) for pipeline logic → tests business logic

---

## Implementation Plan (Approach A)

### Phase 1: Create API Route

```typescript
// src/app/api/runAISuggestionsPipeline/route.ts
import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { currentContent, userPrompt, sessionData } = await request.json();
  const { getAndApplyAISuggestions } = await import('@/editorFiles/aiSuggestion');

  const result = await getAndApplyAISuggestions(currentContent, null, undefined, {
    ...sessionData,
    user_prompt: userPrompt
  });

  return NextResponse.json(result);
}
```

### Phase 2: Modify Component

```typescript
// src/components/AISuggestionsPanel.tsx
const useAPIRoute = process.env.NEXT_PUBLIC_USE_AI_API_ROUTE === 'true';

if (useAPIRoute) {
  const res = await fetch('/api/runAISuggestionsPipeline', {
    method: 'POST',
    body: JSON.stringify({ currentContent, userPrompt, sessionData })
  });
  result = await res.json();
} else {
  result = await runAISuggestionsPipelineAction(currentContent, userPrompt, sessionRequestData);
}
```

### Phase 3: Add API Mock

```typescript
// src/__tests__/e2e/helpers/api-mocks.ts
export async function mockAISuggestionsPipelineAPI(page: Page, options: MockOptions) {
  await page.route('**/api/runAISuggestionsPipeline', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, content: options.content }),
    });
  });
}
```

### Phase 4: Enable Tests

- Remove `.skip` from 20 tests
- Use `mockAISuggestionsPipelineAPI` instead of `mockAISuggestionsPipeline`
- Set `NEXT_PUBLIC_USE_AI_API_ROUTE=true` in E2E test environment

---

## Success Criteria

- [ ] All 24 E2E tests pass (4 existing + 20 previously skipped)
- [ ] No flaky tests
- [ ] Production code unchanged when `NEXT_PUBLIC_USE_AI_API_ROUTE` is not set
- [ ] CI passes

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/editorFiles/actions/actions.ts` | Server action: `runAISuggestionsPipelineAction` |
| `src/editorFiles/aiSuggestion.ts` | Pipeline: `getAndApplyAISuggestions` (4-step processing) |
| `src/components/AISuggestionsPanel.tsx` | UI component calling server action |
| `src/__tests__/e2e/specs/06-ai-suggestions/suggestions.spec.ts` | E2E tests (4 passing, 20 skipped) |
| `src/__tests__/e2e/helpers/api-mocks.ts` | Mock helpers |
