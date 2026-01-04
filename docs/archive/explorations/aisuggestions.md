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
- Modify ResultsLexicalEditor if needed to make this work, DO NOT create a new adapter

#### 3.3 Real-time Integration
- **Live Preview**: Show suggestions as overlay annotations
- **Accept/Reject**: Individual suggestion management
- **Bulk Actions**: Apply all suggestions at once

#### 3.4 Content Format Compatibility Plan
Support loading explanation_id onto EditorTest, pattern it after `/results`. Make sure that the following are working in terms of rendering.

## What `/src/app/results/` Does for Rendering

**Database Loading Process** (`src/app/results/page.tsx:217-319`):
```typescript
const loadExplanation = async (explanationId: number, clearPrompt: boolean, matches?: matchWithCurrentContentType[]) => {
    const explanation = await getExplanationByIdAction(explanationId);

    if (!explanation) {
        setError('Explanation not found');
        return;
    }

    setExplanationTitle(explanation.explanation_title);
    setContent(explanation.content);  // Raw markdown content from DB
    setSystemSavedId(explanation.id);
    setExplanationId(explanation.id);

    // Additional metadata loading (tags, vectors, etc.)
};
```

**ReactMarkdown Rendering Pipeline** (`src/app/results/page.tsx:1153-1204`):
- **Input**: Raw markdown string from `explanation.content` field in database
- **Plugins**: `remarkMath` for LaTeX parsing, `rehypeKatex` for math rendering
- **Output**: Styled HTML with custom component overrides

**Custom Component Rendering**:
```typescript
<ReactMarkdown
    remarkPlugins={[remarkMath]}
    rehypeKatex={[rehypeKatex]}
    components={{
        // Custom paragraph styling
        p: (props) => <div className="mt-1 mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">{props.children}</div>,

        // Custom heading hierarchy with specific styling
        h1: (props) => <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4 mt-0">{props.children}</h1>,
        h2: (props) => <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-3 mt-6">{props.children}</h2>,
        h3: (props) => <h3 className="text-xl font-medium text-gray-800 dark:text-gray-100 mb-2 mt-5">{props.children}</h3>,

        // Custom list styling with proper spacing
        ul: (props) => <ul className="my-4 space-y-2 list-disc list-inside text-gray-700 dark:text-gray-300">{props.children}</ul>,
        ol: (props) => <ol className="my-4 space-y-2 list-decimal list-inside text-gray-700 dark:text-gray-300">{props.children}</ol>,
        li: (props) => <li className="my-1 leading-relaxed">{props.children}</li>,

        // Code block styling
        code: (props) => <code className="bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded text-sm font-mono">{props.children}</code>,
        pre: (props) => <pre className="bg-gray-100 dark:bg-gray-700 p-4 rounded-lg overflow-x-auto my-4">{props.children}</pre>,

        // Blockquote styling
        blockquote: (props) => <blockquote className="border-l-4 border-blue-500 pl-4 my-4 italic text-gray-600 dark:text-gray-400">{props.children}</blockquote>,

        // Link handling with click interception
        a: (props) => (
            <a
                href={props.href}
                onClick={(e) => props.href && handleStandaloneTitleClick(props.href, e)}
                className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline cursor-pointer transition-colors"
            >
                {props.children}
            </a>
        )
    }}
>
    {formattedExplanation}
</ReactMarkdown>
```

**Content Processing Flow**:
1. **URL Parameter**: `/results?explanation_id=123`
2. **Database Query**: `getExplanationByIdAction(explanationId)`
3. **State Updates**: Title, content, metadata loaded into React state
4. **ReactMarkdown Rendering**: Raw markdown → Styled HTML with custom components
5. **Math Rendering**: LaTeX expressions processed by KaTeX
6. **Link Interception**: Special links get custom click handlers

## What `/src/app/editorTest/` Needs to Do

**Missing Functionality in Current EditorTest**:
- No explanation_id URL parameter handling
- No database loading capability
- Only uses hardcoded Einstein content
- No LaTeX/math rendering support in Lexical
- No equivalent of ReactMarkdown's custom component styling

**Required EditorTest Modifications**:

**1. URL Parameter Support**:
```typescript
// Add to editorTest page.tsx
useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const explanationId = urlParams.get('explanation_id');

    if (explanationId) {
        loadExplanationForTesting(parseInt(explanationId));
    }
}, []);
```

