import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST, INLINE_CODE, BOLD_STAR, ITALIC_STAR, STRIKETHROUGH, LINK } from "@lexical/markdown";
import type { TextMatchTransformer, ElementTransformer } from "@lexical/markdown";
import { $createTextNode, TextNode, LexicalNode, $createParagraphNode, $getRoot, $setSelection, $isElementNode, $isTextNode } from "lexical";
import { $createHeadingNode, $isHeadingNode, HeadingNode } from "@lexical/rich-text";
import { DiffTagNodeInline, $createDiffTagNodeInline, $isDiffTagNodeInline } from "./DiffTagNode";

/**
 * Custom transformer for CriticMarkup syntax
 * - Parses {--deleted text--} into DiffTagNodeInline with "del" tag
 * - Parses {++inserted text++} into DiffTagNodeInline with "ins" tag
 * - Parses {~~old~>new~~} into DiffTagNodeInline with "update" tag
 * - Uses proper text replacement mechanism for accurate node positioning
 * - Used by Lexical markdown import to convert CriticMarkup to DiffTagNodeInline
 */
export const CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER: TextMatchTransformer = {
  type: "text-match",
  trigger: "{",
  // Match {++...++}, {--...--}, or {~~...~>...~~}, non-greedy, multiline
  regExp: /\{([+-~]{2})([\s\S]+?)\1\}/,
  importRegExp: /\{([+-~]{2})([\s\S]+?)\1\}/,
  replace: (textNode, match) => {
    console.log("🔍 CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER replace called");
    console.log("📝 TextNode content:", JSON.stringify(textNode.getTextContent()));
    console.log("📝 TextNode content length:", textNode.getTextContent().length);
    console.log("📝 TextNode key:", textNode.getKey());
    console.log("🎯 Full match:", JSON.stringify(match[0]));
    console.log("🎯 Full match length:", match[0].length);
    console.log("🏷️ Marks:", match[1]);
    console.log("📄 Inner content length:", match[2]?.length);
    console.log("📄 Inner content preview:", JSON.stringify(match[2]?.substring(0, 100)));
    console.log("🔍 Match index in TextNode:", textNode.getTextContent().indexOf(match[0]));
    
    // match[0] = full "{++...++}", "{--...--}", or "{~~...~>...~~}"
    // match[1] = "++", "--", or "~~"
    // match[2] = inner content
    const marks = match[1]!;
    let inner = match[2] ?? "";

    // Convert \n back to actual newlines if they were normalized during preprocessing
    if (inner.includes('\\n')) {
      inner = inner.replace(/\\n/g, '\n');
    }

    if (marks === "~~") {
      // Handle update syntax: {~~old~>new~~}
      const updateParts = inner.split('~>');
      if (updateParts.length === 2) {
        const [beforeText, afterText] = updateParts;
        console.log("🏷️ Creating DiffTagNodeInline with tag: update");
        console.log("📝 Before text:", JSON.stringify(beforeText));
        console.log("📝 After text:", JSON.stringify(afterText));
        
        const diff = $createDiffTagNodeInline("update");
        console.log("🔍 Created empty DiffTagNodeInline, children count:", diff.getChildrenSize());
        
        // Create separate container nodes for before and after text
        const beforeContainer = $createParagraphNode();
        const afterContainer = $createParagraphNode();
        
        // Parse before and after text into their respective containers
        console.log("🔄 Calling convertFromMarkdownString for beforeText...");
        $convertFromMarkdownString(beforeText, MARKDOWN_TRANSFORMERS, beforeContainer);
        console.log("✅ Before container children count:", beforeContainer.getChildrenSize());
        
        console.log("🔄 Calling convertFromMarkdownString for afterText...");
        $convertFromMarkdownString(afterText, MARKDOWN_TRANSFORMERS, afterContainer);
        console.log("✅ After container children count:", afterContainer.getChildrenSize());
        
        // Move children from containers to diff node
        const beforeChildren = beforeContainer.getChildren();
        const afterChildren = afterContainer.getChildren();
        
        // Append all before children to diff
        beforeChildren.forEach(child => {
          diff.append(child);
        });
        
        // Append all after children to diff
        afterChildren.forEach(child => {
          diff.append(child);
        });
        
        // Remove the now-empty containers
        beforeContainer.remove();
        afterContainer.remove();
        console.log("✅ Final diff node children count:", diff.getChildrenSize());
        console.log("📝 Final diff children:", diff.getChildren().map(child => ({
          type: child.getType(),
          textContent: child.getTextContent(),
          childrenCount: 'getChildrenSize' in child ? (child as any).getChildrenSize() : 'N/A'
        })));
        
        // Simply replace the text node with our diff node
        console.log("🔄 Replacing text node with update diff node");
        textNode.replace(diff);
        console.log("✅ Replace operation completed for update");
        return;
      } else {
        console.log("⚠️ Malformed update syntax, falling back to regular text");
        // Fallback: treat as regular text
        return;
      }
    }

    // Handle insert/delete syntax: {++...++} or {--...--}
    const tag = marks === "++" ? "ins" : "del";
    console.log("🏷️ Creating DiffTagNodeInline with tag:", tag);
    
    const diff = $createDiffTagNodeInline(tag);
    
    // We want to avoid a unnecessary line break for every new diffTagNode containing only text
    // Hence we are removing the unnecessary paragraph nodes below
    // Create a temporary node to process the markdown
    const tempNode = $createParagraphNode();
    $convertFromMarkdownString(inner, MARKDOWN_TRANSFORMERS, tempNode);
    
    const tempChildren = tempNode.getChildren();
    const hasOnlyParagraphs = tempChildren.every(child => child.getType() === 'paragraph');
    
    if (hasOnlyParagraphs) {
      // If temp node only has paragraph nodes, take all children of those paragraphs and attach to diff
      tempChildren.forEach(paragraph => {
        if ('getChildren' in paragraph) {
          const paragraphChildren = (paragraph as any).getChildren();
          paragraphChildren.forEach((child: any) => {
            diff.append(child);
          });
        }
      });
      console.log("📝 Flattened paragraph children to diff node");
    } else {
      // If temp node has anything other than paragraph nodes, move all children to diff
      tempChildren.forEach((child: any) => {
        diff.append(child);
      });
      console.log("📝 Moved all children from temp node to diff node");
    }
    
    // Remove the now-empty temp node
    tempNode.remove();
    
    console.log("📊 DiffTagNodeInline children count:", diff.getChildrenSize());
    console.log("📊 DiffTagNodeInline text content length:", diff.getTextContent().length);

    // Simply replace the text node with our diff node
    // Lexical will handle the text replacement automatically
    console.log("🔄 Replacing text node with diff node");
    textNode.replace(diff);
    console.log("✅ Replace operation completed");
  },
  // We only handle import; exporting is done by an Element transformer for DiffTagNode
  export: () => {
    console.log("🚫 CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER export called (should not happen)");
    return null;
  },
  dependencies: [DiffTagNodeInline]
};

