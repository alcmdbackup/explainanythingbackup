# Lexical Editor Integration Plan for Results Page

## Overview

**REVISED PLAN** - This document outlines the refined plan to integrate the Lexical editor into the results page using a single editor instance that dynamically toggles between display and edit modes, based on feedback from aisuggestions_critique_1.md and readonly_mode.md.

**Key Change**: Instead of maintaining dual rendering systems, we'll use one Lexical editor instance with proper read-only/edit mode switching and styling to achieve seamless display-to-edit transitions.

## Current State Analysis

### EditorTest Page (`src/app/editorTest/page.tsx`)
- **Purpose**: Testing environment for the complete AI editing pipeline
- **Features**: 4-step workflow (AI suggestions → Apply suggestions → AST diff → Preprocessing → Editor update)
- **Components**: LexicalEditor with full toolbar, markdown mode toggle, and debugging views
- **AI Integration**: Complete pipeline from suggestion generation to CriticMarkup processing

### Results Page (`src/app/results/page.tsx`)
- **Purpose**: Display AI-generated explanations with editing capabilities
- **Current Editor**: ReactMarkdown with custom styling for content display
- **Editing Features**: Rewrite functionality, tag-based editing, save to library
- **Layout**: Responsive design with toolbar, content area, and tag management

### Lexical Editor (`src/editorFiles/lexicalEditor/LexicalEditor.tsx`)
- **Architecture**: Modular plugin system with rich text and plain text modes
- **Key Features**: Markdown support, CriticMarkup handling, diff visualization
- **API**: Exposed methods for content manipulation and mode switching
- **Customization**: Theme support, toolbar configuration, debugging options

### AI Suggestions Workflow (`src/editorFiles/aiSuggestion.ts`)
- **Pipeline**: 4-step process with database persistence
- **Schema**: Structured output with alternating content/marker pattern
- **Processing**: Validation, merging, and application of AI edits
- **Integration**: Server actions for suggestion generation and application

## Integration Architecture

### Phase 1: Single Editor Display Mode Implementation

#### 1.1 Enhanced LexicalEditor Component
Extend the existing LexicalEditor component with display mode capabilities:
```typescript
interface LexicalEditorProps {
  // Existing props...
  isDisplayMode?: boolean;
  onEditModeToggle?: () => void;
  showToolbar?: boolean;
  hideEditingUI?: boolean;
}
```

#### 1.2 Display Mode Implementation Strategy
Based on readonly_mode.md feedback, use Lexical's built-in capabilities:

- **Read-Only Mode**: Use `editor.setEditable(false)` to disable editing completely
- **Visual Styling**: Apply custom CSS to match ReactMarkdown appearance
- **Cursor Control**: `caret-color: transparent` and `contentEditable=false` prevent cursor
- **Focus Management**: Use `editor.blur()` and focus control for seamless transitions

#### 1.3 Display Mode Plugin
```typescript
function DisplayModePlugin({ isDisplayMode }: { isDisplayMode: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    editor.setEditable(!isDisplayMode);
    if (isDisplayMode) {
      editor.blur(); // Remove focus and cursor
    }
  }, [editor, isDisplayMode]);

  return null;
}
```

#### 1.4 Styling for Display Mode
```css
/* Display mode styling to match ReactMarkdown */
.lexical-display-mode {
  border: none;
  background: transparent;
  padding: 0;
  caret-color: transparent;
}

.lexical-display-mode .ContentEditable__root {
  cursor: default;
  outline: none;
}

.lexical-display-mode .ContentEditable__root:focus {
  outline: none;
  border: none;
}

/* Hide toolbar in display mode */
.lexical-display-mode .lexical-toolbar {
  display: none;
}
```

### Phase 2: Edit Mode Activation

#### 2.1 Mode Switching Infrastructure
```typescript
interface EditModeState {
  isEditMode: boolean;
  toggleEditMode: () => void;
  editorRef: React.RefObject<LexicalEditorRef>;
}

// Custom hook for managing edit mode state
function useEditMode(initialMode = false) {
  const [isEditMode, setIsEditMode] = useState(initialMode);
  const editorRef = useRef<LexicalEditorRef>(null);

  const toggleEditMode = useCallback(() => {
    setIsEditMode(prev => {
      const newMode = !prev;
      // Apply mode change to editor
      if (editorRef.current) {
        editorRef.current.setDisplayMode(!newMode);
        if (newMode) {
          // Focus editor when entering edit mode
          editorRef.current.focus();
        }
      }
      return newMode;
    });
  }, []);

  return { isEditMode, toggleEditMode, editorRef };
}
```

