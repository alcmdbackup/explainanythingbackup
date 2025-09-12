import type {EditorConfig, LexicalEditor, NodeKey, DOMConversionMap, DOMConversionOutput, DOMExportOutput} from "lexical";
import {ElementNode, LexicalNode, $isTextNode} from "lexical";

type DiffTag = "ins" | "del" | "update";

export class DiffTagNode extends ElementNode {
  __tag: DiffTag;
  __beforeText?: string; // For update nodes: the original text
  __afterText?: string;  // For update nodes: the replacement text

  static getType(): string {
    return "diff-tag";
  }

  static clone(node: DiffTagNode): DiffTagNode {
    const cloned = new DiffTagNode(node.__tag, node.__key);
    cloned.__beforeText = node.__beforeText;
    cloned.__afterText = node.__afterText;
    return cloned;
  }

  constructor(tag: DiffTag, key?: NodeKey, beforeText?: string, afterText?: string) {
    super(key);
    this.__tag = tag;
    this.__beforeText = beforeText;
    this.__afterText = afterText;
    console.log("🏗️ DiffTagNode created with tag:", tag, "key:", key, "beforeText:", beforeText, "afterText:", afterText);
  }


  isInline(): boolean {
    return true;
  }

  /** Map this node → CriticMarkup when exporting to markdown */
  exportMarkdown() {
    if (this.__tag === "update") {
      // For update nodes, use the stored before/after text
      const beforeText = this.__beforeText || '';
      const afterText = this.__afterText || '';
      const result = `{~~${beforeText}~>${afterText}~~}`;
      
      console.log("📤 DiffTagNode.exportMarkdown() called for UPDATE");
      console.log("🏷️ Tag type:", this.__tag);
      console.log("📝 Before text:", JSON.stringify(beforeText));
      console.log("📝 After text:", JSON.stringify(afterText));
      console.log("🎯 Generated CriticMarkup:", JSON.stringify(result));
      console.log("🔑 Node key:", this.getKey());
      
      return result;
    }
    
    // For ins/del nodes, use the existing logic with child text formatting
    let formattedContent = '';
    
    this.getChildren().forEach((child: any) => {
      if ($isTextNode(child)) {
        let text = child.getTextContent();
        
        // Apply text formatting based on the text node's format flags
        if (child.hasFormat('bold')) {
          text = `**${text}**`;
        }
        if (child.hasFormat('italic')) {
          text = `*${text}*`;
        }
        if (child.hasFormat('underline')) {
          text = `<u>${text}</u>`;
        }
        if (child.hasFormat('strikethrough')) {
          text = `~~${text}~~`;
        }
        
        formattedContent += text;
      } else {
        // For non-text nodes, just get the text content
        formattedContent += child.getTextContent();
      }
    });
    
    const marker = this.__tag === "ins" ? "++" : "--";
    const result = `{${marker}${formattedContent}${marker}}`;
    
    console.log("📤 DiffTagNode.exportMarkdown() called");
    console.log("🏷️ Tag type:", this.__tag);
    console.log("📝 Formatted content length:", formattedContent.length);
    console.log("📝 Formatted content preview:", JSON.stringify(formattedContent.substring(0, 100)));
    console.log("📝 Full formatted content:", JSON.stringify(formattedContent));
    console.log("🎯 Generated CriticMarkup:", JSON.stringify(result));
    console.log("🔑 Node key:", this.getKey());
    
    return result;
  }

  // JSON round-trip (editorState persistence)
  static importJSON(json: any): DiffTagNode {
    return new DiffTagNode(json.tag as DiffTag, json.key, json.beforeText, json.afterText);
  }
  exportJSON() {
    return {...super.exportJSON(), type: "diff-tag", version: 1, tag: this.__tag, beforeText: this.__beforeText, afterText: this.__afterText};
  }

  /**
   * Creates DOM element for rendering the DiffTagNode
   * • Creates <ins>, <del>, or <span> HTML elements based on the tag type
   * • Applies appropriate styling classes for visual distinction
   * • Preserves newlines with whitespace-pre-wrap for proper formatting
   * • Used by Lexical to render the node in the DOM
   * • Called by: Lexical's rendering system
   */
  createDOM(): HTMLElement {
    if (this.__tag === "update") {
      // For update nodes, create a span with vertically stacked before/after text content
      const element = document.createElement("span");
      element.className = "inline-block bg-orange-50 border border-orange-200 rounded px-1 whitespace-pre-wrap";
      
      // Add the before and after text content
      const beforeText = this.__beforeText || '';
      const afterText = this.__afterText || '';
      
      // Create spans for before and after text with appropriate styling, stacked vertically
      const beforeSpan = document.createElement("div");
      beforeSpan.className = "bg-orange-100 text-orange-800 line-through px-1 rounded mb-1";
      beforeSpan.textContent = beforeText;
      
      const afterSpan = document.createElement("div");
      afterSpan.className = "bg-purple-100 text-purple-800 underline px-1 rounded";
      afterSpan.textContent = afterText;
      
      element.appendChild(beforeSpan);
      element.appendChild(afterSpan);
      
      return element;
    }
    
    const element = document.createElement(this.__tag);
    element.className = this.__tag === "ins" 
      ? "bg-green-100 text-green-800 border border-green-200 rounded px-1 whitespace-pre-wrap" 
      : "bg-red-100 text-red-800 border border-red-200 rounded px-1 line-through whitespace-pre-wrap";
    return element;
  }