/**
 * Element transformer for DiffTagNodeInline to handle markdown export
 * - Converts DiffTagNodeInline instances to CriticMarkup syntax during export
 * - Handles both "ins" and "del" tag types
 * - Used by Lexical markdown export to convert DiffTagNodeInline to text
 */
export const DIFF_TAG_EXPORT_TRANSFORMER: ElementTransformer = {
  type: "element",
  dependencies: [DiffTagNodeInline], // ✅ Specify DiffTagNodeInline as dependency
  export: (node: LexicalNode) => {
    console.log("📤 DIFF_TAG_EXPORT_TRANSFORMER export called");
    console.log("🔍 Node type:", node.getType());
    console.log("🔍 Node key:", node.getKey());
    console.log("🔍 Is DiffTagNodeInline?", $isDiffTagNodeInline(node));
    
    if ($isDiffTagNodeInline(node)) {
      console.log("✅ Processing DiffTagNodeInline for export");
      const result = node.exportMarkdown();
      console.log("🎯 DIFF_TAG_EXPORT_TRANSFORMER export result:", JSON.stringify(result));
      return result;
    }
    
    console.log("❌ Not a DiffTagNodeInline, returning null");
    return null;
  },
  regExp: /^$/, // This won't be used for import, only export
  replace: () => {
    // This won't be called since we only handle export
    return false;
  }
};

