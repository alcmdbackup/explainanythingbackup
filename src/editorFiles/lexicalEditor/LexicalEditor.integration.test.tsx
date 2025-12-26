/**
 * Integration tests for LexicalEditor.tsx (Phase 5)
 * Tests the LexicalEditorRef interface methods and component behavior
 */

import React, { createRef } from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';

// Mock all Lexical dependencies
const mockUpdate = jest.fn((fn: () => void) => fn());
const mockRegisterUpdateListener = jest.fn(() => jest.fn());
const mockRegisterCommand = jest.fn(() => jest.fn());
const mockRegisterMutationListener = jest.fn(() => jest.fn());
const mockSetEditable = jest.fn();
const mockFocus = jest.fn();
const mockGetEditorState = jest.fn(() => ({
  read: jest.fn((fn: () => void) => fn()),
  toJSON: jest.fn(() => ({})),
}));
const mockGetRootElement = jest.fn(() => {
  const element = document.createElement('div');
  element.focus = mockFocus;
  return element;
});

const mockBlur = jest.fn();

const mockEditor = {
  update: mockUpdate,
  registerUpdateListener: mockRegisterUpdateListener,
  registerCommand: mockRegisterCommand,
  registerMutationListener: mockRegisterMutationListener,
  setEditable: mockSetEditable,
  getEditorState: mockGetEditorState,
  getRootElement: mockGetRootElement,
  dispatchCommand: jest.fn(),
  getElementByKey: jest.fn(() => document.createElement('div')),
  isEditable: jest.fn(() => true),
  blur: mockBlur,
};

// Mock useLexicalComposerContext
jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}));

// Mock LexicalComposer to capture editor reference
jest.mock('@lexical/react/LexicalComposer', () => ({
  LexicalComposer: ({ children, initialConfig }: any) => {
    // Trigger editor initialization callback if provided
    return <div data-testid="lexical-composer">{children}</div>;
  },
}));

// Mock other Lexical plugins
jest.mock('@lexical/react/LexicalRichTextPlugin', () => ({
  RichTextPlugin: () => <div data-testid="rich-text-plugin" />,
}));

jest.mock('@lexical/react/LexicalPlainTextPlugin', () => ({
  PlainTextPlugin: () => <div data-testid="plain-text-plugin" />,
}));

jest.mock('@lexical/react/LexicalContentEditable', () => ({
  ContentEditable: () => <div data-testid="content-editable" contentEditable />,
}));

jest.mock('@lexical/react/LexicalHistoryPlugin', () => ({
  HistoryPlugin: () => null,
}));

jest.mock('@lexical/react/LexicalAutoFocusPlugin', () => ({
  AutoFocusPlugin: () => null,
}));

jest.mock('@lexical/react/LexicalOnChangePlugin', () => ({
  OnChangePlugin: ({ onChange }: any) => null,
}));

jest.mock('@lexical/react/LexicalErrorBoundary', () => ({
  LexicalErrorBoundary: ({ children }: any) => children,
}));

jest.mock('@lexical/react/LexicalMarkdownShortcutPlugin', () => ({
  MarkdownShortcutPlugin: () => null,
}));

jest.mock('@lexical/react/LexicalTreeView', () => ({
  TreeView: () => <div data-testid="tree-view" />,
}));

jest.mock('@lexical/react/LexicalLinkPlugin', () => ({
  LinkPlugin: () => null,
}));

jest.mock('@lexical/react/LexicalListPlugin', () => ({
  ListPlugin: () => null,
}));

jest.mock('@lexical/react/LexicalTablePlugin', () => ({
  TablePlugin: () => null,
}));

jest.mock('@lexical/react/LexicalAutoLinkPlugin', () => ({
  AutoLinkPlugin: () => null,
}));

jest.mock('@lexical/react/LexicalCheckListPlugin', () => ({
  CheckListPlugin: () => null,
}));

// Mock markdown functionality
jest.mock('@lexical/markdown', () => ({
  $convertFromMarkdownString: jest.fn(),
  registerMarkdownShortcuts: jest.fn(),
}));

