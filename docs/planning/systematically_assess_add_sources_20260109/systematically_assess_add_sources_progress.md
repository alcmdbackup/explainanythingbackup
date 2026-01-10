# Systematically Assess Add Sources Progress

## Phase 1: Research & Root Cause Analysis
### Work Done
- Ran 4 parallel explore agents to investigate the 3 reported problems
- **Agent 1**: Traced citation rendering from LLM → markdown → CitationPlugin
- **Agent 2**: Mapped complete source filter cascade (6 filter points)
- **Agent 3**: Analyzed race condition timing between INSERT and client query
- **Agent 4**: Verified LLM prompt construction and source interpolation

### Key Findings
| Problem | Root Cause | Confirmed |
|---------|------------|-----------|
| Inline citations missing | CitationPlugin disabled when `sources.length === 0` | ✅ |
| Sources not influencing | Silent filter cascade with no user feedback | ✅ |
| Bibliography disappears | Transaction isolation race condition | ✅ |

### Issues Encountered
- Initial hypothesis that markdown stripping citations was **disproven**
- Initial hypothesis that `await` was missing was **corrected** - await IS present but race still occurs due to transaction isolation

### User Clarifications
None needed for research phase.

---

## Phase 1.5: Deep Dive Research (Completed Jan 10, 2026)
### Work Done
- Ran 4 parallel explore agents for deeper investigation:
- **Agent 1**: Found LLM citation verification methods (llmCallTracking table + FILE_DEBUG logging)
- **Agent 2**: Mapped streaming architecture and identified 5 race condition fix options
- **Agent 3**: Found FailedSourcesModal EXISTS but NOT WIRED IN, mapped 6 filter points
- **Agent 4**: Discovered timing issue where content loads BEFORE sources

### Key Discoveries
| Discovery | Impact |
|-----------|--------|
| `llmCallTracking.content` stores raw LLM output | Can query to verify citations generated |
| Race exists despite `await` (transaction isolation) | Need confirmation query or polling |
| `FailedSourcesModal` built but unused | Low-effort win for user feedback |
| CitationPlugin disables permanently on empty sources | Need passive scanning pattern |

---

## Phase 2: Planning (Completed Jan 10, 2026)
### Proposed Fix Priorities
1. **P0: Bibliography race condition** (🔴 HIGH) - Include sources in complete event (eliminates race by design)
2. **P1: CitationPlugin loading state** (🔴 HIGH) - Reorder loads in useExplanationLoader
3. **P2: Silent filter cascade** (🟡 MEDIUM) - Wire FailedSourcesModal + API warnings

### Pending Decisions
- [x] Need to verify LLM actually generates citations → **RESOLVED**: Query `llmCallTracking` table
- [x] Which fix to tackle first? → **DECIDED**: P0 (race condition) first
- [x] Should fixes be incremental or combined? → **DECIDED**: Incremental (3 phases)

---

## Phase 2.5: Critical Assessment (Completed Jan 10, 2026)

### Work Done
- Ran 4 parallel Plan agents to critically assess the implementation plan:
- **Agent 1 (Architecture)**: Reviewed design decisions, payload size, state management
- **Agent 2 (Feasibility)**: Checked type compatibility, implementation gaps
- **Agent 3 (Testing)**: Evaluated test strategy, identified missing edge cases
- **Agent 4 (Alternatives)**: Explored simpler approaches, validated recommended solution

### Key Findings

| Aspect | Agent Finding | Action |
|--------|---------------|--------|
| State Machine | `useSourcesReducer` is OVERKILL | **REMOVED** from plan |
| Payload Size | ~100KB with full `extracted_text` | **ADD** type conversion to strip |
| Testing | "Refresh 5x" is non-deterministic | **ADD** network interception tests |
| Alternatives | All rejected (transactions unsupported, polling wrong approach) | **KEEP** proposed solution |
| Feasibility | All phases implementable | **PROCEED** with minor gaps addressed |

### Plan Revisions Made
1. ❌ Removed `useSourcesReducer` - simple `setSources()` suffices
2. ✅ Added payload optimization - convert `SourceCacheFullType` → `SourceChipType`
3. ✅ Added type conversion step in `route.ts`
4. ✅ Improved testing - network interception to verify sources from event not DB
5. ✅ Added `data-testid` to CitationPlugin for reliable e2e testing
6. ✅ Added integration test layer for transaction visibility

### Scope Change
- **Before**: ~8 files, ~100 lines
- **After**: ~6 files, ~85 lines

---

## Phase 2.6: Critical Assessment Round 2 (Completed Jan 10, 2026)

### Work Done
- Ran 4 parallel Plan agents seeking RADICAL simplification:
- **Agent 1 (Architecture Simplification)**: Found sources already at route.ts level, returnExplanation.ts modification unnecessary
- **Agent 2 (Implementation Scrutiny)**: Line-by-line assessment of what's truly necessary
- **Agent 3 (Risk Assessment)**: Identified 6 high-risk blind spots not addressed
- **Agent 4 (Alternative Solutions)**: Found CitationPlugin already has self-healing pattern blocked by early return

### Key Discoveries

| Discovery | Agent | Impact |
|-----------|-------|--------|
| Sources already at `route.ts:94-118` | Agent 1, 2 | **Skip returnExplanation.ts modification** |
| CitationPlugin useEffect already rescans | Agent 4 | **1-line fix replaces Promise.all restructure** |
| Phase 3 is feature work, not bug fix | Agent 2 | **Defer to separate PR** |
| 6 high-risk blind spots unaddressed | Agent 3 | **Track for future mitigation** |