  /**
   * Updates DOM element when node properties change
   * • Handles updates to the tag type or other properties
   * • Returns true if DOM update is needed, false otherwise
   * • Used by Lexical to optimize DOM updates
   * • Called by: Lexical's update system
   */
  updateDOM(prevNode: DiffTagNode): boolean {
    return prevNode.__tag !== this.__tag || 
           prevNode.__beforeText !== this.__beforeText || 
           prevNode.__afterText !== this.__afterText;
  }

  /**
   * Exports node to DOM for serialization
   * • Creates DOM element for export operations with proper styling
   * • Preserves newlines with whitespace-pre-wrap for proper formatting
   * • Used by Lexical for HTML export functionality
   * • Called by: Lexical's export system
   */
  exportDOM(): DOMExportOutput {
    if (this.__tag === "update") {
      // For update nodes, create a span with vertically stacked before/after text content
      const element = document.createElement("span");
      element.className = "inline-block bg-orange-50 border border-orange-200 rounded px-1 whitespace-pre-wrap";
      
      // Add the before and after text content
      const beforeText = this.__beforeText || '';
      const afterText = this.__afterText || '';
      
      // Create spans for before and after text with appropriate styling, stacked vertically
      const beforeSpan = document.createElement("div");
      beforeSpan.className = "bg-orange-100 text-orange-800 line-through px-1 rounded mb-1";
      beforeSpan.textContent = beforeText;
      
      const afterSpan = document.createElement("div");
      afterSpan.className = "bg-purple-100 text-purple-800 underline px-1 rounded";
      afterSpan.textContent = afterText;
      
      element.appendChild(beforeSpan);
      element.appendChild(afterSpan);
      
      return { element };
    }
    
    const element = document.createElement(this.__tag);
    element.className = this.__tag === "ins" 
      ? "bg-green-100 text-green-800 border border-green-200 rounded px-1 whitespace-pre-wrap" 
      : "bg-red-100 text-red-800 border border-red-200 rounded px-1 line-through whitespace-pre-wrap";
    return { element };
  }

  /**
   * Converts DOM element back to DiffTagNode
   * • Handles conversion from HTML <ins>/<del>/<span> elements
   * • Used by Lexical for HTML import functionality
   * • Called by: Lexical's import system
   */
  static importDOM(): DOMConversionMap | null {
    return {
      ins: () => ({
        conversion: convertDiffTagElement,
        priority: 1,
      }),
      del: () => ({
        conversion: convertDiffTagElement,
        priority: 1,
      }),
      span: () => ({
        conversion: convertDiffTagElement,
        priority: 1,
      }),
    };
  }
}

/**
 * Converts DOM element to DiffTagNode
 * • Determines tag type from element tagName or CSS classes
 * • Creates new DiffTagNode with appropriate tag
 * • Used by importDOM for HTML conversion
 * • Called by: Lexical's DOM import system
 */
function convertDiffTagElement(domNode: HTMLElement): DOMConversionOutput {
  const tagName = domNode.tagName.toLowerCase();
  
  // Check if it's a span with update styling (orange background)
  if (tagName === 'span' && domNode.className.includes('bg-orange-50')) {
    const node = $createDiffTagNode('update');
    return { node };
  }
  
  // For ins/del elements, use the tagName directly
  const tag = tagName as DiffTag;
  const node = $createDiffTagNode(tag);
  return { node };
}

/**
 * Creates a new DiffTagNode instance
 * • Factory function for creating DiffTagNode instances
 * • Used by other parts of the codebase to create diff nodes
 * • Called by: CRITIC_MARKUP transformer, import functions
 */
export function $createDiffTagNode(tag: DiffTag, beforeText?: string, afterText?: string): DiffTagNode {
  return new DiffTagNode(tag, undefined, beforeText, afterText);
}

/**
 * Checks if a node is a DiffTagNode
 * • Type guard function for DiffTagNode instances
 * • Used for type checking in other parts of the codebase
 * • Called by: Various utility functions
 */
export function $isDiffTagNode(node: LexicalNode | null | undefined): node is DiffTagNode {
  return node instanceof DiffTagNode;
}
