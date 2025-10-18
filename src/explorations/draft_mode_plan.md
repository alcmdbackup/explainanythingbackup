## Product requirements

### Core concept
**Goal:** Provide quality gates before publishing and allow multiple small edits before wider release through a draft state system.

**Article states:** Every article has one of two states:
- **Draft:** Not yet published, can be edited and refined, cannot be saved to user library
- **Published:** Finalized, available for broader consumption, can be saved to user library

### Article state transitions
**Draft creation occurs in two scenarios:**
1. **New generation:** All rewrite operations and initial article generation create articles in draft mode
2. **Editing existing content:** Any edit to a saved article seds UI into a new draft version that gets saved to db on publish only

**Publication:** Publishing mechanism will be handled in future iteration - focus on draft creation for now.

**Backward compatibility:** All existing articles in the database start in published mode.

### User workflows
**Creation flows that produce drafts:**
- Initial article generation from user queries
- "Rewrite" operations on existing articles
- "Rewrite with tags" operations
- "Edit with tags" operations

**Important behavior:**
- Rewrite and edit operations create NEW draft articles rather than modifying existing published articles
- Users cannot save draft articles to their personal library (save button disabled/hidden for drafts)
- Content iteration: No edit history tracking within a single draft - edits overwrite previous draft content

### User interface requirements
**Visual indicators:**
- Clear visual indicator showing when an article is in draft state
- UI should prominently display draft status to prevent confusion with published content
- Save to library functionality disabled for draft articles

**Navigation and URL handling:**
- Draft articles use exact same URL navigation pattern as published articles
- No special URL structure or routing changes needed for drafts
- URL pattern: `/results?explanation_id=123` (works for both draft and published)

**State management:**
- React state variable tracks current explanation status: `explanationStatus: ExplanationStatus | null`
- Status is loaded when explanation is fetched and updates UI components accordingly
- Status determines which UI elements are shown/hidden (save button, draft banner, etc.)

### Data storage and discovery
**Storage approach:**
- Drafts live in the same explanations table with a status flag column
- All database queries must include status field to maintain data consistency
- Vector embeddings created for both draft and published articles

**Vector search integration:**
- Draft articles receive vector embeddings upon creation
- Draft articles appear in similarity search results for all users
- No filtering or restrictions on draft discoverability
- Search behavior: Draft articles participate in the existing vector similarity matching system without modification

**Library and saving restrictions:**
- Only published articles can be saved to user library
- Draft articles cannot be saved until they are published
- Existing save functionality checks article status before allowing save operation

## Technical plan

### 1. Database schema changes

**Migration script:**
```sql
-- Add status column with default 'published' for backward compatibility
ALTER TABLE explanations ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'published';

-- Add index for efficient status filtering (future use)
CREATE INDEX idx_explanations_status ON explanations(status);

-- Add constraint to ensure only valid status values
ALTER TABLE explanations ADD CONSTRAINT chk_explanation_status
  CHECK (status IN ('draft', 'published'));
```

**Schema updates in `src/lib/schemas/schemas.ts`:**
```typescript
// Add enum for explanation status
export enum ExplanationStatus {
  Draft = "draft",
  Published = "published"
}

// Update explanationInsertSchema
export const explanationInsertSchema = explanationBaseSchema.extend({
  primary_topic_id: z.number(),
  secondary_topic_id: z.number().optional(),
  status: z.nativeEnum(ExplanationStatus).default(ExplanationStatus.Published)
});

// Update ExplanationFullDbSchema
export const ExplanationFullDbSchema = explanationInsertSchema.extend({
  id: z.number(),
  timestamp: z.string(),
});
```

### 2. Core business logic updates

**File: `src/lib/services/returnExplanation.ts`**

**Modify `generateNewExplanation()` function:**
- Add `status` parameter with default value `ExplanationStatus.Draft`
- Pass status to explanation data object

**Update `returnExplanationLogic()` function:**
- For all new article generation, set status to `ExplanationStatus.Draft`
- For rewrite operations (Rewrite, RewriteWithTags, EditWithTags), create new draft articles instead of modifying existing

**Key changes:**
```typescript
// In generateNewExplanation function
const newExplanationData = {
  explanation_title: titleResult,
  content: enhancedContent,
  status: ExplanationStatus.Draft  // Always create as draft
};

// In returnExplanationLogic, modify saveExplanationAndTopic call
const { error: explanationTopicError, id: newExplanationId } =
  await saveExplanationAndTopic(userInput, newExplanationData!);
```

**File: `src/actions/actions.ts`**

**Update `saveExplanationAndTopic()` function:**
- Accept and handle status field in explanation data
- Ensure status is properly saved to database
- Verify vector embeddings are created for draft articles

### 3. User interface updates

**File: `src/app/results/page.tsx`**

**State management:**
```typescript
// Add new state for tracking explanation status
const [explanationStatus, setExplanationStatus] = useState<ExplanationStatus | null>(null);
```

