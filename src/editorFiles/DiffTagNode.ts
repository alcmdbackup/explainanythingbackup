import type {EditorConfig, LexicalEditor, NodeKey, DOMConversionMap, DOMConversionOutput, DOMExportOutput} from "lexical";
import {ElementNode, LexicalNode, $isTextNode} from "lexical";

type DiffTag = "ins" | "del" | "update";

export class DiffTagNode extends ElementNode {
  __tag: DiffTag;
  __beforeChildrenCount?: number;

  static getType(): string {
    return "diff-tag";
  }

  static clone(node: DiffTagNode): DiffTagNode {
    const cloned = new DiffTagNode(node.__tag, node.__key);
    return cloned;
  }

  constructor(tag: DiffTag, key?: NodeKey) {
    super(key);
    this.__tag = tag;
    console.log("🏗️ DiffTagNode created with tag:", tag, "key:", key);
  }

  
  isInline(): boolean {
    return true;
  }

  /** Map this node → CriticMarkup when exporting to markdown */
  exportMarkdown() {
    if (this.__tag === "update") {
      // For update nodes, get before/after text from child nodes
      const children = this.getChildren();
      console.log("📤 DiffTagNode.exportMarkdown() called for UPDATE");
      console.log("🔍 Children count:", children.length);
      console.log("🔍 Children details:", children.map((child, index) => ({
        index,
        type: child.getType(),
        textContent: child.getTextContent(),
        childrenCount: 'getChildrenSize' in child ? (child as any).getChildrenSize() : 'N/A'
      })));
      
      if (children.length >= 2) {
        // First child contains the "before" text
        const beforeText = this.exportNodeToMarkdown(children[0]);
        // Second child contains the "after" text  
        const afterText = this.exportNodeToMarkdown(children[1]);
        const result = `{~~${beforeText}~>${afterText}~~}`;
        
        console.log("🏷️ Tag type:", this.__tag);
        console.log("📝 Before text:", JSON.stringify(beforeText));
        console.log("📝 After text:", JSON.stringify(afterText));
        console.log("🎯 Generated CriticMarkup:", JSON.stringify(result));
        console.log("🔑 Node key:", this.getKey());
        
        return result;
      } else {
        console.log("⚠️ Update node has insufficient children, falling back to empty strings");
        console.log("⚠️ Expected 2 children, got:", children.length);
        return `{~~${''}~>${''}~~}`;
      }
    }
    
    // For ins/del nodes, properly handle all markdown elements
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
        // For non-text nodes, recursively export their markdown content
        formattedContent += this.exportNodeToMarkdown(child);
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

  /**
   * Recursively exports a node to markdown format
   * • Handles different node types (headings, lists, paragraphs, etc.)
   * • Preserves markdown formatting for all element types
   * • Used by exportMarkdown to properly handle nested markdown elements
   * • Called by: exportMarkdown method
   */
  private exportNodeToMarkdown(node: any): string {
    const nodeType = node.getType();
    
    // Handle headings
    if (nodeType === 'heading') {
      const level = node.getTag();
      const headingLevel = level === 'h1' ? 1 : level === 'h2' ? 2 : level === 'h3' ? 3 : 
                          level === 'h4' ? 4 : level === 'h5' ? 5 : 6;
      const text = node.getTextContent();
      return '#'.repeat(headingLevel) + ' ' + text;
    }
    
    // Handle paragraphs
    if (nodeType === 'paragraph') {
      return node.getTextContent();
    }
    
    // Handle lists
    if (nodeType === 'list') {
      const listType = node.getListType();
      let result = '';
      node.getChildren().forEach((child: any, index: number) => {
        if (child.getType() === 'listitem') {
          const marker = listType === 'bullet' ? '- ' : `${index + 1}. `;
          result += marker + child.getTextContent() + '\n';
        }
      });
      return result;
    }
    
    // Handle quotes
    if (nodeType === 'quote') {
      const text = node.getTextContent();
      return text.split('\n').map((line: string) => line ? '> ' + line : '>').join('\n');
    }
    
    // Handle code blocks
    if (nodeType === 'code') {
      const text = node.getTextContent();
      return '```\n' + text + '\n```';
    }
    
    // Handle inline code
    if (nodeType === 'inline-code') {
      const text = node.getTextContent();
      return '`' + text + '`';
    }
    
    // Handle links
    if (nodeType === 'link') {
      const text = node.getTextContent();
      const url = node.getURL();
      return `[${text}](${url})`;
    }
    
    // Handle horizontal rules
    if (nodeType === 'horizontalrule') {
      return '---';
    }
    
    // For any other node type, try to get text content
    return node.getTextContent();
  }

  // JSON round-trip (editorState persistence)
  static importJSON(json: any): DiffTagNode {
    return new DiffTagNode(json.tag as DiffTag, json.key);
  }
  exportJSON() {
    return {...super.exportJSON(), type: "diff-tag", version: 1, tag: this.__tag};
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
      // For update nodes, create a span container with specific class for CSS targeting
      const element = document.createElement("span");
      element.className = "update-diff-node whitespace-pre-wrap";
      
      // Let Lexical handle rendering the children automatically
      return element;
    }
    
    // For ins/del nodes, create element with background styling
    const element = document.createElement(this.__tag);
    element.className = this.__tag === "ins" 
      ? "bg-green-100 text-green-800 no-underline whitespace-pre-wrap" 
      : "bg-red-100 text-red-800 line-through whitespace-pre-wrap";
    
    // Child nodes will be automatically rendered by Lexical's rendering system
    // The background styling will wrap around all child content
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
    return prevNode.__tag !== this.__tag;
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
      // For update nodes, create a span container with specific class for CSS targeting
      const element = document.createElement("span");
      element.className = "update-diff-node inline-block rounded px-1 whitespace-pre-wrap";
      
      // Let Lexical handle rendering the children automatically
      return { element };
    }
    
    // For ins/del nodes, create element with background styling
    const element = document.createElement(this.__tag);
    element.className = this.__tag === "ins" 
      ? "bg-green-100 text-green-800 no-underline whitespace-pre-wrap" 
      : "bg-red-100 text-red-800 line-through whitespace-pre-wrap";
    
    // Child nodes will be automatically rendered by Lexical's rendering system
    // The background styling will wrap around all child content
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
export function $createDiffTagNode(tag: DiffTag): DiffTagNode {
  return new DiffTagNode(tag, undefined);
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
