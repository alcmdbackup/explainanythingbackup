import { $convertFromMarkdownString, $convertToMarkdownString } from "@lexical/markdown";
import { HEADING, QUOTE, CODE, UNORDERED_LIST, ORDERED_LIST, INLINE_CODE, BOLD_STAR, ITALIC_STAR, STRIKETHROUGH, LINK } from "@lexical/markdown";
import type { TextMatchTransformer, ElementTransformer } from "@lexical/markdown";
import { $createTextNode, TextNode, LexicalNode, $createParagraphNode, $getRoot, $setSelection, $isElementNode, $isTextNode } from "lexical";
import { $dfs } from "@lexical/utils";
import { $createHeadingNode, $isHeadingNode, HeadingNode } from "@lexical/rich-text";
import { DiffTagNodeInline, $createDiffTagNodeInline, $isDiffTagNodeInline, DiffUpdateContainerInline, $createDiffUpdateContainerInline } from "./DiffTagNode";
import { StandaloneTitleLinkNode, $createStandaloneTitleLinkNode, $isStandaloneTitleLinkNode } from "./StandaloneTitleLinkNode";

/**
 * Logs all children of a node and their relationships using depth-first search
 * - Prints node key, type, depth, parent key, children keys, and text content
 * - Useful for debugging node structure and understanding relationships
 * - Can be called on any Lexical node to inspect its tree structure
 */
function logNodeChildrenAndRelationships(parentNode: LexicalNode, label: string = "Node"): void {
  console.log(`\n🔍 ${label} Structure Analysis:`);
  console.log(`Root Node Key: ${parentNode.getKey()}, Type: ${parentNode.getType()}`);
  
  const nodes = $dfs(parentNode);
  nodes.forEach(({ node, depth }) => {
    const parent = node.getParent();
    const parentKey = parent ? parent.getKey() : 'None';
    const children = $isElementNode(node) ? node.getChildren() : [];
    const childrenKeys = children.map((child: LexicalNode) => child.getKey()).join(', ') || 'None';
    const indent = '  '.repeat(depth);
    
    console.log(`${indent}├─ Key: ${node.getKey()}, Type: ${node.getType()}, Depth: ${depth}`);
    console.log(`${indent}   Parent: ${parentKey}, Children: [${childrenKeys}]`);
    
    // Print text content for all nodes that have text
    if ($isTextNode(node)) {
      const textContent = node.getTextContent();
      const truncatedText = textContent.length > 50 ? textContent.substring(0, 50) + '...' : textContent;
      console.log(`${indent}   Text: "${truncatedText}"`);
    } else if ($isElementNode(node)) {
      // For element nodes, try to get text content from all children
      const allText = node.getTextContent();
      if (allText.trim()) {
        const truncatedText = allText.length > 100 ? allText.substring(0, 100) + '...' : allText;
        console.log(`${indent}   Content: "${truncatedText}"`);
      }
    }
  });
  console.log(`\n`);
}

/**
 * Processes markdown content and returns children ready to be appended to a diff node
 * - Converts markdown string to Lexical nodes using temporary container
 * - Handles paragraph flattening for better structure
 * - Returns array of nodes that can be directly appended to diff node
 * - Used by both insert/delete and update operations for consistent processing
 */
function processMarkdownToDiffNode(markdownContent: string, label: string = "MarkdownContent"): LexicalNode[] {
  console.log(`🔄 Processing markdown content for ${label}...`);

  // Create a temporary node to process the markdown
  const tempNode = $createParagraphNode();
  $convertFromMarkdownString(markdownContent, MARKDOWN_TRANSFORMERS, tempNode);

  // Log the structure of the processed markdown
  logNodeChildrenAndRelationships(tempNode, `TempNode_${label}`);

  const tempChildren = tempNode.getChildren();
  const hasOnlyParagraphs = tempChildren.every(child => child.getType() === 'paragraph');

  const resultNodes: LexicalNode[] = [];

  if (hasOnlyParagraphs) {
    // If temp node only has paragraph nodes, take all children of those paragraphs
    tempChildren.forEach(paragraph => {
      if ($isElementNode(paragraph)) {
        const paragraphChildren = paragraph.getChildren();
        paragraphChildren.forEach(child => {
          resultNodes.push(child);
        });
      }
    });
    console.log(`📝 Flattened paragraph children for ${label}, got ${resultNodes.length} nodes`);
  } else {
    // If temp node has anything other than paragraph nodes, move all children
    tempChildren.forEach(child => {
      resultNodes.push(child);
    });
    console.log(`📝 Moved all children for ${label}, got ${resultNodes.length} nodes`);
  }

  // Remove the now-empty temp node
  tempNode.remove();

  return resultNodes;
}

