/**
 * Tests for ToolbarPlugin.tsx (Phase 5)
 * Tests toolbar rendering, button interactions, and command dispatching
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ToolbarPlugin from './ToolbarPlugin';
import { FORMAT_TEXT_COMMAND } from 'lexical';
import { TOGGLE_LINK_COMMAND } from '@lexical/link';
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from '@lexical/list';

// Mock createPortal to render children directly
jest.mock('react-dom', () => ({
  ...jest.requireActual('react-dom'),
  createPortal: (children: React.ReactNode) => children,
}));

// Mock the Lexical context
const mockDispatchCommand = jest.fn();
const mockUpdate = jest.fn((fn: () => void) => fn());
const mockRegisterUpdateListener = jest.fn(() => jest.fn());
const mockRegisterCommand = jest.fn(() => jest.fn());
const mockGetEditorState = jest.fn(() => ({
  read: jest.fn((fn: () => void) => fn()),
}));
const mockGetElementByKey = jest.fn();
const mockGetRootElement = jest.fn(() => document.createElement('div'));

const mockEditor = {
  dispatchCommand: mockDispatchCommand,
  update: mockUpdate,
  registerUpdateListener: mockRegisterUpdateListener,
  registerCommand: mockRegisterCommand,
  getEditorState: mockGetEditorState,
  getElementByKey: mockGetElementByKey,
  getRootElement: mockGetRootElement,
};

jest.mock('@lexical/react/LexicalComposerContext', () => ({
  useLexicalComposerContext: () => [mockEditor],
}));

// Mock $getSelection to return a range selection
jest.mock('lexical', () => {
  const actual = jest.requireActual('lexical');
  return {
    ...actual,
    $getSelection: jest.fn(() => ({
      anchor: {
        getNode: () => ({
          getKey: () => 'root',
          getTopLevelElementOrThrow: () => ({
            getKey: () => 'paragraph-1',
            getType: () => 'paragraph',
          }),
          getParent: () => null,
        }),
      },
      focus: { getNode: () => ({ getKey: () => 'root' }) },
      isBackward: () => false,
      hasFormat: jest.fn(() => false),
    })),
    $isRangeSelection: jest.fn(() => true),
  };
});

jest.mock('@lexical/link', () => ({
  $isLinkNode: jest.fn(() => false),
  TOGGLE_LINK_COMMAND: { type: 'TOGGLE_LINK_COMMAND' },
}));

jest.mock('@lexical/list', () => ({
  $isListNode: jest.fn(() => false),
  ListNode: class {},
  INSERT_ORDERED_LIST_COMMAND: { type: 'INSERT_ORDERED_LIST_COMMAND' },
  INSERT_UNORDERED_LIST_COMMAND: { type: 'INSERT_UNORDERED_LIST_COMMAND' },
  REMOVE_LIST_COMMAND: { type: 'REMOVE_LIST_COMMAND' },
}));

jest.mock('@lexical/rich-text', () => ({
  $isHeadingNode: jest.fn(() => false),
  $createHeadingNode: jest.fn(() => ({})),
  $createQuoteNode: jest.fn(() => ({})),
  HeadingNode: class {},
}));

jest.mock('@lexical/code', () => ({
  $isCodeNode: jest.fn(() => false),
  $createCodeNode: jest.fn(() => ({})),
  getDefaultCodeLanguage: jest.fn(() => 'javascript'),
  getCodeLanguages: jest.fn(() => ['javascript', 'python', 'typescript']),
  CodeNode: class {},
}));

jest.mock('@lexical/utils', () => ({
  mergeRegister: jest.fn((...fns) => () => fns.forEach((fn) => fn())),
  $getNearestNodeOfType: jest.fn(() => null),
}));

jest.mock('@lexical/selection', () => ({
  $wrapNodes: jest.fn(),
  $isAtNodeEnd: jest.fn(() => false),
}));

// Suppress console logs during tests
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterAll(() => {
  (console.log as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetElementByKey.mockReturnValue(document.createElement('div'));
});

// ============= Rendering Tests =============

describe('ToolbarPlugin - Rendering', () => {
  it('renders toolbar when isMarkdownMode is true', () => {
    render(<ToolbarPlugin isMarkdownMode={true} />);

    expect(screen.getByRole('button', { name: /format bold/i })).toBeInTheDocument();
  });

  it('renders toolbar by default (isMarkdownMode defaults to true)', () => {
    render(<ToolbarPlugin />);

    expect(screen.getByRole('button', { name: /format bold/i })).toBeInTheDocument();
  });

  it('does not render toolbar when isMarkdownMode is false', () => {
    const { container } = render(<ToolbarPlugin isMarkdownMode={false} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders all formatting buttons', () => {
    render(<ToolbarPlugin />);

    expect(screen.getByRole('button', { name: /format bold/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /format italics/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /format underline/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /format strikethrough/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /insert code/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /insert link/i })).toBeInTheDocument();
  });

  it('renders block type selector', () => {
    render(<ToolbarPlugin />);

    expect(screen.getByRole('button', { name: /formatting options/i })).toBeInTheDocument();
  });
});

// ============= Text Formatting Button Tests =============

describe('ToolbarPlugin - Text Formatting Buttons', () => {
  it('bold button dispatches FORMAT_TEXT_COMMAND with bold', () => {
    render(<ToolbarPlugin />);

    const boldButton = screen.getByRole('button', { name: /format bold/i });
    fireEvent.click(boldButton);

    expect(mockDispatchCommand).toHaveBeenCalledWith(
      FORMAT_TEXT_COMMAND,
      'bold'
    );
  });

  it('italic button dispatches FORMAT_TEXT_COMMAND with italic', () => {
    render(<ToolbarPlugin />);

    const italicButton = screen.getByRole('button', { name: /format italics/i });
    fireEvent.click(italicButton);

    expect(mockDispatchCommand).toHaveBeenCalledWith(
      FORMAT_TEXT_COMMAND,
      'italic'
    );
  });

  it('underline button dispatches FORMAT_TEXT_COMMAND with underline', () => {
    render(<ToolbarPlugin />);

    const underlineButton = screen.getByRole('button', { name: /format underline/i });
    fireEvent.click(underlineButton);

    expect(mockDispatchCommand).toHaveBeenCalledWith(
      FORMAT_TEXT_COMMAND,
      'underline'
    );
  });

  it('strikethrough button dispatches FORMAT_TEXT_COMMAND with strikethrough', () => {
    render(<ToolbarPlugin />);

    const strikethroughButton = screen.getByRole('button', { name: /format strikethrough/i });
    fireEvent.click(strikethroughButton);

    expect(mockDispatchCommand).toHaveBeenCalledWith(
      FORMAT_TEXT_COMMAND,
      'strikethrough'
    );
  });

  it('code button dispatches FORMAT_TEXT_COMMAND with code', () => {
    render(<ToolbarPlugin />);

    const codeButton = screen.getByRole('button', { name: /insert code/i });
    fireEvent.click(codeButton);

    expect(mockDispatchCommand).toHaveBeenCalledWith(
      FORMAT_TEXT_COMMAND,
      'code'
    );
  });
});

// ============= Link Button Tests =============

describe('ToolbarPlugin - Link Button', () => {
  it('link button dispatches TOGGLE_LINK_COMMAND with https://', () => {
    render(<ToolbarPlugin />);

    const linkButton = screen.getByRole('button', { name: /insert link/i });
    fireEvent.click(linkButton);

    expect(mockDispatchCommand).toHaveBeenCalledWith(
      TOGGLE_LINK_COMMAND,
      'https://'
    );
  });
});

// ============= Block Type Dropdown Tests =============

describe('ToolbarPlugin - Block Type Dropdown', () => {
  it('clicking block options button shows dropdown', () => {
    render(<ToolbarPlugin />);

    const blockOptionsButton = screen.getByRole('button', { name: /formatting options/i });
    fireEvent.click(blockOptionsButton);

    // Dropdown should now be visible with block type options
    // Use getAllByText since "Normal" appears in both toolbar button and dropdown
    expect(screen.getAllByText('Normal').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Large Heading')).toBeInTheDocument();
    expect(screen.getByText('Small Heading')).toBeInTheDocument();
    expect(screen.getByText('Bullet List')).toBeInTheDocument();
    expect(screen.getByText('Numbered List')).toBeInTheDocument();
    expect(screen.getByText('Quote')).toBeInTheDocument();
    expect(screen.getByText('Code Block')).toBeInTheDocument();
  });

  it('clicking Large Heading applies h1 format', async () => {
    render(<ToolbarPlugin />);

    // Open dropdown
    const blockOptionsButton = screen.getByRole('button', { name: /formatting options/i });
    fireEvent.click(blockOptionsButton);

    // Click Large Heading
    const largeHeadingButton = screen.getByText('Large Heading').closest('button');
    if (largeHeadingButton) {
      fireEvent.click(largeHeadingButton);
    }

    // Verify editor.update was called
    expect(mockUpdate).toHaveBeenCalled();
  });

  it('clicking Small Heading applies h2 format', async () => {
    render(<ToolbarPlugin />);

    const blockOptionsButton = screen.getByRole('button', { name: /formatting options/i });
    fireEvent.click(blockOptionsButton);

    const smallHeadingButton = screen.getByText('Small Heading').closest('button');
    if (smallHeadingButton) {
      fireEvent.click(smallHeadingButton);
    }

    expect(mockUpdate).toHaveBeenCalled();
  });

  it('clicking Bullet List dispatches INSERT_UNORDERED_LIST_COMMAND', () => {
    render(<ToolbarPlugin />);

    const blockOptionsButton = screen.getByRole('button', { name: /formatting options/i });
    fireEvent.click(blockOptionsButton);

    const bulletListButton = screen.getByText('Bullet List').closest('button');
    if (bulletListButton) {
      fireEvent.click(bulletListButton);
    }

    expect(mockDispatchCommand).toHaveBeenCalledWith(INSERT_UNORDERED_LIST_COMMAND);
  });

  it('clicking Numbered List dispatches INSERT_ORDERED_LIST_COMMAND', () => {
    render(<ToolbarPlugin />);

    const blockOptionsButton = screen.getByRole('button', { name: /formatting options/i });
    fireEvent.click(blockOptionsButton);

    const numberedListButton = screen.getByText('Numbered List').closest('button');
    if (numberedListButton) {
      fireEvent.click(numberedListButton);
    }

    expect(mockDispatchCommand).toHaveBeenCalledWith(INSERT_ORDERED_LIST_COMMAND);
  });

  it('clicking Quote applies quote format', () => {
    render(<ToolbarPlugin />);

    const blockOptionsButton = screen.getByRole('button', { name: /formatting options/i });
    fireEvent.click(blockOptionsButton);

    const quoteButton = screen.getByText('Quote').closest('button');
    if (quoteButton) {
      fireEvent.click(quoteButton);
    }

    expect(mockUpdate).toHaveBeenCalled();
  });

  it('clicking Code Block applies code format', () => {
    render(<ToolbarPlugin />);

    const blockOptionsButton = screen.getByRole('button', { name: /formatting options/i });
    fireEvent.click(blockOptionsButton);

    const codeBlockButton = screen.getByText('Code Block').closest('button');
    if (codeBlockButton) {
      fireEvent.click(codeBlockButton);
    }

    expect(mockUpdate).toHaveBeenCalled();
  });
});

// ============= Selection/State Tests =============

describe('ToolbarPlugin - Selection State', () => {
  it('registers update listener on mount', () => {
    render(<ToolbarPlugin />);

    expect(mockRegisterUpdateListener).toHaveBeenCalled();
  });

  it('registers selection change command on mount', () => {
    render(<ToolbarPlugin />);

    expect(mockRegisterCommand).toHaveBeenCalled();
  });
});