**2. Database Loading Function**:
```typescript
const loadExplanationForTesting = async (explanationId: number) => {
    try {
        // Reuse the same action from results page
        const explanation = await getExplanationByIdAction(explanationId);

        if (explanation && editorRef.current) {
            // Load into Lexical editor (replaces hardcoded Einstein content)
            editorRef.current.setContentFromMarkdown(explanation.content);
            setCurrentContent(explanation.content);
            setTestSetName(`explanation-${explanationId}-test`);

            console.log(`Loaded explanation ${explanationId}: "${explanation.explanation_title}"`);
        }
    } catch (error) {
        console.error('Failed to load explanation:', error);
        setError(`Failed to load explanation ${explanationId}`);
    }
};
```

**3. LexicalEditor Configuration for Content Compatibility**:
```typescript
// Add to LexicalEditor component configuration
const initialConfig = {
    namespace: 'lexical-editor',
    nodes: [
        // Standard nodes
        HeadingNode,
        ListNode,
        ListItemNode,
        QuoteNode,
        CodeNode,
        CodeHighlightNode,
        TableNode,
        TableCellNode,
        TableRowNode,

        // Math support
        MathNode,  // For LaTeX expressions

        // Link support
        LinkNode,
    ],
    // Other config...
};

// Add required plugins
<LexicalComposer initialConfig={initialConfig}>
    <MathPlugin />  {/* For LaTeX rendering */}
    <LinkPlugin />  {/* For link support */}
    <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
    {/* Other plugins... */}
</LexicalComposer>
```

**4. Visual Parity Testing**:
```typescript
// Add content format validation
const validateRenderingParity = (explanationId: number, content: string) => {
    const warnings: string[] = [];

    // Check for LaTeX expressions that need MathPlugin
    if (content.includes('$') || content.includes('\\(')) {
        warnings.push('LaTeX expressions detected - ensure MathPlugin renders correctly');
    }

    // Check for complex markdown structures
    if (content.includes('```')) {
        warnings.push('Code blocks detected - verify syntax highlighting');
    }

    if (content.includes('|')) {
        warnings.push('Tables detected - ensure proper rendering');
    }

    console.log(`Explanation ${explanationId} rendering validation:`, warnings);
    return warnings;
};
```

**5. Access Pattern**:
- **URL**: `/editorTest?explanation_id=123`
- **Flow**: URL → Database → Lexical Editor → AI Pipeline Testing
- **Goal**: Same visual output as `/results?explanation_id=123` but in editable Lexical format

**Success Criteria**:
- EditorTest displays identical content to Results page
- LaTeX expressions render correctly in Lexical
- All markdown formatting (headings, lists, code, quotes) displays properly
- Content can be loaded from any explanation_id in the database
- AI pipeline can process real explanation content (not just Einstein example)

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

### Step 6: Link Preservation Testing & Implementation
**Timeline**: 3-4 days
**Tasks**:
- [ ] Implement custom StandaloneTitleLinkNode for Lexical editor
- [ ] Create markdown transformer for `/standalone-title?t=` links
- [ ] Test markdown → Lexical → markdown roundtrip fidelity
- [ ] Validate links survive AI suggestion pipeline
- [ ] Add link format validation to content processing
- [ ] Test LaTeX expressions and code blocks preservation
- [ ] Implement NodeEventPlugin for custom link click handling

#### 6.1 Markdown ↔ Lexical Roundtrip Preservation
```typescript
// Custom LinkNode implementation
export class StandaloneTitleLinkNode extends LinkNode {
  static getType(): string {
    return 'standalone-title-link';
  }

  createDOM(config: EditorConfig): HTMLAnchorElement {
    const anchorElement = super.createDOM(config) as HTMLAnchorElement;
    anchorElement.className = 'text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 underline cursor-pointer transition-colors';

    anchorElement.onclick = (e: MouseEvent) => {
      e.preventDefault();
      this.handleStandaloneTitleClick(this.getURL());
    };

    return anchorElement;
  }

