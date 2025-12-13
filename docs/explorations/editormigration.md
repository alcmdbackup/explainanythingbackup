# Migration Plan: Results → Lexical Editor

## Overview
Plan to replace the content rendering on `/src/app/results/` with the lexical editor from `/src/app/editorTest/`. Both implementations load content similarly from the backend by explanation ID.

## Phase 1: Extract and Prepare Components

### Extract Lexical Components from editorTest:
- `LexicalEditor.tsx` - Main editor component
- `importExportUtils.ts` - Markdown conversion utilities
- `DiffTagNode.ts` - Custom change tracking nodes
- `ToolbarPlugin.tsx` - Editor toolbar
- Related plugins and theme files

### Create Editor Integration Layer:
- Wrapper component to bridge results page state with Lexical
- Edit/view mode toggle functionality
- Content loading interface. Do NOT worry about content saving yet. 

## Phase 2: Replace Content Rendering Section

### Identify ReactMarkdown Section in results `page.tsx`:
- **Current**: `<ReactMarkdown>` with math plugins and custom components
- **Replace with**: `<LexicalEditor>` component

### Preserve All Existing Features:
- Keep Navigation, TagBar, user library, match discovery
- Maintain all 46+ useState hooks for non-editor functionality
- Preserve authentication, URL parameter processing, tag management

### Update Content Loading:
- Modify `loadExplanation()` to load into Lexical editor instead of React state
- Use `editorRef.current.setContentFromMarkdown()` pattern from editorTest
- Maintain backward compatibility with existing explanation IDs

## Phase 3: Feature Parity & Integration

### Styling Alignment:
- Lexical editor already matches results page theme
- Ensure consistent spacing and layout with current results design

### Missing Features Integration:
- Do not touch the tag/rewrite functionality. Do NOT implement the ai edits pipeline from EditorTest.
- **Edit Modes**: Implement view/edit toggle (lexical has read-only mode)

### State Management Bridge:
- Connect Lexical editor state with existing results page state management
- Ensure content changes sync with `content` state variable

## Phase 4: Streaming Updates Integration

### Streaming Content Updates:
- Wrapper component detects content changes from results page state
- Convert streaming markdown to Lexical format using `setContentFromMarkdown()`
- Apply incremental updates without losing cursor position when possible
- **CRITICAL**: Enable read-only mode (locked) during streaming to prevent user edit conflicts
- Use debounced updates to handle rapid streaming content efficiently
- Preserve vector similarity features by maintaining existing state management

## Phase 5: Testing & Cleanup

### Functionality Testing:
- Content loading by explanation ID
- Tag system integration
- AI suggestion/rewriting workflows
- User library operations
- Match discovery features

### Performance Validation:
- Editor loading time with large content
- Memory usage with complex documents
- Rendering performance vs ReactMarkdown

## Key Technical Considerations

### Same Backend:
Both use `getExplanationByIdAction()` - no backend changes needed

### Editor State:
Lexical manages its own state - results page manages everything else

### Content Format:
Both handle markdown - conversion utilities already exist in editorTest

### Dependencies:
Lexical framework will be new dependency for results page

## Current Implementation Analysis

### Results Directory (`/src/app/results/page.tsx`)
- **Content Loading**: `loadExplanation(explanationId)` → `getExplanationByIdAction()` → ReactMarkdown
- **Rendering**: ReactMarkdown with `remarkMath`, `rehypeKatex`, custom components
- **State**: 46+ useState hooks for comprehensive functionality
- **Features**: Tags, user library, match discovery, AI rewriting, mode switching

### EditorTest Directory (`/src/app/editorTest/page.tsx`)
- **Content Loading**: `loadExplanationForTesting(explanationId)` → `getExplanationByIdAction()` → Lexical editor
- **Rendering**: Lexical framework with rich text, DiffTag nodes, comprehensive plugins
- **Features**: AI pipeline (4 steps), content validation, testing UI, change tracking

## Migration Summary

The migration essentially replaces only the content display area while preserving all other results page functionality. The lexical editor provides enhanced editing capabilities while maintaining the same content loading and management system.

**Data Flow Change**:
- **Before**: URL params → `loadExplanation()` → Database → State → ReactMarkdown → Rendered content
- **After**: URL params → `loadExplanation()` → Database → Lexical Editor → Rich text editing