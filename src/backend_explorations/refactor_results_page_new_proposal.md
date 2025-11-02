# Results Page Refactoring Strategy: Reducers + Custom Hooks

## Executive Summary

**Current State:**
- 1,317 lines of tangled logic in single component
- 28 interdependent state variables
- 14 functions (2 exceed 100 lines each)
- 8+ distinct responsibilities
- Effectively untestable without massive mock complexity

**Goal:** Reduce to ~250 lines in main component with 85%+ test coverage in 8 weeks.

**Strategy:** Hybrid approach using reducers for state machines and custom hooks for extraction.

---

## Core Problems

1. **State Management Chaos**: 28 useState calls with complex interdependencies, impossible states possible
2. **Monolithic Functions**: handleUserAction (186 lines), loadExplanation (110 lines) mix concerns
3. **Tangled Responsibilities**: Data fetching, streaming, routing, auth, UI state, tag workflows all intermingled
4. **Testing Impossibility**: Would require mocking 9+ server actions, streaming API, router, auth, localStorage
5. **Maintenance Burden**: Every change risks breaking multiple unrelated features

---

## Refactoring Strategy: Hybrid Approach

### Use Reducers For:
1. **Tag mode state machine** - 7 state variables → 1 reducer (TagBarMode.Normal/RewriteWithTags/EditWithTags transitions)
2. **Loading/generation state machine** - Prevent impossible states (loading + error simultaneously)
3. **Edit/publishing state** - Clear state transitions (view → edit → saving → published)

### Use useState For:
- Simple toggles (isMarkdownMode, showMatches)
- Single-set values (userid, mode)
- Independent UI state

### Benefits:
- Reducers prevent impossible states through discriminated unions
- TypeScript enforces valid transitions
- Pure reducer functions trivial to test
- Redux DevTools support for debugging
- Simpler hooks use familiar useState pattern

---

## Implementation Phases

### Phase 1: Extract Custom Hooks (Weeks 1-2)

**Goal:** Separate concerns into testable modules without reducers initially.

**Hook 1: useExplanationLoader**
- Extracts: loadExplanation, loadUserQuery, checkUserSaved, vector loading
- Responsibilities: Data fetching from database/Pinecone
- State: explanation data, loading status, error
- Testing: Mock server actions, verify data loading flows

**Hook 2: useStreamingGenerator**
- Extracts: handleUserAction, streaming response parsing
- Responsibilities: API communication, streaming coordination
- State: streaming status, content updates, errors
- Testing: Mock fetch API, test streaming chunks

**Hook 3: useTagModeManager**
- Extracts: Tag mode state, temp tags, dropdown logic
- Responsibilities: Tag workflow orchestration
- State: Current mode, active tags, dropdown visibility
- Testing: Test mode transitions, tag manipulation

**Hook 4: useEditTracking**
- Extracts: Change detection, unsaved changes warning
- Responsibilities: Track content/title modifications
- State: Edit mode, changes flag, original values
- Testing: Test change detection logic

**Hook 5: useUrlParameters**
- Extracts: URL parameter processing, mode initialization
- Responsibilities: Routing logic, localStorage persistence
- State: Initialized mode, query/title from URL
- Testing: Mock router, test parameter handling

**Outcome:** Main component reduced to ~300 lines, all business logic extracted.

---

### Phase 2: Add Reducers to State Machines (Week 3)

**Goal:** Refine hooks with state machine guarantees.

**Reducer 1: tagReducer in useTagModeManager**
- States: TagBarMode.Normal, RewriteWithTags, EditWithTags
- Actions: ENTER_REWRITE_MODE, ENTER_EDIT_MODE, EXIT_SPECIAL_MODE, TOGGLE_DROPDOWN, LOAD_TAGS
- Guarantees: Cannot be in multiple modes simultaneously, temp tags cleared on exit
- Testing: Pure function testing, verify all transitions

**Reducer 2: generationReducer in useStreamingGenerator**
- States: idle, loading, streaming, success, error
- Actions: START_GENERATION, STREAM_CHUNK, COMPLETE, ERROR
- Guarantees: Cannot be loading and have error, streaming implies content
- Testing: Test state transitions, verify impossible states prevented

**Reducer 3: editReducer in useEditTracking** (optional)
- States: viewing, editing, saving
- Actions: ENTER_EDIT, EXIT_EDIT, START_SAVE, SAVE_COMPLETE, TRACK_CHANGE
- Guarantees: Cannot save while viewing, changes tracked only in edit mode
- Testing: Test edit flow, publish flow

**Outcome:** State machines prevent bugs, clearer transitions, easier debugging.

---

### Phase 3: Extract UI Components (Week 4)

**Goal:** Further reduce main component, isolate presentational logic.

**Component 1: ExplanationActionsBar**
- Extracts: Action buttons section (lines 1056-1200)
- Props: Event handlers, state flags (isStreaming, isSaving, userSaved, isEditMode)
- Responsibilities: Button rendering, disabled state logic
- Testing: Test button states, click handlers, disabled conditions

**Component 2: MatchesView**
- Extracts: Matches display (lines 949-1031)
- Props: Matches array, onLoadExplanation, onBack
- Responsibilities: Render match list with similarity scores
- Testing: Test rendering, click handlers, empty state

