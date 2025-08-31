/**
 * Convert Markdown diff syntax to HTML that Lexical can import
 * 
 * • Converts Markdown strikethrough (~~text~~) and bold (**text**) to HTML
 * • Supports custom diff syntax ({-text-} and {+text+})
 * • Returns HTML string with appropriate classes for Lexical import
 * • Calls: None (pure function)
 * • Used by: Import functionality, content conversion
 */
export function convertMarkdownDiffToHTML(markdown: string): string {
  let html = markdown;
  
  // Convert Markdown strikethrough (~~text~~) to HTML with markdown-del class
  html = html.replace(/~~([^~]+)~~/g, '<span class="markdown-del diff-del">$1</span>');
  
  // Convert Markdown bold (**text**) to HTML with markdown-ins class
  html = html.replace(/\*\*([^*]+)\*\*/g, '<span class="markdown-ins diff-ins">$1</span>');
  
  // Convert custom diff syntax ({-text-}) to HTML with custom-del class
  html = html.replace(/\{-\s*([^}]+\s*)\-\}/g, '<span class="custom-del diff-del">$1</span>');
  
  // Convert custom diff syntax ({+text+}) to HTML with custom-ins class
  html = html.replace(/\{\+\s*([^}]+\s*)\+\}/g, '<span class="custom-ins diff-ins">$1</span>');
  
  return html;
}

/**
 * Convert HTML with diff classes back to Markdown syntax
 * 
 * • Converts HTML spans with diff classes back to Markdown format
 * • Supports both standard and custom diff syntax
 * • Returns Markdown string with appropriate syntax
 * • Calls: None (pure function)
 * • Used by: Export functionality, content conversion
 */
export function convertHTMLToMarkdownDiff(html: string): string {
  let markdown = html;
  
  // Convert HTML with markdown-del class back to strikethrough
  markdown = markdown.replace(/<span class="markdown-del[^"]*"[^>]*>([^<]+)<\/span>/g, '~~$1~~');
  
  // Convert HTML with markdown-ins class back to bold
  markdown = markdown.replace(/<span class="markdown-ins[^"]*"[^>]*>([^<]+)<\/span>/g, '**$1**');
  
  // Convert HTML with custom-del class back to custom syntax
  markdown = markdown.replace(/<span class="custom-del[^"]*"[^>]*>([^<]+)<\/span>/g, '{-$1-}');
  
  // Convert HTML with custom-ins class back to custom syntax
  markdown = markdown.replace(/<span class="custom-ins[^"]*"[^>]*>([^<]+)<\/span>/g, '{+$1+}');
  
  return markdown;
}

/**
 * Set Lexical editor content from Markdown diff syntax
 * 
 * • Converts Markdown diff syntax to HTML and imports into editor
 * • Uses existing setEditorFromHTML function
 * • Handles all supported Markdown diff formats
 * • Calls: convertMarkdownDiffToHTML, setEditorFromHTML
 * • Used by: Import functionality, content loading
 */
export function setEditorFromMarkdownDiff(
  editor: any, 
  markdown: string, 
  opts?: {
    placeCursor?: "start" | "end";
    clearHistory?: boolean;
  }
) {
  const html = convertMarkdownDiffToHTML(markdown);
  
  // Import the HTML function from LexicalEditor
  // This would need to be imported or the function moved to a shared location
  // For now, we'll assume setEditorFromHTML is available
  if (typeof setEditorFromHTML === 'function') {
    setEditorFromHTML(editor, html, opts);
  } else {
    // Fallback: manually set HTML content
    editor.update(() => {
      const parser = new DOMParser();
      const dom = parser.parseFromString(html, "text/html");
      const nodes = $generateNodesFromDOM(editor, dom);
      const root = $getRoot();
      root.clear();
      root.append(...nodes);
    });
  }
}
