# Improve UX for Searching Progress

## Phase 1: Tab Infrastructure
### Work Done
- Created `HomeTabs.tsx` - Tab component with Search/Import switching, ARIA accessibility
- Created `HomeSearchPanel.tsx` - Search tab content with query input, sources, tags
- Created `HomeImportPanel.tsx` - Import tab content with AI source detection
- Created `index.ts` - Barrel exports for home components
- Updated `src/app/page.tsx` - Integrated tabbed interface

### Files Created/Modified
- `src/components/home/HomeTabs.tsx` (new)
- `src/components/home/HomeSearchPanel.tsx` (new)
- `src/components/home/HomeImportPanel.tsx` (new)
- `src/components/home/index.ts` (new)
- `src/app/page.tsx` (modified)

## Phase 2: Compact Sources Section
### Work Done
- Created `HomeSourcesRow.tsx` - Inline sources row with inline URL input expansion
- Always visible (no collapse toggle)
- Reuses existing `SourceChip` component
- Shows counter when 3+ sources

### Files Created
- `src/components/home/HomeSourcesRow.tsx` (new)

## Phase 3: Home Tag Selector
### Work Done
- Created `HomeTagSelector.tsx` - Compact dropdown tag selector
- Difficulty preset: Beginner/Intermediate/Advanced
- Length preset: Brief/Standard/Detailed
- "+ Add tag" for simple tags with search/filter
- Wired to Search tab, passes selections to generation API via sessionStorage

### Files Created
- `src/components/home/HomeTagSelector.tsx` (new)

## Phase 4: Import Tab Enhancement
### Work Done
- Import panel includes AI source dropdown with auto-detection
- Sources: ChatGPT, Claude, Gemini, Other AI
- Auto-detection triggers at 100+ characters
- "(auto-detected)" hint shown when system detects source
- Wired to existing ImportPreview modal flow

### Files Created
- `src/components/home/HomeImportPanel.tsx` (new)

## Phase 5: Unit Tests
### Work Done
- Created `HomeTabs.test.tsx` - 10 tests for tab switching and ARIA
- Created `HomeSourcesRow.test.tsx` - 11 tests for add/remove sources
- Created `HomeTagSelector.test.tsx` - 16 tests for dropdown selection
- Created `HomeSearchPanel.test.tsx` - 18 tests for form submission, sessionStorage, keyboard handling
- Created `HomeImportPanel.test.tsx` - 22 tests for content validation, AI detection, process flow
- Updated `page.test.tsx` - Updated mocks for new tabbed interface, added state preservation test

### Test Results
- All 78 home-related unit tests passing
- Full suite: 2695 tests passing
- ESLint: No warnings or errors
- Build: Successful

### Files Created/Modified
- `src/components/home/__tests__/HomeTabs.test.tsx` (new)
- `src/components/home/__tests__/HomeSourcesRow.test.tsx` (new)
- `src/components/home/__tests__/HomeTagSelector.test.tsx` (new)
- `src/components/home/__tests__/HomeSearchPanel.test.tsx` (new)
- `src/components/home/__tests__/HomeImportPanel.test.tsx` (new)
- `src/app/page.test.tsx` (modified - updated for tabbed interface)

## Phase 6: Integration Tests
### Work Done
- Added `additionalRules` integration tests in `explanation-generation.integration.test.ts`
- Tests verify that additionalRules are included in content generation prompt
- Tests verify prompt without rules when empty array passed

### Files Modified
- `src/__tests__/integration/explanation-generation.integration.test.ts` (modified)

## Phase 7: E2E Tests
### Work Done
- Created `home-tabs.spec.ts` - 18 E2E tests for home page tabbed interface
- Tests cover: tab switching, state preservation, query submission, tag selection, source management, import tab, accessibility
- Added data-testid attributes to HomeTabs.tsx for E2E test selectors
- Fixed E2E tests to use button roles for custom dropdown components

### Files Created
- `src/__tests__/e2e/specs/01-home/home-tabs.spec.ts` (new)

### Files Modified
- `src/__tests__/e2e/helpers/pages/SearchPage.ts` - Updated selectors for new home page test IDs
- `src/components/home/HomeTabs.tsx` - Added data-testid attributes

## Test Coverage Addressed

### Unit Tests Added ✓
- `HomeSearchPanel.test.tsx` - form submission, sessionStorage integration, keyboard handling
- `HomeImportPanel.test.tsx` - content validation, AI detection, process flow

### Integration Tests Added ✓
- `additionalRules` parameter now tested - verifies tag rules modify AI prompt
- Tests both with rules and without rules cases

### E2E Tests Added ✓
- `home-tabs.spec.ts` covers:
  - Tab switching (Search ↔ Import)
  - State preservation when switching tabs
  - Search submission (Enter key and button click)
  - Tag selector (difficulty and length presets)
  - Source management (Add URL button, URL input)
  - Import tab validation (100+ char requirement)
  - Accessibility (ARIA roles on tabs and panels)

### Remaining Pre-existing Gaps (Not Introduced by This PR)
- `pendingTags` sessionStorage flow from home page → results page → API (integration level)
- `pendingSources` sessionStorage flow (existed before this PR)

---

## Summary

All 7 phases completed:
1. Tab infrastructure with Search/Import modes ✓
2. Compact inline sources section ✓
3. Home tag selector with difficulty/length presets ✓
4. Import tab with AI source auto-detection ✓
5. Unit tests (78 passing) ✓
6. Integration tests for additionalRules (2 passing) ✓
7. E2E tests for home tabs (18 tests) ✓

### Final Verification (2026-01-23)
- `npm run lint` - No warnings or errors
- `npm run tsc` - No TypeScript errors
- `npm run build` - Successful
- `npm test` - 2695/2695 tests passing
- `npm run test:e2e -- --grep="Home Page Tabs"` - 18/18 tests passing

### Key Bug Fixes During Implementation
- Fixed state preservation when switching tabs (lifted query state to page.tsx)
- Fixed form submission in unit tests (added `type="button"` to mock buttons)
- Fixed E2E tests for custom dropdowns (use `getByRole('button')` not `getByRole('option')`)
