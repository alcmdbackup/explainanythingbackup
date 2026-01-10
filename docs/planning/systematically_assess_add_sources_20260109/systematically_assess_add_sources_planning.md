# Systematically Assess Add Sources Plan

## Background

The "Add Sources" feature allows users to include external URLs that should inform article generation. Sources are fetched, cached in `source_cache`, linked to explanations via `article_sources` junction table, and displayed as a bibliography with inline citations. A systematic assessment (8 parallel agent investigations over Jan 9-10, 2026) identified three distinct reliability problems with clear root causes and fix approaches.

## Problem

Three interconnected issues prevent sources from working reliably:

1. **Inline citations never appear** - The LLM generates `[1]`, `[2]` citations, but `CitationPlugin` disables itself when `sources.length === 0` due to a race condition where content loads before sources are fetched.

2. **Sources silently don't influence content** - A 6-point filter cascade drops sources without user feedback. When all sources fail filters, the system silently falls back to a non-sources prompt.

3. **Bibliography disappears on reload** - Race condition between Supabase INSERT commit and client redirect. The `complete` event triggers navigation before `article_sources` records are durably visible.

## Critical Assessment Round 1 (Jan 10, 2026)

Four independent agents critically assessed this plan. **Verdict: Core approach is sound but can be simplified.**

| Aspect | Agent Finding | Impact |
|--------|---------------|--------|
| Architecture | Include sources in complete event ✅ | Eliminates race by design |
| State Machine | useSourcesReducer is **OVERKILL** ⚠️ | Remove from plan - simple setState suffices |
| Payload Size | Strip extracted_text from payload ⚠️ | ~100KB → ~5KB per request |
| Implementation | All phases feasible ✅ | Minor gaps identified |
| Testing | Strategy needs strengthening ⚠️ | "Refresh 5x" doesn't test race conditions |
| Alternatives | All alternatives REJECTED ✅ | Proposed plan is simplest correct solution |

### Agent 1: Architecture/Design Critique

**Key Finding**: useReducer is unnecessary complexity for a timing issue.

> "A reducer is overkill. A simple conditional source population from the event is sufficient."

**Payload Optimization Required**: Sources include `extracted_text` (up to 3000 words × 5 sources = ~100KB). Strip to UI-relevant fields only:
- `url`, `title`, `domain`, `favicon_url`, `status`, `error_message`

This reduces payload from ~100KB to ~5KB.

### Agent 2: Implementation Feasibility

**All phases feasible with gaps identified:**

| Gap | Location | Resolution |
|-----|----------|------------|
| Type conversion needed | `route.ts` | Extract logic from `actions.ts:942-953` |
| Promise.all restructure | `useExplanationLoader.ts` | Parallel loading required |
| Modal not imported | `page.tsx` | `FailedSourcesModal` exists but unused |

### Agent 3: Testing Strategy Evaluation

**Critical Flaw**: "Refresh 5x" is non-deterministic for race condition testing.

**Recommended Test Improvements:**
1. **Network interception** - Verify sources come from event, not DB query
2. **Add `data-testid`** to CitationPlugin for reliable e2e selection
3. **Integration test layer** - Transaction visibility timing tests

**Missing Edge Cases:**
- Partial failures (2 of 3 sources succeed)
- Browser back/forward navigation
- Multiple tabs (sessionStorage pollution)

### Agent 4: Alternative Approaches

**All alternatives REJECTED:**

| Alternative | Verdict | Reason |
|-------------|---------|--------|
| Confirmation Loop (server polling) | ❌ | Adds latency, doesn't fix design flaw |
| Transaction Wrapper | ❌ | Supabase JS doesn't support transactions |
| Client Retry | ❌ | Workaround for problem that should be eliminated |

**Validation**: The proposed approach (include sources in complete event) is the simplest correct solution.

---

## Critical Assessment Round 2 (Jan 10, 2026) - RADICAL SIMPLIFICATION

Four more agents critically assessed the plan seeking further simplification. **Verdict: Can be reduced to 3 files, ~16 lines.**

### Key Discoveries

