# Import Sources V1 - Design

## Overview

Allow users to add source URLs to ground AI explanations with inline citations. Sources serve as reference material; the user who curates sources and crafts the prompt receives full attribution.

---

## Entry Points

### Home Page
- "+ Add Sources" link/button below search bar
- Clicking reveals source input area
- User adds URLs before initial generation

### Results Page
- "Rewrite with Feedback" option in dropdown
- Combined panel for both:
  - **Tags/preferences** - difficulty, length, teaching style
  - **Sources** - add URLs to ground the rewrite
- Both optional; user picks what to adjust

---

## Source Input UX

### Adding Sources
1. User pastes URL in input field
2. Clicks "Add" or presses Enter
3. Loading spinner while fetching metadata
4. Chip appears with: favicon, title, domain, remove button
5. Maximum 5 sources

### Failed Fetches
- Chip displays with warning icon + "Failed to load"
- User decides to remove or keep
- If kept, generation proceeds without that source's content

---

## Content Processing

### Extraction Pipeline
1. **Server-side fetch** - More reliable than client-side
2. **Readability extraction** - Strip navs, ads, footers; keep main content
3. **Length check** - If content exceeds threshold (e.g., 3000 words):
   - Summarize with cheaper model (e.g., GPT-3.5, Haiku)
   - Preserve exact quotes vs summarized content distinction
4. **Pass to generation** - Include processed content in LLM prompt

### Quote Attribution
- When summarizing, mark which text is verbatim quote vs paraphrase
- LLM instructed to cite appropriately based on this metadata

---

## Citation Display

### Inline Citations
- Superscript numbers: `[1]`, `[2]`, etc.
- Clickable - scrolls to footer reference

### Hover Tooltip
- Shows source domain + title on hover
- Quick preview without scrolling

### Footer Bibliography
- Numbered references matching inline citations
- Format: `[n] Title - domain.com` (clickable link)
- Appears at bottom of article

---

## Caching

### Global Source Cache
- Shared across all users (same URL = same cached content)
- 7-day expiry to balance freshness vs efficiency

### Schema
```
source_cache:
  - url (unique)
  - title
  - favicon_url
  - domain
  - extracted_text
  - is_summarized (boolean)
  - original_length
  - fetched_at
  - expires_at
```

### Article-Source Junction
```
article_sources:
  - explanation_id
  - source_cache_id
  - position (1-5)
  - created_at
```

---

## LLM Integration

### Prompt Structure
- Pass source content as context
- Instruct LLM to use `[n]` notation for citations
- Include metadata: which content is verbatim vs summarized
- Request citations for factual claims, not every sentence

### Example Prompt Addition
```
Use the following sources to inform your explanation.
Cite sources using [1], [2], etc. for factual claims.

Source [1]: {title} ({domain})
[VERBATIM] {exact quote sections}
[SUMMARIZED] {summarized sections}

Source [2]: ...
```

---

## UI Components

### New Components
- `SourceInput` - URL input field with add button
- `SourceChip` - Removable chip showing source metadata (favicon, title, domain, warning state)
- `Bibliography` - Footer references section
- `CitationTooltip` - Hover preview for inline citations

### Modified Components
- `SearchBar` - Add "+ Add Sources" trigger
- `RewriteDropdown` → `RewriteWithFeedback` - Combined tags + sources panel
- Article renderer - Support for citation links + tooltip triggers

---

## Error Handling

- **Fetch timeout:** 10 seconds per URL
- **Failed fetches:** Warning chip; user decides
- **Paywall content:** Extract what's available; note limitation in chip
- **Empty content:** Treat as failed fetch

---

## Future Iterations (Not V1)

### Source Quality Scoring
- Track which source domains correlate with higher-rated outputs
- Surface insights: "Articles using academic sources get 20% better feedback"

### Source-Query Matching
- Learn which source types work well for which topics
- Example: "Academic sources work better for science explanations"

### Other Ideas
- Bulk URL import
- PDF/document upload
- Auto-suggest sources based on query
- Browser extension for saving sources