  private handleStandaloneTitleClick(href: string) {
    if (href.startsWith('/standalone-title?t=')) {
      const url = new URL(href, window.location.origin);
      const standaloneTitle = url.searchParams.get('t') || '';
      // Custom behavior for standalone title links
      console.log('Standalone title clicked:', standaloneTitle);
    }
  }
}
```

#### 6.2 AI Pipeline Link Preservation
```typescript
// Link preservation validation during AI pipeline
const validateLinkPreservation = (originalContent: string, processedContent: string): {
  success: boolean;
  issues: string[];
} => {
  const issues: string[] = [];

  // Extract links from both versions
  const originalLinks = extractLinks(originalContent);
  const processedLinks = extractLinks(processedContent);

  // Check for missing links
  const missingLinks = originalLinks.filter(link =>
    !processedLinks.some(pLink => pLink.url === link.url)
  );

  if (missingLinks.length > 0) {
    issues.push(`Missing links: ${missingLinks.map(l => l.url).join(', ')}`);
  }

  // Check for modified standalone title links
  const standaloneLinks = originalLinks.filter(link =>
    link.url.startsWith('/standalone-title?t=')
  );

  const processedStandaloneLinks = processedLinks.filter(link =>
    link.url.startsWith('/standalone-title?t=')
  );

  if (standaloneLinks.length !== processedStandaloneLinks.length) {
    issues.push('Standalone title links count mismatch');
  }

  return {
    success: issues.length === 0,
    issues
  };
};

function extractLinks(content: string): Array<{text: string; url: string}> {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: Array<{text: string; url: string}> = [];
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    links.push({
      text: match[1],
      url: match[2]
    });
  }

  return links;
}
```

#### 6.3 Custom Markdown Transformer
```typescript
// Custom transformer for standalone title links in Lexical
const STANDALONE_TITLE_LINK_TRANSFORMER = {
  dependencies: [StandaloneTitleLinkNode],
  export: (node: StandaloneTitleLinkNode) => {
    return `[${node.getTextContent()}](${node.getURL()})`;
  },
  importRegExp: /\[([^\]]+)\]\(\/standalone-title\?t=([^)]+)\)/,
  regExp: /\[([^\]]+)\]\(\/standalone-title\?t=([^)]+)\)$/,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    const [, linkText, encodedTitle] = match;
    const url = `/standalone-title?t=${encodedTitle}`;
    const linkNode = new StandaloneTitleLinkNode(url);
    const textChild = $createTextNode(linkText);
    linkNode.append(textChild);
    textNode.replace(linkNode);
  },
  trigger: ')',
  type: 'text-match',
};

// Integration with MarkdownShortcutPlugin
<MarkdownShortcutPlugin
  transformers={[...TRANSFORMERS, STANDALONE_TITLE_LINK_TRANSFORMER]}
/>
```

#### 6.4 Pipeline Integration with Link Validation
```typescript
// Enhanced AI pipeline with link preservation
async function runAISuggestionsWithLinkPreservation(
  currentContent: string,
  userId: string,
  onProgress?: (step: string, progress: number) => void
): Promise<{success: boolean; content?: string; linkIssues?: string[]}> {

  onProgress?.('Validating original links...', 10);
  const originalValidation = validateContentFormats(currentContent);

  onProgress?.('Generating AI suggestions...', 25);
  const suggestions = await generateAISuggestionsAction(currentContent, userId);

  onProgress?.('Applying suggestions...', 50);
  const editedContent = await applyAISuggestionsAction(suggestions, currentContent, userId);

  onProgress?.('Validating link preservation...', 60);
  const linkValidation = validateLinkPreservation(currentContent, editedContent);

  if (!linkValidation.success) {
    console.warn('Link preservation issues found:', linkValidation.issues);
  }

  onProgress?.('Generating diff...', 75);
  const criticMarkup = generateMarkdownASTDiff(currentContent, editedContent);

  onProgress?.('Preprocessing content...', 90);
  const preprocessed = preprocessCriticMarkup(criticMarkup);

  onProgress?.('Final link validation...', 95);
  const finalValidation = validateLinkPreservation(currentContent, preprocessed);

  onProgress?.('Complete', 100);

  return {
    success: finalValidation.success,
    content: preprocessed,
    linkIssues: finalValidation.issues
  };
}
```

### Step 7: Polish and Testing
**Timeline**: 2-3 days
**Tasks**:
- [ ] Comprehensive end-to-end testing
- [ ] Performance optimization and profiling
- [ ] Mobile responsiveness verification
- [ ] Accessibility and error handling refinement
- [ ] Link preservation regression testing
- [ ] Cross-browser compatibility testing for custom link components

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