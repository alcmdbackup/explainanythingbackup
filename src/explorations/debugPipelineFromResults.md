# Plan: AI Suggestions Database Integration for Debugging

## Overview

This document outlines a comprehensive plan to ensure AI suggestions generated on the results page can be selected from dropdowns and loaded from the database on the editorTest page for debugging purposes.

## Current State Analysis

### Results Page (`/src/app/results/`)
- Has a detached `AISuggestionsPanel` that generates AI suggestions
- Currently, suggestions are generated but not persisted to database
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
**Goal**: Extend the existing database to track AI suggestion sessions

#### 1.1 Add AI Suggestions Session Tracking
- Extend `TESTING_edits_pipeline` table or create new table for AI suggestion sessions
- Fields needed:
  - `session_id` (unique identifier for each AI suggestion session)
  - `explanation_id` (link to source explanation)
  - `user_prompt` (user's input prompt from AISuggestionsPanel)
  - `source_content` (original content before AI suggestions)
  - `generated_at` (timestamp)

#### 1.2 Link Sessions to Pipeline Steps
- Modify existing pipeline steps to include `session_id`
- This allows tracking which AI suggestions led to which pipeline results

### Phase 2: Enhance Results Page AI Suggestions Persistence
**Goal**: Save AI suggestions generated on results page to database

#### 2.1 Modify AISuggestionsPanel
- Add session tracking to capture each AI suggestion generation
- Generate unique session IDs for each suggestion request
- Store user prompts, source content, and results

#### 2.2 Enhance AI Pipeline Integration
- Modify `getAndApplyAISuggestions` to accept optional session metadata
- Save intermediate results (raw AI response, processed suggestions, final content)
- Link results to `explanation_id` and session information

#### 2.3 Add Results Page Database Actions
- Create new server actions for saving AI suggestion sessions
- Save to database when AI suggestions are generated successfully
- Include error handling and user feedback

### Phase 3: Enhance EditorTest Page Selection Interface
**Goal**: Allow loading AI suggestions from results page into editorTest

#### 3.1 Add AI Suggestions Session Dropdown
- New dropdown to select from AI suggestion sessions
- Filter by `explanation_id` when loaded via URL parameter
- Display session metadata (prompt, timestamp, source explanation)

#### 3.2 Create Session Loading Functions
- Load AI suggestion session data from database
- Populate editorTest with session's source content and pipeline results
- Use `session_id` for identifying and organizing pipeline data

#### 3.3 Integrate with Existing Pipeline
- When loading AI session, populate all 4 pipeline steps if available
- Allow continuing from any step in the pipeline
- Maintain existing dropdown functionality for step-by-step loading

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

## Technical Implementation Details

### Database Schema Extensions
```sql
-- New table for AI suggestion sessions
CREATE TABLE ai_suggestion_sessions (
    id SERIAL PRIMARY KEY,
    session_id UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    explanation_id INTEGER REFERENCES explanations(id),
    user_prompt TEXT NOT NULL,
    source_content TEXT NOT NULL,
    generated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB -- For storing additional session data
);

-- Link sessions to existing pipeline table
ALTER TABLE TESTING_edits_pipeline
ADD COLUMN session_id UUID REFERENCES ai_suggestion_sessions(session_id);
```

### Key Server Actions Needed
- `saveAISuggestionSessionAction` - Save new AI suggestion sessions
- `getAISuggestionSessionsAction` - Retrieve sessions for dropdowns
- `loadAISuggestionSessionAction` - Load specific session data
- `linkSessionToPipelineAction` - Connect sessions to pipeline steps

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
2. **Historical Tracking**: All AI suggestion attempts are preserved for analysis
3. **Cross-Reference Capability**: Link suggestions back to source explanations
4. **Pipeline Debugging**: Step-by-step analysis of AI processing pipeline
5. **User Experience**: Seamless transition between production use and debugging
6. **Data Analysis**: Aggregate data on AI suggestion patterns and effectiveness

## Data Flow Diagram

```
Results Page → AI Suggestions → Database Session
     ↓              ↓               ↓
User Content → AI Pipeline → Session Storage
     ↓              ↓               ↓
EditorTest ← Session Load ← Database Query
     ↓              ↓               ↓
Debug View → Pipeline Steps → Analysis Tools
```

## Success Metrics

- **Session Capture Rate**: Percentage of AI suggestions saved to database
- **Debug Usage**: Frequency of editorTest sessions loaded from results
- **Pipeline Analysis**: Number of complete pipeline debug sessions
- **Error Resolution**: Reduction in AI pipeline failures through debugging

This plan leverages the existing infrastructure while adding the missing persistence layer needed for effective debugging of AI suggestions across both pages.