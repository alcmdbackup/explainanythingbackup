# Clean Up and Enforce Design System Progress

## Phase 1: Create Custom ESLint Rules ✅

### Work Done
- Created 4 custom ESLint rules in `eslint-rules/`:
  - `no-hardcoded-colors.js` - Detects hex/rgba colors in style props
  - `no-arbitrary-text-sizes.js` - Detects `text-[Xpx]` patterns
  - `prefer-design-system-fonts.js` - Warns on font-serif/font-sans usage
  - `prefer-warm-shadows.js` - Warns on shadow-sm/md/lg/xl/2xl classes
- Created `design-system.js` plugin index bundling all rules
- Updated `eslint.config.mjs` with two-plugin architecture (flakiness + design-system)
- Created test files for all 4 rules using ESLint RuleTester
- Added `test:eslint-rules` script to package.json

### Issues Encountered
- ESLint RuleTester required flat config format (`languageOptions.parserOptions`) instead of eslintrc format (`parserOptions`). Fixed by updating test files.

### User Clarifications
None needed

---

## Phase 2: Fix High-Priority Violations ✅

### Work Done
- Added CSS variables to globals.css for Navigation dark theme:
  - `--nav-dark-bg`, `--nav-dark-text`, `--nav-dark-border`, etc.
- Added scrollbar CSS variables: `--scrollbar-thumb`, `--scrollbar-thumb-hover`, `--scrollbar-thumb-active`
- Updated Navigation.tsx to use CSS variables with fallbacks
- Updated SearchBar.tsx dark mode styling
- Updated results/page.tsx scrollbar styling (2 instances)
- Fixed shadow classes in 5 admin modal files:
  - CandidatesContent.tsx, ExplanationDetailModal.tsx, ReportsTable.tsx
  - UserDetailModal.tsx, WhitelistContent.tsx
- Fixed shadow classes in 4 UI component files:
  - sheet.tsx (shadow-2xl → shadow-warm-xl)
  - AIEditorPanel.tsx (hover:shadow-md → hover:shadow-warm-md)
  - Navigation.tsx (shadow-md/lg → shadow-warm-md/lg)
  - ReportContentButton.tsx

### Issues Encountered
None

### User Clarifications
None needed

---

## Phase 3: Fix Typography Violations ✅

### Work Done
- Updated layout.tsx body font to `font-body`
- Replaced all `font-serif` with `font-body` across 15+ files:
  - login/page.tsx, results/page.tsx, AIEditorPanel.tsx
  - AdvancedAIEditorModal.tsx, ExplanationsTablePage.tsx
  - TextRevealSettings.tsx, ExplanationCard.tsx
  - ExploreGalleryPage.tsx, Bibliography.tsx
  - CitationTooltip.tsx, CitationPlugin.tsx
  - LexicalEditor.tsx (theme config), sheet.tsx
- Replaced all `font-sans` with `font-ui` across 10+ files:
  - ExploreTabs.tsx, FilterPills.tsx, TextRevealSettings.tsx
  - ExplanationsTablePage.tsx, ExploreGalleryPage.tsx
  - ExplanationCard.tsx, results/page.tsx
  - LexicalEditor.tsx, ReportContentButton.tsx
- Fixed arbitrary text sizes in form.tsx (`text-[0.8rem]` → `text-xs`)

### Issues Encountered
None

### User Clarifications
None needed

---

## Phase 4: Upgrade Warnings to Errors ✅

### Work Done
- Verified zero lint warnings after all fixes
- Updated `eslint.config.mjs` to use "error" instead of "warn" for all 4 design system rules
- Verified lint still passes with errors enabled
- All ESLint rule tests pass

### Issues Encountered
None

### User Clarifications
None needed

---

## Summary

### Files Modified
**ESLint Rules (new):**
- eslint-rules/no-hardcoded-colors.js
- eslint-rules/no-arbitrary-text-sizes.js
- eslint-rules/prefer-design-system-fonts.js
- eslint-rules/prefer-warm-shadows.js
- eslint-rules/design-system.js
- eslint-rules/*.test.js (4 test files)

**Configuration:**
- eslint.config.mjs
- package.json
- src/app/globals.css

**Components Updated:**
- 25+ component files with font/shadow fixes

### Verification
- ✅ `npm run lint` - No ESLint warnings or errors
- ✅ `npx tsc --noEmit` - No type errors
- ✅ `npm run build` - Build successful
- ✅ `npm run test:eslint-rules` - All 4 rule tests pass