**Draft status indicator component:**
```typescript
// Add draft banner component
const DraftStatusBanner = () => (
  explanationStatus === ExplanationStatus.Draft ? (
    <div className="mb-4 px-4 py-2 bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700">
      <div className="flex items-center">
        <div className="ml-3">
          <p className="text-sm font-medium">
            📝 This is a draft article
          </p>
          <p className="text-xs mt-1">
            Draft articles are visible to others but not yet published
          </p>
        </div>
      </div>
    </div>
  ) : null
);
```

**Update `loadExplanation()` function:**
- Retrieve and set explanation status from loaded explanation data
- Update state: `setExplanationStatus(explanation.status)`

**Modify rewrite operation handlers:**
- Ensure rewrite operations create new draft articles
- Update user messaging to indicate new draft creation

### 4. API route modifications

**File: `src/app/api/returnExplanation/route.ts`**

**Request handling:**
- No changes needed to request interface
- Response will include new draft articles with proper status

**Streaming response:**
- Include status information in final result object
- Ensure status is properly serialized in API response

### 5. Action functions updates

**File: `src/actions/actions.ts`**

**Update `getExplanationByIdAction()`:**
- Ensure status field is returned when fetching explanations
- No filtering based on status (drafts and published both accessible)

**Update database queries:**
- Modify explanation fetch queries to include status field
- Ensure all explanation-related queries return status information

### 6. Vector search integration

**Files: `src/lib/services/vectorsim.ts`, `src/lib/services/findMatches.ts`**

**No modifications required:**
- Vector embeddings created for all explanations regardless of status
- Draft articles participate in similarity search automatically
- Existing vector search logic works unchanged

### 7. Implementation phases

**Phase 1: Database and schema foundation**
1. Run database migration to add status column
2. Update Zod schemas in `schemas.ts`
3. Update TypeScript types and exports

**Phase 2: Core logic updates**
1. Modify `generateNewExplanation()` to create drafts
2. Update `saveExplanationAndTopic()` to handle status
3. Update `returnExplanationLogic()` for draft creation
4. Modify rewrite operation logic

**Phase 3: UI implementation**
1. Add draft status state management
2. Implement draft status banner component
3. Update `loadExplanation()` function
4. Modify rewrite operation UI handlers

**Phase 4: API integration**
1. Update API responses to include status
2. Test API endpoints with draft articles
3. Verify streaming responses work correctly

**Phase 5: Testing and verification**
1. Test draft article creation flows
2. Verify vector search includes drafts
3. Test URL sharing for draft articles
4. Validate backward compatibility

### 8. In-UI Editing for Articles

**Overview:** Leverage existing `ResultsLexicalEditor` to edit articles. Behavior differs based on article status to protect published articles from modification.

#### 8.1 Editing Published Articles

**Edit Flow:**
0. **Preparation** On load, keep track of explanation's original content, and if explanation originally starts in draft or published state 
1. **Enter Edit Mode** - User clicks "Edit" on published article → UI switches to edit mode, no visual changes yet
2. **Content Changes** - When user modifies content that differs from original → draft indicator appears if not already in draft mode
3. **Local Changes** - All edits stored in browser memory via existing editor state management
4. **Publish New Version** - if there are content changes from original, then have a "publish" cta which creates new article in published state
5. **Navigation** - User redirected to new published article, original article unchanged

**Implementation:**
- Store original published content when entering edit mode
- Compare current editor content with original published content on each `onContentChange`
- Set `hasUnsavedChanges = (currentContent !== originalPublishedContent)`
- Move to draft indicator (if not already) when `hasUnsavedChanges` is true
- "Publish Changes" calls `saveExplanationAndTopic` with `status: ExplanationStatus.Published`
- Navigate to new published article ID after successful publish

#### 8.2 Required Changes

1. **State Management** - Add `hasUnsavedChanges` based on content comparison with baseline (published or draft)
2. **Dynamic Button** - Show "Publish Changes" for published articles, "Save Changes" for drafts
3. **Draft Mode UI** - Use existing draft indicator based on article status and unsaved changes

**Key Integration:**
- `ResultsLexicalEditor` already handles edit mode, content changes, and markdown conversion
- Existing `onContentChange` callback provides current content for comparison
- Existing `getContent()` method provides current editor state for saving/publishing
- Use existing `DraftStatusBanner` component for consistent visual feedback
- No new editor components needed - leverage existing sophisticated editor

**Files Modified:**
- `src/app/results/page.tsx` - Add editing logic that handles both published and draft articles
- `src/actions/actions.ts` - Add UPDATE operation for existing draft records
- No changes to editor components - use existing functionality

### 9. Testing strategy

**Unit tests:**
- Test schema validation with status field
- Test explanation creation with draft status
- Test rewrite operations create new drafts

**Integration tests:**
- Test full user workflow from query to draft creation
- Test vector search returns draft articles
- Test API responses include correct status

**Manual testing:**
- Verify draft visual indicators display correctly
- Test rewrite operations create separate draft articles
- Confirm existing published articles remain unchanged
