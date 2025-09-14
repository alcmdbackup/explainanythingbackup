import { HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST, INLINE_CODE, BOLD_STAR, ITALIC_STAR, STRIKETHROUGH, LINK } from "@lexical/markdown";
import type { TextMatchTransformer, ElementTransformer } from "@lexical/markdown";
import { $createTextNode, TextNode, LexicalNode, $createParagraphNode, $getRoot } from "lexical";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { DiffTagNode, $createDiffTagNode, $isDiffTagNode } from "./DiffTagNode";

// Define base transformers first
const BASE_TRANSFORMERS = [
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
];

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
        
        // Create parent DiffTagNode without properties
        const diff = $createDiffTagNode("update");
        
        // Parse before text markdown directly into the diff node
        $convertFromMarkdownString(beforeText, MARKDOWN_TRANSFORMERS, diff);
        
        // Store the number of children after before text for splitting later
        const beforeChildrenCount = diff.getChildrenSize();
        
        // Parse after text markdown directly into the diff node
        $convertFromMarkdownString(afterText, MARKDOWN_TRANSFORMERS, diff);
        
        // Store the split point for export
        diff.__beforeChildrenCount = beforeChildrenCount;
        
        console.log("🔗 Appended before and after text nodes to DiffTagNode");
        console.log("📊 DiffTagNode children count:", diff.getChildrenSize());
        
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
    const textNodeContent = $createTextNode(inner);
    console.log("📝 Created TextNode with content length:", textNodeContent.getTextContent().length);
    
    diff.append(textNodeContent);
    console.log("🔗 Appended TextNode to DiffTagNode");
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

// Define complete markdown transformers array (shared between files)
export const MARKDOWN_TRANSFORMERS = [
  ...BASE_TRANSFORMERS,
  CRITIC_MARKUP_TRANSFORMER,
  DIFF_TAG_ELEMENT,
];
