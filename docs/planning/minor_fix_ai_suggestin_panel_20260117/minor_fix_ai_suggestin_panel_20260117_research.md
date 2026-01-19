# Minor Fix AI Suggestion Panel Research

## Problem Statement
Five UI/UX issues need to be addressed on the /results page:
1. Title size inconsistency - results page title is larger than other section headings
2. Flag modal appearing behind other elements (z-index issue)
3. Plain text/formatted toggle button lacks an icon for consistency
4. "Add tag" button is too tall compared to regular tags
5. AI suggestion panel needs better visual separation from nav bar

## High Level Summary
All issues are CSS/styling related. The flag modal z-index issue may be caused by incorrect CSS variable names. The title uses a different CSS class than other pages. The AI panel needs outline styling and z-index adjustment.

## Documents Read
- docs/docs_overall/getting_started.md
- docs/docs_overall/architecture.md
- docs/docs_overall/project_workflow.md

## Code Files Read

### Title Styling
- **src/app/results/page.tsx:1061** - Uses `atlas-display` class
- **src/components/explore/ExploreGalleryPage.tsx:43-46** - Uses `atlas-display-section`
- **src/app/settings/page.tsx:44-47** - Uses `atlas-display-section`
- **src/app/globals.css:1859-1874** - CSS definitions:
  - `.atlas-display`: font-size 3.5rem, font-weight 500
  - `.atlas-display-section`: font-size 2.25rem, font-weight 600

### Flag Modal (ReportContentButton)
- **src/components/ReportContentButton.tsx:93** - Modal overlay has `z-50`
- **Issue**: Uses `--bg-primary` and `--border-color` CSS variables which may not exist
- Should use `--surface-primary` and `--border-default` per design system

### Plain Text/Formatted Toggle
- **src/app/results/page.tsx:1181-1189** - Text-only button, no icon
- Other action bar buttons have icons (Save, Share, Edit all have icons)

### Add Tag Button
- **src/components/TagBar.tsx:430-441** - Uses `.bookmark-tag` class
- **src/app/globals.css:1581-1601** - `.bookmark-tag` has padding `0.375rem 0.75rem 0.375rem 1rem`
- Regular tags use `px-3 py-1` (0.25rem vertical padding)

### AI Editor Panel
- **src/components/AIEditorPanel.tsx:468-477** - Main container with variant styles
- **src/components/ai-panel-variants.ts** - Defines styles including `border-l-2 border-l-[var(--accent-gold)]`
- **src/components/Navigation.tsx:188** - Nav has 3px gold bottom border
- Issue: Nav gold border bleeds into AI panel gold header

### Layout Structure
- Navigation is at top with gold accent line
- Main content is flexbox with AI panel on right side
- AI panel has relative positioning, no explicit z-index on main container