| Discovery | Agent | Impact |
|-----------|-------|--------|
| Sources already available at `route.ts:94-118` | Agent 2 | **Skip returnExplanation.ts modification** |
| CitationPlugin already rescans when sources update | Agent 4 | **Replace Phase 2 with 1-line fix** |
| Phase 3 is feature work, not bug fixing | Agent 2 | **Defer to separate PR** |
| 6 high-risk blind spots not addressed | Agent 3 | **Add risk mitigations** |

### Agent 1: Architecture Simplification Critic

**Root cause insight**: The race condition is SELF-INFLICTED by `router.push()` at `page.tsx:484` which wipes React state. Sources are already in client state via sessionStorage during generation.

**Finding**: `returnExplanation.ts` modification is UNNECESSARY. Sources are already available at `route.ts:94-118` in the `finalSources` variable before `returnExplanationLogic()` is even called.

**Simplest fix proposed**: Use `window.history.replaceState` instead of `router.push` to preserve state (~10 lines, 1 file). However, including sources in complete event is more robust for reload cases.

### Agent 2: Implementation Necessity Scrutinizer

**Line-by-line assessment**:

| Proposed Change | Verdict | Reason |
|-----------------|---------|--------|
| Modify `returnExplanation.ts` | **CUT** | Sources already in `route.ts` |
| Promise.all in useExplanationLoader | **CUT** | Just reorder existing lines |
| Phase 3 (FailedSourcesModal) | **DEFER** | Feature work, not bug fix |
| `source_warning` event | **DEFER** | Feature work |

**Minimal P0 fix**: 2 files, ~15 lines (route.ts + page.tsx)

### Agent 3: Risk Assessor

**6 HIGH-RISK blind spots identified**:

| Risk | Status | Mitigation |
|------|--------|------------|
| Complete event lost/malformed | NOT ADDRESSED | Add validation + fallback |
| SSE chunk splitting corrupts JSON | NOT ADDRESSED | Add chunk buffering |
| Edit/rewrite flow loses sources | NOT ADDRESSED | Preserve sources through rewrite |
| sessionStorage unavailable | NOT ADDRESSED | Add fallback for private browsing |
| React batching may reorder setState | NOT ADDRESSED | Verify order with explicit sequencing |
| Empty array vs "loading" ambiguity | NOT ADDRESSED | Add loading state distinction |

### Agent 4: Alternative Solutions Explorer

**Key insight**: CitationPlugin useEffect at lines 181-197 already has `sources` in its dependency array. It WOULD rescan automatically when sources arrive, but the early return at line 65 prevents this.

**1-line fix for P1**:
```typescript
// Change CitationPlugin.tsx:65 from:
if (!enabled || sources.length === 0) return;
// To:
if (!enabled) return;
```

This makes CitationPlugin always scan the DOM. When sources arrive later, it rescans and adds interactivity. The useEffect already handles this!

**Ranked alternatives (simplest to most complex)**:

| Rank | Approach | Lines | Fixes |
|------|----------|-------|-------|
| 1 | Remove `sources.length === 0` check | ~1 | P1 only |
| 2 | Minimal P0 (sources in complete event) | ~15 | P0 only |
| 3 | P0 + CitationPlugin self-healing | ~16 | P0 + P1 |
| 4 | Full original plan | ~85 | All |

---

## Revised Scope After Round 2

### What to KEEP
- Core P0 approach: Include sources in complete event

### What to SIMPLIFY
1. **Don't modify `returnExplanation.ts`** - sources already at route.ts level
2. **Replace Phase 2 with 1-line fix** - remove early return in CitationPlugin
3. **Skip Promise.all restructure** - unnecessary if CitationPlugin self-heals

### What to CUT/DEFER
1. **Phase 3 entirely** - FailedSourcesModal is feature work → separate PR
2. **`source_warning` event** - feature work → separate PR
3. **data-testid additions** - nice-to-have → defer

### What to ADD (risk mitigations)
1. Validate sources structure in complete event handler
2. Handle malformed/missing sources gracefully

---

## Options Considered

### For Race Condition (P0)