/**
 * Checks if a node contains heading nodes as children (recursively)
 */
function nodeContainsHeading(node: LexicalNode): boolean {
  if ($isHeadingNode(node)) {
    return true;
  }

  if ($isElementNode(node)) {
    const children = node.getChildren();
    return children.some(child => nodeContainsHeading(child));
  }

  return false;
}

/**
 * Checks if a node contains paragraph nodes as children (recursively)
 */
function nodeContainsParagraph(node: LexicalNode): boolean {
  if ($isElementNode(node)) {
    const children = node.getChildren();
    return children.some(child => {
      if (child.getType() === 'paragraph') {
        return true;
      }
      return nodeContainsParagraph(child);
    });
  }

  return false;
}

/**
 * Checks if a node should be promoted to top-level
 * - Heading nodes that are not already top-level
 * - DiffTagNodeInline nodes that contain heading children
 * - DiffTagNodeInline nodes that contain paragraph children
 */
function shouldPromoteToTopLevel(node: LexicalNode): boolean {
  // Check if it's a heading node
  if ($isHeadingNode(node)) {
    return true;
  }

  // Check if it's a DiffTagNodeInline containing headings or paragraphs
  if ($isDiffTagNodeInline(node)) {
    return nodeContainsHeading(node) || nodeContainsParagraph(node);
  }

  return false;
}

/**
 * Promotes a node to top-level by splitting its parent and moving the node out
 * Uses the approach: clone parent, split children, insert node at top-level
 */
function promoteNodeToTopLevel(nodeToPromote: LexicalNode): void {
  console.log("🔝 promoteNodeToTopLevel called for node:", nodeToPromote.getKey());

  const parent = nodeToPromote.getParent();
  if (!parent || parent.getType() === 'root') {
    console.log("📍 Node is already at top-level or has no parent");
    return;
  }

  console.log("📍 Parent node type:", parent.getType(), "key:", parent.getKey());

  // Get all children of the parent
  const allChildren = parent.getChildren();
  const nodeIndex = allChildren.indexOf(nodeToPromote);

  if (nodeIndex === -1) {
    console.log("⚠️ Node not found in parent's children");
    return;
  }

  console.log("📍 Node index in parent:", nodeIndex, "total children:", allChildren.length);

  // Split children into: before, the node itself, and after
  const childrenBefore = allChildren.slice(0, nodeIndex);
  const childrenAfter = allChildren.slice(nodeIndex + 1);

  console.log("📍 Children before:", childrenBefore.length, "children after:", childrenAfter.length);

  // Remove the node from its current parent
  nodeToPromote.remove();

  // If there are children after the node, create a new parent for them
  if (childrenAfter.length > 0) {
    const newParent = $createParagraphNode();
    childrenAfter.forEach(child => {
      child.remove();
      newParent.append(child);
    });

    // Insert the new parent after the current parent
    parent.insertAfter(newParent);
    console.log("📍 Created new parent for children after, key:", newParent.getKey());
  }

  // Insert the promoted node after the current parent
  parent.insertAfter(nodeToPromote);
  console.log("📍 Inserted promoted node after parent");

  // If the original parent now has no children, remove it
  if (parent.getChildrenSize() === 0) {
    console.log("📍 Removing empty parent");
    parent.remove();
  }

  console.log("✅ Node promotion completed");
}

/**
 * Post-processes the editor tree to promote nodes that should be top-level
 * This handles cases where nodes were created inline but should be at top-level
 * Should be called after markdown import is complete
 */