### Agent 1: Architecture Simplification Critic

**Root cause insight**: Race condition is SELF-INFLICTED by `router.push()` at `page.tsx:484` which wipes React state. Sources are already in client state via sessionStorage.

**Key finding**: `finalSources` variable at `route.ts:94-118` already contains sources BEFORE `returnExplanationLogic()` is called. No need to modify the service layer.

### Agent 2: Implementation Necessity Scrutinizer

**Verdict**: Only 2 files needed for P0 (not 3)

| Proposed Change | Verdict | Reason |
|-----------------|---------|--------|
| Modify `returnExplanation.ts` | **CUT** | Sources already at route.ts |
| Promise.all in useExplanationLoader | **CUT** | CitationPlugin self-heals |
| Phase 3 (FailedSourcesModal) | **DEFER** | Feature work |

### Agent 3: Risk Assessor

**6 HIGH-RISK blind spots identified**:

| Risk | Status |
|------|--------|
| Complete event lost/malformed | NOT ADDRESSED |
| SSE chunk splitting corrupts JSON | NOT ADDRESSED |
| Edit/rewrite flow loses sources | NOT ADDRESSED |
| sessionStorage unavailable | NOT ADDRESSED |
| React batching may reorder setState | NOT ADDRESSED |
| Empty array vs "loading" ambiguity | NOT ADDRESSED |

**Action**: Tracked as future work; core fix is minimal viable solution

### Agent 4: Alternative Solutions Explorer

**Key insight**: CitationPlugin useEffect at lines 181-197 already has `sources` in dependency array. The early return at line 65 (`sources.length === 0`) prevents the self-healing pattern from working.

**1-line fix**: Remove `sources.length === 0` from early return. Plugin will scan DOM, rescan when sources arrive.

### Plan Revisions Made (Round 2)
1. ❌ Removed `returnExplanation.ts` modification - sources already at route.ts level
2. ❌ Removed Promise.all restructure - CitationPlugin 1-line fix instead
3. ❌ Deferred Phase 3 entirely - feature work, not bug fixing
4. ✅ Identified 6 risk mitigations for future work

### Final Scope
- **After Round 1**: ~6 files, ~85 lines
- **After Round 2**: **~3 files, ~16 lines** (5x reduction!)

| Phase | Files | Lines |
|-------|-------|-------|
| P0 | route.ts, page.tsx | ~15 |
| P1 | CitationPlugin.tsx | ~1 |
| ~~P2~~ | ~~DEFERRED~~ | 0 |
| **TOTAL** | **3** | **~16** |

---

## Phase 3: Implementation (Completed Jan 10, 2026)

### Work Done

#### Phase 1 (P0): Include Sources in Complete Event
**Files Modified:**
- `src/app/api/returnExplanation/route.ts` (~15 lines)
  - Added `SourceChipType` import
  - Added source conversion before complete event (converts `SourceCacheFullType[]` to `SourceChipType[]`)
  - Modified complete event to include `sources: sourceChips` in result
  - Strips `extracted_text` to reduce payload (~100KB → ~5KB)

- `src/app/results/page.tsx` (~10 lines)
  - Added source extraction from complete event in `data.type === 'complete'` handler
  - Calls `setSources(data.result.sources)` when sources present
  - Added debug logging for sources

#### Phase 2 (P1): CitationPlugin Self-Healing
**Files Modified:**
- `src/editorFiles/lexicalEditor/CitationPlugin.tsx` (~4 lines)
  - Removed `sources.length === 0` from early return at `processCitations` callback
  - Removed `sources.length === 0` from early return in useEffect
  - Removed redundant `sources` from useCallback dependency array (getSourceByIndex handles it)
  - Added documentation comments explaining self-healing pattern

### Verification Results
| Check | Result |
|-------|--------|
| Lint | ✅ Passed (no warnings or errors) |
| TypeScript | ✅ Passed (no type errors) |
| Build | ✅ Passed (all routes built successfully) |
| Unit Tests | ✅ Passed (2308 tests, 93 suites) |

### Issues Encountered
- **Workflow hook mismatch**: Branch name `feat/full-production-logging` didn't match project folder. Resolved by renaming branch to `systematically_assess_add_sources_20260109`.
- **Lint warning**: `sources` was flagged as unnecessary in useCallback dependency array after removing the early return. Fixed by removing `sources` from deps (redundant with `getSourceByIndex`).

### Key Implementation Insights
1. **Source conversion placement**: Sources are converted at route.ts level (line 211-220) right before the complete event, using the already-available `finalSources` variable. No changes needed to service layer.

2. **Self-healing pattern**: CitationPlugin's useEffect already had `sources` in dependency array via `getSourceByIndex`. The only barrier was the early return - removing it enables automatic re-scanning when sources arrive late.

3. **Total scope**: 3 files modified, ~29 lines changed (slightly more than planned 16 due to comments and logging).

---

## Phase 4: Testing & Verification (In Progress)

### Automated Testing
- [x] Unit tests pass (2308/2308)
- [ ] Integration tests
- [ ] E2E tests for sources persistence

### Manual Testing
- [ ] Generate article with sources → verify bibliography appears immediately
- [ ] Reload page → verify sources persist
- [ ] Verify citations are clickable blue links