#### 2.2 Toggle Button Integration
```jsx
function EditModeToggle({ isEditMode, onToggle }: EditModeToggleProps) {
  return (
    <button
      onClick={onToggle}
      className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm bg-white hover:bg-gray-50 focus:ring-2 focus:ring-blue-500"
    >
      {isEditMode ? (
        <>
          <CheckIcon className="-ml-1 mr-2 h-4 w-4" />
          Done Editing
        </>
      ) : (
        <>
          <PencilIcon className="-ml-1 mr-2 h-4 w-4" />
          Edit
        </>
      )}
    </button>
  );
}
```

#### 2.3 Enhanced Editor Configuration
- **Dynamic Editable State**: Use `editor.setEditable()` for runtime toggling
- **Conditional Toolbar**: Show/hide toolbar based on edit mode
- **Auto-focus**: Focus management when entering edit mode
- **Content Preservation**: Maintain editor state across mode switches

### Phase 3: AI Suggestions Panel

#### 3.1 Side Panel Layout
```jsx
<div className="editor-layout">
  <div className="main-content">
    <LexicalEditor {...editorProps} />
  </div>
  <div className="suggestions-panel">
    <AISuggestionsPanel />
  </div>
</div>
```

#### 3.2 Suggestions Panel Features
- **Input Area**: Text input for user prompts/instructions
- **Submit Button**: Trigger AI suggestion generation
- **Loading States**: Visual feedback during AI processing

#### 3.3 Real-time Integration
- **Live Preview**: Show suggestions as overlay annotations
- **Accept/Reject**: Individual suggestion management
- **Bulk Actions**: Apply all suggestions at once

#### 3.4 Content Format Compatibility Plan
Based on how `src/app/results/page.tsx` renders content with ReactMarkdown, the AI pipeline must handle:

**Link Preservation Strategy**:
- Detect and preserve all existing markdown links: `[text](url)`
- Maintain special internal links like `/standalone-title?t=...` exactly
- Avoid breaking relative path references
- Preserve anchor links and URL parameters
- Test link functionality after AI processing

**LaTeX/Math Expression Handling**:
- Preserve inline math: `$equation$` notation for KaTeX rendering
- Preserve display math: `$$equation$$` blocks
- Maintain proper spacing around mathematical expressions
- Never modify mathematical symbols unless correcting actual errors
- Test math rendering with `remarkMath` and `rehypeKatex` plugins

**Rich Content Structure Preservation**:
- **Code**: Maintain inline `code` and code blocks with ```language syntax
- **Lists**: Preserve bullet (-) and numbered (1.) list formatting and nesting
- **Headers**: Keep heading hierarchy (# ## ### etc.) intact
- **Blockquotes**: Preserve > prefix formatting
- **Emphasis**: Maintain *italic* and **bold** markdown syntax
- **Tables**: Preserve table structure if present

**Implementation Strategy**:
- Add content format validation to AI prompt generation
- Include preservation rules in both suggestion and apply prompts
- Create post-processing validation to check for broken formatting
- Add automated tests for common formatting edge cases

### Phase 4: Unified AI Pipeline with Simple Error Handling

#### 4.1 Functional Pipeline Implementation
```typescript
async function runAISuggestionsPipeline(
  currentContent: string,
  userId: string,
  onProgress?: (step: string, progress: number) => void
): Promise<string> {
  onProgress?.('Generating AI suggestions...', 25);
  const suggestions = await generateAISuggestionsAction(currentContent, userId);

  onProgress?.('Applying suggestions...', 50);
  const editedContent = await applyAISuggestionsAction(suggestions, currentContent, userId);

  onProgress?.('Generating diff...', 75);
  const criticMarkup = generateMarkdownASTDiff(currentContent, editedContent);

  onProgress?.('Preprocessing content...', 90);
  const preprocessed = preprocessCriticMarkup(criticMarkup);

  onProgress?.('Complete', 100);
  return preprocessed;
}