export function promoteNodesAfterImport(): void {
  console.log("🔄 promoteNodesAfterImport called");

  const root = $getRoot();
  const nodesToPromote: LexicalNode[] = [];

  // Recursively find all nodes that should be promoted
  function findNodesToPromote(node: LexicalNode): void {
    if ($isElementNode(node) && node.getType() !== 'root') {
      // Check if this node should be promoted and is not already top-level
      if (shouldPromoteToTopLevel(node) && node.getParent()?.getType() !== 'root') {
        nodesToPromote.push(node);
        console.log("📍 Found node to promote:", node.getType(), "key:", node.getKey());
      }

      // Continue searching in children
      node.getChildren().forEach(findNodesToPromote);
    }
  }

  // Find all nodes that need promotion
  root.getChildren().forEach(findNodesToPromote);

  console.log("📍 Total nodes to promote:", nodesToPromote.length);

  // Promote nodes (process in reverse order to handle nested promotions correctly)
  for (let i = nodesToPromote.length - 1; i >= 0; i--) {
    const node = nodesToPromote[i];
    // Check if the node is still in the tree and still needs promotion
    if (node.getParent() && node.getParent()?.getType() !== 'root' && shouldPromoteToTopLevel(node)) {
      console.log("🔝 Promoting node:", node.getType(), "key:", node.getKey());
      promoteNodeToTopLevel(node);
    }
  }

  console.log("✅ promoteNodesAfterImport completed");
}

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
    console.log("🔍🔍🔍 CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER replace called 🔍🔍🔍");
    console.log("📝 TextNode content:", JSON.stringify(textNode.getTextContent()));
    console.log("📝 TextNode content length:", textNode.getTextContent().length);
    console.log("📝 TextNode key:", textNode.getKey());
    console.log("🎯 Full match:", JSON.stringify(match[0]));
    console.log("🎯 Full match length:", match[0].length);
    console.log("🏷️ Marks:", match[1]);
    console.log("📄 Inner content length:", match[2]?.length);
    console.log("📄 Inner content preview:", JSON.stringify(match[2]?.substring(0, 100)));
    
    // match[0] = full "{++...++}", "{--...--}", or "{~~...~>...~~}"
    // match[1] = "++", "--", or "~~"
    // match[2] = inner content
    const marks = match[1]!;
    const inner = match[2] ?? "";

    // Convert \n back to actual newlines if they were normalized during preprocessing
    /*if (inner.includes('\\n')) {
      inner = inner.replace(/\\n/g, '\n');
    }*/

    // Get the text content and find the match position
    const textContent = textNode.getTextContent();
    const matchIndex = textContent.indexOf(match[0]);
    
    if (matchIndex === -1) {
      console.log("⚠️ Match not found in text content");
      return;
    }

    // Split the text node at the match boundaries
    const beforeTextGeneral = textContent.substring(0, matchIndex);
    const afterTextGeneral = textContent.substring(matchIndex + match[0].length);
    
    console.log("📝 Before text general:", JSON.stringify(beforeTextGeneral));
    console.log("📝 After text general:", JSON.stringify(afterTextGeneral));

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

        // Process before and after text using the markdown processing function
        console.log("🔄 Processing beforeText with processMarkdownToDiffNode...");
        const beforeNodes = processMarkdownToDiffNode(beforeText, "BeforeText");
        console.log("✅ Before nodes count:", beforeNodes.length);

        console.log("🔄 Processing afterText with processMarkdownToDiffNode...");
        const afterNodes = processMarkdownToDiffNode(afterText, "AfterText");
        console.log("✅ After nodes count:", afterNodes.length);

        // Check if either before or after nodes contain headings
        const beforeContainsHeadings = beforeNodes.some(node => nodeContainsHeading(node) || $isHeadingNode(node));
        const afterContainsHeadings = afterNodes.some(node => nodeContainsHeading(node) || $isHeadingNode(node));
        const containsHeadings = beforeContainsHeadings || afterContainsHeadings;

        console.log("🔍 Before contains headings:", beforeContainsHeadings);
        console.log("🔍 After contains headings:", afterContainsHeadings);
        console.log("🔍 Contains headings - will append directly to diff:", containsHeadings);

        if (containsHeadings) {
          // When headings are present, append nodes directly to diff node (no containers)
          console.log("📦 Appending nodes directly to diff node (no containers)");

          // Append all before nodes directly to diff
          beforeNodes.forEach(node => {
            diff.append(node);
          });

          // Append all after nodes directly to diff
          afterNodes.forEach(node => {
            diff.append(node);
          });
        } else {
          // Use inline containers when no headings are present
          const beforeContainer = $createDiffUpdateContainerInline("before");
          const afterContainer = $createDiffUpdateContainerInline("after");
          console.log("📦 Created inline containers for non-heading content");

          // Append all before nodes to the before container
          beforeNodes.forEach(node => {
            beforeContainer.append(node);
          });

          // Append all after nodes to the after container
          afterNodes.forEach(node => {
            afterContainer.append(node);
          });

          // Now append the two containers to the diff node
          diff.append(beforeContainer);
          diff.append(afterContainer);
        }

        // Log detailed structure of diff node only
        console.log("📦 Final structure - containers skipped when headings present");
        console.log("✅ Final diff node children count:", diff.getChildrenSize());
        
        // Log detailed structure of diff node after containers are removed
        logNodeChildrenAndRelationships(diff, "DiffNode");
        
        // Handle the text before the match
        if (beforeTextGeneral) {
          const beforeTextNode = $createTextNode(beforeTextGeneral);
          textNode.insertBefore(beforeTextNode);
        }

        // Handle the text after the match BEFORE replacing
        if (afterTextGeneral) {
          const afterTextNode = $createTextNode(afterTextGeneral);
          textNode.insertAfter(afterTextNode);
        }
        
        // Replace the matched text with the DiffTagNodeInline (do this last)
        textNode.replace(diff);
        console.log("✅ DiffTagNodeInline CREATED and REPLACED textNode with tag:", marks === "++" ? "ins" : "update");

        // Check if the newly created diff node should be promoted to top-level
        if (shouldPromoteToTopLevel(diff)) {
          console.log("🔝 Promoting update diff node to top-level");
          promoteNodeToTopLevel(diff);
        }

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

    // Handle the text before the match
    if (beforeTextGeneral) {
      const beforeTextNode = $createTextNode(beforeTextGeneral);
      textNode.insertBefore(beforeTextNode);
    }

    // Handle the text after the match BEFORE replacing
    if (afterTextGeneral) {
      const afterTextNode = $createTextNode(afterTextGeneral);
      textNode.insertAfter(afterTextNode);
    }
    
    // Replace the matched text with the DiffTagNodeInline (do this last)
    textNode.replace(diff);
    console.log("✅ DiffTagNodeInline CREATED and REPLACED textNode with tag:", tag);

    // Check if the newly created diff node should be promoted to top-level
    if (shouldPromoteToTopLevel(diff)) {
      console.log("🔝 Promoting diff node to top-level");
      promoteNodeToTopLevel(diff);
    }

    console.log("✅ Replace operation completed");
  },
  // We only handle import; exporting is done by an Element transformer for DiffTagNode
  export: () => {
    console.log("🚫 CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER export called (should not happen)");
    return null;
  },
  dependencies: [DiffTagNodeInline, DiffUpdateContainerInline]
};

