/**
 * Unit tests for RawMarkdownEditor component.
 * Tests the simple textarea-based raw markdown editor.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { RawMarkdownEditor } from '@/components/RawMarkdownEditor';

describe('RawMarkdownEditor', () => {
  it('should render with provided content', () => {
    const content = '# Heading\n\n**Bold** text';
    render(
      <RawMarkdownEditor
        content={content}
        onChange={jest.fn()}
        isEditMode={false}
      />
    );

    const textarea = screen.getByTestId('raw-markdown-editor');
    expect(textarea).toHaveValue(content);
  });

  it('should be read-only when not in edit mode', () => {
    render(
      <RawMarkdownEditor
        content="test"
        onChange={jest.fn()}
        isEditMode={false}
      />
    );

    const textarea = screen.getByTestId('raw-markdown-editor');
    expect(textarea).toHaveAttribute('readonly');
  });

  it('should be editable when in edit mode', () => {
    render(
      <RawMarkdownEditor
        content="test"
        onChange={jest.fn()}
        isEditMode={true}
      />
    );

    const textarea = screen.getByTestId('raw-markdown-editor');
    expect(textarea).not.toHaveAttribute('readonly');
  });

  it('should call onChange when content is edited', () => {
    const onChange = jest.fn();
    render(
      <RawMarkdownEditor
        content="original"
        onChange={onChange}
        isEditMode={true}
      />
    );

    const textarea = screen.getByTestId('raw-markdown-editor');
    fireEvent.change(textarea, { target: { value: 'new content' } });

    expect(onChange).toHaveBeenCalledWith('new content');
  });

  it('should show placeholder when provided', () => {
    render(
      <RawMarkdownEditor
        content=""
        onChange={jest.fn()}
        isEditMode={false}
        placeholder="Custom placeholder"
      />
    );

    const textarea = screen.getByTestId('raw-markdown-editor');
    expect(textarea).toHaveAttribute('placeholder', 'Custom placeholder');
  });

  it('should show raw markdown without parsing', () => {
    // The key behavior: raw markdown characters should be visible, not rendered
    const rawMarkdown = '# Heading\n**bold** *italic* `code`\n- list item';
    render(
      <RawMarkdownEditor
        content={rawMarkdown}
        onChange={jest.fn()}
        isEditMode={false}
      />
    );

    const textarea = screen.getByTestId('raw-markdown-editor');
    // Verify the raw markdown is displayed as-is
    expect(textarea).toHaveValue(rawMarkdown);
    // The # should be visible, not converted to a heading element
    expect((textarea as HTMLTextAreaElement).value).toContain('#');
    expect((textarea as HTMLTextAreaElement).value).toContain('**');
  });
});