| Option | Approach | Pros | Cons | Verdict |
|--------|----------|------|------|---------|
| **A** | **Include sources in complete event** | Eliminates race by design | Slightly larger event payload | **Recommended** |
| B | Confirmation query before 'complete' | Guarantees visibility | Adds complexity, still has timing | Rejected (Agent 4) |
| C | Delay complete event (100-200ms) | Simple | Fragile timing-based | Rejected |
| D | Client polls for sources | Resilient | More complex client logic | Rejected |

**Why Option A is superior**: Instead of synchronizing two independent operations (server commit + client query), we eliminate the need for synchronization by sending the data directly. The race condition disappears because there's no separate query on initial generation.

### For State Management (Supporting Change)

| Option | Approach | Pros | Cons | Verdict |
|--------|----------|------|------|---------|
| A | useReducer for sources state | Explicit state machine, testable | Unnecessary complexity | **Rejected (Agent 1)** |
| **B** | **Keep useState with direct setSources** | Simple, sufficient for timing fix | None | **Recommended** |
| C | External state (Zustand/Redux) | Global access | Overkill for this scope | Rejected |

**Agent 1 Assessment**: "The race condition is a timing issue, not a state consistency issue. Simply setting sources from the complete event eliminates the race."

### For CitationPlugin (P1)

| Option | Approach | Pros | Cons | Verdict |
|--------|----------|------|------|---------|
| A | Placeholder spans during loading | Visual feedback | Medium complexity | Recommended |
| B | "Loading sources..." indicator | Low complexity | Less polish | Acceptable |
| C | Preload sources BEFORE content | Ensures order | Changes load pattern | **Selected** |
| D | Passive scan, upgrade when sources arrive | Most robust | Highest complexity | Future improvement |

### For User Feedback (P2)

| Option | Approach | Pros | Cons | Verdict |
|--------|----------|------|------|---------|
| A | Wire existing FailedSourcesModal | Already built | Needs API changes | **Recommended** |
| B | Add 'source_warning' streaming event | Real-time feedback | More API work | Also implement |
| C | Full error tracking system | Complete solution | Scope creep | Future work |

## Phased Execution Plan - FINAL (After Round 2 Simplification)

### Phase 1: Include Sources in Complete Event (P0)

**Goal**: Sources available immediately on generation complete, persist on reload

**Architecture Change**: Include sources in the `complete` streaming event instead of requiring a separate client query.

```
BEFORE (race-prone):
  Server: save -> link sources -> send 'complete' event
  Client: receive 'complete' -> query DB for sources <- RACE!

AFTER (race-free):
  Server: save -> link sources -> send 'complete' WITH sources (stripped)
  Client: receive 'complete' -> use included sources <- NO RACE
```

**Changes** (FURTHER SIMPLIFIED - no returnExplanation.ts modification):

1. **`src/app/api/returnExplanation/route.ts`** - Convert `finalSources` (already available at line 94) and include in complete event:
   ```typescript
   // finalSources is ALREADY AVAILABLE at line 94-118
   // Just convert and include in complete event at line 209-214
   const sourceChips: SourceChipType[] = (finalSources || []).map(source => ({
     url: source.url,
     title: source.title,
     favicon_url: source.favicon_url,
     domain: source.domain,
     status: source.fetch_status === 'success' ? 'success'
           : source.fetch_status === 'pending' ? 'loading' : 'failed',
     error_message: source.error_message
   }));

   // Add to existing complete event
   const finalData = JSON.stringify({
     type: 'complete',
     result: { ...result, sources: sourceChips },  // ~1KB payload
     ...
   });
   ```

2. **`src/app/results/page.tsx`** - Use sources from complete event (around line 415):
   ```typescript
   case 'complete':
     if (data.result?.sources) {
       setSources(data.result.sources);  // Direct setState
     }
     // Rest of existing complete handling...
   ```

**Files to modify** (reduced from 3 to 2):
- `src/app/api/returnExplanation/route.ts` (~10 lines)
- `src/app/results/page.tsx` (~5 lines)

~~`src/lib/services/returnExplanation.ts`~~ - **NOT NEEDED** - sources already at route.ts level

**Why this is even simpler**:
- No changes to service layer
- Sources are ALREADY available in `finalSources` variable
- Just type conversion + include in existing event