/**
 * Element transformer for DiffTagNodeInline to handle markdown export
 * - Converts DiffTagNodeInline instances to CriticMarkup syntax during export
 * - Handles both "ins" and "del" tag types
 * - Used by Lexical markdown export to convert DiffTagNodeInline to text
 */
export const DIFF_TAG_EXPORT_TRANSFORMER: ElementTransformer = {
  type: "element",
  dependencies: [DiffTagNodeInline, DiffUpdateContainerInline], // ✅ Specify DiffTagNodeInline and DiffUpdateContainerInline as dependencies
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
  dependencies: [DiffTagNodeInline, DiffUpdateContainerInline],
  regExp: /\{([+-~]{2})(\s*#{1,6}\s+[^}]*?)\1\}/,
  replace: (parentNode, children, match, isImport) => {
    console.log("🔍 CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER replace called");
    console.log("📝 ParentNode type:", parentNode.getType());
    console.log("📝 Children count:", children.length);
    console.log("📝 IsImport:", isImport);
    console.log("🎯 Full match:", JSON.stringify(match[0]));
    console.log("🏷️ Marks:", match[1]);
    console.log("📄 Inner content length:", match[2]?.length);
    console.log("📄 Inner content preview:", JSON.stringify(match[2]?.substring(0, 100)));
    
    // Only process if the ENTIRE paragraph content is just the CriticMarkup
    // This prevents losing other content
    if (children.length === 1 && $isTextNode(children[0])) {
      const textContent = children[0].getTextContent().trim();
      if (textContent === match[0]) {
        console.log("✅ Safe to replace entire paragraph - content matches exactly");
        
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
            
            // Create temporary containers to parse markdown
            const beforeTempNode = $createParagraphNode();
            const afterTempNode = $createParagraphNode();

            // Parse before and after text into their respective containers
            console.log("🔄 Calling convertFromMarkdownString for beforeText...");
            $convertFromMarkdownString(beforeText, MARKDOWN_TRANSFORMERS, beforeTempNode);
            console.log("✅ Before temp node children count:", beforeTempNode.getChildrenSize());

            console.log("🔄 Calling convertFromMarkdownString for afterText...");
            $convertFromMarkdownString(afterText, MARKDOWN_TRANSFORMERS, afterTempNode);
            console.log("✅ After temp node children count:", afterTempNode.getChildrenSize());

            // Handle before content - flatten paragraphs if needed
            const beforeChildren = beforeTempNode.getChildren();
            const beforeHasOnlyParagraphs = beforeChildren.every(child => child.getType() === 'paragraph');

            if (beforeHasOnlyParagraphs) {
              // If temp node only has paragraph nodes, take all children of those paragraphs and attach to diff
              beforeChildren.forEach(paragraph => {
                if ('getChildren' in paragraph) {
                  const paragraphChildren = (paragraph as any).getChildren();
                  paragraphChildren.forEach((child: any) => {
                    diff.append(child);
                  });
                }
              });
              console.log("📝 Flattened before paragraph children to diff node");
            } else {
              // If temp node has anything other than paragraph nodes, move all children to diff
              beforeChildren.forEach((child: any) => {
                diff.append(child);
              });
              console.log("📝 Moved all before children from temp node to diff node");
            }

            // Handle after content - flatten paragraphs if needed
            const afterChildren = afterTempNode.getChildren();
            const afterHasOnlyParagraphs = afterChildren.every(child => child.getType() === 'paragraph');

            if (afterHasOnlyParagraphs) {
              // If temp node only has paragraph nodes, take all children of those paragraphs and attach to diff
              afterChildren.forEach(paragraph => {
                if ('getChildren' in paragraph) {
                  const paragraphChildren = (paragraph as any).getChildren();
                  paragraphChildren.forEach((child: any) => {
                    diff.append(child);
                  });
                }
              });
              console.log("📝 Flattened after paragraph children to diff node");
            } else {
              // If temp node has anything other than paragraph nodes, move all children to diff
              afterChildren.forEach((child: any) => {
                diff.append(child);
              });
              console.log("📝 Moved all after children from temp node to diff node");
            }

            // Remove the now-empty temporary containers
            beforeTempNode.remove();
            afterTempNode.remove();
            console.log("✅ Final diff node children count:", diff.getChildrenSize());
            
            // Replace the entire paragraph with the diff node (block-level)
            console.log("🔄 Replacing entire paragraph with update diff node");
            parentNode.replace(diff);
            console.log("✅ Replace operation completed for update");
            return;
          } else {
            console.log("⚠️ Malformed update syntax, falling back to regular text");
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

        // Replace the entire paragraph with the diff node (block-level)
        console.log("🔄 Replacing entire paragraph with diff node");
        parentNode.replace(diff);
        console.log("✅ Replace operation completed");
        return;
      }
    }
    
    console.log("⚠️ Not safe to replace entire paragraph - content doesn't match exactly or has multiple children");
    console.log("📝 Paragraph content:", children.length === 1 && $isTextNode(children[0]) ? JSON.stringify(children[0].getTextContent()) : 'Multiple children');
    console.log("📝 Expected match:", JSON.stringify(match[0]));
    // Don't process - let the inline transformer handle it
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
 * Normalizes multiline CriticMarkup patterns by handling newlines in both marks and content
 * 
 * • Replaces newlines within CriticMarkup content with <br> tags
 * • Removes any remaining newlines within the marks part of CriticMarkup (e.g., ~~\n becomes ~~)
 * • Preserves single-line CriticMarkup unchanged
 * • Prevents text node splitting issues in Lexical editor
 * • Used by: preprocessCriticMarkup function
 */
function normalizeMultilineCriticMarkup(markdown: string): string {
  const multilineCriticMarkupRegex = /\{([+-~]{2})([\s\S]*?)\1\s*\}/g;

  return markdown.replace(multilineCriticMarkupRegex, (match, marks, content) => {
    console.log('🔍 Normalize Multiline Critic Markup Debug:');
    console.log('  match:', JSON.stringify(match));
    console.log('  marks:', JSON.stringify(marks));
    console.log('  content:', JSON.stringify(content));

    // First, replace newlines in content with <br> tags
    const normalizedContent = content.replace(/\n/g, '<br>');

    // Then remove any remaining newlines from the entire match
    const result = `{${marks}${normalizedContent}${marks}}`.replace(/\n/g, '');

    console.log('  result:', JSON.stringify(result));
    return result;
  });
}

/**
 * Preprocesses markdown to normalize multiline CriticMarkup and fix heading formatting
 * - Converts multiline CriticMarkup to single-line format
 * - Preserves newlines within CriticMarkup content as \n
 * - Ensures existing single-line CriticMarkup remains unchanged
 * - Fixes headings that are NOT wrapped in CriticMarkup by adding newlines before # characters
 * - Ensures CriticMarkup blocks containing headings are on their own lines
 * - Used before passing markdown to Lexical to prevent text node splitting issues
 */
/**
 * Fixes heading formatting by adding newlines before headings that aren't on their own line
 * and aren't within CriticMarkup blocks
 * 
 * • Finds all heading markers (#, ##, ###, etc.) in the markdown
 * • Identifies CriticMarkup blocks to avoid modifying headings inside them
 * • Adds newlines before headings that need proper formatting
 * • Processes in reverse order to avoid offset issues when inserting newlines
 */
function fixHeadingFormatting(markdown: string): string {
  console.log('🐛 fixHeadingFormatting called with markdown length:', markdown.length);

  // Find all relevant positions and their types
  interface Position {
    index: number;
    type: 'heading' | 'critic-start' | 'critic-end';
    needsNewlineBefore?: boolean;
    needsNewlineAfter?: boolean;
  }

  const positions: Position[] = [];

  // Step 1: Find ALL CriticMarkup blocks (to know which ranges to exclude)
  const criticMarkupBlocks: Array<{start: number, end: number}> = [];
  const criticMarkupRegex = /\{([+-~]{2})[\s\S]*?\1\}/g;
  let criticMatch;
  while ((criticMatch = criticMarkupRegex.exec(markdown)) !== null) {
    const start = criticMatch.index;
    const end = criticMatch.index + criticMatch[0].length;
    criticMarkupBlocks.push({start, end});

    // If this CriticMarkup block contains headings, it needs newlines before/after
    if (criticMatch[0].includes('#')) {
      console.log('🐛 Found CriticMarkup with heading:', JSON.stringify(criticMatch[0].substring(0, 50)));
      positions.push({
        index: start,
        type: 'critic-start',
        needsNewlineBefore: true
      });
      positions.push({
        index: end,
        type: 'critic-end',
        needsNewlineAfter: true
      });
    }
  }

  // Step 2: Find ALL headings anywhere in the markdown
  const allHeadingsRegex = /#{1,6}[ \t]/g;
  let headingMatch;
  while ((headingMatch = allHeadingsRegex.exec(markdown)) !== null) {
    const headingStart = headingMatch.index;

    console.log('🐛 Found heading at:', headingStart, 'text:', JSON.stringify(headingMatch[0]));

    // Step 3: Check if this heading is inside any CriticMarkup block
    const isInsideCriticMarkup = criticMarkupBlocks.some(block =>
      headingStart >= block.start && headingStart < block.end
    );

    if (!isInsideCriticMarkup) {
      console.log('🐛 Heading is standalone (not in CriticMarkup), needs newline before');
      positions.push({
        index: headingStart,
        type: 'heading',
        needsNewlineBefore: true
      });
    } else {
      console.log('🐛 Heading is inside CriticMarkup, skipping');
    }
  }

  // Sort positions by index in descending order (process from end to start)
  positions.sort((a, b) => b.index - a.index);

  console.log('🐛 Found', positions.length, 'positions to process');

  // Apply changes from end to start to avoid index shifting
  let result = markdown;
  for (const pos of positions) {
    console.log(`🐛 Processing ${pos.type} at index ${pos.index}`);

    if (pos.needsNewlineBefore) {
      const charBefore = pos.index > 0 ? result[pos.index - 1] : '';
      if (charBefore !== '\n' && charBefore !== '') {
        console.log('🐛 Adding newline before');
        result = result.substring(0, pos.index) + '\n' + result.substring(pos.index);
      }
    }

    if (pos.needsNewlineAfter) {
      const charAfter = pos.index < result.length ? result[pos.index] : '';
      if (charAfter !== '\n' && charAfter !== '') {
        console.log('🐛 Adding newline after');
        result = result.substring(0, pos.index) + '\n' + result.substring(pos.index);
      }
    }
  }

  console.log('🐛 fixHeadingFormatting finished, result length:', result.length);
  return result;
}

/**
 * Ensures CriticMarkup blocks containing headings are properly formatted with line breaks
 * 
 * • Finds CriticMarkup blocks that contain heading markers (#, ##, ###, etc.)
 * • Adds newlines before opening { and after closing } if needed
 * • Ensures these blocks are on their own lines for proper parsing
 * • Processes in reverse order to avoid offset issues when inserting newlines
 */
function fixCriticMarkupWithHeadings(markdown: string): string {
  // Find all CriticMarkup blocks that contain headings
  const criticMarkupWithHeadingsRegex = /\{([+-~]{2})([^}]*#{1,6}[^}]*)\1\}/g;
  let criticMarkupMatch;
  const criticMarkupWithHeadings: Array<{match: string, start: number, end: number}> = [];
  
  while ((criticMarkupMatch = criticMarkupWithHeadingsRegex.exec(markdown)) !== null) {
    criticMarkupWithHeadings.push({
      match: criticMarkupMatch[0],
      start: criticMarkupMatch.index,
      end: criticMarkupMatch.index + criticMarkupMatch[0].length
    });
  }
  
  // Process CriticMarkup blocks with headings in reverse order
  let fixedMarkdown = markdown;
  for (let i = criticMarkupWithHeadings.length - 1; i >= 0; i--) {
    const { match, start, end } = criticMarkupWithHeadings[i];
    
    // Check if the opening { is not on a newline
    const charBefore = start > 0 ? fixedMarkdown[start - 1] : '';
    if (charBefore !== '\n') {
      // Add newline before the opening {
      fixedMarkdown = fixedMarkdown.substring(0, start) + '\n' + fixedMarkdown.substring(start);
    }
    
    // Check if the closing } is not followed by a newline
    const charAfter = end < fixedMarkdown.length ? fixedMarkdown[end] : '';
    if (charAfter !== '\n' && charAfter !== '') {
      // Add newline after the closing }
      fixedMarkdown = fixedMarkdown.substring(0, end) + '\n' + fixedMarkdown.substring(end);
    }
  }
  
  return fixedMarkdown;
}

export function preprocessCriticMarkup(markdown: string): string {
  // First, fix malformed CriticMarkup patterns where content might be attached to closing markers
  let fixedMarkdown = markdown

  // Then normalize multiline CriticMarkup patterns to deal with newlines
  fixedMarkdown = normalizeMultilineCriticMarkup(fixedMarkdown);

  // Fix heading formatting
  fixedMarkdown = fixHeadingFormatting(fixedMarkdown);

  // Fix CriticMarkup blocks containing headings
  //fixedMarkdown = fixCriticMarkupWithHeadings(fixedMarkdown);

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
 * Read-only version: Exports markdown without modifying editor state
 *
 * • Uses Lexical's native markdown export without replacing diff nodes
 * • Safe for use in read-only editor contexts
 * • Diff nodes will be exported as-is in the markdown
 * • Used by: ContentChangePlugin for safe content extraction
 */
export function exportMarkdownReadOnly(): string {
  console.log("🔄 exportMarkdownReadOnly called");

  // Use Lexical's built-in markdown export without modifying nodes
  const markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);

  console.log("📤 Read-only markdown result:", JSON.stringify(markdown));
  console.log("📊 Read-only markdown length:", markdown.length);

  return markdown;
}

/**
 * Exports editor content as markdown with CriticMarkup for diff annotations
 *
 * • First replaces all DiffTagNodeInline with their CriticMarkup text representation
 * • Then uses Lexical's built-in $convertToMarkdownString for full markdown export
 * • Leverages Lexical's native markdown transformers for proper formatting
 * • More reliable and maintainable than custom markdown generation
 * • Used by: LexicalEditor for markdown export with diff annotations (write mode only)
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
 * Processes <br> tags in paragraph and heading text nodes with different strategies
 * 
 * • Traverses the editor tree to find paragraph and heading nodes
 * • In paragraphs: replaces consecutive <br>, <br/>, and <br /> tags with a single \n character
 * • In headings: simply deletes all <br>, <br/>, and <br /> tags to preserve single-line structure
 * • Handles multiple consecutive <br> tags appropriately for each node type
 * • Used to normalize line breaks in content while preserving markdown structure
 * • Called by: LexicalEditor when setting content from markdown
 */
export function replaceBrTagsWithNewlines(): void {
  console.log("🔄 replaceBrTagsWithNewlines called");
  
  const root = $getRoot();
  
  // Recursively process all nodes
  function processNode(node: any): void {
    if ($isElementNode(node)) {
      const nodeType = node.getType();
      
      // Process both paragraph and heading nodes
      if (nodeType === 'paragraph' || nodeType === 'heading' || nodeType === 'diff-update-container-inline') {
        // Process text children of paragraph and heading nodes
        const children = node.getChildren();
        children.forEach((child: any) => {
          if ($isTextNode(child)) {
            const textContent = child.getTextContent();
            let cleanedText: string;
            
            if (nodeType === 'paragraph' || nodeType === 'diff-update-container-inline') {
              // Replace all consecutive <br> tags with a single \n in paragraphs
              cleanedText = textContent.replace(/(<br\s*\/?>\s*)+/g, '\n');
            } else {
              // Simply delete all <br> tags in headings
              cleanedText = textContent.replace(/<br\s*\/?>/g, '');
            }
            
            if (textContent !== cleanedText) {
              console.log(`🔄 Processed <br> tags in ${nodeType} text node:`, JSON.stringify(textContent), "->", JSON.stringify(cleanedText));
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
  console.log("✅ replaceBrTagsWithNewlines completed");
}

/**
 * Custom transformer for standalone title links in Lexical
 * - Detects /standalone-title?t= links during markdown import
 * - Creates StandaloneTitleLinkNode instances instead of regular LinkNode
 * - Handles export back to markdown format with proper URL preservation
 * - Used by Lexical to create clickable standalone title links
 */
export const STANDALONE_TITLE_LINK_TRANSFORMER: TextMatchTransformer = {
  dependencies: [StandaloneTitleLinkNode],
  export: (node: LexicalNode) => {
    if ($isStandaloneTitleLinkNode(node)) {
      const textContent = node.getTextContent();
      const url = node.getURL();
      return `[${textContent}](${url})`;
    }
    return null;
  },
  importRegExp: /\[([^\]]+)\]\(\/standalone-title\?t=([^)]+)\)/,
  regExp: /\[([^\]]+)\]\(\/standalone-title\?t=([^)]+)\)$/,
  replace: (textNode: TextNode, match: RegExpMatchArray) => {
    const [fullMatch, linkText, encodedTitle] = match;
    const url = `/standalone-title?t=${encodedTitle}`;

    const linkNode = $createStandaloneTitleLinkNode(url);
    const textChild = $createTextNode(linkText);
    linkNode.append(textChild);
    textNode.replace(linkNode);
  },
  trigger: ')',
  type: 'text-match',
};

/**
 * Complete markdown transformers array
 * - Includes all standard Lexical markdown transformers
 * - Includes custom CriticMarkup transformers for diff functionality
 * - Includes custom standalone title link transformer
 * - Used by Lexical for markdown import/export operations
 */
export const MARKDOWN_TRANSFORMERS = [
  //CRITIC_MARKUP_IMPORT_BLOCK_TRANSFORMER,
  HEADING,
  QUOTE,
  CODE,
  UNORDERED_LIST,
  ORDERED_LIST,
  INLINE_CODE,
  BOLD_STAR,
  ITALIC_STAR,
  STRIKETHROUGH,
  STANDALONE_TITLE_LINK_TRANSFORMER, // Must come before LINK to match specific URLs first
  LINK,
  CRITIC_MARKUP_IMPORT_INLINE_TRANSFORMER,
  DIFF_TAG_EXPORT_TRANSFORMER,
];
