import type {EditorConfig, LexicalEditor, NodeKey, DOMConversionMap, DOMConversionOutput, DOMExportOutput} from "lexical";
import {ElementNode, LexicalNode} from "lexical";

type DiffTag = "ins" | "del";

export class DiffTagNode extends ElementNode {
  __tag: DiffTag;

  static getType(): string {
    return "diff-tag";
  }

  static clone(node: DiffTagNode): DiffTagNode {
    return new DiffTagNode(node.__tag, node.__key);
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
    const content = this.getTextContent();
    const marker = this.__tag === "ins" ? "++" : "--";
    const result = `{${marker}${content}${marker}}`;
    
    console.log("📤 DiffTagNode.exportMarkdown() called");
    console.log("🏷️ Tag type:", this.__tag);
    console.log("📝 Content length:", content.length);
    console.log("📝 Content preview:", JSON.stringify(content.substring(0, 100)));
    console.log("🎯 Generated CriticMarkup:", JSON.stringify(result));
    console.log("🔑 Node key:", this.getKey());
    
    return result;
  }

  // JSON round-trip (editorState persistence)
  static importJSON(json: any): DiffTagNode {
    return new DiffTagNode(json.tag as DiffTag);
  }
  exportJSON() {
    return {...super.exportJSON(), type: "diff-tag", version: 1, tag: this.__tag};
  }

  /**
   * Creates DOM element for rendering the DiffTagNode
   * • Creates <ins> or <del> HTML elements based on the tag type
   * • Applies appropriate styling classes for visual distinction
   * • Preserves newlines with whitespace-pre-wrap for proper formatting
   * • Used by Lexical to render the node in the DOM
   * • Called by: Lexical's rendering system
   */
  createDOM(): HTMLElement {
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
    const element = document.createElement(this.__tag);
    element.className = this.__tag === "ins" 
      ? "bg-green-100 text-green-800 border border-green-200 rounded px-1 whitespace-pre-wrap" 
      : "bg-red-100 text-red-800 border border-red-200 rounded px-1 line-through whitespace-pre-wrap";
    return { element };
  }

  /**
   * Converts DOM element back to DiffTagNode
   * • Handles conversion from HTML <ins>/<del> elements
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
    };
  }
}

/**
 * Converts DOM element to DiffTagNode
 * • Determines tag type from element tagName
 * • Creates new DiffTagNode with appropriate tag
 * • Used by importDOM for HTML conversion
 * • Called by: Lexical's DOM import system
 */
function convertDiffTagElement(domNode: HTMLElement): DOMConversionOutput {
  const tag = domNode.tagName.toLowerCase() as DiffTag;
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
  return new DiffTagNode(tag);
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
