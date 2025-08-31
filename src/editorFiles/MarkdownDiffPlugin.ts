import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import { $getRoot, $createTextNode } from 'lexical';
import { 
  $createMarkdownDelNode, 
  $createMarkdownInsNode, 
  $createCustomDelNode, 
  $createCustomInsNode 
} from './MarkdownDiffNode';

/**
 * Plugin to parse and render Markdown diff syntax in Lexical editor
 * 
 * • Converts Markdown strikethrough (~~text~~) and bold (**text**) to diff nodes
 * • Supports custom diff syntax ({-text-} and {+text+})
 * • Automatically processes text content when inserted
 * • Calls: $getRoot, $createTextNode, $createMarkdownDelNode, $createMarkdownInsNode
 * • Used by: LexicalEditor to handle Markdown diff annotations
 */
export function MarkdownDiffPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Listen for text changes and parse Markdown diff syntax
    const removeTransform = editor.registerNodeTransform(
      $createTextNode,
      (textNode) => {
        const text = textNode.getTextContent();
        
        // Check for Markdown diff patterns
        const hasMarkdownDel = /~~[^~]+~~/.test(text);
        const hasMarkdownIns = /\*\*[^*]+\*\*/.test(text);
        const hasCustomDel = /\{-[^}]+\-\}/.test(text);
        const hasCustomIns = /\{\+[^}]+\+\}/.test(text);
        
        if (hasMarkdownDel || hasMarkdownIns || hasCustomDel || hasCustomIns) {
          // Parse and replace with diff nodes
          parseMarkdownDiffInText(textNode);
        }
      }
    );

    return removeTransform;
  }, [editor]);

  return null;
}

/**
 * Parse Markdown diff syntax in a text node and replace with appropriate diff nodes
 * 
 * • Splits text node content by diff patterns
 * • Creates appropriate diff nodes for each pattern
 * • Replaces original text node with parsed structure
 * • Calls: $createMarkdownDelNode, $createMarkdownInsNode, $createCustomDelNode, $createCustomInsNode
 * • Used by: MarkdownDiffPlugin to process text content
 */
function parseMarkdownDiffInText(textNode: any) {
  const text = textNode.getTextContent();
  const parent = textNode.getParent();
  
  if (!parent) return;

  // Parse Markdown strikethrough (~~text~~)
  const markdownDelRegex = /~~([^~]+)~~/g;
  let markdownDelMatch;
  let processedText = text;
  
  while ((markdownDelMatch = markdownDelRegex.exec(text)) !== null) {
    const fullMatch = markdownDelMatch[0];
    const content = markdownDelMatch[1];
    
    // Split the text around this match
    const parts = processedText.split(fullMatch);
    
    if (parts.length > 1) {
      // Replace the text node with parsed structure
      const newNodes = [];
      
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          newNodes.push($createTextNode(parts[i]));
        }
        if (i < parts.length - 1) {
          const delNode = $createMarkdownDelNode();
          delNode.append($createTextNode(content));
          newNodes.push(delNode);
        }
      }
      
      // Replace the original text node
      textNode.replace(...newNodes);
      return; // Exit after first replacement
    }
  }

  // Parse Markdown bold (**text**) as insertions
  const markdownInsRegex = /\*\*([^*]+)\*\*/g;
  let markdownInsMatch;
  
  while ((markdownInsMatch = markdownInsRegex.exec(text)) !== null) {
    const fullMatch = markdownInsMatch[0];
    const content = markdownInsMatch[1];
    
    const parts = processedText.split(fullMatch);
    
    if (parts.length > 1) {
      const newNodes = [];
      
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          newNodes.push($createTextNode(parts[i]));
        }
        if (i < parts.length - 1) {
          const insNode = $createMarkdownInsNode();
          insNode.append($createTextNode(content));
          newNodes.push(insNode);
        }
      }
      
      textNode.replace(...newNodes);
      return;
    }
  }

  // Parse custom diff syntax ({-text-})
  const customDelRegex = /\{-\s*([^}]+\s*)\-\}/g;
  let customDelMatch;
  
  while ((customDelMatch = customDelRegex.exec(text)) !== null) {
    const fullMatch = customDelMatch[0];
    const content = customDelMatch[1];
    
    const parts = processedText.split(fullMatch);
    
    if (parts.length > 1) {
      const newNodes = [];
      
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          newNodes.push($createTextNode(parts[i]));
        }
        if (i < parts.length - 1) {
          const delNode = $createCustomDelNode();
          delNode.append($createTextNode(content));
          newNodes.push(delNode);
        }
      }
      
      textNode.replace(...newNodes);
      return;
    }
  }

  // Parse custom diff syntax ({+text+})
  const customInsRegex = /\{\+\s*([^}]+\s*)\+\}/g;
  let customInsMatch;
  
  while ((customInsMatch = customInsRegex.exec(text)) !== null) {
    const fullMatch = customInsMatch[0];
    const content = customInsMatch[1];
    
    const parts = processedText.split(fullMatch);
    
    if (parts.length > 1) {
      const newNodes = [];
      
      for (let i = 0; i < parts.length; i++) {
        if (parts[i]) {
          newNodes.push($createTextNode(parts[i]));
        }
        if (i < parts.length - 1) {
          const insNode = $createCustomInsNode();
          insNode.append($createTextNode(content));
          newNodes.push(insNode);
        }
      }
      
      textNode.replace(...newNodes);
      return;
    }
  }
}