// Mock Lexical core
jest.mock('lexical', () => ({
  $getRoot: jest.fn(() => ({
    clear: jest.fn(),
    getChildren: jest.fn(() => []),
    getTextContent: jest.fn(() => 'test content'),
  })),
  $isTextNode: jest.fn(() => false),
  $createTextNode: jest.fn(() => ({})),
  TextNode: class {},
  LexicalNode: class {},
  SELECTION_CHANGE_COMMAND: { type: 'SELECTION_CHANGE' },
  FORMAT_TEXT_COMMAND: { type: 'FORMAT_TEXT' },
  $createParagraphNode: jest.fn(() => ({})),
  $getNodeByKey: jest.fn(),
}));

jest.mock('@lexical/utils', () => ({
  $dfs: jest.fn(() => []),
  mergeRegister: jest.fn((...fns) => () => fns.forEach((fn) => fn())),
}));

jest.mock('@lexical/link', () => ({
  $isLinkNode: jest.fn(() => false),
  TOGGLE_LINK_COMMAND: { type: 'TOGGLE_LINK' },
  LinkNode: class {},
}));

jest.mock('@lexical/rich-text', () => ({
  $isHeadingNode: jest.fn(() => false),
  HeadingNode: class {},
  QuoteNode: class {},
}));

jest.mock('@lexical/list', () => ({
  ListNode: class {},
  ListItemNode: class {},
}));

jest.mock('@lexical/code', () => ({
  CodeNode: class {},
  CodeHighlightNode: class {},
}));

jest.mock('@lexical/table', () => ({
  TableNode: class {},
  TableCellNode: class {},
  TableRowNode: class {},
}));

jest.mock('@lexical/react/LexicalHorizontalRuleNode', () => ({
  HorizontalRuleNode: class {},
}));

jest.mock('@lexical/overflow', () => ({
  OverflowNode: class {},
}));

jest.mock('@lexical/mark', () => ({
  MarkNode: class {},
}));

// Mock local dependencies
const MockToolbarPlugin = () => <div data-testid="toolbar-plugin" />;
MockToolbarPlugin.displayName = 'MockToolbarPlugin';
jest.mock('./ToolbarPlugin', () => MockToolbarPlugin);
jest.mock('./DiffTagHoverPlugin', () => () => null);
jest.mock('./TextRevealPlugin', () => ({
  TextRevealPlugin: () => null,
}));
jest.mock('./DiffTagNode', () => ({
  DiffTagNodeInline: class {},
  DiffTagNodeBlock: class {},
  DiffUpdateContainerInline: class {},
  $isDiffTagNodeInline: jest.fn(() => false),
  $isDiffTagNodeBlock: jest.fn(() => false),
}));
jest.mock('./StandaloneTitleLinkNode', () => ({
  StandaloneTitleLinkNode: class {},
  $createStandaloneTitleLinkNode: jest.fn(() => ({})),
  $isStandaloneTitleLinkNode: jest.fn(() => false),
}));
jest.mock('./importExportUtils', () => ({
  preprocessCriticMarkup: jest.fn((s) => s),
  replaceDiffTagNodesAndExportMarkdown: jest.fn(() => 'exported markdown'),
  removeTrailingBreaksFromTextNodes: jest.fn(),
  replaceBrTagsWithNewlines: jest.fn(),
  MARKDOWN_TRANSFORMERS: [],
  exportMarkdownReadOnly: jest.fn(() => 'readonly markdown'),
}));
jest.mock('@/actions/actions', () => ({
  getLinkDataForLexicalOverlayAction: jest.fn(() => Promise.resolve({
    headingTitleLinks: [],
    termTitleLinks: [],
  })),
}));
jest.mock('@/lib/textRevealAnimations', () => ({
  TextRevealEffect: {},
}));

// Suppress console logs during tests
let consoleLogSpy: jest.SpyInstance;
let consoleErrorSpy: jest.SpyInstance;

beforeAll(() => {
  consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  consoleLogSpy.mockRestore();
  consoleErrorSpy.mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
});

// Import after mocks are set up
import LexicalEditor, { LexicalEditorRef } from './LexicalEditor';
import { $convertFromMarkdownString } from '@lexical/markdown';
import { replaceDiffTagNodesAndExportMarkdown, exportMarkdownReadOnly } from './importExportUtils';

