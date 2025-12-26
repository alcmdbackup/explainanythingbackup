# Import Sources Feature - Brainstorm

## Overview

Allow users to generate AI explanations grounded in high-quality external sources, with options to synthesize or cite those sources.

**Core Capabilities:**
- Add up to 5 source URLs
- Two generation modes: "Synthesize" vs "Cite Sources"
- Server-side URL fetching with user-controlled error handling
- Sources displayed in sidebar panel + footer bibliography

---

## 1. Entry Points

### Home Page
- Search bar with "+ Add Sources" link/button below
- Clicking reveals source input area
- URL field with "Add" button
- Each URL appears as removable chip (title + favicon + domain + X)
- Toggle: "Synthesize" vs "Cite Sources"
- Submit generates content with sources

### Results Page (Regenerate)
- "Rewrite" dropdown → "Rewrite with Sources" option
- Source input panel slides open (same UI as home page)
- Add URLs, choose mode, click "Generate"
- Content regenerates using sources

---

## 2. Workflow

### Adding Sources
1. User enters URL in input field
2. Clicks "Add" (or presses Enter)
3. Loading spinner while fetching metadata
4. Chip appears with: favicon, title, domain, remove button
5. If fetch fails: chip shows warning icon + "Failed to load"
6. Repeat up to 5 sources

### Generation
1. User enters query (home) or clicks regenerate (results)
2. Selects mode: "Synthesize" or "Cite Sources"
3. If any sources failed, modal appears:
   - Lists failed URLs
   - Options: "Remove failed" or "Proceed anyway"
4. Backend fetches full content from URLs
5. LLM generates content using sources
6. Results page shows content + sources sidebar

### Generation Modes
- **Synthesize**: AI creates original content informed by sources (no inline citations, sources in sidebar for reference)
- **Cite Sources**: AI generates with inline citations [1], [2], etc. + footer bibliography

---

## 3. Displaying Sources Alongside Articles

### Right Sidebar Panel
- Collapsible "Sources" panel (similar to AI Suggestions panel)
- Shows list of source cards:
  - Favicon + title
  - Domain name
  - Click to expand: excerpt/summary of content used
  - Link icon to open original in new tab
- Toggle show/hide
- Highlights relevant source when hovering inline citation

### Footer Bibliography (Cite Sources mode)
- Appears at bottom of article
- Numbered references matching inline citations
- Each entry: [n] Title - domain.com (clickable link)
- Standard academic bibliography style

### Inline Citations (Cite Sources mode)
- Superscript numbers [1], [2] in text
- Clickable - scrolls to footer reference
- Hover shows tooltip with source title

---

## 4. Technical Considerations

### URL Fetching
- Server-side fetch (more reliable, handles edge cases)
- Extract: title, favicon, domain, main text content
- Cache fetched content globally (reuse across users)

### Storage
- **Source cache table**: URL, title, favicon, domain, extracted_text, fetched_at
- **Article sources junction**: explanation_id, source_id, position, mode_used
- Sources persisted with article for transparency

### Error Handling
- Timeout: 10 seconds per URL
- Failed fetches: show warning, let user decide to remove or proceed
- Paywalled content: extract what's available, note limitation

### LLM Integration
- Pass source content to prompt as context
- For "Cite Sources" mode: instruct LLM to use [n] notation
- Include source metadata for accurate attribution

---

## 5. UI Components Needed

### New Components
- `SourceInput` - URL input field with add button
- `SourceChip` - Removable chip showing source metadata
- `SourcesPanel` - Right sidebar panel for viewing sources
- `SourceCard` - Expandable card within panel
- `Bibliography` - Footer references section
- `CitationTooltip` - Hover preview for inline citations

### Modified Components
- `SearchBar` - Add "+ Add Sources" trigger
- `RewriteDropdown` - Add "Rewrite with Sources" option
- Results page layout - Accommodate sources sidebar

---

## 6. Open Questions

1. Should sources be editable after generation? (reorder, remove, add more)
2. Rate limiting for URL fetches?
3. How to handle very long source content? (truncate, summarize, chunk?)
4. Should we show "confidence" in how much each source influenced the output?
5. Allow users to highlight specific passages from sources to emphasize?

---

## 7. Future Enhancements (Out of Scope for V1)

- Bulk URL import (paste multiple at once)
- Browser extension to save sources while reading
- Auto-suggest sources based on query
- PDF/document upload as sources
- Source quality scoring
- Collaborative source collections
