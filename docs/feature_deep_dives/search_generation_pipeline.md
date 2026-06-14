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

> **Structured output:** the structured `callLLM` sites in this pipeline — `generateTitleFromUserQuery` (`title1`), `extractLinkCandidates`, `evaluateTags`, and `findBestMatchFromList` — pass a Zod `response_obj`. In `llms.ts` these become schema-enforced output: OpenAI uses `zodResponseFormat` (`json_schema`, strict); **OpenRouter models flagged `supportsJsonSchema`** (Gemini) use `json_schema` with `strict:false`; DeepSeek/Local/unflagged-OpenRouter fall back to (unenforced) `json_object`. This is why forcing a non-flagged OpenRouter model for title-gen would fail to produce a valid `title1`. See `fix_openrouter_json_schema_structured_output_20260608`.

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

## Post-streaming UX — GenerationStatusPill

A floating bottom-center pill (`src/components/results/GenerationStatusPill.tsx`) communicates streaming state to the user. Subscribes to `pageLifecycleReducer` state passed as a prop. Renders four visual states:

| Phase | Pill state | Copy |
|---|---|---|
| `streaming` | A — gold accent + pencil icon | `Drafting your article — hang tight…` |
| `viewing` (just transitioned) | B — green tick, 800ms | `All set! Bringing the editor in…` |
| `viewing` (settled) | C — green tick, dismiss ✕, 3s auto-fade | `Try: "explain it like I'm 12" — AI editor →` |
| `error` | red triangle | `Generation failed — try again` |
| other | hidden | |

Mounted at page root in `src/app/results/page.tsx` (NOT inside the article container — it's `position: fixed`). Respects `prefers-reduced-motion` via Tailwind `motion-safe:` class. `role="status"` + `aria-live="polite"` for screen readers.