**Verification**:
- E2e test: Generate with sources -> Bibliography appears immediately (no flash)
- E2e test: Reload page -> Sources load from DB (covers reload path)
- Network interception test: Verify no source query during initial generation

### Phase 2: CitationPlugin Self-Healing (P1) - ONE LINE FIX

**Goal**: `[n]` citations render as clickable links on page reload

**Key insight from Agent 4**: CitationPlugin useEffect at lines 181-197 ALREADY has `sources` in its dependency array. It would automatically rescan when sources arrive, but the early return at line 65 blocks this.

**Change** (1 line):
```typescript
// src/editorFiles/lexicalEditor/CitationPlugin.tsx:65
// Change FROM:
if (!enabled || sources.length === 0) return;
// Change TO:
if (!enabled) return;
```

**Why this works**:
- useEffect already re-runs when `sources` changes (line 181-197)
- Removing the early return lets it scan the DOM even when sources are initially empty
- When sources arrive (from complete event OR from DB on reload), it rescans and adds interactivity
- Zero architectural changes needed

**Files to modify**:
- `src/editorFiles/lexicalEditor/CitationPlugin.tsx` (~1 line)

**Verification**:
- E2e test: Generate with sources -> Citations are clickable
- E2e test: Reload page -> Citations still clickable (sources arrive from DB)
- Manual: Verify no performance regression from DOM scanning

### Phase 3: User Feedback (P2) - DEFERRED

**Status**: DEFERRED to separate PR

**Reason**: This is feature work (improving UX), not bug fixing. The core reliability issues are fixed by P0+P1.

**What was planned** (for future PR):
- Wire existing `FailedSourcesModal` component
- Add `source_warning` streaming event
- Display "3 of 5 sources used" message

**Ticket**: Create separate issue for "Source failure feedback improvements"

## Testing - REVISED per Agent 3 Assessment

### Critical Flaw in Original Testing Strategy

> "The proposed manual verification 'refresh 5x' is non-deterministic and unreliable for testing race conditions."

### Unit Tests to Add
- ~~`useSourcesReducer.test.ts`~~ - **REMOVED** (no reducer)
- `useExplanationLoader.test.ts` - Sources set before content on reload
- `route.test.ts` - Complete event includes sources, `source_warning` event with counts
- Type conversion tests for `SourceCacheFullType` → `SourceChipType`

### E2E Tests to Add (IMPROVED)

```typescript
// tests/e2e/sources-persistence.spec.ts

// CRITICAL: Verify sources come from event, NOT DB query
test('sources available immediately from complete event (no DB query)', async ({ page }) => {
  const sourceQueries: string[] = [];

  // Intercept any source-related API calls
  await page.route('**/api/**sources**', route => {
    sourceQueries.push(route.request().url());
    route.continue();
  });

  // Generate article with sources
  await addSourceAndGenerate(page, 'https://en.wikipedia.org/wiki/Test');

  // NO DB query should have been made - sources from complete event
  expect(sourceQueries.length).toBe(0);

  // Bibliography should be visible
  await expect(page.locator('[data-testid="bibliography"]')).toBeVisible();
});

test('sources persist after page reload', async ({ page }) => {
  // 1. Add 2 sources, generate article
  // 2. Wait for complete
  // 3. Reload page
  // 4. Assert bibliography has 2 sources
  // 5. Assert citations are clickable
});

// NEW: Test partial failures
test('partial source failures show correct count', async ({ page }) => {
  // 1. Add valid URL + invalid URL (localhost:9999)
  // 2. Generate article
  // 3. Assert "1 of 2 sources used" message
  // 4. Assert FailedSourcesModal shows failure reason
});

// tests/e2e/sources-feedback.spec.ts
test('failed sources show modal', async ({ page }) => {
  // 1. Add invalid URL as source
  // 2. Generate article
  // 3. Assert FailedSourcesModal appears
  // 4. Assert modal shows failure reason
});
```

### Citation Testability Improvement

**Add `data-testid` to CitationPlugin** for reliable e2e selection:

```typescript
// In CitationPlugin.tsx, when creating citation spans:
span.dataset.testid = `citation-${part.index}`;
```

