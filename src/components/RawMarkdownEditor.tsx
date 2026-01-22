/**
 * RawMarkdownEditor - A simple textarea wrapper for raw markdown editing.
 * Used in Plain Text mode to show and edit raw markdown source without parsing.
 */

interface RawMarkdownEditorProps {
  content: string;
  onChange: (content: string) => void;
  isEditMode: boolean;
  placeholder?: string;
  className?: string;
}

export function RawMarkdownEditor({
  content,
  onChange,
  isEditMode,
  placeholder = 'Content will appear here...',
  className = '',
}: RawMarkdownEditorProps) {
  return (
    <textarea
      value={content}
      onChange={(e) => onChange(e.target.value)}
      readOnly={!isEditMode}
      placeholder={placeholder}
      data-testid="raw-markdown-editor"
      className={`w-full min-h-[400px] p-4 font-mono text-sm
        bg-[var(--surface-secondary)] text-[var(--text-primary)]
        border border-[var(--border-default)] rounded-book
        focus:outline-none focus:ring-2 focus:ring-[var(--accent-gold)]/30 focus:border-[var(--accent-gold)]
        disabled:opacity-50 disabled:cursor-not-allowed
        resize-y
        ${isEditMode ? 'cursor-text' : 'cursor-default'}
        ${className}`}
    />
  );
}

export default RawMarkdownEditor;
