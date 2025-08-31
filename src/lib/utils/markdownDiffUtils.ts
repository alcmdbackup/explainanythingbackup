import { Atom } from '../../editorFiles/diffUtils';

/**
 * Convert diff atoms to Markdown with standard strikethrough/bold annotations
 * 
 * • Converts deleted text to strikethrough (~~text~~) and inserted text to bold (**text**)
 * • Preserves original text structure while showing changes clearly
 * • Returns: Markdown string with diff annotations
 * • Calls: None (pure function)
 * • Used by: Export functionality, content sharing, diff visualization
 */
export function renderDiffAsMarkdown(atoms: Atom[]): string {
  return atoms
    .map((atom) => {
      if (atom.kind === "orig" && !atom.deleted) {
        return atom.text;
      }
      if (atom.kind === "orig" && atom.deleted) {
        return `~~${atom.text}~~`;
      }
      // insert
      return `**${atom.text}**`;
    })
    .join("");
}

/**
 * Convert diff atoms to Markdown with HTML comment annotations
 * 
 * • Embeds HTML comments to preserve diff metadata in Markdown
 * • Comments can be processed later to restore diff information
 * • Returns: Markdown string with HTML comment annotations
 * • Calls: None (pure function)
 * • Used by: Processing pipelines that need to preserve diff metadata
 */
export function renderDiffAsMarkdownWithComments(atoms: Atom[]): string {
  return atoms
    .map((atom) => {
      if (atom.kind === "orig" && !atom.deleted) {
        return atom.text;
      }
      if (atom.kind === "orig" && atom.deleted) {
        return `<!-- diff-del -->${atom.text}<!-- /diff-del -->`;
      }
      // insert
      return `<!-- diff-ins -->${atom.text}<!-- /diff-ins -->`;
    })
    .join("");
}

/**
 * Convert diff atoms to Markdown with custom diff syntax
 * 
 * • Uses {-deleted-} and {+added+} syntax for clear diff visualization
 * • Custom syntax is easy to parse and process
 * • Returns: Markdown string with custom diff syntax
 * • Calls: None (pure function)
 * • Used by: Custom diff viewers, specialized markdown processors
 */
export function renderDiffAsMarkdownCustom(atoms: Atom[]): string {
  return atoms
    .map((atom) => {
      if (atom.kind === "orig" && !atom.deleted) {
        return atom.text;
      }
      if (atom.kind === "orig" && atom.deleted) {
        return `{-${atom.text}-}`;
      }
      // insert
      return `{+${atom.text}+}`;
    })
    .join("");
}

/**
 * Convert diff atoms to Markdown with GitHub-style diff syntax
 * 
 * • Uses GitHub's diff format with + and - prefixes
 * • Good for version control and code review contexts
 * • Returns: Markdown code block with diff syntax
 * • Calls: None (pure function)
 * • Used by: Git integration, code review tools
 */
export function renderDiffAsGitHubMarkdown(atoms: Atom[]): string {
  const lines: string[] = [];
  
  atoms.forEach((atom) => {
    if (atom.kind === "orig" && !atom.deleted) {
      lines.push(` ${atom.text}`);
    } else if (atom.kind === "orig" && atom.deleted) {
      lines.push(`-${atom.text}`);
    } else {
      // insert
      lines.push(`+${atom.text}`);
    }
  });
  
  return "```diff\n" + lines.join("\n") + "\n```";
}

/**
 * Parse Markdown with diff annotations back to atoms
 * 
 * • Converts Markdown diff syntax back to Atom format
 * • Supports standard strikethrough/bold format
 * • Returns: Array of Atom objects
 * • Calls: None (pure function)
 * • Used by: Import functionality, diff restoration
 */
export function parseMarkdownDiff(markdown: string): Atom[] {
  const atoms: Atom[] = [];
  
  // Simple regex-based parser for ~~deleted~~ and **added** text
  const deletedRegex = /~~([^~]+)~~/g;
  const addedRegex = /\*\*([^*]+)\*\*/g;
  
  let lastIndex = 0;
  let match;
  
  // Find all matches and their positions
  const matches: Array<{ type: 'deleted' | 'added'; text: string; index: number }> = [];
  
  while ((match = deletedRegex.exec(markdown)) !== null) {
    matches.push({ type: 'deleted', text: match[1], index: match.index });
  }
  
  while ((match = addedRegex.exec(markdown)) !== null) {
    matches.push({ type: 'added', text: match[1], index: match.index });
  }
  
  // Sort matches by position
  matches.sort((a, b) => a.index - b.index);
  
  // Build atoms
  for (const match of matches) {
    // Add text before this match
    if (match.index > lastIndex) {
      const beforeText = markdown.slice(lastIndex, match.index);
      if (beforeText) {
        atoms.push({ kind: "orig", text: beforeText });
      }
    }
    
    // Add the diff atom
    if (match.type === 'deleted') {
      atoms.push({ kind: "orig", text: match.text, deleted: true });
    } else {
      atoms.push({ kind: "insert", text: match.text });
    }
    
    lastIndex = match.index + match.text.length + 4; // +4 for ~~ or **
  }
  
  // Add remaining text
  if (lastIndex < markdown.length) {
    const remainingText = markdown.slice(lastIndex);
    if (remainingText) {
      atoms.push({ kind: "orig", text: remainingText });
    }
  }
  
  return atoms;
}