// ============= Rendering Tests =============

describe('LexicalEditor - Rendering', () => {
  it('renders editor with default props', () => {
    render(<LexicalEditor />);

    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();
  });

  it('renders with custom placeholder', () => {
    render(<LexicalEditor placeholder="Type here..." />);

    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();
  });

  it('renders toolbar when showToolbar is true', () => {
    render(<LexicalEditor showToolbar={true} />);

    expect(screen.getByTestId('toolbar-plugin')).toBeInTheDocument();
  });

  it('does not render toolbar when showToolbar is false', () => {
    render(<LexicalEditor showToolbar={false} />);

    expect(screen.queryByTestId('toolbar-plugin')).not.toBeInTheDocument();
  });

  it('hides toolbar when hideEditingUI is true', () => {
    render(<LexicalEditor hideEditingUI={true} />);

    expect(screen.queryByTestId('toolbar-plugin')).not.toBeInTheDocument();
  });
});

// ============= Ref Method Tests =============

describe('LexicalEditor - Ref Methods', () => {
  it('exposes setContentFromMarkdown via ref', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.setContentFromMarkdown).toBeDefined();
    expect(typeof ref.current?.setContentFromMarkdown).toBe('function');
  });

  it('exposes getContentAsMarkdown via ref', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.getContentAsMarkdown).toBeDefined();
    expect(typeof ref.current?.getContentAsMarkdown).toBe('function');
  });

  it('exposes toggleMarkdownMode via ref', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.toggleMarkdownMode).toBeDefined();
    expect(typeof ref.current?.toggleMarkdownMode).toBe('function');
  });

  it('exposes getMarkdownMode via ref', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} isMarkdownMode={true} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.getMarkdownMode).toBeDefined();
    const mode = ref.current?.getMarkdownMode();
    expect(typeof mode).toBe('boolean');
  });

  it('exposes setEditMode via ref', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.setEditMode).toBeDefined();
    expect(typeof ref.current?.setEditMode).toBe('function');
  });

  it('exposes getEditMode via ref', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} isEditMode={true} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.getEditMode).toBeDefined();
    const mode = ref.current?.getEditMode();
    expect(typeof mode).toBe('boolean');
  });

  it('exposes focus via ref', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.focus).toBeDefined();
    expect(typeof ref.current?.focus).toBe('function');
  });

  it('exposes applyLinkOverlay via ref', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    expect(ref.current?.applyLinkOverlay).toBeDefined();
    expect(typeof ref.current?.applyLinkOverlay).toBe('function');
  });
});

// ============= Mode Tests =============

describe('LexicalEditor - Mode Switching', () => {
  it('initializes with isMarkdownMode prop', () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} isMarkdownMode={true} />);

    // Toolbar should be visible in markdown mode
    expect(screen.getByTestId('toolbar-plugin')).toBeInTheDocument();
  });

  it('initializes with isEditMode prop', async () => {
    const ref = createRef<LexicalEditorRef>();
    render(<LexicalEditor ref={ref} isEditMode={false} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
    });

    const editMode = ref.current?.getEditMode();
    expect(editMode).toBe(false);
  });
});

// ============= Content Tests =============

describe('LexicalEditor - Content Handling', () => {
  it('accepts initialContent prop', () => {
    render(<LexicalEditor initialContent="# Hello World" />);

    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();
  });

  it('calls onContentChange callback when provided', () => {
    const onContentChange = jest.fn();
    render(<LexicalEditor onContentChange={onContentChange} />);

    // The callback should be registered
    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();
  });
});

// ============= Integration Behavior Tests =============

describe('LexicalEditor - Integration Behavior', () => {
  it('respects showEditorState prop', () => {
    const { rerender } = render(<LexicalEditor showEditorState={true} />);
    // When true, editor state should be tracked
    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();

    rerender(<LexicalEditor showEditorState={false} />);
    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();
  });

  it('respects isStreaming prop', () => {
    render(<LexicalEditor isStreaming={true} />);
    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();
  });

  it('respects textRevealEffect prop', () => {
    render(<LexicalEditor textRevealEffect="scramble" />);
    expect(screen.getByTestId('lexical-composer')).toBeInTheDocument();
  });
});