/**
 * Element transformer for block-level CriticMarkup syntax containing markdown headings
 * - Parses {++# Heading++}, {--# Heading--}, or {~~# Old Heading~># New Heading~~} into DiffTagNodeInline with appropriate tags
 * - Only matches CriticMarkup that contains markdown headings (lines starting with #, ##, ###, etc.)
 * - Handles single-line and multi-line headings wrapped in CriticMarkup
 * - Uses proper element replacement mechanism for accurate block-level positioning
 * - Used by Lexical markdown import to convert heading-specific CriticMarkup to DiffTagNodeInline
 */
export const CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER: ElementTransformer = {
  type: "element",
  dependencies: [DiffTagNodeInline],
  regExp: /\{([+-~]{2})(\s*#{1,6}\s+[^\n]+(?:\n[^\n]*)*?)\1\}/,
  replace: (parentNode, children, match) => {
    console.log("🔍 CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER replace called");
    console.log("📝 ParentNode type:", parentNode.getType());
    console.log("📝 Children count:", children.length);
    console.log("🎯 Full match:", JSON.stringify(match[0]));
    console.log("🏷️ Marks:", match[1]);
    console.log("📄 Inner content length:", match[2]?.length);
    console.log("📄 Inner content preview:", JSON.stringify(match[2]?.substring(0, 100)));
    
    // match[0] = full "{++...++}", "{--...--}", or "{~~...~>...~~}"
    // match[1] = "++", "--", or "~~"
    // match[2] = inner content
    const marks = match[1]!;
    let inner = match[2] ?? "";

    // Convert \n back to actual newlines if they were normalized during preprocessing
    if (inner.includes('\\n')) {
      inner = inner.replace(/\\n/g, '\n');
    }

    if (marks === "~~") {
      // Handle update syntax: {~~old~>new~~}
      const updateParts = inner.split('~>');
      if (updateParts.length === 2) {
        const [beforeText, afterText] = updateParts;
        console.log("🏷️ Creating DiffTagNodeInline with tag: update");
        console.log("📝 Before text:", JSON.stringify(beforeText));
        console.log("📝 After text:", JSON.stringify(afterText));
        
        const diff = $createDiffTagNodeInline("update");
        console.log("🔍 Created empty DiffTagNodeInline, children count:", diff.getChildrenSize());
        
        // Create separate container nodes for before and after text
        const beforeContainer = $createParagraphNode();
        const afterContainer = $createParagraphNode();
        
        // Parse before and after text into their respective containers
        console.log("🔄 Calling convertFromMarkdownString for beforeText...");
        $convertFromMarkdownString(beforeText, MARKDOWN_TRANSFORMERS, beforeContainer);
        console.log("✅ Before container children count:", beforeContainer.getChildrenSize());
        
        console.log("🔄 Calling convertFromMarkdownString for afterText...");
        $convertFromMarkdownString(afterText, MARKDOWN_TRANSFORMERS, afterContainer);
        console.log("✅ After container children count:", afterContainer.getChildrenSize());
        
        // Move children from containers to diff node
        const beforeChildren = beforeContainer.getChildren();
        const afterChildren = afterContainer.getChildren();
        
        // Append all before children to diff
        beforeChildren.forEach(child => {
          diff.append(child);
        });
        
        // Append all after children to diff
        afterChildren.forEach(child => {
          diff.append(child);
        });
        
        // Remove the now-empty containers
        beforeContainer.remove();
        afterContainer.remove();
        console.log("✅ Final diff node children count:", diff.getChildrenSize());
        console.log("📝 Final diff children:", diff.getChildren().map(child => ({
          type: child.getType(),
          textContent: child.getTextContent(),
          childrenCount: 'getChildrenSize' in child ? (child as any).getChildrenSize() : 'N/A'
        })));
        
        // Find the TextNode that contains the matched text and replace only the matched portion
        console.log("🔄 Finding TextNode with matched content to replace (update)");
        const matchedText = match[0];
        let textNodeToReplace: TextNode | null = null;
        let startOffset = -1;
        let endOffset = -1;
        
        // Search through children to find the TextNode containing the match
        children.forEach(child => {
          if ($isTextNode(child)) {
            const textContent = child.getTextContent();
            const matchIndex = textContent.indexOf(matchedText);
            if (matchIndex !== -1) {
              textNodeToReplace = child;
              startOffset = matchIndex;
              endOffset = matchIndex + matchedText.length;
            }
          }
        });
        
        if (textNodeToReplace && startOffset !== -1 && endOffset !== -1) {
          console.log("✅ Found TextNode to replace (update):", (textNodeToReplace as TextNode).getKey());
          console.log(`📝 Splitting text at offsets ${startOffset}-${endOffset}`);
          
          try {
            // Split the text node at the start and end offsets
            const [, middleNode, rightNode] = (textNodeToReplace as TextNode).splitText(startOffset, endOffset);
            
            // Replace the middle node (the matched text) with our diff node
            middleNode.replace(diff);
            
            // Merge adjacent text nodes if necessary
            if (rightNode && rightNode.getTextContent() === '') {
              rightNode.remove();
            }
            
            console.log("✅ Replace operation completed for update with splitText");
          } catch (error) {
            console.log("⚠️ splitText failed, falling back to full node replacement (update):", error);
            (textNodeToReplace as TextNode).replace(diff);
          }
        } else {
          console.log("⚠️ Could not find TextNode with matched content, falling back to parent replacement (update)");
          parentNode.replace(diff);
        }
        return;
      } else {
        console.log("⚠️ Malformed update syntax, falling back to regular text");
        // Fallback: treat as regular text
        return;
      }
    }

    // Handle insert/delete syntax: {++...++} or {--...--}
    const tag = marks === "++" ? "ins" : "del";
    console.log("🏷️ Creating DiffTagNodeInline with tag:", tag);
    
    const diff = $createDiffTagNodeInline(tag);
    
    // Create a temporary node to process the markdown
    const tempNode = $createParagraphNode();
    $convertFromMarkdownString(inner, MARKDOWN_TRANSFORMERS, tempNode);
    
    const tempChildren = tempNode.getChildren();
    const hasOnlyParagraphs = tempChildren.every(child => child.getType() === 'paragraph');
    
    if (hasOnlyParagraphs) {
      // If temp node only has paragraph nodes, take all children of those paragraphs and attach to diff
      tempChildren.forEach(paragraph => {
        if ('getChildren' in paragraph) {
          const paragraphChildren = (paragraph as any).getChildren();
          paragraphChildren.forEach((child: any) => {
            diff.append(child);
          });
        }
      });
      console.log("📝 Flattened paragraph children to diff node");
    } else {
      // If temp node has anything other than paragraph nodes, move all children to diff
      tempChildren.forEach((child: any) => {
        diff.append(child);
      });
      console.log("📝 Moved all children from temp node to diff node");
    }
    
    // Remove the now-empty temp node
    tempNode.remove();
    
    console.log("📊 DiffTagNodeInline children count:", diff.getChildrenSize());
    console.log("📊 DiffTagNodeInline text content length:", diff.getTextContent().length);

    // Find the TextNode that contains the matched text and replace only the matched portion
    console.log("🔄 Finding TextNode with matched content to replace");
    const matchedText = match[0];
    let textNodeToReplace: TextNode | null = null;
    let startOffset = -1;
    let endOffset = -1;
    
    // Search through children to find the TextNode containing the match
    children.forEach(child => {
      if ($isTextNode(child)) {
        const textContent = child.getTextContent();
        const matchIndex = textContent.indexOf(matchedText);
        if (matchIndex !== -1) {
          textNodeToReplace = child;
          startOffset = matchIndex;
          endOffset = matchIndex + matchedText.length;
        }
      }
    });
    
    if (textNodeToReplace && startOffset !== -1 && endOffset !== -1) {
      console.log("✅ Found TextNode to replace:", (textNodeToReplace as TextNode).getKey());
      console.log(`📝 Splitting text at offsets ${startOffset}-${endOffset}`);
      
      try {
        // Split the text node at the start and end offsets
        const [, middleNode, rightNode] = (textNodeToReplace as TextNode).splitText(startOffset, endOffset);
        
        // Replace the middle node (the matched text) with our diff node
        middleNode.replace(diff);
        
        // Merge adjacent text nodes if necessary
        if (rightNode && rightNode.getTextContent() === '') {
          rightNode.remove();
        }
        
        console.log("✅ Replace operation completed with splitText");
      } catch (error) {
        console.log("⚠️ splitText failed, falling back to full node replacement:", error);
        (textNodeToReplace as TextNode).replace(diff);
      }
    } else {
      console.log("⚠️ Could not find TextNode with matched content, falling back to parent replacement");
      parentNode.replace(diff);
    }
  },
  export: (node: LexicalNode) => {
    console.log("📤 CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER export called");
    console.log("🔍 Node type:", node.getType());
    console.log("🔍 Node key:", node.getKey());
    console.log("🔍 Is DiffTagNodeInline?", $isDiffTagNodeInline(node));
    
    if ($isDiffTagNodeInline(node)) {
      console.log("✅ Processing DiffTagNodeInline for export");
      const result = node.exportMarkdown();
      console.log("🎯 CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER export result:", JSON.stringify(result));
      return result;
    }
    
    console.log("❌ Not a DiffTagNodeInline, returning null");
    return null;
  }
};

/**
 * Preprocesses markdown to normalize multiline CriticMarkup and fix heading formatting
 * - Converts multiline CriticMarkup to single-line format
 * - Preserves newlines within CriticMarkup content as \n
 * - Ensures existing single-line CriticMarkup remains unchanged
 * - Fixes headings that are NOT wrapped in CriticMarkup by adding newlines before # characters
 * - Used before passing markdown to Lexical to prevent text node splitting issues
 */
export function preprocessCriticMarkup(markdown: string): string {
  // First, fix malformed CriticMarkup patterns where content might be attached to closing markers
  let fixedMarkdown = markdown
  
  // Then normalize multiline CriticMarkup patterns
  const multilineCriticMarkupRegex = /\{([+-~]{2})([\s\S]*?)\1\}/g;
  
  fixedMarkdown = fixedMarkdown.replace(multilineCriticMarkupRegex, (match, marks, content) => {
    // Check if the content contains actual newlines (not just \n characters)
    if (content.includes('\n')) {
      // Replace actual newlines with paragraph breaks to preserve them in single-line format
      const normalizedContent = content.replace(/\n/g, '<br>');
      return `{${marks}${normalizedContent}${marks}}`;
    }
    // If no newlines, return the original match unchanged
    return match;
  });

  // Fix headings: find all # runs, filter out those in CriticMarkup, fix remaining ones
  const headingRunsRegex = /#+/g;
  const criticMarkupRegex = /\{[+-~]{2}[\s\S]*?[+-~]{2}\}/g;
  
  // Find all CriticMarkup blocks and their positions
  const criticMarkupBlocks: Array<{start: number, end: number}> = [];
  let criticMatch;
  while ((criticMatch = criticMarkupRegex.exec(fixedMarkdown)) !== null) {
    criticMarkupBlocks.push({
      start: criticMatch.index,
      end: criticMatch.index + criticMatch[0].length
    });
  }
  
  // Check if a position is within any CriticMarkup block
  const isWithinCriticMarkup = (position: number): boolean => {
    return criticMarkupBlocks.some(block => position >= block.start && position < block.end);
  };
  
  // Find all heading runs and process them
  const headingMatches: Array<{match: string, start: number, end: number}> = [];
  let headingMatch;
  while ((headingMatch = headingRunsRegex.exec(fixedMarkdown)) !== null) {
    headingMatches.push({
      match: headingMatch[0],
      start: headingMatch.index,
      end: headingMatch.index + headingMatch[0].length
    });
  }
  
  // Process heading matches in reverse order to avoid offset issues
  for (let i = headingMatches.length - 1; i >= 0; i--) {
    const { match, start, end } = headingMatches[i];
    
    // Skip if within CriticMarkup
    if (isWithinCriticMarkup(start)) {
      continue;
    }
    
    // Check if not starting on a newline
    const charBefore = start > 0 ? fixedMarkdown[start - 1] : '';
    if (charBefore !== '\n') {
      // Add newline before the heading
      fixedMarkdown = fixedMarkdown.substring(0, start) + '\n' + fixedMarkdown.substring(start);
    }
  }
  
  return fixedMarkdown;
}

/**
 * Replaces DiffTagNodeInline with their CriticMarkup text representation
 * 
 * • Clears current selection to prevent "selection has been lost" errors
 * • Traverses the editor tree and replaces diff-tag nodes with text nodes containing CriticMarkup
 * • Preserves all other node types and formatting
 * • Used as a preprocessing step before using Lexical's built-in markdown export
 * • Called by: replaceDiffTagNodesAndExportMarkdown function
 */
export function replaceDiffTagNodes(): void {
  console.log("🔄 replaceDiffTagNodes called");
  
  // Clear the current selection to prevent "selection has been lost" errors
  // when replacing nodes that might be selected
  $setSelection(null);
  
  const root = $getRoot();
  
  // Recursively process all nodes
  function processNode(node: any): void {
    if ($isDiffTagNodeInline(node)) {
      // This is a DiffTagNodeInline - replace it with a text node containing CriticMarkup
      console.log("🔍 Processing DiffTagNodeInline:", node.getKey());
      const criticMarkup = node.exportMarkdown();
      console.log("✅ DiffTagNodeInline converted to CriticMarkup:", JSON.stringify(criticMarkup));
      
      // Create a new text node with the CriticMarkup content
      const textNode = $createTextNode(criticMarkup);
      
      // Replace the DiffTagNodeInline with the text node
      node.replace(textNode);
    } else if ($isElementNode(node)) {
      // For element nodes, process their children
      node.getChildren().forEach(processNode);
    }
  }
  
  // Process all top-level children
  root.getChildren().forEach(processNode);
}

/**
 * Exports editor content as markdown with CriticMarkup for diff annotations
 * 
 * • First replaces all DiffTagNodeInline with their CriticMarkup text representation
 * • Then uses Lexical's built-in $convertToMarkdownString for full markdown export
 * • Leverages Lexical's native markdown transformers for proper formatting
 * • More reliable and maintainable than custom markdown generation
 * • Used by: LexicalEditor for markdown export with diff annotations
 */
export function replaceDiffTagNodesAndExportMarkdown(): string {
  console.log("🔄 replaceDiffTagNodesAndExportMarkdown called");
  
  // First, replace all DiffTagNodeInline with their CriticMarkup text
  replaceDiffTagNodes();
  
  // Then use Lexical's built-in markdown export
  const markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
  
  console.log("📤 Markdown result:", JSON.stringify(markdown));
  console.log("📊 Markdown length:", markdown.length);
  
  return markdown;
}

/**
 * Removes trailing <br> tags from text nodes in headings and paragraphs
 * 
 * • Traverses the editor tree to find heading and paragraph nodes
 * • Removes trailing <br>, <br/>, and <br /> tags from their text children
 * • Handles multiple consecutive <br> tags at the end of text content
 * • Used to clean up markdown conversion artifacts
 * • Called by: LexicalEditor when switching to markdown mode
 */
export function removeTrailingBreaksFromTextNodes(): void {
  console.log("🧹 removeTrailingBreaksFromTextNodes called");
  
  const root = $getRoot();
  
  // Recursively process all nodes
  function processNode(node: any): void {
    if ($isElementNode(node)) {
      const nodeType = node.getType();
      
      // Check if this is a heading or paragraph node
      if (nodeType === 'heading' || nodeType === 'paragraph') {
        console.log(`🔍 Processing ${nodeType} node:`, node.getKey());
        
        // Get all text children of this node
        const children = node.getChildren();
        children.forEach((child: any) => {
          if ($isTextNode(child)) {
            const textContent = child.getTextContent();
            // Remove all trailing <br> tags (various formats: <br>, <br/>, <br />, with whitespace)
            // This handles multiple consecutive <br> tags at the end
            const cleanedText = textContent.replace(/(<br\s*\/?>\s*)+$/g, '');
            
            if (textContent !== cleanedText) {
              console.log(`🧹 Removed trailing <br> from text node:`, JSON.stringify(textContent), "->", JSON.stringify(cleanedText));
              child.setTextContent(cleanedText);
            }
          }
        });
      }
      
      // Recursively process all children
      node.getChildren().forEach(processNode);
    }
  }
  
  // Process all top-level children
  root.getChildren().forEach(processNode);
  console.log("✅ removeTrailingBreaksFromTextNodes completed");
}

/**
 * Complete markdown transformers array
 * - Includes all standard Lexical markdown transformers
 * - Includes custom CriticMarkup transformers for diff functionality
 * - Used by Lexical for markdown import/export operations
 */
export const MARKDOWN_TRANSFORMERS = [
  CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER,
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  INLINE_CODE,
  BOLD_STAR,
  ITALIC_STAR,
  STRIKETHROUGH,
  LINK,
  //CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER,
  DIFF_TAG_EXPORT_TRANSFORMER,
];