**Component 3: RegenerateDropdown**
- Extracts: Dropdown menu (lines 1061-1139)
- Props: isOpen, onClose, onRewriteWithTags, onEditWithTags, isDisabled
- Responsibilities: Dropdown UI, option selection
- Testing: Test open/close, option clicks, disabled state

**Outcome:** Main component now ~250 lines, focused on orchestration only.

---

### Phase 4: Write Comprehensive Tests (Weeks 5-8)

**Goal:** Achieve 85%+ coverage with maintainable tests.

**Week 5: Hook Tests**
- Test each hook with renderHook from React Testing Library
- Mock server actions, fetch API, router at boundaries
- Test happy paths, error conditions, edge cases
- Target: 90%+ coverage per hook

**Week 6: Reducer Tests**
- Test pure reducer functions with simple assertions
- Verify all state transitions
- Test impossible state prevention
- Target: 95%+ coverage per reducer

**Week 7: Component Tests**
- Test with @testing-library/react
- User-centric testing (click, type, visual states)
- Mock minimal dependencies
- Target: 85%+ coverage per component

**Week 8: Integration Tests**
- Test full user journeys in results page
- Verify hook orchestration
- Test URL parameter flows end-to-end
- Target: 75%+ coverage on main page (hooks tested separately)

**Overall Target:** 85%+ total coverage with fast, maintainable tests.

---

## Timeline

### Month 1: Foundation
- **Week 1**: Extract useExplanationLoader, useStreamingGenerator
- **Week 2**: Extract useTagModeManager, useEditTracking, useUrlParameters
- **Week 3**: Add reducers to tag and generation hooks
- **Week 4**: Extract UI components

### Month 2: Testing & Polish
- **Week 5**: Write hook tests (90% coverage)
- **Week 6**: Write reducer tests (95% coverage)
- **Week 7**: Write component tests (85% coverage)
- **Week 8**: Write integration tests (75% page coverage)

---

## Success Metrics

### Quantitative
- Main component: 1,317 lines → ~250 lines (81% reduction)
- State variables: 28 → ~10 in main component
- Functions: 14 large → 5-7 small orchestration functions
- Test coverage: 0% → 85%+
- Test execution: <2 minutes for all tests
- Flaky tests: <1%

### Qualitative
- Each concern tested independently
- Safe refactoring capability
- Tests serve as documentation
- Impossible states prevented by type system
- Easier onboarding for new developers
- Faster feature development

---

## Risk Mitigation

### Refactoring Risks:
- **Regression bugs**: Mitigated by incremental extraction, manual testing between phases
- **Breaking changes**: Mitigated by feature flags, gradual rollout
- **Scope creep**: Mitigated by strict phase boundaries, time-boxed work

### Testing Risks:
- **Brittle tests**: Mitigated by testing behavior not implementation, avoiding test IDs
- **Slow tests**: Mitigated by mocking at boundaries only, avoiding integration tests for unit logic
- **Low coverage**: Mitigated by coverage thresholds in CI, incremental targets

---

## Dependencies & Prerequisites

**Required:**
- Jest, React Testing Library, @testing-library/react-hooks already installed
- TypeScript strict mode enabled
- ESLint + Prettier configured

**Nice to Have:**
- MSW (Mock Service Worker) for API mocking
- Redux DevTools extension for reducer debugging
- jest-extended for additional matchers

---

## Key Decisions

1. **Reducers only where needed**: Don't over-engineer simple toggles
2. **Extract first, optimize second**: Get working extraction before adding reducers
3. **Colocation**: Place tests next to source files for discoverability
4. **Test at appropriate level**: Pure functions (reducers) → unit tests, hooks → integration tests, page → E2E-style
5. **Mock at boundaries**: Never mock internal modules, only external dependencies

---

## Next Steps

1. Review and approve this plan
2. Create feature branch: `refactor/results-page-hooks-reducers`
3. Begin Phase 1, Week 1: Extract useExplanationLoader
4. Verify no functionality regression after each extraction
5. Write tests immediately after each hook extraction
6. Review and merge incrementally to avoid large PR risk

---

## Appendix: File Structure After Refactoring

```
src/
├── app/
│   └── results/
│       ├── page.tsx (~250 lines, orchestration only)
│       └── page.test.tsx (integration tests)
├── hooks/
│   ├── useExplanationLoader.ts + test
│   ├── useStreamingGenerator.ts + test
│   ├── useTagModeManager.ts + test
│   ├── useEditTracking.ts + test
│   └── useUrlParameters.ts + test
├── reducers/
│   ├── tagReducer.ts + test
│   ├── generationReducer.ts + test
│   └── editReducer.ts + test
├── components/
│   ├── ExplanationActionsBar.tsx + test
│   ├── MatchesView.tsx + test
│   └── RegenerateDropdown.tsx + test
└── lib/
    └── services/
        └── streamingClient.ts + test (optional extraction)
```

---

## Conclusion

This refactoring transforms an untestable 1,317-line monolith into a well-structured, thoroughly-tested system. The hybrid approach (reducers for state machines, hooks for extraction) provides the right balance of safety and simplicity.

**Timeline:** 8 weeks from start to 85% coverage.
**Outcome:** Maintainable, testable, type-safe code that prevents bugs and enables faster development.
