/* eslint-disable @typescript-eslint/no-explicit-any */
import type {NodeKey, DOMConversionMap, DOMConversionOutput, DOMExportOutput} from "lexical";
import {ElementNode, LexicalNode, $isTextNode} from "lexical";

type DiffTag = "ins" | "del" | "update";

export class DiffTagNodeInline extends ElementNode {
  __tag: DiffTag;
  __beforeChildrenCount?: number;

  static getType(): string {
    return "diff-tag";
  }

  static clone(node: DiffTagNodeInline): DiffTagNodeInline {
    const cloned = new DiffTagNodeInline(node.__tag, node.__key);
    return cloned;
  }

  constructor(tag: DiffTag, key?: NodeKey) {
    super(key);
    this.__tag = tag;
    console.log("🏗️ DiffTagNodeInline created with tag:", tag, "key:", key);
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

    // Handle DiffUpdateContainerInline nodes by recursively processing their children
    if (nodeType === 'diff-update-container-inline') {
      let result = '';
      node.getChildren().forEach((child: any) => {
        result += this.exportNodeToMarkdown(child);
      });
      return result;
    }

    // Handle headings
    if (nodeType === 'heading') {
      const level = node.getTag();
      const headingLevel = level === 'h1' ? 1 : level === 'h2' ? 2 : level === 'h3' ? 3 :
                          level === 'h4' ? 4 : level === 'h5' ? 5 : 6;
      const text = node.getTextContent();
      return '#'.repeat(headingLevel) + ' ' + text;
    }
    
    // Handle paragraphs - recursively process children for complex content
    if (nodeType === 'paragraph') {
      let result = '';
      node.getChildren().forEach((child: any) => {
        result += this.exportNodeToMarkdown(child);
      });
      return result || node.getTextContent(); // Fallback to text content if no children
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
    
    // Handle links (including standalone-title-link)
    if (nodeType === 'link' || nodeType === 'standalone-title-link') {
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
  static importJSON(json: any): DiffTagNodeInline {
    return new DiffTagNodeInline(json.tag as DiffTag, json.key);
  }
  exportJSON() {
    return {...super.exportJSON(), type: "diff-tag", version: 1, tag: this.__tag};
  }

  /**
   * Creates DOM element for rendering the DiffTagNodeInline
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
      element.className = "diff-tag-update";
      element.setAttribute("data-diff-key", this.__key);
      element.setAttribute("data-diff-type", this.__tag);

      // Let Lexical handle rendering the children automatically
      return element;
    }

    // For ins/del nodes, create element with background styling
    const element = document.createElement(this.__tag);
    element.className = this.__tag === "ins"
      ? "diff-tag-insert"
      : "diff-tag-delete";
    element.setAttribute("data-diff-key", this.__key);
    element.setAttribute("data-diff-type", this.__tag);

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
  updateDOM(prevNode: DiffTagNodeInline): boolean {
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
      element.className = "diff-tag-update";
      
      // Let Lexical handle rendering the children automatically
      return { element };
    }
    
    // For ins/del nodes, create element with background styling
    const element = document.createElement(this.__tag);
    element.className = this.__tag === "ins" 
      ? "diff-tag-insert" 
      : "diff-tag-delete";
    
    // Child nodes will be automatically rendered by Lexical's rendering system
    // The background styling will wrap around all child content
    return { element };
  }

  /**
   * Converts DOM element back to DiffTagNodeInline
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
 * Converts DOM element to DiffTagNodeInline
 * • Determines tag type from element tagName or CSS classes
 * • Creates new DiffTagNodeInline with appropriate tag
 * • Used by importDOM for HTML conversion
 * • Called by: Lexical's DOM import system
 */
function convertDiffTagElement(domNode: HTMLElement): DOMConversionOutput {
  const tagName = domNode.tagName.toLowerCase();
  
  // Check if it's a span with update styling (orange background)
  if (tagName === 'span' && domNode.className.includes('bg-orange-50')) {
    const node = $createDiffTagNodeInline('update');
    return { node };
  }
  
  // For ins/del elements, use the tagName directly
  const tag = tagName as DiffTag;
  const node = $createDiffTagNodeInline(tag);
  return { node };
}

/**
 * Creates a new DiffTagNodeInline instance
 * • Factory function for creating DiffTagNodeInline instances
 * • Used by other parts of the codebase to create inline diff nodes
 * • Called by: CRITIC_MARKUP transformer, import functions
 */
export function $createDiffTagNodeInline(tag: DiffTag): DiffTagNodeInline {
  return new DiffTagNodeInline(tag, undefined);
}

/**
 * Checks if a node is a DiffTagNodeInline
 * • Type guard function for DiffTagNodeInline instances
 * • Used for type checking in other parts of the codebase
 * • Called by: Various utility functions
 */
export function $isDiffTagNodeInline(node: LexicalNode | null | undefined): node is DiffTagNodeInline {
  return node instanceof DiffTagNodeInline;
}

/**
 * Block-level version of DiffTagNodeInline that always returns false for isInline()
 * • Extends DiffTagNodeInline with block-level behavior
 * • All functionality identical to DiffTagNodeInline except isInline() returns false
 * • Used when diff tags need to be rendered as block elements instead of inline
 * • Called by: Lexical's rendering system for block-level diff display
 */
export class DiffTagNodeBlock extends DiffTagNodeInline {
  static getType(): string {
    return "diff-tag-block";
  }

  static clone(node: DiffTagNodeBlock): DiffTagNodeBlock {
    const cloned = new DiffTagNodeBlock(node.__tag, node.__key);
    return cloned;
  }

  constructor(tag: DiffTag, key?: NodeKey) {
    super(tag, key);
    console.log("🏗️ DiffTagNodeBlock created with tag:", tag, "key:", key);
  }

  /**
   * Override isInline to always return false for block-level behavior
   * • Forces this node to be treated as a block element by Lexical
   * • Used by Lexical's layout system to determine rendering behavior
   * • Called by: Lexical's rendering and layout systems
   */
  isInline(): boolean {
    return false;
  }

  // JSON round-trip (editorState persistence)
  static importJSON(json: any): DiffTagNodeBlock {
    return new DiffTagNodeBlock(json.tag as DiffTag, json.key);
  }
}

/**
 * Creates a new DiffTagNodeBlock instance
 * • Factory function for creating DiffTagNodeBlock instances
 * • Used by other parts of the codebase to create block-level diff nodes
 * • Called by: CRITIC_MARKUP transformer, import functions
 */
export function $createDiffTagNodeBlock(tag: DiffTag): DiffTagNodeBlock {
  return new DiffTagNodeBlock(tag, undefined);
}

/**
 * Checks if a node is a DiffTagNodeBlock
 * • Type guard function for DiffTagNodeBlock instances
 * • Used for type checking in other parts of the codebase
 * • Called by: Various utility functions
 */
export function $isDiffTagNodeBlock(node: LexicalNode | null | undefined): node is DiffTagNodeBlock {
  return node instanceof DiffTagNodeBlock;
}

/**
 * Inline container node for wrapping content within update diff nodes
 * • Creates a lightweight inline wrapper without paragraph semantics
 * • Used specifically for "before" and "after" sections in update diffs
 * • Maintains inline flow while providing a container for CSS targeting
 * • Called by: CRITIC_MARKUP transformer for update syntax processing
 */
export class DiffUpdateContainerInline extends ElementNode {
  __containerType: "before" | "after";

  static getType(): string {
    return "diff-update-container-inline";
  }

  static clone(node: DiffUpdateContainerInline): DiffUpdateContainerInline {
    const cloned = new DiffUpdateContainerInline(node.__containerType, node.__key);
    return cloned;
  }

  constructor(containerType: "before" | "after", key?: NodeKey) {
    super(key);
    this.__containerType = containerType;
    console.log("🏗️ DiffUpdateContainerInline created with type:", containerType, "key:", key);
  }

  isInline(): boolean {
    return true;
  }

  canBeEmpty(): boolean {
    return false;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  // JSON round-trip (editorState persistence)
  static importJSON(json: any): DiffUpdateContainerInline {
    return new DiffUpdateContainerInline(json.containerType, json.key);
  }

  exportJSON() {
    return {
      ...super.exportJSON(),
      type: "diff-update-container-inline",
      version: 1,
      containerType: this.__containerType
    };
  }

  /**
   * Creates DOM element for rendering the inline container
   * • Creates <span> element with appropriate CSS class for styling
   * • Does not add semantic meaning, just provides styling hooks
   * • Used by Lexical to render the container in the DOM
   */
  createDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = `diff-update-container-${this.__containerType}`;
    return element;
  }

  /**
   * Updates DOM element when node properties change
   */
  updateDOM(prevNode: DiffUpdateContainerInline): boolean {
    return prevNode.__containerType !== this.__containerType;
  }

  /**
   * Exports node to DOM for serialization
   */
  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.className = `diff-update-container-${this.__containerType}`;
    return { element };
  }

  /**
   * Converts DOM element back to DiffUpdateContainerInline
   */
  static importDOM(): DOMConversionMap | null {
    return {
      span: (node: HTMLElement) => {
        const className = node.className;
        if (className.includes('diff-update-container-before') ||
            className.includes('diff-update-container-after')) {
          return {
            conversion: convertDiffUpdateContainerElement,
            priority: 1,
          };
        }
        return null;
      },
    };
  }
}

/**
 * Converts DOM element to DiffUpdateContainerInline
 */
function convertDiffUpdateContainerElement(domNode: HTMLElement): DOMConversionOutput {
  const className = domNode.className;
  const containerType = className.includes('diff-update-container-before') ? "before" : "after";
  const node = $createDiffUpdateContainerInline(containerType);
  return { node };
}

/**
 * Creates a new DiffUpdateContainerInline instance
 * • Factory function for creating DiffUpdateContainerInline instances
 * • Used by CRITIC_MARKUP transformer to create inline containers
 */
export function $createDiffUpdateContainerInline(containerType: "before" | "after"): DiffUpdateContainerInline {
  return new DiffUpdateContainerInline(containerType, undefined);
}

/**
 * Checks if a node is a DiffUpdateContainerInline
 * • Type guard function for DiffUpdateContainerInline instances
 */
export function $isDiffUpdateContainerInline(node: LexicalNode | null | undefined): node is DiffUpdateContainerInline {
  return node instanceof DiffUpdateContainerInline;
}
