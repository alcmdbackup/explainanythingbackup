# Plan: AI Suggestions Database Integration for Debugging

## Overview

This document outlines a comprehensive plan to ensure AI suggestions generated on the results page can be selected from dropdowns and loaded from the database on the editorTest page for debugging purposes.

## Current State Analysis

### Results Page (`/src/app/results/`)
- Has a detached `AISuggestionsPanel` that generates AI suggestions
- Uses `explanation_id` from URL parameters to load content
- AI suggestions are processed through the pipeline but results are ephemeral

### EditorTest Page (`/src/app/editorTest/`)
- Already has database integration with `TESTING_edits_pipeline` table
- Has 4-step pipeline that saves each step to database
- Has dropdown functionality to load previous results
- Can load content via `explanation_id` URL parameter
- Uses `saveTestingPipelineStepAction` to persist results

## Required Implementation Plan

### Phase 1: Enhance Database Schema
**Goal**: Extend the existing `TESTING_edits_pipeline` table to track AI suggestion sessions

#### 1.1 Add AI Suggestions Session Fields to Existing Table
- Extend `TESTING_edits_pipeline` table with additional fields:
  - `session_id` (unique identifier for each AI suggestion session)
  - `explanation_id` (link to source explanation)
  - `explanation_title` (explanation's title for display purposes)
  - `user_prompt` (user's input prompt from AISuggestionsPanel)
  - `source_content` (original content before AI suggestions)
  - `session_metadata` (JSON field for any additional session data)

#### 1.2 Use Session ID as Primary Grouping
- Modify existing `saveTestingPipelineStepAction` to accept `session_id` instead of arbitrary `set_name`
- Use `session_id` as the grouping identifier for all 4 pipeline steps
- Each pipeline step record will contain the full session metadata
- This allows tracking which AI suggestions led to which pipeline results without a separate table

### Phase 2: Enhance Results Page AI Suggestions Persistence
**Goal**: Save AI suggestions generated on results page to database

#### 2.1 Session Creation Strategy
- Generate a new `session_id` (UUID) at the start of each AI suggestion attempt
- Create session record immediately when user clicks "Get AI Suggestions"
- Do not attempt deduplication or session reuse - each attempt gets a fresh session

#### 2.2 Modify AISuggestionsPanel
- Generate `session_id` before calling AI pipeline
- Pass session metadata (explanation_id, explanation_title, user_prompt, source_content) to pipeline

#### 2.3 Enhance AI Pipeline Integration

**Current `getAndApplyAISuggestions` Function Signature:**
```typescript
async function getAndApplyAISuggestions(
  currentContent: string,
  editorRef: any, // LexicalEditorRef
  onProgress?: (step: string, progress: number) => void
): Promise<{ success: boolean; content?: string; error?: string }>
```

**Required Modifications:**
- Add session metadata parameters to function signature:
  ```typescript
  async function getAndApplyAISuggestions(
    currentContent: string,
    editorRef: any,
    sessionMetadata: {
      explanation_id: number;
      explanation_title: string;
      user_prompt: string;
    },
    onProgress?: (step: string, progress: number) => void
  ): Promise<{ success: boolean; content?: string; error?: string; session_id?: string }>
  ```

**Integration Steps:**
1. Generate `session_id` (UUID) at start of function
2. Save session to database via `saveAISuggestionSessionAction` before calling `runAISuggestionsPipeline`
3. Modify `runAISuggestionsPipeline` to accept `session_id` parameter
4. Update pipeline step saving to use `session_id` instead of hardcoded 'test-user' or arbitrary set names
5. Return `session_id` in success response for cross-page navigation

#### 2.4 Enhanced Pipeline Step Saving
- Modify pipeline step saving to include session metadata in each record
- No separate session creation needed - session data is embedded in pipeline steps
- First pipeline step save creates the session context, subsequent steps reuse it

### Phase 3: Enhance EditorTest Page Selection Interface
**Goal**: Allow loading AI suggestions from results page into editorTest

#### 3.1 Add AI Suggestions Session Dropdown
- New dropdown to select from distinct `session_id` values in pipeline table
- Filter by `explanation_id` when loaded via URL parameter
- Display session metadata from first pipeline step record (user_prompt, timestamp, explanation_title)

#### 3.2 Create Session Loading Functions
- Query pipeline table for all steps matching a `session_id`
- Extract session metadata from any pipeline step record (all contain same session data)
- Populate editorTest with session's source content and all available pipeline steps

#### 3.3 Integrate with Existing Pipeline
- Query `TESTING_edits_pipeline` table using `session_id` instead of `set_name`
- Load all 4 pipeline steps if available for the session
- Maintain existing dropdown functionality for step-by-step loading alongside new session loading
- Session loading takes priority: if `session_id` is provided, use that; otherwise fall back to existing `set_name` behavior

#### 3.4 EditorTest Integration Workflow
- Add new session dropdown above existing step dropdowns
- When session is selected, automatically populate all related pipeline steps
- Allow users to choose between "Load Session" (complete pipeline) or "Load Step" (individual steps)
- Clear existing step selections when a new session is loaded to avoid conflicts

### Phase 4: Cross-Page Navigation Enhancement
**Goal**: Seamless workflow between results and editorTest pages

#### 4.1 Add Debug Links in Results Page
- "Debug in EditorTest" button next to AI suggestions
- Generate direct links to editorTest with session parameters
- URL format: `/editorTest?explanation_id=123&session_id=456`

#### 4.2 Enhance EditorTest URL Parameter Handling
- Support `session_id` parameter for direct session loading
- Auto-populate pipeline when session is specified
- Maintain backward compatibility with existing `explanation_id` usage

### Phase 5: UI/UX Improvements for Debugging
**Goal**: Make debugging workflow intuitive and efficient

#### 5.1 Session Management Interface
- Session history view in both pages
- Ability to name/rename sessions
- Delete old sessions for cleanup

#### 5.2 Comparison Tools
- Side-by-side comparison of original vs. AI-modified content
- Diff visualization for debugging
- Export session data for analysis

#### 5.3 Error Tracking and Debugging
- Enhanced error logging with session context
- Pipeline step failure tracking
- Debugging information display

#### 5.4 Backward compatibility
Do not worry about existing explanations on EditorTest (pre-results integration) continuing to work

## Schema Migration Strategy

**Note**: Since we can delete the existing schema entirely and create a new one, the migration approach is simplified:

1. **Drop and Recreate**: Remove existing `TESTING_edits_pipeline` table and recreate with new schema
2. **No Data Migration**: Existing test data can be discarded as it's development/testing data
3. **Clean Slate**: Start fresh with the new `ai_suggestion_sessions` table and updated pipeline table

This eliminates the complexity of maintaining backward compatibility in the database layer, though the application code should still handle both old and new URL patterns gracefully.

## Technical Implementation Details

### Database Schema
```sql
-- Current schema for testing_edits_pipeline table with session support
CREATE TABLE testing_edits_pipeline (
    id SERIAL PRIMARY KEY,
    set_name VARCHAR(255) NOT NULL CHECK (set_name != ''),
    step VARCHAR(255) NOT NULL CHECK (step != ''),
    content TEXT NOT NULL CHECK (content != ''),
    session_id UUID,
    explanation_id INTEGER,
    explanation_title TEXT,
    user_prompt TEXT,
    source_content TEXT,
    session_metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for efficient querying
CREATE INDEX idx_testing_edits_pipeline_session_id ON testing_edits_pipeline(session_id);
CREATE INDEX idx_testing_edits_pipeline_explanation_id ON testing_edits_pipeline(explanation_id);
CREATE INDEX idx_testing_edits_set_name ON testing_edits_pipeline(set_name);
CREATE INDEX idx_testing_edits_step ON testing_edits_pipeline(step);

-- Note: Existing records with set_name will continue to work (backward compatibility)
-- New records from results page will use session_id with embedded metadata
```

### Key Server Actions Needed

**New Server Actions:**
- `getAISuggestionSessionsAction` - Retrieve distinct sessions from pipeline table for dropdowns
- `loadAISuggestionSessionAction` - Load all pipeline steps for a specific session_id

**Modified Existing Actions:**
- `saveTestingPipelineStepAction` - Current signature:
  ```typescript
  async function saveTestingPipelineStepAction(
    setName: string,
    step: string,
    content: string
  ): Promise<{ success: boolean; data: { saved: boolean; recordId?: number } | null; error: ErrorResponse | null }>
  ```

  **Required Changes:**
  - Add session metadata parameters for AI suggestion sessions
  - Maintain backward compatibility with existing `setName` usage
  - New signature:
  ```typescript
  async function saveTestingPipelineStepAction(
    setName: string,
    step: string,
    content: string,
    sessionData?: {
      session_id: string;
      explanation_id: number;
      explanation_title: string;
      user_prompt: string;
      source_content: string;
    }
  ): Promise<{ success: boolean; data: { saved: boolean; recordId?: number } | null; error: ErrorResponse | null }>
  ```

### URL Parameter Patterns
- Results page: `/results?explanation_id=123` (existing)
- EditorTest with explanation: `/editorTest?explanation_id=123` (existing)
- EditorTest with session: `/editorTest?explanation_id=123&session_id=uuid`
- EditorTest direct session: `/editorTest?session_id=uuid`

### Implementation Priority

#### High Priority (MVP)
1. **Database Schema Creation**: Create `ai_suggestion_sessions` table
2. **Results Page Session Saving**: Persist AI suggestions when generated
3. **EditorTest Session Loading**: Basic dropdown to load saved sessions
4. **URL Parameter Support**: Support `session_id` in editorTest URLs

#### Medium Priority
1. **Cross-Page Navigation**: "Debug in EditorTest" buttons
2. **Session Metadata**: Enhanced session information and naming
3. **Pipeline Integration**: Link sessions to all 4 pipeline steps
4. **Error Handling**: Robust error tracking and recovery

#### Low Priority (Polish)
1. **Session Management**: Delete, rename, organize sessions
2. **Comparison Tools**: Visual diff and analysis tools
3. **Data Export**: Export session data for external analysis
4. **Performance**: Optimize queries and UI for large session counts

## Benefits of This Approach

1. **Complete Debugging Workflow**: Generated AI suggestions can be systematically tested
2. **Historical Tracking**: All AI suggestion attempts are preserved for analysis within existing pipeline table
3. **Cross-Reference Capability**: Link suggestions back to source explanations via embedded metadata
4. **Pipeline Debugging**: Step-by-step analysis of AI processing pipeline
5. **User Experience**: Seamless transition between production use and debugging
6. **Simplified Architecture**: No separate session table needed - all data embedded in pipeline records
7. **Data Analysis**: Aggregate data on AI suggestion patterns and effectiveness

## Data Flow Diagram

```
Results Page → AI Suggestions → Pipeline Records (with embedded session data)
     ↓              ↓               ↓
User Content → AI Pipeline → TESTING_edits_pipeline table
     ↓              ↓               ↓
EditorTest ← Session Load ← Query by session_id
     ↓              ↓               ↓
Debug View → Pipeline Steps → Analysis Tools
```

## Success Metrics

- **Session Capture Rate**: Percentage of AI suggestions saved to database
- **Debug Usage**: Frequency of editorTest sessions loaded from results
- **Pipeline Analysis**: Number of complete pipeline debug sessions
- **Error Resolution**: Reduction in AI pipeline failures through debugging

This plan leverages the existing infrastructure while adding the missing persistence layer needed for effective debugging of AI suggestions across both pages.