async function getAndApplyAISuggestions(
  userPrompt: string,
  currentContent: string,
  editorRef: LexicalEditorRef,
  onProgress?: (step: string, progress: number) => void
): Promise<{ success: boolean; content?: string; error?: string }> {
  try {
    // Run the entire pipeline - original content stays untouched until success
    const finalContent = await runAISuggestionsPipeline(currentContent, 'test-user', onProgress);

    // Only update editor if all steps succeeded
    if (editorRef.current) {
      editorRef.current.setContentFromMarkdown(finalContent);
    }

    return { success: true, content: finalContent };

  } catch (error) {
    console.error('AI Pipeline failed:', error);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'AI processing failed',
      content: currentContent // Original content is unchanged
    };
  }
}
```

#### 4.2 Progress UI Integration
```typescript
function AIProcessingOverlay({
  isVisible,
  currentStep,
  progress
}: {
  isVisible: boolean;
  currentStep: string;
  progress: number;
}) {
  if (!isVisible) return null;

  return (
    <div className="absolute inset-0 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
        <div className="text-center">
          <div className="mb-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          </div>
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            Processing AI Suggestions
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {currentStep}
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">{progress}% complete</p>
        </div>
      </div>
    </div>
  );
}
```

## Implementation Roadmap

### Step 1: Single Editor Display Mode Implementation
**Timeline**: 2-3 days
**Tasks**:
- [ ] Create DisplayModePlugin for editor state management
- [ ] Implement CSS styling to match ReactMarkdown appearance
- [ ] Add editor.setEditable() and cursor control
- [ ] Test visual parity with current results page

### Step 2: Edit Mode Toggle Integration
**Timeline**: 1-2 days
**Tasks**:
- [ ] Create useEditMode custom hook
- [ ] Implement EditModeToggle component
- [ ] Add smooth transitions and focus management
- [ ] Test mode switching performance

### Step 3: Results Page Integration
**Timeline**: 2-3 days
**Tasks**:
- [ ] Replace ReactMarkdown with single LexicalEditor instance
- [ ] Preserve all existing styling and responsive design
- [ ] Integrate with current rewrite/save functionality
- [ ] Ensure compatibility with existing content processing

### Step 4a: AI Panel UI Shell
**Timeline**: 1-2 days
**Tasks**:
- [ ] Create basic AISuggestionsPanel component
- [ ] Implement input field and submit button
- [ ] Add loading states and basic error display
- [ ] Test UI interactions without AI integration

### Step 4b: AI Panel Integration
**Timeline**: 1 day
**Tasks**:
- [ ] Connect panel to editor component state
- [ ] Implement panel-to-editor communication
- [ ] Add panel show/hide functionality
- [ ] Test panel state synchronization

### Step 5a: Pipeline Function Implementation
**Timeline**: 1 day
**Tasks**:
- [ ] Create runAISuggestionsPipeline function
- [ ] Implement getAndApplyAISuggestions with simple error handling
- [ ] Add progress callback support
- [ ] Test pipeline flow with mock data

### Step 5b: Pipeline Mocks & Testing Infrastructure
**Timeline**: 1 day
**Tasks**:
- [ ] Create mock implementations for all AI pipeline steps
- [ ] Implement mockAISuggestions utility functions
- [ ] Add configurable mock/real mode switching
- [ ] Test full pipeline flow with mocked AI calls

### Step 4c: Simple Suggestions Display
**Timeline**: 1-2 days
**Tasks**:
- [ ] Display AI suggestions in text format in panel
- [ ] Add accept/reject buttons for suggestions
- [ ] Implement basic suggestion application to editor
- [ ] Test suggestion workflow with mocked data

### Step 5c: Content Format Compatibility Implementation
**Timeline**: 1 day
**Tasks**:
- [ ] Enhance AI prompts with content preservation guidelines
- [ ] Add post-processing validation for links, math, and formatting
- [ ] Create test cases for LaTeX expressions, links, and code blocks
- [ ] Implement format validation in pipeline steps

### Step 5d: Real AI Integration
**Timeline**: 1-2 days
**Tasks**:
- [ ] Replace mocks with real AI service calls in pipeline
- [ ] Add proper error handling for AI service failures
- [ ] Implement progress tracking with real AI latencies
- [ ] Test end-to-end pipeline with actual AI services and format preservation

### Step 4d: Advanced Overlay Annotations
**Timeline**: 2-3 days
**Tasks**:
- [ ] Implement real-time suggestion overlays in editor
- [ ] Add visual diff highlighting for suggested changes
- [ ] Create interactive accept/reject overlay controls
- [ ] Test complex overlay interactions and performance

### Step 6: Polish and Testing
**Timeline**: 2-3 days
**Tasks**:
- [ ] Comprehensive end-to-end testing
- [ ] Performance optimization and profiling
- [ ] Mobile responsiveness verification
- [ ] Accessibility and error handling refinement

## Technical Considerations

### Single Editor Architecture Benefits
- **Consistent State**: One source of truth for content eliminates sync issues
- **Memory Efficiency**: No dual rendering systems or content duplication
- **Simplified Logic**: Mode switching handled by Lexical's built-in capabilities
- **Format Preservation**: No markdown ↔ HTML conversion losses

### Performance Optimization
- **Editor Reuse**: Single editor instance across mode switches
- **Minimal DOM Changes**: Only styling and editable state changes
- **Bundle Size**: Smaller footprint than dual rendering approach
- **Memory Management**: Lexical's built-in state management

### Accessibility & UX
- **Keyboard Navigation**: Proper focus management in both modes
- **Screen Readers**: ARIA states for edit/display mode announcements
- **Visual Indicators**: Clear UI cues for current mode
- **Mobile Optimization**: Touch-friendly edit mode toggle

### Browser Compatibility
- **Modern Browsers**: Full Lexical support (Chrome, Firefox, Safari, Edge)
- **Fallback Strategy**: Graceful degradation to plain text editing
- **Mobile Support**: Native contentEditable behavior on touch devices

### Content State Management
```typescript
interface EditorContentState {
  content: string;           // Current markdown content
  isEditMode: boolean;       // Current mode
  isDirty: boolean;          // Unsaved changes flag
  version: number;           // Content version for conflict resolution
}