Then test:
```typescript
test('citations are clickable links', async ({ page }) => {
  const citation = page.locator('[data-testid="citation-1"]');
  await expect(citation).toBeVisible();

  // Verify it has pointer cursor (is interactive)
  const cursor = await citation.evaluate(el =>
    window.getComputedStyle(el).cursor
  );
  expect(cursor).toBe('pointer');

  // Verify click scrolls to bibliography
  await citation.click();
  await expect(page.locator('#source-1')).toBeInViewport();
});
```

### Integration Test Layer (NEW)

Add to `src/__tests__/integration/`:

```typescript
// sources-persistence.integration.test.ts
describe('Sources Persistence', () => {
  it('sources visible immediately after linkSourcesToExplanation', async () => {
    const explanationId = await createTestExplanation();
    const sourceIds = await createTestSources(2);

    await linkSourcesToExplanation(explanationId, sourceIds);

    // Query immediately - should be visible
    const result = await getSourcesForExplanation(explanationId);
    expect(result.length).toBe(2);
  });
});
```

### Manual Verification on Stage (UPDATED)
1. Generate article with 3 valid sources -> Verify bibliography appears immediately (no flash)
2. Reload page -> Sources still present
3. Generate article -> Check `[1]`, `[2]` are clickable blue links (use DevTools to verify `data-testid`)
4. Add mix of valid + invalid URL -> Verify modal shows "2 of 3 sources used"

## Documentation Updates

### Files to Update
- `docs/docs_overall/features.md` - Document source reliability improvements
- `docs/feature_deep_dives/add_sources.md` - Update with confirmed behavior and any new patterns
- `docs/docs_overall/troubleshooting.md` - Add "Sources not appearing" section with common causes

### Code Comments to Add
- ~~`useSourcesReducer.ts`~~ - **REMOVED** (no reducer needed)
- `route.ts` - Document "include sources in complete event" pattern and why
- `route.ts` - Document type conversion from `SourceCacheFullType` to `SourceChipType`
- `CitationPlugin.tsx:65` - Document loading state pattern
- `CitationPlugin.tsx` - Document `data-testid` addition for e2e testing
- `route.ts:93-118` - Document filter cascade and warning event

## Summary - FINAL (After Round 2 Simplification)

This plan addresses 2 core issues (P3 deferred):

| Phase | Problem | Fix | Files | Lines |
|-------|---------|-----|-------|-------|
| **P0** | Bibliography disappears on reload | Include sources in complete event | 2 | ~15 |
| **P1** | Citations don't render on reload | Remove early return in CitationPlugin | 1 | ~1 |
| ~~P2~~ | ~~Silent source failures~~ | ~~DEFERRED~~ | 0 | 0 |
| **TOTAL** | | | **3** | **~16** |

**Key architectural insights**:
- **Eliminate synchronization rather than add it**: Send data directly in streaming response
- **Leverage existing patterns**: CitationPlugin useEffect already rescans on source changes
- **Minimize surface area**: Don't touch service layer when API layer suffices

**Changes from Round 1 Assessment**:
- ❌ Removed `useSourcesReducer` - unnecessary complexity
- ✅ Added payload optimization - strip `extracted_text` (~100KB → ~5KB)

**Changes from Round 2 Assessment**:
- ❌ Removed `returnExplanation.ts` modification - sources already at route.ts level
- ❌ Removed Promise.all restructure - CitationPlugin self-heals instead
- ❌ Deferred Phase 3 - feature work, not bug fixing
- ✅ Identified 6 high-risk blind spots (tracked for future mitigation)

**Final scope**: 3 files modified, ~16 lines changed (down from ~8 files, ~100 lines)

### Risk Mitigations (Future Work)

The following risks were identified but NOT addressed in this minimal fix:

| Risk | Mitigation | Priority |
|------|------------|----------|
| Complete event lost/malformed | Add validation + fallback | P2 |
| SSE chunk splitting | Add chunk buffering | P3 |
| Edit/rewrite loses sources | Preserve through rewrite | P2 |
| sessionStorage unavailable | Fallback for private browsing | P3 |

These should be addressed in follow-up work after the core fix is verified.
