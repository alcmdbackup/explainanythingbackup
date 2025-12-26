# Search & Generation Pipeline

## Overview

The search and generation pipeline is the core loop of ExplainAnything. When a user submits a query, the system either returns an existing explanation via semantic search or generates new content using GPT-4.

```
User Query → Generate Title → Vector Search → Match Found?
                                                ├─ Yes → Return Existing
                                                └─ No  → Generate → Tag → Store → Return
```

## Implementation

### Key Files
- `src/lib/services/returnExplanation.ts` - Main orchestration
- `src/lib/services/vectorsim.ts` - Vector operations
- `src/lib/services/findMatches.ts` - Match selection

### Main Functions

| Function | Purpose |
|----------|---------|
| `returnExplanationLogic()` | Main orchestrator - manages complete pipeline |
| `generateTitleFromUserQuery()` | LLM generates article title from user query |
| `generateNewExplanation()` | Streams AI-generated explanation |
| `postprocessNewExplanationContent()` | Enhances content with tags, links, headings |
| `applyTagsToExplanation()` | Applies AI-evaluated tags to explanation |

### Pipeline Flow

1. **Validate Input**: Check user query is valid
2. **Generate Title**: LLM converts query to article title
3. **Parallel Searches**:
   - Similar text matches (vector DB)
   - Anchor comparison (main set)
   - Diversity comparison (against previous explanation)
4. **Calculate Scores**: `calculateAllowedScores()` determines relevance threshold
5. **Enhance Matches**: Fetch full DB content + diversity scoring
6. **Select Best Match**: LLM ranks top 5 matches
7. **Decision Point**:
   - Match found → Return explanation ID
   - No match → Generate new content
8. **Post-Generation** (if new):
   - Stream content via callback
   - Generate heading standalone titles
   - Evaluate and apply tags
   - Extract link candidates
   - Save to database

### Match Selection Logic

```typescript
// Match modes
MatchMode.ForceMatch  // Skip LLM ranking, return first match
MatchMode.Normal      // Use LLM ranking with schema validation
```

The `findBestMatchFromList()` function formats top 5 matches (excluding already-saved) and asks LLM to rank them for relevance.

## Usage

```typescript
import { returnExplanationLogic } from '@/lib/services/returnExplanation';

const result = await returnExplanationLogic(
  userInput,           // User's search query
  savedId,             // ID to exclude from matches
  matchMode,           // MatchMode.Normal or MatchMode.ForceMatch
  userid,              // Current user ID
  userInputType,       // 'query' or 'title'
  additionalRules,     // Optional prompt rules
  onStreamingText,     // Callback for streaming content
  existingContent,     // Optional content to improve
  previousExplanationViewedId,    // For diversity scoring
  previousExplanationViewedVector // Vector of previous explanation
);

// Result structure
{
  originalUserInput: string;
  match_found: boolean;
  explanationId: string;
  matches: Match[];
  data: ExplanationData;
  userQueryId: string;
  error?: ErrorResponse;
}
```

### Streaming Content

```typescript
const onStreamingText = (text: string) => {
  // Called incrementally as content generates
  setContent(prev => prev + text);
};
```