// Centralized state management
class EditorStateManager {
  private state: EditorContentState;
  private editorRef: React.RefObject<LexicalEditorRef>;

  toggleMode() {
    this.state.isEditMode = !this.state.isEditMode;
    this.syncEditorMode();
  }

  private syncEditorMode() {
    if (this.editorRef.current) {
      this.editorRef.current.setDisplayMode(!this.state.isEditMode);
    }
  }

  getContent(): string {
    return this.editorRef.current?.getContentAsMarkdown() || this.state.content;
  }
}
```

## Migration Strategy

### Gradual Rollout
1. **Feature Flag**: Implement behind feature toggle
2. **A/B Testing**: Compare new editor with existing implementation
3. **Phased Migration**: Start with specific content types
4. **Full Deployment**: Complete migration after validation

### Backward Compatibility
- **Existing Content**: Ensure all existing content renders correctly
- **URL Handling**: Maintain current URL structure and parameters
- **API Compatibility**: No breaking changes to existing APIs

## Success Metrics

### User Experience
- **Mode Switching**: < 50ms transition (no content re-rendering)
- **Content Parity**: 100% visual consistency with current ReactMarkdown display
- **AI Integration**: < 3 seconds with progress indicators
- **Error Recovery**: 100% rollback success rate on pipeline failures
- **Edit Mode Discovery**: Clear visual cues for edit functionality

### Performance
- **Mode Toggle**: < 50ms (styling and editable state only)
- **Memory Usage**: Reduced overhead (single editor instance)
- **Bundle Size**: Minimal increase (no dual rendering)
- **Content Processing**: Zero conversion losses between modes

### Functionality
- **Content Preservation**: Perfect fidelity across mode switches
- **Pipeline Reliability**: Transaction-based error handling
- **Mobile Support**: Native touch interaction in edit mode
- **Accessibility**: Proper mode announcements for screen readers
- **Offline Support**: Full functionality without network dependency

## Risk Mitigation

### Technical Risks
- **Editor Complexity**: Extensive testing of Lexical editor edge cases
- **Content Corruption**: Robust validation and backup mechanisms
- **Performance Impact**: Careful monitoring of bundle size and runtime performance

### User Experience Risks
- **Learning Curve**: Gradual introduction with clear UI cues
- **Feature Discoverability**: Prominent edit mode toggle and help text
- **Mobile Experience**: Thorough testing on mobile devices

### Deployment Risks
- **Rollback Strategy**: Ability to quickly revert to ReactMarkdown
- **Gradual Rollout**: Phased deployment to minimize impact
- **Monitoring**: Comprehensive logging and error tracking

## Conclusion

**REVISED APPROACH**: This refined integration plan leverages Lexical's built-in read-only capabilities, a single editor instance, and a simple functional AI pipeline to achieve seamless display-to-edit transitions without unnecessary complexity.

**Key Benefits of This Approach**:
- **Simplified Architecture**: One editor instance eliminates content synchronization issues
- **Better Performance**: No dual rendering overhead or format conversion losses
- **Functional Pipeline**: Simple, testable functions instead of complex transaction management
- **Natural Error Handling**: Original content remains untouched until pipeline succeeds
- **Easier Maintenance**: Single code path for content handling and straightforward function composition
- **Improved UX**: Instant mode switching with perfect content preservation

**Implementation Priority**: Start with basic display/edit mode toggle, then progressively enhance with AI suggestions panel and functional pipeline. This approach provides immediate value while building toward the full vision.

**Next Steps**: Steps 1-2 are complete (DisplayModePlugin and EditModeToggle). Next: implement the simple functional AI pipeline.