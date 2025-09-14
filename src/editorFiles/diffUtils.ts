import { $convertFromMarkdownString } from "@lexical/markdown";
import { MARKDOWN_TRANSFORMERS } from "./markdownTransformers";
import type { TextMatchTransformer, ElementTransformer } from "@lexical/markdown";
import { $createTextNode, TextNode, LexicalNode, $createParagraphNode } from "lexical";
import { DiffTagNode, $createDiffTagNode, $isDiffTagNode } from "./DiffTagNode";

/**
 * Custom transformer for CriticMarkup syntax
 * - Parses {--deleted text--} into DiffTagNode with "del" tag
 * - Parses {++inserted text++} into DiffTagNode with "ins" tag
 * - Parses {~~old~>new~~} into DiffTagNode with "update" tag
 * - Uses proper text replacement mechanism for accurate node positioning
 * - Used by Lexical markdown import to convert CriticMarkup to DiffTagNodes
 */
export const CRITIC_MARKUP_TRANSFORMER: TextMatchTransformer = {
  type: "text-match",
  trigger: "{",
  // Match {++...++}, {--...--}, or {~~...~>...~~}, non-greedy, multiline
  regExp: /\{([+-~]{2})([\s\S]+?)\1\}/,
  importRegExp: /\{([+-~]{2})([\s\S]+?)\1\}/,
  replace: (textNode, match) => {
    console.log("🔍 CRITIC_MARKUP replace called");
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
        console.log("🏷️ Creating DiffTagNode with tag: update");
        console.log("📝 Before text:", JSON.stringify(beforeText));
        console.log("📝 After text:", JSON.stringify(afterText));
        
        const diff = $createDiffTagNode("update");
        console.log("🔍 Created empty DiffTagNode, children count:", diff.getChildrenSize());
        
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
    console.log("🏷️ Creating DiffTagNode with tag:", tag);
    
    const diff = $createDiffTagNode(tag);
    
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
    
    console.log("📊 DiffTagNode children count:", diff.getChildrenSize());
    console.log("📊 DiffTagNode text content length:", diff.getTextContent().length);

    // Simply replace the text node with our diff node
    // Lexical will handle the text replacement automatically
    console.log("🔄 Replacing text node with diff node");
    textNode.replace(diff);
    console.log("✅ Replace operation completed");
  },
  // We only handle import; exporting is done by an Element transformer for DiffTagNode
  export: () => {
    console.log("🚫 CRITIC_MARKUP export called (should not happen)");
    return null;
  },
  dependencies: [DiffTagNode]
};

/**
 * Element transformer for DiffTagNode to handle markdown export
 * - Converts DiffTagNode instances to CriticMarkup syntax during export
 * - Handles both "ins" and "del" tag types
 * - Used by Lexical markdown export to convert DiffTagNodes to text
 */
export const DIFF_TAG_ELEMENT: ElementTransformer = {
  type: "element",
  dependencies: [DiffTagNode], // ✅ Specify DiffTagNode as dependency
  export: (node: LexicalNode) => {
    console.log("📤 DIFF_TAG_ELEMENT export called");
    console.log("🔍 Node type:", node.getType());
    console.log("🔍 Node key:", node.getKey());
    console.log("🔍 Is DiffTagNode?", $isDiffTagNode(node));
    
    if ($isDiffTagNode(node)) {
      console.log("✅ Processing DiffTagNode for export");
      const result = node.exportMarkdown();
      console.log("🎯 DIFF_TAG_ELEMENT export result:", JSON.stringify(result));
      return result;
    }
    
    console.log("❌ Not a DiffTagNode, returning null");
    return null;
  },
  regExp: /^$/, // This won't be used for import, only export
  replace: () => {
    // This won't be called since we only handle export
    return false;
  }
};

/**
 * Debug function to test CRITIC_MARKUP regex matching
 * - Tests the regex pattern against a given text
 * - Logs all matches found
 * - Helps identify why certain text might not be matched
 */
export function debugCriticMarkupMatching(text: string): void {
  console.log("🔍 Debugging CRITIC_MARKUP matching for text:");
  console.log("📝 Text length:", text.length);
  console.log("📝 Text preview:", text.substring(0, 200) + "...");
  
  const regex = /\{([+-~]{2})([\s\S]+?)\1\}/g;
  let match;
  let matchCount = 0;
  
  while ((match = regex.exec(text)) !== null) {
    matchCount++;
    console.log(`🎯 Match ${matchCount}:`);
    console.log("  Full match:", match[0]);
    console.log("  Marks:", match[1]);
    console.log("  Inner content length:", match[2]?.length);
    console.log("  Inner content preview:", match[2]?.substring(0, 100) + "...");
    console.log("  Match index:", match.index);
    
    // Special handling for update patterns
    if (match[1] === "~~") {
      const updateParts = match[2]?.split('~>');
      if (updateParts && updateParts.length === 2) {
        console.log("  Update - Before text:", updateParts[0]);
        console.log("  Update - After text:", updateParts[1]);
      } else {
        console.log("  ⚠️  Malformed update pattern");
      }
    }
    console.log("---");
  }
  
  console.log(`📊 Total matches found: ${matchCount}`);
}

/**
 * Preprocesses markdown to normalize multiline CriticMarkup
 * - Converts multiline CriticMarkup to single-line format
 * - Preserves newlines within CriticMarkup content as \n
 * - Ensures existing single-line CriticMarkup remains unchanged
 * - Used before passing markdown to Lexical to prevent text node splitting issues
 */
export function preprocessCriticMarkup(markdown: string): string {
  // First, fix malformed CriticMarkup patterns where content might be attached to closing markers
  let fixedMarkdown = markdown
  
  // Then normalize multiline CriticMarkup patterns
  const multilineCriticMarkupRegex = /\{([+-~]{2})([\s\S]*?)\1\}/g;
  
  return fixedMarkdown.replace(multilineCriticMarkupRegex, (match, marks, content) => {
    // Check if the content contains actual newlines (not just \n characters)
    if (content.includes('\n')) {
      // Replace actual newlines with paragraph breaks to preserve them in single-line format
      const normalizedContent = content.replace(/\n/g, '<br>');
      return `{${marks}${normalizedContent}${marks}}`;
    }
    // If no newlines, return the original match unchanged
    return match;
  });
}

/**
 * Debug function to analyze text node structure
 * - Helps understand how text is being split into TextNodes
 * - Shows the full text content and how it's fragmented
 */
export function debugTextNodeStructure(editor: any): void {
  console.log("🔍 Debugging TextNode structure:");
  
  // Get all text nodes in the editor
  const textNodes: any[] = [];
  editor.getEditorState().read(() => {
    const root = editor.getEditorState()._nodeMap.get('root');
    if (root) {
      const traverse = (node: any) => {
        if (node.getType() === 'text') {
          textNodes.push({
            key: node.getKey(),
            content: node.getTextContent(),
            length: node.getTextContent().length,
            contentJson: JSON.stringify(node.getTextContent())
          });
        }
        node.getChildren().forEach(traverse);
      };
      traverse(root);
    }
  });
  
  console.log("📊 Found", textNodes.length, "TextNodes:");
  textNodes.forEach((node, index) => {
    console.log(`  ${index + 1}. Key: ${node.key}, Length: ${node.length}`);
    console.log(`      Content: ${node.contentJson}`);
  });
}