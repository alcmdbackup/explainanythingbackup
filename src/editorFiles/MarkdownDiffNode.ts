import type {EditorConfig, LexicalEditor, NodeKey} from "lexical";
import {ElementNode, LexicalNode} from "lexical";

type MarkdownDiffType = "markdown-del" | "markdown-ins" | "custom-del" | "custom-ins";

/**
 * Lexical node for rendering Markdown diff annotations
 * 
 * • Handles Markdown strikethrough (~~text~~) and bold (**text**) syntax
 * • Supports custom diff syntax ({-text-} and {+text+})
 * • Renders as styled spans with appropriate CSS classes
 * • Calls: createDOM, updateDOM, importDOM, exportDOM
 * • Used by: LexicalEditor to display Markdown diff annotations
 */
export class MarkdownDiffNode extends ElementNode {
  __diffType: MarkdownDiffType;

  static getType(): string {
    return "markdown-diff";
  }

  static clone(node: MarkdownDiffNode): MarkdownDiffNode {
    return new MarkdownDiffNode(node.__diffType, node.__key);
  }

  constructor(diffType: MarkdownDiffType, key?: NodeKey) {
    super(key);
    this.__diffType = diffType;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const el = document.createElement("span");
    el.classList.add("markdown-diff");
    
    // Add specific classes based on diff type
    switch (this.__diffType) {
      case "markdown-del":
        el.classList.add("markdown-del", "diff-del");
        break;
      case "markdown-ins":
        el.classList.add("markdown-ins", "diff-ins");
        break;
      case "custom-del":
        el.classList.add("custom-del", "diff-del");
        break;
      case "custom-ins":
        el.classList.add("custom-ins", "diff-ins");
        break;
    }
    
    return el;
  }

  updateDOM(prev: MarkdownDiffNode, dom: HTMLElement): boolean {
    if (prev.__diffType !== this.__diffType) {
      const next = document.createElement("span");
      next.classList.add("markdown-diff");
      
      // Update classes based on new diff type
      switch (this.__diffType) {
        case "markdown-del":
          next.classList.add("markdown-del", "diff-del");
          break;
        case "markdown-ins":
          next.classList.add("markdown-ins", "diff-ins");
          break;
        case "custom-del":
          next.classList.add("custom-del", "diff-del");
          break;
        case "custom-ins":
          next.classList.add("custom-ins", "diff-ins");
          break;
      }
      
      while (dom.firstChild) next.appendChild(dom.firstChild);
      dom.replaceWith(next);
      return true;
    }
    return false;
  }

  isInline(): boolean {
    return true;
  }

  /** Map HTML → this node during $generateNodesFromDOM */
  static importDOM() {
    const conv = (diffType: MarkdownDiffType) => ({
      conversion: () => ({node: new MarkdownDiffNode(diffType)}),
      priority: 1 as const, // higher than default text conversion
    });
    
    return {
      // Standard HTML elements
      ins: () => conv("markdown-ins"),
      del: () => conv("markdown-del"),
      
      // Span elements with specific classes
      span: (el: HTMLElement) => {
        const hasMarkdownDel = el.classList?.contains("markdown-del");
        const hasMarkdownIns = el.classList?.contains("markdown-ins");
        const hasCustomDel = el.classList?.contains("custom-del");
        const hasCustomIns = el.classList?.contains("custom-ins");
        
        if (hasMarkdownDel) return conv("markdown-del");
        if (hasMarkdownIns) return conv("markdown-ins");
        if (hasCustomDel) return conv("custom-del");
        if (hasCustomIns) return conv("custom-ins");
        
        return null;
      },
    };
  }

  /** Map this node → HTML when exporting DOM */
  exportDOM(_editor: LexicalEditor) {
    const element = document.createElement("span");
    element.classList.add("markdown-diff");
    
    switch (this.__diffType) {
      case "markdown-del":
        element.classList.add("markdown-del", "diff-del");
        break;
      case "markdown-ins":
        element.classList.add("markdown-ins", "diff-ins");
        break;
      case "custom-del":
        element.classList.add("custom-del", "diff-del");
        break;
      case "custom-ins":
        element.classList.add("custom-ins", "diff-ins");
        break;
    }
    
    return {element};
  }

  // JSON round-trip (editorState persistence)
  static importJSON(json: any): MarkdownDiffNode {
    return new MarkdownDiffNode(json.diffType as MarkdownDiffType);
  }
  
  exportJSON() {
    return {
      ...super.exportJSON(), 
      type: "markdown-diff", 
      version: 1, 
      diffType: this.__diffType
    };
  }
}

// Helper functions
export function $createMarkdownDelNode() { return new MarkdownDiffNode("markdown-del"); }
export function $createMarkdownInsNode() { return new MarkdownDiffNode("markdown-ins"); }
export function $createCustomDelNode() { return new MarkdownDiffNode("custom-del"); }
export function $createCustomInsNode() { return new MarkdownDiffNode("custom-ins"); }
export function $isMarkdownDiffNode(n?: LexicalNode | null): n is MarkdownDiffNode { 
  return n instanceof MarkdownDiffNode; 
}
